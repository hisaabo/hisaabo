/**
 * Scenario 14 — Credit note and sales return raised from a PURCHASE invoice.
 *
 * The apps create a credit note / sales return from a purchase invoice with
 * `type = "purchase"` (apps/web invoices.tsx passes the source invoice's type).
 * Such a document reverses the PURCHASE: it is not a sale-side credit note, so it
 * must hit the payable, purchase returns and input GST, reduce ITC in GSTR-3B,
 * stay out of GSTR-1, and reduce what we owe the supplier.
 *
 * Intra-state supplier, 18% GST, purchase left unpaid:
 *   Purchase        10 x 1000.00 = 10000.00 + 1800.00 GST = 11800.00
 *   Credit note      2 x 1000.00 =  2000.00 +  360.00     =  2360.00   (type purchase)
 *   Sales return     1 x 1000.00 =  1000.00 +  180.00     =  1180.00   (type purchase)
 *   Ledger:
 *     purchase Dr 5000 10000, Dr 1510 900, Dr 1511 900 / Cr 2000 11800
 *     CN       Dr 2000 2360 / Cr 5010 2000, Cr 1510 180, Cr 1511 180
 *     SR       Dr 2000 1180 / Cr 5010 1000, Cr 1510  90, Cr 1511  90
 *   Payable = 11800 - 2360 - 1180 = 8260.
 *   Input GST = 900 - 180 - 90 = 630 CGST and 630 SGST.
 *
 * The mirror image (the same documents with type "sale") is golden 05A.
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
  fixed2,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 14: credit note and sales return of a purchase invoice reverse the purchase", () => {
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
      "creditNote",
      "purchase",
      supplierId,
      [{ name: "Raw cotton", qty: "2", price: "1000.00", tax: "18" }],
      { date: "2025-09-12T10:00:00.000Z", referenceDocumentId: purchase.id },
    );
    await addAdjustmentDoc(
      w,
      "salesReturn",
      "purchase",
      supplierId,
      [{ name: "Raw cotton", qty: "1", price: "1000.00", tax: "18" }],
      { date: "2025-09-14T10:00:00.000Z", referenceDocumentId: purchase.id },
    );
    b = await book(w);
  });

  it("trial balance: payable and purchase returns, input GST reversed (no receivable, no output GST, no 4010)", () => {
    expect(tbRows(b)).toEqual([
      ["1510", "900.00", "270.00"], // input CGST: Dr 900; Cr 180 + 90
      ["1511", "900.00", "270.00"],
      ["2000", "3540.00", "11800.00"], // payable: Dr 2360 + 1180; Cr 11800
      ["5000", "10000.00", "0.00"],
      ["5010", "0.00", "3000.00"], // purchase returns 2000 + 1000
    ]);
    // Debits 900 + 900 + 3540 + 10000 = 15340; credits 270 + 270 + 11800 + 3000 = 15340.
    expect(b.tb.totalDebit).toBe("15340.00");
    expect(b.tb.totalCredit).toBe("15340.00");
  });

  it("P&L: purchase returns reduce direct costs: gross profit 0 - (10000 - 3000) = -7000", () => {
    expect(plSummary(b)).toEqual({
      income: [],
      expenses: [
        ["5000", "10000.00"],
        ["5010", "-3000.00"],
      ],
      totalIncome: "0.00",
      totalExpenses: "7000.00",
      grossProfit: "-7000.00",
      netProfit: "-7000.00",
    });
  });

  it("balance sheet: input GST 1260 = payable 8260 + loss -7000", () => {
    expect(bsSummary(b)).toEqual({
      assets: [
        ["1510", "630.00"],
        ["1511", "630.00"],
      ],
      liabilities: [["2000", "8260.00"]],
      equity: [["9999", "-7000.00"]],
      totalAssets: "1260.00",
      totalLiabilities: "8260.00",
      totalEquity: "-7000.00",
    });
    expectBooksBalance(b);
  });

  it("GSTR-3B: ITC is net of both documents (630 CGST + 630 SGST) and there is no output tax", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect(fixed2(r.itc.cgst)).toBe("630.00");
    expect(fixed2(r.itc.sgst)).toBe("630.00");
    expect(fixed2(r.itc.igst)).toBe("0.00");
    expect(fixed2(r.taxPayable.cgst)).toBe("0.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("0.00");
    expect(fixed2(r.netTax.total)).toBe("-1260.00");
  });

  it("GSTR-1 (outward supplies) lists neither document", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 9 });
    expect(r.creditNotes).toEqual([]);
    expect(r.debitNotes).toEqual([]);
    expect(r.invoiceCount).toBe(0);
  });

  it("every party surface says we owe the supplier 8260: -(11800 - 2360 - 1180), signed", async () => {
    expect((await w.caller.party.getById({ id: supplierId }))?.balance).toBe("-8260.00");
    const list = await w.caller.party.list({ type: "supplier", page: 1, limit: 10 });
    expect(list.data.find((p) => p.id === supplierId)?.balance).toBe("-8260.00");
    expect((await w.caller.party.ledgerReport({ partyId: supplierId }))?.summary.closingBalance).toBe("-8260.00");
    const tab = await w.caller.party.ledger({ partyId: supplierId });
    expect(tab.data.map((r) => [r.type, r.debit, r.credit, r.runningBalance])).toEqual([
      ["purchase", "0", "11800.00", "-11800.00"],
      ["credit_note", "2360.00", "0", "-9440.00"],
      ["sales_return", "1180.00", "0", "-8260.00"],
    ]);
  });
});

describe("golden 14B: the same documents typed 'sale' still reverse a SALE (golden 05A mirror)", () => {
  it("they hit receivable and output GST, reduce output tax, and are listed in GSTR-1", async () => {
    const w = await createGoldenWorld();
    const customerId = (await addParty(w, "customer", "MH")).id;
    await addInvoice(w, "sale", customerId, [{ name: "Cotton", qty: "10", price: "1000.00", tax: "18" }], {
      date: "2025-09-05T10:00:00.000Z",
    });
    await addAdjustmentDoc(w, "creditNote", "sale", customerId, [{ name: "Cotton", qty: "2", price: "1000.00", tax: "18" }], {
      date: "2025-09-12T10:00:00.000Z",
    });
    await addAdjustmentDoc(w, "salesReturn", "sale", customerId, [{ name: "Cotton", qty: "1", price: "1000.00", tax: "18" }], {
      date: "2025-09-14T10:00:00.000Z",
    });
    const book1 = await book(w);
    expect(tbRows(book1)).toEqual([
      ["1100", "11800.00", "3540.00"], // Dr 11800; Cr 2360 + 1180
      ["2100", "270.00", "900.00"], // Dr 180 + 90; Cr 900
      ["2101", "270.00", "900.00"],
      ["4000", "0.00", "10000.00"],
      ["4010", "3000.00", "0.00"],
    ]);
    const r3 = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect(fixed2(r3.taxPayable.cgst)).toBe("630.00"); // 900 - 180 - 90
    expect(fixed2(r3.itc.cgst)).toBe("0.00");
    const r1 = await w.caller.gst.gstr1({ year: 2025, month: 9 });
    expect(r1.creditNotes.map((n) => n.taxAmount)).toEqual(["360.00", "180.00"]);
  });
});
