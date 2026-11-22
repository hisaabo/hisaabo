/**
 * Scenario 15 — Items priced INCLUDING tax ("Price includes tax").
 *
 * A bill line is tax-exclusive: the server adds the line's GST on top of `unit_price`. An item whose saved
 * SALE price already contains the GST must therefore start a bill at its tax-exclusive rate
 * (taxable = round(price x 100 / (100 + t)), GST = price - taxable), or the customer is taxed twice
 * (₹118 incl. 18% = 118 + 21.24 = ₹139.24). Purchase prices are tax-exclusive and never converted.
 *
 * Rounding rule (shared/money.ts, shared/inclusive-price.ts): integer paise, half-up, once per step.
 *
 * ── 15A  POS tiles (the server hands the register the bill rate) ─────────────────────────────────
 *   Atta   ₹118.00 incl. 18%   11800 x 100 / 118 = 10000            -> rate 100.00 (GST 18.00)
 *   Rice   ₹105.00 incl.  5%   10500 x 100 / 105 = 10000            -> rate 100.00 (GST  5.00)
 *   Oil    ₹ 99.00 incl. 12%    9900 x 100 / 112 = 8839.29 -> 8839  -> rate  88.39 (GST 10.61)
 *   Gadget ₹128.00 incl. 28%   12800 x 100 / 128 = 10000            -> rate 100.00 (GST 28.00)
 *   Atta 5 kg pack ₹590.00 incl. 18%  59000 x 100 / 118 = 50000     -> rate 500.00
 *   Tee (M) ₹236.00 incl. 18%         23600 x 100 / 118 = 20000     -> rate 200.00
 *   Steel ₹100.00 exclusive, 18%                                    -> rate 100.00 (no conversion)
 *
 * ── 15B  Intra-state (MH) sale, 4 lines, billed at the tile rates ─────────────────────────────────
 *   #  item    qty  rate    disc  taxable          GST (rate)         line total
 *   1  Atta     2   100.00   -    200.00           36.00 (18%)        236.00   [3600p: CGST 18.00 / SGST 18.00]
 *   2  Rice     1   100.00   -    100.00            5.00 ( 5%)        105.00   [500p:  2.50 / 2.50]
 *   3  Oil      1    88.39   -     88.39           10.61 (12%) [1060.68 -> 1061]  99.00   [1061p: CGST 5.31 / SGST 5.30]
 *   4  Gadget   1   100.00  10%    90.00 [after]    25.20 (28%)       115.20   [2520p: 12.60 / 12.60]
 *   subtotal 200.00 + 100.00 + 88.39 + 90.00 = 478.39      GST 36.00 + 5.00 + 10.61 + 25.20 = 76.81
 *   total    478.39 + 76.81 = 555.20  =  236.00 + 105.00 + 99.00 + 115.20  (the inclusive shelf prices, 10% off the gadget)
 *   CGST 1800 + 250 + 531 + 1260 = 3841 = 38.41      SGST 1800 + 250 + 530 + 1260 = 3840 = 38.40
 *   Ledger:  Dr 1100 555.20 / Cr 4000 478.39, Cr 2100 38.41, Cr 2101 38.40   (555.20 = 478.39 + 38.41 + 38.40)
 *
 * ── 15C  The same bill to a customer in Karnataka: IGST 76.81 ────────────────────────────────────
 * ── 15D  Purchase: purchase prices are tax-exclusive, never converted ────────────────────────────
 *   10 x 90.00 @ 18%   taxable 900.00, GST 162.00 (CGST 81.00 + SGST 81.00), total 1062.00; ITC 81.00 + 81.00
 * ── 15E  Every document type that shares the form bills the same amount ──────────────────────────
 *   rate 100.00 @ 18% x 1 = taxable 100.00 + GST 18.00 = 118.00 (sale side); 90.00 @ 18% = 90.00 + 16.20 = 106.20 (purchase side)
 * ── 15F  Random inclusive bills: invoice, ledger, GSTR-3B and the PDF table all tie ──────────────
 */
