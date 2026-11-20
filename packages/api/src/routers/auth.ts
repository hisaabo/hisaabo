import { eq, ne, and, gt, lte, isNull, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { controlDb, users, sessions, tenants, tenantMembers, magicLinkTokens, invitations, accessTokens, apiKeys, nativeAuthRequests, provisionTenantDatabase, cleanupTenantDatabase, type TenantDbConfig } from "@hisaabo/db";
import { loginSchema, registerSchema, magicLinkRequestSchema, magicLinkVerifySchema, completeProfileSchema, nativeStartSchema, nativeExchangeSchema } from "@hisaabo/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { emailService } from "../lib/email.js";
import { getSessionIdFromRequest } from "../context.js";
import { cacheBus, type CacheEvent } from "../lib/cache/bus.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { enforceSessionLimit } from "../lib/plan-limits.js";
import { logSecurityEvent, logger } from "../lib/logger.js";
import { getTrustedClientIp } from "../lib/client-ip.js";
import { isBearerClient } from "../lib/bearer-client.js";
import { isLegacyCaptchaExempt, isTauriDesktopRequest, legacyHandoffSource } from "../lib/legacy-v09-compat.js";
import { MAGIC_LINK_TTL_MS, generateMagicLinkToken, buildMagicLinkUrl } from "../lib/magic-link.js";
import { normalizeEmail, emailEq } from "../lib/normalize-email.js";
import { isMultiTenant, isOpenSignupEnabled, hasPendingInvitation, enforceSelfHostedSignup } from "../lib/signup-policy.js";
import {
  NATIVE_REQUEST_TTL_MS,
  NATIVE_CODE_TTL_MS,
  isValidNativeRedirectUri,
  sha256Hex,
  generateNativeCode,
  verifyPkceS256,
  buildNativeRedirectUrl,
} from "../lib/native-auth.js";

// Email-change requests per account per hour (superseded ones still count).
const EMAIL_CHANGE_MAX_PER_WINDOW = 3;
const EMAIL_CHANGE_WINDOW_MS = 60 * 60 * 1000;

// Cap on emailed links per address per 24h for Turnstile-exempt v0.9.x clients.
const LEGACY_EXEMPT_MAX_LINKS_PER_DAY = 10;

// Self-hosted only (see verifyMagicLink): membership roles that prove an account is
// an established member of the server rather than a stranger's password sign-up.
// On a self-hosted server these roles only come from trusted paths: the first owner,
// accepting an invitation (token path, or in-app after email verification), or an
// admin's role change. The legacy "member" role is deliberately excluded: it is what
// `tenant.create` hands to anyone with a pending invitation and what the default
// tenant hands to later registrants, so it proves nothing.
const SELF_HOSTED_ESTABLISHED_ROLES = ["owner", "superadmin", "admin", "seller_manager", "seller", "accountant"] as const;

// TTL for short-lived access tokens (15 minutes)
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BEARER_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days sliding window
const BEARER_MAX_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30-day absolute cap

// Per-email rate limiting for login attempts
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const failedLoginAttempts = new Map<string, { count: number; firstAttempt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedLoginAttempts) {
    if (now - entry.firstAttempt > LOGIN_WINDOW_MS) failedLoginAttempts.delete(key);
  }
}, 5 * 60_000).unref();

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const suffix = nanoid(6);
  return `${base}-${suffix}`;
}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(randomBytes(16).toString("hex"), {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  return dummyHashPromise;
}

/** Non-reversible public identifier for a session (the raw id is a bearer credential). */
export function sessionHandle(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const IS_SECURE = (process.env.APP_URL || "").startsWith("https");

function getClientIpFromRequest(req: Request): string | null {
  return getTrustedClientIp(req.headers);
}

// ── Shared helper: self-hosted default tenant assignment ───────
// Wrapped in a serializable transaction to prevent TOCTOU race on owner role
type ControlTx = Parameters<Parameters<typeof controlDb.transaction>[0]>[0];

// Cache invalidation for the sign-up / sign-in transactions. The ids are
// recorded as the transaction body learns them; the events are emitted AFTER
// the transaction settled (commit or rollback — a rollback invalidates
// harmlessly). Emitting inside the tx would let a concurrent read re-cache the
// pre-commit state. `session{userId}` also covers sessions evicted by
// enforceSessionLimit(…, tx) and `user` the emailVerified flip.
interface SignInTouched { userId?: string; tenantId?: string; credentialsRevoked?: boolean }

async function settleSignIn<T>(touched: SignInTouched, run: Promise<T>): Promise<T> {
  try {
    return await run;
  } finally {
    const events: CacheEvent[] = [];
    if (touched.userId) {
      events.push({ kind: "user", userId: touched.userId }, { kind: "session", userId: touched.userId });
    }
    // First verification of an unverified account deletes its API keys too.
    if (touched.userId && touched.credentialsRevoked) events.push({ kind: "apiKey", userId: touched.userId });
    if (touched.tenantId) events.push({ kind: "membership", tenantId: touched.tenantId, userId: touched.userId });
    if (events.length) cacheBus.invalidate(events);
  }
}

async function getOrCreateDefaultTenant(userId: string, parentTx?: ControlTx): Promise<string> {
  const run = async (tx: ControlTx) => {
    let [existing] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "default"))
      .limit(1);

    if (!existing) {
      [existing] = await tx.insert(tenants).values({
        name: "Default Organization",
        slug: "default",
      }).returning({ id: tenants.id });
    }

    const memberCount = await tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, existing.id));

    const role = memberCount.length === 0 ? "owner" : "member";

    await tx.insert(tenantMembers).values({
      tenantId: existing.id,
      userId,
      role,
      acceptedAt: new Date(),
    });

    return existing.id;
  };
  return parentTx ? run(parentTx) : controlDb.transaction(run);
}

