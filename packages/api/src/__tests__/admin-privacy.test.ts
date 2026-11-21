/**
 * Where the databases live is infrastructure PII: the masked dashboard (and the
 * --json output, and every error the footer shows) must never carry a tenant
 * database host, port or a `host:port/db` key. `--reveal` keeps them.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setColorEnabled, stripAnsi } from "../lib/admin/tui.js";
import { collectPlatformStats, CONTROL_SQL, TENANT_SQL, type SqlRunner, type DbTarget, type PlatformStats } from "../lib/admin/stats.js";
import { renderFrame, type ViewState, type View } from "../lib/admin/screens.js";
import { buildDemoStats } from "../lib/admin/demo.js";
import { maskStats, maskConnectionInfo, maskErrorText, maskFreeText, maskHost, maskDbKey, tenantHandle, MASKED_PORT } from "../lib/admin/privacy.js";
import { QUEUE_PROBE_SQL } from "../lib/admin/queues.js";

beforeAll(() => setColorEnabled(false));

const NOW = new Date("2026-09-12T10:00:00Z");
const VIEWS: View[] = ["overview", "tenants", "ops", "infra", "queues"];

const HOST = "pg-eu-1.internal.example";
const PORT = "6543";
const IP = "10.20.30.40";
const DBUSER = "hisaabo_admin";

const tenantRow = (i: number, name: string, host: string | null = HOST, port: string | null = PORT) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, name, slug: name.toLowerCase().replace(/\s+/g, "-"), plan: "pro", status: "active",
  db_name: `tenant_${name.toLowerCase().replace(/\s+/g, "_")}`, db_host: host, db_port: port, created_at: "2026-08-01T00:00:00Z", members: 2,
});

const control = {
  tenants: [
    tenantRow(1, "Acme Traders"),
    tenantRow(2, "Beta Stores"),
    tenantRow(3, "Gamma Mills"),
    tenantRow(4, "Delta Foods"),
    tenantRow(5, "Epsilon Labs"),
    tenantRow(6, "Zeta Local", null, null), // same server as control: no host in the row
  ],
  users: { total: 5, verified: 5, new_7d: 0, new_30d: 0 },
  sessions: { active: 1, used_24h: 1, web: 1, bearer: 0 },
  api_keys: { total: 0, active: 0, used_7d: 0 },
  pending_invitations: 0,
  maintenance: { enabled: false, message: "", startsAt: null, endsAt: null },
  recent_users: [],
  db: { name: "hisaabo", version: "PostgreSQL 16.4", size_pretty: "1 MB", total_size_pretty: "1 MB", connections: 3, max_connections: 100, databases: 7, uptime_seconds: 10 },
};

const tenantJson = {
  summary: { invoices: 1, sales_invoices: 1, purchase_invoices: 0, other_documents: 0, invoices_7d: 0, invoices_30d: 1, sales_total: 100, purchase_total: 0, receivable: 0, payable: 0, e_invoices: 0, last_invoice_at: null },
  by_status: [], monthly: [],
  counts: { businesses: 1, gst_businesses: 0, stores_enabled: 0, parties: 0, items: 0, payments: 0, payments_total: 0, expenses: 0, expenses_total: 0, store_orders: 0, store_orders_total: 0 },
};

/** Fails four tenant databases the way postgres.js and Postgres really do, each leaking host/port/user. */
class FailingRunner implements SqlRunner {
  describe() { return "fake"; }
  async queryJson(target: DbTarget, sql: string): Promise<unknown> {
    if (sql === CONTROL_SQL) return control;
    if (sql === QUEUE_PROBE_SQL) return { installed: false };
    if (sql !== TENANT_SQL) return tenantJson;
    switch (target.name) {
      case "tenant_beta_stores": throw new Error(`connect ECONNREFUSED ${IP}:${PORT}`);
      case "tenant_gamma_mills": throw new Error(`write CONNECT_TIMEOUT ${HOST}:${PORT}`);
      case "tenant_delta_foods": throw new Error(`getaddrinfo ENOTFOUND ${HOST}`);
      case "tenant_epsilon_labs": throw new Error(`password authentication failed for user "${DBUSER}"`);
      default: return tenantJson;
    }
  }
  async close() { /* noop */ }
}

