import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createInvoiceWithItems, createPayment, createExpense, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { money } from "@hisaabo/shared";
import { chartOfAccounts } from "@hisaabo/db";
import { eq } from "drizzle-orm";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
  // Seed CoA since createTestWorld bypasses business router
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);

  // Create a sale invoice directly via DB fixture (avoids router schema drift issues).
  // 5 units × ₹200 + 18% tax = ₹1000 subtotal, ₹180 tax, ₹1180 total.
  // Date 2030-06-01 falls within the 2030 FY (Apr 2030 – Mar 2031) so all
  // date-range tests that use asOfDate=2030-12-31 will capture this entry.
  await createInvoiceWithItems(
    db,
    world.business1.id,
    world.party1.id,
    [{ itemId: world.item1.id, description: "Widget", quantity: "5", unitPrice: "200.00", taxPercent: "18" }],
    { type: "sale", documentType: "invoice", status: "sent", invoiceDate: new Date("2030-06-01") },
  );
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

describe("Trial Balance", () => {
  it("returns account balances derived from transactions", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.trialBalance({
      asOfDate: new Date("2030-12-31").toISOString(),
    });

    expect(result.accounts).toBeDefined();
    expect(result.accounts.length).toBeGreaterThan(0);

    // Total debits must equal total credits (fundamental accounting equation)
    expect(result.totalDebit).toBe(result.totalCredit);

    // Receivable account should have a debit balance
    const receivable = result.accounts.find(a => a.accountCode === "1100");
    expect(receivable).toBeDefined();
    expect(money.compare(receivable!.debit, "0")).toBe(1);
  });

  it("filters by date range", async () => {
    const caller = callerForRamesh();
    const result = await caller.reports.trialBalance({
      asOfDate: new Date("2020-01-01").toISOString(),
    });
    // No transactions before 2020, so all balances should be zero or empty
    const nonZero = result.accounts.filter(a =>
      money.compare(a.debit, "0") !== 0 || money.compare(a.credit, "0") !== 0
    );
    expect(nonZero.length).toBe(0);
  });
});

describe("Balance Sheet", () => {
  it("returns assets, liabilities, and equity sections", async () => {
    const caller = callerForRamesh();
    const result = await caller.reports.balanceSheet({
      asOfDate: new Date("2030-12-31").toISOString(),
    });

    expect(result.assets).toBeDefined();
    expect(result.liabilities).toBeDefined();
    expect(result.equity).toBeDefined();

    // Accounting equation: Assets = Liabilities + Equity
    const totalAssets = money.sum(result.assets.map(a => a.balance));
    const totalLiabilities = money.sum(result.liabilities.map(a => a.balance));
    const totalEquity = money.sum(result.equity.map(a => a.balance));
    const liabPlusEquity = money.add(totalLiabilities, totalEquity);

    expect(totalAssets).toBe(liabPlusEquity);
  });

  it("includes net income in equity section", async () => {
    const caller = callerForRamesh();
    const result = await caller.reports.balanceSheet({
      asOfDate: new Date("2030-12-31").toISOString(),
    });

    // Net income (income - expenses) should appear as an equity item
    const netIncome = result.equity.find(a => a.accountName === "Net Income (Current Period)");
    expect(netIncome).toBeDefined();
  });
});

