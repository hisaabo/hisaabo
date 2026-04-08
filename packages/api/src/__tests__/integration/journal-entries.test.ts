import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { chartOfAccounts, journalEntries } from "@hisaabo/db";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { money } from "@hisaabo/shared";

let world: TestWorld;

// Account IDs looked up from the seeded CoA
let cashAccountId: string;         // 1000 - Cash in Hand (asset)
let capitalAccountId: string;      // 3000 - Capital Account (equity)
let depreciationAccountId: string; // 5900 - Depreciation (expense)
let fixedAssetsAccountId: string;  // 1500 - Fixed Assets (asset)

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);

  // Look up account IDs from the seeded CoA
  const accounts = await db
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.businessId, world.business1.id));

  const findAccount = (code: string) => {
    const acct = accounts.find((a) => a.code === code);
    if (!acct) throw new Error(`CoA account ${code} not found in seed`);
    return acct;
  };

  const cash = findAccount("1000");
  const capital = findAccount("3000");
  const depreciation = findAccount("5900");
  const fixedAssets = findAccount("1500");

  cashAccountId = cash.id;
  capitalAccountId = capital.id;
  depreciationAccountId = depreciation.id;
  fixedAssetsAccountId = fixedAssets.id;
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

// ---------------------------------------------------------------------------
// 1. Journal Entry Update
// ---------------------------------------------------------------------------

