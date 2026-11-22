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
 *   - SELF-HOSTED with exactly one tenant, and never more: never, for the same
 *     reason (the one database holds one organisation).
 *   - SELF-HOSTED with several tenants: always. They share one database, so a
 *     bare `WHERE businesses.id = :id` would let any tenant read or mutate any
 *     other tenant's business. This is the rare multi-org install; until
 *     0.11.0 adds `businesses.tenant_id` its isolation relies on the rule:
 *     a business belongs to a tenant iff its creator is a member of that tenant.
 *   - SELF-HOSTED that EVER had several tenants: always (latched). Hard-deleting
 *     a tenant row leaves its businesses in the shared database; with the rule
 *     off they would become visible to the surviving organisation. The first
 *     time more than one tenant is seen, a `system_config` row
 *     (MULTI_ORG_LATCH_KEY) records it and the rule stays on from then on, until
 *     an operator removes the row (see docs/UPGRADING.md, 0.10.1).
 *
 * The same decision is applied in lib/authz.ts (getBusinessAccess) and
 * queue/context.ts (worker job context), so the three sites cannot disagree.
 */

import { controlDb, tenantMembers, tenants, systemConfig, businesses, type TenantDatabase } from "@hisaabo/db";
import { eq, and, inArray, count, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { TtlCache } from "./cache/ttl-cache.js";
import { cacheBus } from "./cache/bus.js";
import { logger } from "./logger.js";

/** `system_config` key recording that a self-hosted database has held more than one tenant. */
export const MULTI_ORG_LATCH_KEY = "self_host_multi_org_seen";

/**
 * Cached "does the creator rule apply on this self-hosted database": more than
 * one tenant now, or ever (the latch).
 *
 * TTL is short on purpose: a cached `false` relaxes the creator rule, so it must
 * not outlive the second organisation for long. In-process writers
 * (`tenant.create`, sign-up) invalidate it through the cache bus; deletes arrive
 * through the `tenants` trigger. A second organisation created by ANOTHER API
 * replica is only seen when this TTL expires.
 */
const multiOrgCache = new TtlCache<boolean>({ name: "authz.multiOrg", max: 1, ttlMs: 15_000 });

cacheBus.on("tenant", () => multiOrgCache.clear());

/**
 * Reads the tenant count and the latch; the first time the count is above one
 * it persists the latch (best effort: if the write fails the answer for this
 * call is still "applies" and the next uncached read retries it).
 */
async function observeSelfHostedOrgs(): Promise<{ tenants: number; latched: boolean; applies: boolean }> {
  const [row] = await controlDb.select({ n: count() }).from(tenants);
  const tenantCount = row?.n ?? 0;
  const [latchRow] = await controlDb
    .select({ key: systemConfig.key })
    .from(systemConfig)
    .where(eq(systemConfig.key, MULTI_ORG_LATCH_KEY))
    .limit(1);
  let latched = !!latchRow;
  if (tenantCount > 1 && !latched) {
    try {
      // cache-guard: the latch is written only after observing the state it
      // records, so the cached answer is already "applies"; the system_config
      // trigger's NOTIFY only reaches the maintenance cache.
      await controlDb
        .insert(systemConfig)
        .values({ key: MULTI_ORG_LATCH_KEY, value: { firstSeenAt: new Date().toISOString(), tenants: tenantCount } })
        .onConflictDoNothing();
      latched = true;
      logger.warn(
        { tenants: tenantCount },
        "self-hosted database holds more than one organisation: creator-membership isolation is latched on",
      );
    } catch (err) {
      logger.error({ err }, "could not persist the multi-organisation latch; will retry");
    }
  }
  return { tenants: tenantCount, latched, applies: tenantCount > 1 || latched };
}

/**
 * True when a business must also have a creator who is a member of the tenant
 * to count as that tenant's (see the file header). `fresh` bypasses the cache
 * (the queue worker runs no cache listener).
 */
export async function creatorRuleApplies(opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (process.env.MULTI_TENANT === "true") return false;
  const load = async () => (await observeSelfHostedOrgs()).applies;
  if (opts.fresh) return load();
  return (await multiOrgCache.getOrLoad("multi", load)) ?? true;
}

/**
 * Boot-time notice for a self-hosted install with more than one organisation
 * (now or ever); also records the latch. Never throws (a failed read only
 * skips the notice).
 */
export async function warnIfMultiOrgSelfHosted(
  warn: (msg: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  if (process.env.MULTI_TENANT === "true") return;
  try {
    const { tenants: n, latched, applies } = await observeSelfHostedOrgs();
    if (applies) {
      warn(
        "Self-hosted install with more than one organisation" +
          (n > 1 ? "" : " (an earlier one was deleted)") +
          ": cross-organisation isolation of businesses relies on the business creator being a member of the " +
          "organisation until 0.11.0 adds businesses.tenant_id, and stays on once latched. Removing the member who " +
          "created a business hides that business from its organisation until they are re-added.",
        { tenants: n, latched },
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
