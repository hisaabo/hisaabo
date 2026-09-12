/**
 * demo.ts — Deterministic synthetic PlatformStats for `hisaabo-admin --demo`.
 *
 * Lets you preview the dashboard (and take screenshots) without a database.
 * Uses a seeded PRNG so every run looks the same.
 */

import type { PlatformStats, TenantMetrics, TenantWithMetrics } from "./stats.js";
import { lastTwelveMonths, sumMetrics } from "./stats.js";

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
    const metrics: TenantMetrics = {
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
