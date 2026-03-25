import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { getTenantDb, type TenantDatabase, controlDb, businesses, tenantMembers } from "@hisaabo/db";
import { eq, and } from "drizzle-orm";

// ── Middleware context shape interfaces ────────────────────────
// These represent the enriched context after each middleware runs.
// Using typed casts (as unknown as TenantCtx) instead of (as any) so
// TypeScript can catch shape mismatches at the cast sites.

interface TenantCtx extends Context {
  user: NonNullable<Context["user"]>;
  tenantId: string;
  db: TenantDatabase;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error ? undefined : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

// Middleware: requires authenticated user
const isAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be logged in" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Middleware: requires tenant + injects ctx.db
const hasTenantAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!ctx.tenantId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });

  const db = await getTenantDb(ctx.tenantId);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
      db,
    },
  });
});

// Middleware: requires business selected and validates it exists in tenant DB
const hasBusinessAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.businessId) throw new TRPCError({ code: "BAD_REQUEST", message: "No business selected" });

  // Verify business exists in this tenant's database (ctx.db injected by hasTenantAccess)
  const [biz] = await (ctx as unknown as TenantCtx).db.select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);

  if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });

  return next({
    ctx: {
      ...ctx,
      businessId: ctx.businessId as string,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthenticated);
export const tenantProcedure = t.procedure.use(isAuthenticated).use(hasTenantAccess);
export const businessProcedure = t.procedure.use(isAuthenticated).use(hasTenantAccess).use(hasBusinessAccess);

// ── FINDING 4: Role-based access control ──────────────────────────────────
// Role check middleware factory
function requireRole(...allowedRoles: string[]) {
  return t.middleware(async ({ ctx, next }) => {
    // These are guaranteed non-null by businessProcedure middleware chain
    const user = ctx.user as NonNullable<Context["user"]>;
    const tenantId = ctx.tenantId as string;
    const businessId = ctx.businessId as string;

    const [membership] = await controlDb
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, user.id),
      ))
      .limit(1);

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
    }

    // Explicitly pass narrowed types so downstream procedures see string, not string | null
    return next({ ctx: { ...ctx, user, tenantId, businessId, role: membership.role } });
  });
}

// Viewers can read, everyone above can too
export const viewerProcedure = businessProcedure.use(requireRole("owner", "admin", "member", "viewer"));
// Members can mutate, admins and owners too
export const memberProcedure = businessProcedure.use(requireRole("owner", "admin", "member"));
// Only admins and owners for sensitive operations
export const adminProcedure = businessProcedure.use(requireRole("owner", "admin"));

// Re-export TenantDatabase type for use in lib functions
export type { TenantDatabase };