async function collect(): Promise<PlatformStats> {
  return collectPlatformStats({ runner: new FailingRunner(), now: () => NOW });
}

function frame(stats: PlatformStats, view: View, masked: boolean, selected = 0): string {
  const state: ViewState = {
    view, stats, loading: false, refreshing: false, error: stats.errors[0] ?? null, selected,
    interactive: false, intervalSec: 0, nextRefreshAt: null, runnerLabel: "fake", version: "0.10.0", now: NOW, masked,
  };
  return renderFrame(state, 160, 60).map(stripAnsi).join("\n");
}

const RAW = [HOST, PORT, IP, DBUSER, "pg-eu-1"];

describe("masked stats never carry the tenant database host or port", () => {
  it("masks dbHost, dbPort and dbKey on tenants and on the control tenant rows", async () => {
    const raw = await collect();
    const masked = maskStats(raw);
    const acme = masked.tenants.find((t) => t.id.endsWith("1"))!;
    const handle = tenantHandle(acme.id);

    expect(acme.dbHost).toBe(`db-host-${handle}`);
    expect(acme.dbPort).toBe(MASKED_PORT);
    expect(acme.dbKey).toBe(`db-host-${handle}:${MASKED_PORT}/tenant_••••••`);
    const row = masked.control.tenants.find((t) => t.id === acme.id)!;
    expect(row.dbHost).toBe(acme.dbHost);
    expect(row.dbPort).toBe(MASKED_PORT);

    // a tenant on the control server has no host/port to mask, and its key is just the masked name
    const zeta = masked.tenants.find((t) => t.id.endsWith("6"))!;
    expect(zeta.dbHost).toBeNull();
    expect(zeta.dbPort).toBeNull();
    expect(zeta.dbKey).toBe("tenant_••••••");
    expect(masked.dbs[0].key).toBe("control");
  });

  it("leaves no host, port, address or db user anywhere in the masked JSON snapshot", async () => {
    const raw = await collect();
    expect(raw.databases.failed).toBe(4); // the fixture really does produce the leaky errors
    expect(JSON.stringify(raw)).toContain(HOST);
    const json = JSON.stringify(maskStats(raw), null, 2);
    for (const s of RAW) expect(json).not.toContain(s);
    expect(json).not.toMatch(/ECONNREFUSED [0-9]/);
  });

  it("scrubs connection errors on tenants, databases, the error list and the footer", async () => {
    const masked = maskStats(await collect());
    const byId = (n: number) => masked.tenants.find((t) => t.id.endsWith(String(n)))!;
    expect(byId(2).error).toBe("connect ECONNREFUSED •••");
    expect(byId(3).error).toBe("write CONNECT_TIMEOUT •••");
    expect(byId(4).error).toBe("getaddrinfo ENOTFOUND •••");
    expect(byId(5).error).toBe('password authentication failed for user "•••"');
    // errors[] is "<key>: <error>": the key part is the masked key, not host:port/db
    const handle = tenantHandle(byId(2).id);
    expect(masked.errors.find((e) => e.includes("ECONNREFUSED"))).toBe(`db-host-${handle}:${MASKED_PORT}/tenant_••••••: connect ECONNREFUSED •••`);
    for (const d of masked.dbs) {
      expect(d.key).not.toContain(HOST);
      expect(d.error ?? "").not.toMatch(/\d+\.\d+\.\d+\.\d+|:\d{3,5}\b/);
    }
  });

  it("never shows the host or port on any screen, including the unreachable tenant's detail and the footer", async () => {
    const masked = maskStats(await collect());
    const unreachableIdx = [...masked.tenants].sort((a, b) => Number(Boolean(b.metrics)) - Number(Boolean(a.metrics)) || 0).findIndex((t) => !t.metrics);
    for (const view of VIEWS) {
      for (const selected of [0, Math.max(0, unreachableIdx), masked.tenants.length - 1]) {
        const text = frame(masked, view, true, selected);
        for (const s of RAW) expect(text, `${view}/${selected} leaked ${s}`).not.toContain(s);
        expect(text).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      }
    }
    // The footer (first error) is masked too.
    expect(frame(masked, "overview", true)).toMatch(/db-host-[0-9a-f]{6}:•••\/tenant_••••••|ECONNREFUSED •••/);
  });

  it("--reveal data keeps the real host, port, key and errors", async () => {
    const raw = await collect();
    expect(raw.tenants[0].dbHost).toBe(HOST);
    expect(raw.tenants[0].dbPort).toBe(PORT);
    expect(raw.tenants[0].dbKey).toBe(`${HOST}:${PORT}/tenant_acme_traders`);
    expect(raw.errors.some((e) => e.includes(`${IP}:${PORT}`))).toBe(true);
    // Rendered unmasked, the unreachable tenant shows its real key.
    const sorted = [...raw.tenants];
    const beta = sorted.findIndex((t) => t.id.endsWith("2"));
    expect(beta).toBeGreaterThanOrEqual(0);
    const text = frame(raw, "overview", false);
    expect(text).toContain(`${HOST}:${PORT}/`);
  });

  it("the demo data no longer shows postgres:5432 anywhere once masked", () => {
    const raw = buildDemoStats(NOW);
    expect(JSON.stringify(raw)).toContain("postgres:5432"); // the fixture is realistic...
    const masked = maskStats(raw);
    const json = JSON.stringify(masked);
    expect(json).not.toContain("postgres:5432");
    expect(json).not.toMatch(/"dbHost": ?"postgres"/);
    expect(json).not.toMatch(/"dbPort": ?"5432"/);
    expect(masked.tenants.every((t) => /^db-host-[0-9a-f]{6}$/.test(t.dbHost ?? ""))).toBe(true);
    for (const view of VIEWS) {
      const state: ViewState = { view, stats: masked, loading: false, refreshing: false, error: masked.errors[0] ?? null, selected: 17, interactive: false, intervalSec: 0, nextRefreshAt: null, runnerLabel: "demo data", version: "0.10.0", now: NOW, masked: true };
      const text = renderFrame(state, 160, 60).map(stripAnsi).join("\n");
      expect(text, view).not.toContain("postgres:5432");
      expect(text, view).not.toContain(":5432");
    }
  });

  it("does not mutate its input", async () => {
    const raw = await collect();
    const before = JSON.stringify(raw);
    maskStats(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("connection-detail scrubbing", () => {
  it("strips what node, postgres.js and postgres put in connection errors", () => {
    const cases: [string, string][] = [
      ["connect ECONNREFUSED 10.0.0.5:5432", "connect ECONNREFUSED •••"],
      ["connect ECONNREFUSED ::1:5432", "connect ECONNREFUSED •••"],
      ["write CONNECT_TIMEOUT db.internal:5432", "write CONNECT_TIMEOUT •••"],
      ["connect ETIMEDOUT postgres:5432", "connect ETIMEDOUT •••"],
      ["getaddrinfo ENOTFOUND db.internal", "getaddrinfo ENOTFOUND •••"],
      ["getaddrinfo EAI_AGAIN postgres", "getaddrinfo EAI_AGAIN •••"],
      ["postgresql://hisaabo:s3cret@db.internal:5432/hisaabo failed", "db://••• failed"],
      ['password authentication failed for user "hisaabo"', 'password authentication failed for user "•••"'],
      ['role "hisaabo" does not exist', 'role "•••" does not exist'],
      ['connection to server at "db.internal" (10.0.0.5), port 5432 failed', "connection to server at ••• failed"],
      ["unreachable 192.168.1.20:5432 now", "unreachable ••• now"],
      ["connect to [fe80::1]:5432", "connect to •••"],
    ];
    for (const [input, want] of cases) {
      const got = maskConnectionInfo(input);
      expect(got).toBe(want);
      expect(got).not.toContain("s3cret");
    }
  });

  it("leaves ordinary messages alone", () => {
    for (const s of ["read ECONNRESET while connecting", "timeout: no answer within 20s", "FATAL: database \"tenant_••••••\" does not exist", "version 16.4 up 10:30:00", "slow query: 3.5s"]) {
      expect(maskConnectionInfo(s)).toBe(s);
      expect(maskErrorText(s)).toBe(s);
    }
  });

  it("maskErrorText also catches host:port(/db) tokens that no tenant row explains", () => {
    expect(maskErrorText("db-eu-7.internal:6543/tenant_acme: timeout: no answer within 20s")).toBe("•••: timeout: no answer within 20s");
    expect(maskErrorText("pg:5432: boom")).toBe("•••: boom");
  });

  it("free text keeps data like ErrorCode:2150 but still loses connection details", () => {
    expect(maskFreeText("IRP rejected [ErrorCode:2150] Duplicate IRN")).toBe("IRP rejected [ErrorCode:2150] Duplicate IRN");
    expect(maskFreeText("job failed: connect ECONNREFUSED 10.0.0.5:5432")).toBe("job failed: connect ECONNREFUSED •••");
  });

  it("failure messages and queue job errors are scrubbed of the real key and address", async () => {
    const raw = await collect();
    const t1 = raw.tenants[0];
    raw.failures = [{ kind: "einvoice", ref: "INV-1", message: `could not reach ${t1.dbKey} (${IP}:${PORT}) [ErrorCode:2150]`, at: "2026-09-12T09:00:00Z", tenantId: t1.id, tenantName: t1.name }];
    raw.queues = { ...raw.queues, installed: true, error: `connect ECONNREFUSED ${IP}:${PORT}`, recentFailures: [{ queue: "q", jobId: "j", failedAt: "2026-09-12T09:00:00Z", createdAt: null, attempts: 1, type: "RetryableError", error: `${HOST}:${PORT} timed out`, tenantId: t1.id, tenantName: t1.name }] };
    const json = JSON.stringify(maskStats(raw));
    for (const s of RAW) expect(json).not.toContain(s);
    expect(json).toContain("[ErrorCode:2150]");
  });

  it("maskHost / maskDbKey are stable per tenant and keep control", () => {
    expect(maskHost(null, "x")).toBeNull();
    expect(maskHost("db", "t-1")).toBe(`db-host-${tenantHandle("t-1")}`);
    expect(maskDbKey({ id: "t-1", dbKey: "control", dbName: null, dbHost: null, dbPort: null })).toBe("control");
  });
});

// ── The CLI itself: default output is masked, --reveal is not ───

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..", "..");

function cli(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", "src/bin/admin.ts", ...args], { cwd: pkgRoot, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 30_000 });
}

describe("admin CLI --via demo", () => {
  it("--json is masked by default and --reveal shows the real host and port", () => {
    const masked = JSON.parse(cli("--via", "demo", "--json")) as PlatformStats;
    const maskedText = JSON.stringify(masked);
    expect(maskedText).not.toContain("postgres:5432");
    expect(masked.tenants.some((t) => t.dbHost === "postgres" || t.dbPort === "5432")).toBe(false);
    expect(masked.control.tenants.some((t) => t.dbHost === "postgres" || t.dbPort === "5432")).toBe(false);

    const revealed = JSON.parse(cli("--via", "demo", "--json", "--reveal")) as PlatformStats;
    expect(revealed.tenants[0].dbHost).toBe("postgres");
    expect(revealed.tenants[0].dbPort).toBe("5432");
    expect(revealed.dbs.some((d) => d.key.startsWith("postgres:5432/"))).toBe(true);
  });

  it("every view renders without a host:port, and --reveal shows it in the footer", () => {
    for (const view of VIEWS) {
      const text = cli("--once", "--via", "demo", "--no-color", "--width", "150", "--view", view);
      expect(text, view).not.toContain("postgres:5432");
      expect(text, view).not.toContain(":5432");
    }
    const revealed = cli("--once", "--via", "demo", "--no-color", "--width", "200", "--view", "overview", "--reveal");
    expect(revealed).toContain("postgres:5432/tenant_");
  });
});