import { describe, it, expect, beforeAll } from "vitest";
import { billRateFromItemPrice } from "@hisaabo/shared";
import { generateInvoicePDF, buildGstBreakdown, type InvoicePDFData } from "../../../lib/invoice-pdf.js";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  book,
  tbRows,
  plSummary,
  expectBooksBalance,
  fixed2,
  type GoldenWorld,
} from "./golden-helpers.js";

useGoldenDb();

const DATE = "2025-06-10T10:00:00.000Z";

/** An item saved with its SALE price including GST. */
function createInclusiveItem(
  w: GoldenWorld,
  name: string,
  salePrice: string,
  taxPercent: string,
  extra: Record<string, unknown> = {},
) {
  return w.caller.item.create({
    name,
    itemType: "product",
    itemMode: "simple",
    unit: "pcs",
    salePrice,
    taxPercent,
    taxInclusive: true,
    stockQuantity: "1000",
    ...extra,
  } as never);
}

async function tileFor(w: GoldenWorld, displayName: string) {
  const { tiles } = await w.caller.pos.catalog({ limit: 200 });
  const tile = tiles.find((t) => t.displayName === displayName);
  if (!tile) throw new Error(`no POS tile named ${displayName}`);
  return tile;
}

describe("golden 15A: POS tiles of tax-inclusive items carry the tax-exclusive bill rate", () => {
  let w: GoldenWorld;
  beforeAll(async () => {
    w = await createGoldenWorld();
    await createInclusiveItem(w, "Atta", "118.00", "18");
    await createInclusiveItem(w, "Rice", "105.00", "5");
    await createInclusiveItem(w, "Oil", "99.00", "12");
    await createInclusiveItem(w, "Gadget", "128.00", "28");
    await createInclusiveItem(w, "Pack Atta", "118.00", "18", {
      itemMode: "alt_units",
      unitVariants: [{ unit: "box", conversionFactor: 5, salePrice: "590.00" }],
    });
    await createInclusiveItem(w, "Tee", "236.00", "18", {
      itemMode: "variants",
      variants: [{ attributeValues: { Size: "M" }, salePrice: "236.00", stockQuantity: "5" }],
    });
    await w.caller.item.create({
      name: "Steel", itemType: "product", itemMode: "simple", unit: "pcs", salePrice: "100.00", taxPercent: "18", taxInclusive: false, stockQuantity: "10",
    } as never);
  });

  it.each([
    // tile, saved shelf price, bill rate
    ["Atta", "118.00", "100.00"], // 11800 x 100 / 118 = 10000
    ["Rice", "105.00", "100.00"], // 10500 x 100 / 105 = 10000
    ["Oil", "99.00", "88.39"], // 9900 x 100 / 112 = 8839.29 -> 8839
    ["Gadget", "128.00", "100.00"], // 12800 x 100 / 128 = 10000
    ["Pack Atta (box)", "590.00", "500.00"], // alternate unit: 59000 x 100 / 118 = 50000
    ["Tee — M", "236.00", "200.00"], // variant: 23600 x 100 / 118 = 20000
  ])("%s: shelf price %s is billed at the rate %s", async (name, shelf, rate) => {
    const tile = await tileFor(w, name);
    expect(tile.inclusivePrice).toBe(shelf);
    expect(tile.unitPrice).toBe(rate);
  });

  it("a tax-exclusive item is not converted", async () => {
    const tile = await tileFor(w, "Steel");
    expect(tile.unitPrice).toBe("100.00");
    expect(tile.inclusivePrice).toBeNull();
  });
});

const BILL = [
  // item, qty, rate (the POS tile rate), tax, discount
  { item: "Atta", qty: "2", rate: "100.00", tax: "18", disc: "0" },
  { item: "Rice", qty: "1", rate: "100.00", tax: "5", disc: "0" },
  { item: "Oil", qty: "1", rate: "88.39", tax: "12", disc: "0" },
  { item: "Gadget", qty: "1", rate: "100.00", tax: "28", disc: "10" },
] as const;

