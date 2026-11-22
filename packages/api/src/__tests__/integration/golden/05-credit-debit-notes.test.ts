/**
 * Scenario 5 — Credit note / sales return / debit note (sale side) and
 * purchase return / debit note (purchase side).
 *
 * 5A  Sale side, intra-state customer, all at 18% GST, invoice left unpaid:
 *   Invoice        10 x 1000.00           = 10000.00 + 1800.00 GST = 11800.00
 *   Credit note     2 x 1000.00 (ref inv) =  2000.00 +  360.00     =  2360.00
 *   Sales return    1 x 1000.00 (ref inv) =  1000.00 +  180.00     =  1180.00
 *   Debit note      1 x  500.00 (sale)    =   500.00 +   90.00     =   590.00
 *   Ledger:
 *     invoice  Dr 1100 11800 / Cr 4000 10000, Cr 2100 900, Cr 2101 900
 *     CN       Dr 4010 2000, Dr 2100 180, Dr 2101 180 / Cr 1100 2360
 *     SR       Dr 4010 1000, Dr 2100  90, Dr 2101  90 / Cr 1100 1180
 *     DN       Dr 1100  590 / Cr 4000  500, Cr 2100 45, Cr 2101 45
 *   Receivable = 11800 - 2360 - 1180 + 590 = 8850.
 *
 * 5B  Purchase side, intra-state supplier, 18% GST, purchase left unpaid:
 *   Purchase        10 x 1000.00          = 10000.00 + 1800.00 GST = 11800.00
 *   Purchase return  2 x 1000.00          =  2000.00 +  360.00     =  2360.00
 *   Debit note       1 x  500.00 (purch.) =   500.00 +   90.00     =   590.00
 *   Ledger:
 *     purchase Dr 5000 10000, Dr 1510 900, Dr 1511 900 / Cr 2000 11800
 *     PR       Dr 2000 2360 / Cr 5010 2000, Cr 1510 180, Cr 1511 180
 *     DN       Dr 2000  590 / Cr 5010  500, Cr 1510  45, Cr 1511  45
 *   Payable = 11800 - 2360 - 590 = 8850.
 *
 * Bugs documented here (it.fails = the CORRECT expectation, currently failing):
 *   - reports.profitAndLoss grossProfit ignores sales returns (4010) and
 *     purchase returns (5010).
 *   - GSTR-3B output tax ignores credit/debit notes; GSTR-3B ITC ADDS purchase
 *     returns / purchase-side debit notes (no documentType filter).
 *   - party balance treats a PURCHASE-side debit note as increasing the payable.
 *   - GSTR-1 lists purchase-side debit notes / purchase returns.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addAdjustmentDoc,
  book,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  outstandingTotal,
  fixed2,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 05A: credit note, sales return and sale-side debit note", () => {
  let w: GoldenWorld;
  let partyId: string;
  let invoiceId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    partyId = (await addParty(w, "customer", "MH")).id;
    const inv = await addInvoice(
      w,
      "sale",
      partyId,
      [{ name: "Cotton fabric", qty: "10", price: "1000.00", tax: "18" }],
      { date: "2025-08-05T10:00:00.000Z" },
    );
    invoiceId = inv.id;

    await addAdjustmentDoc(
      w,
      "creditNote",
      "sale",
      partyId,
      [{ name: "Cotton fabric", qty: "2", price: "1000.00", tax: "18" }],
      { date: "2025-08-12T10:00:00.000Z", referenceDocumentId: invoiceId },
    );
    await addAdjustmentDoc(
      w,
      "salesReturn",
      "sale",
      partyId,
      [{ name: "Cotton fabric", qty: "1", price: "1000.00", tax: "18" }],
      { date: "2025-08-14T10:00:00.000Z", referenceDocumentId: invoiceId },
    );
    await addAdjustmentDoc(
      w,
      "debitNote",
      "sale",
      partyId,
      [{ name: "Late fee", qty: "1", price: "500.00", tax: "18" }],
      { date: "2025-08-18T10:00:00.000Z", referenceDocumentId: invoiceId },
    );
    b = await book(w);
  });

  it("trial balance", () => {
    expect(tbRows(b)).toEqual([
      ["1100", "12390.00", "3540.00"], // Dr 11800 + 590; Cr 2360 + 1180
      ["2100", "270.00", "945.00"], // Dr 180 + 90; Cr 900 + 45
      ["2101", "270.00", "945.00"],
      ["4000", "0.00", "10500.00"], // 10000 + 500 debit note
      ["4010", "3000.00", "0.00"], // returns 2000 + 1000
    ]);
    // Debits 12390 + 270 + 270 + 3000 = 15930; credits 3540 + 945 + 945 + 10500 = 15930.
    expect(b.tb.totalDebit).toBe("15930.00");
    expect(b.tb.totalCredit).toBe("15930.00");
  });

  it("P&L: sales returns (4010) are seeded as an INCOME account, so they show as -3000 income", () => {
    const s = plSummary(b);
    expect(s.income).toEqual([
      ["4000", "10500.00"],
      ["4010", "-3000.00"], // credit 0 - debit 3000
    ]);
    expect(s.expenses).toEqual([]);
    expect(s.totalIncome).toBe("7500.00"); // 10500 - 3000
    expect(s.totalExpenses).toBe("0.00");
    expect(s.netProfit).toBe("7500.00");
  });

  // BUG: reports.ts looks for 4010 among the EXPENSE items, but coa-seed.ts types
  // it as income, so the sales-returns deduction is never applied.
  it.fails("P&L gross profit is net of sales returns: 10500 - 3000 = 7500", () => {
    expect(b.pl.grossProfit).toBe("7500.00");
  });

  it("balance sheet: receivable 8850 = GST payable 1350 + profit 7500", () => {
    expect(bsSummary(b)).toEqual({
      assets: [["1100", "8850.00"]], // 12390 - 3540
      liabilities: [
        ["2100", "675.00"], // 945 - 270
        ["2101", "675.00"],
      ],
      equity: [["9999", "7500.00"]],
      totalAssets: "8850.00",
      totalLiabilities: "1350.00",
      totalEquity: "7500.00",
    });
    expectBooksBalance(b);
  });

  it("party balance equals the ledger receivable: 11800 - 2360 - 1180 + 590 = 8850", async () => {
    expect((await w.caller.party.getById({ id: partyId }))?.balance).toBe("8850.00");
    expect((await w.caller.party.ledgerReport({ partyId }))?.summary.closingBalance).toBe("8850.00");
  });

  it("aging report is invoice-based and does NOT net adjustments (current behaviour): 11800", async () => {
    // reports.outstanding only sums documentType = 'invoice', so it disagrees with
    // the ledger (8850) by the unapplied credit notes / returns / debit note.
    expect(await outstandingTotal(w, "receivable")).toBe("11800.00");
  });

  it("GSTR-1 lists the credit note and sales return, and the debit note", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 8 });
    expect(r.creditNotes.map((n) => [n.taxableAmount, n.taxAmount, n.totalAmount])).toEqual([
      ["2000.00", "360.00", "2360.00"],
      ["1000.00", "180.00", "1180.00"],
    ]);
    expect(r.debitNotes.map((n) => [n.taxableAmount, n.taxAmount, n.totalAmount])).toEqual([
      ["500.00", "90.00", "590.00"],
    ]);
  });

  it("GSTR-3B counts the invoice's tax gross: 900 CGST / 900 SGST (current behaviour)", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 8 });
    expect(fixed2(r.taxPayable.cgst)).toBe("900.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("900.00");
  });

  // BUG: gst-reports.ts generateGSTR3B never subtracts credit notes / sales returns
  // or adds debit notes, although the ledger's output-GST accounts do (675 each).
  it.fails("GSTR-3B output tax is net of credit/debit notes: 900 - 270 + 45 = 675 CGST and SGST", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 8 });
    expect(fixed2(r.taxPayable.cgst)).toBe("675.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("675.00");
  });
});

describe("golden 05B: purchase return and purchase-side debit note", () => {
  let w: GoldenWorld;
  let supplierId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    supplierId = (await addParty(w, "supplier", "MH")).id;
    const purchase = await addInvoice(
      w,
      "purchase",
      supplierId,
      [{ name: "Raw cotton", qty: "10", price: "1000.00", tax: "18" }],
      { date: "2025-09-05T10:00:00.000Z" },
    );
    await addAdjustmentDoc(
      w,
      "purchaseReturn",
      "purchase",
      supplierId,
      [{ name: "Raw cotton", qty: "2", price: "1000.00", tax: "18" }],
      { date: "2025-09-12T10:00:00.000Z", referenceDocumentId: purchase.id },
    );
    await addAdjustmentDoc(
      w,
      "debitNote",
      "purchase",
      supplierId,
      [{ name: "Rate difference", qty: "1", price: "500.00", tax: "18" }],
      { date: "2025-09-18T10:00:00.000Z", referenceDocumentId: purchase.id },
    );
    b = await book(w);
  });

  it("trial balance", () => {
    expect(tbRows(b)).toEqual([
      ["1510", "900.00", "225.00"], // input CGST: Dr 900; Cr 180 + 45
      ["1511", "900.00", "225.00"],
      ["2000", "2950.00", "11800.00"], // payable: Dr 2360 + 590; Cr 11800
      ["5000", "10000.00", "0.00"],
      ["5010", "0.00", "2500.00"], // purchase returns 2000 + 500
    ]);
    // Debits 900 + 900 + 2950 + 10000 = 14750; credits 225 + 225 + 11800 + 2500 = 14750.
    expect(b.tb.totalDebit).toBe("14750.00");
    expect(b.tb.totalCredit).toBe("14750.00");
  });

  it("P&L: purchase returns (5010) are an expense account carrying a credit, so -2500", () => {
    const s = plSummary(b);
    expect(s.expenses).toEqual([
      ["5000", "10000.00"],
      ["5010", "-2500.00"],
    ]);
    expect(s.income).toEqual([]);
    expect(s.totalExpenses).toBe("7500.00");
    expect(s.netProfit).toBe("-7500.00");
  });

  // BUG: gross profit only deducts 5000 and 5100; purchase returns (5010) are ignored.
  it.fails("P&L gross profit is net of purchase returns: 0 - (10000 - 2500) = -7500", () => {
    expect(b.pl.grossProfit).toBe("-7500.00");
  });

  it("balance sheet: input GST 1350 = payable 8850 + loss -7500", () => {
    expect(bsSummary(b)).toEqual({
      assets: [
        ["1510", "675.00"], // 900 - 225
        ["1511", "675.00"],
      ],
      liabilities: [["2000", "8850.00"]], // 11800 - 2950
      equity: [["9999", "-7500.00"]],
      totalAssets: "1350.00",
      totalLiabilities: "8850.00",
      totalEquity: "-7500.00",
    });
    expectBooksBalance(b);
  });

  it("aging report (payable) is invoice-based: 11800 (current behaviour)", async () => {
    expect(await outstandingTotal(w, "payable")).toBe("11800.00");
  });

  // BUG: party.ts (getById / list / ledgerReport) adds EVERY debit_note to the
  // balance, but a purchase-side debit note reduces what we owe (ledger: Dr 2000).
  // Actual today: 11800 - 2360 + 590 = 10030.
  it.fails("supplier balance equals the ledger payable: 11800 - 2360 - 590 = 8850", async () => {
    expect((await w.caller.party.getById({ id: supplierId }))?.balance).toBe("8850.00");
  });

  // BUG: generateGSTR1 pulls documentType IN (debit_note, purchase_return) with no
  // type filter, so purchase-side documents leak into the outward-supply return.
  it.fails("GSTR-1 (outward supplies) lists no purchase-side debit notes or returns", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 9 });
    expect(r.debitNotes).toEqual([]);
  });

  // BUG: generateGSTR3B selects every type = 'purchase' document with no
  // documentType = 'invoice' filter, so purchase returns / debit notes are ADDED to
  // ITC instead of reducing it. Ledger input GST is 675 + 675; actual CGST today is
  // 900 + 180 + 45 = 1125.
  it.fails("GSTR-3B ITC is net of purchase returns and debit notes: 675 CGST + 675 SGST", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect(fixed2(r.itc.cgst)).toBe("675.00");
    expect(fixed2(r.itc.sgst)).toBe("675.00");
  });
});
