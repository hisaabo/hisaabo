/**
 * alerts.ts — Turns a PlatformStats snapshot into a short list of things an
 * operator should look at. Pure; rendered as the strip under the header on
 * every screen and reused by `--watch` style automation later.
 */

import type { PlatformStats } from "./stats.js";
import type { View } from "./screens.js";

export type AlertLevel = "red" | "yellow";

export interface Alert {
  level: AlertLevel;
  text: string;
  /** Screen that explains the alert. */
  view: View;
}

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function deriveAlerts(st: PlatformStats): Alert[] {
  const out: Alert[] = [];
  const red = (text: string, view: View = "ops") => out.push({ level: "red", text, view });
  const yellow = (text: string, view: View = "ops") => out.push({ level: "yellow", text, view });
  const o = st.totals.ops;
  const m = st.control.maintenance;

  if (m?.enabled) red("maintenance mode ACTIVE", "overview");
  if (st.databases.failed > 0) red(`${plural(st.databases.failed, "tenant db")} unreachable`, "tenants");
  if (o.eInvoice.failed > 0) red(`${plural(o.eInvoice.failed, "e-invoice")} failed` + (o.eInvoice.exhausted ? ` (${o.eInvoice.exhausted} out of retries)` : ""));
  if (o.recurring.failed7d > 0) red(`${plural(o.recurring.failed7d, "recurring run")} failed · 7d`);
  if (o.ewb.overdueExpiry > 0) red(`${plural(o.ewb.overdueExpiry, "e-way bill")} past validity`);

  if (m && !m.enabled && m.startsAt && new Date(m.startsAt) > new Date(st.collectedAt)) yellow("maintenance scheduled", "overview");
  if (o.eInvoice.stalePending > 0) yellow(`${plural(o.eInvoice.stalePending, "e-invoice")} pending > 1h`);
  if (o.recurring.overdueTemplates > 0) yellow(`${plural(o.recurring.overdueTemplates, "recurring template")} overdue`);
  if (o.recurring.skipped7d > 0) yellow(`${plural(o.recurring.skipped7d, "recurring run")} skipped (plan limit)`);
  if (o.bank.stale > 0) yellow(`${plural(o.bank.stale, "bank import")} stalled > 3d`);
  if (o.store.stalePending > 0) yellow(`${plural(o.store.stalePending, "store order")} unconfirmed > 24h`);
  if (o.shipments.stuck > 0) yellow(`${plural(o.shipments.stuck, "shipment")} in transit > 7d`);
  if (o.ewb.expiring24h > 0) yellow(`${plural(o.ewb.expiring24h, "e-way bill")} expiring in 24h`);
  const db = st.control.db;
  if (db.maxConnections > 0 && db.connections / db.maxConnections >= 0.8) yellow(`postgres at ${db.connections}/${db.maxConnections} connections`, "overview");

  // Infra: migration drift and database health.
  const reports = st.dbs.filter((d) => d.migrations);
  const behind = reports.filter((d) => d.migrations!.status === "behind").length;
  const ahead = reports.filter((d) => d.migrations!.status === "ahead").length;
  const untracked = reports.filter((d) => d.migrations!.status === "untracked").length;
  const noJournal = reports.length > 0 && reports.every((d) => d.migrations!.status === "no_journal");
  if (behind > 0) red(`${plural(behind, "db")} behind on migrations`, "infra");
  if (ahead > 0) yellow(`${plural(ahead, "db")} ahead of this build`, "infra");
  if (untracked > 0) yellow(`${plural(untracked, "db")} with untracked migrations`, "infra");
  if (noJournal) yellow("migration journals not found — drift unknown", "infra");
  const lowCache = st.dbs.filter((d) => d.infra?.cacheHit !== null && d.infra !== null && d.infra.cacheHit! < 0.95 && d.infra.idxScans + d.infra.seqScans > 1000).length;
  if (lowCache > 0) yellow(`${plural(lowCache, "db")} with cache hit < 95%`, "infra");
  const bloated = st.dbs.filter((d) => d.infra && d.infra.liveTuples > 10_000 && d.infra.deadTuples > d.infra.liveTuples * 0.2).length;
  if (bloated > 0) yellow(`${plural(bloated, "db")} with > 20% dead tuples`, "infra");
  const deadlocked = st.dbs.reduce((a, d) => a + (d.infra?.deadlocks ?? 0), 0);
  if (deadlocked > 0) yellow(`${plural(deadlocked, "deadlock")} since stats reset`, "infra");

  // Reds first, then yellows, preserving insertion order within each.
  return [...out.filter((a) => a.level === "red"), ...out.filter((a) => a.level === "yellow")];
}
