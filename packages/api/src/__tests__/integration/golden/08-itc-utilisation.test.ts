/**
 * Scenario 8 — ITC utilisation journal (itc.recordUtilization).
 *
 * July 2025, all invoices at 18% GST, nothing paid:
 *   S1 sale, intra-state   20 x 1000.00 = 20000.00 + 3600.00 -> output CGST 1800 + SGST 1800
 *   S2 sale, inter-state    5 x 1000.00 =  5000.00 +  900.00 -> output IGST 900
 *   P1 purchase, intra     10 x 1000.00 = 10000.00 + 1800.00 -> input  CGST  900 + SGST  900
 *   P2 purchase, inter     10 x 1000.00 = 10000.00 + 1800.00 -> input  IGST 1800
 *   Receivable = 23600 + 5900 = 29500.   Payable = 11800 + 11800 = 23600.
 *
 * Utilisation for 2025-07 (IGST credit goes first against IGST, then CGST, SGST):
 *   IGST ITC 1800: 900 against IGST, 500 against CGST, 400 against SGST
 *   CGST ITC  900: against CGST          SGST ITC  900: against SGST
 * recordUtilization posts ONE system journal (dated when it is recorded):
 *   Dr 2100 900 / Cr 1510 900     (CGST on CGST)
 *   Dr 2101 900 / Cr 1511 900     (SGST on SGST)
 *   Dr 2102 900 / Cr 1512 900     (IGST on IGST)
 *   Dr 2100 500 / Cr 1512 500     (IGST on CGST)
 *   Dr 2101 400 / Cr 1512 400     (IGST on SGST)
 * Afterwards: Input GST accounts net to 0; output CGST 1800-1400 = 400,
 * SGST 1800-1300 = 500, IGST 900-900 = 0, i.e. 900 left to pay in cash
 * = 4500 output - 3600 ITC.
 *
 * The journal is dated `new Date()` (run time), so the books are read over ALL_TIME.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  book,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  tbBalance,
  fixed2,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

const PERIOD = "2025-07";
const UTILISATION = {
  returnPeriod: PERIOD,
  cgstUtilized: "900.00",
  sgstUtilized: "900.00",
  igstUtilizedAgainstIgst: "900.00",
  igstUtilizedAgainstCgst: "500.00",
  igstUtilizedAgainstSgst: "400.00",
};

async function seedJuly(w: GoldenWorld) {
  const [custMH, custKA, supMH, supKA] = await Promise.all([
    addParty(w, "customer", "MH"),
    addParty(w, "customer", "KA"),
    addParty(w, "supplier", "MH"),
    addParty(w, "supplier", "KA"),
  ]);
  const line = (qty: string) => [{ name: "Goods", qty, price: "1000.00", tax: "18" }];
  await addInvoice(w, "sale", custMH.id, line("20"), { date: "2025-07-04T10:00:00.000Z" });
  await addInvoice(w, "sale", custKA.id, line("5"), { date: "2025-07-06T10:00:00.000Z" });
  await addInvoice(w, "purchase", supMH.id, line("10"), { date: "2025-07-08T10:00:00.000Z" });
  await addInvoice(w, "purchase", supKA.id, line("10"), { date: "2025-07-10T10:00:00.000Z" });
}

describe("golden 08: ITC utilisation journal", () => {
  let w: GoldenWorld;
  let before: Book;
  let after: Book;
  let recordedBetween: [number, number];
  let result: Awaited<ReturnType<GoldenWorld["caller"]["itc"]["recordUtilization"]>>;

  beforeAll(async () => {
    w = await createGoldenWorld();
    await seedJuly(w);
    before = await book(w);

    const t0 = Date.now();
    result = await w.caller.itc.recordUtilization(UTILISATION);
    recordedBetween = [t0, Date.now()];
    after = await book(w);
  });

  it("before utilisation: ITC and output tax sit gross on their own accounts", () => {
    expect(tbRows(before)).toEqual([
      ["1100", "29500.00", "0.00"],
      ["1510", "900.00", "0.00"],
      ["1511", "900.00", "0.00"],
      ["1512", "1800.00", "0.00"],
      ["2000", "0.00", "23600.00"],
      ["2100", "0.00", "1800.00"],
      ["2101", "0.00", "1800.00"],
      ["2102", "0.00", "900.00"],
      ["4000", "0.00", "25000.00"],
      ["5000", "20000.00", "0.00"],
    ]);
    expectBooksBalance(before);
  });

  it("the ITC ledger shows the available credit for July", async () => {
    const dash = await w.caller.itc.dashboard({ returnPeriod: PERIOD });
    expect(dash.summary.available).toEqual({
      cgst: "900.00",
      sgst: "900.00",
      igst: "1800.00",
      cess: "0.00",
      total: "3600.00",
    });
  });

  it("recordUtilization stores the utilisation and posts one system journal of 10 lines", async () => {
    expect(result.utilization).toMatchObject({
      returnPeriod: PERIOD,
      cgstUtilized: "900.00",
      sgstUtilized: "900.00",
      igstUtilizedAgainstIgst: "900.00",
      igstUtilizedAgainstCgst: "500.00",
      igstUtilizedAgainstSgst: "400.00",
    });

    const entries = await w.caller.journal.list({});
    expect(entries).toHaveLength(1);
    const je = entries[0]!;
    expect(je.source).toBe("system");
    expect(je.narration).toBe("ITC utilization for return period 2025-07");
    expect(Number(je.lineCount)).toBe(10);
    // Debits 900 + 900 + 900 + 500 + 400 = 3600.
    expect(je.totalAmount).toBe("3600.00");
    // Dated at run time, not in the period it settles.
    const ts = je.entryDate.getTime();
    expect(ts).toBeGreaterThanOrEqual(recordedBetween[0] - 1000);
    expect(ts).toBeLessThanOrEqual(recordedBetween[1] + 1000);
  });

  it("after utilisation: Input GST nets to zero and 900 remains payable", () => {
    expect(tbRows(after)).toEqual([
      ["1100", "29500.00", "0.00"],
      ["1510", "900.00", "900.00"], // Cr: CGST ITC used
      ["1511", "900.00", "900.00"], // Cr: SGST ITC used
      ["1512", "1800.00", "1800.00"], // Cr: 900 + 500 + 400 IGST ITC used
      ["2000", "0.00", "23600.00"],
      ["2100", "1400.00", "1800.00"], // Dr: 900 CGST + 500 IGST
      ["2101", "1300.00", "1800.00"], // Dr: 900 SGST + 400 IGST
      ["2102", "900.00", "900.00"], // Dr: 900 IGST
      ["4000", "0.00", "25000.00"],
      ["5000", "20000.00", "0.00"],
    ]);
    // Debits 29500 + 900 + 900 + 1800 + 1400 + 1300 + 900 + 20000 = 56700;
    // credits 900 + 900 + 1800 + 23600 + 1800 + 1800 + 900 + 25000 = 56700.
    expect(after.tb.totalDebit).toBe("56700.00");
    expect(after.tb.totalCredit).toBe("56700.00");
    for (const code of ["1510", "1511", "1512", "2102"]) {
      expect(tbBalance(after, code)).toBe("0.00");
    }
    // 2100 / 2101 are credit balances: balance = debit - credit is negative.
    expect(tbBalance(after, "2100")).toBe("-400.00");
    expect(tbBalance(after, "2101")).toBe("-500.00");
  });

  it("P&L is untouched by utilisation (sales 25000 - purchases 20000)", () => {
    expect(plSummary(after)).toEqual({
      income: [["4000", "25000.00"]],
      expenses: [["5000", "20000.00"]],
      totalIncome: "25000.00",
      totalExpenses: "20000.00",
      grossProfit: "5000.00",
      netProfit: "5000.00",
    });
  });

  it("balance sheet: receivable 29500 = payables 23600 + GST due 900 + profit 5000", () => {
    expect(bsSummary(after)).toEqual({
      assets: [["1100", "29500.00"]],
      liabilities: [
        ["2000", "23600.00"],
        ["2100", "400.00"],
        ["2101", "500.00"],
      ],
      equity: [["9999", "5000.00"]],
      totalAssets: "29500.00",
      totalLiabilities: "24500.00",
      totalEquity: "5000.00",
    });
    expectBooksBalance(after);
  });

  it("GSTR-3B (Jul 2025): net tax 900 equals the GST left on the ledger after utilisation", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 7 });
    expect(fixed2(r.taxPayable.cgst)).toBe("1800.00");
    expect(fixed2(r.taxPayable.sgst)).toBe("1800.00");
    expect(fixed2(r.taxPayable.igst)).toBe("900.00");
    expect(fixed2(r.itc.cgst)).toBe("900.00");
    expect(fixed2(r.itc.sgst)).toBe("900.00");
    expect(fixed2(r.itc.igst)).toBe("1800.00");
    expect(fixed2(r.itc.total)).toBe("3600.00");
    // Per head: IGST -900 (credit left), CGST +900, SGST +900.
    expect(fixed2(r.netTax.igst)).toBe("-900.00");
    expect(fixed2(r.netTax.cgst)).toBe("900.00");
    expect(fixed2(r.netTax.sgst)).toBe("900.00");
    expect(fixed2(r.netTax.total)).toBe("900.00"); // = 400 CGST + 500 SGST on the ledger
  });

  it("utilising more than the available credit is rejected", async () => {
    const w2 = await createGoldenWorld();
    await seedJuly(w2);
    await expect(
      w2.caller.itc.recordUtilization({ ...UTILISATION, cgstUtilized: "900.01" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // BUG: recordUtilization upserts the utilisation row (unique per period) but ALWAYS
  // inserts a new journal, and the "available" ITC entries are never consumed, so
  // re-recording a period double-posts the credit: Input GST goes negative.
  it.fails("re-recording the same period is idempotent on the ledger (Input CGST stays at 0.00)", async () => {
    const w2 = await createGoldenWorld();
    await seedJuly(w2);
    await w2.caller.itc.recordUtilization(UTILISATION);
    await w2.caller.itc.recordUtilization(UTILISATION);
    const b2 = await book(w2);
    expect(tbBalance(b2, "1510")).toBe("0.00");
  });
});
