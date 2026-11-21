/**
 * Connection bounds and timeouts for the admin dashboard (P0: it is pointed at
 * a multi-tenant install with hundreds of tenant databases while the live API
 * shares the same Postgres max_connections).
 *
 * DB-free: a fake runner / fake postgres.js factory counts how many
 * connections are open at once across a pass over 50 tenant databases, and a
 * database that never answers proves a hung tenant cannot stall the refresh.
 */

import { describe, it, expect } from "vitest";
import {
  collectPlatformStats, clampConcurrency, resolveConcurrency, withQueryTimeout,
  CONTROL_SQL, MAX_CONCURRENCY, DEFAULT_CONCURRENCY, DOCKER_CONCURRENCY,
  type SqlRunner, type DbTarget,
} from "../lib/admin/stats.js";
import { QUEUE_PROBE_SQL } from "../lib/admin/queues.js";
import { DirectRunner, DockerPsqlRunner, DEFAULT_STATEMENT_TIMEOUT_MS, type PgConnect } from "../lib/admin/runners.js";

const NOW = new Date("2026-09-12T10:00:00Z");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function controlJson(tenantCount: number) {
  return {
    tenants: Array.from({ length: tenantCount }, (_, i) => ({
      id: `t${i}`, name: `Tenant ${i}`, slug: `t${i}`, plan: "pro", status: "active",
      db_name: `tenant_${String(i).padStart(3, "0")}`, db_host: null, db_port: null,
      created_at: "2026-08-01T00:00:00Z", members: 1,
    })),
    users: { total: 1, verified: 1, new_7d: 0, new_30d: 0 },
    sessions: { active: 0, used_24h: 0, web: 0, bearer: 0 },
    api_keys: { total: 0, active: 0, used_7d: 0 },
    pending_invitations: 0,
    maintenance: { enabled: false, message: "", startsAt: null, endsAt: null },
    recent_users: [],
    db: { name: "hisaabo", version: "PostgreSQL 16.4", size_pretty: "1 MB", total_size_pretty: "1 MB", connections: 3, max_connections: 100, databases: tenantCount + 1, uptime_seconds: 10 },
  };
}

const tenantJson = {
  summary: { invoices: 1, sales_invoices: 1, purchase_invoices: 0, other_documents: 0, invoices_7d: 0, invoices_30d: 1, sales_total: 100, purchase_total: 0, receivable: 0, payable: 0, e_invoices: 0, last_invoice_at: null },
  by_status: [],
  monthly: [],
  counts: { businesses: 1, gst_businesses: 0, stores_enabled: 0, parties: 0, items: 0, payments: 0, payments_total: 0, expenses: 0, expenses_total: 0, store_orders: 0, store_orders_total: 0 },
};

function answer(sql: string, tenantCount: number): unknown {
  if (sql === CONTROL_SQL) return controlJson(tenantCount);
  if (sql === QUEUE_PROBE_SQL) return { installed: false };
  return tenantJson;
}

// ── Pass-level bound, runner-agnostic ───────────────────────────

/** Models a runner that keeps a connection per tenant database until it is released. */
class CountingRunner implements SqlRunner {
  open = new Set<string>();
  peak = 0;
  opened = 0;
  released: { name: string | null; force: boolean }[] = [];
  constructor(private readonly tenants: number, private readonly behaviour: (name: string | null, sql: string) => Promise<unknown> | undefined = () => undefined) {}
  describe() { return "fake"; }
  async queryJson(target: DbTarget, sql: string): Promise<unknown> {
    const key = target.name ?? "control";
    if (!this.open.has(key)) {
      this.open.add(key);
      this.opened++;
      // Peak over TENANT connections only; the control connection is the "+1".
      const tenantOpen = [...this.open].filter((k) => k !== "control").length;
      this.peak = Math.max(this.peak, tenantOpen);
    }
    await sleep(2);
    const special = this.behaviour(target.name, sql);
    if (special) return special;
    return answer(sql, this.tenants);
  }
  async release(target: DbTarget, opts?: { force?: boolean }) {
    this.released.push({ name: target.name, force: Boolean(opts?.force) });
    this.open.delete(target.name ?? "control");
  }
  async close() { this.open.clear(); }
}

