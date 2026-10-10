/**
 * authz.ts — cached authorization facts shared by every entry point
 * (tRPC middlewares, REST handlers, role gates).
 *
 *   cache        key                    value                    tags                    TTL / max
 *   membership   tenantId:userId        {role, status:"active"}  tenant:T, user:U        60s / 10000
 *   business     tenantId:businessId    {createdByUserId}        tenant:T, business:B    5min / 5000
 *
 * Rules (the "EVER" guarantee):
 *  - POSITIVE results only. A denial (no membership, inactive tenant, unknown
 *    business, creator not a member) is never stored: the next call re-queries.
 *  - Written through `getOrLoad`: a load that overlaps an invalidation is not
 *    stored, so an authz read racing a role change / member removal cannot
 *    resurrect the stale allow.
 *  - Writers emit `membership` / `tenant` / `business` / `user` events on the
 *    cache bus AFTER their write settled (and the DB triggers do the same for
 *    out-of-process writers via NOTIFY).
 *  - The business entry only holds immutable facts (existence + creator);
 *    "creator is still a member" is evaluated on every call against the
 *    membership cache, so removing the creator denies the very next call.
 */
import { TRPCError } from "@trpc/server";
import { controlDb, tenants, tenantMembers, businesses, type TenantDatabase } from "@hisaabo/db";
import { eq, and } from "drizzle-orm";
import { TtlCache } from "./cache/ttl-cache.js";
import { cacheBus } from "./cache/bus.js";

export interface Membership {
  role: string;
  status: string;
}

export const membershipCache = new TtlCache<Membership>({ name: "authz.membership", max: 10_000, ttlMs: 60_000 });
export const businessCache = new TtlCache<{ createdByUserId: string }>({
  name: "authz.business",
  max: 5000,
  ttlMs: 5 * 60_000,
});

cacheBus.on("membership", (e) => {
  // Coarse on purpose: any membership change in a tenant drops that tenant's
  // authz entries (a handful of cheap reloads beats a missed dependency).
  membershipCache.deleteByTag(`tenant:${e.tenantId}`);
  if (e.userId) membershipCache.deleteByTag(`user:${e.userId}`);
});
cacheBus.on("tenant", (e) => {
  membershipCache.deleteByTag(`tenant:${e.tenantId}`);
  businessCache.deleteByTag(`tenant:${e.tenantId}`);
});
cacheBus.on("user", (e) => {
  membershipCache.deleteByTag(`user:${e.userId}`);
});
cacheBus.on("business", (e) => {
  if (e.businessId) businessCache.deleteByTag(`business:${e.businessId}`);
  else businessCache.deleteByTag(`tenant:${e.tenantId}`);
});

/**
 * The caller's membership of `tenantId`, or null when not a member.
 * Returns the row even for a non-active tenant (so callers can tell the two
 * denials apart) but such a row is never kept in the cache.
 */
export async function getMembership(tenantId: string, userId: string): Promise<Membership | null> {
  const key = `${tenantId}:${userId}`;
  const hit = await membershipCache.getOrLoad(
    key,
    async () => {
      const [row] = await controlDb
        .select({ role: tenantMembers.role, status: tenants.status })
        .from(tenantMembers)
        .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
        .limit(1);
      return row ?? undefined;
    },
    { tags: [`tenant:${tenantId}`, `user:${userId}`] },
  );
  if (!hit) return null;
  if (hit.status !== "active") {
    // Positive-only: an inactive tenant is a denial, never cached.
    membershipCache.delete(key);
  }
  return hit;
}

export type AuthzDenial = "not_member" | "tenant_inactive" | "business_not_found" | "creator_not_member";

const DENIAL_ERRORS: Record<AuthzDenial, { message: string }> = {
  not_member: { message: "Not a member of this organization" },
  tenant_inactive: { message: "Organization is not active" },
  business_not_found: { message: "Business not found" },
  creator_not_member: { message: "Business not found" },
};

/** The TRPCError the middlewares have always thrown for each denial. */
export function authzDenialError(reason: AuthzDenial): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message: DENIAL_ERRORS[reason].message });
}

/** Active membership of an active tenant, or the denial reason. */
export async function getActiveMembership(
  tenantId: string,
  userId: string,
): Promise<{ ok: true; membership: Membership } | { ok: false; reason: "not_member" | "tenant_inactive" }> {
  const m = await getMembership(tenantId, userId);
  if (!m) return { ok: false, reason: "not_member" };
  if (m.status !== "active") return { ok: false, reason: "tenant_inactive" };
  return { ok: true, membership: m };
}

/**
 * Business belongs to the caller's tenant: it exists in the tenant DB and its
 * creator is (still) a member of `tenantId` (shared-DB self-hosted safety).
 */
export async function getBusinessAccess(
  db: TenantDatabase,
  tenantId: string,
  businessId: string,
): Promise<{ ok: true; createdByUserId: string } | { ok: false; reason: "business_not_found" | "creator_not_member" }> {
  const biz = await businessCache.getOrLoad(
    `${tenantId}:${businessId}`,
    async () => {
      const [row] = await db
        .select({ createdByUserId: businesses.createdByUserId })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      return row ?? undefined;
    },
    { tags: [`tenant:${tenantId}`, `business:${businessId}`] },
  );
  if (!biz) return { ok: false, reason: "business_not_found" };
  // Re-evaluated every call (cached positive membership, 0 queries when warm).
  const creator = await getMembership(tenantId, biz.createdByUserId);
  if (!creator) return { ok: false, reason: "creator_not_member" };
  return { ok: true, createdByUserId: biz.createdByUserId };
}

export type AuthzResult =
  | { ok: true; role: string; businessId: string | null }
  | { ok: false; reason: AuthzDenial };

/**
 * One-call authorization bundle for REST handlers (server.ts): active
 * membership of an active tenant and, when `businessId` is given, business
 * access. Same facts and same denial reasons as the tRPC middlewares.
 */
export async function getAuthz(
  db: TenantDatabase,
  args: { tenantId: string; userId: string; businessId?: string | null },
): Promise<AuthzResult> {
  const active = await getActiveMembership(args.tenantId, args.userId);
  if (!active.ok) return active;
  if (args.businessId) {
    const biz = await getBusinessAccess(db, args.tenantId, args.businessId);
    if (!biz.ok) return biz;
  }
  return { ok: true, role: active.membership.role, businessId: args.businessId ?? null };
}
