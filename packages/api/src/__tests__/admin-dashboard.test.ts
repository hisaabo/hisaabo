/**
 * Tests for the admin dashboard (packages/api/src/lib/admin + bin/admin.ts).
 *
 * Everything under lib/admin is pure — rendering takes data and a width and
 * returns rows of text; stats parsing takes the JSON a query returns and
 * produces typed numbers. So these tests need no database, no TTY, and no
 * docker: a fake SqlRunner feeds canned JSON through the real collector.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  setColorEnabled, stripAnsi, width, truncate, pad, fit, spread, hstack, splitWidth, box, kpiTile,
  hbar, breakdown, sparkline, columnChart, table, fmtInt, fmtINR, fmtINRCompact, fmtCompact,
  fmtRelative, fmtUptime, fmtMonth, c,
} from "../lib/admin/tui.js";
import {
  collectPlatformStats, parseControlStats, parseTenantMetrics, sumMetrics, lastTwelveMonths, emptyMetrics,
  CONTROL_SQL, TENANT_SQL, type SqlRunner, type DbTarget,
} from "../lib/admin/stats.js";
import { renderFrame, sortTenants, type ViewState } from "../lib/admin/screens.js";
import { fmtBytes } from "../lib/admin/tui.js";
import { buildDemoStats } from "../lib/admin/demo.js";
import { parseEnvFile, pickPsqlError, DirectRunner } from "../lib/admin/runners.js";
import { maskEmail, maskName, maskWord, maskDbName, tenantHandle, maskStats, maskFreeText } from "../lib/admin/privacy.js";
import { deriveAlerts } from "../lib/admin/alerts.js";
import { compareMigrations, readJournal, loadJournals, journalDirCandidates, appliedMigrationsSql, MIGRATION_TABLES, type Journal } from "../lib/admin/migrations.js";
import { parseInfra, journalKindFor } from "../lib/admin/stats.js";
import { sortDbs } from "../lib/admin/screens.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { splitKeys } from "../lib/admin/keys.js";

beforeAll(() => setColorEnabled(false));

// =============================================================================
// Formatting
// =============================================================================

describe("fmtInt — Indian digit grouping", () => {
  it("groups the last three digits, then pairs", () => {
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(999)).toBe("999");
    expect(fmtInt(1000)).toBe("1,000");
    expect(fmtInt(12345)).toBe("12,345");
    expect(fmtInt(123456)).toBe("1,23,456");
    expect(fmtInt(12345678)).toBe("1,23,45,678");
    expect(fmtInt(-1234567)).toBe("-12,34,567");
  });
});

describe("fmtINR / fmtINRCompact", () => {
  it("formats full rupee amounts with paise", () => {
    expect(fmtINR(123456.5)).toBe("₹1,23,456.50");
    expect(fmtINR(0)).toBe("₹0.00");
    expect(fmtINR(-42.25)).toBe("-₹42.25");
  });

  it("uses lakh / crore units", () => {
    expect(fmtINRCompact(950)).toBe("₹950");
    expect(fmtINRCompact(12345)).toBe("₹12,345");
    expect(fmtINRCompact(100000)).toBe("₹1.00 L");
    expect(fmtINRCompact(4_560_000)).toBe("₹45.6 L");
    expect(fmtINRCompact(12_345_678)).toBe("₹1.23 Cr");
    expect(fmtINRCompact(231_000_000)).toBe("₹23.1 Cr");
    expect(fmtINRCompact(1_000_000_000)).toBe("₹100 Cr");
  });

  it("never prints ₹10.00 L for a value that rounds up to ten", () => {
    expect(fmtINRCompact(999_999)).toBe("₹10.0 L");
  });

  it("fmtCompact shortens counts", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(1500)).toBe("1.50K");
    expect(fmtCompact(2_500_000)).toBe("2.50M");
  });
});

describe("relative time & misc formatters", () => {
  const now = new Date("2026-09-12T12:00:00Z");
  it("fmtRelative", () => {
    expect(fmtRelative(null, now)).toBe("never");
    expect(fmtRelative("2026-09-12T11:59:50Z", now)).toBe("just now");
    expect(fmtRelative("2026-09-12T11:30:00Z", now)).toBe("30m ago");
    expect(fmtRelative("2026-09-12T09:00:00Z", now)).toBe("3h ago");
    expect(fmtRelative("2026-09-10T12:00:00Z", now)).toBe("2d ago");
    expect(fmtRelative("2026-08-22T12:00:00Z", now)).toBe("3w ago");
    expect(fmtRelative("2026-01-05T12:00:00Z", now)).toBe("05 Jan 2026");
  });
  it("fmtUptime / fmtMonth", () => {
    expect(fmtUptime(19 * 86400 + 4 * 3600)).toBe("19d 4h");
    expect(fmtUptime(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(fmtUptime(120)).toBe("2m");
    expect(fmtMonth("2026-03")).toBe("Mar");
  });
});

// =============================================================================
// Width-aware text primitives
// =============================================================================

describe("width / truncate / pad", () => {
  it("ignores ANSI escapes and counts ₹ and box drawing as one column", () => {
    setColorEnabled(true);
    try {
      expect(width(c.bold(c.brand("₹1.2 Cr")))).toBe(7);
      expect(stripAnsi(c.ok("ok"))).toBe("ok");
    } finally {
      setColorEnabled(false);
    }
    expect(width("╭─╮")).toBe(3);
    expect(width("日本")).toBe(4);
  });

  it("truncates with an ellipsis and keeps styles balanced", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("abc", 0)).toBe("");
    setColorEnabled(true);
    try {
      const t = truncate(c.bad("hello world"), 6);
      expect(width(t)).toBe(6);
      expect(stripAnsi(t)).toBe("hello…");
      expect(t.endsWith("\x1b[0m…")).toBe(true);
    } finally {
      setColorEnabled(false);
    }
  });

  it("pads to exact widths in all alignments", () => {
    expect(pad("ab", 5)).toBe("ab   ");
    expect(pad("ab", 5, "right")).toBe("   ab");
    expect(pad("ab", 5, "center")).toBe(" ab  ");
    expect(fit("abcdefgh", 4)).toBe("abc…");
    expect(fit("ab", 4, "right")).toBe("  ab");
  });

  it("spread places left and right text at the edges", () => {
    expect(spread("L", "R", 6)).toBe("L    R");
    expect(spread("left", "right", 6)).toBe("left …");
  });

  it("splitWidth distributes remainders from the left", () => {
    expect(splitWidth(20, 3, 1)).toEqual([6, 6, 6]);
    expect(splitWidth(21, 3, 1)).toEqual([7, 6, 6]);
    expect(splitWidth(21, 3, 1).reduce((a, b) => a + b, 0) + 2).toBe(21);
  });

  it("hstack pads shorter blocks", () => {
    const out = hstack([["aa", "aa", "aa"], ["bbb"]], 1);
    expect(out).toEqual(["aa bbb", "aa    ", "aa    "]);
  });
});

// =============================================================================
// Widgets
// =============================================================================

describe("box", () => {
  it("draws a rounded border with the title in the top edge, every row exact width", () => {
    const rows = box({ title: "Hi", hint: "3", width: 20, lines: ["one", "two"] });
    expect(rows[0]).toBe("╭─ Hi ────────── 3 ╮");
    expect(rows[rows.length - 1]).toBe("╰──────────────────╯");
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(width(r)).toBe(20);
    expect(rows[1]).toBe("│ one              │");
  });

  it("honours a fixed height by padding or trimming", () => {
    expect(box({ width: 10, height: 6, lines: ["a"] })).toHaveLength(6);
    expect(box({ width: 10, height: 3, lines: ["a", "b", "c", "d"] })).toHaveLength(3);
  });

  it("kpiTile is always five rows", () => {
    const t = kpiTile({ label: "Tenants", value: "23", sub: "▲ 2", width: 18 });
    expect(t).toHaveLength(5);
    expect(t[1]).toContain("TENANTS");
    expect(t[2]).toContain("23");
    for (const r of t) expect(width(r)).toBe(18);
  });
});

describe("bars & charts", () => {
  it("hbar fills proportionally and never drops a non-zero value to nothing", () => {
    expect(hbar(5, 10, 10)).toBe("█████░░░░░");
    expect(hbar(0, 10, 4)).toBe("░░░░");
    expect(hbar(1, 1000, 4)).toBe("█░░░");
    expect(hbar(50, 0, 4)).toBe("█░░░"); // no max known → still hint at a non-zero value
  });

  it("sparkline maps values onto eight levels", () => {
    expect(sparkline([0, 1, 2, 4, 8])).toBe("▁▂▃▅█");
    expect(sparkline([0, 0])).toBe("▁▁");
  });

  it("breakdown rows show label, bar, value and percentage", () => {
    const rows = breakdown([{ label: "free", value: 3 }, { label: "pro", value: 1 }], 40);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^free {1,}█+ +3 +75%$/);
    expect(rows[1]).toMatch(/^pro {1,}█+░+ +1 +25%$/);
    for (const r of rows) expect(width(r)).toBeLessThanOrEqual(40);
    expect(breakdown([], 20)).toEqual(["no data"]);
  });

  it("columnChart returns height + 2 rows of exact width and uses eighth blocks", () => {
    const rows = columnChart({ values: [1, 2, 3, 4], labels: ["a", "b", "c", "d"], width: 30, height: 4 });
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(width(r)).toBe(30);
    // Tallest bar reaches the top row; with 4 rows the bars are 1/4 apart so
    // every bar is made of full cells and the bottom row is solid.
    const barW = rows[0].split("█").length - 1; // only the tallest bar reaches the top row
    expect(barW).toBeGreaterThan(0);
    expect(rows[3].split("█").length - 1).toBe(barW * 4); // all four bars are solid at the bottom
    expect(rows[4]).toMatch(/└─+/);
    expect(rows[5]).toContain("a");
    expect(rows[5]).toContain("d");
  });

  it("columnChart uses partial blocks for sub-row values", () => {
    const rows = columnChart({ values: [1, 8], labels: ["a", "b"], width: 12, height: 1 });
    expect(rows[0]).toContain("▁");
    expect(rows[0]).toContain("█");
  });

  it("columnChart drops oldest points when the area is too narrow", () => {
    const rows = columnChart({ values: Array(12).fill(1), labels: Array(12).fill("m"), width: 12, height: 2 });
    for (const r of rows) expect(width(r)).toBe(12);
  });
});

describe("table", () => {
  const rows = [{ name: "Acme", n: 12 }, { name: "A very long tenant name indeed", n: 3 }];
  const columns = [
    { key: "name", label: "Tenant", flex: true },
    { key: "n", label: "N", align: "right" as const },
  ];

  it("aligns columns, sizes the flex column to the width, and draws a full rule", () => {
    const out = table({ columns, rows, width: 24 });
    expect(out).toHaveLength(4);
    for (const r of out) expect(width(r)).toBe(24);
    expect(out[0]).toBe("Tenant                 N");
    expect(out[1]).toBe("────────────────────────");
    expect(out[2]).toBe("Acme                  12");
    expect(out[3]).toBe("A very long tenant n…  3");
  });

  it("inverts the selected row and shows empty text", () => {
    setColorEnabled(true);
    try {
      const out = table({ columns, rows, width: 24, selected: 1 });
      expect(out[3].startsWith("\x1b[7m")).toBe(true);
    } finally {
      setColorEnabled(false);
    }
    expect(table({ columns, rows: [], width: 24, emptyText: "nope" })[2]).toBe("nope                    ");
  });
});

// =============================================================================
// Stats parsing & aggregation
// =============================================================================

const NOW = new Date("2026-09-12T10:00:00Z");

const controlJson = {
  tenants: [
    { id: "t1", name: "Acme", slug: "acme", plan: "pro", status: "active", db_name: "tenant_acme", db_host: "postgres", db_port: "5432", created_at: "2026-08-01T00:00:00Z", members: 3 },
    { id: "t2", name: "Beta", slug: "beta", plan: "free", status: "active", db_name: "tenant_beta", db_host: null, db_port: null, created_at: "2026-09-01T00:00:00Z", members: "1" },
    { id: "t3", name: "Gone", slug: "gone", plan: "free", status: "deleted", db_name: "tenant_gone", db_host: null, db_port: null, created_at: "2026-01-01T00:00:00Z", members: 0 },
  ],
  users: { total: 10, verified: 8, new_7d: 2, new_30d: "4" },
  sessions: { active: 5, used_24h: 3, web: 4, bearer: 1 },
  api_keys: { total: 2, active: 2, used_7d: 1 },
  pending_invitations: 1,
  maintenance: { enabled: false, message: "", startsAt: null, endsAt: null },
  recent_users: [{ email: "a@x.in", name: null, created_at: "2026-09-11T00:00:00Z" }],
  db: { name: "hisaabo", version: "PostgreSQL 16.4 (Debian 16.4-1) on x86_64", size_pretty: "10 MB", total_size_pretty: "30 MB", connections: 4, max_connections: 100, databases: 3, uptime_seconds: 3600 },
};

const tenantJson = (mult: number) => ({
  summary: {
    invoices: 10 * mult, sales_invoices: 8 * mult, purchase_invoices: 2 * mult, other_documents: 1 * mult,
    invoices_7d: 1 * mult, invoices_30d: 3 * mult, sales_total: 100000 * mult, purchase_total: 20000 * mult,
    receivable: 15000 * mult, payable: 5000 * mult, e_invoices: 2 * mult, last_invoice_at: mult === 1 ? "2026-09-10T00:00:00Z" : "2026-09-11T00:00:00Z",
  },
  by_status: [{ status: "paid", n: 6 * mult }, { status: "sent", n: 4 * mult }],
  monthly: [{ month: "2026-09", n: 3 * mult, amount: 30000 * mult }, { month: "2026-07", n: 1 * mult, amount: 5000 * mult }],
  counts: {
    businesses: 1 * mult, gst_businesses: 1, stores_enabled: 0, parties: 5 * mult, items: 7 * mult,
    payments: 4 * mult, payments_total: 60000 * mult, expenses: 2 * mult, expenses_total: 3000 * mult,
    store_orders: 0, store_orders_total: 0,
  },
});

class FakeRunner implements SqlRunner {
  calls: { target: DbTarget; sql: string }[] = [];
  constructor(private readonly failDb: string | null = null) {}
  describe() { return "fake"; }
  async queryJson(target: DbTarget, sql: string): Promise<unknown> {
    this.calls.push({ target, sql });
    if (sql === CONTROL_SQL) return controlJson;
    if (target.name === this.failDb) throw new Error('FATAL:  database "tenant_beta" does not exist\nmore');
    return tenantJson(target.name === "tenant_acme" ? 1 : 2);
  }
  async close() { /* noop */ }
}

