/**
 * screens.ts — Composes dashboard frames from a PlatformStats snapshot.
 *
 * Pure: (state, cols, rows) → string[]. The bin wrapper owns stdout,
 * keyboard, timers; this module only decides what goes where.
 */

import {
  c, box, kpiTile, hstack, vstack, fitHeight, splitWidth, columnChart, sparkline, breakdown,
  table, key, fit, pad, spread, truncate, repeat, width,
  fmtInt, fmtINRCompact, fmtMonth, fmtRelative, fmtClock, fmtDuration, fmtUptime, fmtDate, fmtPct,
  PLAN_STYLE, STATUS_STYLE, type Style,
} from "./tui.js";
import type { PlatformStats, TenantWithMetrics, TenantMetrics, PlatformFailure } from "./stats.js";
import { deriveAlerts, type Alert } from "./alerts.js";

export type View = "overview" | "tenants" | "ops";

export interface ViewState {
  view: View;
  stats: PlatformStats | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Tenants view: index of the highlighted row (into the sorted list). */
  selected: number;
  interactive: boolean;
  intervalSec: number;
  nextRefreshAt: number | null;
  runnerLabel: string;
  version: string;
  now: Date;
  /** True when PII in `stats` is masked (the default). */
  masked: boolean;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MIN_COLS = 60;

// ── Shared chrome ───────────────────────────────────────────────

function header(s: ViewState, cols: number): string {
  const brand = c.brandBg(c.ink(c.bold(" ◆ HISAABO ADMIN ")));
  const parts: string[] = [c.muted(`v${s.version}`)];
  if (s.stats) {
    const dbs = s.stats.databases.queried;
    parts.push(s.stats.mode === "multi-db" ? `multi-db · ${dbs} db${dbs === 1 ? "" : "s"}` : "shared-db");
  }
  parts.push(s.runnerLabel);
  const privacy = s.masked ? c.muted("PII masked") : c.warn("PII visible");
  const left = brand + " " + [...parts.map((p) => c.muted(p)), privacy].join(c.faint(" │ "));

  let status: string;
  if (!s.interactive) {
    status = c.muted(s.stats ? `snapshot · ${fmtDate(s.stats.collectedAt)}` : "snapshot");
  } else if (s.refreshing || s.loading) {
    status = c.brand(`${SPINNER[Math.floor(s.now.getTime() / 100) % SPINNER.length]} refreshing`);
  } else if (s.nextRefreshAt) {
    const secs = Math.max(0, Math.ceil((s.nextRefreshAt - s.now.getTime()) / 1000));
    status = c.muted(`↻ ${secs}s`);
  } else {
    status = "";
  }
  const right = status + "  " + c.bold(c.white(fmtClock(s.now)));
  return spread(left, right, cols);
}

function footer(s: ViewState, cols: number): string {
  let left: string;
  if (s.interactive) {
    const keys = [
      key("1", "Overview"),
      key("2", "Tenants"),
      key("3", "Ops"),
      key("r", "Refresh"),
      ...(s.view === "tenants" ? [key("↑↓", "Select")] : []),
      key("p", s.masked ? "Reveal PII" : "Mask PII"),
      key("q", "Quit"),
    ];
    left = keys.join("  ");
  } else {
    left = c.muted("hisaabo admin · run with a TTY for the live dashboard");
  }
  let right: string;
  if (s.error) {
    right = c.bad("⚠ " + truncate(s.error, Math.max(10, Math.floor(cols / 2))));
  } else if (s.stats) {
    right = c.muted(`updated ${fmtClock(new Date(s.stats.collectedAt))} in ${fmtDuration(s.stats.durationMs)}`);
    if (s.stats.databases.failed > 0) right = c.warn(`${s.stats.databases.failed} db${s.stats.databases.failed === 1 ? "" : "s"} unreachable`) + "  " + right;
  } else {
    right = "";
  }
  return spread(left, right, cols);
}

function centered(lines: string[], cols: number, rows: number): string[] {
  const top = Math.max(0, Math.floor((rows - lines.length) / 2));
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = lines[i - top];
    out.push(l !== undefined ? fit(pad(l, cols, "center"), cols) : " ".repeat(cols));
  }
  return out;
}

function finish(head: string, body: string[], foot: string, cols: number, rows?: number): string[] {
  const inner = rows !== undefined ? fitHeight(body, Math.max(0, rows - 2), cols) : body.map((l) => fit(l, cols));
  return [fit(head, cols), ...inner, fit(foot, cols)];
}

// ── Overview ────────────────────────────────────────────────────

function newSince(iso: string[], days: number, now: Date): number {
  const cutoff = now.getTime() - days * 86_400_000;
  return iso.filter((d) => new Date(d).getTime() >= cutoff).length;
}