describe("Enhanced P&L", () => {
  it("returns income and expense accounts with totals", async () => {
    const caller = callerForRamesh();
    const result = await caller.reports.profitAndLoss({
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    expect(result.income).toBeDefined();
    expect(result.expenses).toBeDefined();
    expect(result.grossProfit).toBeDefined();
    expect(result.netProfit).toBeDefined();

    // Net profit = total income - total expenses
    const totalIncome = money.sum(result.income.map(a => a.amount));
    const totalExpenses = money.sum(result.expenses.map(a => a.amount));
    expect(result.netProfit).toBe(money.sub(totalIncome, totalExpenses));
  });
});

describe("General Ledger", () => {
  it("returns transactions for a specific account with running balance", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Get the Accounts Receivable account ID
    const accounts = await db.select().from(chartOfAccounts)
      .where(eq(chartOfAccounts.businessId, world.business1.id));
    const receivableAccount = accounts.find(a => a.code === "1100");
    expect(receivableAccount).toBeDefined();

    const result = await caller.reports.generalLedger({
      accountId: receivableAccount!.id,
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    expect(result.accountCode).toBe("1100");
    expect(result.accountName).toBe("Accounts Receivable");
    expect(result.entries).toBeDefined();
    expect(Array.isArray(result.entries)).toBe(true);

    // Each entry should have a running balance
    if (result.entries.length > 0) {
      expect(result.entries[0].balance).toBeDefined();
    }
  });

  it("running balance accumulates correctly", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const accounts = await db.select().from(chartOfAccounts)
      .where(eq(chartOfAccounts.businessId, world.business1.id));
    const cashAccount = accounts.find(a => a.code === "1000");

    const result = await caller.reports.generalLedger({
      accountId: cashAccount!.id,
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    // Verify running balance is cumulative: each balance = prev balance + debit - credit
    for (let i = 1; i < result.entries.length; i++) {
      const prev = result.entries[i - 1];
      const curr = result.entries[i];
      const expected = money.add(money.sub(prev.balance, prev.credit), curr.debit);
      expect(curr.balance).toBe(money.sub(money.add(prev.balance, curr.debit), curr.credit));
      void expected; // suppress unused variable lint warning
    }
  });

  it("includes manual journal entries alongside derived entries", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const accounts = await db.select().from(chartOfAccounts)
      .where(eq(chartOfAccounts.businessId, world.business1.id));
    const cashAccount = accounts.find(a => a.code === "1000");

    // Create a journal entry affecting Cash
    const capitalAccount = accounts.find(a => a.code === "3000");
    await caller.journal.create({
      entryDate: new Date().toISOString(),
      narration: "GL test journal entry",
      lines: [
        { accountId: cashAccount!.id, debit: "25000.00", credit: "0" },
        { accountId: capitalAccount!.id, debit: "0", credit: "25000.00" },
      ],
    });

    const result = await caller.reports.generalLedger({
      accountId: cashAccount!.id,
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    // Should find our journal entry in the list
    const jeEntry = result.entries.find(e => e.narration?.includes("GL test journal entry"));
    expect(jeEntry).toBeDefined();
    expect(jeEntry!.debit).toBe("25000.00");
  });
});

describe("Cash Flow Statement", () => {
  // The beforeAll in this file already seeded a sale invoice (₹1180 total) dated 2030-06-01.
  // We add a payment and an expense in the same period so we can verify the operating section.

  beforeAll(async () => {
    const db = getTenantTestDb();

    // Payment received from customer (cash) — Dr Cash (1000) / Cr Receivable (1100)
    await createPayment(db, world.business1.id, world.party1.id, {
      amount: "500.00",
      mode: "cash",
      paymentDate: new Date("2030-07-01"),
    });

    // Depreciation expense — maps to account 5900 (add back in operating)
    await createExpense(db, world.business1.id, {
      category: "Depreciation",
      description: "Machinery depreciation",
      amount: "200.00",
      mode: "cash",
      expenseDate: new Date("2030-08-01"),
    });
  });

  it("returns the correct shape with all required sections", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.cashFlowStatement({
      fromDate: new Date("2030-04-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    expect(result.operating).toBeDefined();
    expect(result.investing).toBeDefined();
    expect(result.financing).toBeDefined();
    expect(typeof result.netCashFlow).toBe("string");
    expect(typeof result.openingCashBalance).toBe("string");
    expect(typeof result.closingCashBalance).toBe("string");
  });

  it("operating section includes net income and depreciation add-back", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.cashFlowStatement({
      fromDate: new Date("2030-04-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    // Net income should be non-zero (we have a sale invoice in the period)
    expect(money.compare(result.operating.netIncome, "0")).not.toBe(0);

    // Depreciation adjustment should be present (we seeded a ₹200 depreciation expense)
    const deprAdj = result.operating.adjustments.find(
      (a) => a.description.toLowerCase().includes("depreciation"),
    );
    expect(deprAdj).toBeDefined();
    expect(deprAdj!.amount).toBe("200.00");
  });

  it("operating section reflects working capital changes from payment", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.cashFlowStatement({
      fromDate: new Date("2030-04-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    // The sale invoice (₹1180) increases receivables; the payment (₹500) decreases them.
    // Net receivable movement = ₹1180 debit - ₹500 credit = ₹680 net debit → cash outflow = -680
    const receivableChange = result.operating.workingCapitalChanges.find(
      (w) => w.description.toLowerCase().includes("receivable"),
    );
    expect(receivableChange).toBeDefined();
    // Net receivable increased → cash outflow → negative amount
    expect(money.compare(receivableChange!.amount, "0")).toBe(-1);
  });

  it("net cash flow equals change in cash balance (reconciliation check)", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.cashFlowStatement({
      fromDate: new Date("2030-04-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    // closingCashBalance = openingCashBalance + netCashFlow
    const expectedClosing = money.add(result.openingCashBalance, result.netCashFlow);
    expect(result.closingCashBalance).toBe(expectedClosing);
  });

  it("net cash flow equals sum of operating + investing + financing", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.cashFlowStatement({
      fromDate: new Date("2030-04-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    const sumOfParts = money.sum([
      result.operating.totalOperating,
      result.investing.totalInvesting,
      result.financing.totalFinancing,
    ]);
    expect(result.netCashFlow).toBe(sumOfParts);
  });

  it("returns zeros for a period with no transactions", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.cashFlowStatement({
      fromDate: new Date("2025-01-01").toISOString(),
      toDate: new Date("2025-01-31").toISOString(),
    });

    expect(result.operating.netIncome).toBe("0.00");
    expect(result.netCashFlow).toBe("0.00");
    expect(result.operating.adjustments).toHaveLength(0);
    expect(result.operating.workingCapitalChanges).toHaveLength(0);
    expect(result.investing.items).toHaveLength(0);
    expect(result.financing.items).toHaveLength(0);
  });
});

describe("Comparative Trial Balance", () => {
  it("shows both periods with correct variance", async () => {
    const caller = callerForRamesh();

    // Current FY: 2030-04-01 to 2031-03-31 — the invoice from beforeAll is in this period
    // Previous FY: 2029-04-01 to 2030-03-31 — no transactions, so all zero
    const result = await caller.reports.comparativeTrialBalance({
      currentFYStart: new Date("2030-04-01").toISOString(),
      currentFYEnd: new Date("2031-03-31").toISOString(),
      previousFYStart: new Date("2029-04-01").toISOString(),
      previousFYEnd: new Date("2030-03-31").toISOString(),
    });

    expect(result.accounts).toBeDefined();
    expect(result.accounts.length).toBeGreaterThan(0);

    // Total debits must equal total credits for current period
    expect(result.currentTotalDebit).toBe(result.currentTotalCredit);

    // The receivable account (1100) should appear with a positive currentDebit
    const receivable = result.accounts.find((a) => a.accountCode === "1100");
    expect(receivable).toBeDefined();
    expect(money.compare(receivable!.currentDebit, "0")).toBe(1);

    // Previous period has no transactions — all previous amounts should be zero
    expect(result.previousTotalDebit).toBe("0.00");
    expect(result.previousTotalCredit).toBe("0.00");

    // Variance = current - previous; since previous is 0, variance equals currentBalance
    expect(receivable!.variance).toBe(receivable!.currentBalance);

    // variancePercent should be "N/A" when previous is 0
    expect(receivable!.variancePercent).toBe("N/A");
  });

  it("handles empty previous year gracefully (new business)", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.comparativeTrialBalance({
      currentFYStart: new Date("2030-04-01").toISOString(),
      currentFYEnd: new Date("2031-03-31").toISOString(),
      previousFYStart: new Date("2028-04-01").toISOString(),
      previousFYEnd: new Date("2029-03-31").toISOString(),
    });

    // No previous year data — all accounts should show N/A for variancePercent
    for (const acc of result.accounts) {
      if (money.compare(acc.previousBalance, "0") === 0) {
        expect(acc.variancePercent).toBe("N/A");
      }
    }
  });
});

describe("Comparative Profit & Loss", () => {
  it("shows income and expense variance between two periods", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.comparativeProfitAndLoss({
      currentFYStart: new Date("2030-04-01").toISOString(),
      currentFYEnd: new Date("2031-03-31").toISOString(),
      previousFYStart: new Date("2029-04-01").toISOString(),
      previousFYEnd: new Date("2030-03-31").toISOString(),
    });

    expect(result.income).toBeDefined();
    expect(result.expenses).toBeDefined();

    // currentNetProfit = currentTotalIncome - currentTotalExpenses
    expect(result.currentNetProfit).toBe(money.sub(result.currentTotalIncome, result.currentTotalExpenses));

    // previousNetProfit = previousTotalIncome - previousTotalExpenses
    expect(result.previousNetProfit).toBe(money.sub(result.previousTotalIncome, result.previousTotalExpenses));

    // netProfitVariance = currentNetProfit - previousNetProfit
    expect(result.netProfitVariance).toBe(money.sub(result.currentNetProfit, result.previousNetProfit));

    // Previous period is empty — all previous amounts zero
    expect(result.previousTotalIncome).toBe("0.00");
    expect(result.previousTotalExpenses).toBe("0.00");
  });
});

describe("Comparative Balance Sheet", () => {
  it("maintains accounting equation for both periods", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.comparativeBalanceSheet({
      currentAsOf: new Date("2031-03-31").toISOString(),
      previousAsOf: new Date("2030-03-31").toISOString(),
    });

    expect(result.assets).toBeDefined();
    expect(result.liabilities).toBeDefined();
    expect(result.equity).toBeDefined();

    // Current period: Assets = Liabilities + Equity
    const curAssets = money.sum(result.assets.map((a) => a.currentBalance));
    const curLiab = money.sum(result.liabilities.map((a) => a.currentBalance));
    const curEquity = money.sum(result.equity.map((a) => a.currentBalance));
    expect(curAssets).toBe(money.add(curLiab, curEquity));

    // Both periods have defined totals
    expect(result.currentTotalAssets).toBeDefined();
    expect(result.previousTotalAssets).toBeDefined();
    expect(result.currentTotalLiabilities).toBeDefined();
    expect(result.previousTotalLiabilities).toBeDefined();
    expect(result.currentTotalEquity).toBeDefined();
    expect(result.previousTotalEquity).toBeDefined();
  });

  it("includes net income in equity for both periods with variance", async () => {
    const caller = callerForRamesh();

    const result = await caller.reports.comparativeBalanceSheet({
      currentAsOf: new Date("2031-03-31").toISOString(),
      previousAsOf: new Date("2030-03-31").toISOString(),
    });

    const netIncomeItem = result.equity.find((a) => a.accountName === "Net Income (Current Period)");
    expect(netIncomeItem).toBeDefined();
    expect(netIncomeItem!.variance).toBeDefined();
    expect(netIncomeItem!.variancePercent).toBeDefined();
  });
});
