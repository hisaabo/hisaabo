/**
 * Scenario 27 — GSTR-1 portal JSON: real rate-wise rows, places of supply and Table 12 fields.
 *
 * Before 0.10.1 the JSON could not be filed: every B2B invoice was ONE item with `rt: 0` and the invoice's
 * lump sums, every credit / debit note had `rt: 0` and ZERO tax, B2CL had no invoice number, date, value or
 * rate, B2CS put the SUPPLIER's state on every row (an inter-state sale to Karnataka was "INTER" with
 * pos 27) and decided INTRA / INTER from "CGST > 0", and the HSN rows had no `val`. Now each document is
 * written as the portal wants it: one `itms` entry per GST rate with `rt`, `txval` and the heads of its
 * supply type, summed line by line the way the B2CS and HSN rows are, so every section ties.
 *
 * Business in Maharashtra (27). January 2026, every invoice on its own day (10 .. 16 Jan IST).
 * Customers: R27 registered in 27 (intra), R29 registered in 29 (inter), U29 unregistered in Karnataka,
 * W unregistered with nothing on file (the POS walk-in: the supplier's own state, intra).
 *
 *   I1  R27  Steel 100 kg x 100.00 @5%  taxable 10000.00 tax 500.00 (CGST 250.00 + SGST 250.00)
 *            Cotton 10 m x 1000.00 @12% taxable 10000.00 tax 1200.00 (600.00 + 600.00)   total 21700.00
 *   I2  R29  Steel 20 kg x 100.00 @18% (2000.00 / 360.00) + Consulting (a service) 1 x 3000.00 @18% (3000.00 / 540.00)
 *            ONE rate row: taxable 5000.00, IGST 900.00                                  total  5900.00
 *   I3  R27  Cotton 1 m x 5.80 @5% + Steel 1 kg x 5.80 @5%: tax 0.29 + 0.29, each split 0.15 + 0.14 (odd paisa to CGST)
 *            one row: taxable 11.60, CGST 0.30, SGST 0.28                                 total    12.18
 *   I4  U29  Steel 1000 kg x 300.00 @18% (300000.00 / 54000.00) + Cotton 100 m x 100.00 @5% (10000.00 / 500.00)
 *            inter-state, value 364500.00 > 250000: B2CL, place of supply 29
 *   I5  U29  Cotton 10 m x 1000.00 @12%: taxable 10000.00 IGST 1200.00, B2CS INTER pos 29
 *   I6  W    Steel 10 kg x 100.00 @5% (1000.00 / 50.00) + Consulting 1 x 2000.00 @18% (2000.00 / 360.00)
 *   I7  W    Steel 5 kg x 100.00 @5%  (500.00 / 25.00)
 *            B2CS INTRA pos 27: rt 5 taxable 1500.00 CGST 37.50 + SGST 37.50; rt 18 taxable 2000.00 CGST 180.00 + SGST 180.00
 *   CN1 R27 credit note Steel 10 kg x 100.00 @5%: 1000.00 / 50.00, value 1050.00
 *   CN2 R29 credit note Steel 5 x 100.00 @18% (500 / 90) + Cotton 1 x 1000.00 @12% (1000 / 120), value 1710.00
 *   DN1 R27 debit note Cotton 1 x 200.00 @12%: 200.00 / 24.00, value 224.00
 *
 * Table 12 (HSN + UQC + rate), by hand:
 *   5208   MTR  5%   qty   101  taxable 10005.80  CGST   0.15 SGST   0.14 IGST   500.00  value 10506.09  (I3 line + I4 line)
 *   5208   MTR 12%   qty    20  taxable 20000.00  CGST 600.00 SGST 600.00 IGST  1200.00  value 22400.00  (I1 + I5)
 *   730890 KGS  5%   qty   116  taxable 11505.80  CGST 287.65 SGST 287.64 IGST     0.00  value 12081.09  (I1 + I3 + I6 + I7)
 *   730890 KGS 18%   qty  1020  taxable 302000.00 CGST   0.00 SGST   0.00 IGST 54360.00  value 356360.00 (I2 + I4)
 *   998314 NA  18%   qty     0  taxable  5000.00  CGST 180.00 SGST 180.00 IGST   540.00  value  5900.00  (services: UQC NA, quantity 0)
 * Ties: Table 12 = B2B + B2CL + B2CS: taxable 348511.60, CGST 1067.80, SGST 1067.78, IGST 56600.00. GSTR-3B 3.1(a) is
 * that net of the two credit notes and plus the debit note: taxable 348511.60 - 1000.00 - 1500.00 + 200.00 = 346211.60;
 * CGST 1067.80 - 25.00 + 12.00 = 1054.80; SGST 1067.78 - 25.00 + 12.00 = 1054.78; IGST 56600.00 - 120.00 - 90.00 = 56390.00.
 *
 * The JSON is also REFUSED (not mis-filed) for what it cannot yet represent: a note to an unregistered
 * customer, an invoice whose lines do not add up to its totals, a customer state that is not a GST state.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addInvoice, addAdjustmentDoc, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

/** IST midnight of 2026-01-<d> */
const jan = (d: number) => `2026-01-${String(d - 1).padStart(2, "0")}T18:30:00.000Z`;

