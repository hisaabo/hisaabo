import { TRPCError } from "@trpc/server";
import { controlDb, tenants, tenantMembers } from "@hisaabo/db";
import { eq, and } from "drizzle-orm";

/** Roles that hold full control of a tenant. superadmin is treated as owner. */
export const OWNER_ROLES = ["owner", "superadmin"] as const;
/** Roles allowed to manage members, keys, businesses and view sensitive config. */
export const ADMIN_ROLES = ["owner", "superadmin", "admin"] as const;

export function hasRole(role: string | null | undefined, roles: readonly string[]): boolean {
  return !!role && roles.includes(role);
}

export async function getTenantRole(tenantId: string, userId: string): Promise<string | null> {
  const [membership] = await controlDb
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  return membership?.role ?? null;
}

/**
 * Single role gate for tenant-level operations. Returns the caller's role or
 * throws FORBIDDEN when they are not a member or hold none of `roles`.
 */
export async function requireTenantRole(
  ctx: { user: { id: string }; tenantId: string | null },
  roles: readonly string[],
  message = "You do not have permission to perform this action",
): Promise<string> {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });
  }
  const role = await getTenantRole(ctx.tenantId, ctx.user.id);
  if (!role || !roles.includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  return role;
}

// ── Membership / tenant-status cache ───────────────────────────────────────
// Sessions and API keys carry a tenantId that was valid when issued; this
// re-validates it on each tenant-scoped request without a DB hit every time.
const MEMBERSHIP_TTL_MS = 30_000;
const MEMBERSHIP_CACHE_MAX = 5000;
const membershipCache = new Map<string, number>();

export function invalidateMembershipCache(tenantId: string, userId?: string): void {
  if (userId) {
    membershipCache.delete(`${tenantId}:${userId}`);
    return;
  }
  for (const key of membershipCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) membershipCache.delete(key);
  }
}

/** Throws FORBIDDEN unless the user is a member of an active tenant. */
export async function assertActiveMembership(tenantId: string, userId: string): Promise<void> {
  const key = `${tenantId}:${userId}`;
  const expiry = membershipCache.get(key);
  if (expiry && Date.now() < expiry) return;

  const [row] = await controlDb
    .select({ status: tenants.status })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);

  if (!row) {
    membershipCache.delete(key);
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  }
  if (row.status !== "active") {
    membershipCache.delete(key);
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization is not active" });
  }

  if (membershipCache.size >= MEMBERSHIP_CACHE_MAX) {
    const first = membershipCache.keys().next().value;
    if (first) membershipCache.delete(first);
  }
  membershipCache.set(key, Date.now() + MEMBERSHIP_TTL_MS);
}
