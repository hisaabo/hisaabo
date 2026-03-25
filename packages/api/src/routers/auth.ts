import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as argon2 from "argon2";
import { controlDb, users, sessions, tenants, tenantMembers } from "@hisaabo/db";
import { loginSchema, registerSchema } from "@hisaabo/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

export const authRouter = router({
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

    let tenantId: string;

    if (process.env.MULTI_TENANT === "true") {
      // Cloud mode: create a new tenant for this user
      const tenantName = `${user.name}'s Organization`;
      const slug = generateSlug(tenantName);

      const [tenant] = await controlDb.insert(tenants).values({
        name: tenantName,
        slug,
      }).returning({ id: tenants.id });

      await controlDb.insert(tenantMembers).values({
        tenantId: tenant.id,
        userId: user.id,
        role: "owner",
        acceptedAt: new Date(),
      });

      tenantId = tenant.id;
    } else {
      // Self-hosted mode: find or create the default tenant
      const existing = await controlDb
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, "default"))
        .limit(1);

      let defaultTenantId: string;

      if (existing.length > 0) {
        defaultTenantId = existing[0].id;
      } else {
        const [newTenant] = await controlDb.insert(tenants).values({
          name: "Default Organization",
          slug: "default",
        }).returning({ id: tenants.id });
        defaultTenantId = newTenant.id;
      }

      // First user becomes owner, subsequent users become members
      const memberCount = await controlDb
        .select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(eq(tenantMembers.tenantId, defaultTenantId));

      const role = memberCount.length === 0 ? "owner" : "member";

      await controlDb.insert(tenantMembers).values({
        tenantId: defaultTenantId,
        userId: user.id,
        role,
        acceptedAt: new Date(),
      });

      tenantId = defaultTenantId;
    }

    const sessionId = nanoid(64);
    await controlDb.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      tenantId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
      userAgent: ctx.req.headers.get("user-agent") || null,
    });

    setSessionCookie(ctx.resHeaders, sessionId);

    return { user: { id: user.id, email: user.email, name: user.name } };
  }),

  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    const [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    // Look up tenant memberships
    const memberships = await controlDb
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id));

    let resolvedTenantId: string | null = null;

    if (memberships.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Account has no organization membership" });
    } else if (memberships.length === 1) {
      resolvedTenantId = memberships[0].tenantId;
    } else {
      // Multiple memberships — frontend will show tenant picker
      resolvedTenantId = null;
    }

    const sessionId = nanoid(64);
    await controlDb.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      tenantId: resolvedTenantId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
      userAgent: ctx.req.headers.get("user-agent") || null,
    });

    setSessionCookie(ctx.resHeaders, sessionId);

    return { user: { id: user.id, email: user.email, name: user.name } };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // Delete only the current session (not all sessions — FINDING 8)
    const cookies = ctx.req.headers.get("cookie") || "";
    const sessionMatch = cookies.match(/(?:^|;\s*)session_id=([^;]*)/);
    const sessionId = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;

    if (sessionId) {
      await controlDb.delete(sessions).where(eq(sessions.id, sessionId));
    }

    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { user: null, tenantId: null, tenantName: null };

    let tenantName: string | null = null;
    if (ctx.tenantId) {
      const [t] = await controlDb
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      tenantName = t?.name ?? null;
    }

    return { user: ctx.user, tenantId: ctx.tenantId, tenantName };
  }),
});

function setSessionCookie(headers: Headers, sessionId: string) {
  headers.set(
    "Set-Cookie",
    `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${30 * 24 * 60 * 60}`
  );
}

function clearSessionCookie(headers: Headers) {
  headers.set("Set-Cookie", "session_id=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
}