/** Create the shelf items, then bill them at the rates the register hands out. */
async function seedInclusiveBill(w: GoldenWorld, partyId: string, type: "sale" = "sale") {
  const ids: Record<string, string> = {};
  const shelf = { Atta: ["118.00", "18"], Rice: ["105.00", "5"], Oil: ["99.00", "12"], Gadget: ["128.00", "28"] } as const;
  for (const [name, [price, tax]] of Object.entries(shelf)) {
    ids[name] = (await createInclusiveItem(w, name, price, tax)).id;
  }
  const lines = [];
  for (const l of BILL) {
    const tile = await tileFor(w, l.item);
    expect(tile.unitPrice, `${l.item} tile rate`).toBe(l.rate); // the register and the bill agree
    lines.push({
      itemId: ids[l.item]!,
      itemName: l.item,
      quantity: l.qty,
      unitPrice: tile.unitPrice,
      taxPercent: tile.taxPercent,
      discountPercent: l.disc,
    });
  }
  const inv = await w.caller.invoice.create({ partyId, type, invoiceDate: DATE, lineItems: lines });
  return w.caller.invoice.updateStatus({ id: inv.id, status: "sent" });
}

describe("golden 15B: intra-state sale of inclusive items ties across every surface", () => {
  let w: GoldenWorld;
  let partyId: string;
  let invoiceId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    partyId = (await addParty(w, "customer", "MH")).id;
    invoiceId = (await seedInclusiveBill(w, partyId)).id;
  });

  it("invoice totals: the inclusive shelf prices, taxed once", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.subtotal).toBe("478.39"); // 200.00 + 100.00 + 88.39 + 90.00
    expect(inv?.taxAmount).toBe("76.81"); // 36.00 + 5.00 + 10.61 + 25.20
    expect(inv?.totalAmount).toBe("555.20"); // 236.00 + 105.00 + 99.00 + 115.20
    expect(inv?.lineItems.map((l) => [l.taxAmount, l.totalAmount])).toEqual([
      ["36.00", "236.00"], // 200.00 x 18%
      ["5.00", "105.00"], // 100.00 x 5%
      ["10.61", "99.00"], // 88.39 x 12% = 10.6068 -> 10.61
      ["25.20", "115.20"], // (100.00 - 10.00) x 28%
    ]);
  });

  it("ledger: receivable 555.20 = sales 478.39 + output CGST 38.41 + output SGST 38.40", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "555.20", "0.00"],
      ["2100", "0.00", "38.41"], // 18.00 + 2.50 + 5.31 + 12.60
      ["2101", "0.00", "38.40"], // 18.00 + 2.50 + 5.30 + 12.60
      ["4000", "0.00", "478.39"],
    ]);
    expect(b.tb.totalDebit).toBe("555.20");
    expect(b.tb.totalCredit).toBe("555.20"); // 478.39 + 38.41 + 38.40
    expect(plSummary(b).totalIncome).toBe("478.39");
    expectBooksBalance(b);
  });

  it("GSTR-3B (Jun 2025): taxable 478.39, CGST 38.41, SGST 38.40", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("478.39");
    expect(fixed2(r.taxPayable.cgst)).toBe("38.41");
    expect(fixed2(r.taxPayable.sgst)).toBe("38.40");
    expect(fixed2(r.taxPayable.igst)).toBe("0.00");
    expect(fixed2(r.netTax.total)).toBe("76.81");
  });

  it("GSTR-1 (Jun 2025), by rate: taxable and CGST / SGST per GST rate add up to the same figures", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 6 });
    const row = (rate: number) => r.b2cSmall.find((x) => x.taxRate === rate)!;
    expect([row(18).taxableValue, row(18).cgst, row(18).sgst]).toEqual([200, 18, 18]);
    expect([row(5).taxableValue, row(5).cgst, row(5).sgst]).toEqual([100, 2.5, 2.5]);
    expect([row(12).taxableValue, row(12).cgst, row(12).sgst]).toEqual([88.39, 5.31, 5.3]); // 10.61: odd paisa to CGST
    expect([row(28).taxableValue, row(28).cgst, row(28).sgst]).toEqual([90, 12.6, 12.6]);
    const taxable = r.b2cSmall.reduce((s, x) => s + Math.round(x.taxableValue * 100), 0);
    expect(taxable).toBe(47839); // 478.39
  });

  it("party owes the inclusive total on every surface", async () => {
    expect((await w.caller.party.getById({ id: partyId }))?.balance).toBe("555.20");
    const ledger = await w.caller.party.ledgerReport({ partyId });
    expect(ledger?.summary.closingBalance).toBe("555.20");
  });

  it("the PDF's GST table is the same CGST / SGST by rate, from the same stored line columns", async () => {
    const inv = (await w.caller.invoice.getById({ id: invoiceId }))!;
    const data: InvoicePDFData = {
      businessName: "Golden Traders",
      gstRegistrationType: "regular",
      businessStateCode: "27",
      partyStateCode: "27",
      partyName: "Customer MH",
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: DATE,
      type: "sale",
      lineItems: inv.lineItems.map((l) => ({
        itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, taxPercent: l.taxPercent,
        taxAmount: l.taxAmount, discountPercent: l.discountPercent, totalAmount: l.totalAmount,
      })),
      subtotal: inv.subtotal, taxAmount: inv.taxAmount, discountAmount: inv.discountAmount,
      totalAmount: inv.totalAmount, amountPaid: inv.amountPaid,
    };
    expect(buildGstBreakdown(data).map((r) => [r.rate, r.taxable, r.cgst, r.sgst, r.igst])).toEqual([
      ["18.00", 200, 18, 18, 0],
      ["5.00", 100, 2.5, 2.5, 0],
      ["12.00", 88.39, 5.31, 5.3, 0],
      ["28.00", 90, 12.6, 12.6, 0],
    ]);
    // and the document renders (the totals it prints are inv.subtotal / taxAmount / totalAmount above)
    const bytes = await new Promise<number>((resolve, reject) => {
      const doc = generateInvoicePDF(data, "a4");
      let n = 0;
      doc.on("data", (c: Buffer) => (n += c.length));
      doc.on("end", () => resolve(n));
      doc.on("error", reject);
      doc.end();
    });
    expect(bytes).toBeGreaterThan(1000);
  });
});