// ── Shared helper: create session + resolve tenant ─────────────
//
// With `tx` the memberships read, eviction and insert run inside the caller's
// transaction and the cookie is NOT set here: the caller sets it after COMMIT and
// emits `session{userId}` once the transaction settled (see settleSignIn).
async function createSessionForUser(
  userId: string,
  ctx: { req: Request; resHeaders: Headers },
  authMethod: "cookie" | "bearer" = "cookie",
  tx?: ControlTx,
): Promise<string> {
  const db = tx ?? controlDb;
  const memberships = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId));

  const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

  // Evict oldest sessions if at plan limit (FIFO, never blocks login)
  await enforceSessionLimit(userId, tx);

  const previousSessionId = getSessionIdFromRequest(ctx.req);
  if (previousSessionId && !previousSessionId.startsWith("hisaabo_key_")) {
    // Delete first, invalidate after it settled (never the other way round).
    await cacheBus
      .afterWrite([{ kind: "session", sessionId: previousSessionId }], () =>
        controlDb.delete(sessions).where(eq(sessions.id, previousSessionId)),
      )
      .catch(() => {});
  }

  const now = Date.now();
  const sessionId = nanoid(64);

  // Bearer sessions use a 7-day sliding window with a 30-day absolute cap.
  // Cookie sessions keep the existing 30-day fixed expiry.
  const expiresAt = new Date(now + (authMethod === "bearer" ? BEARER_SESSION_DURATION_MS : SESSION_DURATION_MS));
  const maxExpiresAt = authMethod === "bearer" ? new Date(now + BEARER_MAX_SESSION_DURATION_MS) : null;

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tenantId: resolvedTenantId,
    expiresAt,
    maxExpiresAt,
    authMethod,
    ipAddress: getClientIpFromRequest(ctx.req),
    userAgent: ctx.req.headers.get("user-agent") || null,
  });

  // Cookie clients always get Set-Cookie; Bearer clients hold the token in-app.
  if (authMethod === "cookie" && !tx) {
    setSessionCookie(ctx.resHeaders, sessionId);
  }
  return sessionId;
}

// Session ID extraction uses the canonical getSessionIdFromRequest from context.ts
// which correctly skips API keys (hisaabo_key_ prefix).
function getSessionIdFromContext(ctx: { req: Request }): string | null {
  return getSessionIdFromRequest(ctx.req);
}

// ── Two-phase tenant provisioning for new users (MULTI_TENANT mode) ──
//
// CREATE DATABASE is non-transactional in Postgres, so we cannot provision a
// tenant database from inside a control-DB transaction and trust it to roll
// back. Instead we split the flow into two phases:
//
//   Phase 1 (outside any tx): provisionNewTenantForUser()
//     Creates the physical DB + role + schema. Returns a dbConfig + slug.
//     If it throws, provisionTenantDatabase's own catch already cleaned up.
//
//   Phase 2 (inside the caller's tx): writeNewTenantRows()
//     Inserts the tenants row (populated with dbConfig) + owner membership.
//
// If anything in the surrounding tx fails AFTER Phase 1 returned successfully
// (Phase 2 row inserts, user insert, session insert, enforceSessionLimit,
// COMMIT), the caller is responsible for calling
// cleanupTenantDatabase(dbConfig.dbName, dbConfig.dbUser) as compensation.
// Otherwise the physical DB + role orphan in the cluster forever.
//
// Callers must use the withProvisionedTenantCleanup() wrapper below, which
// encapsulates the compensation contract so it can't be forgotten.

interface ProvisionedTenant {
  tenantName: string;
  slug: string;
  dbConfig: TenantDbConfig;
}

async function provisionNewTenantForUser(displayName: string): Promise<ProvisionedTenant> {
  const tenantName = `${displayName}'s Organization`;
  const slug = generateSlug(tenantName);
  // provisionTenantDatabase currently uses tenantId only for log labels; the
  // real id is generated by the DB when we later insert the tenants row.
  const dbConfig = await provisionTenantDatabase(nanoid(), slug);
  return { tenantName, slug, dbConfig };
}

async function writeNewTenantRows(
  tx: ControlTx,
  userId: string,
  provisioned: ProvisionedTenant,
): Promise<string> {
  const [tenant] = await tx.insert(tenants).values({
    name: provisioned.tenantName,
    slug: provisioned.slug,
    dbName: provisioned.dbConfig.dbName,
    dbHost: provisioned.dbConfig.dbHost,
    dbPort: provisioned.dbConfig.dbPort,
    dbUser: provisioned.dbConfig.dbUser,
    dbPassword: provisioned.dbConfig.dbPassword,
  }).returning({ id: tenants.id });
  await tx.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId,
    role: "owner",
    acceptedAt: new Date(),
  });
  return tenant.id;
}

/**
 * Runs `work` and guarantees that if a tenant was provisioned but not
 * ultimately used (either because `work` throws, or because `work` explicitly
 * marks the provisioned tenant unused via the `markUnused` callback), the
 * physical DB + role are cleaned up. This keeps the compensation contract in
 * one place so every sign-up path can't accidentally skip it.
 */
async function withProvisionedTenantCleanup<T>(
  provisioned: ProvisionedTenant | null,
  work: (markUsed: () => void) => Promise<T>,
): Promise<T> {
  let used = false;
  const markUsed = () => {
    used = true;
  };
  try {
    const result = await work(markUsed);
    if (provisioned && !used) {
      await cleanupTenantDatabase(
        provisioned.dbConfig.dbName,
        provisioned.dbConfig.dbUser,
      );
    }
    return result;
  } catch (err) {
    if (provisioned) {
      await cleanupTenantDatabase(
        provisioned.dbConfig.dbName,
        provisioned.dbConfig.dbUser,
      );
    }
    throw err;
  }
}