describe("Journal Entry Update", () => {
  it("updates narration and date of a manual entry", async () => {
    const caller = callerForRamesh();

    const created = await caller.journal.create({
      entryDate: new Date("2030-06-01").toISOString(),
      narration: "Original narration",
      lines: [
        { accountId: cashAccountId, debit: "50000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "50000.00" },
      ],
    });

    const newDate = new Date("2030-07-15").toISOString();
    await caller.journal.update({
      id: created.id,
      narration: "Updated narration",
      entryDate: newDate,
    });

    const fetched = await caller.journal.getById({ id: created.id });
    expect(fetched.narration).toBe("Updated narration");
    // Verify the date was updated (compare date portion)
    expect(new Date(fetched.entryDate).toISOString().slice(0, 10)).toBe("2030-07-15");
  });

  it("updates lines of a manual entry", async () => {
    const caller = callerForRamesh();

    const created = await caller.journal.create({
      entryDate: new Date("2030-06-01").toISOString(),
      narration: "Line update test",
      lines: [
        { accountId: cashAccountId, debit: "25000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "25000.00" },
      ],
    });

    await caller.journal.update({
      id: created.id,
      lines: [
        { accountId: cashAccountId, debit: "30000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "30000.00" },
      ],
    });

    const fetched = await caller.journal.getById({ id: created.id });
    expect(fetched.lines).toHaveLength(2);

    const cashLine = fetched.lines.find((l) => l.accountId === cashAccountId);
    const capitalLine = fetched.lines.find((l) => l.accountId === capitalAccountId);
    expect(cashLine).toBeDefined();
    expect(capitalLine).toBeDefined();
    expect(money.compare(cashLine!.debit, "30000.00")).toBe(0);
    expect(money.compare(capitalLine!.credit, "30000.00")).toBe(0);
  });

  it("rejects update of system-generated entry", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // Insert a system-generated entry directly in the DB
    const [systemEntry] = await db
      .insert(journalEntries)
      .values({
        businessId: world.business1.id,
        entryNumber: "JE-SYS-001",
        entryDate: new Date("2030-06-01"),
        narration: "System generated",
        source: "system",
        createdByUserId: world.ramesh.id,
        createdByName: world.ramesh.name,
      })
      .returning();

    await expect(
      caller.journal.update({
        id: systemEntry!.id,
        narration: "Attempted update",
      }),
    ).rejects.toThrow(/manually created/i);
  });

  it("rejects update of voided entry", async () => {
    const caller = callerForRamesh();

    const created = await caller.journal.create({
      entryDate: new Date("2030-06-01").toISOString(),
      narration: "To be voided then updated",
      lines: [
        { accountId: cashAccountId, debit: "10000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "10000.00" },
      ],
    });

    await caller.journal.void({ id: created.id });

    await expect(
      caller.journal.update({
        id: created.id,
        narration: "Attempted update after void",
      }),
    ).rejects.toThrow(/voided/i);
  });

  it("rejects unbalanced line update", async () => {
    const caller = callerForRamesh();

    const created = await caller.journal.create({
      entryDate: new Date("2030-06-01").toISOString(),
      narration: "Unbalanced update test",
      lines: [
        { accountId: cashAccountId, debit: "10000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "10000.00" },
      ],
    });

    await expect(
      caller.journal.update({
        id: created.id,
        lines: [
          { accountId: cashAccountId, debit: "10000.00", credit: "0" },
          { accountId: capitalAccountId, debit: "0", credit: "5000.00" },
        ],
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Journal Entry Void
// ---------------------------------------------------------------------------

describe("Journal Entry Void", () => {
  it("creates a reversing entry and marks original as voided", async () => {
    const caller = callerForRamesh();

    const created = await caller.journal.create({
      entryDate: new Date("2030-06-01").toISOString(),
      narration: "Capital introduction for void test",
      lines: [
        { accountId: cashAccountId, debit: "25000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "25000.00" },
      ],
    });

    const voidResult = await caller.journal.void({ id: created.id });

    // Original should be voided
    const original = await caller.journal.getById({ id: created.id });
    expect(original.isVoided).toBe(true);
    expect(original.voidedByEntryId).toBe(voidResult.reversingEntry.id);

    // Reversing entry should exist and point back to original
    const reversing = await caller.journal.getById({
      id: voidResult.reversingEntry.id,
    });
    expect(reversing.reversesEntryId).toBe(created.id);
    expect(reversing.narration).toMatch(/void.*reversal/i);

    // Reversing lines should have debits/credits swapped
    // Original: Dr Cash 25000, Cr Capital 25000
    // Reversing: Dr Capital 25000, Cr Cash 25000
    const reversingCashLine = reversing.lines.find(
      (l) => l.accountId === cashAccountId,
    );
    const reversingCapitalLine = reversing.lines.find(
      (l) => l.accountId === capitalAccountId,
    );

    expect(reversingCashLine).toBeDefined();
    expect(reversingCapitalLine).toBeDefined();

    // Cash was originally debit -> now should be credit
    expect(money.compare(reversingCashLine!.credit, "25000.00")).toBe(0);
    expect(money.compare(reversingCashLine!.debit, "0")).toBe(0);

    // Capital was originally credit -> now should be debit
    expect(money.compare(reversingCapitalLine!.debit, "25000.00")).toBe(0);
    expect(money.compare(reversingCapitalLine!.credit, "0")).toBe(0);
  });

  it("voided entries net to zero in Trial Balance", async () => {
    const caller = callerForRamesh();

    // Get baseline trial balance
    const baselineTb = await caller.reports.trialBalance({
      asOfDate: new Date("2030-12-31").toISOString(),
    });
    const baselineDepreciation = baselineTb.accounts.find(
      (a) => a.accountCode === "5900",
    );
    const baselineDeprBalance = baselineDepreciation?.balance ?? "0.00";

    // Create a depreciation entry
    const created = await caller.journal.create({
      entryDate: new Date("2030-06-15").toISOString(),
      narration: "Depreciation for void TB test",
      lines: [
        { accountId: depreciationAccountId, debit: "10000.00", credit: "0" },
        { accountId: fixedAssetsAccountId, debit: "0", credit: "10000.00" },
      ],
    });

    // Void it
    await caller.journal.void({ id: created.id });

    // Fetch trial balance again
    const afterTb = await caller.reports.trialBalance({
      asOfDate: new Date("2030-12-31").toISOString(),
    });
    const afterDepreciation = afterTb.accounts.find(
      (a) => a.accountCode === "5900",
    );
    const afterDeprBalance = afterDepreciation?.balance ?? "0.00";

    // Depreciation balance (debit - credit) should match baseline because
    // the voided entry and its reversal cancel each other out.
    expect(money.compare(afterDeprBalance, baselineDeprBalance)).toBe(0);

    // Total debits must still equal total credits
    expect(afterTb.totalDebit).toBe(afterTb.totalCredit);
  });

  it("rejects voiding an already voided entry", async () => {
    const caller = callerForRamesh();

    const created = await caller.journal.create({
      entryDate: new Date("2030-06-01").toISOString(),
      narration: "Double void test",
      lines: [
        { accountId: cashAccountId, debit: "5000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "5000.00" },
      ],
    });

    await caller.journal.void({ id: created.id });

    await expect(
      caller.journal.void({ id: created.id }),
    ).rejects.toThrow(/already voided/i);
  });

  it("voided entries net to zero in Balance Sheet", async () => {
    const caller = callerForRamesh();

    // Get baseline balance sheet
    const baselineBs = await caller.reports.balanceSheet({
      asOfDate: new Date("2030-12-31").toISOString(),
    });
    const baselineTotalAssets = money.sum(
      baselineBs.assets.map((a) => a.balance),
    );
    const baselineTotalLiabEquity = money.add(
      money.sum(baselineBs.liabilities.map((a) => a.balance)),
      money.sum(baselineBs.equity.map((a) => a.balance)),
    );

    // Create an entry affecting asset and equity accounts
    const created = await caller.journal.create({
      entryDate: new Date("2030-06-20").toISOString(),
      narration: "BS void test",
      lines: [
        { accountId: cashAccountId, debit: "50000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "50000.00" },
      ],
    });

    // Void it
    await caller.journal.void({ id: created.id });

    // Fetch balance sheet again
    const afterBs = await caller.reports.balanceSheet({
      asOfDate: new Date("2030-12-31").toISOString(),
    });
    const afterTotalAssets = money.sum(afterBs.assets.map((a) => a.balance));
    const afterTotalLiabEquity = money.add(
      money.sum(afterBs.liabilities.map((a) => a.balance)),
      money.sum(afterBs.equity.map((a) => a.balance)),
    );

    // Totals should be the same as baseline (voided entry nets to zero)
    expect(money.compare(afterTotalAssets, baselineTotalAssets)).toBe(0);
    expect(money.compare(afterTotalLiabEquity, baselineTotalLiabEquity)).toBe(0);

    // Accounting equation must hold
    expect(afterTotalAssets).toBe(afterTotalLiabEquity);
  });
});

// ---------------------------------------------------------------------------
// 3. Journal Entry Templates
// ---------------------------------------------------------------------------

describe("Journal Entry Templates", () => {
  it("creates a template from line structure", async () => {
    const caller = callerForRamesh();

    const template = await caller.journal.templateCreate({
      name: "Monthly Depreciation",
      narration: "Monthly depreciation of fixed assets",
      lines: [
        {
          accountId: depreciationAccountId,
          accountCode: "5900",
          accountName: "Depreciation",
          debit: "5000.00",
          credit: "0",
        },
        {
          accountId: fixedAssetsAccountId,
          accountCode: "1500",
          accountName: "Fixed Assets",
          debit: "0",
          credit: "5000.00",
        },
      ],
    });

    expect(template.id).toBeDefined();
    expect(template.name).toBe("Monthly Depreciation");

    const templates = await caller.journal.templateList();
    const found = templates.find((t) => t.id === template.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Monthly Depreciation");
  });

  it("creates an entry from a template", async () => {
    const caller = callerForRamesh();

    // Create template
    const template = await caller.journal.templateCreate({
      name: "Capital Introduction Template",
      narration: "Standard capital introduction",
      lines: [
        {
          accountId: cashAccountId,
          accountCode: "1000",
          accountName: "Cash in Hand",
          debit: "100000.00",
          credit: "0",
        },
        {
          accountId: capitalAccountId,
          accountCode: "3000",
          accountName: "Capital Account",
          debit: "0",
          credit: "100000.00",
        },
      ],
    });

    // Create entry from template
    const entry = await caller.journal.createFromTemplate({
      templateId: template.id,
      entryDate: new Date("2030-08-01").toISOString(),
    });

    expect(entry.id).toBeDefined();
    expect(entry.entryNumber).toMatch(/^JE-/);

    // Verify the entry has correct lines
    const fetched = await caller.journal.getById({ id: entry.id });
    expect(fetched.lines).toHaveLength(2);

    const cashLine = fetched.lines.find((l) => l.accountId === cashAccountId);
    const capitalLine = fetched.lines.find(
      (l) => l.accountId === capitalAccountId,
    );
    expect(cashLine).toBeDefined();
    expect(capitalLine).toBeDefined();
    expect(money.compare(cashLine!.debit, "100000.00")).toBe(0);
    expect(money.compare(capitalLine!.credit, "100000.00")).toBe(0);
  });

  it("deletes a template", async () => {
    const caller = callerForRamesh();

    const template = await caller.journal.templateCreate({
      name: "To Be Deleted Template",
      lines: [
        {
          accountId: cashAccountId,
          accountCode: "1000",
          accountName: "Cash in Hand",
          debit: "1000.00",
          credit: "0",
        },
        {
          accountId: capitalAccountId,
          accountCode: "3000",
          accountName: "Capital Account",
          debit: "0",
          credit: "1000.00",
        },
      ],
    });

    await caller.journal.templateDelete({ id: template.id });

    const templates = await caller.journal.templateList();
    const found = templates.find((t) => t.id === template.id);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Reports Include Journal Entries
// ---------------------------------------------------------------------------

describe("Reports include journal entries", () => {
  it("Trial Balance includes manual journal entries", async () => {
    const caller = callerForRamesh();

    // Get baseline
    const baselineTb = await caller.reports.trialBalance({
      asOfDate: new Date("2030-12-31").toISOString(),
    });
    const baselineCashDebit =
      baselineTb.accounts.find((a) => a.accountCode === "1000")?.debit ?? "0.00";
    const baselineCapitalCredit =
      baselineTb.accounts.find((a) => a.accountCode === "3000")?.credit ?? "0.00";

    // Create a journal entry: Dr Cash 50000, Cr Capital 50000
    await caller.journal.create({
      entryDate: new Date("2030-07-01").toISOString(),
      narration: "TB integration test",
      lines: [
        { accountId: cashAccountId, debit: "50000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "50000.00" },
      ],
    });

    // Fetch trial balance
    const afterTb = await caller.reports.trialBalance({
      asOfDate: new Date("2030-12-31").toISOString(),
    });

    const cashRow = afterTb.accounts.find((a) => a.accountCode === "1000");
    const capitalRow = afterTb.accounts.find((a) => a.accountCode === "3000");

    expect(cashRow).toBeDefined();
    expect(capitalRow).toBeDefined();

    // Cash debit should have increased by 50000
    expect(
      money.compare(cashRow!.debit, money.add(baselineCashDebit, "50000.00")),
    ).toBe(0);

    // Capital credit should have increased by 50000
    expect(
      money.compare(
        capitalRow!.credit,
        money.add(baselineCapitalCredit, "50000.00"),
      ),
    ).toBe(0);

    // Fundamental: total debits = total credits
    expect(afterTb.totalDebit).toBe(afterTb.totalCredit);
  });

  it("Balance Sheet includes manual journal entries", async () => {
    const caller = callerForRamesh();

    // Create a journal entry affecting asset and equity
    await caller.journal.create({
      entryDate: new Date("2030-07-15").toISOString(),
      narration: "BS integration test",
      lines: [
        { accountId: cashAccountId, debit: "75000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "75000.00" },
      ],
    });

    // Fetch balance sheet
    const bs = await caller.reports.balanceSheet({
      asOfDate: new Date("2030-12-31").toISOString(),
    });

    // Accounting equation: Assets = Liabilities + Equity
    const totalAssets = money.sum(bs.assets.map((a) => a.balance));
    const totalLiabilities = money.sum(bs.liabilities.map((a) => a.balance));
    const totalEquity = money.sum(bs.equity.map((a) => a.balance));
    const liabPlusEquity = money.add(totalLiabilities, totalEquity);

    expect(totalAssets).toBe(liabPlusEquity);

    // Cash account should appear in assets with a positive balance
    const cashAsset = bs.assets.find((a) => a.accountCode === "1000");
    expect(cashAsset).toBeDefined();
    expect(money.compare(cashAsset!.balance, "0")).toBe(1);
  });

  it("P&L includes manual journal entries", async () => {
    const caller = callerForRamesh();

    // Get baseline P&L
    const baselinePl = await caller.reports.profitAndLoss({
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });
    const baselineNetProfit = baselinePl.netProfit;

    // Create a depreciation expense entry: Dr Depreciation 5000, Cr Fixed Assets 5000
    await caller.journal.create({
      entryDate: new Date("2030-08-01").toISOString(),
      narration: "PL integration test depreciation",
      lines: [
        { accountId: depreciationAccountId, debit: "5000.00", credit: "0" },
        { accountId: fixedAssetsAccountId, debit: "0", credit: "5000.00" },
      ],
    });

    // Fetch P&L
    const afterPl = await caller.reports.profitAndLoss({
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });

    // Depreciation should appear in expenses
    const depreciationExpense = afterPl.expenses.find(
      (e) => e.accountCode === "5900",
    );
    expect(depreciationExpense).toBeDefined();
    expect(money.compare(depreciationExpense!.amount, "0")).toBe(1);

    // Net profit should have decreased by the depreciation amount
    const expectedNetProfit = money.sub(baselineNetProfit, "5000.00");
    expect(money.compare(afterPl.netProfit, expectedNetProfit)).toBe(0);

    // Net profit = total income - total expenses
    const totalIncome = money.sum(afterPl.income.map((a) => a.amount));
    const totalExpenses = money.sum(afterPl.expenses.map((a) => a.amount));
    expect(afterPl.netProfit).toBe(money.sub(totalIncome, totalExpenses));
  });
});
