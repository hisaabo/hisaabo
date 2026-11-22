/**
 * Hourly sweep of expired idempotency claims.
 *
 * Claims are purged by the next keyed write in their business, so this only matters
 * for businesses that stop writing: it keeps the table from holding rows forever.
 * It runs from the same hourly timer that sweeps expired sessions (server.ts).
 *
 * Self-hosted: one database. Multi-tenant: every active tenant database, each visited
 * with its own single-connection client that is closed afterwards, like the other
 * per-tenant sweeps, so the sweep never cycles tenants through the shared pool cache.
 */

import { eq } from "drizzle-orm";
import { controlDb, getTenantDb, withDedicatedTenantDb, tenants } from "@hisaabo/db";
import { logger } from "./logger.js";
import { sweepExpiredIdempotencyKeys } from "./idempotency.js";

/** Sweep every tenant database; returns how many expired claims were removed in total. */
export async function sweepIdempotencyKeysEverywhere(now: Date = new Date()): Promise<number> {
  if (process.env.MULTI_TENANT !== "true") {
    return sweepExpiredIdempotencyKeys(await getTenantDb("single"), now);
  }
  let removed = 0;
  const active = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
  for (const t of active) {
    try {
      removed += await withDedicatedTenantDb(t.id, (db) => sweepExpiredIdempotencyKeys(db, now));
    } catch (err) {
      // One broken tenant must not stop the others.
      logger.error({ err, tenantId: t.id }, "[idempotency-sweep] failed for tenant");
    }
  }
  return removed;
}
