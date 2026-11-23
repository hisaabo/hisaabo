/**
 * Scenario 18 — GSTR-1 Table 12 (HSN summary): one row per HSN + UQC + GST rate.
 *
 * Before 0.10.1 the summary had one row per HSN: the same HSN sold at 5% and at 18% was one row
 * with no rate, and every UQC was "NOS". Now a row is keyed by (HSN, UQC, rate) and the JSON
 * carries `rt` and the item's real UQC; quantities in different units are never added together.
 * The business is in Maharashtra (27), January 2026. Items: Steel Rods (HSN 730890, unit kg),
 * Cotton (HSN 5208, unit m); "Packing" is typed in with no item (no HSN: filed as 0000).
 *
 *   I1  B2B  Maharashtra buyer (intra-state)
 *         Steel Rods 10 kg x 100.00 @ 5%    taxable 1000.00  GST 50.00   CGST 25.00 + SGST 25.00
 *         Steel Rods  4 kg x 250.00 @ 18%   taxable 1000.00  GST 180.00  CGST 90.00 + SGST 90.00
 *   I2  B2C  Maharashtra, no GSTIN (intra-state)
 *         Steel Rods 2.5 kg x 100.00 @ 5%   taxable  250.00  GST 12.50   CGST 6.25 + SGST 6.25
 *         Cotton     1 m x 5.80 @ 5%        taxable    5.80  GST 0.29    CGST 0.15 + SGST 0.14  (odd paisa to CGST)
 *   I3  B2C  Karnataka, no GSTIN (inter-state, below 2.5 lakh: B2CS)
 *         Steel Rods 1 kg x 100.00 @ 18%    taxable  100.00  GST 18.00   IGST 18.00
 *         Packing    1 x 10.00 @ 0%         taxable   10.00  GST 0.00    (no item, no HSN)
 *   I4  B2B  Karnataka buyer (inter-state)
 *         Cotton    10 m x 100.00 @ 12%     taxable 1000.00  GST 120.00  IGST 120.00
 *   I5  B2C  Maharashtra, no GSTIN, billed in GRAMS (unit chosen on the line)
 *         Steel Rods 500 g x 0.10 @ 5%      taxable   50.00  GST 2.50    CGST 1.25 + SGST 1.25
 *
 * Table 12, sorted by HSN, rate, UQC:
 *   HSN     rate  UQC  qty    taxable  CGST   SGST   IGST    total value
 *   0000     0    NOS    1      10.00   0.00   0.00    0.00      10.00
 *   5208     5    MTR    1       5.80   0.15   0.14    0.00       6.09
 *   5208    12    MTR   10    1000.00   0.00   0.00  120.00    1120.00
 *   730890   5    GMS  500      50.00   1.25   1.25    0.00      52.50
 *   730890   5    KGS 12.5    1250.00  31.25  31.25    0.00    1312.50   (10 + 2.5 kg; 1000.00 + 250.00)
 *   730890  18    KGS    5    1100.00  90.00  90.00   18.00    1298.00   (4 + 1 kg; 1000.00 + 100.00; 1180.00 + 118.00)
 *   totals                    3415.80 122.65 122.64  138.00    3799.09
 *
 * Cross-report ties (the same data in every section):
 *   B2B   I1 + I4          taxable 3000.00  CGST 115.00  SGST 115.00  IGST 120.00
 *   B2CS  I2 + I3 + I5     taxable  415.80  CGST   7.65  SGST   7.64  IGST  18.00
 *         (rate 0: 10.00; rate 5: 250.00 + 5.80 + 50.00 = 305.80, CGST 6.25 + 0.15 + 1.25 = 7.65, SGST 6.25 + 0.14 + 1.25 = 7.64; rate 18: 100.00, IGST 18.00)
 *   B2B + B2CS             taxable 3415.80  CGST 122.65  SGST 122.64  IGST 138.00  = Table 12 = GSTR-3B 3.1(a)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { useGoldenDb, createGoldenWorld, addInvoice, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const DATE = (day: string) => `2026-01-${day}T12:00:00.000Z`;

describe("golden 18: GSTR-1 Table 12, one row per HSN + UQC + rate", () => {
  let w: GoldenWorld;
  let packingInvoiceNumber: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const steel = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "kg", taxPercent: "5" })).id;
    const cotton = (await w.caller.item.create({ name: "Cotton", hsn: "5208", unit: "m", taxPercent: "5" })).id;

    const party = async (name: string, state: string, stateCode: string, gstin?: string) =>
      (await w.caller.party.create({ type: "customer", name, state, stateCode, gstin, openingBalance: "0" })).id;
    const b2bMh = await party("B2B Maharashtra", "Maharashtra", "27", "27AABCM0000R1ZM");
    const b2bKa = await party("B2B Karnataka", "Karnataka", "29", "29AABCG0000R1ZM");
    const b2cMh = await party("B2C Maharashtra", "Maharashtra", "27");
    const b2cKa = await party("B2C Karnataka", "Karnataka", "29");

    await addInvoice(w, "sale", b2bMh, [
      { name: "Steel Rods", itemId: steel, qty: "10", price: "100.00", tax: "5" },
      { name: "Steel Rods", itemId: steel, qty: "4", price: "250.00", tax: "18" },
    ], { date: DATE("10") });
    await addInvoice(w, "sale", b2cMh, [
      { name: "Steel Rods", itemId: steel, qty: "2.5", price: "100.00", tax: "5" },
      { name: "Cotton", itemId: cotton, qty: "1", price: "5.80", tax: "5" },
    ], { date: DATE("11") });
    packingInvoiceNumber = (await addInvoice(w, "sale", b2cKa, [
      { name: "Steel Rods", itemId: steel, qty: "1", price: "100.00", tax: "18" },
      { name: "Packing", qty: "1", price: "10.00", tax: "0" },
    ], { date: DATE("12") })).invoiceNumber;
    await addInvoice(w, "sale", b2bKa, [
      { name: "Cotton", itemId: cotton, qty: "10", price: "100.00", tax: "12" },
    ], { date: DATE("13") });
    await addInvoice(w, "sale", b2cMh, [
      { name: "Steel Rods", itemId: steel, qty: "500", price: "0.10", tax: "5", unit: "g" },
    ], { date: DATE("14") });
  });

  it("Table 12 rows are keyed by HSN, UQC and rate, with the rate and the item's unit", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(
      r.hsn.map((h) => [h.hsn, h.taxRate, h.uqc, h.quantity, h.taxableValue, h.cgst, h.sgst, h.igst, h.totalValue]),
    ).toEqual([
      ["0000", 0, "NOS", 1, 10, 0, 0, 0, 10],
      ["5208", 5, "MTR", 1, 5.8, 0.15, 0.14, 0, 6.09],
      ["5208", 12, "MTR", 10, 1000, 0, 0, 120, 1120],
      ["730890", 5, "GMS", 500, 50, 1.25, 1.25, 0, 52.5],
      ["730890", 5, "KGS", 12.5, 1250, 31.25, 31.25, 0, 1312.5],
      ["730890", 18, "KGS", 5, 1100, 90, 90, 18, 1298],
    ]);
    expect(r.hsn.map((h) => h.description)).toEqual(["Packing", "Cotton", "Cotton", "Steel Rods", "Steel Rods", "Steel Rods"]);
  });

  it("the same HSN at 5% and 18% is two rows that add up to the HSN's lines", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    const kgs = r.hsn.filter((h) => h.hsn === "730890" && h.uqc === "KGS");
    expect(kgs.map((h) => h.taxRate)).toEqual([5, 18]);
    // taxable 1250.00 + 1100.00 = 2350.00 = 1000 + 250 + 1000 + 100
    expect(kgs.reduce((a, h) => a + Math.round(h.taxableValue * 100), 0)).toBe(235000);
  });

  it("B2CS rows, by rate (rows appear in order of first sale), tie to the same lines", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.b2cSmall.map((x) => [x.taxRate, x.taxableValue, x.cgst, x.sgst, x.igst])).toEqual([
      [5, 305.8, 7.65, 7.64, 0], // 250.00 + 5.80 + 50.00; CGST 6.25 + 0.15 + 1.25; SGST 6.25 + 0.14 + 1.25
      [18, 100, 0, 0, 18],
      [0, 10, 0, 0, 0],
    ]);
  });

  it("Table 12 = B2B + B2CS = GSTR-3B 3.1(a), taxable value and every head", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    const cents = (n: number) => Math.round(n * 100);
    const sum = (xs: number[]) => xs.reduce((a, x) => a + cents(x), 0);

    const t12 = {
      taxable: sum(r.hsn.map((h) => h.taxableValue)),
      cgst: sum(r.hsn.map((h) => h.cgst)),
      sgst: sum(r.hsn.map((h) => h.sgst)),
      igst: sum(r.hsn.map((h) => h.igst)),
    };
    expect(t12).toEqual({ taxable: 341580, cgst: 12265, sgst: 12264, igst: 13800 });

    const b2b = {
      taxable: sum(r.b2b.map((x) => x.taxableValue)),
      cgst: sum(r.b2b.map((x) => x.cgst)),
      sgst: sum(r.b2b.map((x) => x.sgst)),
      igst: sum(r.b2b.map((x) => x.igst)),
    };
    const b2cs = {
      taxable: sum(r.b2cSmall.map((x) => x.taxableValue)),
      cgst: sum(r.b2cSmall.map((x) => x.cgst)),
      sgst: sum(r.b2cSmall.map((x) => x.sgst)),
      igst: sum(r.b2cSmall.map((x) => x.igst)),
    };
    expect(b2b).toEqual({ taxable: 300000, cgst: 11500, sgst: 11500, igst: 12000 });
    expect(b2cs).toEqual({ taxable: 41580, cgst: 765, sgst: 764, igst: 1800 });
    expect({
      taxable: b2b.taxable + b2cs.taxable,
      cgst: b2b.cgst + b2cs.cgst,
      sgst: b2b.sgst + b2cs.sgst,
      igst: b2b.igst + b2cs.igst,
    }).toEqual(t12);

    // the report's own totals
    expect([r.totalTaxableValue, r.totalCgst, r.totalSgst, r.totalIgst]).toEqual([3415.8, 122.65, 122.64, 138]);

    // GSTR-3B 3.1(a): the same figures (there are no credit or debit notes this month)
    const b = await w.caller.gst.gstr3b({ year: 2026, month: 1 });
    expect(b.outwardSupplies.taxable).toEqual({ taxableValue: 3415.8, cgst: 122.65, sgst: 122.64, igst: 138 });
  });

  it("the portal JSON export is refused while a line has no HSN (the typed-in Packing line); golden 21 covers the rule", async () => {
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`${packingInvoiceNumber} line 2 ('Packing')`),
    });
  });

  it("the CSV has the HSN section with the rate and UQC", async () => {
    const r = await w.caller.gst.gstr1CSV({ year: 2026, month: 1 });
    const lines = r.csv.split("\n");
    const at = lines.indexOf("HSN - Summary of Outward Supplies (Table 12)");
    expect(at).toBeGreaterThan(-1);
    // every cell of a data row is quoted (CSV formula-injection guard); the header is plain
    const row = (...cells: string[]) => cells.map((c) => `"${c}"`).join(",");
    expect(lines.slice(at + 1, at + 10)).toEqual([
      // the typed-in Packing line has no HSN: flagged, not hidden
      row("WARNING: 1 line(s) have no HSN code and are filed under 0000, which is not a real HSN code. Fix them before filing"),
      row("NO HSN", packingInvoiceNumber, "line 2", "Packing", "typed in without an item"),
      "HSN,Description,UQC,Quantity,Tax Rate %,Taxable Value,CGST,SGST,IGST,Cess,Total Value,Flag",
      row("0000", "Packing", "NOS", "1", "0", "10.00", "0.00", "0.00", "0.00", "0.00", "10.00", "NO HSN"),
      row("5208", "Cotton", "MTR", "1", "5", "5.80", "0.15", "0.14", "0.00", "0.00", "6.09", ""),
      row("5208", "Cotton", "MTR", "10", "12", "1000.00", "0.00", "0.00", "120.00", "0.00", "1120.00", ""),
      row("730890", "Steel Rods", "GMS", "500", "5", "50.00", "1.25", "1.25", "0.00", "0.00", "52.50", ""),
      row("730890", "Steel Rods", "KGS", "12.5", "5", "1250.00", "31.25", "31.25", "0.00", "0.00", "1312.50", ""),
      row("730890", "Steel Rods", "KGS", "5", "18", "1100.00", "90.00", "90.00", "18.00", "0.00", "1298.00", ""),
    ]);
  });
});

/**
 * Quantities are added exactly (integer thousandths), not as floats: 0.1 + 0.2 is 0.3, not
 * 0.30000000000000004. Two sales of the same item at the same rate land in one row:
 *   Steel Rods 0.1 kg x 100.00 @ 5%   taxable 10.00  GST 0.50  CGST 0.25 + SGST 0.25
 *   Steel Rods 0.2 kg x 100.00 @ 5%   taxable 20.00  GST 1.00  CGST 0.50 + SGST 0.50
 *   one row: 730890, 5%, KGS, quantity 0.3, taxable 30.00, CGST 0.75, SGST 0.75, total 31.50
 */
describe("golden 18b: Table 12 quantities add exactly", () => {
  it("0.1 kg + 0.2 kg is 0.3 kg", async () => {
    const w = await createGoldenWorld();
    const steel = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "kg", taxPercent: "5" })).id;
    const buyer = (await w.caller.party.create({
      type: "customer", name: "B2B Maharashtra", state: "Maharashtra", stateCode: "27", gstin: "27AABCM0000R1ZM", openingBalance: "0",
    })).id;
    await addInvoice(w, "sale", buyer, [{ name: "Steel Rods", itemId: steel, qty: "0.1", price: "100.00", tax: "5" }], { date: DATE("10") });
    await addInvoice(w, "sale", buyer, [{ name: "Steel Rods", itemId: steel, qty: "0.2", price: "100.00", tax: "5" }], { date: DATE("11") });

    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsn.map((h) => [h.hsn, h.taxRate, h.uqc, h.quantity, h.taxableValue, h.cgst, h.sgst, h.igst, h.totalValue])).toEqual([
      ["730890", 5, "KGS", 0.3, 30, 0.75, 0.75, 0, 31.5],
    ]);
  });
});
