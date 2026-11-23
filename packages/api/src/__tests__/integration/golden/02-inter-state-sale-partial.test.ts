/**
 * Scenario 2 — Inter-state sale (IGST), partial payment, then the rest in cash.
 *
 *   Invoice  5 x 2000.00 @ 12% GST, customer in Karnataka (business is in MH)
 *     subtotal  5 x 2000.00       = 10000.00
 *     IGST      10000.00 x 12%    =  1200.00
 *     total     10000.00 + 1200.00 = 11200.00
 *   Receipt 1  5000.00 by UPI (bank account)  -> 6200.00 outstanding, status partial
 *   Receipt 2  6200.00 in cash                -> 0.00 outstanding, status paid
 *
 *   Ledger:  invoice   Dr 1100 11200 / Cr 4000 10000, Cr 2102 1200
 *            receipt 1 Dr 1010 5000  / Cr 1100 5000
 *            receipt 2 Dr 1000 6200  / Cr 1100 6200
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
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  outstandingTotal,
  fixed2,
  cashFlow,
  expectCashFlowReconciles,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 02: inter-state sale, partial then cash settlement", () => {
  let w: GoldenWorld;
  let partyId: string;
  let invoiceId: string;
  let afterReceipt1: Book;
  let final: Book;
  let statusAfterReceipt1: string | undefined;
  let balanceAfterReceipt1: string | undefined;

  beforeAll(async () => {
    w = await createGoldenWorld();
    partyId = (await addParty(w, "customer", "KA")).id;
    const bank = await addBankAccount(w, "ICICI Current");

    const inv = await addInvoice(
      w,
      "sale",
      partyId,
      [{ name: "Machine part", qty: "5", price: "2000.00", tax: "12" }],
      { date: "2025-07-05T10:00:00.000Z" },
    );
    invoiceId = inv.id;

    await addPayment(w, {
      partyId,
      invoiceId,
      amount: "5000.00",
      mode: "upi",
      bankAccountId: bank.id,
      date: "2025-07-15T10:00:00.000Z",
    });
    afterReceipt1 = await book(w);
    statusAfterReceipt1 = (await w.caller.invoice.getById({ id: invoiceId }))?.status;
    balanceAfterReceipt1 = (await w.caller.party.getById({ id: partyId }))?.balance;

    await addPayment(w, {
      partyId,
      invoiceId,
      amount: "6200.00",
      mode: "cash",
      date: "2025-07-25T10:00:00.000Z",
    });
    final = await book(w);
  });

  describe("after the first (partial) receipt", () => {
    it("trial balance", () => {
      expect(tbRows(afterReceipt1)).toEqual([
        ["1010", "5000.00", "0.00"], // UPI receipt
        ["1100", "11200.00", "5000.00"], // billed 11200, collected 5000 -> 6200 due
        ["2102", "0.00", "1200.00"], // output IGST
        ["4000", "0.00", "10000.00"],
      ]);
      // Debits 5000 + 11200 = 16200; credits 5000 + 1200 + 10000 = 16200.
      expect(afterReceipt1.tb.totalDebit).toBe("16200.00");
      expect(afterReceipt1.tb.totalCredit).toBe("16200.00");
    });

    it("balance sheet: 5000 bank + 6200 receivable = 1200 IGST + 10000 profit", () => {
      expect(bsSummary(afterReceipt1)).toEqual({
        assets: [
          ["1010", "5000.00"],
          ["1100", "6200.00"],
        ],
        liabilities: [["2102", "1200.00"]],
        equity: [["9999", "10000.00"]],
        totalAssets: "11200.00",
        totalLiabilities: "1200.00",
        totalEquity: "10000.00",
      });
      expectBooksBalance(afterReceipt1);
    });

    it("party outstanding is 6200 and the invoice is partial", async () => {
      expect(statusAfterReceipt1).toBe("partial");
      expect(balanceAfterReceipt1).toBe("6200.00");
    });
  });

  describe("after the cash settlement", () => {
    it("trial balance", () => {
      expect(tbRows(final)).toEqual([
        ["1000", "6200.00", "0.00"], // cash
        ["1010", "5000.00", "0.00"], // bank (UPI)
        ["1100", "11200.00", "11200.00"],
        ["2102", "0.00", "1200.00"],
        ["4000", "0.00", "10000.00"],
      ]);
      // Debits 6200 + 5000 + 11200 = 22400; credits 11200 + 1200 + 10000 = 22400.
      expect(final.tb.totalDebit).toBe("22400.00");
      expect(final.tb.totalCredit).toBe("22400.00");
    });

    it("P&L", () => {
      expect(plSummary(final)).toEqual({
        income: [["4000", "10000.00"]],
        expenses: [],
        totalIncome: "10000.00",
        totalExpenses: "0.00",
        grossProfit: "10000.00",
        netProfit: "10000.00",
      });
    });

    it("balance sheet: 11200 assets = 1200 + 10000", () => {
      expect(bsSummary(final)).toEqual({
        assets: [
          ["1000", "6200.00"],
          ["1010", "5000.00"],
        ],
        liabilities: [["2102", "1200.00"]],
        equity: [["9999", "10000.00"]],
        totalAssets: "11200.00",
        totalLiabilities: "1200.00",
        totalEquity: "10000.00",
      });
      expectBooksBalance(final);
    });

    it("party outstanding is zero and the invoice is paid", async () => {
      const inv = await w.caller.invoice.getById({ id: invoiceId });
      expect(inv?.status).toBe("paid");
      expect(inv?.amountPaid).toBe("11200.00");
      expect((await w.caller.party.getById({ id: partyId }))?.balance).toBe("0.00");
      expect(await outstandingTotal(w, "receivable")).toBe("0.00");
    });

    it("cash-flow statement reconciles to cash 6200 + bank 5000", async () => {
      const cf = await cashFlow(w);
      expect(cf.operating.netIncome).toBe("10000.00");
      expect(cf.netCashFlow).toBe("11200.00");
      expectCashFlowReconciles(cf, final);
    });

    it("GSTR-3B (Jul 2025): all output tax is IGST", async () => {
      const r = await w.caller.gst.gstr3b({ year: 2025, month: 7 });
      expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("10000.00");
      expect(fixed2(r.taxPayable.igst)).toBe("1200.00");
      expect(fixed2(r.taxPayable.cgst)).toBe("0.00");
      expect(fixed2(r.taxPayable.sgst)).toBe("0.00");
      expect(fixed2(r.netTax.total)).toBe("1200.00");
    });
  });
});