function trendLabel(curr: number, prev: number): string {
  if (prev <= 0 && curr <= 0) return c.muted("no change");
  if (prev <= 0) return c.ok("▲ new");
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return c.muted("→ flat");
  return pct > 0 ? c.ok(`▲ ${pct}%`) : c.bad(`▼ ${Math.abs(pct)}%`);
}

function kpiRow(st: PlatformStats, cols: number, now: Date): string[] {
  const t = st.totals;
  const ctl = st.control;
  const liveTenants = ctl.tenants.filter((x) => x.status !== "deleted");
  const suspended = liveTenants.filter((x) => x.status === "suspended").length;
  const newTenants = newSince(liveTenants.map((x) => x.createdAt), 30, now);
  const up = (n: number, label: string) => (n > 0 ? c.ok(`▲ ${fmtInt(n)} ${label}`) : c.muted(`no ${label}`));

  // Each tile carries a primary sub-line and an optional secondary one that
  // is only shown when the tile is wide enough to fit both.
  const tiles: { label: string; value: string; sub: string; extra?: string; accent: Style }[] = [
    { label: "Tenants", value: fmtInt(liveTenants.length), sub: up(newTenants, "new · 30d"), extra: suspended ? c.warn(`${suspended} suspended`) : undefined, accent: c.brand },
    { label: "Users", value: fmtInt(ctl.users.total), sub: up(ctl.users.new7d, "new · 7d"), extra: c.muted(`${fmtInt(ctl.users.verified)} verified`), accent: c.info },
    { label: "Businesses", value: fmtInt(t.businesses), sub: c.muted(`${fmtInt(t.gstBusinesses)} GST reg.`), extra: c.muted(`${fmtInt(t.storesEnabled)} stores`), accent: c.teal },
    { label: "Invoices", value: fmtInt(t.invoices), sub: up(t.invoices30d, "last 30d"), extra: c.muted(`${fmtInt(t.otherDocuments)} other docs`), accent: c.violet },
    { label: "Amount managed", value: fmtINRCompact(t.salesTotal + t.purchaseTotal), sub: c.muted(`sales ${fmtINRCompact(t.salesTotal)}`), extra: c.muted(`buys ${fmtINRCompact(t.purchaseTotal)}`), accent: c.brand },
    { label: "Collected", value: fmtINRCompact(t.paymentsTotal), sub: c.muted(`${fmtInt(t.payments)} payments`), extra: c.muted(`${fmtPct(t.paymentsTotal, t.salesTotal)} of sales`), accent: c.ok },
    { label: "Receivable", value: fmtINRCompact(t.receivable), sub: c.muted(`payable ${fmtINRCompact(t.payable)}`), accent: t.receivable > 0 ? c.warn : c.ok },
    { label: "Expenses", value: fmtINRCompact(t.expensesTotal), sub: c.muted(`${fmtInt(t.expenses)} entries`), accent: c.bad },
  ];

  // 8 tiles → 8, 4 or 2 per row so rows are always full.
  const perRow = cols >= 8 * 19 - 1 ? 8 : cols >= 4 * 19 - 1 ? 4 : 2;
  const widths = splitWidth(cols, perRow, 1);
  const out: string[] = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    const chunk = tiles.slice(i, i + perRow);
    const blocks = chunk.map((tile, j) => {
      const inner = widths[j] - 4;
      const both = tile.extra ? tile.sub + c.muted(" · ") + tile.extra : tile.sub;
      const sub = width(both) <= inner ? both : tile.sub;
      return kpiTile({ label: tile.label, value: tile.value, sub, accent: tile.accent, width: widths[j], subStyle: (s) => s });
    });
    out.push(...hstack(blocks, 1));
  }
  return out;
}

function chartPanel(st: PlatformStats, w: number, h: number): string[] {
  const t = st.totals;
  const innerW = w - 4;
  const innerH = h - 2;
  const values = t.monthly.map((m) => m.amount);
  const counts = t.monthly.map((m) => m.count);
  const yearTotal = values.reduce((a, b) => a + b, 0);
  const last = t.monthly[t.monthly.length - 1];
  const prev = t.monthly[t.monthly.length - 2];

  const chartH = Math.max(3, innerH - 3);
  const lines = columnChart({
    values,
    labels: t.monthly.map((m) => fmtMonth(m.month)),
    width: innerW,
    height: chartH,
    yFormat: (n) => (n === 0 ? "0" : fmtINRCompact(n)),
  });
  lines.push(
    spread(
      c.muted("invoices ") + sparkline(counts, c.info) + c.muted(` ${fmtInt(counts.reduce((a, b) => a + b, 0))} in 12m`),
      c.muted("this month ") + c.bold(c.white(fmtINRCompact(last?.amount ?? 0))) + " " + trendLabel(last?.amount ?? 0, prev?.amount ?? 0),
      innerW,
    ),
  );
  return box({ title: "Sales invoiced · last 12 months", hint: fmtINRCompact(yearTotal), width: w, height: h, lines });
}