export const authRouter = router({
  // ── Password registration (keeps working for self-hosted) ────
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    // Require Turnstile when secret key is configured (production).
    // Self-hosted / dev without the key can skip verification.
    const registerAuthMethod: "cookie" | "bearer" = isBearerClient(ctx.req) ? "bearer" : "cookie";
    if (process.env.TURNSTILE_SECRET_KEY && !input.turnstileToken) {
      // Turnstile stays mandatory for account creation, including for v0.9.x apps
      // (their sendMagicLink exemption never covers sign-up). The v0.9.0 desktop
      // webview cannot solve a challenge, so tell it what to do instead.
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: isTauriDesktopRequest(ctx.req)
          ? "Update the Hisaabo desktop app to create an account, or sign up in your browser."
          : "Turnstile verification required",
      });
    }
    if (input.turnstileToken) {
      const ip = getClientIpFromRequest(ctx.req);
      const valid = await verifyTurnstile(input.turnstileToken, ip);
      if (!valid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
      }
    }

    const emailLower = normalizeEmail(input.email);
    const existing = await controlDb.select({ id: users.id }).from(users).where(emailEq(users.email, emailLower)).limit(1);
    if (existing.length > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // ── Pre-tx peek: decide whether we need to provision a tenant DB ──
    // For brand-new registrations, we provision the physical DB OUTSIDE the
    // control-DB transaction (CREATE DATABASE is non-transactional). The
    // invitation peek is a dirty read — confirmed inside the tx below. If the
    // peek is wrong (invitation accepted mid-flight), withProvisionedTenantCleanup
    // drops the unused DB on its way out.
    const [pendingInvitePeek] = await controlDb.select({ id: invitations.id })
      .from(invitations)
      .where(and(
        emailEq(invitations.email, emailLower),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ))
      .limit(1);

    const needsAutoTenant = process.env.MULTI_TENANT === "true" && !pendingInvitePeek;
    const provisioned: ProvisionedTenant | null = needsAutoTenant
      ? await provisionNewTenantForUser(input.name || emailLower.split("@")[0])
      : null;

    // Insert user, assign tenant, and create session in one outer transaction.
    // On any failure (including COMMIT failure), withProvisionedTenantCleanup
    // drops the orphan physical tenant DB.
    const touched: SignInTouched = {};
    const { user, sessionToken } = await withProvisionedTenantCleanup(
      provisioned,
      async (markUsed) =>
        settleSignIn(touched, controlDb.transaction(async (tx) => {
          await enforceSelfHostedSignup(tx, emailLower);

          const [user] = await tx.insert(users).values({
            email: emailLower,
            name: input.name,
            passwordHash,
          }).returning({ id: users.id, email: users.email, name: users.name });
          touched.userId = user.id;

          // Re-check invitation inside the tx (actual state, not the peek)
          const [pendingInvite] = await tx.select({ id: invitations.id })
            .from(invitations)
            .where(and(
              emailEq(invitations.email, emailLower),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, new Date()),
            ))
            .limit(1);

          if (pendingInvite) {
            // Invitation exists — do NOT auto-create a tenant. If we
            // pre-provisioned one based on the peek, it will be cleaned up
            // because we never call markUsed().
          } else if (process.env.MULTI_TENANT === "true") {
            if (!provisioned) {
              // Peek said invitation pending but tx says no — this is a rare
              // race where the invitation expired between peek and tx. Rather
              // than provision inside the tx (impossible) and risk a deeper
              // orphan, throw a retryable conflict.
              throw new TRPCError({
                code: "CONFLICT",
                message: "Sign-up state changed — please try again.",
              });
            }
            touched.tenantId = await writeNewTenantRows(tx, user.id, provisioned);
            markUsed();
          } else {
            touched.tenantId = await getOrCreateDefaultTenant(user.id, tx);
          }

          const sessionId = nanoid(64);
          const memberships = await tx
            .select({ tenantId: tenantMembers.tenantId })
            .from(tenantMembers)
            .where(eq(tenantMembers.userId, user.id));
          const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

          await enforceSessionLimit(user.id, tx);

          const regNow = Date.now();
          const regExpiresAt = new Date(regNow + (registerAuthMethod === "bearer" ? BEARER_SESSION_DURATION_MS : SESSION_DURATION_MS));
          const regMaxExpiresAt = registerAuthMethod === "bearer" ? new Date(regNow + BEARER_MAX_SESSION_DURATION_MS) : null;

          await tx.insert(sessions).values({
            id: sessionId,
            userId: user.id,
            tenantId: resolvedTenantId,
            expiresAt: regExpiresAt,
            maxExpiresAt: regMaxExpiresAt,
            authMethod: registerAuthMethod,
            ipAddress: getClientIpFromRequest(ctx.req),
            userAgent: ctx.req.headers.get("user-agent") || null,
          });

          return { user, sessionToken: sessionId };
        })),
    );

    // Set-Cookie only after the tx has committed. If COMMIT fails, the error
    // bubbles out of withProvisionedTenantCleanup without ever reaching here,
    // so the client never gets a cookie for a rolled-back session.
    if (registerAuthMethod === "cookie") {
      setSessionCookie(ctx.resHeaders, sessionToken);
    }

    return {
      user: { id: user.id, email: user.email, name: user.name },
      sessionToken: registerAuthMethod === "bearer" ? sessionToken : undefined,
    };
  }),

  // ── Password login ───────────────────────────────────────────
  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    // Per-email rate limiting: block after too many failed attempts
    const emailKey = normalizeEmail(input.email);
    const loginIp = getClientIpFromRequest(ctx.req);
    const attempts = failedLoginAttempts.get(emailKey);
    if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS && Date.now() - attempts.firstAttempt < LOGIN_WINDOW_MS) {
      logSecurityEvent("login_lockout", { ip: loginIp, reason: "email_threshold" });
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many failed login attempts. Please try again later." });
    }

    const [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
      .from(users)
      .where(emailEq(users.email, emailKey))
      .limit(1);

    // Burn the same argon2 work for unknown / passwordless accounts so response
    // time doesn't reveal whether the email is registered.
    if (!user?.passwordHash) {
      await argon2.verify(await getDummyHash(), input.password).catch(() => false);
    }

    if (!user) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      logSecurityEvent("login_fail", { ip: loginIp, reason: "no_user" });
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    if (!user.passwordHash) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      logSecurityEvent("login_fail", { ip: loginIp, reason: "no_password" });
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      logSecurityEvent("login_fail", { ip: loginIp, reason: "bad_password" });
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    // Successful login — clear failed attempts
    failedLoginAttempts.delete(emailKey);

    const memberships = await controlDb
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id));

    if (memberships.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Account has no organization membership" });
    }

    const bearer = isBearerClient(ctx.req);
    const authMethod = bearer ? "bearer" : "cookie";

    // The argon2 verification above takes long enough for verifyMagicLink's
    // first-verification credential wipe (which nulls password_hash and deletes
    // sessions under a row lock on this user) to commit in between. Take the same
    // row lock and require the hash we verified to still be the stored one, so a
    // login that was in flight cannot mint a session after the wipe.
    const touched: SignInTouched = { userId: user.id };
    const sessionToken = await settleSignIn(touched, controlDb.transaction(async (tx) => {
      const [locked] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update")
        .limit(1);
      if (!locked?.passwordHash || locked.passwordHash !== user.passwordHash) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }
      return createSessionForUser(user.id, ctx, authMethod, tx);
    }));
    // Set-Cookie only after COMMIT (a rolled-back session must never reach the client).
    if (authMethod === "cookie") {
      setSessionCookie(ctx.resHeaders, sessionToken);
    }

    return {
      user: { id: user.id, email: user.email, name: user.name },
      sessionToken: bearer ? sessionToken : undefined,
    };
  }),

  // ── Magic link: request ──────────────────────────────────────
  sendMagicLink: publicProcedure.input(magicLinkRequestSchema).mutation(async ({ input, ctx }) => {
    // Turnstile is required whenever a secret key is configured. Dev / self-hosted
    // without the key can omit it. The only exception is the DEPRECATED v0.9.x
    // native-client exemption (lib/legacy-v09-compat.ts, kill switch
    // LEGACY_V09_CLIENT_COMPAT=false): those apps cannot solve a challenge and
    // never needed to, so a tokenless request with their exact header signature is
    // let through, then bounded below (existing/invited users only, 10 links per
    // address per 24h). A request that carries a token is always verified.
    const exempt = !input.turnstileToken && isLegacyCaptchaExempt(ctx.req);
    if (process.env.TURNSTILE_SECRET_KEY && !input.turnstileToken && !exempt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Turnstile verification required" });
    }
    if (input.turnstileToken) {
      const ip = getClientIpFromRequest(ctx.req);
      const valid = await verifyTurnstile(input.turnstileToken, ip);
      if (!valid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
      }
    }

    const email = normalizeEmail(input.email);

    // Check if user already exists to send welcome vs sign-in variant
    // (API response is always { success: true } regardless — no enumeration risk)
    const [existingUser] = await controlDb.select({ id: users.id }).from(users).where(emailEq(users.email, email)).limit(1);

    // Legacy (Turnstile-exempt) callers can only trigger mail to people who already
    // have, or are invited to have, an account, and only a bounded number per
    // address per day. Same response either way, so nothing is revealed.
    const legacyExemptGated = exempt && !!process.env.TURNSTILE_SECRET_KEY;
    if (legacyExemptGated) {
      if (!existingUser && !(await hasPendingInvitation(controlDb, email))) {
        return { success: true };
      }
      const dayTokens = await controlDb
        .select({ id: magicLinkTokens.id })
        .from(magicLinkTokens)
        .where(and(
          eq(magicLinkTokens.email, email),
          gt(magicLinkTokens.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ));
      if (dayTokens.length >= LEGACY_EXEMPT_MAX_LINKS_PER_DAY) {
        return { success: true };
      }
      logSecurityEvent("turnstile_legacy_exempt", {
        ip: getClientIpFromRequest(ctx.req),
        path: "/api/trpc/auth.sendMagicLink",
        reason: isTauriDesktopRequest(ctx.req) ? "desktop" : "mobile",
      });
    }

    // Closed self-hosted server: unknown, uninvited emails get no link. The
    // response is identical so this reveals nothing.
    if (!existingUser && !isMultiTenant() && !isOpenSignupEnabled()) {
      const [anyUser] = await controlDb.select({ id: users.id }).from(users).limit(1);
      if (anyUser && !(await hasPendingInvitation(controlDb, email))) {
        return { success: true };
      }
    }

    // Rate limit: max 5 requests per email per 15 minutes
    const recentTokens = await controlDb
      .select({ id: magicLinkTokens.id })
      .from(magicLinkTokens)
      .where(and(
        eq(magicLinkTokens.email, email),
        gt(magicLinkTokens.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
      ));

    if (recentTokens.length >= 5) {
      // Don't reveal rate limit — always return success to prevent enumeration
      return { success: true };
    }

    const { rawToken, tokenHash: tokenH } = generateMagicLinkToken();

    await controlDb.insert(magicLinkTokens).values({
      email,
      tokenHash: tokenH,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      ipAddress: getClientIpFromRequest(ctx.req),
    });

    const baseUrl = process.env.APP_URL || "http://localhost:5173";

    // The email CTA is always the HTTPS link: email clients refuse to render
    // custom URL schemes. For v0.9.x native clients the link carries
    // `source=mobile|desktop` so /auth/verify can offer to open the app
    // (legacyHandoffSource is null — no suffix — when the compat switch is off).
    const webUrl = buildMagicLinkUrl(baseUrl, rawToken, legacyHandoffSource(ctx.req, input.source) ?? undefined);

    if (legacyExemptGated) {
      // Turnstile-exempt callers are answered before the mail provider has
      // replied: otherwise the response time separates "known address" (a send
      // happened) from "unknown / over the daily cap" (returned early), an
      // enumeration oracle for a caller that carries no Turnstile token. A send
      // failure is logged, never surfaced.
      void emailService.sendMagicLink(email, webUrl, !existingUser).catch((err) => {
        logger.warn({ err }, "Failed to send magic link to a Turnstile-exempt (legacy) client");
      });
    } else {
      await emailService.sendMagicLink(email, webUrl, !existingUser);
    }

    return { success: true }; // Always success — no email enumeration
  }),

  // ── Magic link: verify ───────────────────────────────────────
  verifyMagicLink: publicProcedure.input(magicLinkVerifySchema).mutation(async ({ input, ctx }) => {
    // Determine authMethod once, before the transaction, using the same
    // x-hisaabo-client signal as login/register.
    const magicLinkAuthMethod: "cookie" | "bearer" = isBearerClient(ctx.req) ? "bearer" : "cookie";
    const tokenH = hashToken(input.token);

    // ── Phase 1 (pre-tx peek) ────────────────────────────────────────
    // Decide whether this verify is likely to trigger tenant provisioning,
    // so we can create the physical DB OUTSIDE any transaction. The peeks
    // are dirty reads — authoritative checks happen inside the tx below.
    //
    // We do NOT consume the token here. The atomic UPDATE ... WHERE
    // usedAt IS NULL ... RETURNING inside the tx is the only claim site,
    // so a concurrent verify that claims the token between peek and tx
    // will cause OUR tx to throw BAD_REQUEST — and our provisioned DB (if
    // any) will be cleaned up by withProvisionedTenantCleanup.
    const [tokenPeek] = await controlDb.select({ email: magicLinkTokens.email })
      .from(magicLinkTokens)
      .where(and(
        eq(magicLinkTokens.tokenHash, tokenH),
        gt(magicLinkTokens.expiresAt, new Date()),
        isNull(magicLinkTokens.usedAt),
      ))
      .limit(1);

    if (!tokenPeek) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid, expired, or already used link. Please request a new one.",
      });
    }

    const peekEmail = tokenPeek.email;
    const peekEmailLower = normalizeEmail(peekEmail);

    const [existingUserPeek] = await controlDb.select({ id: users.id })
      .from(users)
      .where(emailEq(users.email, peekEmailLower))
      .limit(1);

    const [pendingInvitePeek] = existingUserPeek ? [] : await controlDb.select({ id: invitations.id })
      .from(invitations)
      .where(and(
        eq(invitations.email, peekEmailLower),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ))
      .limit(1);

    const needsAutoTenant =
      !existingUserPeek && !pendingInvitePeek && process.env.MULTI_TENANT === "true";

    // ── Phase 2 (provision outside tx) ────────────────────────────────
    const provisioned: ProvisionedTenant | null = needsAutoTenant
      ? await provisionNewTenantForUser(peekEmail.split("@")[0])
      : null;

    // ── Phase 3 (tx) + Phase 4 (compensate on failure or unused) ─────
    const touched: SignInTouched = {};
    // Set inside the tx when this token is the first proof of mailbox ownership
    // for an unverified account; logged after COMMIT.
    // (A holder object: TypeScript does not track assignments made inside the closure.)
    const claim: {
      counts: {
        sessions: number;
        apiKeys: number;
        pendingEmailChanges: number;
        nativeRequests: number;
        pendingInvitations: number;
        otherMembers: number;
        hadPassword: boolean;
      } | null;
      orgs: Array<{ orgName: string; members: Array<{ email: string; role: string }> }>;
    } = { counts: null, orgs: [] };
    const { user, sessionToken, isNewUser, email } = await withProvisionedTenantCleanup(
      provisioned,
      async (markUsed) =>
        settleSignIn(touched, controlDb.transaction(async (tx) => {
          // Atomically claim the token. Must be the first write in the tx so
          // that concurrent verifiers for the same token serialize on the row
          // lock. Rolls back on any downstream throw, so failed provisioning
          // or session insert does not burn the token.
          const [tokenRow] = await tx.update(magicLinkTokens)
            .set({ usedAt: new Date() })
            .where(and(
              eq(magicLinkTokens.tokenHash, tokenH),
              gt(magicLinkTokens.expiresAt, new Date()),
              isNull(magicLinkTokens.usedAt),
            ))
            .returning();

          if (!tokenRow) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid, expired, or already used link. Please request a new one.",
            });
          }

          const emailLocal = normalizeEmail(tokenRow.email);
          let isNew = false;

          // Find or create user
          // FOR UPDATE: an existing account's credentials may be revoked below, and
          // password login takes the same lock before it mints a session.
          let [user] = await tx
            .select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified, passwordHash: users.passwordHash })
            .from(users)
            .where(emailEq(users.email, emailLocal))
            .for("update")
            .limit(1);

          // Self-hosted compatibility (never queried on the cloud): in v0.9.0 every
          // password account was "never verified", the owner included. An account
          // that already holds an established membership is a member of this server,
          // not a stranger's pre-registration, so its first email-link sign-in must
          // not wipe it.
          let establishedSelfHosted = false;
          if (user && !user.emailVerified && process.env.MULTI_TENANT !== "true") {
            const [established] = await tx
              .select({ id: tenantMembers.id })
              .from(tenantMembers)
              .where(and(eq(tenantMembers.userId, user.id), inArray(tenantMembers.role, SELF_HOSTED_ESTABLISHED_ROLES)))
              .limit(1);
            establishedSelfHosted = !!established;
          }

          if (!user) {
            await enforceSelfHostedSignup(tx, emailLocal);
            isNew = true;
            const [newUser] = await tx.insert(users).values({
              email: emailLocal,
              emailVerified: true,
            }).returning({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified, passwordHash: users.passwordHash });
            user = newUser;

            // Re-check invitation using tx state (not the peek)
            const [pendingInvite] = await tx.select({ id: invitations.id })
              .from(invitations)
              .where(and(
                emailEq(invitations.email, emailLocal),
                isNull(invitations.acceptedAt),
                gt(invitations.expiresAt, new Date()),
              ))
              .limit(1);

            if (pendingInvite) {
              // Invitation pending — skip auto-tenant. If we pre-provisioned
              // based on a stale peek, cleanup will run because markUsed() is
              // never called.
            } else if (process.env.MULTI_TENANT === "true") {
              if (!provisioned) {
                // Peek said invitation pending or user existed, but tx state
                // now contradicts. Rather than provision inside the tx, ask
                // the caller to retry with a fresh link.
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Sign-in state changed — please try again.",
                });
              }
              touched.tenantId = await writeNewTenantRows(tx, user.id, provisioned);
              markUsed();
            } else {
              touched.tenantId = await getOrCreateDefaultTenant(user.id, tx);
            }
          } else if (tokenRow.userId !== null && tokenRow.userId === user.id) {
            // Operator break-glass link (`admin login-link`): the only way a token
            // can carry the user id of the very account it signs into, because
            // sendMagicLink never binds a user and requestEmailChange refuses an
            // address that already has an account. It proves nothing about the
            // mailbox, so it neither marks the email verified nor revokes anything.
          } else if (!user.emailVerified && !establishedSelfHosted) {
            // First proof of mailbox ownership for an account that existed before
            // the email was verified (password sign-up: anyone could register an
            // address they do not own). Every credential issued before this point
            // was not issued to the mailbox owner, so all of it dies now: sessions,
            // API keys, the password, and anything that could mint a new credential
            // later (a pending email change, an authorised native sign-in code).
            // Deleting sessions cascades to their access tokens.
            //
            // Which accounts: on the cloud, every unverified account. On a
            // self-hosted server only accounts WITHOUT an established membership
            // (SELF_HOSTED_ESTABLISHED_ROLES: no membership at all, e.g. registered
            // against a pending invitation, or only the legacy "member" role). Role is
            // the trust anchor there because it can only be obtained through trusted
            // paths, so an owner/admin/invited-role member who registered with a
            // password under v0.9.0 is simply marked verified (next branch) and keeps
            // their password, sessions, API keys and invitations.
            const revokedSessions = await tx.delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id });
            const revokedKeys = await tx.delete(apiKeys).where(eq(apiKeys.userId, user.id)).returning({ id: apiKeys.id });
            const revokedEmailChanges = await tx.delete(magicLinkTokens)
              .where(and(eq(magicLinkTokens.userId, user.id), isNull(magicLinkTokens.usedAt)))
              .returning({ id: magicLinkTokens.id });
            const revokedNativeRequests = await tx.delete(nativeAuthRequests)
              .where(eq(nativeAuthRequests.userId, user.id))
              .returning({ id: nativeAuthRequests.id });
            // Invitations this account issued before the proof were not issued by the
            // mailbox owner either: a pending one is a ready-made way into the
            // organisation for whoever holds its link.
            const revokedInvitations = await tx.delete(invitations)
              .where(and(eq(invitations.invitedBy, user.id), isNull(invitations.acceptedAt)))
              .returning({ id: invitations.id });
            // People who already have access to an organisation this account owns were
            // added before the proof. They are NOT removed automatically (they may be
            // legitimate); the owner is told who they are after the sign-in.
            const owned = await tx
              .select({ tenantId: tenantMembers.tenantId })
              .from(tenantMembers)
              .where(and(eq(tenantMembers.userId, user.id), inArray(tenantMembers.role, ["owner", "superadmin"])));
            const others = owned.length === 0 ? [] : await tx
              .select({ tenantId: tenantMembers.tenantId, tenantName: tenants.name, email: users.email, role: tenantMembers.role })
              .from(tenantMembers)
              .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
              .innerJoin(users, eq(users.id, tenantMembers.userId))
              .where(and(inArray(tenantMembers.tenantId, owned.map((o) => o.tenantId)), ne(tenantMembers.userId, user.id)));
            const byOrg = new Map<string, { orgName: string; members: Array<{ email: string; role: string }> }>();
            for (const m of others) {
              const org = byOrg.get(m.tenantId) ?? { orgName: m.tenantName, members: [] };
              org.members.push({ email: m.email, role: m.role });
              byOrg.set(m.tenantId, org);
            }
            claim.orgs = [...byOrg.values()];
            await tx.update(users)
              .set({ emailVerified: true, passwordHash: null, updatedAt: new Date() })
              .where(eq(users.id, user.id));
            touched.credentialsRevoked = true;
            claim.counts = {
              sessions: revokedSessions.length,
              apiKeys: revokedKeys.length,
              pendingEmailChanges: revokedEmailChanges.length,
              nativeRequests: revokedNativeRequests.length,
              pendingInvitations: revokedInvitations.length,
              otherMembers: others.length,
              hadPassword: user.passwordHash !== null,
            };
          } else {
            // Existing, already-verified user (or an established self-hosted member
            // signing in for the first time): a normal sign-in leaves every
            // credential (password, other sessions, API keys, invitations) untouched
            // and only records that the email is now verified.
            await tx.update(users)
              .set({ emailVerified: true, updatedAt: new Date() })
              .where(eq(users.id, user.id));
          }

          touched.userId = user.id;
          const sessionId = nanoid(64);
          const memberships = await tx
            .select({ tenantId: tenantMembers.tenantId })
            .from(tenantMembers)
            .where(eq(tenantMembers.userId, user.id));
          const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

          await enforceSessionLimit(user.id, tx);

          const mlNow = Date.now();
          const mlExpiresAt = new Date(mlNow + (magicLinkAuthMethod === "bearer" ? BEARER_SESSION_DURATION_MS : SESSION_DURATION_MS));
          const mlMaxExpiresAt = magicLinkAuthMethod === "bearer" ? new Date(mlNow + BEARER_MAX_SESSION_DURATION_MS) : null;

          await tx.insert(sessions).values({
            id: sessionId,
            userId: user.id,
            tenantId: resolvedTenantId,
            expiresAt: mlExpiresAt,
            maxExpiresAt: mlMaxExpiresAt,
            authMethod: magicLinkAuthMethod,
            ipAddress: getClientIpFromRequest(ctx.req),
            userAgent: ctx.req.headers.get("user-agent") || null,
          });

          return { user, sessionToken: sessionId, isNewUser: isNew, email: emailLocal };
        })),
    );

    // ── Phase 5 (cookie, outside tx) ─────────────────────────────────
    // Write Set-Cookie only after COMMIT has succeeded so the client never
    // ends up with a cookie for a rolled-back session.
    if (magicLinkAuthMethod === "cookie") {
      setSessionCookie(ctx.resHeaders, sessionToken);
    }
    // `email` is captured to keep parity with the old log surface if needed later.
    void email;

    if (claim.counts) {
      // Ids and counts only: no email, no token. Informational for operators.
      logSecurityEvent("unverified_account_claimed", {
        ip: getClientIpFromRequest(ctx.req),
        path: "/api/trpc/auth.verifyMagicLink",
        reason: "first_magic_link_verification",
        extra: { userId: user.id, ...claim.counts },
      });
      // Tell the owner who already had access. Best effort: a mail failure (or no
      // email service) must never fail the sign-in that just succeeded.
      if (claim.counts.otherMembers > 0) {
        void emailService.sendSecurityNotice(user.email, claim.orgs).catch((err) => {
          logger.warn({ err }, "Failed to send security notice after first email verification");
        });
      }
    }

    return {
      user: { id: user.id, email: user.email, name: user.name },
      sessionToken: magicLinkAuthMethod === "bearer" ? sessionToken : undefined,
      isNewUser,
      needsProfile: !user.name,
    };
  }),

  // ── Native login (system-browser handoff + PKCE) ─────────────
  nativeStart: publicProcedure.input(nativeStartSchema).mutation(async ({ input, ctx }) => {
    if (!isValidNativeRedirectUri(input.client, input.redirectUri)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid redirect URI" });
    }

    // Opportunistic cleanup of expired requests
    await controlDb.delete(nativeAuthRequests).where(lte(nativeAuthRequests.expiresAt, new Date()));

    const expiresAt = new Date(Date.now() + NATIVE_REQUEST_TTL_MS);
    const [row] = await controlDb.insert(nativeAuthRequests).values({
      client: input.client,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      state: input.state,
      expiresAt,
      ipAddress: getClientIpFromRequest(ctx.req),
    }).returning({ id: nativeAuthRequests.id });

    return { requestId: row.id, expiresAt };
  }),

  nativeRequestInfo: publicProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [row] = await controlDb
        .select({ client: nativeAuthRequests.client, expiresAt: nativeAuthRequests.expiresAt })
        .from(nativeAuthRequests)
        .where(and(
          eq(nativeAuthRequests.id, input.requestId),
          isNull(nativeAuthRequests.consumedAt),
          gt(nativeAuthRequests.expiresAt, new Date()),
        ))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Sign-in request not found" });
      return { client: row.client as "desktop" | "mobile" | "cli", expiresAt: row.expiresAt };
    }),

  nativeAuthorize: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Only an interactive browser (cookie) session may approve a native
      // sign-in; bearer sessions, access tokens and API keys cannot mint more.
      if (ctx.authTokenKind !== "cookie") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sign in with the browser to authorize this request" });
      }

      const code = generateNativeCode();
      const now = new Date();
      const [row] = await controlDb.update(nativeAuthRequests)
        .set({
          userId: ctx.user!.id,
          codeHash: sha256Hex(code),
          authorizedAt: now,
          expiresAt: new Date(now.getTime() + NATIVE_CODE_TTL_MS),
        })
        .where(and(
          eq(nativeAuthRequests.id, input.requestId),
          isNull(nativeAuthRequests.authorizedAt),
          isNull(nativeAuthRequests.consumedAt),
          gt(nativeAuthRequests.expiresAt, now),
        ))
        .returning({ redirectUri: nativeAuthRequests.redirectUri, state: nativeAuthRequests.state });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Sign-in request not found" });

      return { redirectUrl: buildNativeRedirectUrl(row.redirectUri, code, row.state) };
    }),

  nativeExchange: publicProcedure.input(nativeExchangeSchema).mutation(async ({ input, ctx }) => {
    const fail = () => new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired sign-in request" });

    const header = ctx.req.headers.get("x-hisaabo-client");
    const [request] = await controlDb.select().from(nativeAuthRequests)
      .where(eq(nativeAuthRequests.id, input.requestId))
      .limit(1);

    if (
      !request ||
      !header ||
      header !== request.client ||
      !request.codeHash ||
      !request.userId ||
      request.consumedAt ||
      request.expiresAt <= new Date() ||
      !verifyPkceS256(input.codeVerifier, request.codeChallenge)
    ) {
      throw fail();
    }

    // Atomic single-use claim: only one concurrent exchange can win
    const [claimed] = await controlDb.update(nativeAuthRequests)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(nativeAuthRequests.id, request.id),
        isNull(nativeAuthRequests.consumedAt),
        eq(nativeAuthRequests.codeHash, sha256Hex(input.code)),
        gt(nativeAuthRequests.expiresAt, new Date()),
      ))
      .returning({ userId: nativeAuthRequests.userId });
    if (!claimed?.userId) throw fail();

    const [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, claimed.userId))
      .limit(1);
    if (!user) throw fail();

    const sessionToken = await createSessionForUser(user.id, ctx, "bearer");
    return { user, sessionToken };
  }),

  // ── Complete profile (first magic link sign-in) ──────────────
  completeProfile: protectedProcedure.input(completeProfileSchema).mutation(async ({ input, ctx }) => {
    // name is embedded in every cached session / access token / API key of the
    // user: invalidate by user (all their sessions, not just this one) after
    // the write settled.
    await cacheBus.afterWrite([{ kind: "user", userId: ctx.user!.id }], () =>
      controlDb.update(users)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(users.id, ctx.user!.id)),
    );

    return { success: true };
  }),

  // ── Update name ──────────────────────────────────────────────
  updateName: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(100) }))
    .mutation(async ({ input, ctx }) => {
      // Every session of the user embeds the name: invalidate by user.
      await cacheBus.afterWrite([{ kind: "user", userId: ctx.user!.id }], () =>
        controlDb.update(users)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(users.id, ctx.user!.id)),
      );

      return { success: true };
    }),

  // ── Request email change ─────────────────────────────────────
  // The confirmation goes to the NEW address, but it only takes effect for THIS
  // account, while it is signed in (see confirmEmailChange): the mailbox owner
  // alone cannot be tricked into hijacking an account by clicking a link.
  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: z.string().email().max(255) }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const email = normalizeEmail(input.newEmail);

      const [me] = await controlDb.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      if (!me) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
      const currentEmail = normalizeEmail(me.email);

      // Check if new email is already taken
      const [existing] = await controlDb.select({ id: users.id })
        .from(users).where(emailEq(users.email, email)).limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      // Email-change tokens are the user-bound rows whose email is not the account's
      // own email (operator login-link tokens carry the account's own email, and
      // are neither counted nor touched). The rows are kept when superseded, so
      // they keep counting against the hourly limit; `ip_address` is not used to
      // tell them apart because a client can influence it.
      const emailChangeTokens = and(
        eq(magicLinkTokens.userId, userId),
        sql`lower(${magicLinkTokens.email}) <> ${currentEmail}`,
      );
      const recent = await controlDb
        .select({ id: magicLinkTokens.id })
        .from(magicLinkTokens)
        .where(and(emailChangeTokens, gt(magicLinkTokens.createdAt, new Date(Date.now() - EMAIL_CHANGE_WINDOW_MS))));
      if (recent.length >= EMAIL_CHANGE_MAX_PER_WINDOW) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many email change requests. Please try again later." });
      }

      // A new request supersedes every earlier unused one.
      await controlDb.update(magicLinkTokens)
        .set({ usedAt: new Date() })
        .where(and(emailChangeTokens, isNull(magicLinkTokens.usedAt)));

      // Generate a token for email change verification
      const rawToken = crypto.randomUUID() + "-" + nanoid(32);
      const tokenHash = hashToken(rawToken);

      await controlDb.insert(magicLinkTokens).values({
        email: email, // Store the NEW email
        tokenHash,
        // Store the requesting user's ID so confirmEmailChange doesn't trust client-supplied userId
        userId,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ipAddress: getClientIpFromRequest(ctx.req),
      });

      // Deliberately NOT under /auth/verify (installed apps intercept that path) and
      // NOT a sign-in email: it names the requesting account and says what it does.
      const baseUrl = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");
      const confirmUrl = `${baseUrl}/auth/confirm-email-change?token=${encodeURIComponent(rawToken)}`;

      await emailService.sendEmailChangeConfirmation(email, confirmUrl, currentEmail);

      return { success: true };
    }),

  // ── Confirm email change ─────────────────────────────────────
  // Requires the SESSION of the account that requested the change: possession of
  // the emailed token alone is not enough. Otherwise anyone could request a change
  // to a victim's address from an account they control, and the victim opening
  // the mail would hand that account the victim's email (and a later sign-in by
  // email link would land in the attacker's account). userId is read from the
  // token record, never from client input.
  confirmEmailChange: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const tokenH = hashToken(input.token);
      const invalid = () => new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      let changed: { oldEmail: string; newEmail: string; oldWasVerified: boolean } | null = null;

      // The email is embedded in every cached session / access token / API key of
      // the user: invalidate by user once the transaction settled.
      const newEmail = await cacheBus.afterWrite([{ kind: "user", userId }], () =>
        controlDb.transaction(async (tx) => {
          const now = new Date();
          const live = and(
            eq(magicLinkTokens.tokenHash, tokenH),
            gt(magicLinkTokens.expiresAt, now),
            isNull(magicLinkTokens.usedAt),
          );

          // Read first, write nothing: a plain magic-link token (no bound user) must
          // not be burnable here, and another account's token must stay usable by it.
          const [peek] = await tx.select().from(magicLinkTokens).where(live).limit(1);
          if (!peek || !peek.userId) throw invalid();
          if (peek.userId !== userId) {
            logSecurityEvent("email_change_wrong_account", {
              ip: getClientIpFromRequest(ctx.req),
              path: "/api/trpc/auth.confirmEmailChange",
              reason: "token_bound_to_other_account",
            });
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "This link confirms an email change for a different Hisaabo account. Sign in to that account, then open the link again.",
            });
          }

          const [me] = await tx
            .select({ email: users.email, emailVerified: users.emailVerified })
            .from(users)
            .where(eq(users.id, userId))
            .for("update")
            .limit(1);
          if (!me) throw invalid();
          // An operator login-link token carries the account's own email: not an email change.
          if (normalizeEmail(peek.email) === normalizeEmail(me.email)) throw invalid();

          // Claim atomically (single use, concurrent confirms serialise on the row).
          const [claimed] = await tx.update(magicLinkTokens)
            .set({ usedAt: now })
            .where(live)
            .returning();
          if (!claimed) throw invalid();

          // Someone may have registered the address since it was requested. Throwing
          // rolls the claim back, so the token is not burned.
          const [taken] = await tx.select({ id: users.id })
            .from(users)
            .where(and(emailEq(users.email, claimed.email), ne(users.id, userId)))
            .limit(1);
          if (taken) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });

          await tx.update(users)
            .set({ email: claimed.email, emailVerified: true, updatedAt: now })
            .where(eq(users.id, userId));

          // Any other unused user-bound token (older change requests, operator links
          // for the old address) must not outlive the change.
          await tx.delete(magicLinkTokens).where(and(eq(magicLinkTokens.userId, userId), isNull(magicLinkTokens.usedAt)));

          changed = { oldEmail: me.email, newEmail: claimed.email, oldWasVerified: me.emailVerified };
          return claimed.email;
        }),
      );

      // Tell the OLD address, but only if it had been proven to be the owner's. Best
      // effort: a mail failure must never undo or fail the change.
      const done = changed as { oldEmail: string; newEmail: string; oldWasVerified: boolean } | null;
      if (done?.oldWasVerified) {
        void emailService.sendEmailChangedNotice(done.oldEmail, done.newEmail).catch((err) => {
          logger.warn({ err }, "Failed to send email-changed notice");
        });
      }

      return { success: true, newEmail };
    }),

  // ── Logout ───────────────────────────────────────────────────
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const sessionId = getSessionIdFromContext(ctx);

    if (sessionId) {
      await cacheBus.afterWrite([{ kind: "session", sessionId }], () =>
        controlDb.delete(sessions).where(eq(sessions.id, sessionId)),
      );
    }

    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  // ── Logout all sessions ──────────────────────────────────────
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user!.id;
    // Events are emitted after BOTH deletes settled (also if one throws):
    // every session, access token and API key of the user is dropped by user.
    await cacheBus.afterWrite(
      [{ kind: "session", userId }, { kind: "apiKey", userId }],
      async () => {
        await controlDb.delete(sessions).where(eq(sessions.userId, userId));
        // "Log out everywhere" also kills every API key the user minted, in all tenants.
        await controlDb.delete(apiKeys).where(eq(apiKeys.userId, userId));
      },
    );

    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  // ── List sessions (active or expired) ───────────────────────
  listSessions: protectedProcedure
    .input(z.object({ expired: z.boolean().default(false) }).prefault({}))
    .query(async ({ input, ctx }) => {
      const currentSessionId = getSessionIdFromContext(ctx);
      const now = new Date();
      const userSessions = await controlDb
        .select({
          id: sessions.id,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(and(
          eq(sessions.userId, ctx.user!.id),
          input.expired ? lte(sessions.expiresAt, now) : gt(sessions.expiresAt, now),
        ))
        .orderBy(desc(sessions.createdAt));

      return userSessions.map(({ id, ...rest }) => ({
        ...rest,
        id: sessionHandle(id),
        isCurrent: !input.expired && id === currentSessionId,
      }));
    }),

  // ── Revoke a specific session ───────────────────────────────
  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const currentSessionId = getSessionIdFromContext(ctx);

      // The client only ever sees a hash of the session id (the id itself is the
      // bearer credential); resolve it against the caller's own sessions.
      const own = await controlDb
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, ctx.user!.id));
      const target = own.find((s) => sessionHandle(s.id) === input.sessionId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }
      if (target.id === currentSessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot revoke your current session. Use logout instead." });
      }

      await cacheBus.afterWrite([{ kind: "session", sessionId: target.id }], () =>
        controlDb
          .delete(sessions)
          .where(and(eq(sessions.id, target.id), eq(sessions.userId, ctx.user!.id))),
      );
      return { success: true };
    }),

  // ── Issue short-lived access token ──────────────────────────
  //
  // Only callable with a refresh token (session_id Bearer) or a cookie
  // session. Calling with an access token (chained refresh) is rejected —
  // access tokens cannot mint other access tokens; this closes the chain.
  //
  // Cookie-method sessions (web) are also rejected: the web app uses
  // HttpOnly cookies and never needs access tokens. Issuing one would
  // create a JS-readable token from a cookie session, undermining the
  // XSS protection of the cookie-only flow.
  issueAccessToken: protectedProcedure.mutation(async ({ ctx }) => {
    // Reject if called via an access token (chained refresh = bad)
    if (ctx.authTokenKind === "access") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot issue an access token using another access token. Use the refresh token (session_id) instead.",
      });
    }

    // Reject cookie-method sessions — web uses cookies, not Bearer.
    // Issuing an access token here would create a JS-readable credential
    // from an HttpOnly-cookie session, defeating its XSS protection.
    if (ctx.authTokenKind === "cookie") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Access tokens are only issued for Bearer sessions (mobile/desktop). Web clients use HttpOnly cookies.",
      });
    }

    // Retrieve the session row to verify it is a bearer-method session
    // and to obtain the session ID.
    const sessionId = getSessionIdFromContext(ctx);
    if (!sessionId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "No session found" });
    }

    const [session] = await controlDb
      .select({ id: sessions.id, authMethod: sessions.authMethod })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session not found" });
    }

    if (session.authMethod !== "bearer") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Access tokens are only issued for Bearer sessions.",
      });
    }

    // Generate a 64-char base64url random suffix for unguessability.
    // 48 random bytes → 64 base64url chars = 384 bits of entropy.
    const randomSuffix = randomBytes(48).toString("base64url");
    const accessTokenId = `at_${randomSuffix}`;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

    await controlDb.insert(accessTokens).values({
      id: accessTokenId,
      sessionId: session.id,
      expiresAt,
    });

    return { accessToken: accessTokenId, expiresAt };
  }),

  // ── Me ───────────────────────────────────────────────────────
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { user: null, tenantId: null, tenantName: null, role: null, needsProfile: false };

    let tenantName: string | null = null;
    let role: string | null = null;
    if (ctx.tenantId) {
      const [t] = await controlDb
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      tenantName = t?.name ?? null;

      const [membership] = await controlDb
        .select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);
      role = membership?.role ?? null;
    }

    return { user: ctx.user, tenantId: ctx.tenantId, tenantName, role, needsProfile: !ctx.user.name };
  }),
});

function setSessionCookie(headers: Headers, sessionId: string) {
  const secure = IS_SECURE ? "; Secure" : "";
  headers.set(
    "Set-Cookie",
    `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 60 * 60}`
  );
}

function clearSessionCookie(headers: Headers) {
  const secure = IS_SECURE ? "; Secure" : "";
  headers.set("Set-Cookie", `session_id=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}
