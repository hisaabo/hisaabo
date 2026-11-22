/**
 * Scenario 1 — Intra-state B2B sale (CGST + SGST), paid in full by bank.
 *
 *   Invoice  10 x 1000.00 @ 18% GST, customer in the business's own state (MH)
 *     subtotal  10 x 1000.00            = 10000.00
 *     GST       10000.00 x 18%          =  1800.00  -> CGST 900.00 + SGST 900.00
 *     total     10000.00 + 1800.00      = 11800.00
 *   Payment  11800.00 by bank into a current account, against the invoice.
 *
 *   Ledger:  invoice  Dr 1100 11800.00 / Cr 4000 10000.00, Cr 2100 900.00, Cr 2101 900.00
 *            payment  Dr 1010 11800.00 / Cr 1100 11800.00
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
  fixed2,
  outstandingTotal,
  cashFlow,
  expectCashFlowReconciles,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 01: intra-state B2B sale, full bank payment", () => {
  let w: GoldenWorld;
  let b: Book;
  let partyId: string;
  let invoiceId: string;
  let bankId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    partyId = customer.id;
    const bank = await addBankAccount(w, "HDFC Current");
    bankId = bank.id;

    const inv = await addInvoice(
      w,
      "sale",
      partyId,
      [{ name: "Cotton fabric", qty: "10", price: "1000.00", tax: "18" }],
      { date: "2025-06-10T10:00:00.000Z" },
    );
    invoiceId = inv.id;
    await addPayment(w, {
      partyId,
      invoiceId,
      amount: "11800.00",
      mode: "bank",
      bankAccountId: bankId,
      date: "2025-06-20T10:00:00.000Z",
    });
    b = await book(w);
  });

  it("invoice totals are computed server-side", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.subtotal).toBe("10000.00");
    expect(inv?.taxAmount).toBe("1800.00");
    expect(inv?.totalAmount).toBe("11800.00");
    expect(inv?.amountPaid).toBe("11800.00");
    expect(inv?.status).toBe("paid");
  });

  it("trial balance: every touched account, debits == credits", () => {
    expect(tbRows(b)).toEqual([
      // code, debit, credit
      ["1010", "11800.00", "0.00"], // bank: received 11800
      ["1100", "11800.00", "11800.00"], // receivable: billed 11800, collected 11800
      ["2100", "0.00", "900.00"], // output CGST
      ["2101", "0.00", "900.00"], // output SGST
      ["4000", "0.00", "10000.00"], // sales
    ]);
    // Debits: 11800 + 11800 = 23600.  Credits: 11800 + 900 + 900 + 10000 = 23600.
    expect(b.tb.totalDebit).toBe("23600.00");
    expect(b.tb.totalCredit).toBe("23600.00");
  });

  it("P&L: sales 10000, no expenses", () => {
    expect(plSummary(b)).toEqual({
      income: [["4000", "10000.00"]],
      expenses: [],
      totalIncome: "10000.00",
      totalExpenses: "0.00",
      grossProfit: "10000.00",
      netProfit: "10000.00",
    });
  });

  it("balance sheet: Assets 11800 = Liabilities 1800 + Equity 10000 (all of it current profit)", () => {
    expect(bsSummary(b)).toEqual({
      assets: [["1010", "11800.00"]], // receivable nets to zero and is omitted
      liabilities: [
        ["2100", "900.00"],
        ["2101", "900.00"],
      ],
      equity: [["9999", "10000.00"]], // net income (current period)
      totalAssets: "11800.00",
      totalLiabilities: "1800.00",
      totalEquity: "10000.00",
    });
    expectBooksBalance(b);
  });

  it("party outstanding is zero on every surface", async () => {
    const party = await w.caller.party.getById({ id: partyId });
    expect(party?.balance).toBe("0.00");

    const ledger = await w.caller.party.ledgerReport({ partyId });
    expect(ledger?.summary).toEqual({
      totalDebit: "11800.00",
      totalCredit: "11800.00",
      closingBalance: "0.00",
    });

    expect(await outstandingTotal(w, "receivable")).toBe("0.00");
  });

  it("cash-flow statement: profit 10000 + GST held 1800 = 11800 cash, reconciled to the bank ledger", async () => {
    const cf = await cashFlow(w);
    expect(cf.operating).toEqual({
      netIncome: "10000.00",
      adjustments: [],
      workingCapitalChanges: [
        // receivable nets to zero within the period, so no line; GST is held, not yet paid
        { description: "Increase in Output CGST Payable", amount: "900.00" },
        { description: "Increase in Output SGST Payable", amount: "900.00" },
      ],
      totalOperating: "11800.00",
    });
    expect(cf.investing).toEqual({ items: [], totalInvesting: "0.00" });
    expect(cf.financing).toEqual({ items: [], totalFinancing: "0.00" });
    expect(cf.netCashFlow).toBe("11800.00");
    expect(cf.closingCashBalance).toBe("11800.00");
    expectCashFlowReconciles(cf, b);
  });

  it("bank account balance moved by the receipt", async () => {
    const account = await w.caller.bankAccount.getById({ id: bankId });
    expect(account?.currentBalance).toBe("11800.00");
  });

  it("GSTR-3B (Jun 2025): output tax split 900/900, no IGST, no ITC", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("10000.00");
    expect(fixed2(r.taxPayable.cgst)).toBe("900.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("900.00");
    expect(fixed2(r.taxPayable.igst)).toBe("0.00");
    expect(fixed2(r.itc.total)).toBe("0.00");
    expect(fixed2(r.netTax.total)).toBe("1800.00");
  });
});
