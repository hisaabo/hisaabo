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
 * The suite runs with TENANT_POOL_MAX=3 against throwaway tenant databases so
 * evictions are constant, and a seeded fuzz mixes held handles, churn and
 * transactions (each request's plan is drawn up front, so a schedule is
 * reproducible: change SEED to explore others).
 *
 * Built to run beside other test files on a shared server:
 *  - every database is private to this file, and connections are only ever
 *    counted per one of those databases, never server-wide;
 *  - nothing waits a fixed time for a condition: gates (promises) order the
 *    events that matter, and anything that depends on Postgres or the 20 s
 *    idle timeout is polled with a generous timeout;
 *  - what it holds open is sized from the server's max_connections (at most a
 *    quarter of them; the draining cap bounds it), and the fuzz skips with a
 *    clear message on a server too small for it, instead of failing with
 *    "too many clients".
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
// Tenants that only one test touches, so that test's connection counts are exact.
const DEDICATED = FUZZ_TENANTS;
const LINGER = FUZZ_TENANTS + 1;
const TENANTS = FUZZ_TENANTS + 2;
const POOL_MAX = 3;
const PER_DB_MAX = 2;
const WAVE = 2;
// Evicted pools allowed to keep their connections, sized from the server's
// max_connections (see beforeAll). The fuzz needs it above what it can evict
// between a request taking its handle and finishing with it: a request does 6
// cache touches at most, so the other request in its wave evicts at most 6 pools
// (FUZZ_MIN_DRAINING leaves a 2x margin). The cap itself is tested in
// tenant-pool-bound.test.ts; here it must never end a pool.
const FUZZ_MIN_DRAINING = 12;
const DRAINING_ROOM = 6; // enough for the plain eviction tests, whatever the server size
let drainingMax = 0;
const SEED = 0x5eed;

type DbModule = typeof import("@hisaabo/db");
let mod: DbModule;
let dbs: TenantTestDbs;
let admin: postgres.Sql;
let dbNames: string[];
let tenantIds: string[];

const ENV_KEYS = ["MULTI_TENANT", "TENANT_POOL_MAX", "TENANT_POOL_PER_DB_MAX", "TENANT_POOL_DRAINING_MAX"] as const;
const savedEnv: Record<string, string | undefined> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = () => {};

/** A promise and its resolver, to order events without sleeping. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

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

/** Connections open to ONE of this file's own databases. */
async function openTo(database: string): Promise<number> {
  const r = await admin`select count(*)::int as c from pg_stat_activity where datname = ${database}`;
  return r[0].c as number;
}

/** Touch `ids` in order so earlier handles fall out of a 3-entry LRU. */
async function churn(ids: string[]) {
  for (const id of ids) {
    const d = await mod.getTenantDb(id);
    await d.execute(sql`select 1`);
  }
}

/** The fuzz tenants other than `except` (never the DEDICATED/LINGER ones). */
const others = (except: number) => tenantIds.slice(0, FUZZ_TENANTS).filter((_, i) => i !== except);

