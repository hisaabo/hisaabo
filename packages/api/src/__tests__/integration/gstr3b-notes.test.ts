/**
 * GSTR-3B and credit / debit notes (sale side and purchase side), beyond the
 * intra-state scenario pinned in golden/05. Hand-computed.
 *
 * October 2025, everything inter-state (Karnataka party, Maharashtra business), 18% GST:
 *   Sale      10 x 1000.00 = 10000.00  GST 1800.00 IGST
 *   Credit note 2 x 1000.00 =  2000.00  GST  360.00
 *   Sales return 1 x 1000.00 =  1000.00  GST  180.00
 *   Debit note   1 x  500.00 =   500.00  GST   90.00   (sale side: raises output tax)
 *   Output IGST = 1800 - 360 - 180 + 90 = 1350.00 ; taxable value 10000 - 2000 - 1000 + 500 = 7500.00
 *
 *   Purchase    10 x 1000.00 = 10000.00  GST 1800.00 IGST
 *   Purchase return 2 x 1000.00 =  2000.00  GST 360.00
 *   Debit note (purchase side) 1 x 500.00 =   500.00  GST 90.00
 *   ITC IGST = 1800 - 360 - 90 = 1350.00 ; net tax = 1350 - 1350 = 0.00
 */
import { describe, it, expect } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addAdjustmentDoc,
  fixed2,
} from "./golden/golden-helpers.js";

useGoldenDb();

const OCT = (day: number) => `2025-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const GOODS = (qty: string, price = "1000.00") => [{ name: "Goods", qty, price, tax: "18" }];

describe("GSTR-3B nets credit / debit notes", () => {
  it("inter-state: output IGST and taxable value are net of credit notes and returns, plus sale debit notes", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "KA");
    await addInvoice(w, "sale", customer.id, GOODS("10"), { date: OCT(5) });
    await addAdjustmentDoc(w, "creditNote", "sale", customer.id, GOODS("2"), { date: OCT(12) });
    await addAdjustmentDoc(w, "salesReturn", "sale", customer.id, GOODS("1"), { date: OCT(14) });
    await addAdjustmentDoc(w, "debitNote", "sale", customer.id, GOODS("1", "500.00"), { date: OCT(18) });

    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.taxPayable.igst)).toBe("1350.00");
    expect(fixed2(r.taxPayable.cgst)).toBe("0.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("0.00");
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("7500.00");
    expect(fixed2(r.outwardSupplies.taxable.igst)).toBe("1350.00");
    expect(fixed2(r.netTax.total)).toBe("1350.00");

    // GSTR-1 itself still lists the invoice gross and the notes separately.
    const r1 = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    expect(fixed2(r1.totalIgst)).toBe("1800.00");
    expect(r1.creditNotes.map((n) => [n.taxAmount, n.igst, n.cgst, n.sgst])).toEqual([
      ["360.00", 360, 0, 0],
      ["180.00", 180, 0, 0],
    ]);
    expect(r1.debitNotes.map((n) => [n.taxAmount, n.igst])).toEqual([["90.00", 90]]);
  });

  it("inter-state: ITC is net of purchase returns and purchase-side debit notes", async () => {
    const w = await createGoldenWorld();
    const supplier = await addParty(w, "supplier", "KA");
    await addInvoice(w, "purchase", supplier.id, GOODS("10"), { date: OCT(5) });
    await addAdjustmentDoc(w, "purchaseReturn", "purchase", supplier.id, GOODS("2"), { date: OCT(12) });
    await addAdjustmentDoc(w, "debitNote", "purchase", supplier.id, GOODS("1", "500.00"), { date: OCT(18) });

    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.itc.igst)).toBe("1350.00");
    expect(fixed2(r.itc.cgst)).toBe("0.00");
    expect(fixed2(r.itc.sgst)).toBe("0.00");
    expect(fixed2(r.itc.total)).toBe("1350.00");
    expect(fixed2(r.netTax.total)).toBe("-1350.00"); // no sales: the credit carries forward
  });

  it("sales and purchases together: output 1350 less ITC 1350 leaves nothing to pay in cash", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "KA");
    const supplier = await addParty(w, "supplier", "KA");
    await addInvoice(w, "sale", customer.id, GOODS("10"), { date: OCT(5) });
    await addAdjustmentDoc(w, "creditNote", "sale", customer.id, GOODS("2"), { date: OCT(12) });
    await addAdjustmentDoc(w, "salesReturn", "sale", customer.id, GOODS("1"), { date: OCT(14) });
    await addAdjustmentDoc(w, "debitNote", "sale", customer.id, GOODS("1", "500.00"), { date: OCT(18) });
    await addInvoice(w, "purchase", supplier.id, GOODS("10"), { date: OCT(6) });
    await addAdjustmentDoc(w, "purchaseReturn", "purchase", supplier.id, GOODS("2"), { date: OCT(13) });
    await addAdjustmentDoc(w, "debitNote", "purchase", supplier.id, GOODS("1", "500.00"), { date: OCT(19) });

    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.taxPayable.igst)).toBe("1350.00");
    expect(fixed2(r.itc.igst)).toBe("1350.00");
    expect(fixed2(r.netTax.igst)).toBe("0.00");
    expect(fixed2(r.netTax.total)).toBe("0.00");
  });

  it("intra-state with an odd paisa: the note splits like its own ledger entry, and CGST/SGST stay in step", async () => {
    // Invoice: 5 x 113.99 = 569.95 ; GST 18% = 102.591 -> 102.59 ; split 51.29 CGST + 51.30 SGST.
    // Credit note: 1 x 0.05 @ 18% = GST 0.009 -> 0.01 ; split 0.00 CGST + 0.01 SGST.
    // Net output: CGST 51.29 - 0.00 = 51.29 ; SGST 51.30 - 0.01 = 51.29 (the ledger's 2100 / 2101 agree).
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    await addInvoice(w, "sale", customer.id, [{ name: "Item", qty: "5", price: "113.99", tax: "18" }], {
      date: OCT(5),
    });
    await addAdjustmentDoc(w, "creditNote", "sale", customer.id, [{ name: "Item", qty: "1", price: "0.05", tax: "18" }], {
      date: OCT(9),
    });

    const gross = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect(fixed2(gross.taxPayable.cgst)).toBe("0.00"); // a different month: nothing

    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.taxPayable.cgst)).toBe("51.29");
    expect(fixed2(r.taxPayable.sgst)).toBe("51.29");

    const tb = await w.caller.reports.trialBalance({
      fromDate: "2025-04-01T00:00:00.000Z",
      asOfDate: "2026-03-31T23:59:59.999Z",
    });
    const bal = (code: string) => tb.accounts.find((a) => a.accountCode === code)?.balance;
    // Credit balances are negative: -(51.30 - 0.01) = -51.29 on SGST, -(51.29 - 0.00) on CGST.
    expect(bal("2100")).toBe("-51.29");
    expect(bal("2101")).toBe("-51.29");
  });
});