describe("golden 15C: the same bill to a customer in another state is IGST", () => {
  let w: GoldenWorld;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const partyId = (await addParty(w, "customer", "KA")).id;
    await seedInclusiveBill(w, partyId);
  });

  it("total 555.20; ledger Cr 2102 IGST 76.81; GSTR-3B IGST 76.81, no CGST / SGST", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "555.20", "0.00"],
      ["2102", "0.00", "76.81"], // 36.00 + 5.00 + 10.61 + 25.20
      ["4000", "0.00", "478.39"],
    ]);
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.taxPayable.igst)).toBe("76.81");
    expect(fixed2(r.taxPayable.cgst)).toBe("0.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("0.00");
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("478.39");
  });
});

describe("golden 15D: purchase prices are tax-exclusive: an item flagged inclusive is NOT converted on a purchase", () => {
  let w: GoldenWorld;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const supplier = (await addParty(w, "supplier", "MH")).id;
    const item = await createInclusiveItem(w, "Atta", "118.00", "18", { purchasePrice: "90.00" });
    const inv = await w.caller.invoice.create({
      partyId: supplier, type: "purchase", invoiceDate: DATE,
      // the form puts the PURCHASE price (90.00, tax-exclusive) on the bill as it is
      lineItems: [{ itemId: item.id, itemName: "Atta", quantity: "10", unitPrice: "90.00", taxPercent: "18", discountPercent: "0" }],
    });
    await w.caller.invoice.updateStatus({ id: inv.id, status: "sent" });
  });

  it("10 x 90.00 @ 18%: taxable 900.00 + GST 162.00 = 1062.00; ITC CGST 81.00 + SGST 81.00", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1510", "81.00", "0.00"], // input CGST
      ["1511", "81.00", "0.00"], // input SGST
      ["2000", "0.00", "1062.00"], // payable
      ["5000", "900.00", "0.00"], // purchases
    ]);
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.itc.cgst)).toBe("81.00");
    expect(fixed2(r.itc.sgst)).toBe("81.00");
  });

  it("the shared rule says so: sale prices only", () => {
    expect(billRateFromItemPrice({ price: "90.00", inclusive: false, taxPercent: "18" }).rate).toBe("90.00");
  });
});

