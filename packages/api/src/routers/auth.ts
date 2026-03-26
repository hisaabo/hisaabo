import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import * as argon2 from "argon2";
import { controlDb, users, sessions, tenants, tenantMembers, magicLinkTokens } from "@hisaabo/db";
import { loginSchema, registerSchema, magicLinkRequestSchema, magicLinkVerifySchema, completeProfileSchema } from "@hisaabo/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { emailService } from "../lib/email.js";
import { invalidateSessionCache } from "../context.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const suffix = nanoid(6);
  return `${base}-${suffix}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── Shared helper: self-hosted default tenant assignment ───────
// Wrapped in a serializable transaction to prevent TOCTOU race on owner role
async function getOrCreateDefaultTenant(userId: string): Promise<string> {
  return await controlDb.transaction(async (tx) => {
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
  });
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

  const sessionId = nanoid(64);
  await controlDb.insert(sessions).values({
    id: sessionId,
    userId,
    tenantId: resolvedTenantId,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
    userAgent: ctx.req.headers.get("user-agent") || null,
  });

  setSessionCookie(ctx.resHeaders, sessionId);
  return sessionId;
}

// ── Shared helper: extract session ID from cookie or Bearer header ──
function getSessionIdFromContext(ctx: { req: Request }): string | null {
  const cookies = ctx.req.headers.get("cookie") || "";
  const cookieMatch = cookies.match(/(?:^|;\s*)session_id=([^;]*)/);
  if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
  const authHeader = ctx.req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

// ── Shared helper: auto-create tenant for a new user ───────────
async function assignTenantToNewUser(userId: string, displayName: string): Promise<void> {
  if (process.env.MULTI_TENANT === "true") {
    const tenantName = `${displayName}'s Organization`;
    const slug = generateSlug(tenantName);
    const [tenant] = await controlDb.insert(tenants).values({
      name: tenantName,
      slug,
    }).returning({ id: tenants.id });

    await controlDb.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId,
      role: "owner",
      acceptedAt: new Date(),
    });
  } else {
    await getOrCreateDefaultTenant(userId);
  }
}

export const authRouter = router({
  // ── Password registration (keeps working for self-hosted) ────
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
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

    const [user] = await controlDb.insert(users).values({
      email: input.email,
      name: input.name,
      passwordHash,
    }).returning({ id: users.id, email: users.email, name: users.name });

    await assignTenantToNewUser(user.id, user.name || input.email.split("@")[0]);
    const sessionToken = await createSessionForUser(user.id, ctx);

    return { user: { id: user.id, email: user.email, name: user.name }, sessionToken };
  }),

  // ── Password login ───────────────────────────────────────────
  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    const [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    if (!user.passwordHash) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

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
      ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
    });

    const baseUrl = process.env.APP_URL || "http://localhost:5173";
    const magicLinkUrl = `${baseUrl}/auth/verify?token=${encodeURIComponent(rawToken)}`;

    await emailService.sendMagicLink(email, magicLinkUrl);

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

    // Look up or create user
    let [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const [newUser] = await controlDb.insert(users).values({
        email,
        emailVerified: true,
      }).returning({ id: users.id, email: users.email, name: users.name });
      user = newUser;

      await assignTenantToNewUser(user.id, email.split("@")[0]);
    } else {
      // Mark email as verified for existing users
      await controlDb.update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    const sessionToken = await createSessionForUser(user.id, ctx);

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
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
      });

      // Send verification to new email
      const baseUrl = process.env.APP_URL || "http://localhost:5173";
      const verifyUrl = `${baseUrl}/auth/verify-email-change?token=${encodeURIComponent(rawToken)}&userId=${ctx.user!.id}`;

      await emailService.sendMagicLink(email, verifyUrl);

      return { success: true };
    }),

  // ── Confirm email change ─────────────────────────────────────
  confirmEmailChange: publicProcedure
    .input(z.object({ token: z.string(), userId: z.string().uuid() }))
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

      // Update the user's email
      await controlDb.update(users)
        .set({ email: tokenRow.email, emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, input.userId));

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
    await controlDb.delete(sessions).where(eq(sessions.userId, ctx.user!.id));
    clearSessionCookie(ctx.resHeaders);
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
