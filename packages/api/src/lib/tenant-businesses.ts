/**
 * tenant-businesses.ts — Tenant-scoping helpers for the `businesses` table.
 *
 * WHY THIS FILE EXISTS:
 * The `businesses` table carries no `tenantId` column — a business belongs to a
 * tenant transitively: its `createdByUserId` is a member of that tenant. The
 * tRPC `hasBusinessAccess` middleware already relies on this rule to validate the
 * `x-business-id` header. But several `business.*` procedures take the business
 * id from their *input* instead of the header, so they run on `tenantProcedure`
 * and never pass through `hasBusinessAccess`.
 *
 * In CLOUD mode that is harmless: each tenant has its own database, so `ctx.db`
 * physically cannot see another tenant's businesses. In SELF-HOSTED mode every
 * tenant shares one database, so a bare `WHERE businesses.id = :id` lets any
 * tenant read or mutate any other tenant's business. These helpers re-apply the
 * same ownership rule as `hasBusinessAccess` so the business router is safe in
 * both deployment models.
 *
 * Ownership rule (must match trpc.ts hasBusinessAccess):
 *   a business belongs to a tenant iff its creator is a member of that tenant.
 */

import { controlDb, tenantMembers, businesses, type TenantDatabase } from "@hisaabo/db";
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/**
 * Returns the user ids of every member of `tenantId` (control plane).
 * Used to build the ownership predicate for the tenant-shared `businesses` table.
 */
export async function getTenantMemberUserIds(tenantId: string): Promise<string[]> {
  const rows = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  return rows.map((r) => r.userId);
}

/**
 * A Drizzle predicate restricting `businesses` to those owned by the tenant whose
 * members are `memberUserIds`. Drop this into any `businesses` WHERE clause.
 *
 * An empty list yields a predicate that matches no rows (a valid tenant always
 * has at least one member, so this only triggers on a malformed call).
 */
export function businessTenantScope(memberUserIds: string[]) {
  return inArray(businesses.createdByUserId, memberUserIds);
}

/**
 * Asserts that `businessId` belongs to `tenantId`, throwing NOT_FOUND otherwise.
 *
 * NOT_FOUND (not FORBIDDEN) is deliberate: it avoids disclosing the existence of
 * a business in another tenant. Use this in procedures that take the business id
 * from input but cannot fold the ownership predicate into their main query
 * (e.g. when the primary table is `parties`, not `businesses`).
 */
export async function assertBusinessInTenant(
  db: TenantDatabase,
  tenantId: string,
  businessId: string,
): Promise<void> {
  const memberIds = await getTenantMemberUserIds(tenantId);
  const [biz] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), businessTenantScope(memberIds)))
    .limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }
}
