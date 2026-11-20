import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createInvoiceWithItems, createPayment, createExpense, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { money } from "@hisaabo/shared";

/**
 * Input shapes the web Business Reports page (apps/web/src/routes/reports.tsx)
 * actually sends. JSON serialisation drops `undefined` keys, so the "All time"
 * preset (and a persisted "custom" preset with no dates) arrives with the
 * date keys absent; those requests used to fail with BAD_REQUEST.
 */

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);

  // 5 x 200 + 18% GST = 1180 total (1000 sales, 180 output GST)
  await createInvoiceWithItems(
    db,
    world.business1.id,
    world.party1.id,
    [{ itemId: world.item1.id, description: "Widget", quantity: "5", unitPrice: "200.00", taxPercent: "18" }],
    { type: "sale", documentType: "invoice", status: "sent", invoiceDate: new Date("2030-06-01T10:00:00Z") },
  );
  await createPayment(db, world.business1.id, world.party1.id, {
    amount: "500.00",
    mode: "cash",
    paymentDate: new Date("2030-06-10T10:00:00Z"),
  });
  await createExpense(db, world.business1.id, {
    amount: "100.00",
    mode: "cash",
    expenseDate: new Date("2030-06-15T10:00:00Z"),
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

// Preset shapes as produced by useDateRange (UTC ISO strings, or absent).
const JUNE_2030 = { fromDate: "2030-06-01T00:00:00.000Z", toDate: "2030-06-30T23:59:59.999Z" };
const ALL_TIME = { fromDate: undefined, toDate: undefined };
const RANGES = [
  ["bounded range", JUNE_2030],
  ["all time (undefined dates)", ALL_TIME],
] as const;

describe.each(RANGES)("report inputs - %s", (_name, range) => {
  it("daybook", async () => {
    const res = await caller().reports.daybook({ ...range, typeFilter: "all" });
    expect(res.entries.length).toBe(3);
    expect(res.summary.totalSalesInvoiced).toBe("1180.00");
    expect(res.summary.totalExpenses).toBe("100.00");
  });

  it("salesRegister / purchaseRegister", async () => {
    const sales = await caller().reports.salesRegister(range);
    expect(sales.rows).toHaveLength(1);
    const purchases = await caller().reports.purchaseRegister(range);
    expect(purchases.rows).toHaveLength(0);
  });

  it("collectionEfficiency", async () => {
    const res = await caller().reports.collectionEfficiency(range);
    expect(res.collectionEfficiency.totalInvoices).toBe(0);
    expect(res.dso.daysInPeriod).toBeGreaterThanOrEqual(1);
  });

  it("itemSales (incl. compareToPrevious)", async () => {
    const res = await caller().reports.itemSales({ ...range, sortBy: "revenue", compareToPrevious: false });
    expect(res.count).toBe(1);
    const cmp = await caller().reports.itemSales({ ...range, sortBy: "revenue", compareToPrevious: true });
    expect(cmp.count).toBe(1);
  });

  it("paymentSummary", async () => {
    const res = await caller().reports.paymentSummary({ ...range, type: "both" });
    expect(res.summary.totalReceived).toBe("500.00");
    expect(res.summary.totalExpenses).toBe("100.00");
  });

  it("taxSummary", async () => {
    const res = await caller().reports.taxSummary({ ...range, type: "both" });
    expect(JSON.stringify(res)).toContain("180");
  });

  it("cashFlowStatement", async () => {
    const res = await caller().reports.cashFlowStatement(range);
    expect(res.netCashFlow).toBe("400.00");
    expect(res.closingCashBalance).toBe(money.add(res.openingCashBalance, res.netCashFlow));
  });
});

describe("daybook input formats", () => {
  it("accepts date-only and datetime bounds, and rejects garbage", async () => {
    const dateOnly = await caller().reports.daybook({ fromDate: "2030-06-01", toDate: "2030-06-30", typeFilter: "all" });
    expect(dateOnly.entries).toHaveLength(3);
    const empty = await caller().reports.daybook({ fromDate: "2031-01-01T00:00:00.000Z", toDate: "2031-01-31T00:00:00.000Z", typeFilter: "all" });
    expect(empty.entries).toHaveLength(0);
    await expect(caller().reports.daybook({ fromDate: "yesterday" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("cashFlowStatement content", () => {
  it("explains the cash movement and reconciles to cash + bank", async () => {
    const res = await caller().reports.cashFlowStatement(JUNE_2030);

    // 500 received - 100 expense paid, all in cash
    expect(res.netCashFlow).toBe("400.00");
    expect(res.openingCashBalance).toBe("0.00");
    expect(res.closingCashBalance).toBe("400.00");

    // Net income = 1000 sales - 100 expense
    expect(res.operating.netIncome).toBe("900.00");
    // Receivable increased by 1180 - 500 = 680 (cash outflow), output GST up by 180
    const wc = Object.fromEntries(res.operating.workingCapitalChanges.map((w) => [w.description, w.amount]));
    expect(wc["Increase in Receivables"]).toBe("-680.00");
    expect(Object.keys(wc).some((k) => k.includes("Output CGST") || k.includes("Output IGST"))).toBe(true);

    // Sections add up to the net figure
    expect(
      money.sum([res.operating.totalOperating, res.investing.totalInvesting, res.financing.totalFinancing]),
    ).toBe(res.netCashFlow);
    // Inventory / working-capital accounts are not mis-classified as investing
    expect(res.investing.items).toHaveLength(0);
  });

  it("opening balance carries cash from before the period", async () => {
    const res = await caller().reports.cashFlowStatement({
      fromDate: "2030-06-12T00:00:00.000Z",
      toDate: "2030-06-30T23:59:59.999Z",
    });
    expect(res.openingCashBalance).toBe("500.00");
    expect(res.netCashFlow).toBe("-100.00");
    expect(res.closingCashBalance).toBe("400.00");
  });
});
