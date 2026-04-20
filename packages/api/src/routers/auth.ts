import { eq, and, gt, lte, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { controlDb, users, sessions, tenants, tenantMembers, magicLinkTokens, invitations, accessTokens, provisionTenantDatabase, cleanupTenantDatabase, type TenantDbConfig } from "@hisaabo/db";
import { loginSchema, registerSchema, magicLinkRequestSchema, magicLinkVerifySchema, completeProfileSchema } from "@hisaabo/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { emailService } from "../lib/email.js";
import { invalidateSessionCache, getSessionIdFromRequest, revokeAllUserSessions } from "../context.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { enforceSessionLimit } from "../lib/plan-limits.js";

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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const IS_SECURE = (process.env.APP_URL || "").startsWith("https");

// Safe IP extraction from a raw Request — mirrors the logic in server.ts getClientIp().
// Prefers cf-connecting-ip (Cloudflare, strips spoofed values at CDN edge).
// Falls back to the LAST entry of x-forwarded-for (set by the closest trusted proxy).
function getClientIpFromRequest(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return null;
}

/**
 * Tauri desktop clients can't solve Cloudflare Turnstile challenges — the
 * widget rejects the `tauri.localhost` / `tauri://localhost` host. The web
 * bundle running inside Tauri sets `X-Hisaabo-Client: desktop` and we skip
 * the Turnstile gate here.
 *
 * Trade-off: the header is client-supplied and therefore spoofable. A
 * scripted attacker who sends this header bypasses Turnstile. We accept
 * that because (a) the desktop build is distributed as a signed binary,
 * (b) magic-link already has per-email rate limiting, and (c) register
 * abuse is still bounded by email validation + session creation costs.
 * If abuse materialises, add per-IP rate limiting on these endpoints.
 */
function isDesktopClient(req: Request): boolean {
  return req.headers.get("x-hisaabo-client") === "desktop";
}

/**
 * Returns true when the session being minted will be consumed as a Bearer
 * token rather than a cookie. Mobile and desktop clients carry
 * `X-Hisaabo-Client: mobile | desktop`; they never rely on Set-Cookie.
 *
 * We use the client header (not the presence of an Authorization header) as
 * the signal because at session creation time there IS no existing Bearer
 * token yet — the whole point is we are minting the very first one.
 */
function isBearerClient(req: Request): boolean {
  const client = req.headers.get("x-hisaabo-client");
  return client === "mobile" || client === "desktop";
}

// ── Shared helper: self-hosted default tenant assignment ───────
// Wrapped in a serializable transaction to prevent TOCTOU race on owner role
type ControlTx = Parameters<Parameters<typeof controlDb.transaction>[0]>[0];

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
async function createSessionForUser(
  userId: string,
  ctx: { req: Request; resHeaders: Headers },
  authMethod: "cookie" | "bearer" = "cookie",
): Promise<string> {
  const memberships = await controlDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId));

  const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

  // Evict oldest sessions if at plan limit (FIFO, never blocks login)
  await enforceSessionLimit(userId);

  const previousSessionId = getSessionIdFromRequest(ctx.req);
  if (previousSessionId && !previousSessionId.startsWith("hisaabo_key_")) {
    controlDb.delete(sessions).where(eq(sessions.id, previousSessionId)).catch(() => {});
    invalidateSessionCache(previousSessionId);
  }

  const now = Date.now();
  const sessionId = nanoid(64);

  // Bearer sessions use a 7-day sliding window with a 30-day absolute cap.
  // Cookie sessions keep the existing 30-day fixed expiry.
  const expiresAt = new Date(now + (authMethod === "bearer" ? BEARER_SESSION_DURATION_MS : SESSION_DURATION_MS));
  const maxExpiresAt = authMethod === "bearer" ? new Date(now + BEARER_MAX_SESSION_DURATION_MS) : null;

  await controlDb.insert(sessions).values({
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
  if (authMethod === "cookie") {
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
    // Desktop (Tauri) clients also skip — see isDesktopClient() doc comment.
    const registerAuthMethod: "cookie" | "bearer" = isBearerClient(ctx.req) ? "bearer" : "cookie";
    const desktop = isDesktopClient(ctx.req);
    if (process.env.TURNSTILE_SECRET_KEY && !input.turnstileToken && !desktop) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Turnstile verification required" });
    }
    if (input.turnstileToken) {
      const ip = getClientIpFromRequest(ctx.req);
      const valid = await verifyTurnstile(input.turnstileToken, ip);
      if (!valid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
      }
    }

    const existing = await controlDb.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
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
    const emailLower = input.email.toLowerCase();
    const [pendingInvitePeek] = await controlDb.select({ id: invitations.id })
      .from(invitations)
      .where(and(
        eq(invitations.email, emailLower),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ))
      .limit(1);

    const needsAutoTenant = process.env.MULTI_TENANT === "true" && !pendingInvitePeek;
    const provisioned: ProvisionedTenant | null = needsAutoTenant
      ? await provisionNewTenantForUser(input.name || input.email.split("@")[0])
      : null;

    // Insert user, assign tenant, and create session in one outer transaction.
    // On any failure (including COMMIT failure), withProvisionedTenantCleanup
    // drops the orphan physical tenant DB.
    const { user, sessionToken } = await withProvisionedTenantCleanup(
      provisioned,
      async (markUsed) =>
        controlDb.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({
            email: input.email,
            name: input.name,
            passwordHash,
          }).returning({ id: users.id, email: users.email, name: users.name });

          // Re-check invitation inside the tx (actual state, not the peek)
          const [pendingInvite] = await tx.select({ id: invitations.id })
            .from(invitations)
            .where(and(
              eq(invitations.email, emailLower),
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
            await writeNewTenantRows(tx, user.id, provisioned);
            markUsed();
          } else {
            await getOrCreateDefaultTenant(user.id, tx);
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
        }),
    );

    // Set-Cookie only after the tx has committed. If COMMIT fails, the error
    // bubbles out of withProvisionedTenantCleanup without ever reaching here,
    // so the client never gets a cookie for a rolled-back session.
    if (registerAuthMethod === "cookie") {
      setSessionCookie(ctx.resHeaders, sessionToken);
    }

    return { user: { id: user.id, email: user.email, name: user.name }, sessionToken };
  }),

  // ── Password login ───────────────────────────────────────────
  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    // Per-email rate limiting: block after too many failed attempts
    const emailKey = input.email.toLowerCase();
    const attempts = failedLoginAttempts.get(emailKey);
    if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS && Date.now() - attempts.firstAttempt < LOGIN_WINDOW_MS) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many failed login attempts. Please try again later." });
    }

    const [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    if (!user.passwordHash) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
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

    const sessionToken = await createSessionForUser(user.id, ctx, isBearerClient(ctx.req) ? "bearer" : "cookie");

    return { user: { id: user.id, email: user.email, name: user.name }, sessionToken };
  }),

  // ── Magic link: request ──────────────────────────────────────
  sendMagicLink: publicProcedure.input(magicLinkRequestSchema).mutation(async ({ input, ctx }) => {
    // Verify Turnstile token when provided (skipped in dev / self-hosted without secret key)
    if (input.turnstileToken) {
      const ip = getClientIpFromRequest(ctx.req);
      const valid = await verifyTurnstile(input.turnstileToken, ip);
      if (!valid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
      }
    }

    const email = input.email.toLowerCase();

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

    const rawToken = crypto.randomUUID() + "-" + nanoid(32);
    const tokenH = hashToken(rawToken);

    await controlDb.insert(magicLinkTokens).values({
      email,
      tokenHash: tokenH,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ipAddress: getClientIpFromRequest(ctx.req),
    });

    const baseUrl = process.env.APP_URL || "http://localhost:5173";
    const tokenParam = `token=${encodeURIComponent(rawToken)}`;

    // Primary email CTA is ALWAYS the HTTPS link — email clients (Gmail,
    // Outlook, Apple Mail, corporate gateways) strip or refuse to render
    // anchors with custom URL schemes like `hisaabo://`, treating them as
    // phishing / protocol-hijack vectors. Shipping the deep link as the
    // primary `<a href="...">` produces a plain-text, non-clickable line
    // in most inboxes.
    //
    // When the sign-in was initiated from the desktop or mobile app we
    // thread the `source` through the HTTPS URL as a query param so the
    // /auth/verify page can hand off to the native app via the `hisaabo://`
    // scheme from a real browser (where custom schemes ARE honored by the
    // OS), instead of consuming the token inside the browser session.
    const sourceSuffix =
      input.source === "desktop" || input.source === "mobile"
        ? `&source=${input.source}`
        : "";
    const webUrl = `${baseUrl}/auth/verify?${tokenParam}${sourceSuffix}`;
    const deepLinkUrl = `hisaabo://verify?${tokenParam}`;

    // Secondary is the raw deep link — some email clients do render it
    // (and it serves as a copy-paste fallback) but we no longer depend
    // on its clickability.
    const primaryUrl = webUrl;
    const secondaryUrl = deepLinkUrl;

    // Check if user already exists to send welcome vs sign-in variant
    // (API response is always { success: true } regardless — no enumeration risk)
    const [existingUser] = await controlDb.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    await emailService.sendMagicLink(email, primaryUrl, secondaryUrl, !existingUser);

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
    const peekEmailLower = peekEmail.toLowerCase();

    const [existingUserPeek] = await controlDb.select({ id: users.id })
      .from(users)
      .where(eq(users.email, peekEmail))
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
    const { user, sessionToken, isNewUser, email } = await withProvisionedTenantCleanup(
      provisioned,
      async (markUsed) =>
        controlDb.transaction(async (tx) => {
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

          const emailLocal = tokenRow.email;
          let isNew = false;

          // Find or create user
          let [user] = await tx
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.email, emailLocal))
            .limit(1);

          if (!user) {
            isNew = true;
            const [newUser] = await tx.insert(users).values({
              email: emailLocal,
              emailVerified: true,
            }).returning({ id: users.id, email: users.email, name: users.name });
            user = newUser;

            // Re-check invitation using tx state (not the peek)
            const [pendingInvite] = await tx.select({ id: invitations.id })
              .from(invitations)
              .where(and(
                eq(invitations.email, emailLocal.toLowerCase()),
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
              await writeNewTenantRows(tx, user.id, provisioned);
              markUsed();
            } else {
              await getOrCreateDefaultTenant(user.id, tx);
            }
          } else {
            // Existing user path — mark email verified
            await tx.update(users)
              .set({ emailVerified: true, updatedAt: new Date() })
              .where(eq(users.id, user.id));
          }

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
        }),
    );

    // ── Phase 5 (cookie, outside tx) ─────────────────────────────────
    // Write Set-Cookie only after COMMIT has succeeded so the client never
    // ends up with a cookie for a rolled-back session.
    if (magicLinkAuthMethod === "cookie") {
      setSessionCookie(ctx.resHeaders, sessionToken);
    }
    // `email` is captured to keep parity with the old log surface if needed later.
    void email;

    return {
      user: { id: user.id, email: user.email, name: user.name },
      sessionToken,
      isNewUser,
      needsProfile: !user.name,
    };
  }),

  // ── Complete profile (first magic link sign-in) ──────────────
  completeProfile: protectedProcedure.input(completeProfileSchema).mutation(async ({ input, ctx }) => {
    await controlDb.update(users)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(users.id, ctx.user!.id));

    // Invalidate ALL session cache entries for this user so `me` returns fresh data
    // (the cache stores by sessionId, so we need to find and clear the right entry)
    const sessionId = getSessionIdFromContext(ctx);
    if (sessionId) invalidateSessionCache(sessionId);

    return { success: true };
  }),

  // ── Update name ──────────────────────────────────────────────
  updateName: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(100) }))
    .mutation(async ({ input, ctx }) => {
      await controlDb.update(users)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(users.id, ctx.user!.id));

      // Invalidate session cache so `me` returns fresh data
      const sessionId = getSessionIdFromContext(ctx);
      if (sessionId) invalidateSessionCache(sessionId);

      return { success: true };
    }),

  // ── Request email change ─────────────────────────────────────
  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: z.string().email().max(255) }))
    .mutation(async ({ input, ctx }) => {
      const email = input.newEmail.toLowerCase();

      // Check if new email is already taken
      const [existing] = await controlDb.select({ id: users.id })
        .from(users).where(eq(users.email, email)).limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      // Generate a token for email change verification
      const rawToken = crypto.randomUUID() + "-" + nanoid(32);
      const tokenHash = hashToken(rawToken);

      await controlDb.insert(magicLinkTokens).values({
        email: email, // Store the NEW email
        tokenHash,
        // Store the requesting user's ID so confirmEmailChange doesn't trust client-supplied userId
        userId: ctx.user!.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ipAddress: getClientIpFromRequest(ctx.req),
      });

      // Send verification to new email — no userId in URL; it is bound to the token server-side
      const baseUrl = process.env.APP_URL || "http://localhost:5173";
      const verifyUrl = `${baseUrl}/auth/verify-email-change?token=${encodeURIComponent(rawToken)}`;

      await emailService.sendMagicLink(email, verifyUrl);

      return { success: true };
    }),

  // ── Confirm email change ─────────────────────────────────────
  // userId is intentionally NOT accepted from client input — it is read from the
  // server-side token record to prevent account takeover via token substitution.
  confirmEmailChange: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const tokenH = hashToken(input.token);

      // Atomic: find + mark-used
      const [tokenRow] = await controlDb.update(magicLinkTokens)
        .set({ usedAt: new Date() })
        .where(and(
          eq(magicLinkTokens.tokenHash, tokenH),
          gt(magicLinkTokens.expiresAt, new Date()),
          isNull(magicLinkTokens.usedAt),
        ))
        .returning();

      if (!tokenRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }

      // Require that this token was issued for an email-change request (has a bound userId)
      if (!tokenRow.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }

      // Update the user's email using the userId stored in the token — never from client input
      await controlDb.update(users)
        .set({ email: tokenRow.email, emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, tokenRow.userId));

      return { success: true, newEmail: tokenRow.email };
    }),

  // ── Logout ───────────────────────────────────────────────────
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const sessionId = getSessionIdFromContext(ctx);

    if (sessionId) {
      await controlDb.delete(sessions).where(eq(sessions.id, sessionId));
      invalidateSessionCache(sessionId);
    }

    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  // ── Logout all sessions ──────────────────────────────────────
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    // Fetch all session IDs before deleting so we can evict them from the in-memory cache
    const userSessions = await controlDb
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, ctx.user!.id));

    await controlDb.delete(sessions).where(eq(sessions.userId, ctx.user!.id));

    revokeAllUserSessions(ctx.user!.id);
    for (const s of userSessions) {
      invalidateSessionCache(s.id);
    }

    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  // ── List sessions (active or expired) ───────────────────────
  listSessions: protectedProcedure
    .input(z.object({ expired: z.boolean().default(false) }).default({}))
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

      return userSessions.map((s) => ({
        ...s,
        isCurrent: !input.expired && s.id === currentSessionId,
      }));
    }),

  // ── Revoke a specific session ───────────────────────────────
  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const currentSessionId = getSessionIdFromContext(ctx);
      if (input.sessionId === currentSessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot revoke your current session. Use logout instead." });
      }

      const deleted = await controlDb
        .delete(sessions)
        .where(and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, ctx.user!.id),
        ))
        .returning({ id: sessions.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      invalidateSessionCache(input.sessionId);
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
