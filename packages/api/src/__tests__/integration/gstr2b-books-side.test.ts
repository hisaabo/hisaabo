/**
 * GSTR-2B reconciliation reads the books the way the returns do: only purchase INVOICES are
 * candidates (not purchase returns, credit / debit notes, quotations or challans), and the
 * CGST / SGST / IGST of a purchase are the real heads: IGST stays IGST for an inter-state
 * supplier, intra-state is split per line with CGST getting the odd paisa. Before, every
 * type = 'purchase' row counted and every tax was halved into CGST + SGST.
 *
 * Inter-state supplier (Karnataka), purchase 10 x 1000 @ 18% = taxable 10000, IGST 1800, total 11800.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addInvoice,
  addAdjustmentDoc,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const goods = (qty: string, price = "1000.00") => [{ name: "Raw cotton", qty, price, tax: "18" }];

function gstr2b(opts: { ctin: string; inum: string; value: number; taxable: number; cgst: number; sgst: number; igst: number }) {
  return JSON.stringify({
    gstin: "27AABCU9603R1ZM",
    ret_period: "092025",
    docdata: {
      b2b: [
        {
          ctin: opts.ctin,
          trdnm: "Supplier",
          inv: [
            {
              inum: opts.inum,
              dt: "05-09-2025",
              val: opts.value,
              pos: "27",
              itcavl: "Y",
              rev: "N",
              typ: "R",
              items: [{ num: 1, rt: 18, txval: opts.taxable, cgst: opts.cgst, sgst: opts.sgst, igst: opts.igst, cess: 0 }],
            },
          ],
        },
      ],
    },
  });
}

async function supplierWithGstin(w: GoldenWorld, state: "Karnataka" | "Maharashtra", gstin: string) {
  return (
    await w.caller.party.create({
      type: "supplier",
      name: `${state} supplier`,
      state,
      stateCode: state === "Karnataka" ? "29" : "27",
      gstin,
      openingBalance: "0",
    })
  ).id;
}

describe("GSTR-2B reconciliation against the books", () => {
  let w: GoldenWorld;
  let invoiceNumber: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const sup = await supplierWithGstin(w, "Karnataka", "29AABCM0000R1ZM");
    const purchase = await addInvoice(w, "purchase", sup, goods("10"), { date: "2025-09-05T10:00:00.000Z" });
    invoiceNumber = purchase.invoiceNumber;
    // Things that are NOT purchases and must never be reconciliation candidates:
    await addAdjustmentDoc(w, "purchaseReturn", "purchase", sup, goods("2"), { date: "2025-09-12T10:00:00.000Z" });
    await addAdjustmentDoc(w, "creditNote", "purchase", sup, goods("1"), { date: "2025-09-13T10:00:00.000Z" });
    await addAdjustmentDoc(w, "debitNote", "purchase", sup, goods("1", "500.00"), { date: "2025-09-14T10:00:00.000Z" });
    await w.caller.quotation.create({
      partyId: sup,
      type: "purchase",
      invoiceDate: "2025-09-15T10:00:00.000Z",
      lineItems: [{ itemName: "Quoted", quantity: "1", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" }],
    });
  });

  it("an inter-state purchase matches its 2B entry with IGST 1800 (not 900 + 900), and only invoices are candidates", async () => {
    const r = await w.caller.gstr2b.upload({
      returnPeriod: "2025-09",
      fileName: "gstr2b_092025.json",
      format: "json",
      content: gstr2b({ ctin: "29AABCM0000R1ZM", inum: invoiceNumber, value: 11800, taxable: 10000, cgst: 0, sgst: 0, igst: 1800 }),
    });
    expect(r.totalRecords).toBe(1);
    expect(r.matchedRecords).toBe(1);
    expect(r.mismatchedRecords).toBe(0);
    // the purchase return, credit note, debit note and quotation are not purchases: nothing "missing in 2B"
    expect(r.missingIn2B).toBe(0);
  });

  it("the missing-in-2B list holds invoices only", async () => {
    const list = await w.caller.gstr2b.missingIn2B({ returnPeriod: "2025-09", page: 1, limit: 50 });
    // the one invoice is in the file, the four other documents are not purchases
    expect(list.records).toEqual([]);
  });

  it("a purchase return cannot be linked to a 2B record as if it were a purchase", async () => {
    const w2 = await createGoldenWorld();
    const sup = await supplierWithGstin(w2, "Maharashtra", "27AABCM0000R1ZM");
    const pr = await addAdjustmentDoc(w2, "purchaseReturn", "purchase", sup, goods("2"), { date: "2025-09-12T10:00:00.000Z" });
    const up = await w2.caller.gstr2b.upload({
      returnPeriod: "2025-09",
      fileName: "gstr2b_092025.json",
      format: "json",
      content: gstr2b({ ctin: "27AABCM0000R1ZM", inum: "NOT-IN-BOOKS", value: 1180, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }),
    });
    const records = await w2.caller.gstr2b.records({ uploadId: up.uploadId, page: 1, limit: 10 });
    await expect(
      w2.caller.gstr2b.linkInvoice({ recordId: records.records[0]!.id, invoiceId: pr.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an intra-state purchase matches with CGST / SGST split per line (51.30 / 51.29 on 102.59 of GST)", async () => {
    const w3 = await createGoldenWorld();
    const sup = await supplierWithGstin(w3, "Maharashtra", "27AABCM0000R1ZM");
    // 5 x 113.99 = 569.95; GST 18% = 102.59 -> CGST 51.30, SGST 51.29 (the e-invoice rule)
    const purchase = await addInvoice(w3, "purchase", sup, goods("5", "113.99"), { date: "2025-09-05T10:00:00.000Z" });
    const r = await w3.caller.gstr2b.upload({
      returnPeriod: "2025-09",
      fileName: "gstr2b_092025.json",
      format: "json",
      content: gstr2b({ ctin: "27AABCM0000R1ZM", inum: purchase.invoiceNumber, value: 672.54, taxable: 569.95, cgst: 51.3, sgst: 51.29, igst: 0 }),
    });
    expect(r.matchedRecords).toBe(1);
    expect(r.mismatchedRecords).toBe(0);
  });
});
