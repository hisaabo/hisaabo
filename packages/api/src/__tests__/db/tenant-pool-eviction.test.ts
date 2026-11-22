/**
 * Tenant pool eviction safety (multi-tenant mode), against real Postgres.
 *
 * `getTenantDb` keeps an LRU of postgres.js clients. A request takes its `db`
 * early (the tRPC `hasTenantAccess` middleware) and may keep using it for a
 * while, so evicting the client behind a handle that is still held must not
 * break that handle: queries, transactions and queries already in flight on it
 * must all keep working. Ending the client on eviction does the opposite: in
 * postgres.js 3.4.9 `end()` makes every later pool-level query on that client
 * reject with CONNECTION_ENDED.
 *
 * The suite runs with TENANT_POOL_MAX=3 against 12 throwaway tenant databases
 * so evictions are constant, and a seeded fuzz mixes held handles, churn and
 * transactions. It is reproducible: change SEED to explore other schedules.
 *
 * MULTI_TENANT is read when `tenant-pool.ts` is evaluated, and the shared test
 * setup runs single-tenant, so the module graph is reset and re-imported here
 * with the multi-tenant environment in place.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createTenantTestDbs, type TenantTestDbs } from "../helpers/tenant-test-dbs.js";

const FUZZ_TENANTS = 12;
// One more tenant that only the withDedicatedTenantDb test touches, so its connection counts are exact.
const DEDICATED = FUZZ_TENANTS;
const TENANTS = FUZZ_TENANTS + 1;
const POOL_MAX = 3;
const PER_DB_MAX = 2;
const SEED = 0x5eed;

type DbModule = typeof import("@hisaabo/db");
let mod: DbModule;
let dbs: TenantTestDbs;
let admin: postgres.Sql;
let dbNames: string[];
let tenantIds: string[];

// TENANT_POOL_DRAINING_MAX is set high so the draining cap (tested in
// tenant-pool-bound.test.ts) never ends a pool here: these tests are about
// handles surviving plain eviction.
const ENV_KEYS = ["MULTI_TENANT", "TENANT_POOL_MAX", "TENANT_POOL_PER_DB_MAX", "TENANT_POOL_DRAINING_MAX"] as const;
const savedEnv: Record<string, string | undefined> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = () => {};

/** Small deterministic PRNG so a failing schedule can be replayed. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const urlFor = (database: string) => dbs.urlFor(database);

/** Touch `ids` in order so earlier handles fall out of a 3-entry LRU. */
async function churn(ids: string[]) {
  for (const id of ids) {
    const d = await mod.getTenantDb(id);
    await d.execute(sql`select 1`);
  }
}

const others = (except: number) => tenantIds.filter((_, i) => i !== except);

beforeAll(async () => {
  dbs = await createTenantTestDbs(TENANTS);
  admin = dbs.admin;
  dbNames = dbs.names;
  tenantIds = dbs.ids;

  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.MULTI_TENANT = "true";
  process.env.TENANT_POOL_MAX = String(POOL_MAX);
  process.env.TENANT_POOL_PER_DB_MAX = String(PER_DB_MAX);
  process.env.TENANT_POOL_DRAINING_MAX = "1000";
  vi.resetModules();
  mod = await import("@hisaabo/db");
}, 60_000);

afterAll(async () => {
  await mod?.closeAllTenantPools();
  await mod?.closeControlClient();
  await dbs?.cleanup();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}, 60_000);

