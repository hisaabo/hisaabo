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
import { buildDemoStats } from "../lib/admin/demo.js";
import { parseEnvFile, pickPsqlError, DirectRunner } from "../lib/admin/runners.js";
import { maskEmail, maskName, maskWord, maskDbName, tenantHandle, maskStats } from "../lib/admin/privacy.js";
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
