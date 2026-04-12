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
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoDatetime(date: Date): string {
  return date.toISOString();
}

/**
 * Compute the FY start date (same logic as the dashboard router) so that all
 * relative-date helpers produce dates that fall inside the current FY.
 *
 * The business fixture uses financialYearStart = 4 (April).
 */
function currentFyStart(): Date {
  const now = new Date();
  const fyStartMonth = 3; // 0-indexed April
  const fyYear = now.getMonth() < fyStartMonth ? now.getFullYear() - 1 : now.getFullYear();
  return new Date(fyYear, fyStartMonth, 1);
}

/**
 * Returns a date N days after the FY start (instead of N days before "today").
 * This ensures test data always falls inside the current financial year,
 * regardless of which calendar day the suite runs on.
 */
function fyDaysAfter(n: number): Date {
  const start = currentFyStart();
  start.setDate(start.getDate() + n);
  return start;
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
  // Use fyDaysAfter() to guarantee the date falls inside the current FY
  // regardless of when the suite runs (avoids FY-boundary edge case on Apr 1).
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
      invoiceDate: fyDaysAfter(1),
    },
  );

  // An older sale invoice OUTSIDE a narrow date range — used to confirm
  // receivable is NOT filtered by date.
  // Place it early in the FY (day 2) so it falls inside the FY but outside
  // a narrow "recent" window used by the date-range test below.
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
      invoiceDate: fyDaysAfter(2),
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
      invoiceDate: fyDaysAfter(3),
    },
  );

  // Expense in current period
  await createExpense(tenantDb, business1.id, {
    category: "Office Supplies",
    amount: "1500.00",
    expenseDate: fyDaysAfter(4),
  });

  // Multiple sales in business1 for trend/top-customer tests
  // Place them later in the FY (days 20-22) so they fall in a "recent" window
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
        invoiceDate: fyDaysAfter(20 + i),
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

    // Narrow range: days 15-30 in FY — excludes early invoices (day 1 and day 2)
    // but includes the batch sales (days 20-22).
    const from = isoDatetime(fyDaysAfter(15));
    const to = isoDatetime(fyDaysAfter(30));

    const narrowResult = await caller.dashboard.summary({ fromDate: from, toDate: to });
    const fullResult = await caller.dashboard.summary(undefined);

    // The narrow window should report less sales than the full FY because
    // the FY total includes the sale at day 1 and the "old sale" at day 2.
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

    // Narrow range (days 15-30) that excludes the early "old sale" at day 2
    const narrowResult = await caller.dashboard.summary({
      fromDate: isoDatetime(fyDaysAfter(15)),
      toDate: isoDatetime(fyDaysAfter(30)),
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

// ── receivable/payable with CN/SR adjustments ──────────────────────────────────

describe("dashboard.summary — receivable/payable with CN/SR adjustments", () => {
  // Use a separate month to avoid polluting the shared beforeAll fixture data
  const ADJ_YEAR = 2025;
  const ADJ_MONTH = 7; // July 2025

  function adjDate(): Date {
    return new Date(ADJ_YEAR, ADJ_MONTH - 1, 15, 12, 0, 0);
  }

  beforeAll(async () => {
    // This nested beforeAll runs after the outer beforeAll, so world is already set.
    // We create sale/purchase invoices and their return documents via DB helpers
    // to keep them in a known month separate from the shared fixture data.
    const tenantDb = getTenantTestDb();

    // Create a sale invoice for ₹1,000 (no tax) to use as the base for CN/SR tests
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Goods for CN/SR test",
          quantity: "10",
          unitPrice: "100.00",
          taxPercent: "0.00",
        },
      ],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent",
        invoiceDate: adjDate(),
      },
    );

    // Create a purchase invoice for ₹500 (no tax) to use as the base for PR test
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Purchase for PR test",
          quantity: "5",
          unitPrice: "100.00",
          taxPercent: "0.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: adjDate(),
      },
    );
  });

  it("receivable is reduced by credit notes against sale invoices", async () => {
    const tenantDb = getTenantTestDb();
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Capture receivable before the credit note
    const before = await caller.dashboard.summary(undefined);
    const receivableBefore = parseFloat(before.receivable);

    // Create a credit note for ₹300 against the sale invoice
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Credit Note return",
          quantity: "3",
          unitPrice: "100.00",
          taxPercent: "0.00",
        },
      ],
      {
        type: "sale",
        documentType: "credit_note",
        status: "sent",
        invoiceDate: adjDate(),
      },
    );

    const after = await caller.dashboard.summary(undefined);
    const receivableAfter = parseFloat(after.receivable);

    // Receivable must have decreased by the CN amount (₹300)
    expect(receivableAfter).toBeCloseTo(receivableBefore - 300, 2);
    expect(receivableAfter).toBeLessThan(receivableBefore);
  });

  it("receivable is reduced by sales returns", async () => {
    const tenantDb = getTenantTestDb();
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Capture receivable before the sales return
    const before = await caller.dashboard.summary(undefined);
    const receivableBefore = parseFloat(before.receivable);

    // Create a sales return for ₹200
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Sales Return item",
          quantity: "2",
          unitPrice: "100.00",
          taxPercent: "0.00",
        },
      ],
      {
        type: "sale",
        documentType: "sales_return",
        status: "sent",
        invoiceDate: adjDate(),
      },
    );

    const after = await caller.dashboard.summary(undefined);
    const receivableAfter = parseFloat(after.receivable);

    // Receivable must have decreased by the SR amount (₹200)
    expect(receivableAfter).toBeCloseTo(receivableBefore - 200, 2);
    expect(receivableAfter).toBeLessThan(receivableBefore);
  });

  it("payable is reduced by purchase returns", async () => {
    const tenantDb = getTenantTestDb();
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Capture payable before the purchase return
    const before = await caller.dashboard.summary(undefined);
    const payableBefore = parseFloat(before.payable);

    // Create a purchase return for ₹200
    await createInvoiceWithItems(
      tenantDb,
      world.business1.id,
      world.party1.id,
      [
        {
          description: "Purchase Return item",
          quantity: "2",
          unitPrice: "100.00",
          taxPercent: "0.00",
        },
      ],
      {
        type: "purchase",
        documentType: "purchase_return",
        status: "sent",
        invoiceDate: adjDate(),
      },
    );

    const after = await caller.dashboard.summary(undefined);
    const payableAfter = parseFloat(after.payable);

    // Payable must have decreased by the PR amount (₹200)
    expect(payableAfter).toBeCloseTo(payableBefore - 200, 2);
    expect(payableAfter).toBeLessThan(payableBefore);
  });
});