describe("a pass over many tenant databases", () => {
  it("never has more than `concurrency` tenant connections open, and closes each as it finishes", async () => {
    const runner = new CountingRunner(50);
    const st = await collectPlatformStats({ runner, concurrency: 4, now: () => NOW });
    expect(st.databases).toEqual({ queried: 50, failed: 0 });
    expect(runner.opened).toBe(50 + 1); // 50 tenants once each + control
    expect(runner.peak).toBeGreaterThan(1); // it really ran in parallel
    expect(runner.peak).toBeLessThanOrEqual(4);
    // after the pass only the (single) control connection can remain
    expect([...runner.open].filter((k) => k !== "control")).toEqual([]);
    expect(runner.released.filter((r) => r.name !== null)).toHaveLength(50);
  });

  it("honours a smaller bound and caps an absurd one", async () => {
    const small = new CountingRunner(20);
    await collectPlatformStats({ runner: small, concurrency: 2, now: () => NOW });
    expect(small.peak).toBeLessThanOrEqual(2);

    const big = new CountingRunner(60);
    await collectPlatformStats({ runner: big, concurrency: 500, now: () => NOW });
    expect(big.peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });

  it("releases a tenant even when its query fails", async () => {
    const runner = new CountingRunner(10, (name, sql) => (name === "tenant_003" && sql !== CONTROL_SQL ? Promise.reject(new Error("boom")) : undefined));
    const st = await collectPlatformStats({ runner, concurrency: 3, now: () => NOW });
    expect(st.databases.failed).toBe(1);
    expect([...runner.open].filter((k) => k !== "control")).toEqual([]);
  });

  it("concurrency defaults: 4 direct, 2 docker, an explicit value wins, always clamped", () => {
    expect(DEFAULT_CONCURRENCY).toBe(4);
    expect(DOCKER_CONCURRENCY).toBe(2);
    expect(resolveConcurrency(null, "direct")).toBe(4);
    expect(resolveConcurrency(null, "docker")).toBe(2);
    expect(resolveConcurrency(7, "docker")).toBe(7);
    expect(resolveConcurrency(9999, "direct")).toBe(MAX_CONCURRENCY);
    expect(clampConcurrency(0)).toBe(DEFAULT_CONCURRENCY);
    expect(clampConcurrency(Number.NaN)).toBe(DEFAULT_CONCURRENCY);
    expect(clampConcurrency(3.9)).toBe(3);
  });
});

// ── Timeouts ────────────────────────────────────────────────────

describe("a database that never answers", () => {
  it("fails that tenant as a timeout and the pass still completes quickly", async () => {
    const hang = (name: string | null, sql: string) => (name === "tenant_007" && sql !== CONTROL_SQL ? new Promise<unknown>(() => undefined) : undefined);
    const runner = new CountingRunner(30, hang);
    const started = Date.now();
    const st = await collectPlatformStats({ runner, concurrency: 4, queryTimeoutMs: 150, now: () => NOW });
    const took = Date.now() - started;

    expect(took).toBeLessThan(3_000);
    expect(st.databases).toEqual({ queried: 30, failed: 1 });
    const hung = st.tenants.find((t) => t.dbName === "tenant_007")!;
    expect(hung.metrics).toBeNull();
    expect(hung.error).toMatch(/^timeout/);
    expect(st.tenants.filter((t) => t.metrics)).toHaveLength(29);
    expect(st.errors).toHaveLength(1);
    // the hung connection was force-dropped, and nothing is left open
    expect(runner.released.some((r) => r.name === "tenant_007" && r.force)).toBe(true);
    expect([...runner.open].filter((k) => k !== "control")).toEqual([]);
  });

  it("a late rejection after the deadline is swallowed (no unhandled rejection)", async () => {
    const late = (name: string | null, sql: string) =>
      name === "tenant_001" && sql !== CONTROL_SQL ? sleep(300).then(() => Promise.reject(new Error("too late"))) : undefined;
    const st = await collectPlatformStats({ runner: new CountingRunner(3, late), concurrency: 2, queryTimeoutMs: 100, now: () => NOW });
    expect(st.tenants.find((t) => t.dbName === "tenant_001")?.error).toMatch(/^timeout/);
    await sleep(400); // vitest fails the run on an unhandled rejection
  });

  it("a hung control database fails the refresh and force-drops the control connection", async () => {
    const runner = new CountingRunner(2, (name, sql) => (sql === CONTROL_SQL ? new Promise<unknown>(() => undefined) : undefined));
    await expect(collectPlatformStats({ runner, queryTimeoutMs: 100, now: () => NOW })).rejects.toThrow(/timeout/);
    expect(runner.released).toContainEqual({ name: null, force: true });
  });

  it("withQueryTimeout passes results and errors through untouched", async () => {
    const ok: SqlRunner = { describe: () => "x", close: async () => undefined, queryJson: async () => ({ a: 1 }) };
    expect(await withQueryTimeout(ok, 1000).queryJson({ name: null }, "select 1")).toEqual({ a: 1 });
    const bad: SqlRunner = { describe: () => "x", close: async () => undefined, queryJson: async () => { throw new Error("nope"); } };
    await expect(withQueryTimeout(bad, 1000).queryJson({ name: null }, "select 1")).rejects.toThrow("nope");
  });
});

// ── DirectRunner with a fake postgres.js ────────────────────────

interface FakePool { url: string; options: Record<string, unknown>; ended: boolean; endCalls: (number | undefined)[] }

function fakePostgres(tenants: number, opts: { hang?: string } = {}) {
  const pools: FakePool[] = [];
  let peak = 0;
  const live = () => pools.filter((p) => !p.ended).length;
  const connect: PgConnect = (url, options) => {
    const pool: FakePool = { url, options, ended: false, endCalls: [] };
    pools.push(pool);
    peak = Math.max(peak, live());
    return {
      async unsafe(sql: string) {
        if (pool.ended) throw new Error("CONNECTION_ENDED");
        await sleep(2);
        if (opts.hang && new URL(url).pathname === `/${opts.hang}` && sql !== CONTROL_SQL) return new Promise<unknown[]>(() => undefined);
        return [{ data: answer(sql, tenants) }];
      },
      async end(o?: { timeout?: number }) {
        pool.endCalls.push(o?.timeout);
        pool.ended = true;
      },
    };
  };
  return { connect, pools, live, peak: () => peak };
}

describe("DirectRunner connection discipline", () => {
  const URL_ = "postgresql://hisaabo:secret@db.internal:5432/hisaabo";

  it("holds at most concurrency + 1 connections across 50 tenant databases and leaves only control open", async () => {
    const fake = fakePostgres(50);
    const runner = new DirectRunner(URL_, { connect: fake.connect });
    const st = await collectPlatformStats({ runner, concurrency: 4, now: () => NOW });

    expect(st.databases).toEqual({ queried: 50, failed: 0 });
    expect(fake.peak()).toBeLessThanOrEqual(4 + 1);
    expect(fake.peak()).toBeGreaterThan(1);
    // each tenant got its own pool, opened once, and every one of them is closed
    const tenantPools = fake.pools.filter((p) => new URL(p.url).pathname !== "/hisaabo");
    expect(tenantPools).toHaveLength(50);
    expect(tenantPools.every((p) => p.ended)).toBe(true);
    expect(fake.live()).toBe(1); // the control connection
    expect(runner.openPools).toBe(1);

    await runner.close();
    expect(fake.live()).toBe(0);
    expect(runner.openPools).toBe(0);
  });

  it("opens single-connection pools with connect and statement timeouts", async () => {
    const fake = fakePostgres(3);
    const runner = new DirectRunner(URL_, { connect: fake.connect, statementTimeoutMs: 7_000, connectTimeoutSec: 4 });
    await collectPlatformStats({ runner, now: () => NOW });
    expect(fake.pools.length).toBeGreaterThan(3);
    for (const p of fake.pools) {
      expect(p.options.max).toBe(1);
      expect(p.options.connect_timeout).toBe(4);
      expect(p.options.idle_timeout).toBeGreaterThan(0);
      expect(p.options.connection).toMatchObject({ statement_timeout: "7000", application_name: "hisaabo-admin" });
    }
    expect(DEFAULT_STATEMENT_TIMEOUT_MS).toBe(15_000);
    await runner.close();
  });

  it("never closes the shared control connection from a tenant release, but force does", async () => {
    const fake = fakePostgres(1);
    const runner = new DirectRunner(URL_, { connect: fake.connect });
    await runner.queryJson({ name: null }, CONTROL_SQL);
    await runner.release({ name: null });
    expect(fake.live()).toBe(1);
    await runner.release({ name: null }, { force: true });
    expect(fake.live()).toBe(0);
    expect(fake.pools[0].endCalls).toEqual([0]); // forced: no grace period
    await runner.queryJson({ name: null }, CONTROL_SQL); // reconnects on demand
    expect(fake.live()).toBe(1);
    await runner.close();
  });

  it("a hung tenant is dropped on the deadline and the pass completes", async () => {
    const fake = fakePostgres(12, { hang: "tenant_004" });
    const runner = new DirectRunner(URL_, { connect: fake.connect });
    const started = Date.now();
    const st = await collectPlatformStats({ runner, concurrency: 4, queryTimeoutMs: 150, now: () => NOW });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(st.databases).toEqual({ queried: 12, failed: 1 });
    expect(st.tenants.find((t) => t.dbName === "tenant_004")?.error).toMatch(/^timeout/);
    const hungPool = fake.pools.find((p) => new URL(p.url).pathname === "/tenant_004")!;
    expect(hungPool.ended).toBe(true);
    expect(fake.live()).toBe(1);
    await runner.close();
    expect(fake.live()).toBe(0);
  });

  it("maps a statement_timeout cancellation to a timeout error", async () => {
    const connect: PgConnect = () => ({
      unsafe: async () => { throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }); },
      end: async () => undefined,
    });
    const runner = new DirectRunner(URL_, { connect, statementTimeoutMs: 15_000 });
    await expect(runner.queryJson({ name: null }, "select 1")).rejects.toThrow("timeout: query exceeded 15s");
    await runner.close();
  });

  it("close() ends in-flight pools and refuses to open new ones", async () => {
    const fake = fakePostgres(5);
    const runner = new DirectRunner(URL_, { connect: fake.connect });
    await runner.queryJson({ name: "tenant_001" }, "select 1");
    await runner.queryJson({ name: "tenant_002" }, "select 1");
    expect(fake.live()).toBe(2);
    await runner.close();
    expect(fake.live()).toBe(0);
    await expect(runner.queryJson({ name: "tenant_003" }, "select 1")).rejects.toThrow("runner is closed");
    expect(fake.pools).toHaveLength(2); // nothing was opened after close
  });

  it("a failed open does not poison the pool cache", async () => {
    let attempts = 0;
    const connect: PgConnect = () => {
      attempts++;
      if (attempts === 1) throw new Error("driver missing");
      return { unsafe: async () => [{ data: { ok: true } }], end: async () => undefined };
    };
    const runner = new DirectRunner(URL_, { connect });
    await expect(runner.queryJson({ name: null }, "select 1")).rejects.toThrow("driver missing");
    expect(await runner.queryJson({ name: null }, "select 1")).toEqual({ ok: true });
    await runner.close();
  });
});

// ── DockerPsqlRunner ────────────────────────────────────────────

describe("DockerPsqlRunner", () => {
  it("sets a statement_timeout before the query, one process per query", async () => {
    // A stand-in for `docker exec …`: print the arguments psql would have received as JSON.
    const runner = new DockerPsqlRunner({
      composeFiles: [], envFile: null, service: "postgres", user: "u", database: "hisaabo",
      command: [process.execPath, "-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--"],
      statementTimeoutMs: 12_000,
    });
    const args = (await runner.queryJson({ name: "tenant_x" }, "select 1")) as string[];
    const cs = args.flatMap((a, i) => (a === "-c" ? [args[i + 1]] : []));
    expect(cs).toEqual(["SET statement_timeout = 12000", "select 1"]);
    expect(args).toContain("-q");
    expect(args[args.indexOf("-d") + 1]).toBe("tenant_x");
  });
});