describe("parseControlStats", () => {
  it("coerces numbers, nulls and the postgres version string", () => {
    const s = parseControlStats(controlJson);
    expect(s.tenants).toHaveLength(3);
    expect(s.tenants[1].members).toBe(1);
    expect(s.tenants[1].dbHost).toBeNull();
    expect(s.users.new30d).toBe(4);
    expect(s.db.version).toBe("PostgreSQL 16.4");
    expect(s.maintenance?.enabled).toBe(false);
    expect(s.recentUsers[0].name).toBeNull();
  });

  it("tolerates a completely empty payload", () => {
    const s = parseControlStats(null);
    expect(s.tenants).toEqual([]);
    expect(s.users.total).toBe(0);
    expect(s.maintenance).toBeNull();
  });
});

describe("parseTenantMetrics / sumMetrics", () => {
  it("fills all twelve months, oldest first, with zeros where there was no data", () => {
    const m = parseTenantMetrics(tenantJson(1), NOW);
    expect(m.monthly).toHaveLength(12);
    expect(m.monthly.map((p) => p.month)).toEqual(lastTwelveMonths(NOW));
    expect(m.monthly[11]).toEqual({ month: "2026-09", count: 3, amount: 30000 });
    expect(m.monthly[9]).toEqual({ month: "2026-07", count: 1, amount: 5000 });
    expect(m.monthly[10].amount).toBe(0);
    expect(m.byStatus).toEqual({ paid: 6, sent: 4 });
    expect(m.salesTotal).toBe(100000);
  });

  it("lastTwelveMonths spans a year boundary", () => {
    expect(lastTwelveMonths(new Date("2026-02-15T00:00:00Z"))).toEqual([
      "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
    ]);
  });

  it("sums numeric fields, merges status maps and monthly series, keeps the latest activity", () => {
    const a = parseTenantMetrics(tenantJson(1), NOW);
    const b = parseTenantMetrics(tenantJson(2), NOW);
    const t = sumMetrics([a, b], NOW);
    expect(t.invoices).toBe(30);
    expect(t.salesTotal).toBe(300000);
    expect(t.byStatus).toEqual({ paid: 18, sent: 12 });
    expect(t.monthly[11].amount).toBe(90000);
    expect(t.lastInvoiceAt).toBe("2026-09-11T00:00:00Z");
    expect(sumMetrics([], NOW)).toEqual(emptyMetrics(NOW));
  });
});

