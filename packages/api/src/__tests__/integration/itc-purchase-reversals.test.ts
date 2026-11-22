/**
 * The ITC ledger is net of purchase-side reversals, so the available balance that
 * itc.recordUtilization validates against equals the credit GSTR-3B Table 4 reports.
 * Hand-computed, September 2025, intra-state supplier, 18% GST:
 *
 *   Purchase                        10 x 1000.00  GST 1800 -> available CGST 900 + SGST 900
 *   Credit note raised from it       2 x 1000.00  GST  360 (type purchase) -> -180 / -180 = 720 / 720
 *   Purchase return                  1 x 1000.00  GST  180 -> -90 / -90   = 630 / 630
 *   Purchase-side debit note         1 x  500.00  GST   90 -> -45 / -45   = 585 / 585
 *   (a SALE-side credit note of the same size does not touch ITC)
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addAdjustmentDoc,
  fixed2,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const PERIOD = "2025-09";
const goods = (qty: string, price = "1000.00") => [{ name: "Raw cotton", qty, price, tax: "18" }];

async function available(w: GoldenWorld) {
  const dash = await w.caller.itc.dashboard({ returnPeriod: PERIOD });
  return dash.summary.available;
}

describe("ITC ledger entries for purchase-side reversals", () => {
  let w: GoldenWorld;
  let supplierId: string;
  let creditNoteId: string;
  let returnId: string;
  let debitNoteId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    supplierId = (await addParty(w, "supplier", "MH")).id;
    const purchase = await addInvoice(w, "purchase", supplierId, goods("10"), { date: "2025-09-05T10:00:00.000Z" });
    creditNoteId = (
      await addAdjustmentDoc(w, "creditNote", "purchase", supplierId, goods("2"), {
        date: "2025-09-12T10:00:00.000Z",
        referenceDocumentId: purchase.id,
      })
    ).id;
    returnId = (
      await addAdjustmentDoc(w, "purchaseReturn", "purchase", supplierId, goods("1"), {
        date: "2025-09-14T10:00:00.000Z",
        referenceDocumentId: purchase.id,
      })
    ).id;
    debitNoteId = (
      await addAdjustmentDoc(w, "debitNote", "purchase", supplierId, goods("1", "500.00"), {
        date: "2025-09-18T10:00:00.000Z",
        referenceDocumentId: purchase.id,
      })
    ).id;
    // A sale-side credit note of the same size: nothing to do with input credit.
    const customer = await addParty(w, "customer", "MH");
    await addAdjustmentDoc(w, "creditNote", "sale", customer.id, goods("2"), { date: "2025-09-20T10:00:00.000Z" });
  });

  it("available ITC is net of all three: 585 CGST + 585 SGST", async () => {
    expect(await available(w)).toMatchObject({ cgst: "585.00", sgst: "585.00", igst: "0.00" });
  });

  it("it equals what GSTR-3B Table 4 reports for the month", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect([fixed2(r.itc.cgst), fixed2(r.itc.sgst)]).toEqual(["585.00", "585.00"]);
  });

  it("a utilisation above the netted credit is rejected, one at it is accepted", async () => {
    await expect(
      w.caller.itc.recordUtilization({ returnPeriod: PERIOD, cgstUtilized: "600.00" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ok = await w.caller.itc.recordUtilization({ returnPeriod: PERIOD, cgstUtilized: "585.00" });
    expect(ok.utilization).toMatchObject({ cgstUtilized: "585.00" });
  });

  it("the reversal entries do not show up as credit at risk in the ageing alerts: only the purchase invoice does", async () => {
    // The September invoice is unpaid and long past 150 days, so it is a real alert; its three
    // reversals (negative entries) are not.
    const alerts = await w.caller.itc.agingAlerts();
    expect(alerts).toHaveLength(1);
    expect([alerts[0]!.cgst, alerts[0]!.sgst]).toEqual(["900.00", "900.00"]);
  });

  it("cancelling the debit note gives its 45 / 45 back: 630 / 630", async () => {
    await w.caller.debitNote.updateStatus({ id: debitNoteId, status: "cancelled" });
    expect(await available(w)).toMatchObject({ cgst: "630.00", sgst: "630.00" });
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect([fixed2(r.itc.cgst), fixed2(r.itc.sgst)]).toEqual(["630.00", "630.00"]);
  });

  it("deleting the purchase return gives its 90 / 90 back: 720 / 720", async () => {
    await w.caller.purchaseReturn.delete({ id: returnId });
    expect(await available(w)).toMatchObject({ cgst: "720.00", sgst: "720.00" });
  });

  it("the credit note is the only reversal left, and still netted: 900 - 180", async () => {
    expect(creditNoteId).toBeTruthy();
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect([fixed2(r.itc.cgst), fixed2(r.itc.sgst)]).toEqual(["720.00", "720.00"]);
  });

  it("an inter-state supplier's return reduces IGST", async () => {
    const w2 = await createGoldenWorld();
    const sup = (await addParty(w2, "supplier", "KA")).id;
    await addInvoice(w2, "purchase", sup, goods("10"), { date: "2025-09-05T10:00:00.000Z" });
    await addAdjustmentDoc(w2, "purchaseReturn", "purchase", sup, goods("2"), { date: "2025-09-12T10:00:00.000Z" });
    expect(await available(w2)).toMatchObject({ cgst: "0.00", sgst: "0.00", igst: "1440.00" }); // 1800 - 360
  });
});
