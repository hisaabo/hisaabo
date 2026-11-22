/**
 * Scenario 3 — Purchase invoice with input GST, paid in full.
 *
 *   Purchase  20 x 500.00 @ 18% GST from a supplier in the business's own state
 *     subtotal  20 x 500.00        = 10000.00
 *     GST       10000.00 x 18%     =  1800.00 -> input CGST 900.00 + input SGST 900.00
 *     total     10000.00 + 1800.00 = 11800.00
 *   Payment made  11800.00 by bank, against the purchase.
 *
 *   Ledger:  purchase Dr 5000 10000, Dr 1510 900, Dr 1511 900 / Cr 2000 11800
 *            payment  Dr 2000 11800 / Cr 1010 11800
 *
 *   The business has no capital or sales in this scenario, so the bank goes
 *   negative and the whole purchase is a loss: Assets (-10000) = 0 + (-10000).
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

describe("golden 03: purchase with input GST, paid", () => {
  let w: GoldenWorld;
  let supplierId: string;
  let purchaseId: string;
  let b: Book;
  let balanceBeforePayment: string | undefined;
  let payableBeforePayment: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    supplierId = (await addParty(w, "supplier", "MH")).id;
    const bank = await addBankAccount(w, "SBI Current");

    const purchase = await addInvoice(
      w,
      "purchase",
      supplierId,
      [{ name: "Raw cotton", qty: "20", price: "500.00", tax: "18" }],
      { date: "2025-06-12T10:00:00.000Z" },
    );
    purchaseId = purchase.id;
    balanceBeforePayment = (await w.caller.party.getById({ id: supplierId }))?.balance;
    payableBeforePayment = await outstandingTotal(w, "payable");

    await addPayment(w, {
      partyId: supplierId,
      invoiceId: purchaseId,
      amount: "11800.00",
      mode: "bank",
      bankAccountId: bank.id,
      date: "2025-06-28T10:00:00.000Z",
    });
    b = await book(w);
  });

  it("before payment the supplier is owed the full 11800", () => {
    // The party balance is signed (positive = they owe you, negative = you owe them): -11800.00.
    // The aging report's payable total is a positive amount.
    expect(balanceBeforePayment).toBe("-11800.00");
    expect(payableBeforePayment).toBe("11800.00");
  });

  it("trial balance: input GST is a debit, bank a credit", () => {
    expect(tbRows(b)).toEqual([
      ["1010", "0.00", "11800.00"], // bank paid out
      ["1510", "900.00", "0.00"], // input CGST
      ["1511", "900.00", "0.00"], // input SGST
      ["2000", "11800.00", "11800.00"], // payable: owed 11800, settled 11800
      ["5000", "10000.00", "0.00"], // purchases
    ]);
    // Debits 900 + 900 + 11800 + 10000 = 23600; credits 11800 + 11800 = 23600.
    expect(b.tb.totalDebit).toBe("23600.00");
    expect(b.tb.totalCredit).toBe("23600.00");
  });

  it("P&L: purchases 10000 are a loss, gross profit -10000", () => {
    expect(plSummary(b)).toEqual({
      income: [],
      expenses: [["5000", "10000.00"]],
      totalIncome: "0.00",
      totalExpenses: "10000.00",
      grossProfit: "-10000.00", // 0 sales - 10000 purchases
      netProfit: "-10000.00",
    });
  });

  it("balance sheet: assets -10000 (bank -11800 + ITC 1800) = liabilities 0 + equity -10000", () => {
    expect(bsSummary(b)).toEqual({
      assets: [
        ["1010", "-11800.00"],
        ["1510", "900.00"],
        ["1511", "900.00"],
      ],
      liabilities: [], // payable nets to zero
      equity: [["9999", "-10000.00"]],
      totalAssets: "-10000.00",
      totalLiabilities: "0.00",
      totalEquity: "-10000.00",
    });
    expectBooksBalance(b);
  });

  it("cash-flow statement: loss -10000 and input GST -1800 reconcile to the -11800 bank payment", async () => {
    const cf = await cashFlow(w);
    expect(cf.operating).toEqual({
      netIncome: "-10000.00",
      adjustments: [],
      workingCapitalChanges: [
        // payable nets to zero; the input-GST assets grew by 900 + 900 (cash not yet recovered)
        { description: "Increase in Input CGST", amount: "-900.00" },
        { description: "Increase in Input SGST", amount: "-900.00" },
      ],
      totalOperating: "-11800.00",
    });
    expect(cf.netCashFlow).toBe("-11800.00");
    expectCashFlowReconciles(cf, b);
  });

  it("supplier outstanding is zero and the purchase is paid", async () => {
    const purchase = await w.caller.invoice.getById({ id: purchaseId });
    expect(purchase?.status).toBe("paid");
    expect((await w.caller.party.getById({ id: supplierId }))?.balance).toBe("0.00");
    expect(await outstandingTotal(w, "payable")).toBe("0.00");
  });

  it("ITC ledger holds one available entry of 900 CGST + 900 SGST for 2025-06", async () => {
    const dash = await w.caller.itc.dashboard({ returnPeriod: "2025-06" });
    expect(dash.summary.available).toEqual({
      cgst: "900.00",
      sgst: "900.00",
      igst: "0.00",
      cess: "0.00",
      total: "1800.00",
    });
  });

  it("GSTR-3B (Jun 2025): ITC 900 + 900, no output tax, net tax -1800 (credit carried forward)", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.itc.cgst)).toBe("900.00");
    expect(fixed2(r.itc.sgst)).toBe("900.00");
    expect(fixed2(r.itc.igst)).toBe("0.00");
    expect(fixed2(r.itc.total)).toBe("1800.00");
    expect(fixed2(r.taxPayable.cgst)).toBe("0.00");
    expect(fixed2(r.netTax.total)).toBe("-1800.00");
  });
});