describe("collectPlatformStats", () => {
  it("queries the control DB once and each live tenant DB once", async () => {
    const runner = new FakeRunner();
    const st = await collectPlatformStats({ runner, now: () => NOW });
    expect(runner.calls.filter((x) => x.sql === CONTROL_SQL)).toHaveLength(1);
    const tenantCalls = runner.calls.filter((x) => x.sql === TENANT_SQL).map((x) => x.target.name).sort();
    expect(tenantCalls).toEqual(["tenant_acme", "tenant_beta"]); // deleted tenant skipped
    expect(st.mode).toBe("multi-db");
    expect(st.databases).toEqual({ queried: 2, failed: 0 });
    expect(st.totals.invoices).toBe(30);
    expect(st.tenants.find((t) => t.id === "t3")?.metrics).toBeNull();
    expect(st.tenants.find((t) => t.id === "t1")?.metrics?.invoices).toBe(10);
  });

  it("records per-database failures without aborting the whole collection", async () => {
    const runner = new FakeRunner("tenant_beta");
    const st = await collectPlatformStats({ runner, now: () => NOW });
    expect(st.databases.failed).toBe(1);
    expect(st.errors[0]).toBe('tenant_beta: FATAL:  database "tenant_beta" does not exist');
    expect(st.tenants.find((t) => t.id === "t1")?.dbKey).toBe("postgres:5432/tenant_acme");
    const beta = st.tenants.find((t) => t.id === "t2")!;
    expect(beta.metrics).toBeNull();
    expect(beta.error).toContain("does not exist");
    expect(st.totals.invoices).toBe(10); // only acme counted
  });

  it("falls back to the control database in shared-db mode", async () => {
    class SharedRunner extends FakeRunner {
      async queryJson(target: DbTarget, sql: string) {
        if (sql === CONTROL_SQL) {
          return { ...controlJson, tenants: controlJson.tenants.map((t) => ({ ...t, db_name: null })) };
        }
        expect(target.name).toBeNull();
        return tenantJson(1);
      }
    }
    const runner = new SharedRunner();
    const st = await collectPlatformStats({ runner, now: () => NOW });
    expect(st.mode).toBe("shared-db");
    expect(st.databases.queried).toBe(1);
    expect(st.totals.invoices).toBe(10); // not multiplied by tenant count
    expect(st.tenants.every((t) => t.sharedDb)).toBe(true);
  });
});

