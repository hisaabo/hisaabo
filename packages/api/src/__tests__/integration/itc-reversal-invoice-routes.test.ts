/**
 * The invoice.* routes (delete / updateStatus / update) accept ANY document id, so a purchase-side
 * reversal can be cancelled, deleted or edited through them as well as through its own router. Its
 * negative ITC entry must follow, or it is orphaned. Hand-computed, September 2025, intra-state
 * supplier, 18% GST: purchase 10 x 1000 -> available CGST 900 + SGST 900; a reversal of
 * q x 1000 takes back 90 q CGST and 90 q SGST.
 */
import { describe, it, expect } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addAdjustmentDoc,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const goods = (qty: string) => [{ name: "Raw cotton", qty, price: "1000.00", tax: "18" }];
const cnLines = (qty: string) => [
  { itemName: "Raw cotton", quantity: qty, unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" },
];

async function available(w: GoldenWorld, period = "2025-09") {
  return (await w.caller.itc.dashboard({ returnPeriod: period })).summary.available;
}

async function worldWithPurchase() {
  const w = await createGoldenWorld();
  const sup = (await addParty(w, "supplier", "MH")).id;
  await addInvoice(w, "purchase", sup, goods("10"), { date: "2025-09-05T10:00:00.000Z" }); // 900 / 900
  return { w, sup };
}

describe("invoice.* routes keep a purchase-side reversal's ITC entry in step", () => {
  it("updateStatus(cancelled) on a purchase-typed credit note gives its credit back", async () => {
    const { w, sup } = await worldWithPurchase();
    const cn = await addAdjustmentDoc(w, "creditNote", "purchase", sup, goods("2"), { date: "2025-09-12T10:00:00.000Z" });
    expect(await available(w)).toMatchObject({ cgst: "720.00", sgst: "720.00" });
    await w.caller.invoice.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await available(w)).toMatchObject({ cgst: "900.00", sgst: "900.00" });
  });

  it("delete of a purchase return gives its credit back", async () => {
    const { w, sup } = await worldWithPurchase();
    const pr = await addAdjustmentDoc(w, "purchaseReturn", "purchase", sup, goods("1"), { date: "2025-09-12T10:00:00.000Z" });
    expect(await available(w)).toMatchObject({ cgst: "810.00", sgst: "810.00" });
    await w.caller.invoice.delete({ id: pr.id });
    expect(await available(w)).toMatchObject({ cgst: "900.00", sgst: "900.00" });
  });

  it("update re-records the entry: 2 x 1000 -> 1 x 1000 moves it from -180 / -180 to -90 / -90, and a new date moves the period", async () => {
    const { w, sup } = await worldWithPurchase();
    const cn = await addAdjustmentDoc(w, "creditNote", "purchase", sup, goods("2"), { date: "2025-09-12T10:00:00.000Z" });
    expect(await available(w)).toMatchObject({ cgst: "720.00", sgst: "720.00" });
    await w.caller.invoice.update({ id: cn.id, lineItems: cnLines("1") });
    expect(await available(w)).toMatchObject({ cgst: "810.00", sgst: "810.00" });
    await w.caller.invoice.update({ id: cn.id, invoiceDate: "2025-10-03T10:00:00.000Z" });
    expect(await available(w)).toMatchObject({ cgst: "900.00", sgst: "900.00" });
    expect(await available(w, "2025-10")).toMatchObject({ cgst: "-90.00", sgst: "-90.00" });
  });

  it("a sale-side credit note is untouched by all of this (no ITC entry to orphan)", async () => {
    const { w } = await worldWithPurchase();
    const cust = (await addParty(w, "customer", "MH")).id;
    const cn = await addAdjustmentDoc(w, "creditNote", "sale", cust, goods("2"), { date: "2025-09-12T10:00:00.000Z" });
    expect(await available(w)).toMatchObject({ cgst: "900.00", sgst: "900.00" });
    await w.caller.invoice.update({ id: cn.id, lineItems: cnLines("1") });
    await w.caller.invoice.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await available(w)).toMatchObject({ cgst: "900.00", sgst: "900.00" });
  });
});
