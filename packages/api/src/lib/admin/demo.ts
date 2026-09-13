/**
 * demo.ts — Deterministic synthetic PlatformStats for `hisaabo-admin --demo`.
 *
 * Lets you preview the dashboard (and take screenshots) without a database.
 * Uses a seeded PRNG so every run looks the same.
 */

import type { PlatformStats, TenantMetrics, TenantOps, TenantWithMetrics } from "./stats.js";
import { lastTwelveMonths, sumMetrics, mergeFailures, emptyOps } from "./stats.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  "Sharma Traders", "Mehta & Sons", "Kaveri Textiles", "Bluestone Engineering", "Ananya Foods",
  "Patel Hardware", "Zenith Logistics", "Rao Pharmacy", "Nirvana Interiors", "Deccan Agro",
  "Iyer Consulting", "Verma Electricals", "Sunrise Bakery", "Khan Auto Parts", "Lotus Apparel",
  "Gupta Steel", "Mistry Studio", "Aarav Tech", "Bose Prints", "Chola Ceramics",
  "Dutta Dairy", "Ekam Ayurveda", "Fernandes Marine",
];
const PLANS = ["free", "free", "free", "pro", "pro", "business", "enterprise"];

function iso(d: Date): string {
  return d.toISOString();
}

const EINVOICE_ERRORS = [
  "2150: Duplicate IRN",
  "3028: GSTIN of recipient is not active",
  "2172: For intra-state transaction IGST amounts are not applicable",
  "IRP gateway timeout after 30s",
];

function demoOps(rnd: () => number, i: number, invoices: number, now: Date): TenantOps {
  const ops = emptyOps();
  const hoursAgo = (h: number) => iso(new Date(now.getTime() - h * 3_600_000));
  const usesEinvoice = i % 3 === 0;
  if (usesEinvoice) {
    ops.eInvoice.generated = Math.round(invoices * 0.3);
    ops.eInvoice.pending = Math.round(rnd() * 4);
    ops.eInvoice.cancelled = Math.round(rnd() * 5);
    if (i === 3 || i === 9) {
      ops.eInvoice.failed = 1 + Math.round(rnd() * 2);
      ops.eInvoice.exhausted = i === 9 ? 1 : 0;
      ops.eInvoice.stalePending = i === 3 ? 2 : 0;
      for (let k = 0; k < ops.eInvoice.failed; k++) {
        ops.failures.push({ kind: "einvoice", ref: `INV-${1040 + k}`, message: EINVOICE_ERRORS[(i + k) % EINVOICE_ERRORS.length], at: hoursAgo(1 + k * 5 + i) });
      }
    }
  }
  ops.recurring.activeTemplates = Math.round(rnd() * 6);
  ops.recurring.pausedTemplates = rnd() < 0.3 ? 1 : 0;
  ops.recurring.ok7d = ops.recurring.activeTemplates * Math.round(rnd() * 2);
  ops.recurring.ok30d = ops.recurring.ok7d * 4;
  if (i === 6) {
    ops.recurring.failed7d = 1;
    ops.recurring.failed30d = 2;
    ops.recurring.overdueTemplates = 1;
    ops.failures.push({ kind: "recurring", ref: "Monthly retainer", message: "party has exceeded credit limit", at: hoursAgo(14) });
  }
  if (i === 12) ops.recurring.skipped7d = 3;
  ops.bank.imports = Math.round(rnd() * 12);
  ops.bank.completed = Math.round(ops.bank.imports * 0.8);
  ops.bank.review = ops.bank.imports - ops.bank.completed;
  ops.bank.matched30d = Math.round(rnd() * 400);
  ops.bank.unmatched30d = Math.round(ops.bank.matched30d * (0.05 + rnd() * 0.2));
  if (i === 15) {
    ops.bank.stale = 1;
    ops.failures.push({ kind: "bank_import", ref: "HDFC_Aug2026.csv", message: "stalled in review", at: hoursAgo(90) });
  }
  ops.gstr2b.uploads = Math.round(rnd() * 8);
  ops.gstr2b.uploads30d = ops.gstr2b.uploads > 0 ? 1 : 0;
  ops.gstr2b.unmatched30d = Math.round(rnd() * 20);
  ops.gstr2b.new30d = Math.round(rnd() * 6);
  ops.gstr2b.lastUploadAt = ops.gstr2b.uploads ? hoursAgo(24 * (1 + rnd() * 20)) : null;
  if (i % 4 === 0) {
    const orders = 20 + Math.round(rnd() * 80);
    ops.store.byStatus = { delivered: Math.round(orders * 0.7), confirmed: Math.round(orders * 0.15), pending: Math.round(orders * 0.1), cancelled: Math.round(orders * 0.05) };
    ops.shipments.byStatus = { delivered: Math.round(orders * 0.6), in_transit: Math.round(orders * 0.1), shipped: Math.round(orders * 0.05) };
    if (i === 8) {
      ops.store.stalePending = 2;
      ops.failures.push({ kind: "store_order", ref: "ORD-0231", message: "unconfirmed for 2d", at: hoursAgo(50) });
    }
    if (i === 20) ops.shipments.stuck = 1;
  }
  ops.ewb.active = usesEinvoice ? Math.round(rnd() * 15) : 0;
  ops.ewb.expired = usesEinvoice ? Math.round(rnd() * 30) : 0;
  ops.ewb.cancelled = usesEinvoice ? Math.round(rnd() * 4) : 0;
  if (i === 0) ops.ewb.expiring24h = 2;
  return ops;
}