// =============================================================================
// Screens
// =============================================================================

function stateFor(view: ViewState["view"], interactive = false): ViewState {
  return {
    view, stats: buildDemoStats(NOW), loading: false, refreshing: false, error: null, selected: 0,
    interactive, intervalSec: 30, nextRefreshAt: null, runnerLabel: "demo", version: "0.9.0", now: NOW, masked: true,
  };
}

describe("renderFrame", () => {
  it.each([60, 80, 100, 120, 160, 200])("overview at %i columns fills the width exactly on every row", (cols) => {
    const frame = renderFrame(stateFor("overview"), cols);
    expect(frame.length).toBeGreaterThan(20);
    for (const row of frame) expect(width(row)).toBe(cols);
    const text = frame.join("\n");
    expect(text).toContain("HISAABO ADMIN");
    expect(text).toContain("AMOUNT MANAGED");
    expect(text).toContain("Sales invoiced");
  });

  it.each([[120, 30], [120, 45], [80, 24], [200, 60], [100, 12]])("fits %i×%i exactly when rows are fixed", (cols, rows) => {
    const frame = renderFrame(stateFor("overview", true), cols, rows);
    expect(frame).toHaveLength(rows);
    for (const row of frame) expect(width(row)).toBe(cols);
  });

  it("renders the tenants view with the selected row and a detail panel", () => {
    const state = stateFor("tenants", true);
    state.selected = 2;
    const frame = renderFrame(state, 150, 40);
    expect(frame).toHaveLength(40);
    for (const row of frame) expect(width(row)).toBe(150);
    const third = sortTenants(state.stats!)[2];
    expect(frame.join("\n")).toContain(`╭─ ${third.name} `);
  });

  it("keeps the selection visible when it scrolls past the window", () => {
    const state = stateFor("tenants", true);
    state.selected = 22;
    const frame = renderFrame(state, 150, 20);
    expect(frame.join("\n")).toContain("Tenants");
    expect(frame.join("\n")).toMatch(/of 23/);
  });

  it("shows a loading / error screen without stats", () => {
    const state = { ...stateFor("overview", true), stats: null };
    const frame = renderFrame(state, 100, 20);
    expect(frame).toHaveLength(20);
    expect(frame.join("\n")).toContain("loading platform statistics");
    const failed = renderFrame({ ...state, error: "boom" }, 100, 20);
    expect(failed.join("\n")).toContain("boom");
  });

  it("sortTenants puts unreachable and deleted tenants last, richest first", () => {
    const sorted = sortTenants(buildDemoStats(NOW));
    expect(sorted[0].metrics!.salesTotal).toBeGreaterThanOrEqual(sorted[1].metrics!.salesTotal);
    expect(sorted[sorted.length - 1].metrics).toBeNull();
  });
});

