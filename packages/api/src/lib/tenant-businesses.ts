/**
 * tenant-businesses.ts — Tenant-scoping helpers for the `businesses` table.
 *
 * WHY THIS FILE EXISTS:
 * The `businesses` table carries no `tenantId` column. Where one database holds
 * more than one organisation, a business belongs to a tenant transitively: its
 * `createdByUserId` is a member of that tenant. The tRPC `hasBusinessAccess`
 * middleware relies on this rule to validate the `x-business-id` header, and
 * several `business.*` procedures take the business id from their *input*
 * instead of the header, so they run on `tenantProcedure` and never pass
 * through `hasBusinessAccess`.
 *
 * WHEN THE CREATOR RULE APPLIES (see creatorRuleApplies):
 *   - CLOUD (MULTI_TENANT=true): never. Each tenant has its own database, so
 *     the database is the boundary and every business in it belongs to the
 *     tenant, including one whose creator has since been removed.
 *   - SELF-HOSTED with exactly one tenant: never, for the same reason (the one
 *     database holds one organisation).
 *   - SELF-HOSTED with several tenants: always. They share one database, so a
 *     bare `WHERE businesses.id = :id` would let any tenant read or mutate any
 *     other tenant's business. This is the rare multi-org install; until
 *     0.11.0 adds `businesses.tenant_id` its isolation relies on the rule:
 *     a business belongs to a tenant iff its creator is a member of that tenant.
 *
 * The same decision is applied in lib/authz.ts (getBusinessAccess) and
 * queue/context.ts (worker job context), so the three sites cannot disagree.
 */

import { controlDb, tenantMembers, tenants, businesses, type TenantDatabase } from "@hisaabo/db";
import { eq, and, inArray, count, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { TtlCache } from "./cache/ttl-cache.js";
import { cacheBus } from "./cache/bus.js";

/**
 * Cached "does this self-hosted database hold more than one organisation".
 *
 * TTL is short on purpose: a cached `false` relaxes the creator rule, so it must
 * not outlive the second organisation for long. In-process writers
 * (`tenant.create`, sign-up) invalidate it through the cache bus; deletes arrive
 * through the `tenants` trigger. A second organisation created by ANOTHER API
 * replica is only seen when this TTL expires.
 */
const multiOrgCache = new TtlCache<boolean>({ name: "authz.multiOrg", max: 1, ttlMs: 15_000 });

cacheBus.on("tenant", () => multiOrgCache.clear());

async function hasMultipleTenants(): Promise<boolean> {
  const [row] = await controlDb.select({ n: count() }).from(tenants);
  return (row?.n ?? 0) > 1;
}

/**
 * True when a business must also have a creator who is a member of the tenant
 * to count as that tenant's (see the file header). `fresh` bypasses the cache
 * (the queue worker runs no cache listener).
 */
export async function creatorRuleApplies(opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (process.env.MULTI_TENANT === "true") return false;
  if (opts.fresh) return hasMultipleTenants();
  return (await multiOrgCache.getOrLoad("multi", hasMultipleTenants)) ?? true;
}

/**
 * Boot-time notice for a self-hosted install with more than one organisation.
 * Never throws (a failed count only skips the notice).
 */
export async function warnIfMultiOrgSelfHosted(
  warn: (msg: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  if (process.env.MULTI_TENANT === "true") return;
  try {
    const [row] = await controlDb.select({ n: count() }).from(tenants);
    const n = row?.n ?? 0;
    if (n > 1) {
      warn(
        "Self-hosted install with more than one organisation: cross-organisation isolation of businesses relies on " +
          "the business creator being a member of the organisation until 0.11.0 adds businesses.tenant_id. " +
          "Removing the member who created a business hides that business from its organisation until they are re-added.",
        { tenants: n },
      );
    }
  } catch {
    // Informational only.
  }
}

/**
 * A Drizzle predicate restricting `businesses` to the tenant's own, or
 * `undefined` (no restriction) when the creator rule does not apply. Drop it
 * into any `businesses` WHERE clause (`and(...)` ignores `undefined`).
 *
 * An empty member list yields a predicate that matches no rows (a valid tenant
 * always has at least one member, so this only triggers on a malformed call).
 */
export async function tenantBusinessScope(tenantId: string): Promise<SQL | undefined> {
  if (!(await creatorRuleApplies())) return undefined;
  const rows = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  const memberUserIds = rows.map((r) => r.userId);
  if (memberUserIds.length === 0) return sql`false`;
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
  const scope = await tenantBusinessScope(tenantId);
  const [biz] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), scope))
    .limit(1);
  if (!biz) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }
}