export function buildDemoStats(now: Date = new Date()): PlatformStats {
  const rnd = mulberry32(20260912);
  const months = lastTwelveMonths(now);
  const tenants: TenantWithMetrics[] = NAMES.map((name, i) => {
    const scale = Math.pow(10, 4 + rnd() * 2.6); // ₹10K … ₹4L per month
    const monthly = months.map((month, mi) => {
      const seasonal = 0.6 + 0.4 * Math.sin((mi / 12) * Math.PI * 2 + i);
      const amount = Math.round(scale * seasonal * (0.5 + rnd()));
      const count = Math.max(0, Math.round(amount / (2500 + rnd() * 4000)));
      return { month, count, amount };
    });
    const invoices = monthly.reduce((a, p) => a + p.count, 0) + Math.round(rnd() * 40);
    const salesTotal = monthly.reduce((a, p) => a + p.amount, 0) * (1 + rnd() * 0.3);
    const purchaseTotal = salesTotal * (0.3 + rnd() * 0.4);
    const paid = 0.55 + rnd() * 0.35;
    const ops = demoOps(rnd, i, invoices, now);
    const metrics: TenantMetrics = {
      ops,
      businesses: 1 + (rnd() < 0.3 ? 1 : 0),
      gstBusinesses: rnd() < 0.7 ? 1 : 0,
      storesEnabled: rnd() < 0.25 ? 1 : 0,
      parties: 8 + Math.round(rnd() * 120),
      items: 5 + Math.round(rnd() * 300),
      invoices,
      salesInvoices: Math.round(invoices * 0.8),
      purchaseInvoices: invoices - Math.round(invoices * 0.8),
      otherDocuments: Math.round(rnd() * 30),
      invoices7d: Math.round(rnd() * 6),
      invoices30d: Math.round((monthly[11].count + monthly[10].count) / 2),
      salesTotal: Math.round(salesTotal),
      purchaseTotal: Math.round(purchaseTotal),
      receivable: Math.round(salesTotal * (1 - paid) * 0.6),
      payable: Math.round(purchaseTotal * 0.2 * rnd()),
      eInvoices: rnd() < 0.4 ? Math.round(invoices * 0.3) : 0,
      lastInvoiceAt: iso(new Date(now.getTime() - rnd() * 14 * 86_400_000)),
      payments: Math.round(invoices * 0.7),
      paymentsTotal: Math.round(salesTotal * paid),
      expenses: Math.round(rnd() * 90),
      expensesTotal: Math.round(salesTotal * (0.1 + rnd() * 0.2)),
      storeOrders: rnd() < 0.25 ? Math.round(rnd() * 200) : 0,
      storeOrdersTotal: 0,
      byStatus: {
        paid: Math.round(invoices * paid * 0.8),
        partial: Math.round(invoices * 0.08),
        sent: Math.round(invoices * 0.1),
        overdue: Math.round(invoices * 0.05),
        draft: Math.round(invoices * 0.03),
        cancelled: Math.round(invoices * 0.01),
      },
      monthly,
    };
    metrics.storeOrdersTotal = Math.round(metrics.storeOrders * (400 + rnd() * 900));
    const createdAt = new Date(now.getTime() - (5 + rnd() * 400) * 86_400_000);
    const status = rnd() < 0.08 ? "suspended" : "active";
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      name,
      slug,
      plan: PLANS[Math.floor(rnd() * PLANS.length)],
      status,
      dbName: `tenant_${slug.replace(/-/g, "_")}`,
      dbHost: "postgres",
      dbPort: "5432",
      members: 1 + Math.round(rnd() * 6),
      createdAt: iso(createdAt),
      dbKey: `postgres:5432/tenant_${slug}`,
      sharedDb: false,
      metrics,
      error: null,
    };
  });
  // One tenant with an unreachable database, to show the failure path.
  tenants[17].metrics = null;
  tenants[17].error = 'FATAL: database "tenant_aarav_tech" does not exist';

  const users = tenants.reduce((a, t) => a + t.members, 0) + 9;
  const recentUsers = ["priya@sharmatraders.in", "arjun.mehta@gmail.com", "ops@kaveritextiles.com", "n.rao@raopharmacy.in", "hello@sunrisebakery.co"].map((email, i) => ({
    email,
    name: email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
    createdAt: iso(new Date(now.getTime() - (i * 7 + 2) * 3_600_000)),
  }));

  return {
    failures: mergeFailures(tenants),
    collectedAt: iso(now),
    durationMs: 412,
    mode: "multi-db",
    control: {
      tenants,
      users: { total: users, verified: Math.round(users * 0.86), new7d: 4, new30d: 13 },
      sessions: { active: 61, used24h: 27, web: 44, bearer: 17 },
      apiKeys: { total: 19, active: 16, used7d: 7 },
      pendingInvitations: 3,
      maintenance: null,
      recentUsers,
      db: {
        name: "hisaabo",
        version: "PostgreSQL 16.4",
        sizePretty: "48 MB",
        totalSizePretty: "1.9 GB",
        connections: 14,
        maxConnections: 100,
        databases: tenants.length + 1,
        uptimeSeconds: 19 * 86400 + 4 * 3600,
      },
    },
    totals: sumMetrics(tenants.flatMap((t) => (t.metrics ? [t.metrics] : [])), now),
    tenants,
    databases: { queried: tenants.length, failed: 1 },
    errors: [`${tenants[17].dbKey}: ${tenants[17].error}`],
  };
}