// =============================================================================
// Runner helpers & key parsing
// =============================================================================

describe("parseEnvFile", () => {
  it("reads simple KEY=VALUE lines, quotes, comments and export prefixes", () => {
    const env = parseEnvFile(`
# comment
POSTGRES_USER=hisaabo
POSTGRES_DB="hisaabo_prod"
export SECRET='s3cr3t'
PORT=3000 # trailing comment
BROKEN
`);
    expect(env).toEqual({ POSTGRES_USER: "hisaabo", POSTGRES_DB: "hisaabo_prod", SECRET: "s3cr3t", PORT: "3000" });
  });
});

describe("pickPsqlError", () => {
  it("prefers the ERROR line over the SQL echo and caret", () => {
    const stderr = `ERROR:  column "deleted_at" does not exist
LINE 12:         (select count(*) from parties where deleted_at is null) as parties,
                                                      ^
`;
    expect(pickPsqlError(stderr, "exit 1")).toBe('ERROR: column "deleted_at" does not exist');
  });
  it("strips psql connection boilerplate", () => {
    const stderr = 'psql: error: connection to server at "127.0.0.1", port 5499 failed: FATAL:  database "tenant_ghost" does not exist\n';
    expect(pickPsqlError(stderr, "x")).toBe('FATAL: database "tenant_ghost" does not exist');
  });
  it("falls back to the last line, then the process error", () => {
    expect(pickPsqlError("docker: Error response from daemon: no such container\n", "x")).toBe("docker: Error response from daemon: no such container");
    expect(pickPsqlError("", "spawn docker ENOENT")).toBe("spawn docker ENOENT");
  });
});

describe("DirectRunner.urlFor", () => {
  it("swaps the database (and host/port when the tenant row has them) but keeps credentials", () => {
    const r = new DirectRunner("postgresql://admin:pw@db.internal:5432/hisaabo");
    expect(r.urlFor({ name: null })).toBe("postgresql://admin:pw@db.internal:5432/hisaabo");
    expect(r.urlFor({ name: "tenant_acme" })).toBe("postgresql://admin:pw@db.internal:5432/tenant_acme");
    expect(r.urlFor({ name: "tenant_acme", host: "other", port: "6543" })).toBe("postgresql://admin:pw@other:6543/tenant_acme");
    expect(r.describe()).toBe("direct · postgres"); // masked by default
    expect(r.describe(true)).toBe("direct · admin@db.internal:5432");
  });
});

describe("splitKeys", () => {
  it("keeps escape sequences whole and normalises application-cursor arrows", () => {
    expect(splitKeys("q")).toEqual(["q"]);
    expect(splitKeys("\x1b[A\x1b[B")).toEqual(["\x1b[A", "\x1b[B"]);
    expect(splitKeys("\x1b[5~j")).toEqual(["\x1b[5~", "j"]);
    expect(splitKeys("\x1bOA")).toEqual(["\x1b[A"]);
    expect(splitKeys("\x1b")).toEqual(["\x1b"]);
  });
});

// =============================================================================
// PII masking
// =============================================================================

