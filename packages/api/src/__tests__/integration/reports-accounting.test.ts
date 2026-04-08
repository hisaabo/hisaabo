import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
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
