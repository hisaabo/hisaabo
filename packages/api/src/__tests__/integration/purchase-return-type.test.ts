/**
 * A purchase return is purchase-side WHATEVER type it is sent with. The CLI used to send
 * type = "sale" for every document, and the factory router does not constrain type per
 * document type, so such a row must not become a sale-side reversal.
 *
 * Hand-computed, intra-state supplier, 18% GST, September 2025:
 *   Purchase          10 x 1000.00 -> 10000 + 1800 GST = 11800.00
 *   Purchase return    2 x 1000.00 ->  2000 +  360 GST =  2360.00   (sent with type "sale")
 *   Payable = 11800 - 2360 = 9440 ; input GST CGST 900 - 180 = 720 and SGST 720 ;
 *   GSTR-1 lists nothing ; no output tax.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@hisaabo/db";
import { getTenantTestDb } from "../helpers/test-db.js";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  book,
  tbRows,
  expectBooksBalance,
  fixed2,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const goods = (qty: string) => [{ name: "Raw cotton", qty, price: "1000.00", tax: "18" }];
const lineItems = [
  { itemName: "Raw cotton", quantity: "2", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" },
];

async function expectPurchaseSide(w: GoldenWorld, supplierId: string) {
  const b = await book(w);
  expect(tbRows(b)).toEqual([
    ["1510", "900.00", "180.00"], // input CGST: Dr 900, Cr 180 (the return)
    ["1511", "900.00", "180.00"],
    ["2000", "2360.00", "11800.00"], // payable: Dr 2360 (the return), Cr 11800
    ["5000", "10000.00", "0.00"],
    ["5010", "0.00", "2000.00"],
  ]);
  expectBooksBalance(b);

  const r1 = await w.caller.gst.gstr1({ year: 2025, month: 9 });
  expect(r1.creditNotes).toEqual([]);
  expect(r1.debitNotes).toEqual([]);

  const r3 = await w.caller.gst.gstr3b({ year: 2025, month: 9 });
  expect([fixed2(r3.itc.cgst), fixed2(r3.itc.sgst)]).toEqual(["720.00", "720.00"]);
  expect([fixed2(r3.taxPayable.cgst), fixed2(r3.taxPayable.sgst)]).toEqual(["0.00", "0.00"]);

  // the ITC ledger is net: 900 - 180
  const dash = await w.caller.itc.dashboard({ returnPeriod: "2025-09" });
  expect(dash.summary.available).toMatchObject({ cgst: "720.00", sgst: "720.00" });

  // we owe the supplier 11800 - 2360 = 9440 (signed: negative)
  expect((await w.caller.party.getById({ id: supplierId }))?.balance).toBe("-9440.00");
  expect((await w.caller.party.ledgerReport({ partyId: supplierId }))?.summary.closingBalance).toBe("-9440.00");
  expect((await w.caller.dashboard.summary()).payable).toBe("9440.00");
}

describe("purchase_return is always purchase-side", () => {
  let w: GoldenWorld;
  let supplierId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    supplierId = (await addParty(w, "supplier", "MH")).id;
    await addInvoice(w, "purchase", supplierId, goods("10"), { date: "2025-09-05T10:00:00.000Z" });
  });

  it("sent with type 'sale' it is stored as purchase and posts to the payable, input GST and ITC", async () => {
    const pr = await w.caller.purchaseReturn.create({
      partyId: supplierId,
      type: "sale",
      invoiceDate: "2025-09-12T10:00:00.000Z",
      lineItems,
    });
    expect(pr.type).toBe("purchase");
    await expectPurchaseSide(w, supplierId);
  });

  it("a legacy row already stored with type 'sale' is read as purchase-side everywhere", async () => {
    const w2 = await createGoldenWorld();
    const sup = (await addParty(w2, "supplier", "MH")).id;
    await addInvoice(w2, "purchase", sup, goods("10"), { date: "2025-09-05T10:00:00.000Z" });
    const pr = await w2.caller.purchaseReturn.create({
      partyId: sup,
      type: "purchase",
      invoiceDate: "2025-09-12T10:00:00.000Z",
      lineItems,
    });
    // what an older CLI wrote
    await getTenantTestDb().update(invoices).set({ type: "sale" }).where(eq(invoices.id, pr.id));

    const b = await book(w2);
    expect(tbRows(b)).toEqual([
      ["1510", "900.00", "180.00"],
      ["1511", "900.00", "180.00"],
      ["2000", "2360.00", "11800.00"],
      ["5000", "10000.00", "0.00"],
      ["5010", "0.00", "2000.00"],
    ]);
    const r1 = await w2.caller.gst.gstr1({ year: 2025, month: 9 });
    expect(r1.creditNotes).toEqual([]);
    const r3 = await w2.caller.gst.gstr3b({ year: 2025, month: 9 });
    expect([fixed2(r3.itc.cgst), fixed2(r3.itc.sgst)]).toEqual(["720.00", "720.00"]);
    expect((await w2.caller.party.getById({ id: sup }))?.balance).toBe("-9440.00");
    const tab = await w2.caller.party.ledger({ partyId: sup });
    expect(tab.data.at(-1)?.runningBalance).toBe("-9440.00");
    expect((await w2.caller.dashboard.summary()).payable).toBe("9440.00");
  });

  it("a credit note or sales return still takes the type it is sent with (H1: either side is legitimate)", async () => {
    const w3 = await createGoldenWorld();
    const cust = (await addParty(w3, "customer", "MH")).id;
    const cn = await w3.caller.creditNote.create({
      partyId: cust,
      type: "sale",
      invoiceDate: "2025-09-12T10:00:00.000Z",
      lineItems,
    });
    expect(cn.type).toBe("sale");
    const sup = (await addParty(w3, "supplier", "MH")).id;
    const cnPurchase = await w3.caller.creditNote.create({
      partyId: sup,
      type: "purchase",
      invoiceDate: "2025-09-12T10:00:00.000Z",
      lineItems,
    });
    expect(cnPurchase.type).toBe("purchase");
  });

  it("a seller cannot sneak a purchase return in by sending type 'sale'", async () => {
    // canCreateDocumentType denies purchase-side document TYPES to sellers outright
    const { canCreateDocumentType } = await import("@hisaabo/shared");
    expect(canCreateDocumentType("seller", "purchase_return", "sale")).toBe(false);
  });
});