describe("privacy masking", () => {
  it("masks words, names and emails while keeping a recognisable shape", () => {
    expect(maskWord("sharma")).toBe("s•••••");
    expect(maskWord("ab")).toBe("a••"); // never fewer than two bullets
    expect(maskName("Verma Electricals")).toBe("V•••• E••••••");
    expect(maskEmail("priya@sharmatraders.in")).toBe("pr•••@sh••••••.in");
    expect(maskEmail("a@b.co.uk")).toBe("a••@b.••.uk");
    expect(maskEmail("not-an-email")).toBe("no••••••");
    expect(maskDbName("tenant_sharma_traders")).toBe("tenant_••••••");
    expect(maskDbName("acme")).toBe("a•••");
    expect(maskDbName(null)).toBeNull();
    const h1 = tenantHandle("00000000-0000-4000-8000-000000000001");
    const h2 = tenantHandle("00000000-0000-4000-8000-000000000002");
    expect(h1).toMatch(/^[0-9a-f]{6}$/);
    expect(h1).not.toBe(h2); // sequential ids still get distinct handles
    expect(tenantHandle("00000000-0000-4000-8000-000000000001")).toBe(h1); // stable
  });

  it("maskStats leaves no tenant name, slug, db name or email anywhere in the output", () => {
    const raw = buildDemoStats(NOW);
    const masked = maskStats(raw);
    const json = JSON.stringify(masked);
    for (const t of raw.tenants) {
      expect(json).not.toContain(t.name);
      expect(json).not.toContain(`"${t.slug}"`);
      if (t.dbName) expect(json).not.toContain(t.dbName);
    }
    for (const u of raw.control.recentUsers) {
      expect(json).not.toContain(u.email);
      if (u.name) expect(json).not.toContain(u.name);
    }
    // Structure and numbers are untouched.
    expect(masked.totals).toEqual(raw.totals);
    expect(masked.tenants).toHaveLength(raw.tenants.length);
    expect(masked.tenants[0].metrics).toBe(raw.tenants[0].metrics);
    expect(masked.tenants[0].name).toMatch(/^Tenant [0-9a-f]{6}$/);
    expect(masked.control.tenants[0].name).toBe(masked.tenants[0].name);
    // The unreachable tenant's error message is scrubbed too.
    const broken = masked.tenants.find((t) => t.error)!;
    expect(broken.error).toContain("tenant_••••••");
    expect(masked.errors[0]).not.toContain("aarav");
    // Input is not mutated.
    expect(raw.tenants[0].name).toBe("Sharma Traders");
  });

  it("renders a masked frame with the privacy indicator and no raw names", () => {
    const state = stateFor("tenants", true);
    state.stats = maskStats(state.stats!);
    const text = renderFrame(state, 150, 40).join("\n");
    expect(text).toContain("PII masked");
    expect(text).toContain("Reveal PII");
    expect(text).not.toContain("Verma");
    expect(text).toMatch(/Tenant [0-9a-f]{6}/);
    const revealed = renderFrame({ ...stateFor("overview", true), masked: false }, 150, 40).join("\n");
    expect(revealed).toContain("PII visible");
    expect(revealed).toContain("Verma Electricals");
  });
});

// =============================================================================
// Ops health & alerts
// =============================================================================

