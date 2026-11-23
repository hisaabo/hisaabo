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
import { eq } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
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

/**
 * An HSN that is present but cannot be filed blocks the JSON export too: not 4 to 8 digits, or too
 * short for the business's turnover (4 digits up to and including ₹5,00,00,000, 6 above): the rule
 * and the per-line wording of the e-invoice (`lib/hsn-check.ts`). Separators are dropped first
 * ("7306.90" is filed as 730690). The report lists them in `hsnInvalid` and flags their Table 12
 * rows; the CSV flags them; Table 12 keeps the code as stored.
 *
 * World C (January 2026, Maharashtra, B2B buyer), turnover unknown (4-digit minimum):
 *   I1  Good    (HSN 730890) 1 kg x 100.00 @ 5%     taxable 100.00  CGST 2.50 + SGST 2.50   fine
 *   I2  Short   (HSN 730)    1 x 50.00 @ 18%        taxable  50.00  CGST 4.50 + SGST 4.50   3 digits
 *       Letters (HSN 73AB)   1 x 20.00 @ 0%         taxable  20.00                          not digits
 *   I3  Dotted  (HSN 7306.90) 1 x 30.00 @ 12%       taxable  30.00  CGST 1.80 + SGST 1.80   filed as 730690
 *
 * World D: Four (5208), Six (730890), Eight (73069000), 1 x 100.00 each at 5%:
 *   turnover 50000000.00 (exactly ₹5 Cr): nothing invalid; 50000000.01: only Four is invalid.
 */