describe("tenant pool eviction", () => {
  it("evicts at capacity (the held handle is no longer the cached one)", async () => {
    const held = await mod.getTenantDb(tenantIds[0]);
    await held.execute(sql`select 1`);
    expect(await mod.getTenantDb(tenantIds[0])).toBe(held); // cached while resident
    await churn(others(0).slice(0, POOL_MAX + 1));
    expect(await mod.getTenantDb(tenantIds[0])).not.toBe(held);
  });

  it("a handle taken before its pool was evicted still runs queries", async () => {
    const held = await mod.getTenantDb(tenantIds[1]);
    await held.execute(sql`select 1`);
    await churn(others(1).slice(0, POOL_MAX + 1));
    expect(await mod.getTenantDb(tenantIds[1])).not.toBe(held);

    const rows = await held.execute(sql`select current_database() as db`);
    expect(rows[0].db).toBe(dbNames[1]);
    await held.execute(sql`select 2`);
  });

  it("a handle taken before its pool was evicted can open a transaction", async () => {
    const held = await mod.getTenantDb(tenantIds[2]);
    await held.execute(sql`select 1`);
    await churn(others(2).slice(0, POOL_MAX + 1));

    const count = await held.transaction(async (tx) => {
      await tx.execute(sql`insert into kv (v) values ('after-eviction')`);
      const r = await tx.execute(sql`select count(*)::int as c from kv`);
      return r[0].c as number;
    });
    expect(count).toBe(1);

    const check = postgres(urlFor(dbNames[2]), { max: 1, onnotice: quiet });
    try {
      expect(await check`select v from kv`).toEqual([{ v: "after-eviction" }]);
    } finally {
      await check.end();
    }
  });

  it("queries in flight, and a transaction in progress, survive the eviction", async () => {
    const held = await mod.getTenantDb(tenantIds[3]);
    await held.execute(sql`select 1`);

    // Drizzle queries are lazy until awaited; start it for real before the eviction.
    const inFlight = (async () => held.execute(sql`select pg_sleep(0.6), 'done' as r`))();
    const tx = held.transaction(async (t) => {
      await t.execute(sql`insert into kv (v) values ('before')`);
      await sleep(400);
      await t.execute(sql`insert into kv (v) values ('after')`);
      return "committed";
    });
    await sleep(100);
    await churn(others(3).slice(0, POOL_MAX + 1));
    expect(await mod.getTenantDb(tenantIds[3])).not.toBe(held);

    expect((await inFlight)[0].r).toBe("done");
    expect(await tx).toBe("committed");
    // and the handle keeps working afterwards
    const rows = await held.execute(sql`select count(*)::int as c from kv`);
    expect(rows[0].c).toBe(2);
  });

  it("fuzz: held handles keep working across random evictions, in parallel", async () => {
    const rnd = mulberry32(SEED);
    const pick = () => Math.floor(rnd() * FUZZ_TENANTS);
    let usedAfterEviction = 0;
    const failures: string[] = [];

    async function request(i: number) {
      const t = pick();
      const held = await mod.getTenantDb(tenantIds[t]);
      await sleep(Math.floor(rnd() * 40)); // other requests churn the LRU meanwhile
      if ((await mod.getTenantDb(tenantIds[t])) !== held) usedAfterEviction++;
      try {
        const r = await held.execute(sql`select current_database() as db`);
        if (r[0].db !== dbNames[t]) throw new Error(`wrong database ${r[0].db} for tenant ${t}`);
        if (rnd() < 0.5) {
          await held.transaction(async (tx) => {
            await tx.execute(sql`insert into kv (v) values (${`fuzz-${i}`})`);
            if (rnd() < 0.5) await sleep(Math.floor(rnd() * 20));
            await tx.execute(sql`select count(*) from kv`);
          });
        }
      } catch (e) {
        failures.push(`req ${i} tenant ${t}: ${(e as { code?: string }).code ?? ""} ${(e as Error).message}`);
      }
    }

    for (let wave = 0; wave < 15; wave++) {
      await Promise.all(Array.from({ length: 12 }, (_, k) => request(wave * 12 + k)));
    }

    expect(usedAfterEviction).toBeGreaterThan(20); // the schedule really exercised evicted handles
    expect(failures).toEqual([]);
  }, 60_000);

  it("withDedicatedTenantDb uses one connection of its own, leaves the shared cache alone and ends its client", async () => {
    await churn(others(DEDICATED).slice(0, POOL_MAX));
    const cached = await Promise.all(others(DEDICATED).slice(0, POOL_MAX).map((id) => mod.getTenantDb(id)));

    const open = async () => {
      const r = await admin`select count(*)::int as c from pg_stat_activity where datname = ${dbNames[DEDICATED]}`;
      return r[0].c as number;
    };
    let during = 0;
    const result = await mod.withDedicatedTenantDb(tenantIds[DEDICATED], async (db) => {
      await Promise.all([db.execute(sql`select pg_sleep(0.1)`), db.execute(sql`select pg_sleep(0.1)`)]);
      during = await open();
      return db.transaction(async (tx) => {
        await tx.execute(sql`insert into kv (v) values ('dedicated')`);
        return (await tx.execute(sql`select count(*)::int as c from kv`))[0].c as number;
      });
    });
    expect(result).toBe(1);
    expect(during).toBe(1); // max: 1, however many queries it ran

    // the client was ended on the way out, so nothing lingers for it
    const deadline = Date.now() + 5_000;
    while ((await open()) > 0 && Date.now() < deadline) await sleep(50);
    expect(await open()).toBe(0);

    // the shared cache is exactly as it was: nothing evicted, nothing added
    for (const [i, id] of others(DEDICATED).slice(0, POOL_MAX).entries()) {
      expect(await mod.getTenantDb(id)).toBe(cached[i]);
    }

    // and it is ended even when `fn` throws
    await expect(mod.withDedicatedTenantDb(tenantIds[DEDICATED], async (db) => {
      await db.execute(sql`select 1`);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    const gone = Date.now() + 5_000;
    while ((await open()) > 0 && Date.now() < gone) await sleep(50);
    expect(await open()).toBe(0);
  });

  it("an evicted pool's connections drop to zero once idle, and the handle still works afterwards", async () => {
    const held = await mod.getTenantDb(tenantIds[4]);
    await Promise.all([held.execute(sql`select pg_sleep(0.2)`), held.execute(sql`select pg_sleep(0.2)`)]);
    await churn(others(4).slice(0, POOL_MAX + 1));
    expect(await mod.getTenantDb(tenantIds[4])).not.toBe(held);

    const open = async () => {
      const r = await admin`select count(*)::int as c from pg_stat_activity where datname = ${dbNames[4]}`;
      return r[0].c as number;
    };
    // The evicted pool is not ended, but its connections close on their own
    // once idle (idle_timeout 20 s) so they do not leak.
    expect(await open()).toBeGreaterThan(0);
    const deadline = Date.now() + 35_000;
    while ((await open()) > 0 && Date.now() < deadline) await sleep(500);
    expect(await open()).toBe(0);

    // ...and the held handle reconnects lazily.
    const rows = await held.execute(sql`select current_database() as db`);
    expect(rows[0].db).toBe(dbNames[4]);
  }, 60_000);

  it("self-hosted mode: withDedicatedTenantDb hands out the one long-lived pool and never ends it", async () => {
    vi.resetModules();
    process.env.MULTI_TENANT = "false";
    const single = await import("@hisaabo/db");
    try {
      const shared = await single.getTenantDb("single");
      expect(await single.withDedicatedTenantDb("ignored", async (db) => db)).toBe(shared);
      await shared.execute(sql`select 1`); // still usable afterwards
    } finally {
      await single.closeAllTenantPools();
      await single.closeControlClient();
    }
  });
});