function breakdownPanel(st: PlatformStats, w: number, h: number): string[] {
  const innerW = w - 4;
  const live = st.control.tenants.filter((x) => x.status !== "deleted");
  const plans = ["free", "pro", "business", "enterprise"].map((plan) => ({
    label: plan,
    value: live.filter((x) => x.plan === plan).length,
    style: PLAN_STYLE[plan],
  }));
  const statuses = Object.entries(st.totals.byStatus)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([status, n]) => ({ label: status, value: n, style: STATUS_STYLE[status] ?? c.muted }));

  const lines = [
    c.bold(c.muted("TENANTS BY PLAN")),
    ...breakdown(plans, innerW),
    "",
    c.bold(c.muted("INVOICE STATUS")),
    ...breakdown(statuses, innerW),
  ];
  return box({ title: "Breakdown", width: w, height: h, lines });
}

export function sortTenants(st: PlatformStats): TenantWithMetrics[] {
  const score = (t: TenantWithMetrics) => (t.metrics && !t.sharedDb ? t.metrics.salesTotal : -1);
  return [...st.tenants].sort((a, b) => {
    const aDeleted = a.status === "deleted";
    const bDeleted = b.status === "deleted";
    if (aDeleted !== bDeleted) return aDeleted ? 1 : -1;
    const d = score(b) - score(a);
    if (d !== 0) return d;
    const m = b.members - a.members;
    if (m !== 0) return m;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function planCell(plan: string): string {
  return (PLAN_STYLE[plan] ?? c.muted)(plan);
}

function statusCell(status: string): string {
  return (STATUS_STYLE[status] ?? c.muted)(status);
}

function topTenantsPanel(st: PlatformStats, w: number, h: number, now: Date): string[] {
  const innerW = w - 4;
  const maxRows = Math.max(1, h - 2 - 2);
  const sorted = sortTenants(st).filter((t) => t.status !== "deleted");
  const rows = sorted.slice(0, maxRows);
  const multi = st.mode === "multi-db";
  const cols = multi
    ? [
        { key: "rank", label: "#", width: 2, align: "right" as const, render: (t: TenantWithMetrics) => c.muted(String(sorted.indexOf(t) + 1)) },
        { key: "name", label: "Tenant", flex: true, render: (t: TenantWithMetrics) => c.white(t.name) },
        { key: "plan", label: "Plan", render: (t: TenantWithMetrics) => planCell(t.plan) },
        { key: "biz", label: "Biz", align: "right" as const, render: (t: TenantWithMetrics) => (t.metrics ? fmtInt(t.metrics.businesses) : c.bad("—")) },
        { key: "inv", label: "Invoices", align: "right" as const, render: (t: TenantWithMetrics) => (t.metrics ? fmtInt(t.metrics.invoices) : c.bad("—")) },
        { key: "sales", label: "Sales", align: "right" as const, render: (t: TenantWithMetrics) => (t.metrics ? c.brand(fmtINRCompact(t.metrics.salesTotal)) : c.bad("unreachable")) },
        { key: "last", label: "Activity", align: "right" as const, render: (t: TenantWithMetrics) => c.muted(fmtRelative(t.metrics?.lastInvoiceAt, now)) },
      ]
    : [
        { key: "name", label: "Tenant", flex: true, render: (t: TenantWithMetrics) => c.white(t.name) },
        { key: "slug", label: "Slug", render: (t: TenantWithMetrics) => c.muted(t.slug) },
        { key: "plan", label: "Plan", render: (t: TenantWithMetrics) => planCell(t.plan) },
        { key: "status", label: "Status", render: (t: TenantWithMetrics) => statusCell(t.status) },
        { key: "members", label: "Members", align: "right" as const, render: (t: TenantWithMetrics) => fmtInt(t.members) },
        { key: "created", label: "Created", align: "right" as const, render: (t: TenantWithMetrics) => c.muted(fmtRelative(t.createdAt, now)) },
      ];
  const lines = table({ columns: cols, rows, width: innerW, emptyText: "no tenants yet" });
  return box({
    title: multi ? "Top tenants by sales" : "Tenants",
    hint: `${rows.length} of ${sorted.length}`,
    width: w,
    height: h,
    lines,
  });
}

function kv(label: string, value: string, labelW = 12): string {
  return c.muted(pad(label, labelW)) + value;
}

function maintenanceCell(st: PlatformStats): string {
  const m = st.control.maintenance;
  if (!m) return c.ok("off");
  if (m.enabled) return c.bad(c.bold("ACTIVE")) + (m.message ? c.muted(` · ${m.message}`) : "");
  if (m.startsAt && new Date(m.startsAt) > new Date(st.collectedAt)) return c.warn("scheduled") + c.muted(` · ${fmtDate(m.startsAt)}`);
  return c.ok("off");
}

function platformPanel(st: PlatformStats, w: number, h: number, now: Date): string[] {
  const t = st.totals;
  const ctl = st.control;
  const dbUse = ctl.db.maxConnections > 0 ? `${ctl.db.connections}/${ctl.db.maxConnections} conns` : `${ctl.db.connections} conns`;
  const lines = [
    kv("Sessions", c.white(fmtInt(ctl.sessions.active)) + c.muted(` active · ${fmtInt(ctl.sessions.used24h)} used 24h · ${fmtInt(ctl.sessions.web)} web / ${fmtInt(ctl.sessions.bearer)} app`)),
    kv("API keys", c.white(fmtInt(ctl.apiKeys.active)) + c.muted(` active · ${fmtInt(ctl.apiKeys.used7d)} used 7d`)),
    kv("Invites", ctl.pendingInvitations > 0 ? c.warn(fmtInt(ctl.pendingInvitations)) + c.muted(" pending") : c.muted("none pending")),
    kv("Catalogue", c.white(fmtInt(t.parties)) + c.muted(" parties · ") + c.white(fmtInt(t.items)) + c.muted(" items")),
    kv("Store", c.white(fmtInt(t.storesEnabled)) + c.muted(" live · ") + c.white(fmtInt(t.storeOrders)) + c.muted(" orders · ") + c.brand(fmtINRCompact(t.storeOrdersTotal))),
    kv("E-invoices", c.white(fmtInt(t.eInvoices)) + c.muted(" with IRN · ") + c.white(fmtInt(t.otherDocuments)) + c.muted(" other docs")),
    kv("Maintenance", maintenanceCell(st)),
    kv("Postgres", c.white(ctl.db.version) + c.muted(` · ${ctl.db.totalSizePretty} · ${dbUse} · up ${fmtUptime(ctl.db.uptimeSeconds)}`)),
  ];
  const remaining = h - 2 - lines.length;
  if (remaining >= 3 && ctl.recentUsers.length > 0) {
    lines.push("", c.bold(c.muted("NEWEST SIGNUPS")));
    for (const u of ctl.recentUsers.slice(0, remaining - 2)) {
      lines.push(spread(c.white(u.email) + (u.name ? c.muted(` · ${u.name}`) : ""), c.muted(fmtRelative(u.createdAt, now)), w - 4));
    }
  }
  return box({ title: "Platform", width: w, height: h, lines });
}

function overviewBody(s: ViewState, st: PlatformStats, cols: number, rows?: number): string[] {
  const tiles = kpiRow(st, cols, s.now);
  const twoCol = cols >= 100;
  const [leftW, rightW] = twoCol ? [Math.ceil(cols * 0.58) - 1, cols - Math.ceil(cols * 0.58)] : [cols, cols];

  // Budget the remaining rows between the middle and bottom bands.
  let middleH: number;
  let bottomH: number;
  if (rows === undefined) {
    middleH = 15;
    bottomH = twoCol ? 14 : 12;
  } else {
    const avail = rows - 2 - tiles.length; // header/footer + tiles
    if (avail < 9) {
      middleH = Math.max(0, avail);
      bottomH = 0;
    } else if (avail < 19) {
      middleH = avail;
      bottomH = 0;
    } else {
      middleH = Math.max(11, Math.round(avail * 0.52));
      bottomH = avail - middleH;
    }
  }

  const bands: string[][] = [tiles];
  if (middleH >= 6) {
    if (twoCol) bands.push(hstack([chartPanel(st, leftW, middleH), breakdownPanel(st, rightW, middleH)], 1));
    else bands.push(chartPanel(st, cols, middleH));
  }
  if (bottomH >= 6) {
    if (twoCol) bands.push(hstack([topTenantsPanel(st, leftW, bottomH, s.now), platformPanel(st, rightW, bottomH, s.now)], 1));
    else bands.push(platformPanel(st, cols, bottomH, s.now));
  }
  if (rows === undefined && !twoCol) {
    bands.push(breakdownPanel(st, cols, 14), topTenantsPanel(st, cols, 12, s.now));
  }
  return vstack(bands, cols, 0);
}

// ── Tenants view ────────────────────────────────────────────────

function tenantDetail(t: TenantWithMetrics, w: number, h: number, now: Date): string[] {
  const innerW = w - 4;
  const m: TenantMetrics | null = t.metrics;
  const colW = splitWidth(innerW, 3, 2);
  const col1 = [
    kv("Slug", c.white(t.slug), 9),
    kv("Plan", planCell(t.plan), 9),
    kv("Status", statusCell(t.status), 9),
    kv("Members", c.white(fmtInt(t.members)), 9),
    kv("Created", c.muted(fmtDate(t.createdAt)), 9),
  ];
  const col2 = m
    ? [
        kv("Invoices", c.white(fmtInt(m.invoices)) + c.muted(` · ${fmtInt(m.salesInvoices)} sale / ${fmtInt(m.purchaseInvoices)} buy`), 11),
        kv("Sales", c.brand(fmtINRCompact(m.salesTotal)) + c.muted(` · receivable ${fmtINRCompact(m.receivable)}`), 11),
        kv("Purchases", c.white(fmtINRCompact(m.purchaseTotal)) + c.muted(` · payable ${fmtINRCompact(m.payable)}`), 11),
        kv("Collected", c.ok(fmtINRCompact(m.paymentsTotal)) + c.muted(` · ${fmtInt(m.payments)} payments`), 11),
        kv("Expenses", c.bad(fmtINRCompact(m.expensesTotal)) + c.muted(` · ${fmtInt(m.expenses)} entries`), 11),
      ]
    : t.error
      ? [c.bad("⚠ database unreachable"), c.muted(truncate(t.error, colW[1] + colW[2])), "", c.muted(t.dbKey)]
      : [c.muted(t.status === "deleted" ? "tenant deleted — no database queried" : "no metrics"), c.muted(t.sharedDb ? "shared control database" : t.dbKey)];
  const col3 = m
    ? [
        kv("Businesses", c.white(fmtInt(m.businesses)) + c.muted(` · ${fmtInt(m.gstBusinesses)} GST`), 11),
        kv("Catalogue", c.white(fmtInt(m.parties)) + c.muted(" parties · ") + c.white(fmtInt(m.items)) + c.muted(" items"), 11),
        kv("Store", c.white(fmtInt(m.storeOrders)) + c.muted(" orders · ") + c.brand(fmtINRCompact(m.storeOrdersTotal)), 11),
        kv("Activity", c.muted(fmtRelative(m.lastInvoiceAt, now)) + c.muted(` · ${fmtInt(m.invoices30d)} in 30d`), 11),
        kv("12 months", sparkline(m.monthly.map((p) => p.amount), c.brand) + c.muted(` ${fmtINRCompact(m.monthly.reduce((a, p) => a + p.amount, 0))}`), 11),
      ]
    : [];
  const lines = hstack([fitHeight(col1, 5, colW[0]), fitHeight(col2, 5, colW[1]), fitHeight(col3, 5, colW[2])], 2);
  return box({ title: t.name, hint: t.sharedDb ? "shared db" : t.dbName ?? "", width: w, height: h, lines, titleStyle: (s: string) => c.bold(c.brand(s)) });
}

function tenantsBody(s: ViewState, st: PlatformStats, cols: number, rows?: number): string[] {
  const sorted = sortTenants(st);
  const multi = st.mode === "multi-db";
  const selected = Math.min(Math.max(0, s.selected), Math.max(0, sorted.length - 1));

  const showDetail = rows === undefined ? true : rows >= 24;
  const detailH = showDetail ? 7 : 0;
  const listH = rows === undefined ? Math.min(sorted.length, 30) + 4 : rows - 2 - detailH;
  const visible = Math.max(1, listH - 4);
  let offset = 0;
  if (selected >= visible) offset = selected - visible + 1;
  const windowRows = sorted.slice(offset, offset + visible);

  const m = (t: TenantWithMetrics, f: (m: TenantMetrics) => string, unreachable = c.bad("—")) =>
    t.metrics ? f(t.metrics) : t.error ? unreachable : c.faint("—");
  const columns = [
    { key: "rank", label: "#", width: 3, align: "right" as const, render: (t: TenantWithMetrics) => c.muted(String(sorted.indexOf(t) + 1)) },
    { key: "name", label: "Tenant", flex: true, render: (t: TenantWithMetrics) => c.white(t.name) },
    { key: "slug", label: "Slug", render: (t: TenantWithMetrics) => c.muted(truncate(t.slug, 18)) },
    { key: "plan", label: "Plan", render: (t: TenantWithMetrics) => planCell(t.plan) },
    { key: "status", label: "Status", render: (t: TenantWithMetrics) => statusCell(t.status) },
    { key: "members", label: "Users", align: "right" as const, render: (t: TenantWithMetrics) => fmtInt(t.members) },
    ...(multi
      ? [
          { key: "biz", label: "Biz", align: "right" as const, render: (t: TenantWithMetrics) => m(t, (x) => fmtInt(x.businesses)) },
          { key: "inv", label: "Invoices", align: "right" as const, render: (t: TenantWithMetrics) => m(t, (x) => fmtInt(x.invoices)) },
          { key: "sales", label: "Sales", align: "right" as const, render: (t: TenantWithMetrics) => m(t, (x) => c.brand(fmtINRCompact(x.salesTotal)), c.bad("unreachable")) },
          { key: "recv", label: "Receivable", align: "right" as const, render: (t: TenantWithMetrics) => m(t, (x) => (x.receivable > 0 ? c.warn : c.muted)(fmtINRCompact(x.receivable))) },
          { key: "last", label: "Activity", align: "right" as const, render: (t: TenantWithMetrics) => c.muted(fmtRelative(t.metrics?.lastInvoiceAt, s.now)) },
        ]
      : []),
    { key: "created", label: "Created", align: "right" as const, render: (t: TenantWithMetrics) => c.muted(fmtDate(t.createdAt)) },
  ];
  const lines = table({ columns, rows: windowRows, width: cols - 4, selected: selected - offset, emptyText: "no tenants yet" });
  const scrollHint = sorted.length > visible ? ` · ${offset + 1}–${Math.min(sorted.length, offset + visible)} of ${sorted.length}` : "";
  const list = box({
    title: "Tenants",
    hint: `${sorted.length} total · sorted by ${multi ? "sales" : "members"}${scrollHint}`,
    width: cols,
    height: listH,
    lines,
  });
  const bands = [list];
  if (showDetail && sorted[selected]) bands.push(tenantDetail(sorted[selected], cols, detailH, s.now));
  return vstack(bands, cols, 0);
}

// ── Alerts strip ────────────────────────────────────────────────

function alertChip(a: Alert): string {
  const paint = a.level === "red" ? (t: string) => c.bold(c.bad(t)) : c.warn;
  return paint((a.level === "red" ? "● " : "◐ ") + a.text);
}

/** One line under the header: red/yellow chips, or a green all-clear. */
export function alertsStrip(st: PlatformStats, cols: number): string {
  const alerts = deriveAlerts(st);
  if (alerts.length === 0) return fit(" " + c.ok("✓ all systems nominal"), cols);
  const sep = c.faint("  │  ");
  let line = " ";
  let shown = 0;
  for (const a of alerts) {
    const chip = alertChip(a);
    const candidate = line + (shown ? sep : "") + chip;
    const remaining = alerts.length - shown - 1;
    const reserve = remaining > 0 ? width(sep) + 6 : 0; // room for "+N more"
    if (width(candidate) + reserve > cols) break;
    line = candidate;
    shown++;
  }
  if (shown < alerts.length) line += sep + c.muted(`+${alerts.length - shown} more`);
  return fit(line, cols);
}

// ── Ops health ──────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  einvoice: "e-invoice",
  recurring: "recurring",
  bank_import: "bank import",
  store_order: "store order",
};

function stat(label: string, value: number, style: Style = c.white, suffix = ""): string {
  return c.muted(label + " ") + (value > 0 ? style(fmtInt(value)) : c.faint("0")) + (suffix ? c.muted(suffix) : "");
}

function eInvoicePanel(st: PlatformStats, w: number, h: number): string[] {
  const e = st.totals.ops.eInvoice;
  const innerW = w - 4;
  const lines = breakdown(
    [
      { label: "generated", value: e.generated, style: c.ok },
      { label: "pending", value: e.pending, style: e.stalePending ? c.warn : c.info },
      { label: "failed", value: e.failed, style: c.bad },
      { label: "cancelled", value: e.cancelled, style: c.faint },
    ],
    innerW,
  );
  lines.push("");
  lines.push(stat("stale pending", e.stalePending, c.warn, " · > 1h") + "   " + stat("out of retries", e.exhausted, c.bad));
  return box({ title: "E-invoicing (IRP)", hint: `${fmtInt(e.generated + e.pending + e.failed + e.cancelled)} total`, width: w, height: h, lines });
}

function recurringPanel(st: PlatformStats, w: number, h: number): string[] {
  const r = st.totals.ops.recurring;
  const innerW = w - 4;
  const lines = [
    stat("templates", r.activeTemplates, c.white, " active") + "  " + stat("paused", r.pausedTemplates, c.muted) + "  " + stat("overdue", r.overdueTemplates, c.warn),
    "",
    c.bold(c.muted("RUNS · LAST 7 DAYS")),
    ...breakdown(
      [
        { label: "succeeded", value: r.ok7d, style: c.ok },
        { label: "failed", value: r.failed7d, style: c.bad },
        { label: "skipped", value: r.skipped7d, style: c.warn },
      ],
      innerW,
    ),
    "",
    c.muted("30 days  ") + c.ok(fmtInt(r.ok30d)) + c.muted(" ok · ") + (r.failed30d ? c.bad(fmtInt(r.failed30d)) : c.faint("0")) + c.muted(" failed"),
  ];
  return box({ title: "Recurring invoices", width: w, height: h, lines });
}

function ewbPanel(st: PlatformStats, w: number, h: number): string[] {
  const e = st.totals.ops.ewb;
  const innerW = w - 4;
  const lines = breakdown(
    [
      { label: "active", value: e.active, style: c.ok },
      { label: "expired", value: e.expired, style: c.muted },
      { label: "cancelled", value: e.cancelled, style: c.faint },
    ],
    innerW,
  );
  lines.push("");
  lines.push(stat("expiring 24h", e.expiring24h, c.warn) + "   " + stat("past validity", e.overdueExpiry, c.bad));
  return box({ title: "E-way bills", width: w, height: h, lines });
}

function bankPanel(st: PlatformStats, w: number, h: number): string[] {
  const b = st.totals.ops.bank;
  const innerW = w - 4;
  const matchedTotal = b.matched30d + b.unmatched30d;
  const lines = [
    stat("imports", b.imports, c.white) + "  " + stat("completed", b.completed, c.ok),
    stat("in progress", b.inProgress, c.info) + "  " + stat("review", b.review, c.warn) + "  " + stat("stalled > 3d", b.stale, c.bad),
    "",
    c.bold(c.muted("LINES · LAST 30 DAYS")),
    ...breakdown(
      [
        { label: "matched", value: b.matched30d, style: c.ok },
        { label: "unmatched", value: b.unmatched30d, style: c.warn },
      ],
      innerW,
    ),
    c.muted(matchedTotal > 0 ? `${fmtPct(b.matched30d, matchedTotal)} auto-match rate` : "no statements imported in 30 days"),
  ];
  return box({ title: "Bank reconciliation", width: w, height: h, lines });
}

function gstr2bPanel(st: PlatformStats, w: number, h: number, now: Date): string[] {
  const g = st.totals.ops.gstr2b;
  const lines = [
    stat("uploads", g.uploads, c.white, " all time") + "  " + stat("last 30d", g.uploads30d, c.info),
    stat("unmatched", g.unmatched30d, c.warn, " · 30d") + "  " + stat("new in 2B", g.new30d, c.info, " · 30d"),
    "",
    c.muted("last upload  ") + c.white(fmtRelative(g.lastUploadAt, now)),
  ];
  return box({ title: "GSTR-2B reconciliation", width: w, height: h, lines });
}

function storePanel(st: PlatformStats, w: number, h: number): string[] {
  const o = st.totals.ops;
  const innerW = w - 4;
  const order = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"];
  const orderStyle: Record<string, Style> = { pending: c.warn, confirmed: c.info, preparing: c.violet, ready: c.teal, delivered: c.ok, cancelled: c.faint };
  const orders = order.filter((k) => (o.store.byStatus[k] ?? 0) > 0).map((k) => ({ label: k, value: o.store.byStatus[k], style: orderStyle[k] }));
  const shipOrder = ["pending", "shipped", "in_transit", "delivered", "returned"];
  const shipStyle: Record<string, Style> = { pending: c.muted, shipped: c.info, in_transit: c.violet, delivered: c.ok, returned: c.bad };
  const ships = shipOrder.filter((k) => (o.shipments.byStatus[k] ?? 0) > 0).map((k) => ({ label: k.replace("_", " "), value: o.shipments.byStatus[k], style: shipStyle[k] }));
  const lines = [
    c.bold(c.muted("STORE ORDERS")) + "  " + (o.store.stalePending ? c.warn(`${fmtInt(o.store.stalePending)} unconfirmed > 24h`) : ""),
    ...(orders.length ? breakdown(orders, innerW, { showPct: false }) : [c.muted("no orders")]),
    "",
    c.bold(c.muted("SHIPMENTS")) + "  " + (o.shipments.stuck ? c.warn(`${fmtInt(o.shipments.stuck)} in transit > 7d`) : ""),
    ...(ships.length ? breakdown(ships, innerW, { showPct: false }) : [c.muted("no shipments")]),
  ];
  return box({ title: "Store & fulfilment", width: w, height: h, lines });
}

function failuresPanel(st: PlatformStats, w: number, h: number, now: Date, natural: boolean): string[] {
  const innerW = w - 4;
  const maxRows = natural ? Math.min(st.failures.length, 12) : Math.max(1, h - 4);
  const rows = st.failures.slice(0, maxRows);
  const multi = st.mode === "multi-db";
  const columns = [
    { key: "at", label: "When", align: "right" as const, render: (f: PlatformFailure) => c.muted(fmtRelative(f.at, now)) },
    ...(multi ? [{ key: "tenant", label: "Tenant", render: (f: PlatformFailure) => c.white(truncate(f.tenantName, 22)) }] : []),
    { key: "kind", label: "Kind", render: (f: PlatformFailure) => (f.kind === "einvoice" || f.kind === "recurring" ? c.bad : c.warn)(KIND_LABEL[f.kind] ?? f.kind) },
    { key: "ref", label: "Ref", render: (f: PlatformFailure) => c.muted(truncate(f.ref, 18)) },
    { key: "message", label: "Message", flex: true, render: (f: PlatformFailure) => f.message },
  ];
  const lines = table({ columns, rows, width: innerW, emptyText: "no recent failures — nice" });
  return box({
    title: "Recent failures",
    hint: st.failures.length ? `${rows.length} of ${st.failures.length}` : "",
    width: w,
    height: natural ? Math.max(rows.length, 1) + 4 : h,
    lines,
    titleStyle: (t: string) => c.bold(st.failures.length ? c.bad(t) : c.white(t)),
  });
}

function opsBody(s: ViewState, st: PlatformStats, cols: number, rows?: number): string[] {
  const threeCol = cols >= 120;
  const twoCol = !threeCol && cols >= 90;
  const panelH = 10;
  const bands: string[][] = [];

  const panels1 = [eInvoicePanel, recurringPanel, ewbPanel];
  const panels2 = [bankPanel, (a: PlatformStats, w: number, h: number) => gstr2bPanel(a, w, h, s.now), storePanel];
  const layout = (fns: ((a: PlatformStats, w: number, h: number) => string[])[]) => {
    if (threeCol) {
      const ws = splitWidth(cols, 3, 1);
      return [hstack(fns.map((f, i) => f(st, ws[i], panelH)), 1)];
    }
    if (twoCol) {
      const ws = splitWidth(cols, 2, 1);
      return [hstack([fns[0](st, ws[0], panelH), fns[1](st, ws[1], panelH)], 1), fns[2](st, cols, panelH)];
    }
    return fns.map((f) => f(st, cols, panelH));
  };
  bands.push(...layout(panels1), ...layout(panels2));

  if (rows === undefined) {
    bands.push(failuresPanel(st, cols, 0, s.now, true));
    return vstack(bands, cols, 0);
  }
  const used = bands.reduce((a, b) => a + b.length, 0);
  const left = rows - 3 - used; // header + alerts + footer
  if (left >= 6) bands.push(failuresPanel(st, cols, left, s.now, false));
  return vstack(bands, cols, 0);
}

// ── Entry ───────────────────────────────────────────────────────

export function renderFrame(s: ViewState, colsIn: number, rows?: number): string[] {
  const cols = Math.max(MIN_COLS, colsIn);
  const head = header(s, cols);
  const foot = footer(s, cols);

  if (!s.stats) {
    const spinner = SPINNER[Math.floor(s.now.getTime() / 100) % SPINNER.length];
    const msg = s.error
      ? [c.bad("⚠ could not load platform statistics"), "", c.muted(truncate(s.error, cols - 4)), "", c.muted(s.interactive ? "press r to retry · q to quit" : "")]
      : [c.brand(`${spinner} loading platform statistics`), "", c.muted(s.runnerLabel)];
    const body = rows !== undefined ? centered(msg, cols, rows - 2) : msg.map((l) => fit(pad(l, cols, "center"), cols));
    return finish(head, body, foot, cols, rows);
  }

  const strip = alertsStrip(s.stats, cols);
  const innerRows = rows === undefined ? undefined : rows - 1;
  const body =
    s.view === "tenants" ? tenantsBody(s, s.stats, cols, innerRows)
    : s.view === "ops" ? opsBody(s, s.stats, cols, innerRows)
    : overviewBody(s, s.stats, cols, innerRows);
  return finish(head, [strip, ...body], foot, cols, rows);
}

/** Convenience for --once / non-TTY output: strip trailing spaces per line. */
export function frameToString(lines: string[]): string {
  return lines.map((l) => l.replace(/\s+$/u, "")).join("\n") + "\n";
}

export { repeat, width, type Style };