describe("golden 21: GSTR-1 with an HSN that cannot be filed (world C)", () => {
  let w: GoldenWorld;
  let i2: string;
  const short = { id: "" };
  const letters = { id: "" };

  beforeAll(async () => {
    w = await createGoldenWorld();
    const good = (await w.caller.item.create({ name: "Good", hsn: "730890", unit: "kg", taxPercent: "5" })).id;
    short.id = (await w.caller.item.create({ name: "Short", hsn: "730", unit: "pcs", taxPercent: "18" })).id;
    letters.id = (await w.caller.item.create({ name: "Letters", hsn: "73AB", unit: "pcs", taxPercent: "0" })).id;
    const dotted = (await w.caller.item.create({ name: "Dotted", hsn: "7306.90", unit: "pcs", taxPercent: "12" })).id;
    const buyer = (await w.caller.party.create({
      type: "customer", name: "B2B Maharashtra", state: "Maharashtra", stateCode: "27", gstin: "27AABCM0000R1ZM", openingBalance: "0",
    })).id;
    await addInvoice(w, "sale", buyer, [{ name: "Good", itemId: good, qty: "1", price: "100.00", tax: "5" }], { date: DATE("10") });
    i2 = (await addInvoice(w, "sale", buyer, [
      { name: "Short", itemId: short.id, qty: "1", price: "50.00", tax: "18" },
      { name: "Letters", itemId: letters.id, qty: "1", price: "20.00", tax: "0" },
    ], { date: DATE("11") })).invoiceNumber;
    await addInvoice(w, "sale", buyer, [{ name: "Dotted", itemId: dotted, qty: "1", price: "30.00", tax: "12" }], { date: DATE("12") });
  });

  it("the report lists the unusable codes per line, flags their rows, and files a dotted code as digits", async () => {
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnMissing).toEqual([]);
    expect(r.hsnInvalid).toEqual([
      { invoiceNumber: i2, line: 1, itemName: "Short", itemId: short.id, hsn: "730", problem: "line 1 'Short' has HSN code '730', which is not 4 to 8 digits; correct it on the item" },
      { invoiceNumber: i2, line: 2, itemName: "Letters", itemId: letters.id, hsn: "73AB", problem: "line 2 'Letters' has HSN code '73AB', which is not 4 to 8 digits; correct it on the item" },
    ]);
    expect(r.hsn.map((h) => [h.hsn, h.taxableValue, h.hsnFlag])).toEqual([
      ["730", 50, "invalid"],
      ["730690", 30, null], // "7306.90" filed as digits
      ["730890", 100, null],
      ["73AB", 20, "invalid"],
    ]);
    expect(r.totalTaxableValue).toBe(200); // 100 + 50 + 20 + 30: the figures still tie
  });

  it("the JSON export is refused with the per-line message of the e-invoice", async () => {
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Cannot export GSTR-1 JSON for Jan 2026: 2 line(s) have a missing or unusable HSN code (0 missing, 2 invalid or too short for the turnover), and Table 12 cannot be filed with a made-up or invalid one. " +
        `To fix: these lines have an HSN code that cannot be filed: ${i2} line 1 'Short' has HSN code '730', which is not 4 to 8 digits; correct it on the item; ` +
        `${i2} line 2 'Letters' has HSN code '73AB', which is not 4 to 8 digits; correct it on the item. ` +
        "The on-screen report and the CSV still show these lines, flagged (missing ones under HSN 0000).",
    });
  });

  it("the CSV flags them and is not blocked", async () => {
    const r = await w.caller.gst.gstr1CSV({ year: 2026, month: 1 });
    const lines = r.csv.split("\n");
    const at = lines.indexOf("HSN - Summary of Outward Supplies (Table 12)");
    expect(at).toBeGreaterThan(-1);
    const row = (...cells: string[]) => cells.map((c) => `"${c}"`).join(",");
    expect(lines.slice(at + 1, at + 9)).toEqual([
      row("WARNING: 2 line(s) have an HSN code that cannot be filed (not 4 to 8 digits, or too short for the turnover). Fix them before filing"),
      row("INVALID HSN", i2, "line 1", "Short", "730", "line 1 'Short' has HSN code '730', which is not 4 to 8 digits; correct it on the item"),
      row("INVALID HSN", i2, "line 2", "Letters", "73AB", "line 2 'Letters' has HSN code '73AB', which is not 4 to 8 digits; correct it on the item"),
      "HSN,Description,UQC,Quantity,Tax Rate %,Taxable Value,CGST,SGST,IGST,Cess,Total Value,Flag",
      row("730", "Short", "NOS", "1", "18", "50.00", "4.50", "4.50", "0.00", "0.00", "59.00", "INVALID HSN"),
      row("730690", "Dotted", "NOS", "1", "12", "30.00", "1.80", "1.80", "0.00", "0.00", "33.60", ""),
      row("730890", "Good", "KGS", "1", "5", "100.00", "2.50", "2.50", "0.00", "0.00", "105.00", ""),
      row("73AB", "Letters", "NOS", "1", "0", "20.00", "0.00", "0.00", "0.00", "0.00", "20.00", "INVALID HSN"),
    ]);
  });

  it("correcting the items unblocks the file", async () => {
    await w.caller.item.update({ id: short.id, data: { hsn: "7308" } });
    await w.caller.item.update({ id: letters.id, data: { hsn: "73081000" } });
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnInvalid).toEqual([]);
    const j = await w.caller.gst.gstr1Json({ year: 2026, month: 1 });
    const hsn = (j.json as { hsn: { data: Array<Record<string, unknown>> } }).hsn.data;
    expect(hsn.map((h) => h.hsn_sc)).toEqual(["730690", "7308", "73081000", "730890"]);
  });
});

