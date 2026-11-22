/**
 * Scenario 21 — GSTR-1 Table 12 with a missing HSN: the JSON export is refused, the report and
 * the CSV show the lines flagged.
 *
 * Before 0.10.1 a sale line with no HSN (an item with none, or a line typed in without an item)
 * was filed in Table 12 under "0000", which is not a real HSN code, silently. Now:
 *   - `gst.gstr1` (the on-screen report) still lists those lines under HSN 0000 so the totals tie,
 *     and carries `hsnMissing`: every such line (invoice number, 1-based line, item name, item id);
 *   - `gst.gstr1CSV` flags them (a WARNING line, one "NO HSN" line per line, a Flag column);
 *   - `gst.gstr1Json` (the file for the portal) is REFUSED with PRECONDITION_FAILED and a message
 *     that lists what to fix, until every line has an HSN. Blocking the file, not the screen, is
 *     the point: a file with a made-up code would be filed or rejected; a screen can say what is wrong.
 *
 * World A (January 2026, Maharashtra, B2B buyer in the same state):
 *   I1  Steel Rods (HSN 730890) 10 kg x 100.00 @ 5%  taxable 1000.00, CGST 25.00 + SGST 25.00
 *   I2  Copper Wire (item without HSN) 2 x 50.00 @ 18%      taxable 100.00, CGST 9.00 + SGST 9.00
 *       Packing (typed in, no item)    1 x 10.00 @ 0%       taxable  10.00
 *   Table 12 therefore has a "0000" row; hsnMissing = [I2 line 1 Copper Wire, I2 line 2 Packing].
 *   Giving Copper Wire an HSN leaves only the typed-in Packing line in the way.
 *
 * World B: the same sales with a real HSN on every line (Packing replaced by a Plastic item, HSN 3923):
 *   the JSON export succeeds; Table 12 rows carry rt and the real UQC:
 *     730890  5%  KGS  qty 10  taxable 1000.00  CGST 25.00 SGST 25.00
 *     7408   18%  NOS  qty  2  taxable  100.00  CGST  9.00 SGST  9.00
 *     3923    0%  NOS  qty  1  taxable   10.00
 */
import { describe, it, expect, beforeAll } from "vitest";
import { useGoldenDb, createGoldenWorld, addInvoice, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const DATE = (day: string) => `2026-01-${day}T12:00:00.000Z`;

async function seed(w: GoldenWorld, opts: { packingItem: boolean }) {
  const steel = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "kg", taxPercent: "5" })).id;
  const copper = (await w.caller.item.create({ name: "Copper Wire", unit: "pcs", taxPercent: "18", ...(opts.packingItem ? { hsn: "7408" } : {}) })).id;
  const plastic = opts.packingItem ? (await w.caller.item.create({ name: "Plastic", hsn: "3923", unit: "pcs", taxPercent: "0" })).id : undefined;
  const buyer = (await w.caller.party.create({
    type: "customer", name: "B2B Maharashtra", state: "Maharashtra", stateCode: "27", gstin: "27AABCM0000R1ZM", openingBalance: "0",
  })).id;
  const i1 = await addInvoice(w, "sale", buyer, [{ name: "Steel Rods", itemId: steel, qty: "10", price: "100.00", tax: "5" }], { date: DATE("10") });
  const i2 = await addInvoice(w, "sale", buyer, [
    { name: "Copper Wire", itemId: copper, qty: "2", price: "50.00", tax: "18" },
    { name: opts.packingItem ? "Plastic" : "Packing", itemId: plastic, qty: "1", price: "10.00", tax: "0" },
  ], { date: DATE("11") });
  return { copper, i1: i1.invoiceNumber, i2: i2.invoiceNumber };
}

