import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { getTenantDb, type TenantDatabase, controlDb, businesses, tenantMembers } from "@hisaabo/db";
import { eq, and } from "drizzle-orm";
import { defineAbilityFor, mapDbRole, type AppAbility } from "./lib/permissions.js";
import { getMaintenanceStatus } from "./lib/maintenance-cache.js";

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
export const createCallerFactory = t.createCallerFactory;

// ── CSRF check (tRPC layer) ───────────────────────────────────────────────────
// Mirrors the Hono-level CSRF middleware in `lib/csrf-middleware.ts`, but
// runs inside the tRPC request pipeline so rejections become proper
// `TRPCError`s — the tRPC HTTP link on the client can then deserialize
// the error envelope (superjson-shaped `{error: {json: {...}}}`) and
// surface a readable message instead of "Unable to transform response
// from server".
//
// WHY THIS IS NEEDED IN ADDITION TO THE HONO-LEVEL CHECK:
// The Hono middleware returns `c.json({error: "..."}, 403)`, whose shape
// the tRPC client cannot parse. Keeping that shape for non-tRPC routes
// (store REST, webhooks) is correct, but every tRPC call needs to go
// through a tRPC-aware path so the error formatter produces a
// client-parseable envelope for batched queries, mutations, and
// subscriptions alike.
//
// SAFETY MODEL (must match csrf-middleware.ts):
//   - GET/HEAD/OPTIONS: exempt (side-effect-free per HTTP convention).
//   - Bearer-authenticated (Authorization header): exempt — Bearer
//     tokens are not vulnerable to CSRF and React Native's native
//     cookie jar replays stale `session_id` cookies that must not
//     trip this check.
//   - No session cookie: exempt — nothing to protect.
//   - Otherwise: require `X-Requested-With: hisaabo` or throw
//     TRPCError({code: "FORBIDDEN"}).
const csrfCheck = t.middleware(({ ctx, next }) => {
  const req = ctx.req;
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return next();
  }

  const cookieHeader = req.headers.get("cookie");
  const hasSessionCookie = cookieHeader?.includes("session_id=") ?? false;
  if (!hasSessionCookie) {
    return next();
  }

  const xrw = req.headers.get("x-requested-with");
  if (xrw !== "hisaabo") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "CSRF validation failed",
    });
  }

  return next();
});

// Base procedure with CSRF enforcement — every procedure below inherits
// from this so the check runs on every tRPC call, including public
// endpoints like `auth.sendMagicLink` that are otherwise unauthenticated.
const baseProcedure = t.procedure.use(csrfCheck);

export const publicProcedure = baseProcedure;

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

  // Check system maintenance mode — blocks ALL users during maintenance
  const maintenance = await getMaintenanceStatus();
  if (maintenance.enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: maintenance.message || "System is under maintenance. Please try again later.",
    });
  }

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
  if (!ctx.businessId) {
    if (process.env.NODE_ENV === "development") console.log("[hasBusinessAccess] FAIL: no businessId in ctx. Headers received x-business-id:", ctx.req.headers.get("x-business-id"));
    throw new TRPCError({ code: "BAD_REQUEST", message: "No business selected" });
  }

  // Verify business exists in this tenant's database (ctx.db injected by hasTenantAccess)
  const [biz] = await (ctx as unknown as TenantCtx).db.select({
    id: businesses.id,
    createdByUserId: businesses.createdByUserId,
  })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);

  if (!biz) {
    if (process.env.NODE_ENV === "development") console.log("[hasBusinessAccess] FAIL: business not found in tenant DB. businessId:", ctx.businessId, "tenantId:", ctx.tenantId);
    throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  }

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
    if (process.env.NODE_ENV === "development") console.log("[hasBusinessAccess] FAIL: creator not a tenant member. businessId:", ctx.businessId, "createdByUserId:", biz.createdByUserId, "tenantId:", ctx.tenantId);
    throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  }

  return next({
    ctx: {
      ...ctx,
      businessId: ctx.businessId as string,
    },
  });
});

export const protectedProcedure = baseProcedure.use(isAuthenticated);
export const tenantProcedure = baseProcedure.use(isAuthenticated).use(hasTenantAccess);
export const businessProcedure = baseProcedure.use(isAuthenticated).use(hasTenantAccess).use(hasBusinessAccess);

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
export const authorizedProcedure = baseProcedure
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
