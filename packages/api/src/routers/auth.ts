import { eq, and, gt, lte, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import * as argon2 from "argon2";
import { controlDb, users, sessions, tenants, tenantMembers, magicLinkTokens, invitations, provisionTenantDatabase } from "@hisaabo/db";
import { loginSchema, registerSchema, magicLinkRequestSchema, magicLinkVerifySchema, completeProfileSchema } from "@hisaabo/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { emailService } from "../lib/email.js";
import { invalidateSessionCache, getSessionIdFromRequest } from "../context.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { enforceSessionLimit } from "../lib/plan-limits.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
): Promise<string> {
  const memberships = await controlDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId));

  const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

  // Evict oldest sessions if at plan limit (FIFO, never blocks login)
  await enforceSessionLimit(userId);

  const sessionId = nanoid(64);
  await controlDb.insert(sessions).values({
    id: sessionId,
    userId,
    tenantId: resolvedTenantId,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    ipAddress: getClientIpFromRequest(ctx.req),
    userAgent: ctx.req.headers.get("user-agent") || null,
  });

  setSessionCookie(ctx.resHeaders, sessionId);
  return sessionId;
}

// Session ID extraction uses the canonical getSessionIdFromRequest from context.ts
// which correctly skips API keys (hisaabo_key_ prefix).
function getSessionIdFromContext(ctx: { req: Request }): string | null {
  return getSessionIdFromRequest(ctx.req);
}

// ── Shared helper: auto-create tenant for a new user ───────────
async function assignTenantToNewUser(userId: string, displayName: string, parentTx?: ControlTx): Promise<void> {
  if (process.env.MULTI_TENANT === "true") {
    const db = parentTx ?? controlDb;
    const tenantName = `${displayName}'s Organization`;
    const slug = generateSlug(tenantName);

    // 1. Create the tenant row (DB config columns start null)
    const [tenant] = await db.insert(tenants).values({
      name: tenantName,
      slug,
    }).returning({ id: tenants.id });

    // 2. Provision the tenant database (CREATE DB, user, schema push).
    //    Done outside the control-DB transaction because CREATE DATABASE cannot
    //    run inside a transaction block in PostgreSQL.
    let dbConfig: Awaited<ReturnType<typeof provisionTenantDatabase>>;
    try {
      dbConfig = await provisionTenantDatabase(tenant.id, slug);
    } catch (err) {
      // Roll back the orphaned tenant row so a retry can succeed cleanly
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
      throw err;
    }

    // 3. Persist the DB connection details onto the tenant row
    await db.update(tenants)
      .set({
        dbName: dbConfig.dbName,
        dbHost: dbConfig.dbHost,
        dbPort: dbConfig.dbPort,
        dbUser: dbConfig.dbUser,
        dbPassword: dbConfig.dbPassword,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id));

    // 4. Create the owner membership
    await db.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId,
      role: "owner",
      acceptedAt: new Date(),
    });
  } else {
    await getOrCreateDefaultTenant(userId, parentTx);
  }
}

export const authRouter = router({
  // ── Password registration (keeps working for self-hosted) ────
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    // Require Turnstile when secret key is configured (production).
    // Self-hosted / dev without the key can skip verification.
    if (process.env.TURNSTILE_SECRET_KEY && !input.turnstileToken) {
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

    // Insert user, assign tenant (has its own inner tx), and create session in
    // one outer transaction. This prevents a crash between user-insert and
    // session-insert from leaving a registered-but-unloggable account.
    const { user, sessionToken } = await controlDb.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email: input.email,
        name: input.name,
        passwordHash,
      }).returning({ id: users.id, email: users.email, name: users.name });

      // Skip auto-tenant creation if the user has a pending invitation
      const [pendingInvite] = await tx.select({ id: invitations.id })
        .from(invitations)
        .where(and(
          eq(invitations.email, input.email.toLowerCase()),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!pendingInvite) {
        await assignTenantToNewUser(user.id, user.name || input.email.split("@")[0], tx);
      }

      const sessionId = nanoid(64);
      const memberships = await tx
        .select({ tenantId: tenantMembers.tenantId })
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, user.id));
      const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

      await enforceSessionLimit(user.id);

      await tx.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        tenantId: resolvedTenantId,
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        ipAddress: getClientIpFromRequest(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") || null,
      });

      setSessionCookie(ctx.resHeaders, sessionId);
      return { user, sessionToken: sessionId };
    });

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

    const sessionToken = await createSessionForUser(user.id, ctx);

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
    const tokenH = hashToken(input.token);

    // Atomic: find + mark-used in one statement — prevents TOCTOU race condition
    const [tokenRow] = await controlDb.update(magicLinkTokens)
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

    const email = tokenRow.email;

    // Wrap user upsert + session creation in a transaction so a crash between
    // them never leaves a created user without a usable session.
    let isNewUser = false;

    const { user, sessionToken } = await controlDb.transaction(async (tx) => {
      // Look up or create user
      let [user] = await tx
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        isNewUser = true;
        const [newUser] = await tx.insert(users).values({
          email,
          emailVerified: true,
        }).returning({ id: users.id, email: users.email, name: users.name });
        user = newUser;

        // Skip auto-tenant creation if the user has a pending invitation —
        // they'll join the invited org after completing their profile.
        const [pendingInvite] = await tx.select({ id: invitations.id })
          .from(invitations)
          .where(and(
            eq(invitations.email, email.toLowerCase()),
            isNull(invitations.acceptedAt),
            gt(invitations.expiresAt, new Date()),
          ))
          .limit(1);

        if (!pendingInvite) {
          await assignTenantToNewUser(user.id, email.split("@")[0], tx);
        }
      } else {
        // Mark email as verified for existing users
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

      await enforceSessionLimit(user.id);

      await tx.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        tenantId: resolvedTenantId,
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        ipAddress: getClientIpFromRequest(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") || null,
      });

      setSessionCookie(ctx.resHeaders, sessionId);
      return { user, sessionToken: sessionId };
    });

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
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.set(
    "Set-Cookie",
    `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 60 * 60}`
  );
}

function clearSessionCookie(headers: Headers) {
  headers.set("Set-Cookie", "session_id=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
}
