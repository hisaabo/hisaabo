/**
 * business-time.ts: dates and date ranges on the business (IST, UTC+05:30) calendar.
 *
 * Every expectation is a literal worked out by hand: IST midnight of a day is 18:30 UTC of the
 * day before. The results must not depend on the TZ of the machine, so CI runs this file under
 * TZ=UTC, TZ=Asia/Kolkata and TZ=America/Los_Angeles (see the date-range runbook in the golden README).
 */
import { describe, it, expect } from "vitest";
import {
  businessDateOf,
  businessDateParts,
  businessDayStart,
  businessMonthStart,
  businessTimeOfDayMs,
  businessInstant,
  addMonthsClampedYmd,
  businessMonthWindow,
  businessFinancialYearWindow,
  businessFinancialYearStartYear,
  addDaysYmd,
  parseYmd,
  resolveDatePreset,
  resolveDayRange,
  windowToQuery,
  pickedDateToISO,
  pickedDateToEndISO,
  formatBusinessDate,
  formatBusinessDateShort,
  formatBusinessMonthYearShort,
  formatBusinessDateSlashes,
  type DateWindow,
  type DatePresetKey,
} from "../business-time.js";

const iso = (d: Date) => d.toISOString();
const inWindow = (w: Partial<DateWindow>, instant: string) => {
  const t = new Date(instant).getTime();
  return (w.from === undefined || t >= w.from.getTime()) && (w.before === undefined || t < w.before.getTime());
};

describe("the calendar day of an instant is the IST day", () => {
  it.each([
    ["2026-10-31T18:29:59.999Z", "2026-10-31"], // 23:59:59.999 IST on 31 Oct
    ["2026-10-31T18:30:00.000Z", "2026-11-01"], // 00:00:00.000 IST on 1 Nov
    ["2026-10-31T21:30:00.000Z", "2026-11-01"], // 03:00 IST on 1 Nov: the founder's example
    ["2026-11-01T00:00:00.000Z", "2026-11-01"], // a date-only value stored as UTC midnight is 05:30 IST: same day
    ["2026-03-31T18:30:00.000Z", "2026-04-01"],
    ["2025-12-31T18:30:00.000Z", "2026-01-01"],
    ["2024-02-28T18:30:00.000Z", "2024-02-29"], // leap day
  ])("%s -> %s", (instant, day) => {
    expect(businessDateOf(new Date(instant))).toBe(day);
  });

  it("splits into year, month, day", () => {
    expect(businessDateParts(new Date("2026-10-31T21:30:00.000Z"))).toEqual({ year: 2026, month: 11, day: 1 });
  });
});

