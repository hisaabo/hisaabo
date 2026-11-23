/**
 * Scenario 4 — Sale where the customer deducts TDS on the receipt.
 *
 *   Invoice  8 x 2000.00 @ 18% GST, intra-state customer
 *     subtotal  8 x 2000.00         = 16000.00
 *     GST       16000.00 x 18%      =  2880.00 -> CGST 1440.00 + SGST 1440.00
 *     total     16000.00 + 2880.00  = 18880.00
 *   TDS withheld by the customer: 10% of the taxable value 16000.00 = 1600.00
 *     (section 1027, professional fees; TDS is on the pre-GST value)
 *   Net cash received by bank:  18880.00 - 1600.00 = 17280.00
 *
 *   Ledger:  invoice Dr 1100 18880 / Cr 4000 16000, Cr 2100 1440, Cr 2101 1440
 *            receipt Dr 1010 17280, Dr 1600 1600 / Cr 1100 18880 (cash + TDS)
 *
 *   TDS sections are effective from 1 Apr 2026, so the receipt is in FY 2026-27.
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
  cashFlow,
  expectCashFlowReconciles,
  fy,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 04: sale with customer TDS on receipt", () => {
  let w: GoldenWorld;
  let partyId: string;
  let invoiceId: string;
  let paymentId: string;
  let bankId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    partyId = (await addParty(w, "customer", "MH")).id;
    bankId = (await addBankAccount(w, "Axis Current")).id;

    const inv = await addInvoice(
      w,
      "sale",
      partyId,
      [{ name: "Consulting", qty: "8", price: "2000.00", tax: "18" }],
      { date: "2026-05-10T10:00:00.000Z" },
    );
    invoiceId = inv.id;

    const payment = await addPayment(w, {
      partyId,
      invoiceId,
      amount: "17280.00", // net cash; the allocation is 17280 + 1600 = 18880
      mode: "bank",
      bankAccountId: bankId,
      date: "2026-06-05T10:00:00.000Z",
      tds: { amount: "1600.00", section: "1027", rate: "10" },
    });
    paymentId = payment.id;
    b = await book(w);
  });

  it("the receipt settles the whole invoice: cash 17280 + TDS 1600 = 18880", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.totalAmount).toBe("18880.00");
    expect(inv?.amountPaid).toBe("18880.00");
    expect(inv?.status).toBe("paid");

    const pay = await w.caller.payment.getById({ id: paymentId });
    expect(pay?.amount).toBe("17280.00");
  });

  it("trial balance: TDS Receivable 1600 is a debit", () => {
    expect(tbRows(b)).toEqual([
      ["1010", "17280.00", "0.00"], // net cash
      ["1100", "18880.00", "18880.00"], // billed 18880, discharged 17280 + 1600
      ["1600", "1600.00", "0.00"], // TDS receivable
      ["2100", "0.00", "1440.00"],
      ["2101", "0.00", "1440.00"],
      ["4000", "0.00", "16000.00"],
    ]);
    // Debits 17280 + 18880 + 1600 = 37760; credits 18880 + 1440 + 1440 + 16000 = 37760.
    expect(b.tb.totalDebit).toBe("37760.00");
    expect(b.tb.totalCredit).toBe("37760.00");
  });

  it("P&L: TDS is not an expense, profit is the full 16000", () => {
    expect(plSummary(b)).toEqual({
      income: [["4000", "16000.00"]],
      expenses: [],
      totalIncome: "16000.00",
      totalExpenses: "0.00",
      grossProfit: "16000.00",
      netProfit: "16000.00",
    });
  });

  it("balance sheet: assets 18880 (bank 17280 + TDS 1600) = GST 2880 + profit 16000", () => {
    expect(bsSummary(b)).toEqual({
      assets: [
        ["1010", "17280.00"],
        ["1600", "1600.00"],
      ],
      liabilities: [
        ["2100", "1440.00"],
        ["2101", "1440.00"],
      ],
      equity: [["9999", "16000.00"]],
      totalAssets: "18880.00",
      totalLiabilities: "2880.00",
      totalEquity: "16000.00",
    });
    expectBooksBalance(b);
  });

  it("party outstanding is zero: the withheld TDS counts as settled", async () => {
    expect((await w.caller.party.getById({ id: partyId }))?.balance).toBe("0.00");
    const ledger = await w.caller.party.ledgerReport({ partyId });
    expect(ledger?.summary).toEqual({
      totalDebit: "18880.00",
      totalCredit: "18880.00", // the receipt credits cash + TDS
      closingBalance: "0.00",
    });
    expect(await outstandingTotal(w, "receivable")).toBe("0.00");
  });

  it("cash-flow statement: TDS receivable is cash not yet received (-1600)", async () => {
    const cf = await cashFlow(w, fy(2026));
    expect(cf.operating).toEqual({
      netIncome: "16000.00",
      adjustments: [],
      workingCapitalChanges: [
        { description: "Increase in TDS Receivable", amount: "-1600.00" },
        { description: "Increase in Output CGST Payable", amount: "1440.00" },
        { description: "Increase in Output SGST Payable", amount: "1440.00" },
      ],
      totalOperating: "17280.00", // 16000 - 1600 + 1440 + 1440 = the net cash received
    });
    expect(cf.netCashFlow).toBe("17280.00");
    expectCashFlowReconciles(cf, await book(w, fy(2026)));
  });

  it("bank account moved by the net cash only", async () => {
    expect((await w.caller.bankAccount.getById({ id: bankId }))?.currentBalance).toBe("17280.00");
  });
});
