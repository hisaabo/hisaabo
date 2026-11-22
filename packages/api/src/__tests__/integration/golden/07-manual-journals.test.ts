/**
 * Scenario 7 — Manual journals: capital introduced, equipment bought,
 * depreciation; then the depreciation journal is voided.
 *
 *   J1 2025-04-02  Capital introduced   Dr 1010 Bank 500000.00 / Cr 3000 Capital 500000.00
 *   J2 2025-04-10  Equipment bought     Dr 1500 Fixed Assets 120000.00 / Cr 1010 Bank 120000.00
 *   J3 2026-03-31  Depreciation 10%     Dr 5900 Depreciation 12000.00 / Cr 1500 Fixed Assets 12000.00
 *        (10% x 120000.00 = 12000.00)
 *
 *   Voiding J3 does NOT delete anything: journal.void marks J3 voided and adds a
 *   reversing entry (same date, debits and credits swapped). Both stay in the
 *   ledger, so gross debits/credits grow but every account nets back to its
 *   pre-J3 position and profit returns to zero.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  book,
  fy,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  tbBalance,
  cashFlow,
  expectCashFlowReconciles,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 07: manual journals and void", () => {
  let w: GoldenWorld;
  let j3Id: string;
  let beforeVoid: Book;
  let afterVoid: Book;
  let voidResult: Awaited<ReturnType<GoldenWorld["caller"]["journal"]["void"]>>;
  let cfBeforeVoid: Awaited<ReturnType<typeof cashFlow>>;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const a = w.accounts;

    await w.caller.journal.create({
      entryDate: "2025-04-02T10:00:00.000Z",
      narration: "Capital introduced by proprietor",
      lines: [
        { accountId: a["1010"]!, debit: "500000.00", credit: "0" },
        { accountId: a["3000"]!, debit: "0", credit: "500000.00" },
      ],
    });
    await w.caller.journal.create({
      entryDate: "2025-04-10T10:00:00.000Z",
      narration: "Equipment purchased",
      lines: [
        { accountId: a["1500"]!, debit: "120000.00", credit: "0" },
        { accountId: a["1010"]!, debit: "0", credit: "120000.00" },
      ],
    });
    const j3 = await w.caller.journal.create({
      entryDate: "2026-03-31T10:00:00.000Z",
      narration: "Depreciation FY 2025-26",
      lines: [
        { accountId: a["5900"]!, debit: "12000.00", credit: "0" },
        { accountId: a["1500"]!, debit: "0", credit: "12000.00" },
      ],
    });
    j3Id = j3.id;
    beforeVoid = await book(w);
    cfBeforeVoid = await cashFlow(w);

    voidResult = await w.caller.journal.void({ id: j3Id });
    afterVoid = await book(w);
  });

  describe("before the void", () => {
    it("trial balance", () => {
      expect(tbRows(beforeVoid)).toEqual([
        ["1010", "500000.00", "120000.00"],
        ["1500", "120000.00", "12000.00"],
        ["3000", "0.00", "500000.00"],
        ["5900", "12000.00", "0.00"],
      ]);
      // Debits 500000 + 120000 + 12000 = 632000; credits 120000 + 12000 + 500000 = 632000.
      expect(beforeVoid.tb.totalDebit).toBe("632000.00");
      expect(beforeVoid.tb.totalCredit).toBe("632000.00");
    });

    it("P&L: depreciation is the only expense", () => {
      expect(plSummary(beforeVoid)).toEqual({
        income: [],
        expenses: [["5900", "12000.00"]],
        totalIncome: "0.00",
        totalExpenses: "12000.00",
        grossProfit: "0.00", // depreciation is not a direct cost
        netProfit: "-12000.00",
      });
    });

    it("balance sheet: assets 488000 = capital 500000 - loss 12000", () => {
      expect(bsSummary(beforeVoid)).toEqual({
        assets: [
          ["1010", "380000.00"], // 500000 - 120000
          ["1500", "108000.00"], // 120000 - 12000
        ],
        liabilities: [],
        equity: [
          ["3000", "500000.00"],
          ["9999", "-12000.00"],
        ],
        totalAssets: "488000.00",
        totalLiabilities: "0.00",
        totalEquity: "488000.00",
      });
      expectBooksBalance(beforeVoid);
    });
  });

  describe("after voiding the depreciation journal", () => {
    it("journal.void returns the voided entry and a same-dated reversing entry", async () => {
      expect(voidResult.voidedEntry.id).toBe(j3Id);
      expect(voidResult.reversingEntry.reversesEntryId).toBe(j3Id);
      expect(voidResult.reversingEntry.entryDate.toISOString()).toBe("2026-03-31T10:00:00.000Z");

      const original = await w.caller.journal.getById({ id: j3Id });
      expect(original.isVoided).toBe(true);
      expect(original.voidedByEntryId).toBe(voidResult.reversingEntry.id);

      const reversal = await w.caller.journal.getById({ id: voidResult.reversingEntry.id });
      // Debits and credits are swapped: Dr 1500 12000 / Cr 5900 12000.
      expect(
        reversal.lines.map((l) => [l.accountCode, l.debit, l.credit]).sort(),
      ).toEqual([
        ["1500", "12000.00", "0.00"],
        ["5900", "0.00", "12000.00"],
      ]);
    });

    it("trial balance: original and reversal both stay; depreciation nets to zero", () => {
      expect(tbRows(afterVoid)).toEqual([
        ["1010", "500000.00", "120000.00"],
        ["1500", "132000.00", "12000.00"], // 120000 + 12000 reversal debit
        ["3000", "0.00", "500000.00"],
        ["5900", "12000.00", "12000.00"], // original Dr + reversal Cr
      ]);
      // Debits 500000 + 132000 + 12000 = 644000; credits 120000 + 12000 + 500000 + 12000 = 644000.
      expect(afterVoid.tb.totalDebit).toBe("644000.00");
      expect(afterVoid.tb.totalCredit).toBe("644000.00");
      expect(tbBalance(afterVoid, "5900")).toBe("0.00");
      expect(tbBalance(afterVoid, "1500")).toBe("120000.00");
    });

    it("P&L is back to zero", () => {
      expect(plSummary(afterVoid)).toEqual({
        income: [],
        expenses: [["5900", "0.00"]],
        totalIncome: "0.00",
        totalExpenses: "0.00",
        grossProfit: "0.00",
        netProfit: "0.00",
      });
    });

    it("balance sheet is back to the pre-depreciation position", () => {
      expect(bsSummary(afterVoid)).toEqual({
        assets: [
          ["1010", "380000.00"],
          ["1500", "120000.00"],
        ],
        liabilities: [],
        equity: [
          ["3000", "500000.00"],
          ["9999", "0.00"],
        ],
        totalAssets: "500000.00",
        totalLiabilities: "0.00",
        totalEquity: "500000.00",
      });
      expectBooksBalance(afterVoid);
    });

    it("the general ledger for 5900 has the debit and the reversing credit, closing at zero", async () => {
      const range = fy(2025);
      const gl = await w.caller.reports.generalLedger({
        accountId: w.accounts["5900"]!,
        fromDate: range.from,
        toDate: range.to,
      });
      expect(gl.entries.map((e) => [e.debit, e.credit]).sort()).toEqual([
        ["0.00", "12000.00"],
        ["12000.00", "0.00"],
      ]);
      expect(gl.closingBalance).toBe("0.00");
    });

    it("an entry can be voided only once, and a voided entry cannot be edited", async () => {
      await expect(w.caller.journal.void({ id: j3Id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Journal entry is already voided",
      });
      await expect(
        w.caller.journal.update({ id: j3Id, narration: "too late" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cannot update a voided journal entry" });
    });
  });

  it("cash-flow statement: 380000 net cash before and after the void", async () => {
    // Depreciation is added back in operating and excluded from investing, so voiding
    // it changes neither the net cash flow nor the investing / financing sections.
    const expectedInvesting = {
      items: [{ description: "Purchase of Fixed Assets", amount: "-120000.00" }],
      totalInvesting: "-120000.00",
    };
    const expectedFinancing = {
      items: [{ description: "Capital Contributed", amount: "500000.00" }],
      totalFinancing: "500000.00",
    };

    // Before the void: net income -12000 is offset by the +12000 depreciation add-back.
    expect(cfBeforeVoid.operating).toEqual({
      netIncome: "-12000.00",
      adjustments: [{ description: "Add: Depreciation", amount: "12000.00" }],
      workingCapitalChanges: [],
      totalOperating: "0.00",
    });
    expect(cfBeforeVoid.investing).toEqual(expectedInvesting);
    expect(cfBeforeVoid.financing).toEqual(expectedFinancing);
    expect(cfBeforeVoid.netCashFlow).toBe("380000.00");
    expectCashFlowReconciles(cfBeforeVoid, beforeVoid);

    // After the void: no profit, no add-back.
    const cfAfter = await cashFlow(w);
    expect(cfAfter.operating).toEqual({
      netIncome: "0.00",
      adjustments: [],
      workingCapitalChanges: [],
      totalOperating: "0.00",
    });
    expect(cfAfter.investing).toEqual(expectedInvesting);
    expect(cfAfter.financing).toEqual(expectedFinancing);
    expect(cfAfter.netCashFlow).toBe("380000.00");
    expectCashFlowReconciles(cfAfter, afterVoid);
  });

  it("an unbalanced journal is rejected", async () => {
    await expect(
      w.caller.journal.create({
        entryDate: "2025-05-01T10:00:00.000Z",
        lines: [
          { accountId: w.accounts["1000"]!, debit: "100.00", credit: "0" },
          { accountId: w.accounts["3000"]!, debit: "0", credit: "90.00" },
        ],
      }),
    ).rejects.toThrow(/balanced/);
  });
});