describe("a calendar day starts at 00:00 IST", () => {
  it("is 18:30 UTC of the day before", () => {
    expect(iso(businessDayStart("2026-11-01"))).toBe("2026-10-31T18:30:00.000Z");
    expect(iso(businessDayStart("2026-01-01"))).toBe("2025-12-31T18:30:00.000Z");
    expect(iso(businessDayStart({ year: 2026, month: 4, day: 1 }))).toBe("2026-03-31T18:30:00.000Z");
  });

  it("rejects a date that does not exist", () => {
    expect(parseYmd("2026-02-30")).toBeNull();
    expect(parseYmd("2026-13-01")).toBeNull();
    expect(parseYmd("26-02-01")).toBeNull();
    expect(parseYmd("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(() => businessDayStart("2026-02-30")).toThrow(RangeError);
  });

  it("does calendar arithmetic across month, year and leap days", () => {
    expect(addDaysYmd("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysYmd("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysYmd("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysYmd("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("a month starts at 00:00 IST on day 1, and month 13 / month 0 roll over", () => {
    expect(iso(businessMonthStart(2026, 11))).toBe("2026-10-31T18:30:00.000Z");
    expect(iso(businessMonthStart(2025, 13))).toBe("2025-12-31T18:30:00.000Z");
    expect(iso(businessMonthStart(2026, 0))).toBe("2025-11-30T18:30:00.000Z");
  });
});

describe("named presets are half-open windows of IST days", () => {
  // now = 03:00 IST on 1 Nov 2026 = 2026-10-31T21:30:00Z: still 31 October in UTC, already November in India.
  const now = new Date("2026-10-31T21:30:00.000Z");
  const win = (p: DatePresetKey, at = now) => {
    const w = resolveDatePreset(p, at);
    return [iso(w.from), iso(w.before)];
  };

  it("This Month on 1 Nov 03:00 IST is November: [1 Nov 00:00, 1 Dec 00:00) IST", () => {
    expect(win("this-month")).toEqual(["2026-10-31T18:30:00.000Z", "2026-11-30T18:30:00.000Z"]);
  });

  it("Last Month on 1 Nov 03:00 IST is October: [1 Oct 00:00, 1 Nov 00:00) IST", () => {
    expect(win("last-month")).toEqual(["2026-09-30T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]);
  });

  it("the document of 1 Nov 03:00 IST is in This Month and not in Last Month", () => {
    const doc = "2026-10-31T21:30:00.000Z";
    expect(inWindow(resolveDatePreset("this-month", now), doc)).toBe(true);
    expect(inWindow(resolveDatePreset("last-month", now), doc)).toBe(false);
  });

  it("Last 30 Days: 30 days back from today's IST midnight through the end of today", () => {
    // today 1 Nov -> 2 Oct 00:00 IST (= 1 Oct 18:30Z) through 2 Nov 00:00 IST (= 1 Nov 18:30Z)
    expect(win("last-30")).toEqual(["2026-10-01T18:30:00.000Z", "2026-11-01T18:30:00.000Z"]);
  });

  it("This Quarter (calendar): Oct-Dec 2026 starts 1 Oct 00:00 IST and runs to the end of today", () => {
    expect(win("this-quarter")).toEqual(["2026-09-30T18:30:00.000Z", "2026-11-01T18:30:00.000Z"]);
  });

  it("This FY / Last FY on 1 Nov 2026: FY 2026-27 to date; FY 2025-26 in full", () => {
    expect(win("this-fy")).toEqual(["2026-03-31T18:30:00.000Z", "2026-11-01T18:30:00.000Z"]);
    expect(win("last-fy")).toEqual(["2025-03-31T18:30:00.000Z", "2026-03-31T18:30:00.000Z"]);
  });

  describe("the instants around a month end", () => {
    // 30 Nov 23:59:59.999 IST and 1 Dec 00:00:00.000 IST
    const lastMs = new Date("2026-11-30T18:29:59.999Z");
    const firstMs = new Date("2026-11-30T18:30:00.000Z");
    it("until the last millisecond it is November; from 00:00:00.000 IST it is December", () => {
      expect(win("this-month", lastMs)).toEqual(["2026-10-31T18:30:00.000Z", "2026-11-30T18:30:00.000Z"]);
      expect(win("this-month", firstMs)).toEqual(["2026-11-30T18:30:00.000Z", "2026-12-31T18:30:00.000Z"]);
      expect(win("last-month", firstMs)).toEqual(["2026-10-31T18:30:00.000Z", "2026-11-30T18:30:00.000Z"]);
    });

    it("a document at 23:59:59.500 IST on the last day is in the month; one at 00:00:00.000 IST on the 1st is in the next", () => {
      const nov = resolveDatePreset("this-month", lastMs);
      expect(inWindow(nov, "2026-11-30T18:29:59.500Z")).toBe(true);
      expect(inWindow(nov, "2026-11-30T18:30:00.000Z")).toBe(false);
      const dec = resolveDatePreset("this-month", firstMs);
      expect(inWindow(dec, "2026-11-30T18:30:00.000Z")).toBe(true);
    });
  });

  describe("the financial-year boundary (31 March / 1 April)", () => {
    const lastMs = new Date("2026-03-31T18:29:59.999Z"); // 31 Mar 23:59:59.999 IST: FY 2025-26
    const firstMs = new Date("2026-03-31T18:30:00.000Z"); // 1 Apr 00:00:00.000 IST: FY 2026-27
    it("flips at 00:00 IST on 1 April", () => {
      expect(businessFinancialYearStartYear(lastMs)).toBe(2025);
      expect(businessFinancialYearStartYear(firstMs)).toBe(2026);
      expect(win("this-fy", lastMs)[0]).toBe("2025-03-31T18:30:00.000Z");
      expect(win("this-fy", firstMs)[0]).toBe("2026-03-31T18:30:00.000Z");
      expect(win("last-fy", firstMs)).toEqual(["2025-03-31T18:30:00.000Z", "2026-03-31T18:30:00.000Z"]);
    });

    it("the FY window is [1 Apr 00:00 IST, next 1 Apr 00:00 IST): 31 Mar 23:59:59.500 is in, 1 Apr 00:00:00.000 is out", () => {
      const fy = businessFinancialYearWindow(2025);
      expect(iso(fy.from)).toBe("2025-03-31T18:30:00.000Z");
      expect(iso(fy.before)).toBe("2026-03-31T18:30:00.000Z");
      expect(inWindow(fy, "2026-03-31T18:29:59.500Z")).toBe(true);
      expect(inWindow(fy, "2026-03-31T18:30:00.000Z")).toBe(false);
    });
  });

  it("a month window shares its end with the next month's start (no gap, no overlap)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(businessMonthWindow(2026, m).before.getTime()).toBe(businessMonthWindow(2026, m + 1).from.getTime());
    }
  });
});

describe("a custom range of two picked days (both inclusive)", () => {
  it("1 Nov to 30 Nov is [1 Nov 00:00, 1 Dec 00:00) IST", () => {
    const r = resolveDayRange("2026-11-01", "2026-11-30");
    expect([iso(r.from!), iso(r.before!)]).toEqual(["2026-10-31T18:30:00.000Z", "2026-11-30T18:30:00.000Z"]);
  });

  it("the API query form ends at the last millisecond of the last day", () => {
    expect(windowToQuery(resolveDayRange("2026-11-01", "2026-11-30"))).toEqual({
      fromDate: "2026-10-31T18:30:00.000Z",
      toDate: "2026-11-30T18:29:59.999Z",
    });
  });

  it("23:59:59.500 IST on the last day is in; 00:00:00.000 IST the next day is out; same for the first day", () => {
    const r = resolveDayRange("2026-11-01", "2026-11-30");
    expect(inWindow(r, "2026-11-30T18:29:59.500Z")).toBe(true);
    expect(inWindow(r, "2026-11-30T18:30:00.000Z")).toBe(false);
    expect(inWindow(r, "2026-10-31T18:30:00.000Z")).toBe(true);
    expect(inWindow(r, "2026-10-31T18:29:59.999Z")).toBe(false);
  });

  it("an empty or invalid side is open", () => {
    expect(resolveDayRange("", "")).toEqual({});
    expect(resolveDayRange(undefined, "2026-11-30")).toEqual({ before: new Date("2026-11-30T18:30:00.000Z") });
    expect(resolveDayRange("2026-02-30", null)).toEqual({});
    expect(windowToQuery({})).toEqual({});
  });
});

describe("writing a picked date", () => {
  it("a date-only value is stored as 00:00 IST whatever the machine's zone", () => {
    expect(pickedDateToISO("2026-04-01")).toBe("2026-03-31T18:30:00.000Z");
    expect(pickedDateToISO("2026-11-01")).toBe("2026-10-31T18:30:00.000Z");
  });

  it("and reads back as the same calendar day", () => {
    for (const day of ["2026-04-01", "2026-03-31", "2026-01-01", "2026-12-31", "2024-02-29"]) {
      expect(businessDateOf(new Date(pickedDateToISO(day)!))).toBe(day);
    }
  });

  it("a full instant or a Date is kept; empty or invalid is undefined", () => {
    expect(pickedDateToISO("2026-04-01T10:00:00.000Z")).toBe("2026-04-01T10:00:00.000Z");
    expect(pickedDateToISO(new Date("2026-04-01T10:00:00.000Z"))).toBe("2026-04-01T10:00:00.000Z");
    expect(pickedDateToISO("")).toBeUndefined();
    expect(pickedDateToISO(null)).toBeUndefined();
    expect(pickedDateToISO("not a date")).toBeUndefined();
  });

  it("the end of a picked day is the last millisecond before the next 00:00 IST", () => {
    expect(pickedDateToEndISO("2026-11-30")).toBe("2026-11-30T18:29:59.999Z");
    expect(pickedDateToEndISO("2026-03-31")).toBe("2026-03-31T18:29:59.999Z");
    expect(pickedDateToEndISO("")).toBeUndefined();
  });
});

describe("reading a stored instant", () => {
  const instant = new Date("2026-10-31T21:30:00.000Z"); // 03:00 IST on 1 Nov 2026
  it("formats the IST calendar date, not the viewer's", () => {
    expect(formatBusinessDate(instant)).toBe("01 Nov 2026");
    expect(formatBusinessDateShort(instant)).toBe("1 Nov");
    expect(formatBusinessMonthYearShort(instant)).toBe("Nov 26");
    expect(formatBusinessDateSlashes(instant)).toBe("01/11/2026");
  });

  it("an IST-midnight date reads back as that day", () => {
    expect(formatBusinessDate(new Date("2026-03-31T18:30:00.000Z"))).toBe("01 Apr 2026");
  });
});

describe("the presets cover the same days as a hand-picked range", () => {
  it.each(["this-month", "last-month"] as const)("%s equals the whole days from the first to the last of that month", (p) => {
    const now = new Date("2026-11-15T09:00:00.000Z");
    const w = resolveDatePreset(p, now);
    const month = p === "this-month" ? "2026-11" : "2026-10";
    const lastDay = p === "this-month" ? "2026-11-30" : "2026-10-31";
    const r = resolveDayRange(`${month}-01`, lastDay);
    expect([iso(w.from), iso(w.before)]).toEqual([iso(r.from!), iso(r.before!)]);
  });
});

describe("calendar-month arithmetic and the IST time of day (recurring run dates)", () => {
  it.each([
    [{ year: 2026, month: 1, day: 31 }, 1, { year: 2026, month: 2, day: 28 }], // 31 Jan + 1 month
    [{ year: 2028, month: 1, day: 31 }, 1, { year: 2028, month: 2, day: 29 }], // leap year
    [{ year: 2026, month: 4, day: 30 }, 1, { year: 2026, month: 5, day: 30 }],
    [{ year: 2026, month: 3, day: 31 }, 1, { year: 2026, month: 4, day: 30 }],
    [{ year: 2025, month: 11, day: 30 }, 3, { year: 2026, month: 2, day: 28 }], // across a year end
    [{ year: 2026, month: 5, day: 31 }, 12, { year: 2027, month: 5, day: 31 }],
    [{ year: 2026, month: 1, day: 15 }, -1, { year: 2025, month: 12, day: 15 }],
    [{ year: 2026, month: 3, day: 31 }, -1, { year: 2026, month: 2, day: 28 }],
  ])("%j + %i month(s) = %j", (from, months, expected) => {
    expect(addMonthsClampedYmd(from, months)).toEqual(expected);
  });

  it("the IST time of day of an instant, and the instant of a day at a time of day", () => {
    expect(businessTimeOfDayMs(new Date("2026-03-31T18:30:00.000Z"))).toBe(0); // 00:00 IST
    expect(businessTimeOfDayMs(new Date("2026-03-31T20:15:00.000Z"))).toBe((1 * 60 + 45) * 60 * 1000); // 01:45 IST
    expect(businessTimeOfDayMs(new Date("2026-04-01T00:00:00.000Z"))).toBe((5 * 60 + 30) * 60 * 1000); // 05:30 IST
    expect(iso(businessInstant("2026-04-01", (20 * 60) * 60 * 1000))).toBe("2026-04-01T14:30:00.000Z"); // 20:00 IST
    expect(iso(businessInstant({ year: 2026, month: 4, day: 1 }))).toBe("2026-03-31T18:30:00.000Z");
  });
});