beforeAll(async () => {
  dbs = await createTenantTestDbs(TENANTS);
  admin = dbs.admin;
  dbNames = dbs.names;
  tenantIds = dbs.ids;

  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.MULTI_TENANT = "true";
  process.env.TENANT_POOL_MAX = String(POOL_MAX);
  process.env.TENANT_POOL_PER_DB_MAX = String(PER_DB_MAX);
  // This file may keep at most a quarter of the server's connections open. Fuzz
  // requests run one query at a time per pool, so a pool holds one connection.
  drainingMax = Math.min(20, Math.floor(dbs.maxConnections / 4) - POOL_MAX);
  process.env.TENANT_POOL_DRAINING_MAX = String(Math.max(drainingMax, DRAINING_ROOM));
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

    // The transaction is parked between two statements until the eviction has
    // happened, so it is certainly in progress when its pool is evicted.
    const inTx = gate();
    const evicted = gate();
    const tx = held.transaction(async (t) => {
      await t.execute(sql`insert into kv (v) values ('before')`);
      inTx.open();
      await evicted.opened;
      await t.execute(sql`insert into kv (v) values ('after')`);
      return "committed";
    });
    // Drizzle queries are lazy until awaited; start it for real before the eviction.
    const inFlight = (async () => held.execute(sql`select pg_sleep(0.6), 'done' as r`))();
    await inTx.opened;

    await churn(others(3).slice(0, POOL_MAX + 1));
    expect(await mod.getTenantDb(tenantIds[3])).not.toBe(held);
    evicted.open();

    expect((await inFlight)[0].r).toBe("done");
    expect(await tx).toBe("committed");
    // and the handle keeps working afterwards
    const rows = await held.execute(sql`select count(*)::int as c from kv`);
    expect(rows[0].c).toBe(2);
  });

  it("fuzz: held handles keep working across random evictions, in parallel", async (ctx) => {
    if (drainingMax < FUZZ_MIN_DRAINING) {
      ctx.skip(
        `server max_connections=${dbs.maxConnections} is too small for the fuzz ` +
          `(needs about ${4 * (POOL_MAX + FUZZ_MIN_DRAINING)}; this file may hold a quarter of them)`,
      );
    }
    const rnd = mulberry32(SEED);
    const pickTenant = () => Math.floor(rnd() * FUZZ_TENANTS);

    // Every request's plan is drawn before anything runs, so the schedule does
    // not depend on how the event loop interleaves them.
    const plans = Array.from({ length: 80 * WAVE }, (_, i) => {
      const tenant = pickTenant();
      const churnIds = new Set<number>();
      const want = 3 + Math.floor(rnd() * 2); // 3 or 4 DIFFERENT other tenants
      while (churnIds.size < want) {
        const t = pickTenant();
        if (t !== tenant) churnIds.add(t);
      }
      return {
        i,
        tenant,
        churn: [...churnIds],
        jitterMs: Math.floor(rnd() * 20),
        useTx: rnd() < 0.5,
        txPauseMs: rnd() < 0.5 ? Math.floor(rnd() * 15) : 0,
      };
    });

    let usedAfterEviction = 0;
    const failures: string[] = [];

    async function request(p: (typeof plans)[number]) {
      const held = await mod.getTenantDb(tenantIds[p.tenant]);
      // Other tenants are served in between: with a 3-slot cache this evicts the
      // pool behind `held` unless a concurrent request happens to touch it again.
      for (const t of p.churn) await mod.getTenantDb(tenantIds[t]);
      await sleep(p.jitterMs);
      if ((await mod.getTenantDb(tenantIds[p.tenant])) !== held) usedAfterEviction++;
      try {
        const r = await held.execute(sql`select current_database() as db`);
        if (r[0].db !== dbNames[p.tenant]) throw new Error(`wrong database ${r[0].db} for tenant ${p.tenant}`);
        if (p.useTx) {
          await held.transaction(async (tx) => {
            await tx.execute(sql`insert into kv (v) values (${`fuzz-${p.i}`})`);
            if (p.txPauseMs) await sleep(p.txPauseMs);
            await tx.execute(sql`select count(*) from kv`);
          });
        }
      } catch (e) {
        failures.push(`req ${p.i} tenant ${p.tenant}: ${(e as { code?: string }).code ?? ""} ${(e as Error).message}`);
      }
    }

    for (let w = 0; w < plans.length; w += WAVE) {
      await Promise.all(plans.slice(w, w + WAVE).map(request));
    }

    expect(failures).toEqual([]);
    // the schedule really exercised handles whose pool had been evicted
    expect(usedAfterEviction).toBeGreaterThan(plans.length / 4);
  }, 120_000);

  it("withDedicatedTenantDb uses one connection of its own, leaves the shared cache alone and ends its client", async () => {
    const ids = others(DEDICATED).slice(0, POOL_MAX);
    await churn(ids);
    const cached = await Promise.all(ids.map((id) => mod.getTenantDb(id)));

    const open = () => openTo(dbNames[DEDICATED]);
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
    await vi.waitFor(async () => expect(await open()).toBe(0), { timeout: 20_000, interval: 50 });

    // the shared cache is exactly as it was: nothing evicted, nothing added
    for (const [i, id] of ids.entries()) {
      expect(await mod.getTenantDb(id)).toBe(cached[i]);
    }

    // and it is ended even when `fn` throws
    await expect(mod.withDedicatedTenantDb(tenantIds[DEDICATED], async (db) => {
      await db.execute(sql`select 1`);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await vi.waitFor(async () => expect(await open()).toBe(0), { timeout: 20_000, interval: 50 });
  });

  it("an evicted pool's connections drop to zero once idle, and the handle still works afterwards", async () => {
    const open = () => openTo(dbNames[LINGER]);
    const held = await mod.getTenantDb(tenantIds[LINGER]);
    await Promise.all([held.execute(sql`select pg_sleep(0.2)`), held.execute(sql`select pg_sleep(0.2)`)]);
    await churn(others(LINGER).slice(0, POOL_MAX + 1));
    expect(await mod.getTenantDb(tenantIds[LINGER])).not.toBe(held);

    // The evicted pool is not ended, but its connections close on their own
    // once idle (idle_timeout 20 s) so they do not leak.
    expect(await open()).toBeGreaterThan(0);
    await vi.waitFor(async () => expect(await open()).toBe(0), { timeout: 60_000, interval: 250 });

    // ...and the held handle reconnects lazily.
    const rows = await held.execute(sql`select current_database() as db`);
    expect(rows[0].db).toBe(dbNames[LINGER]);
  }, 120_000);

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
