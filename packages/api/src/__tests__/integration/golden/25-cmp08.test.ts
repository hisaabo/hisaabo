/**
 * Scenario 25 — CMP-08 counts outward supplies exactly as GSTR-1 / GSTR-3B do.
 *
 * CMP-08 (composition scheme) used to sum every non-cancelled `type = 'sale'` row of the quarter:
 * quotations, proformas and delivery challans counted, credit notes and sales returns were ADDED,
 * and deleted documents counted. Now it is the sum of the quarter's three GSTR-1 months: sale
 * INVOICES not cancelled and not deleted, NET of credit notes and sales returns, plus sale-side
 * debit notes; tax payable is 1% (traders) of that taxable value.
 *
 * FY 2025-26 Q3 = October-December 2025 (IST). All amounts at 0% GST, so taxable = price.
 *
 *   counted:  S1 10000.00 (10 Oct)   S2 5000.00 (20 Dec)
 *             edge in:  O 222.00 at 2025-09-30T18:30:00.000Z [1 Oct 00:00:00.000 IST]
 *                       D 333.00 at 2025-12-31T18:29:59.500Z [31 Dec 23:59:59.500 IST]
 *             debit note (sale side) +200.00
 *   deducted: credit note 1500.00, sales return 500.00
 *   not counted: quotation 99999.00, proforma 88888.00, delivery challan 7777.00, a cancelled invoice 20000.00,
 *             a soft-deleted invoice 3000.00, a purchase invoice 4000.00, a credit note raised from a purchase
 *             invoice 900.00, edge out: 111.00 at 2025-09-30T18:29:59.500Z [30 Sep 23:59:59.500 IST]
 *                                      444.00 at 2025-12-31T18:30:00.000Z [ 1 Jan 00:00:00.000 IST]
 *
 *   taxable value = 10000.00 + 5000.00 + 222.00 + 333.00 + 200.00 - 1500.00 - 500.00 = 13755.00
 *   tax payable   = 13755.00 x 1% = 137.55
 *   quarter window: 2025-09-30T18:30:00.000Z .. 2025-12-31T18:29:59.999Z
 *   A quarter with only a credit note: net -250.00, payable 0.00.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { useGoldenDb, createGoldenWorld, addParty, addInvoice, addAdjustmentDoc, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const line = (price: string) => [{ name: "Goods", qty: "1", price, tax: "0" }];
const apiLine = (price: string) => [{ itemName: "Goods", quantity: "1", unitPrice: price, taxPercent: "0", discountPercent: "0" }];

describe("golden 25: CMP-08 outward supplies are the GSTR-1 / 3B ones", () => {
  let w: GoldenWorld;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = (await addParty(w, "customer", "MH")).id;
    const supplier = (await addParty(w, "supplier", "MH")).id;

    // counted
    await addInvoice(w, "sale", customer, line("10000.00"), { date: "2025-10-10T10:00:00.000Z" });
    await addInvoice(w, "sale", customer, line("5000.00"), { date: "2025-12-20T10:00:00.000Z" });
    await addInvoice(w, "sale", customer, line("222.00"), { date: "2025-09-30T18:30:00.000Z" });
    await addInvoice(w, "sale", customer, line("333.00"), { date: "2025-12-31T18:29:59.500Z" });
    await addAdjustmentDoc(w, "debitNote", "sale", customer, line("200.00"), { date: "2025-11-12T10:00:00.000Z" });
    // deducted
    await addAdjustmentDoc(w, "creditNote", "sale", customer, line("1500.00"), { date: "2025-11-15T10:00:00.000Z" });
    await addAdjustmentDoc(w, "salesReturn", "sale", customer, line("500.00"), { date: "2025-11-16T10:00:00.000Z" });
    // not counted: other documents
    await w.caller.quotation.create({ partyId: customer, type: "sale", invoiceDate: "2025-11-05T10:00:00.000Z", lineItems: apiLine("99999.00") });
    await w.caller.proforma.create({ partyId: customer, type: "sale", invoiceDate: "2025-11-05T10:00:00.000Z", lineItems: apiLine("88888.00") });
    await w.caller.deliveryChallan.create({ partyId: customer, type: "sale", invoiceDate: "2025-11-05T10:00:00.000Z", lineItems: apiLine("7777.00") });
    const cancelled = await addInvoice(w, "sale", customer, line("20000.00"), { date: "2025-11-07T10:00:00.000Z" });
    await w.caller.invoice.updateStatus({ id: cancelled.id, status: "cancelled" });
    const deleted = await addInvoice(w, "sale", customer, line("3000.00"), { date: "2025-11-08T10:00:00.000Z" });
    await w.caller.invoice.delete({ id: deleted.id });
    await addInvoice(w, "purchase", supplier, line("4000.00"), { date: "2025-11-09T10:00:00.000Z" });
    await addAdjustmentDoc(w, "creditNote", "purchase", supplier, line("900.00"), { date: "2025-11-17T10:00:00.000Z" });
    // not counted: outside the quarter by one millisecond
    await addInvoice(w, "sale", customer, line("111.00"), { date: "2025-09-30T18:29:59.500Z" });
    await addInvoice(w, "sale", customer, line("444.00"), { date: "2025-12-31T18:30:00.000Z" });
  });

  it("Q3 of FY 2025-26: taxable 13755.00, tax payable 137.55, window 1 Oct 00:00 IST .. 31 Dec 23:59:59.999 IST", async () => {
    const r = await w.caller.gst.cmp08({ year: 2025, quarter: 3 });
    expect(r).toEqual({
      taxableValue: "13755.00",
      taxPayable: "137.55",
      quarterStart: "2025-09-30T18:30:00.000Z",
      quarterEnd: "2025-12-31T18:29:59.999Z",
    });
  });

  it("agrees with GSTR-3B 3.1(a) summed over the same three months (same classification, same netting)", async () => {
    const months = await Promise.all([10, 11, 12].map((month) => w.caller.gst.gstr3b({ year: 2025, month })));
    const taxable = months.reduce((a, b) => a + Math.round(b.outwardSupplies.taxable.taxableValue * 100), 0);
    expect(taxable).toBe(1375500);
  });

  it("a quarter with only a credit note is negative and pays nothing", async () => {
    const w2 = await createGoldenWorld();
    const customer = (await addParty(w2, "customer", "MH")).id;
    await addAdjustmentDoc(w2, "creditNote", "sale", customer, line("250.00"), { date: "2025-11-15T10:00:00.000Z" });
    const r = await w2.caller.gst.cmp08({ year: 2025, quarter: 3 });
    expect([r.taxableValue, r.taxPayable]).toEqual(["-250.00", "0.00"]);
  });
});
