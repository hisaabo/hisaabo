/**
 * Scenario 22 — Date filters follow the business calendar (IST), whatever zone the client or the
 * server is in.
 *
 * The date pickers and presets ("This Month", "Last Month", "This FY", "Last FY", a custom range of
 * two days) turn into the half-open IST windows of @hisaabo/shared business-time and reach the API as
 * `fromDate` / `toDate` (the last millisecond before the next period). The API filters, the daybook
 * (date-only days), the sales trend's month and financial-year buckets all read the same calendar.
 * Before 0.10.1 the clients computed them in UTC (web, dashboard) or the browser's zone (web custom
 * range, mobile), and the daybook and the trend buckets used the server's / the database's zone, so
 * a document dated 1 Nov 03:00 IST (2026-10-31T21:30Z) fell into October.
 *
 * "Now" is 2026-11-15T09:00:00Z (14:30 IST). Seven sales of 1 x price at 0% GST (IST in brackets):
 *   A  2026-10-31T18:29:59.500Z  [31 Oct 23:59:59.500]   price  1.00   October
 *   B  2026-10-31T18:30:00.000Z  [ 1 Nov 00:00:00.000]   price  2.00   November
 *   C  2026-10-31T21:30:00.000Z  [ 1 Nov 03:00]          price  4.00   November (the founder's example)
 *   D  2026-11-30T18:29:59.500Z  [30 Nov 23:59:59.500]   price  8.00   November
 *   E  2026-11-30T18:30:00.000Z  [ 1 Dec 00:00:00.000]   price 16.00   December
 *   F  2026-03-31T18:29:59.500Z  [31 Mar 23:59:59.500]   price 32.00   FY 2025-26
 *   G  2026-03-31T18:30:00.000Z  [ 1 Apr 00:00:00.000]   price 64.00   FY 2026-27
 *
 *   This Month (Nov)         = B, C, D          Last Month (Oct) = A
 *   This FY (1 Apr .. today) = A, B, C, G       (D and E are after today; F is last FY)
 *   Last FY (FY 2025-26)     = F
 *   Custom 1 Nov..30 Nov     = B, C, D          Custom 31 Oct..31 Oct = A
 *   Daybook, date-only "2026-11-01".."2026-11-30" = B, C, D
 *   Tally export file name for This FY: tally-export-2026-04-01-to-2026-11-15.xml
 *   Trial balance default year: as of G's instant (1 Apr 00:00 IST) sales are G = 64.00; one ms earlier F = 32.00
 *   Sales trend, months (IST) Oct, Nov: invoiced 1.00 and 2.00 + 4.00 + 8.00 = 14.00
 *   Sales trend, financial years: FY 2026 = A + B + C + D + E + G = 1 + 2 + 4 + 8 + 16 + 64 = 95.00; FY 2025 = F = 32.00
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveDatePreset, resolveDayRange, windowToQuery } from "@hisaabo/shared";
import { useGoldenDb, createGoldenWorld, addInvoice, addParty, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const NOW = new Date("2026-11-15T09:00:00.000Z");

const DOCS = {
  A: ["2026-10-31T18:29:59.500Z", "1.00"],
  B: ["2026-10-31T18:30:00.000Z", "2.00"],
  C: ["2026-10-31T21:30:00.000Z", "4.00"],
  D: ["2026-11-30T18:29:59.500Z", "8.00"],
  E: ["2026-11-30T18:30:00.000Z", "16.00"],
  F: ["2026-03-31T18:29:59.500Z", "32.00"],
  G: ["2026-03-31T18:30:00.000Z", "64.00"],
} as const;
type Key = keyof typeof DOCS;

describe("golden 22: date ranges on the IST calendar", () => {
  let w: GoldenWorld;
  const number: Record<Key, string> = {} as never;
  const keyOf = (invoiceNumber: string) => (Object.keys(number) as Key[]).find((k) => number[k] === invoiceNumber);

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = (await addParty(w, "customer", "MH")).id;
    for (const [k, [date, price]] of Object.entries(DOCS) as Array<[Key, readonly [string, string]]>) {
      const inv = await addInvoice(w, "sale", customer, [{ name: "Goods", qty: "1", price, tax: "0" }], { date });
      number[k] = inv.invoiceNumber;
    }
  });

  async function listed(range: { fromDate?: string; toDate?: string }): Promise<string> {
    const r = await w.caller.invoice.list({ ...range, page: 1, limit: 100 });
    return r.data.map((i) => keyOf(i.invoiceNumber)).sort().join("");
  }

  describe("invoice list with the preset windows", () => {
    it("This Month (November): B C D", async () => {
      expect(await listed(windowToQuery(resolveDatePreset("this-month", NOW)))).toBe("BCD");
    });

    it("Last Month (October): A", async () => {
      expect(await listed(windowToQuery(resolveDatePreset("last-month", NOW)))).toBe("A");
    });

    it("This FY (1 April through today): A B C G", async () => {
      expect(await listed(windowToQuery(resolveDatePreset("this-fy", NOW)))).toBe("ABCG");
    });

    it("Last FY (FY 2025-26): F", async () => {
      expect(await listed(windowToQuery(resolveDatePreset("last-fy", NOW)))).toBe("F");
    });

    it("a custom range of two picked days: 1 Nov to 30 Nov is B C D, 31 Oct alone is A", async () => {
      expect(await listed(windowToQuery(resolveDayRange("2026-11-01", "2026-11-30")))).toBe("BCD");
      expect(await listed(windowToQuery(resolveDayRange("2026-10-31", "2026-10-31")))).toBe("A");
      expect(await listed(windowToQuery(resolveDayRange("2026-12-01", "2026-12-01")))).toBe("E");
    });

    it("the exact edges: 23:59:59.500 IST on the last day is in the month, 00:00:00.000 IST on the 1st is in the next", async () => {
      const nov = windowToQuery(resolveDatePreset("this-month", NOW));
      expect(nov).toEqual({ fromDate: "2026-10-31T18:30:00.000Z", toDate: "2026-11-30T18:29:59.999Z" });
      expect((await listed(nov)).includes("D")).toBe(true); // 30 Nov 23:59:59.500 IST
      expect((await listed(nov)).includes("E")).toBe(false); // 1 Dec 00:00:00.000 IST
      expect((await listed(nov)).includes("B")).toBe(true); // 1 Nov 00:00:00.000 IST
      expect((await listed(nov)).includes("A")).toBe(false); // 31 Oct 23:59:59.500 IST
    });
  });

  describe("the daybook takes whole IST days", () => {
    it('"2026-11-01" to "2026-11-30" is B C D', async () => {
      const r = await w.caller.reports.daybook({ fromDate: "2026-11-01", toDate: "2026-11-30" });
      const numbers = r.entries.filter((e) => e.number).map((e) => keyOf(e.number as string)).sort().join("");
      expect(numbers).toBe("BCD");
    });
  });

  describe("the Tally export file name carries the IST days of the range", () => {
    it("This FY (1 Apr 00:00 IST .. end of 15 Nov IST) is tally-export-2026-04-01-to-2026-11-15.xml, not 2026-03-31", async () => {
      const q = windowToQuery(resolveDatePreset("this-fy", NOW));
      const r = await w.caller.reports.tallyExport({ fromDate: q.fromDate!, toDate: q.toDate! });
      expect(r.filename).toBe("tally-export-2026-04-01-to-2026-11-15.xml");
    });
  });

  describe("the books year (trial balance default) starts at 00:00 IST on 1 April", () => {
    it("as of 1 Apr 00:00:00.000 IST the default year is FY 2026-27: sales are G (64.00) only, not F + G", async () => {
      const tb = await w.caller.reports.trialBalance({ asOfDate: "2026-03-31T18:30:00.000Z" });
      expect(tb.accounts.find((a) => a.accountCode === "4000")?.credit).toBe("64.00");
    });

    it("one millisecond earlier it is still FY 2025-26: sales are F (32.00) only", async () => {
      const tb = await w.caller.reports.trialBalance({ asOfDate: "2026-03-31T18:29:59.999Z" });
      expect(tb.accounts.find((a) => a.accountCode === "4000")?.credit).toBe("32.00");
    });
  });

  describe("the sales trend buckets", () => {
    it("months start at 00:00 IST on the 1st: October holds A, November holds B + C + D", async () => {
      const r = await w.caller.dashboard.salesTrend({
        months: 6,
        granularity: "month",
        fromDate: "2026-09-30T18:30:00.000Z", // 1 Oct 00:00 IST
        toDate: "2026-11-30T18:29:59.999Z", // the last millisecond of 30 Nov IST
      });
      expect(r.map((b) => [b.period, b.invoiced])).toEqual([
        ["2026-09-30T18:30:00.000Z", "1.00"], // October
        ["2026-10-31T18:30:00.000Z", "14.00"], // November: 2 + 4 + 8
      ]);
    });

    it("financial years change at 00:00 IST on 1 April: G (1 Apr 00:00 IST) is in FY 2026, F (31 Mar 23:59:59.500) in FY 2025", async () => {
      const r = await w.caller.dashboard.salesTrend({ months: 6, granularity: "fy" });
      expect(r.map((b) => [b.period, b.invoiced])).toEqual([
        ["2025", "32.00"], // oldest first
        ["2026", "95.00"],
      ]);
    });
  });
});
