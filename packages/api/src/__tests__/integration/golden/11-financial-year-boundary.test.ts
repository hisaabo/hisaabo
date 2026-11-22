/**
 * Scenario 11 — Financial-year boundary (financialYearStart = April).
 *
 *   FY 2025-26 = 1 Apr 2025 .. 31 Mar 2026     FY 2026-27 = 1 Apr 2026 .. 31 Mar 2027
 *
 *   Inv A  sale 10 x 1000.00 @ 18%  2026-03-31 12:00Z   10000.00 + 1800.00 = 11800.00  (FY25-26)
 *   Exp 1  Shop Rent 5000.00 cash   2026-03-31 23:59:59.999Z  last instant of FY25-26
 *   Exp 2  Shop Rent 7000.00 cash   2026-04-01 00:00:00.000Z  first instant of FY26-27
 *   Inv B  sale 20 x 1000.00 @ 18%  2026-04-01 12:00Z   20000.00 + 3600.00 = 23600.00  (FY26-27)
 *   Rcpt   11800.00 bank for Inv A  2026-04-02 12:00Z                                    (FY26-27)
 *
 * The trial balance is PERIOD ACTIVITY between fromDate and asOfDate, and the
 * balance sheet is CUMULATIVE from the beginning of time; there are no year-end
 * closing entries and no brought-forward balances. Documented gaps (0.12.0 will
 * change them with a posted ledger that carries opening balances forward):
 *   - the FY26-27 trial balance shows the receipt of Inv A (Cr 1100 11800) without
 *     Inv A's FY25-26 debit, so the FY26-27 receivable (11800) is NOT the closing
 *     receivable (23600);
 *   - the balance sheet's "Net Income (Current Period)" is all-time profit
 *     (5000 + 13000 = 18000 at 31 Mar 2027), not the FY26-27 profit of 13000.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addPayment,
  addBankAccount,
  book,
  fy,
  ALL_TIME,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 11: financial-year boundary, April start", () => {
  let w: GoldenWorld;
  let fy2526: Book;
  let fy2627: Book;
  let allTime: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customerId = (await addParty(w, "customer", "MH")).id;
    const bankId = (await addBankAccount(w, "HDFC Current")).id;
    const line = (qty: string) => [{ name: "Goods", qty, price: "1000.00", tax: "18" }];

    const invA = await addInvoice(w, "sale", customerId, line("10"), {
      date: "2026-03-31T12:00:00.000Z",
    });
    await w.caller.expense.create({
      category: "Shop Rent",
      amount: "5000.00",
      mode: "cash",
      expenseDate: "2026-03-31T23:59:59.999Z",
    });
    await w.caller.expense.create({
      category: "Shop Rent",
      amount: "7000.00",
      mode: "cash",
      expenseDate: "2026-04-01T00:00:00.000Z",
    });
    await addInvoice(w, "sale", customerId, line("20"), { date: "2026-04-01T12:00:00.000Z" });
    await addPayment(w, {
      partyId: customerId,
      invoiceId: invA.id,
      amount: "11800.00",
      mode: "bank",
      bankAccountId: bankId,
      date: "2026-04-02T12:00:00.000Z",
    });

    fy2526 = await book(w, fy(2025));
    fy2627 = await book(w, fy(2026));
    allTime = await book(w, ALL_TIME);
  });

  describe("FY 2025-26 (ends 31 Mar 2026 23:59:59.999)", () => {
    it("trial balance: Inv A and the last-instant rent, nothing from 1 Apr", () => {
      expect(tbRows(fy2526)).toEqual([
        ["1000", "0.00", "5000.00"], // Exp 1 at 23:59:59.999 is IN
        ["1100", "11800.00", "0.00"], // Inv A; its receipt is next year
        ["2100", "0.00", "900.00"],
        ["2101", "0.00", "900.00"],
        ["4000", "0.00", "10000.00"],
        ["5300", "5000.00", "0.00"],
      ]);
      // Debits 11800 + 5000 = 16800; credits 5000 + 900 + 900 + 10000 = 16800.
      expect(fy2526.tb.totalDebit).toBe("16800.00");
      expect(fy2526.tb.totalCredit).toBe("16800.00");
    });

    it("P&L: sales 10000, rent 5000", () => {
      expect(plSummary(fy2526)).toEqual({
        income: [["4000", "10000.00"]],
        expenses: [["5300", "5000.00"]],
        totalIncome: "10000.00",
        totalExpenses: "5000.00",
        grossProfit: "10000.00",
        netProfit: "5000.00",
      });
    });

    it("balance sheet at 31 Mar 2026: assets 6800 = GST 1800 + profit 5000", () => {
      expect(bsSummary(fy2526)).toEqual({
        assets: [
          ["1000", "-5000.00"],
          ["1100", "11800.00"],
        ],
        liabilities: [
          ["2100", "900.00"],
          ["2101", "900.00"],
        ],
        equity: [["9999", "5000.00"]],
        totalAssets: "6800.00",
        totalLiabilities: "1800.00",
        totalEquity: "5000.00",
      });
      expectBooksBalance(fy2526);
    });
  });

  describe("FY 2026-27 (starts 1 Apr 2026 00:00:00.000)", () => {
    it("trial balance: the first-instant rent is IN, and there is no brought-forward receivable (documented gap)", () => {
      expect(tbRows(fy2627)).toEqual([
        ["1000", "0.00", "7000.00"], // Exp 2 at 00:00:00.000 is IN
        ["1010", "11800.00", "0.00"], // receipt of Inv A
        ["1100", "23600.00", "11800.00"], // Inv B billed; the receipt credits A's 11800 with no opening debit
        ["2100", "0.00", "1800.00"],
        ["2101", "0.00", "1800.00"],
        ["4000", "0.00", "20000.00"],
        ["5300", "7000.00", "0.00"],
      ]);
      // Debits 11800 + 23600 + 7000 = 42400; credits 7000 + 11800 + 1800 + 1800 + 20000 = 42400.
      expect(fy2627.tb.totalDebit).toBe("42400.00");
      expect(fy2627.tb.totalCredit).toBe("42400.00");
    });

    it("P&L: sales 20000, rent 7000", () => {
      expect(plSummary(fy2627)).toEqual({
        income: [["4000", "20000.00"]],
        expenses: [["5300", "7000.00"]],
        totalIncome: "20000.00",
        totalExpenses: "7000.00",
        grossProfit: "20000.00",
        netProfit: "13000.00",
      });
    });

    it("balance sheet at 31 Mar 2027 is cumulative: its 'current period' profit is 18000, not 13000 (documented gap)", () => {
      expect(bsSummary(fy2627)).toEqual({
        assets: [
          ["1000", "-12000.00"], // rent 5000 + 7000
          ["1010", "11800.00"],
          ["1100", "23600.00"], // 11800 + 23600 - 11800
        ],
        liabilities: [
          ["2100", "2700.00"], // 900 + 1800
          ["2101", "2700.00"],
        ],
        equity: [["9999", "18000.00"]], // (10000 - 5000) + (20000 - 7000)
        totalAssets: "23400.00",
        totalLiabilities: "5400.00",
        totalEquity: "18000.00",
      });
      expect(fy2627.bs.equity.find((e) => e.accountCode === "9999")?.balance).not.toBe(
        fy2627.pl.netProfit,
      );
    });
  });

  describe("the two years partition the all-time book", () => {
    it("all-time trial balance is the sum of the two FYs, account by account", () => {
      expect(tbRows(allTime)).toEqual([
        ["1000", "0.00", "12000.00"], // 5000 + 7000
        ["1010", "11800.00", "0.00"],
        ["1100", "35400.00", "11800.00"], // 11800 + 23600 ; 11800
        ["2100", "0.00", "2700.00"],
        ["2101", "0.00", "2700.00"],
        ["4000", "0.00", "30000.00"],
        ["5300", "12000.00", "0.00"],
      ]);
      // Debits 11800 + 35400 + 12000 = 59200; credits 12000 + 11800 + 2700 + 2700 + 30000 = 59200.
      expect(allTime.tb.totalDebit).toBe("59200.00");
      expect(allTime.tb.totalCredit).toBe("59200.00");
      expectBooksBalance(allTime);
      // The year-end balance sheet equals the all-time one.
      expect(bsSummary(fy2627)).toEqual(bsSummary(allTime));
    });
  });

  describe("default financial year when fromDate is omitted", () => {
    // asOf is derived to the FY containing it; only the sales account is asserted
    // because the 1 Apr 00:00 / 31 Mar 23:59 expenses sit on the boundary itself
    // and the derived start uses the SERVER's local midnight (UTC in CI).
    it("asOf 31 Mar 2026 -> FY 2025-26 start: sees Inv A only", async () => {
      const tb = await w.caller.reports.trialBalance({ asOfDate: "2026-03-31T12:00:00.000Z" });
      const sales = tb.accounts.find((a) => a.accountCode === "4000");
      expect(sales?.credit).toBe("10000.00");
    });

    it("asOf 15 Apr 2026 -> FY 2026-27 start: sees Inv B only, not Inv A", async () => {
      const tb = await w.caller.reports.trialBalance({ asOfDate: "2026-04-15T12:00:00.000Z" });
      const sales = tb.accounts.find((a) => a.accountCode === "4000");
      expect(sales?.credit).toBe("20000.00");
    });
  });
});
