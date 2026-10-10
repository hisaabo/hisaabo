import { TRPCError } from "@trpc/server";
import { getMembership, getActiveMembership, authzDenialError } from "./authz.js";

/** Roles that hold full control of a tenant. superadmin is treated as owner. */
export const OWNER_ROLES = ["owner", "superadmin"] as const;
/** Roles allowed to manage members, keys, businesses and view sensitive config. */
export const ADMIN_ROLES = ["owner", "superadmin", "admin"] as const;

export function hasRole(role: string | null | undefined, roles: readonly string[]): boolean {
  return !!role && roles.includes(role);
}

/**
 * Role of `userId` in `tenantId` (null = not a member). Read through the shared
 * authz cache (lib/authz.ts) so role gates, CASL and the tenant/business
 * middlewares always see one value; invalidated by `membership` events.
 */
export async function getTenantRole(tenantId: string, userId: string): Promise<string | null> {
  const m = await getMembership(tenantId, userId);
  return m?.role ?? null;
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

/**
 * Throws FORBIDDEN unless the user is a member of an active tenant. Sessions
 * and API keys carry a tenantId that was valid when issued; this re-validates
 * it per request from the positive-only authz cache (lib/authz.ts).
 */
export async function assertActiveMembership(tenantId: string, userId: string): Promise<void> {
  const r = await getActiveMembership(tenantId, userId);
  if (!r.ok) throw authzDenialError(r.reason);
}
