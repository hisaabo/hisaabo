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
 * connections. Without the cap the same sweep reaches about 24.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Touch a tenant and hold two connections to it at once. */
async function touch(id: string) {
  const d = await mod.getTenantDb(id);
  await Promise.all([d.execute(sql`select pg_sleep(0.05)`), d.execute(sql`select pg_sleep(0.05)`)]);
  return d;
}

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
  it("a sweep of many tenants through getTenantDb never exceeds (MAX + DRAINING) x PER_DB connections", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let peak = 0;
    const started = Date.now();
    for (let round = 0; round < 3; round++) {
      for (const id of dbs.ids) {
        await touch(id);
        await sleep(30); // let Postgres reap sockets the cap has just closed
        peak = Math.max(peak, await dbs.openConnections());
      }
    }
    // The whole sweep must fit inside the idle window, or idling (not the cap) would be doing the work.
    expect(Date.now() - started).toBeLessThan(15_000);

    expect(peak).toBeLessThanOrEqual(BOUND);
    // ...and the sweep did use the draining allowance (live pools alone cap at MAX x PER_DB = 6).
    expect(peak).toBeGreaterThan(POOL_MAX * PER_DB_MAX);
    // Operators are told when the cap starts ending pools.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[tenant-pool]"));
  });

  it("ending the oldest draining pool lets its in-flight query finish but fails a NEW query on it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await sleep(100);
    const held = await mod.getTenantDb(dbs.ids[0]);
    await held.execute(sql`select 1`);
    // Drizzle queries are lazy until awaited; start it for real before the eviction.
    const inFlight = (async () => held.execute(sql`select pg_sleep(1.5), 'done' as r`))();
    await sleep(100);

    // Evict held's pool and then DRAINING_MAX more: it becomes the oldest draining pool and is ended.
    for (const id of dbs.ids.slice(1, 7)) await touch(id);

    expect((await inFlight)[0].r).toBe("done");
    await expect(held.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "CONNECTION_ENDED" } });
  });
});
