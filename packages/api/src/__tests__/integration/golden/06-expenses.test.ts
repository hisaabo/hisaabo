/**
 * Scenario 6 — Expenses in many categories, paid by cash and by bank.
 *
 * An expense has a free-text `category`; derive-ledger.ts maps it to an account:
 *   1. exact (case-insensitive) match on an account NAME in the chart of accounts,
 *   2. else the first matching keyword (rent, salary/wage, electricity/utilit*,
 *      communication/phone/internet, travel/conveyance/transport, office,
 *      repair/maintenance, depreciation, bank charge/fee, gateway, bad debt,
 *      professional/legal/audit, purchase, direct),
 *   3. else 5990 Miscellaneous.
 * Mode `cash` credits 1000 Cash in Hand; every other mode credits 1010 Bank.
 *
 *   category              amount      mode  -> account
 *   Shop Rent             25000.00    bank     5300 Rent
 *   Office Stationery      1250.50    cash     5700 Office Expenses
 *   Electricity Bill       3200.00    bank     5400 Electricity & Utilities
 *   Internet Charges       1180.00    cash     5500 Communication
 *   Client Travel          4500.75    cash     5600 Conveyance & Travel
 *   Staff Salary          40000.00    bank     5200 Salary & Wages
 *   Printer Repair          799.99    cash     5800 Repairs & Maintenance
 *   Bank Charges            118.00    bank     5950 (exact name match)
 *   Legal Fees             5900.00    bank     5980 Professional Fees
 *   Tea and Snacks          450.25    cash     5990 Miscellaneous (no keyword)
 *   Direct freight inward  2000.00    cash     5100 Direct Expenses
 *   marketing              3000.00    bank     5995 Marketing (user account, name match)
 *
 *   Cash total  = 1250.50 + 1180.00 + 4500.75 + 799.99 + 450.25 + 2000.00 = 10181.49
 *   Bank total  = 25000 + 3200 + 40000 + 118 + 5900 + 3000              = 77218.00
 *   All         = 87399.49
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addBankAccount,
  book,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 06: expenses mapped to accounts by category keyword", () => {
  let w: GoldenWorld;
  let bankId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    bankId = (await addBankAccount(w, "HDFC Current")).id;
    await w.caller.account.create({ code: "5995", name: "Marketing", accountType: "expense" });

    const day = (d: number) => `2025-07-${String(d).padStart(2, "0")}T10:00:00.000Z`;
    const spend = (
      category: string,
      amount: string,
      mode: "cash" | "bank",
      d: number,
    ) =>
      w.caller.expense.create({
        category,
        amount,
        mode,
        expenseDate: day(d),
        ...(mode === "bank" ? { bankAccountId: bankId } : {}),
      });

    await spend("Shop Rent", "25000.00", "bank", 1);
    await spend("Office Stationery", "1250.50", "cash", 2);
    await spend("Electricity Bill", "3200.00", "bank", 3);
    await spend("Internet Charges", "1180.00", "cash", 4);
    await spend("Client Travel", "4500.75", "cash", 5);
    await spend("Staff Salary", "40000.00", "bank", 6);
    await spend("Printer Repair", "799.99", "cash", 7);
    await spend("Bank Charges", "118.00", "bank", 8);
    await spend("Legal Fees", "5900.00", "bank", 9);
    await spend("Tea and Snacks", "450.25", "cash", 10);
    await spend("Direct freight inward", "2000.00", "cash", 11);
    await spend("marketing", "3000.00", "bank", 12);
    b = await book(w);
  });

  it("trial balance: each category lands on its mapped account", () => {
    expect(tbRows(b)).toEqual([
      ["1000", "0.00", "10181.49"], // cash out
      ["1010", "0.00", "77218.00"], // bank out
      ["5100", "2000.00", "0.00"], // Direct freight inward
      ["5200", "40000.00", "0.00"], // Staff Salary
      ["5300", "25000.00", "0.00"], // Shop Rent
      ["5400", "3200.00", "0.00"], // Electricity Bill
      ["5500", "1180.00", "0.00"], // Internet Charges
      ["5600", "4500.75", "0.00"], // Client Travel
      ["5700", "1250.50", "0.00"], // Office Stationery
      ["5800", "799.99", "0.00"], // Printer Repair
      ["5950", "118.00", "0.00"], // Bank Charges
      ["5980", "5900.00", "0.00"], // Legal Fees
      ["5990", "450.25", "0.00"], // Tea and Snacks (default bucket)
      ["5995", "3000.00", "0.00"], // marketing -> user-created account by name
    ]);
    // Debits: 2000 + 40000 + 25000 + 3200 + 1180 + 4500.75 + 1250.50 + 799.99
    //         + 118 + 5900 + 450.25 + 3000 = 87399.49.   Credits: 10181.49 + 77218.00 = 87399.49.
    expect(b.tb.totalDebit).toBe("87399.49");
    expect(b.tb.totalCredit).toBe("87399.49");
  });

  it("P&L: only direct expenses (5100) reduce gross profit; all of it reduces net profit", () => {
    expect(plSummary(b)).toEqual({
      income: [],
      expenses: [
        ["5100", "2000.00"],
        ["5200", "40000.00"],
        ["5300", "25000.00"],
        ["5400", "3200.00"],
        ["5500", "1180.00"],
        ["5600", "4500.75"],
        ["5700", "1250.50"],
        ["5800", "799.99"],
        ["5950", "118.00"],
        ["5980", "5900.00"],
        ["5990", "450.25"],
        ["5995", "3000.00"],
      ],
      totalIncome: "0.00",
      totalExpenses: "87399.49",
      grossProfit: "-2000.00", // 0 sales - (0 purchases + 2000 direct)
      netProfit: "-87399.49",
    });
  });

  it("balance sheet: cash and bank overdrawn by exactly the spend", () => {
    expect(bsSummary(b)).toEqual({
      assets: [
        ["1000", "-10181.49"],
        ["1010", "-77218.00"],
      ],
      liabilities: [],
      equity: [["9999", "-87399.49"]],
      totalAssets: "-87399.49",
      totalLiabilities: "0.00",
      totalEquity: "-87399.49",
    });
    expectBooksBalance(b);
  });

  it("operational cash and bank balances agree with the ledger (expenses are fully ledgered)", async () => {
    const s = await w.caller.bankAccount.summary();
    expect(s.cashInHand).toBe("-10181.49");
    expect(s.bankBalance).toBe("-77218.00");
  });

  it("category matching is a substring match: 'Current Account Fee' lands on 5300 Rent (documented quirk)", async () => {
    // "current" contains "rent", and the rent keyword is tested before "bank fee".
    // A posted GL keyed on an explicit account would not do this; pinned so the
    // migration notices the behaviour change.
    const w2 = await createGoldenWorld();
    await w2.caller.expense.create({
      category: "Current Account Fee",
      amount: "100.00",
      mode: "cash",
      expenseDate: "2025-07-15T10:00:00.000Z",
    });
    const b2 = await book(w2);
    expect(tbRows(b2)).toEqual([
      ["1000", "0.00", "100.00"],
      ["5300", "100.00", "0.00"],
    ]);
  });
});
