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

  return out;
}