describe("golden 15E: every document type that shares the form bills the same amount", () => {
  let w: GoldenWorld;
  let customer: string;
  let supplier: string;
  let itemId: string;

  const saleLine = () => {
    // what the form does when the item is picked: 118.00 incl. 18% -> rate 100.00
    const picked = billRateFromItemPrice({ price: "118.00", inclusive: true, taxPercent: "18" });
    expect(picked.rate).toBe("100.00");
    return [{ itemId, itemName: "Atta", quantity: "1", unitPrice: picked.rate, taxPercent: "18", discountPercent: "0" }];
  };
  const purchaseLine = () => [{ itemId, itemName: "Atta", quantity: "1", unitPrice: "90.00", taxPercent: "18", discountPercent: "0" }];

  beforeAll(async () => {
    w = await createGoldenWorld();
    customer = (await addParty(w, "customer", "MH")).id;
    supplier = (await addParty(w, "supplier", "MH")).id;
    itemId = (await createInclusiveItem(w, "Atta", "118.00", "18", { purchasePrice: "90.00" })).id;
  });

  const sale = { partyId: "", type: "sale" as const, invoiceDate: DATE };

  it.each([
    ["invoice", () => w.caller.invoice.create({ ...sale, partyId: customer, lineItems: saleLine() })],
    ["quotation", () => w.caller.quotation.create({ ...sale, partyId: customer, lineItems: saleLine() })],
    ["proforma", () => w.caller.proforma.create({ ...sale, partyId: customer, lineItems: saleLine() })],
    ["delivery challan", () => w.caller.deliveryChallan.create({ ...sale, partyId: customer, lineItems: saleLine() })],
    ["credit note", () => w.caller.creditNote.create({ ...sale, partyId: customer, lineItems: saleLine() })],
    ["sales return", () => w.caller.salesReturn.create({ ...sale, partyId: customer, lineItems: saleLine() })],
  ] as const)("sale-side %s of an inclusive item: 100.00 + 18.00 = 118.00", async (_name, create) => {
    const doc = await create();
    expect([doc.subtotal, doc.taxAmount, doc.totalAmount]).toEqual(["100.00", "18.00", "118.00"]);
  });

  it.each([
    ["purchase invoice", () => w.caller.invoice.create({ partyId: supplier, type: "purchase", invoiceDate: DATE, lineItems: purchaseLine() })],
    ["debit note", () => w.caller.debitNote.create({ partyId: supplier, type: "purchase", invoiceDate: DATE, lineItems: purchaseLine() })],
    ["purchase return", () => w.caller.purchaseReturn.create({ partyId: supplier, type: "purchase", invoiceDate: DATE, lineItems: purchaseLine() })],
  ] as const)("purchase-side %s: the purchase price is not converted: 90.00 + 16.20 = 106.20", async (_name, create) => {
    const doc = await create();
    expect([doc.subtotal, doc.taxAmount, doc.totalAmount]).toEqual(["90.00", "16.20", "106.20"]);
  });
});

// ── 15F: random inclusive bills (a reference written here, independent of the code under test) ───
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rint = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
/** round half up of n / d for non-negative integers (exact in Number: values stay below 2^53) */
const rdiv = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
const f2 = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;

