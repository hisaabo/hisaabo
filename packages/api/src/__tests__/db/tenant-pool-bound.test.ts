/**
 * Hard bound on tenant connections (multi-tenant mode), against real Postgres.
 *
 * An evicted pool is not ended (tenant-pool-eviction.test.ts), so its
 * connections stay open until they idle out (20 s). Without a cap, a sweep over
 * many tenants through `getTenantDb` would leave one pool's worth of
 * connections behind for EVERY tenant it touched within that window, far above
 * Postgres' max_connections. The cap is TENANT_POOL_DRAINING_MAX: past it the
 * oldest draining pool is ended, so tenant connections stay within
 *
 *   (TENANT_POOL_MAX + TENANT_POOL_DRAINING_MAX) x TENANT_POOL_PER_DB_MAX.
 *
 * Here: (3 + 3) x 2 = 12, swept over 12 tenants, each touch holding 2
 * connections. Without the cap the same sweep reaches 72.
 *
 * Built to run beside other test files on a shared server: only connections to
 * this file's own databases are counted (never server-wide), the bound is
 * checked as "settles at or below the bound" with polling because Postgres
 * reaps the sockets the cap closes a moment later, and the ordering of events
 * in the second test uses a gate instead of a sleep.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTenantTestDbs, type TenantTestDbs } from "../helpers/tenant-test-dbs.js";

const TENANTS = 12;
const POOL_MAX = 3;
const DRAINING_MAX = 3;
const PER_DB_MAX = 2;
const BOUND = (POOL_MAX + DRAINING_MAX) * PER_DB_MAX;

type DbModule = typeof import("@hisaabo/db");
let mod: DbModule;
let dbs: TenantTestDbs;

const ENV_KEYS = ["MULTI_TENANT", "TENANT_POOL_MAX", "TENANT_POOL_PER_DB_MAX", "TENANT_POOL_DRAINING_MAX"] as const;
const savedEnv: Record<string, string | undefined> = {};

/** Touch a tenant and hold two connections to it at once. */
async function touch(id: string) {
  const d = await mod.getTenantDb(id);
  await Promise.all([d.execute(sql`select pg_sleep(0.05)`), d.execute(sql`select pg_sleep(0.05)`)]);
  return d;
}

// The sweep holds up to BOUND connections of its own; leave the rest of the
// server (other workers, other files) at least 3x that.
const MIN_MAX_CONNECTIONS = 4 * BOUND;

beforeAll(async () => {
  dbs = await createTenantTestDbs(TENANTS);
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.MULTI_TENANT = "true";
  process.env.TENANT_POOL_MAX = String(POOL_MAX);
  process.env.TENANT_POOL_PER_DB_MAX = String(PER_DB_MAX);
  process.env.TENANT_POOL_DRAINING_MAX = String(DRAINING_MAX);
  vi.resetModules();
  mod = await import("@hisaabo/db");
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await mod?.closeAllTenantPools();
  await mod?.closeControlClient();
  await dbs?.cleanup();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}, 60_000);

describe("tenant connection bound", () => {
  it("a sweep of many tenants through getTenantDb never exceeds (MAX + DRAINING) x PER_DB connections", async (ctx) => {
    if (dbs.maxConnections < MIN_MAX_CONNECTIONS) {
      ctx.skip(`server max_connections=${dbs.maxConnections} is below ${MIN_MAX_CONNECTIONS}, too small to run this sweep beside other tests`);
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rawPeak = 0;
    for (let round = 0; round < 3; round++) {
      for (const id of dbs.ids) {
        await touch(id);
        // Sockets the cap has just closed are reaped by Postgres a moment later,
        // so the bound is "settles within it" (10 s), not "is within it at this instant".
        // Without the cap the count stays at 24 and up for the 20 s idle window and this times out.
        rawPeak = Math.max(rawPeak, await dbs.openConnections());
        await vi.waitFor(async () => expect(await dbs.openConnections()).toBeLessThanOrEqual(BOUND), {
          timeout: 10_000,
          interval: 25,
        });
      }
    }

    // ...and the sweep did use the draining allowance (live pools alone cap at MAX x PER_DB = 6).
    expect(rawPeak).toBeGreaterThan(POOL_MAX * PER_DB_MAX);
    // Operators are told when the cap starts ending pools.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[tenant-pool]"));
  }, 180_000);

  it("ending the oldest draining pool lets work already running on it finish but fails a NEW query on it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const held = await mod.getTenantDb(dbs.ids[0]);
    await held.execute(sql`select 1`);

    // A transaction parked between two statements until the pool has been ended.
    let inTx!: () => void;
    const inTxReached = new Promise<void>((r) => (inTx = r));
    let capped!: () => void;
    const cappedDone = new Promise<void>((r) => (capped = r));
    const tx = held.transaction(async (t) => {
      await t.execute(sql`select 1`);
      inTx();
      await cappedDone;
      await t.execute(sql`select 2 as r`);
      return "finished";
    });
    await inTxReached;

    // Evict held's pool and then DRAINING_MAX more: it becomes the oldest draining pool and is ended.
    for (const id of dbs.ids.slice(1, 7)) await touch(id);
    capped();

    expect(await tx).toBe("finished");
    await expect(held.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "CONNECTION_ENDED" } });
  });
});
