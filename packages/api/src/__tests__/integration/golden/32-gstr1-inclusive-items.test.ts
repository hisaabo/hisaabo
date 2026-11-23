/**
 * Scenario 32 — GSTR-1 portal JSON of tax-inclusive items (stored-value lines, round-off, Table 12).
 *
 * The GSTR-1 JSON builds each document's rate-wise rows from the STORED lines (taxable = line total - line tax) and refuses
 * a document whose lines do not add up to its taxable value and tax. Two kinds of invoice carry amounts that are not
 * qty x rate x GST% to the paisa, and both must come out of that builder exactly, without being refused:
 *
 *   32A  An online-store order of 3 x ₹99.00 incl. 18% (priceStoreOrderLines): rate 83.90 x 3 = 251.70, but the stored
 *        taxable is 29700 x 100 / 118 = 25169.49 -> 25169p = 251.69 and the stored tax 297.00 - 251.69 = 45.31.
 *        B2B itms: txval 251.69, rt 18, CGST 22.66 + SGST 22.65 (4531p, odd paisa to CGST); invoice val 297.00.
 *   32B  A bill of ₹10.00 incl. 18% made on a form (rate 8.47, GST 1.52 = 9.99) with the shelf-price round-off +0.01:
 *        itms: txval 8.47, rt 18, CGST 0.76 + SGST 0.76; invoice val 10.00 (it carries the round-off, the rows do not).
 *
 * Table 12 (HSN 4820, NOS, 18%): taxable 251.69 + 8.47 = 260.16; CGST 22.66 + 0.76 = 23.42; SGST 22.65 + 0.76 = 23.41;
 * value 297.00 + 9.99 = 306.99 (line totals; the round-off is the invoice's, not a line's), quantity 3 + 1 = 4.
 * Ties: B2B taxable 251.69 + 8.47 = 260.16 = Table 12; GSTR-3B 3.1(a) taxable 260.16, CGST 23.42, SGST 23.41.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { invoices, invoiceItems } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { priceStoreOrderLines } from "../../../lib/store-order-pricing.js";
import { useGoldenDb, createGoldenWorld, fixed2, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const DATE = "2025-06-10T10:00:00.000Z"; // 15:30 IST, 10 June 2025

describe("golden 32: GSTR-1 JSON of a store order and a shelf-price invoice", () => {
  let w: GoldenWorld;
  let storeNo: string;
  let billNo: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const item = await w.caller.item.create({ name: "Notebook", hsn: "4820", unit: "pcs", taxPercent: "18", salePrice: "99.00", taxInclusive: true, itemType: "product" } as never);
    const registered = async (name: string, gstin: string) =>
      (await w.caller.party.create({ type: "customer", name, openingBalance: "0", gstin, state: "Maharashtra", stateCode: "27" })).id;
    const storeParty = await registered("Store Buyer", "27AABCM0000R1ZM");
    const billParty = await registered("Counter Buyer", "27AABCN0000R1ZK");

    // 32A: what the store handler writes for an order of 3 x 99.00 incl. 18%
    const priced = priceStoreOrderLines([{ itemId: item.id, name: "Notebook", quantity: "3", unitPrice: "99.00", taxPercent: "18.00", taxInclusive: true, discountPercent: "0" }]);
    const db = getTenantTestDb();
    const [store] = await db.insert(invoices).values({
      businessId: w.businessId, partyId: storeParty, type: "sale", documentType: "invoice", invoiceNumber: "STORE-1", invoiceDate: new Date(DATE),
      status: "sent", subtotal: priced.totals.subtotal, taxAmount: priced.totals.taxTotal, discountAmount: priced.totals.invoiceDiscountAmount,
      additionalCharges: priced.totals.chargesTotal, roundOff: "0.00", totalAmount: priced.totals.total,
    } as never).returning();
    await db.insert(invoiceItems).values(priced.rows.map((r, i) => ({ ...r, itemId: item.id, invoiceId: store!.id, sortOrder: i })) as never);
    storeNo = "STORE-1";

    // 32B: ₹10.00 incl. 18% on a form: rate 8.47, round-off +0.01
    const bill = await w.caller.invoice.create({
      partyId: billParty, type: "sale", invoiceDate: DATE, roundOff: "0.01",
      lineItems: [{ itemId: item.id, itemName: "Notebook", quantity: "1", unitPrice: "8.47", taxPercent: "18", discountPercent: "0" }],
    } as never);
    const sent = await w.caller.invoice.updateStatus({ id: bill.id, status: "sent" });
    billNo = sent.invoiceNumber;
  });

  const json = async () => (await w.caller.gst.gstr1Json({ year: 2025, month: 6 })).json as Record<string, unknown>;

  it("the stored documents are what the arithmetic says (the fixtures really are the awkward cases)", async () => {
    const db = getTenantTestDb();
    const rows = await db.select().from(invoices);
    const by = (n: string) => rows.find((r) => r.invoiceNumber === n)!;
    expect([by(storeNo).subtotal, by(storeNo).taxAmount, by(storeNo).totalAmount]).toEqual(["251.69", "45.31", "297.00"]);
    expect([by(billNo).subtotal, by(billNo).taxAmount, by(billNo).roundOff, by(billNo).totalAmount]).toEqual(["8.47", "1.52", "0.01", "10.00"]);
  });

  it("B2B: one rate row each, from the stored lines; neither invoice is refused", async () => {
    const j = await json();
    expect(j.b2b).toEqual([
      {
        ctin: "27AABCM0000R1ZM",
        inv: [{
          inum: storeNo, idt: "10-06-2025", val: 297, pos: "27", rchrg: "N", inv_typ: "R",
          itms: [{ num: 1, itm_det: { txval: 251.69, rt: 18, camt: 22.66, samt: 22.65, csamt: 0 } }], // 4531p: 2266 + 2265
        }],
      },
      {
        ctin: "27AABCN0000R1ZK",
        inv: [{
          inum: billNo, idt: "10-06-2025", val: 10, pos: "27", rchrg: "N", inv_typ: "R",
          itms: [{ num: 1, itm_det: { txval: 8.47, rt: 18, camt: 0.76, samt: 0.76, csamt: 0 } }], // 152p: 76 + 76
        }],
      },
    ]);
  });

  it("Table 12: taxable 260.16, CGST 23.42, SGST 23.41, value 306.99, quantity 4, and it ties to the B2B rows", async () => {
    const hsn = (await json()).hsn as { data: Array<Record<string, unknown>> };
    expect(hsn.data).toHaveLength(1);
    expect(hsn.data[0]).toMatchObject({ hsn_sc: "4820", rt: 18, qty: 4, txval: 260.16, camt: 23.42, samt: 23.41, iamt: 0, val: 306.99 });
    // B2B taxable 251.69 + 8.47 = 260.16; CGST 22.66 + 0.76 = 23.42; SGST 22.65 + 0.76 = 23.41
  });

  it("GSTR-3B 3.1(a) agrees: taxable 260.16, CGST 23.42, SGST 23.41", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("260.16");
    expect(fixed2(r.taxPayable.cgst)).toBe("23.42");
    expect(fixed2(r.taxPayable.sgst)).toBe("23.41");
  });
});
