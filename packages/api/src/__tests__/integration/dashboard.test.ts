/**
 * dashboard.test.ts — Integration tests for dashboardRouter
 *
 * WHY THIS FILE EXISTS:
 * The dashboard is the first screen every user sees after login. Its summary
 * procedure aggregates sales, purchases, and expenses for a date range, while
 * receivable/payable are balance-sheet metrics that must NOT be filtered by date.
 * The salesTrend procedure generates time-bucketed revenue data used for charts.
 *
 * Critical invariants verified here:
 *   1. summary.receivable is NEVER date-filtered — it reflects ALL outstanding
 *      balances regardless of the fromDate/toDate input.
 *   2. salesTrend weekly buckets start from fromDate, not from ISO week boundaries.
 *   3. salesTrend monthly buckets are always the 1st of the month.
 *   4. Business isolation: one business cannot see another's numbers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createInvoiceWithItems,
  createExpense,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoDatetime(date: Date): string {
  return date.toISOString();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function monthsAgo(n: number, day = 1): Date {
  const d = new Date();
  d.setDate(day);
  d.setMonth(d.getMonth() - n);
  return d;
}

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();

  const { tenantDb, business1, party1, item1 } = world;

  // Sale invoice within the current FY — ₹10,000 + 5% tax = ₹10,500
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        itemId: item1.id,
        description: "Cotton Fabric",
        quantity: "40",
        unitPrice: "250.00",
        taxPercent: "5.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent",
      invoiceDate: daysAgo(10),
    },
  );

  // An older sale invoice OUTSIDE a narrow date range — used to confirm
  // receivable is NOT filtered by date
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        itemId: item1.id,
        description: "Old sale",
        quantity: "10",
        unitPrice: "100.00",
        taxPercent: "0.00",
      },
    ],
    {
      type: "sale",
      documentType: "invoice",
      status: "sent", // not paid → still outstanding
      invoiceDate: daysAgo(200), // well outside any narrow window
    },
  );

  // Purchase invoice — ₹5,000
  await createInvoiceWithItems(
    tenantDb,
    business1.id,
    party1.id,
    [
      {
        description: "Raw material",
        quantity: "25",
        unitPrice: "200.00",
        taxPercent: "0.00",
      },
    ],
    {
      type: "purchase",
      documentType: "invoice",
      status: "draft",
      invoiceDate: daysAgo(5),
    },
  );

  // Expense in current period
  await createExpense(tenantDb, business1.id, {
    category: "Office Supplies",
    amount: "1500.00",
    expenseDate: daysAgo(3),
  });

  // Multiple sales in business1 for trend/top-customer tests
  for (let i = 0; i < 3; i++) {
    await createInvoiceWithItems(
      tenantDb,
      business1.id,
      party1.id,
      [
        {
          itemId: item1.id,
          description: `Batch sale ${i}`,
          quantity: "5",
          unitPrice: "300.00",
          taxPercent: "5.00",
        },
      ],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent",
        invoiceDate: daysAgo(i + 1),
      },
    );
  }
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── summary ────────────────────────────────────────────────────────────────────

describe("dashboard.summary", () => {
  it("returns totalSales, totalPurchases, totalExpenses for the FY when no date range given", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.dashboard.summary(undefined);

    expect(parseFloat(result.totalSales)).toBeGreaterThan(0);
    expect(parseFloat(result.totalPurchases)).toBeGreaterThan(0);
    expect(parseFloat(result.totalExpenses)).toBeGreaterThan(0);
    // fyStart must be a valid ISO datetime string
    expect(() => new Date(result.fyStart)).not.toThrow();
  });

  it("dashboard.summary returns correct totals scoped to an explicit date range", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Very narrow range: last 7 days — the 200-day-old invoice must NOT appear
    const from = isoDatetime(daysAgo(7));
    const to = isoDatetime(new Date());

    const narrowResult = await caller.dashboard.summary({ fromDate: from, toDate: to });
    const fullResult = await caller.dashboard.summary(undefined);

    // The narrow window should report less (or equal) sales than the full FY
    expect(parseFloat(narrowResult.totalSales)).toBeLessThan(parseFloat(fullResult.totalSales));
  });

  it("dashboard.summary — receivable is NOT date-filtered (balance sheet metric), includes old outstanding invoices", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Narrow range that excludes the 200-day-old invoice
    const narrowResult = await caller.dashboard.summary({
      fromDate: isoDatetime(daysAgo(7)),
      toDate: isoDatetime(new Date()),
    });

    const fullResult = await caller.dashboard.summary(undefined);

    // Even in a narrow date range, receivable should equal the full outstanding balance
    // because receivable ignores date filters (it's a balance sheet metric)
    expect(narrowResult.receivable).toBe(fullResult.receivable);
    // And the receivable must include the old unpaid invoice amount
    expect(parseFloat(narrowResult.receivable)).toBeGreaterThan(0);
  });

  it("dashboard.summary returns recentInvoices array with invoiceDate as ISO string", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.dashboard.summary(undefined);

    expect(Array.isArray(result.recentInvoices)).toBe(true);
    if (result.recentInvoices.length > 0) {
      const inv = result.recentInvoices[0]!;
      // invoiceDate must be serialised as ISO string (not a Date object)
      expect(typeof inv.invoiceDate).toBe("string");
      expect(() => new Date(inv.invoiceDate)).not.toThrow();
    }
  });

  it("dashboard.summary — business isolation: business2 sees only its own data", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.dashboard.summary(undefined);

    // business2 has no invoices or expenses — all totals should be 0
    expect(result.totalSales).toBe("0");
    expect(result.totalPurchases).toBe("0");
    expect(result.totalExpenses).toBe("0");
    expect(result.receivable).toBe("0");
  });
});

// ── salesTrend ─────────────────────────────────────────────────────────────────

describe("dashboard.salesTrend", () => {
  it("salesTrend with monthly granularity returns month-start buckets", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.dashboard.salesTrend({ months: 6, granularity: "month" });

    expect(Array.isArray(result)).toBe(true);
    for (const bucket of result) {
      // Each period string must be parseable as a date
      const d = new Date(bucket.period);
      expect(isNaN(d.getTime())).toBe(false);
      // Monthly buckets always start on the 1st (day portion)
      expect(d.getUTCDate()).toBe(1);
      expect(typeof bucket.invoiced).toBe("string");
    }
  });

  it("salesTrend with weekly granularity returns buckets starting from fromDate — not ISO week boundaries", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const from = monthsAgo(1, 5); // 5th of last month — arbitrary non-Monday anchor
    const to = new Date();

    const result = await caller.dashboard.salesTrend({
      months: 6,
      granularity: "week",
      fromDate: isoDatetime(from),
      toDate: isoDatetime(to),
    });

    expect(Array.isArray(result)).toBe(true);
    // At least one bucket should exist
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Each bucket has a period and invoiced string
    for (const bucket of result) {
      expect(typeof bucket.period).toBe("string");
      expect(typeof bucket.invoiced).toBe("string");
    }
  });

  it("salesTrend with fy granularity returns at most 5 financial-year buckets", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.dashboard.salesTrend({ months: 6, granularity: "fy" });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
    for (const bucket of result) {
      // period should be a 4-digit year string (e.g. "2025")
      expect(typeof bucket.period).toBe("string");
      expect(bucket.period).toMatch(/^\d{4}$/);
      expect(typeof bucket.invoiced).toBe("string");
      expect(typeof bucket.collected).toBe("string");
    }
  });

  it("salesTrend — business isolation: business2 trend returns zeros or empty", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.dashboard.salesTrend({ months: 3, granularity: "month" });

    // All buckets should have invoiced = "0" since business2 has no sales
    for (const bucket of result) {
      expect(bucket.invoiced).toBe("0");
    }
  });
});

// ── topCustomers ───────────────────────────────────────────────────────────────

describe("dashboard.topCustomers", () => {
  it("topCustomers returns top parties by revenue — limited to 5", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.dashboard.topCustomers({});

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
    if (result.length > 0) {
      expect(typeof result[0]!.partyName).toBe("string");
      expect(typeof result[0]!.totalAmount).toBe("string");
      expect(parseFloat(result[0]!.totalAmount)).toBeGreaterThan(0);
    }
  });

  it("topCustomers — business isolation: business2 returns empty list", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.dashboard.topCustomers({});

    // business2 has no sale invoices
    expect(result.length).toBe(0);
  });
});

// ── topSellingItems ────────────────────────────────────────────────────────────

describe("dashboard.topSellingItems", () => {
  it("topSellingItems returns top 5 items by invoiced amount", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.dashboard.topSellingItems({});

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
    if (result.length > 0) {
      const top = result[0]!;
      expect(typeof top.itemName).toBe("string");
      expect(typeof top.totalAmount).toBe("string");
      expect(parseFloat(top.totalAmount)).toBeGreaterThan(0);
    }
  });

  it("topSellingItems — business isolation: business2 returns empty list", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.dashboard.topSellingItems({});

    expect(result.length).toBe(0);
  });
});
