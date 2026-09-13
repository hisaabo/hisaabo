/**
 * Integration test for the admin dashboard's raw SQL.
 *
 * WHY THIS FILE EXISTS:
 * The admin dashboard (src/lib/admin) deliberately uses hand-written SQL
 * rather than Drizzle so that the same statements run through `psql` from an
 * operator's shell and through postgres.js inside the API container. The
 * price is that a schema change can silently break a query. This test runs
 * the real statements, through the real DirectRunner, against the CI test
 * database, so any column rename or dropped table fails here instead of in
 * production.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { collectPlatformStats, CONTROL_SQL, TENANT_SQL } from "../../lib/admin/stats.js";
import { DirectRunner } from "../../lib/admin/runners.js";
import { deriveAlerts } from "../../lib/admin/alerts.js";
import { renderFrame, type ViewState } from "../../lib/admin/screens.js";
import { maskStats } from "../../lib/admin/privacy.js";
import { createTestWorld, createInvoiceWithItems, createParty } from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

let runner: DirectRunner;

beforeAll(async () => {
  await truncateAllTables();
  runner = new DirectRunner(process.env.DATABASE_URL!);
  // A little real data so the aggregates have something to chew on.
  const world = await createTestWorld();
  const db = getTenantTestDb();
  const party = await createParty(db, world.business1.id, { name: "Admin SQL Customer", type: "customer" });
  await createInvoiceWithItems(db, world.business1.id, party.id, [{ itemName: "Widget", quantity: "2", unitPrice: "500.00", taxPercent: "18" }], { status: "sent" });
});

afterAll(async () => {
  await runner.close();
  await closeTestDb();
});

describe("admin dashboard SQL against the real schema", () => {
  it("CONTROL_SQL and TENANT_SQL both execute and return a JSON object", async () => {
    const control = (await runner.queryJson({ name: null }, CONTROL_SQL)) as Record<string, unknown>;
    expect(control).toBeTypeOf("object");
    expect(Array.isArray(control.tenants)).toBe(true);
    expect(control.users).toBeTypeOf("object");
    expect(control.db).toBeTypeOf("object");

    const tenant = (await runner.queryJson({ name: null }, TENANT_SQL)) as Record<string, unknown>;
    expect(tenant.summary).toBeTypeOf("object");
    expect(tenant.counts).toBeTypeOf("object");
    expect(tenant.ops).toBeTypeOf("object");
    expect(Array.isArray(tenant.monthly)).toBe(true);
  });

  it("collectPlatformStats runs end to end with no per-database errors", async () => {
    const stats = await collectPlatformStats({ runner });
    expect(stats.errors).toEqual([]);
    expect(stats.databases.failed).toBe(0);
    expect(stats.control.tenants.length).toBeGreaterThanOrEqual(1);
    expect(stats.totals.businesses).toBeGreaterThanOrEqual(1);
    expect(stats.totals.invoices).toBeGreaterThanOrEqual(1);
    expect(stats.totals.monthly).toHaveLength(12);
    expect(stats.control.db.version).toMatch(/^PostgreSQL \d+/);
    expect(stats.control.db.maxConnections).toBeGreaterThan(0);

    // Everything downstream of the SQL is pure; make sure it accepts real output.
    expect(Array.isArray(deriveAlerts(stats))).toBe(true);
    const masked = maskStats(stats);
    expect(JSON.stringify(masked)).not.toContain("Admin SQL Customer");
    for (const view of ["overview", "tenants", "ops"] as const) {
      const state: ViewState = {
        view, stats: masked, loading: false, refreshing: false, error: null, selected: 0, interactive: false,
        intervalSec: 0, nextRefreshAt: null, runnerLabel: "test", version: "test", now: new Date(), masked: true,
      };
      const frame = renderFrame(state, 140, 45);
      expect(frame).toHaveLength(45);
    }
  });
});
