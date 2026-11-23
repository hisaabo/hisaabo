/**
 * GSTR-1 sections and totals use ONE basis: every CGST / SGST figure is a sum of
 * per-LINE splits (CGST = round-half-up(line tax / 2), SGST = the remainder, the
 * e-invoice rule), so the B2B rows + B2CS rows add up to the invoice totals, and the
 * HSN rows add up to the totals, head by head. Hand-computed.
 *
 * October 2025, intra-state (Maharashtra), 18% GST, items without HSN (all in "0000"):
 *   Invoice A  (customer WITH a GSTIN -> B2B):  two lines of 1 x 0.05 -> tax 0.01 + 0.01 = 0.02
 *       per line CGST 0.01 / SGST 0.00 each -> CGST 0.02, SGST 0.00
 *       (one split of the 0.02 would have been 0.01 / 0.01)
 *   Invoice B  (customer WITHOUT a GSTIN -> B2CS): 1 x 0.05 (tax 0.01) and 1 x 0.17 (tax 0.03)
 *       0.17 x 18% = 0.0306 -> 0.03.  Per line: 0.01 -> 0.01 / 0.00 ; 0.03 -> 0.02 / 0.01
 *       -> CGST 0.03, SGST 0.01
 *   Totals: CGST 0.02 + 0.03 = 0.05 ; SGST 0.00 + 0.01 = 0.01 ; tax 0.06.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  fixed2,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const DATE = "2025-10-15T10:00:00.000Z";
const cents = (n: number) => Math.round(n * 100);

describe("GSTR-1: B2B, B2CS, HSN and the totals tie on the per-line basis", () => {
  let w: GoldenWorld;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const registered = await w.caller.party.create({
      type: "customer",
      name: "Registered Buyer",
      state: "Maharashtra",
      stateCode: "27",
      gstin: "27AAPFU0939F1ZV",
      openingBalance: "0",
    });
    const unregistered = await addParty(w, "customer", "MH");
    await addInvoice(
      w,
      "sale",
      registered.id,
      [
        { name: "Tiny 1", qty: "1", price: "0.05", tax: "18" },
        { name: "Tiny 2", qty: "1", price: "0.05", tax: "18" },
      ],
      { date: DATE },
    );
    await addInvoice(
      w,
      "sale",
      unregistered.id,
      [
        { name: "Tiny 3", qty: "1", price: "0.05", tax: "18" },
        { name: "Tiny 4", qty: "1", price: "0.17", tax: "18" },
      ],
      { date: DATE },
    );
  });

  it("totals: CGST 0.05, SGST 0.01, tax 0.06", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    expect(fixed2(r.totalCgst)).toBe("0.05");
    expect(fixed2(r.totalSgst)).toBe("0.01");
    expect(fixed2(r.totalTax)).toBe("0.06");
  });

  it("the B2B invoice row is the sum of its two line splits: CGST 0.02 / SGST 0.00", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    expect(r.b2b).toHaveLength(1);
    expect([r.b2b[0]!.cgst, r.b2b[0]!.sgst, r.b2b[0]!.igst]).toEqual([0.02, 0, 0]);
  });

  it("the B2CS row (18%) is the sum of invoice B's line splits: CGST 0.03 / SGST 0.01", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    expect(r.b2cSmall).toHaveLength(1);
    expect([r.b2cSmall[0]!.taxRate, r.b2cSmall[0]!.cgst, r.b2cSmall[0]!.sgst]).toEqual([18, 0.03, 0.01]);
  });

  it("B2B + B2CS add up to the totals head by head", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    const sum = (k: "cgst" | "sgst") =>
      r.b2b.reduce((a, x) => a + cents(x[k]), 0) + r.b2cSmall.reduce((a, x) => a + cents(x[k]), 0);
    expect(sum("cgst")).toBe(cents(r.totalCgst));
    expect(sum("sgst")).toBe(cents(r.totalSgst));
  });

  it("the HSN rows add up to the totals head by head (all four lines are in HSN 0000)", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    expect(r.hsn).toHaveLength(1);
    expect([r.hsn[0]!.cgst, r.hsn[0]!.sgst]).toEqual([0.05, 0.01]);
    expect(r.hsn.reduce((a, x) => a + cents(x.cgst), 0)).toBe(cents(r.totalCgst));
    expect(r.hsn.reduce((a, x) => a + cents(x.sgst), 0)).toBe(cents(r.totalSgst));
  });

  it("GSTR-3B output tax and the ledger agree with GSTR-1 to the paisa", async () => {
    const r3 = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect([fixed2(r3.taxPayable.cgst), fixed2(r3.taxPayable.sgst)]).toEqual(["0.05", "0.01"]);
    const tb = await w.caller.reports.trialBalance({
      fromDate: "2025-04-01T00:00:00.000Z",
      asOfDate: "2026-03-31T23:59:59.999Z",
    });
    const credit = (code: string) => tb.accounts.find((a) => a.accountCode === code)?.credit;
    expect([credit("2100"), credit("2101")]).toEqual(["0.05", "0.01"]);
  });
});
