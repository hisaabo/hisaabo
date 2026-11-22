/**
 * Two details of the ITC entry a purchase-side reversal writes. Hand-computed, September 2025,
 * 18% GST, purchase 10 x 1000 (tax 1800) and a reversal of 2 x 1000 (tax 360):
 *
 *  - a return of a REVERSE-CHARGE purchase is itself reverse-charge: it takes credit back from the
 *    RCM bucket (Table 4A(3) / 3.1(d)), not from "all other ITC"
 *  - the same-state test is the one GSTR-3B uses (state codes, then state NAMES), and the same
 *    one the invoice's own ITC entry uses, so a supplier known only by state name gets
 *    CGST + SGST on the purchase AND on its return
 */
import { describe, it, expect } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addAdjustmentDoc,
  fixed2,
} from "./golden/golden-helpers.js";

useGoldenDb();

const goods = (qty: string) => [{ name: "Services", qty, price: "1000.00", tax: "18" }];
const invoiceLines = (qty: string) => [
  { itemName: "Services", quantity: qty, unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" },
];

describe("a return of a reverse-charge purchase", () => {
  it("reduces the RCM bucket, not ordinary ITC", async () => {
    const w = await createGoldenWorld();
    const sup = (await addParty(w, "supplier", "MH")).id;
    const purchase = await w.caller.invoice.create({
      partyId: sup,
      type: "purchase",
      invoiceDate: "2025-09-05T10:00:00.000Z",
      isReverseCharge: true,
      lineItems: invoiceLines("10"),
    });
    const pr = await addAdjustmentDoc(w, "purchaseReturn", "purchase", sup, goods("2"), {
      date: "2025-09-12T10:00:00.000Z",
      referenceDocumentId: purchase.id,
    });
    expect(pr.isReverseCharge).toBe(true);

    const t4 = await w.caller.itc.gstr3bTable4({ year: 2025, month: 9 });
    expect([t4.itcAvailable.reverseCharge.centralTax, t4.itcAvailable.reverseCharge.stateTax]).toEqual(["720.00", "720.00"]);
    expect([t4.itcAvailable.allOther.centralTax, t4.itcAvailable.allOther.stateTax]).toEqual(["0", "0"]);

    const r3 = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect([r3.rcmSupplies.cgst, r3.rcmSupplies.sgst]).toEqual(["720.00", "720.00"]); // 900 - 180
    expect([fixed2(r3.itc.cgst), fixed2(r3.itc.sgst)]).toEqual(["720.00", "720.00"]);
  });

  it("a return of an ordinary purchase stays ordinary", async () => {
    const w = await createGoldenWorld();
    const sup = (await addParty(w, "supplier", "MH")).id;
    const purchase = await w.caller.invoice.create({
      partyId: sup,
      type: "purchase",
      invoiceDate: "2025-09-05T10:00:00.000Z",
      lineItems: invoiceLines("10"),
    });
    const pr = await addAdjustmentDoc(w, "purchaseReturn", "purchase", sup, goods("2"), {
      date: "2025-09-12T10:00:00.000Z",
      referenceDocumentId: purchase.id,
    });
    expect(pr.isReverseCharge).toBe(false);
    const t4 = await w.caller.itc.gstr3bTable4({ year: 2025, month: 9 });
    expect([t4.itcAvailable.allOther.centralTax, t4.itcAvailable.reverseCharge.centralTax]).toEqual(["720.00", "0"]);
  });
});

describe("a supplier known only by state name", () => {
  it("gets CGST + SGST on the purchase and on its return, like GSTR-3B", async () => {
    const w = await createGoldenWorld();
    // Maharashtra by NAME, no state code: GSTR-3B compares names when a code is missing.
    const sup = (
      await w.caller.party.create({ type: "supplier", name: "Name-only supplier", state: "Maharashtra", openingBalance: "0" })
    ).id;
    await w.caller.invoice.create({
      partyId: sup,
      type: "purchase",
      invoiceDate: "2025-09-05T10:00:00.000Z",
      lineItems: invoiceLines("10"),
    });
    await addAdjustmentDoc(w, "purchaseReturn", "purchase", sup, goods("2"), { date: "2025-09-12T10:00:00.000Z" });

    const dash = await w.caller.itc.dashboard({ returnPeriod: "2025-09" });
    expect(dash.summary.available).toMatchObject({ cgst: "720.00", sgst: "720.00", igst: "0.00" });
    const r3 = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect([fixed2(r3.itc.cgst), fixed2(r3.itc.sgst), fixed2(r3.itc.igst)]).toEqual(["720.00", "720.00", "0.00"]);
  });
});
