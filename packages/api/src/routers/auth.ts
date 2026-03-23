import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as argon2 from "argon2";
import { db, users, sessions } from "@billbook/db";
import { loginSchema, registerSchema } from "@billbook/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const authRouter = router({
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing.length > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const [user] = await db.insert(users).values({
      email: input.email,
      name: input.name,
      passwordHash,
    }).returning({ id: users.id, email: users.email, name: users.name });

    const sessionId = nanoid(64);
    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
      userAgent: ctx.req.headers.get("user-agent") || null,
    });

    setSessionCookie(ctx.resHeaders, sessionId);

    return { user: { id: user.id, email: user.email, name: user.name } };
  }),

  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    const [user] = await db
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

    const sessionId = nanoid(64);
    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      ipAddress: ctx.req.headers.get("x-forwarded-for") || null,
      userAgent: ctx.req.headers.get("user-agent") || null,
    });

    setSessionCookie(ctx.resHeaders, sessionId);

    return { user: { id: user.id, email: user.email, name: user.name } };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // Delete all sessions for this user (logout everywhere)
    await db.delete(sessions).where(eq(sessions.userId, ctx.user.id));
    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  me: publicProcedure.query(({ ctx }) => {
    return { user: ctx.user };
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