describe("golden 21: the digit minimum by turnover blocks the file, exactly (world D)", () => {
  let w: GoldenWorld;
  let fourInvoice: string;
  const setTurnover = (annualTurnover: string | null) =>
    getTenantTestDb().update(businesses).set({ annualTurnover }).where(eq(businesses.id, w.businessId));

  beforeAll(async () => {
    w = await createGoldenWorld();
    const mk = async (name: string, hsn: string) => (await w.caller.item.create({ name, hsn, unit: "pcs", taxPercent: "5" })).id;
    const four = await mk("Four", "5208");
    const six = await mk("Six", "730890");
    const eight = await mk("Eight", "73069000");
    const buyer = (await w.caller.party.create({
      type: "customer", name: "B2B Maharashtra", state: "Maharashtra", stateCode: "27", gstin: "27AABCM0000R1ZM", openingBalance: "0",
    })).id;
    fourInvoice = (await addInvoice(w, "sale", buyer, [{ name: "Four", itemId: four, qty: "1", price: "100.00", tax: "5" }], { date: DATE("10") })).invoiceNumber;
    await addInvoice(w, "sale", buyer, [{ name: "Six", itemId: six, qty: "1", price: "100.00", tax: "5" }], { date: DATE("11") });
    await addInvoice(w, "sale", buyer, [{ name: "Eight", itemId: eight, qty: "1", price: "100.00", tax: "5" }], { date: DATE("12") });
  });

  it.each([null, "49999999.99", "50000000.00"])("turnover %j: a 4-digit HSN is fine and the file is produced", async (turnover) => {
    await setTurnover(turnover);
    expect((await w.caller.gst.gstr1({ year: 2026, month: 1 })).hsnInvalid).toEqual([]);
    const j = await w.caller.gst.gstr1Json({ year: 2026, month: 1 });
    expect(((j.json as { hsn: { data: unknown[] } }).hsn.data)).toHaveLength(3);
  });

  it("turnover 50000000.01, one paisa above ₹5 Cr: only the 4-digit code is unusable and the file is refused", async () => {
    await setTurnover("50000000.01");
    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnInvalid.map((m) => [m.invoiceNumber, m.line, m.hsn])).toEqual([[fourInvoice, 1, "5208"]]);
    expect(r.hsn.map((h) => [h.hsn, h.hsnFlag])).toEqual([["5208", "invalid"], ["73069000", null], ["730890", null]]);
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 1 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(
        `${fourInvoice} line 1 'Four' has HSN code '5208': Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has 4 digits.`,
      ),
    });
  });
});

/**
 * An all-zero HSN ("0000", "000000") is the stand-in for a missing code, not a code: the line is in
 * `hsnMissing`, filed under 0000 and flagged, and the JSON export is refused.
 */
describe("golden 21: an item whose HSN is all zeros counts as missing", () => {
  it("0000 and 000000 are missing; 0101 is a code", async () => {
    const w = await createGoldenWorld();
    const mk = async (name: string, hsn: string) => (await w.caller.item.create({ name, hsn, unit: "pcs", taxPercent: "0" })).id;
    const z4 = await mk("Zero4", "0000");
    const z6 = await mk("Zero6", "000000");
    const ok = await mk("Fine", "0101");
    const buyer = (await w.caller.party.create({
      type: "customer", name: "B2B Maharashtra", state: "Maharashtra", stateCode: "27", gstin: "27AABCM0000R1ZM", openingBalance: "0",
    })).id;
    const inv = await addInvoice(w, "sale", buyer, [
      { name: "Zero4", itemId: z4, qty: "1", price: "10.00", tax: "0" },
      { name: "Zero6", itemId: z6, qty: "1", price: "20.00", tax: "0" },
      { name: "Fine", itemId: ok, qty: "1", price: "30.00", tax: "0" },
    ], { date: DATE("10") });

    const r = await w.caller.gst.gstr1({ year: 2026, month: 1 });
    expect(r.hsnMissing.map((m) => [m.invoiceNumber, m.line, m.itemName])).toEqual([[inv.invoiceNumber, 1, "Zero4"], [inv.invoiceNumber, 2, "Zero6"]]);
    expect(r.hsnInvalid).toEqual([]);
    expect(r.hsn.map((h) => [h.hsn, h.taxableValue, h.hsnFlag])).toEqual([["0000", 30, "missing"], ["0101", 30, null]]);
    await expect(w.caller.gst.gstr1Json({ year: 2026, month: 1 })).rejects.toThrow("2 line(s) have no HSN code");
  });
});