describe("golden 27: GSTR-1 portal JSON, rate-wise rows", () => {
  let w: GoldenWorld;
  const no: Record<string, string> = {};

  beforeAll(async () => {
    w = await createGoldenWorld();
    const item = async (name: string, hsn: string, unit: "kg" | "m" | "pcs", tax: string, itemType: "product" | "service" = "product") =>
      (await w.caller.item.create({ name, hsn, unit, taxPercent: tax, itemType })).id;
    const steel = await item("Steel Rods", "730890", "kg", "18");
    const cotton = await item("Cotton", "5208", "m", "18");
    const consulting = await item("Consulting", "998314", "pcs", "18", "service");

    const party = async (name: string, p: Record<string, string>) =>
      (await w.caller.party.create({ type: "customer", name, openingBalance: "0", ...p })).id;
    const r27 = await party("Reg Maharashtra", { gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27" });
    const r29 = await party("Reg Karnataka", { gstin: "29AABCG0000R1ZM", state: "Karnataka", stateCode: "29" });
    const u29 = await party("Unreg Karnataka", { state: "Karnataka", stateCode: "29" });
    const walkIn = await party("Walk-in", {});

    const L = (name: string, itemId: string, unit: string, qty: string, price: string, tax: string) => ({ name, itemId, unit, qty, price, tax });
    const sale = async (key: string, partyId: string, day: number, lines: ReturnType<typeof L>[]) => {
      no[key] = (await addInvoice(w, "sale", partyId, lines, { date: jan(day) })).invoiceNumber;
    };
    await sale("I1", r27, 10, [L("Steel Rods", steel, "kg", "100", "100.00", "5"), L("Cotton", cotton, "m", "10", "1000.00", "12")]);
    await sale("I2", r29, 11, [L("Steel Rods", steel, "kg", "20", "100.00", "18"), L("Consulting", consulting, "pcs", "1", "3000.00", "18")]);
    await sale("I3", r27, 12, [L("Cotton", cotton, "m", "1", "5.80", "5"), L("Steel Rods", steel, "kg", "1", "5.80", "5")]);
    await sale("I4", u29, 13, [L("Steel Rods", steel, "kg", "1000", "300.00", "18"), L("Cotton", cotton, "m", "100", "100.00", "5")]);
    await sale("I5", u29, 13, [L("Cotton", cotton, "m", "10", "1000.00", "12")]);
    await sale("I6", walkIn, 14, [L("Steel Rods", steel, "kg", "10", "100.00", "5"), L("Consulting", consulting, "pcs", "1", "2000.00", "18")]);
    await sale("I7", walkIn, 14, [L("Steel Rods", steel, "kg", "5", "100.00", "5")]);

    const adj = async (key: string, kind: "creditNote" | "debitNote", partyId: string, day: number, lines: ReturnType<typeof L>[]) => {
      no[key] = (await addAdjustmentDoc(w, kind, "sale", partyId, lines, { date: jan(day) })).invoiceNumber;
    };
    await adj("CN1", "creditNote", r27, 14, [L("Steel Rods", steel, "kg", "10", "100.00", "5")]);
    await adj("CN2", "creditNote", r29, 15, [L("Steel Rods", steel, "kg", "5", "100.00", "18"), L("Cotton", cotton, "m", "1", "1000.00", "12")]);
    await adj("DN1", "debitNote", r27, 16, [L("Cotton", cotton, "m", "1", "200.00", "12")]);
  });

  const json = async () => (await w.caller.gst.gstr1Json({ year: 2026, month: 1 })).json as Record<string, unknown>;

  it("B2B: one `itms` entry per GST rate with its real rt, txval and the heads of its supply type", async () => {
    expect((await json()).b2b).toEqual([
      {
        ctin: "27AABCM0000R1ZM",
        inv: [
          {
            inum: no.I1, idt: "10-01-2026", val: 21700, pos: "27", rchrg: "N", inv_typ: "R",
            itms: [
              { num: 1, itm_det: { txval: 10000, rt: 5, camt: 250, samt: 250, csamt: 0 } },
              { num: 2, itm_det: { txval: 10000, rt: 12, camt: 600, samt: 600, csamt: 0 } },
            ],
          },
          {
            // two 5% lines of tax 0.29 each, each split 0.15 + 0.14: CGST 0.30, SGST 0.28 (not 0.29 + 0.29)
            inum: no.I3, idt: "12-01-2026", val: 12.18, pos: "27", rchrg: "N", inv_typ: "R",
            itms: [{ num: 1, itm_det: { txval: 11.6, rt: 5, camt: 0.3, samt: 0.28, csamt: 0 } }],
          },
        ],
      },
      {
        ctin: "29AABCG0000R1ZM",
        inv: [
          {
            // the 18% steel line and the 18% service line are ONE rate row
            inum: no.I2, idt: "11-01-2026", val: 5900, pos: "29", rchrg: "N", inv_typ: "R",
            itms: [{ num: 1, itm_det: { txval: 5000, rt: 18, iamt: 900, csamt: 0 } }],
          },
        ],
      },
    ]);
  });

  it("B2CL: each invoice with its number, date, value and rate rows, under its place of supply", async () => {
    expect((await json()).b2cl).toEqual([
      {
        pos: "29",
        inv: [
          {
            inum: no.I4, idt: "13-01-2026", val: 364500,
            itms: [
              { num: 1, itm_det: { txval: 10000, rt: 5, iamt: 500, csamt: 0 } },
              { num: 2, itm_det: { txval: 300000, rt: 18, iamt: 54000, csamt: 0 } },
            ],
          },
        ],
      },
    ]);
  });

  it("B2CS: INTER carries the customer's state (29) and IGST; INTRA the supplier's (27) and CGST + SGST", async () => {
    expect((await json()).b2cs).toEqual([
      { sply_ty: "INTER", pos: "29", typ: "OE", rt: 12, txval: 10000, iamt: 1200, csamt: 0 },
      { sply_ty: "INTRA", pos: "27", typ: "OE", rt: 5, txval: 1500, camt: 37.5, samt: 37.5, csamt: 0 },
      { sply_ty: "INTRA", pos: "27", typ: "OE", rt: 18, txval: 2000, camt: 180, samt: 180, csamt: 0 },
    ]);
  });

  it("CDNR: credit and debit notes carry their real rate rows and tax (they were rt 0 with zero tax)", async () => {
    expect((await json()).cdnr).toEqual([
      {
        ctin: "27AABCM0000R1ZM",
        nt: [
          {
            ntty: "C", nt_num: no.CN1, nt_dt: "14-01-2026", val: 1050, pos: "27", rchrg: "N", inv_typ: "R",
            itms: [{ num: 1, itm_det: { txval: 1000, rt: 5, camt: 25, samt: 25, csamt: 0 } }],
          },
          {
            ntty: "D", nt_num: no.DN1, nt_dt: "16-01-2026", val: 224, pos: "27", rchrg: "N", inv_typ: "R",
            itms: [{ num: 1, itm_det: { txval: 200, rt: 12, camt: 12, samt: 12, csamt: 0 } }],
          },
        ],
      },
      {
        ctin: "29AABCG0000R1ZM",
        nt: [
          {
            ntty: "C", nt_num: no.CN2, nt_dt: "15-01-2026", val: 1710, pos: "29", rchrg: "N", inv_typ: "R",
            itms: [
              { num: 1, itm_det: { txval: 1000, rt: 12, iamt: 120, csamt: 0 } },
              { num: 2, itm_det: { txval: 500, rt: 18, iamt: 90, csamt: 0 } },
            ],
          },
        ],
      },
    ]);
  });

  it("Table 12: val on every row; a service is UQC NA with quantity 0; HSN + UQC + rate", async () => {
    expect(((await json()).hsn as { data: unknown[] }).data).toEqual([
      { num: 1, hsn_sc: "5208", desc: "Cotton", uqc: "MTR", qty: 101, val: 10506.09, rt: 5, txval: 10005.8, iamt: 500, camt: 0.15, samt: 0.14, csamt: 0 },
      { num: 2, hsn_sc: "5208", desc: "Cotton", uqc: "MTR", qty: 20, val: 22400, rt: 12, txval: 20000, iamt: 1200, camt: 600, samt: 600, csamt: 0 },
      { num: 3, hsn_sc: "730890", desc: "Steel Rods", uqc: "KGS", qty: 116, val: 12081.09, rt: 5, txval: 11505.8, iamt: 0, camt: 287.65, samt: 287.64, csamt: 0 },
      { num: 4, hsn_sc: "730890", desc: "Steel Rods", uqc: "KGS", qty: 1020, val: 356360, rt: 18, txval: 302000, iamt: 54360, camt: 0, samt: 0, csamt: 0 },
      { num: 5, hsn_sc: "998314", desc: "Consulting", uqc: "NA", qty: 0, val: 5900, rt: 18, txval: 5000, iamt: 540, camt: 180, samt: 180, csamt: 0 },
    ]);
  });

  it("every section ties: B2B + B2CL + B2CS = Table 12; GSTR-3B 3.1(a) is that net of the notes, in exact paise", async () => {
    const j = await json();
    type Det = { txval: number; iamt?: number; camt?: number; samt?: number };
    const cents = (n: number | undefined) => Math.round((n ?? 0) * 100);
    const add = (acc: number[], d: Det) => [acc[0]! + cents(d.txval), acc[1]! + cents(d.camt), acc[2]! + cents(d.samt), acc[3]! + cents(d.iamt)];

    let sections = [0, 0, 0, 0];
    for (const c of j.b2b as Array<{ inv: Array<{ itms: Array<{ itm_det: Det }> }> }>) for (const i of c.inv) for (const t of i.itms) sections = add(sections, t.itm_det);
    for (const g of j.b2cl as Array<{ inv: Array<{ itms: Array<{ itm_det: Det }> }> }>) for (const i of g.inv) for (const t of i.itms) sections = add(sections, t.itm_det);
    for (const r of j.b2cs as Det[]) sections = add(sections, r);

    let t12 = [0, 0, 0, 0];
    for (const r of (j.hsn as { data: Det[] }).data) t12 = add(t12, r);

    expect(sections).toEqual([34851160, 106780, 106778, 5660000]);
    expect(t12).toEqual(sections);

    const b = await w.caller.gst.gstr3b({ year: 2026, month: 1 });
    expect(b.outwardSupplies.taxable).toEqual({ taxableValue: 346211.6, cgst: 1054.8, sgst: 1054.78, igst: 56390 });
  });

  it("the CSV shows the service row as UQC NA, quantity 0", async () => {
    const csv = (await w.caller.gst.gstr1CSV({ year: 2026, month: 1 })).csv.split("\n");
    expect(csv).toContain(`"998314","Consulting","NA","0","18","5000.00","180.00","180.00","540.00","0.00","5900.00",""`);
  });
});

describe("golden 27b: UQC codes come from one list (ft and in have no UQC; a bunch is BUN)", () => {
  it("Table 12 rows: ft -> OTH, bun -> BUN, dozen -> DOZ, pair -> PRS, pkt -> PAC", async () => {
    const w = await createGoldenWorld();
    const buyer = (await w.caller.party.create({ type: "customer", name: "B", gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27", openingBalance: "0" })).id;
    const mk = async (name: string, hsn: string, unit: "ft" | "bun" | "dozen" | "pair" | "pkt") => (await w.caller.item.create({ name, hsn, unit, taxPercent: "5" })).id;
    const lines = [
      { name: "Rope", itemId: await mk("Rope", "5607", "ft"), unit: "ft", qty: "10", price: "10.00", tax: "5" },
      { name: "Flowers", itemId: await mk("Flowers", "0603", "bun"), unit: "bun", qty: "3", price: "100.00", tax: "5" },
      { name: "Eggs", itemId: await mk("Eggs", "0407", "dozen"), unit: "dozen", qty: "2", price: "100.00", tax: "5" },
      { name: "Socks", itemId: await mk("Socks", "6115", "pair"), unit: "pair", qty: "4", price: "10.00", tax: "5" },
      { name: "Biscuit", itemId: await mk("Biscuit", "1905", "pkt"), unit: "pkt", qty: "5", price: "10.00", tax: "5" },
    ];
    await addInvoice(w, "sale", buyer, lines, { date: jan(20) });
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsn.map((h) => [h.hsn, h.uqc, h.quantity])).toEqual([
      ["0407", "DOZ", 2],
      ["0603", "BUN", 3],
      ["1905", "PAC", 5],
      ["5607", "OTH", 10],
      ["6115", "PRS", 4],
    ]);
  });
});

describe("golden 27c: the JSON is refused for what it cannot represent, naming the document", () => {
  let w: GoldenWorld;
  let buyer: string;
  let steel: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    steel = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "kg", taxPercent: "18" })).id;
    buyer = (await w.caller.party.create({ type: "customer", name: "Reg", gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27", openingBalance: "0" })).id;
  });

  const feb = (d: number) => `2026-02-${String(d - 1).padStart(2, "0")}T18:30:00.000Z`;
  const line = (price: string) => [{ name: "Steel Rods", itemId: steel, unit: "kg", qty: "1", price, tax: "18" }];

  it("a credit note to an unregistered customer (Table 9B / netted in Table 7): refused, on-screen report still works", async () => {
    const walkIn = (await w.caller.party.create({ type: "customer", name: "Walk-in", openingBalance: "0" })).id;
    const cn = await addAdjustmentDoc(w, "creditNote", "sale", walkIn, line("100.00"), { date: feb(10) });
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 2 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`note ${cn.invoiceNumber} (to Walk-in, unregistered)`),
    });
    const report = await w.caller.gst.gstr1({ year: 2026, month: 2 });
    expect(report.portalIssues).toHaveLength(1);
    expect(report.creditNotes).toHaveLength(1);
  });

  it("an invoice whose lines do not add up to its taxable value: refused naming the invoice", async () => {
    const inv = await addInvoice(w, "sale", buyer, line("1000.00"), { date: feb(11) });
    await getTenantTestDb().update(invoices).set({ subtotal: "999.00" }).where(eq(invoices.id, inv.id));
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 2 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`invoice ${inv.invoiceNumber}: its lines do not add up to its taxable value 999.00 and tax 180.00`),
    });
  });

  it("a B2CL invoice to a customer whose state is not a GST state: refused (the place of supply cannot be filed)", async () => {
    const narnia = (await w.caller.party.create({ type: "customer", name: "Narnia Trader", state: "Narnia", openingBalance: "0" })).id;
    const inv = await addInvoice(w, "sale", narnia, line("300000.00"), { date: feb(12) });
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 2 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`invoice ${inv.invoiceNumber} (to Narnia Trader): the customer's state 'Narnia' is not a GST state`),
    });
  });
});