describe("golden 21: GSTR-1 with a missing HSN (world A)", () => {
  let w: GoldenWorld;
  let ids: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    w = await createGoldenWorld();
    ids = await seed(w, { packingItem: false });
  });

  it("the report lists the lines under 0000 so the totals tie, and says which lines have no HSN", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnMissing.map((m) => [m.invoiceNumber, m.line, m.itemName, m.itemId === null])).toEqual([
      [ids.i2, 1, "Copper Wire", false],
      [ids.i2, 2, "Packing", true],
    ]);
    // the two missing-HSN lines are one 0000 row per rate: Copper Wire 18% (100.00), Packing 0% (10.00)
    expect(r.hsn.map((h) => [h.hsn, h.taxRate, h.taxableValue, h.cgst, h.sgst])).toEqual([
      ["0000", 0, 10, 0, 0],
      ["0000", 18, 100, 9, 9],
      ["730890", 5, 1000, 25, 25],
    ]);
    // taxable 1000 + 100 + 10 = 1110 = the invoices' subtotals (1000.00 + 110.00)
    expect(r.totalTaxableValue).toBe(1110);
  });

  it("the JSON export is refused with a message that lists the items and lines to fix", async () => {
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Cannot export GSTR-1 JSON for Jan 2026: 2 line(s) have no HSN code, and Table 12 cannot be filed with a made-up one. " +
        `To fix: add the HSN on these items: 'Copper Wire' (${ids.i2} line 1). ` +
        `Also these lines were typed in without an item and cannot carry an HSN: ${ids.i2} line 2 ('Packing'); bill a catalogue item with an HSN instead. ` +
        "The on-screen report and the CSV still show these lines under HSN 0000, flagged.",
    });
  });

  it("the CSV is not blocked: it flags the lines", async () => {
    const r = await w.caller.gst.gstr1CSV({ year: 2026, month: 1 });
    const lines = r.csv.split("\n");
    const at = lines.indexOf("HSN - Summary of Outward Supplies (Table 12)");
    expect(at).toBeGreaterThan(-1);
    const row = (...cells: string[]) => cells.map((c) => `"${c}"`).join(",");
    expect(lines.slice(at + 1, at + 8)).toEqual([
      row("WARNING: 2 line(s) have no HSN code and are filed under 0000, which is not a real HSN code. Fix them before filing"),
      row("NO HSN", ids.i2, "line 1", "Copper Wire", "item has no HSN: add it on the item"),
      row("NO HSN", ids.i2, "line 2", "Packing", "typed in without an item"),
      "HSN,Description,UQC,Quantity,Tax Rate %,Taxable Value,CGST,SGST,IGST,Cess,Total Value,Flag",
      row("0000", "Packing", "NOS", "1", "0", "10.00", "0.00", "0.00", "0.00", "0.00", "10.00", "NO HSN"),
      row("0000", "Copper Wire", "NOS", "2", "18", "100.00", "9.00", "9.00", "0.00", "0.00", "118.00", "NO HSN"),
      row("730890", "Steel Rods", "KGS", "10", "5", "1000.00", "25.00", "25.00", "0.00", "0.00", "1050.00", ""),
    ]);
  });

  it("fixing the item shrinks the list; the typed-in line still blocks the file", async () => {
    await w.caller.item.update({ id: ids.copper, data: { hsn: "7408" } });
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnMissing.map((m) => [m.invoiceNumber, m.line, m.itemName])).toEqual([[ids.i2, 2, "Packing"]]);
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 1 })).rejects.toThrow(
      `1 line(s) have no HSN code`,
    );
  });
});

describe("golden 21: GSTR-1 with an HSN on every line (world B)", () => {
  let w: GoldenWorld;

  beforeAll(async () => {
    w = await createGoldenWorld();
    await seed(w, { packingItem: true });
  });

  it("nothing is missing and the portal JSON is produced, with rt and the real UQC on every Table 12 row", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnMissing).toEqual([]);

    const j = await w.caller.gst.gstr1Json({ year: 2026, month: 1 });
    const hsn = (j.json as { hsn: { data: Array<Record<string, unknown>> } }).hsn.data;
    expect(hsn.map((h) => [h.num, h.hsn_sc, h.uqc, h.qty, h.rt, h.txval, h.camt, h.samt, h.iamt, h.csamt])).toEqual([
      [1, "3923", "NOS", 1, 0, 10, 0, 0, 0, 0],
      [2, "730890", "KGS", 10, 5, 1000, 25, 25, 0, 0],
      [3, "7408", "NOS", 2, 18, 100, 9, 9, 0, 0],
    ]);
  });
});
