import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { getTenantDb, type TenantDatabase, controlDb, businesses, tenantMembers } from "@hisaabo/db";
import { eq, and } from "drizzle-orm";
import { defineAbilityFor, mapDbRole, type AppAbility } from "./lib/permissions.js";

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
    // Never expose internal error details (DB errors, stack traces) to clients
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    return {
      ...shape,
      message: isInternal ? "Something went wrong. Please try again." : shape.message,
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
// AND that the business belongs to the caller's tenant (critical in self-hosted
// mode where all tenants share a single database).
const hasBusinessAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.businessId) throw new TRPCError({ code: "BAD_REQUEST", message: "No business selected" });

  // Verify business exists in this tenant's database (ctx.db injected by hasTenantAccess)
  const [biz] = await (ctx as unknown as TenantCtx).db.select({
    id: businesses.id,
    createdByUserId: businesses.createdByUserId,
  })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);

  if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });

  // In self-hosted mode all businesses live in the same DB. Verify the business
  // creator is a member of the caller's tenant to prevent cross-tenant access.
  const [creatorMembership] = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, ctx.tenantId as string),
      eq(tenantMembers.userId, biz.createdByUserId),
    ))
    .limit(1);

  if (!creatorMembership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  }

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

// ── CASL-based permission middleware ──────────────────────────────────────────
// Looks up the caller's membership role, maps it to the new permission role,
// builds a CASL ability object and attaches it (plus the resolved role) to ctx.
function withPermissions() {
  return t.middleware(async ({ ctx, next }) => {
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

    if (!membership) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No membership found" });
    }

    const permissionRole = mapDbRole(membership.role);
    const ability = defineAbilityFor({ userId: user.id, role: permissionRole });

    return next({
      ctx: {
        ...ctx,
        user,
        tenantId,
        businessId,
        role: permissionRole,
        ability,
      },
    });
  });
}

// All procedures that need CASL: get ability + role in context.
// Permission checks happen per-endpoint via requireCan().
export const authorizedProcedure = t.procedure
  .use(isAuthenticated)
  .use(hasTenantAccess)
  .use(hasBusinessAccess)
  .use(withPermissions());

// Keep old names as aliases for backward compatibility (avoids changing every router import)
export const viewerProcedure = authorizedProcedure;
export const memberProcedure = authorizedProcedure;
export const adminProcedure = authorizedProcedure;

// Re-export permission types so routers can import requireCan + types from trpc.js
export type { AppAbility };

// Re-export TenantDatabase type for use in lib functions
export type { TenantDatabase };