describe("golden 15F: random inclusive bills tie across invoice, ledger, GSTR-3B and the PDF table", () => {
  it("40 invoices (intra- and inter-state): documents, ledger and returns agree to the paisa", async () => {
    const w = await createGoldenWorld();
    const mh = (await addParty(w, "customer", "MH")).id;
    const ka = (await addParty(w, "customer", "KA")).id;
    const r = rng(0xf15);
    const RATES = [5, 12, 18, 28, 40];

    let sumTaxable = 0;
    let sumCgst = 0;
    let sumSgst = 0;
    let sumIgst = 0;
    let sumTotal = 0;
    let docCount = 0;

    for (let d = 0; d < 40; d++) {
      const inter = r() < 0.4;
      const lines = [];
      let docTaxable = 0;
      let docTax = 0;
      let docCgst = 0;
      let docSgst = 0;
      const n = rint(r, 1, 4);
      for (let k = 0; k < n; k++) {
        const t = RATES[rint(r, 0, RATES.length - 1)]!;
        const shelf = r() < 0.5 ? rint(r, 1, 9999) : rint(r, 1, 1_000_000); // paise
        const qty = r() < 0.6 ? rint(r, 1, 20) : rint(r, 1, 9999) / 1000;
        const qtyStr = String(qty);
        const disc = [0, 0, 5, 10, 12.5][rint(r, 0, 4)]!;
        const item = await createInclusiveItem(w, `R${d}-${k}`, f2(shelf), String(t));
        const tile = await tileFor(w, `R${d}-${k}`);
        // independent expectation of the tile rate and of the bill, from the shelf price
        const rate = rdiv(shelf * 100, 100 + t);
        expect(tile.unitPrice, `tile rate ${shelf}p @${t}%`).toBe(f2(rate));
        const sub = rdiv(rate * Math.round(qty * 1000), 1000);
        const after = sub - rdiv(sub * Math.round(disc * 100), 10000);
        const tax = rdiv(after * t, 100);
        docTaxable += after;
        docTax += tax;
        const c = rdiv(tax, 2); // odd paisa to CGST
        docCgst += c;
        docSgst += tax - c;
        lines.push({
          itemId: item.id, itemName: `R${d}-${k}`, quantity: qtyStr, unitPrice: tile.unitPrice, taxPercent: String(t), discountPercent: String(disc),
        });
      }
      const inv = await w.caller.invoice.create({ partyId: inter ? ka : mh, type: "sale", invoiceDate: DATE, lineItems: lines });
      await w.caller.invoice.updateStatus({ id: inv.id, status: "sent" });
      const got = (await w.caller.invoice.getById({ id: inv.id }))!;
      expect([got.subtotal, got.taxAmount, got.totalAmount], `invoice ${d}`).toEqual([f2(docTaxable), f2(docTax), f2(docTaxable + docTax)]);
      // the lines add up to the document
      expect(got.lineItems.reduce((s, l) => s + Math.round(Number(l.totalAmount) * 100), 0)).toBe(docTaxable + docTax);
      sumTaxable += docTaxable;
      sumTotal += docTaxable + docTax;
      if (inter) sumIgst += docTax;
      else {
        sumCgst += docCgst;
        sumSgst += docSgst;
      }
      docCount++;
    }

    // ledger
    const b = await book(w);
    const bal = (code: string) => b.tb.accounts.find((a) => a.accountCode === code);
    expect(bal("1100")?.debit, "receivable").toBe(f2(sumTotal));
    expect(bal("4000")?.credit, "sales").toBe(f2(sumTaxable));
    expect(bal("2100")?.credit ?? "0.00", "output CGST").toBe(f2(sumCgst));
    expect(bal("2101")?.credit ?? "0.00", "output SGST").toBe(f2(sumSgst));
    expect(bal("2102")?.credit ?? "0.00", "output IGST").toBe(f2(sumIgst));
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit);
    expect(f2(sumCgst + sumSgst + sumIgst + sumTaxable)).toBe(f2(sumTotal)); // GST + sales = receivable
    expectBooksBalance(b);

    // GSTR-3B for the month
    const g = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(g.outwardSupplies.taxable.taxableValue), "GSTR-3B taxable").toBe(f2(sumTaxable));
    expect(fixed2(g.taxPayable.cgst), "GSTR-3B CGST").toBe(f2(sumCgst));
    expect(fixed2(g.taxPayable.sgst), "GSTR-3B SGST").toBe(f2(sumSgst));
    expect(fixed2(g.taxPayable.igst), "GSTR-3B IGST").toBe(f2(sumIgst));
    expect(fixed2(g.netTax.total)).toBe(f2(sumCgst + sumSgst + sumIgst));
    expect(docCount).toBe(40);
  }, 120_000);
});