describe("ops metrics", () => {
  const opsJson = {
    einvoice: { pending: 2, generated: 40, cancelled: 1, failed: 3, stale_pending: 1, exhausted: 1 },
    recurring: { active_templates: 4, paused_templates: 1, overdue_templates: 1, ok_7d: 6, failed_7d: 1, skipped_7d: 0, ok_30d: 24, failed_30d: 2 },
    bank: { imports: 5, completed: 4, in_progress: 0, review: 1, stale: 1, matched_30d: 300, unmatched_30d: 20 },
    gstr2b: { uploads: 3, uploads_30d: 1, unmatched_30d: 7, new_30d: 2, last_upload_at: "2026-09-01T00:00:00Z" },
    store: [{ status: "pending", n: 3, stale: 2 }, { status: "delivered", n: 30, stale: 0 }],
    shipments: [{ status: "in_transit", n: 4, stuck: 1 }],
    ewb: { active: 5, cancelled: 1, expired: 9, expiring_24h: 1, overdue_expiry: 0 },
    failures: [{ kind: "einvoice", ref: "INV-7", message: "2150: Duplicate IRN", at: "2026-09-11T10:00:00Z" }],
  };

  it("parses the ops blob and fills missing sections with zeros", () => {
    const m = parseTenantMetrics({ ...tenantJson(1), ops: opsJson }, NOW);
    expect(m.ops.eInvoice).toEqual({ pending: 2, generated: 40, cancelled: 1, failed: 3, stalePending: 1, exhausted: 1 });
    expect(m.ops.store.byStatus).toEqual({ pending: 3, delivered: 30 });
    expect(m.ops.store.stalePending).toBe(2);
    expect(m.ops.shipments.stuck).toBe(1);
    expect(m.ops.failures).toHaveLength(1);
    const empty = parseTenantMetrics(tenantJson(1), NOW);
    expect(empty.ops).toEqual(emptyMetrics(NOW).ops);
  });

  it("sums ops across tenants", () => {
    const a = parseTenantMetrics({ ...tenantJson(1), ops: opsJson }, NOW);
    const t = sumMetrics([a, a], NOW);
    expect(t.ops.eInvoice.failed).toBe(6);
    expect(t.ops.recurring.ok30d).toBe(48);
    expect(t.ops.store.byStatus.pending).toBe(6);
    expect(t.ops.gstr2b.lastUploadAt).toBe("2026-09-01T00:00:00Z");
  });

  it("collect merges per-tenant failures newest first with tenant attribution", async () => {
    class OpsRunner extends FakeRunner {
      async queryJson(target: DbTarget, sql: string) {
        if (sql === CONTROL_SQL) return controlJson;
        const at = target.name === "tenant_acme" ? "2026-09-11T10:00:00Z" : "2026-09-12T08:00:00Z";
        return { ...tenantJson(1), ops: { ...opsJson, failures: [{ kind: "einvoice", ref: "INV-1", message: "x", at }] } };
      }
    }
    const st = await collectPlatformStats({ runner: new OpsRunner(), now: () => NOW });
    expect(st.failures.map((f) => f.tenantName)).toEqual(["Beta", "Acme"]);
  });

  it("derives red and yellow alerts from the totals", () => {
    const st = buildDemoStats(NOW);
    const alerts = deriveAlerts(st);
    const texts = alerts.map((a) => `${a.level}:${a.text}`);
    expect(texts).toContain("red:1 tenant db unreachable");
    expect(texts.some((t) => /^red:\d+ e-invoices? failed/.test(t))).toBe(true);
    expect(texts.some((t) => /^yellow:\d+ store orders? unconfirmed > 24h/.test(t))).toBe(true);
    // Reds come first.
    const firstYellow = alerts.findIndex((a) => a.level === "yellow");
    expect(alerts.slice(0, firstYellow).every((a) => a.level === "red")).toBe(true);
    // A clean platform has no alerts.
    const clean = { ...st, databases: { queried: 1, failed: 0 }, totals: emptyMetrics(NOW), dbs: [] };
    expect(deriveAlerts(clean)).toEqual([]);
  });

  it("renders the ops view and the alerts strip at several sizes", () => {
    for (const [cols, rows] of [[80, 30], [100, 40], [120, 40], [160, 50], [200, 60]] as const) {
      const frame = renderFrame({ ...stateFor("ops", true) }, cols, rows);
      expect(frame).toHaveLength(rows);
      for (const row of frame) expect(width(row)).toBe(cols);
      const text = frame.join("\n");
      expect(text).toContain("E-invoicing");
      if (cols >= 120) expect(text).toContain("Recent failures"); // narrower layouts stack panels and may run out of rows
      expect(frame[1]).toContain("●"); // alerts strip has at least one red chip
    }
    const natural = renderFrame(stateFor("ops"), 150).join("\n");
    expect(natural).toContain("Duplicate IRN");
    // An empty failure feed still says so.
    const quiet = stateFor("ops");
    quiet.stats = { ...quiet.stats!, failures: [] };
    expect(renderFrame(quiet, 150).join("\n")).toContain("no recent failures");
    // All-clear strip.
    const calm = stateFor("overview", true);
    calm.stats = { ...calm.stats!, databases: { queried: 1, failed: 0 }, totals: emptyMetrics(NOW), dbs: [] };
    expect(renderFrame(calm, 120, 30)[1]).toContain("all systems nominal");
  });

  it("truncates the alerts strip with a +N more marker when narrow", () => {
    const frame = renderFrame(stateFor("overview", true), 60, 30);
    expect(frame[1]).toMatch(/\+\d+ more/);
    expect(width(frame[1])).toBe(60);
  });

  it("masks GSTINs, emails and phone numbers inside failure messages", () => {
    expect(maskFreeText("GSTIN 27AAPFU0939F1ZV inactive")).toBe(`GSTIN 27${"•".repeat(11)}ZV inactive`);
    expect(maskFreeText("call 9876543210 or a@b.in")).toBe("call 98•••••••• or a••@b••.in");
    expect(maskFreeText("+91 9876543210")).toBe("+9••••••••••••");
    const masked = maskStats(buildDemoStats(NOW));
    const rec = masked.failures.find((f) => f.kind === "recurring")!;
    expect(rec.ref).toBe("Mon••••••");
    expect(masked.failures.every((f) => !f.tenantName || /^Tenant [0-9a-f]{6}$/.test(f.tenantName))).toBe(true);
  });
});

// =============================================================================
// Infra & migration drift
// =============================================================================

describe("migration drift", () => {
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const journal: Journal = {
    dir: "/x",
    entries: [
      { tag: "0000_a", when: 1000, hash: sha("a") },
      { tag: "0001_b", when: 2000, hash: sha("b") },
      { tag: "0002_c", when: 3000, hash: sha("c") },
    ],
  };

  it("reports in sync when every journal entry is applied", () => {
    const m = compareMigrations("tenant", journal, { table: "__drizzle_migrations", applied: 3, latestWhen: 3000, hashes: [sha("a"), sha("b"), sha("c")] });
    expect(m.status).toBe("in_sync");
    expect(m.pending).toEqual([]);
    expect(m.latestApplied).toBe("0002_c");
    expect(m.expected).toBe(3);
  });

  it("lists pending tags when the database is behind (drizzle's timestamp rule)", () => {
    const m = compareMigrations("tenant", journal, { table: "__drizzle_migrations", applied: 1, latestWhen: 1000, hashes: [sha("a")] });
    expect(m.status).toBe("behind");
    expect(m.pending).toEqual(["0001_b", "0002_c"]);
    expect(m.latestApplied).toBe("0000_a");
  });

  it("flags a database ahead of the build when it holds hashes the journal does not know", () => {
    const m = compareMigrations("tenant", journal, { table: "__drizzle_migrations", applied: 4, latestWhen: 4000, hashes: [sha("a"), sha("b"), sha("c"), sha("future")] });
    expect(m.status).toBe("ahead");
    expect(m.unknownApplied).toBe(1);
  });

  it("distinguishes untracked databases and missing journals", () => {
    expect(compareMigrations("tenant", journal, { table: null, applied: 0, latestWhen: null, hashes: [] }).status).toBe("untracked");
    const nj = compareMigrations("tenant", null, { table: "__drizzle_migrations", applied: 2, latestWhen: 2000, hashes: [] });
    expect(nj.status).toBe("no_journal");
    expect(nj.expected).toBe(0);
  });

  it("reads a journal folder and hashes its SQL files like the migrator does", () => {
    const dir = mkdtempSync(join(tmpdir(), "hisaabo-journal-"));
    try {
      mkdirSync(join(dir, "meta"));
      writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ entries: [{ idx: 1, tag: "0001_two", when: 20 }, { idx: 0, tag: "0000_one", when: 10 }] }));
      writeFileSync(join(dir, "0000_one.sql"), "create table one();");
      const j = readJournal(dir)!;
      expect(j.entries.map((e) => e.tag)).toEqual(["0000_one", "0001_two"]); // sorted by when
      expect(j.entries[0].hash).toBe(sha("create table one();"));
      expect(j.entries[1].hash).toBeNull(); // SQL file missing
      expect(readJournal(join(dir, "nope"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the repo's real journals from the monorepo root and from the bin folder", () => {
    const repoRoot = join(process.cwd(), "..", "..");
    const fromCwd = loadJournals({ here: "/nonexistent", cwd: repoRoot });
    expect(fromCwd.tenant?.entries.length).toBeGreaterThan(0);
    expect(fromCwd.control?.entries.length).toBeGreaterThan(0);
    expect(fromCwd.unified?.entries.length).toBeGreaterThan(0);
    expect(fromCwd.tenant!.entries.every((e) => e.hash)).toBe(true);
    const fromBin = loadJournals({ here: join(process.cwd(), "src", "bin"), cwd: "/nonexistent" });
    expect(fromBin.tenant?.dir).toBe(fromCwd.tenant?.dir);
    expect(journalDirCandidates("tenant", { here: "/a/b/c", cwd: "/w", override: "/o" })[0]).toBe("/o/drizzle-tenant");
  });

  it("only ever queries the known tracking tables", () => {
    expect(appliedMigrationsSql(MIGRATION_TABLES.tenant)).toContain('"drizzle"."__drizzle_tenant_migrations"');
    expect(appliedMigrationsSql(MIGRATION_TABLES.unified)).toContain('"drizzle"."__drizzle_migrations"');
    expect(() => appliedMigrationsSql("users; drop table users")).toThrow();
    expect(journalKindFor("control", "multi-db")).toBe("control");
    expect(journalKindFor("tenant", "multi-db")).toBe("tenant");
    expect(journalKindFor("control", "shared-db")).toBe("unified");
  });
});

describe("infra", () => {
  it("parses per-database health and tolerates nulls", () => {
    const i = parseInfra({ size_bytes: "1048576", connections: 3, cache_hit: null, dead_tuples: 12, live_tuples: "100", bloat_top: [{ table: "invoices", dead: 9, live: 1 }], drizzle_tables: ["__drizzle_migrations"] });
    expect(i.sizeBytes).toBe(1048576);
    expect(i.cacheHit).toBeNull();
    expect(i.deadTuples).toBe(12);
    expect(i.bloatTop).toEqual([{ table: "invoices", dead: 9, live: 1 }]);
    expect(i.drizzleTables).toEqual(["__drizzle_migrations"]);
    expect(parseInfra(null).tables).toBe(0);
  });

  it("fmtBytes uses binary units", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(48 * 1024 * 1024)).toBe("48.0 MB");
    expect(fmtBytes(1.9 * 1024 ** 3)).toBe("1.90 GB");
  });

  it("sortDbs puts the control db first, then problems, then the largest", () => {
    const sorted = sortDbs(buildDemoStats(NOW).dbs);
    expect(sorted[0].kind).toBe("control");
    const statuses = sorted.slice(1).map((d) => (d.migrations ? d.migrations.status : d.error ? "error" : "none"));
    expect(statuses[0]).toBe("error"); // unreachable first
    expect(statuses.slice(1, 3)).toEqual(["behind", "behind"]);
    expect(statuses.at(-1)).toBe("in_sync");
  });

  it("derives migration and health alerts", () => {
    const texts = deriveAlerts(buildDemoStats(NOW)).map((a) => `${a.level}:${a.text}`);
    expect(texts).toContain("red:2 dbs behind on migrations");
    expect(texts).toContain("yellow:1 db ahead of this build");
    expect(texts).toContain("yellow:1 db with untracked migrations");
    expect(texts.some((t) => t.startsWith("yellow:1 db with > 20% dead tuples"))).toBe(true);
    expect(texts).toContain("yellow:2 deadlocks since stats reset");
  });

  it("renders the infra view at several sizes without leaking tenant names", () => {
    for (const [cols, rows] of [[80, 30], [100, 40], [150, 50], [200, 60]] as const) {
      const state = stateFor("infra", true);
      state.stats = maskStats(state.stats!);
      const frame = renderFrame(state, cols, rows);
      expect(frame).toHaveLength(rows);
      for (const row of frame) expect(width(row)).toBe(cols);
      const text = frame.join("\n");
      expect(text).toContain("Migrations");
      expect(text).not.toContain("Verma");
      expect(text).not.toContain("tenant_verma");
    }
    const natural = renderFrame(stateFor("infra"), 150).join("\n");
    expect(natural).toContain("▼ behind 1");
    expect(natural).toContain("▲ ahead +1");
    expect(natural).toContain("0003_needy_siren");
    expect(natural).toContain("Tables needing vacuum");
  });
});
