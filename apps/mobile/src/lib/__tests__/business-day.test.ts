/**
 * business-day.ts: the mobile app's periods and picked dates on the business calendar (IST).
 *
 * Every instant is a literal worked out by hand (IST midnight of a day = 18:30 UTC of the day before)
 * and the results must be the same whatever the phone's (or CI's) zone: the suite is run under
 * TZ=UTC, Asia/Kolkata and America/Los_Angeles.
 */
import {
  getPeriodDates,
  getCustomRangeDates,
  getAccountTimeRange,
  pickerDateToISO,
  storedToPickerDate,
  pickerDay,
} from "../business-day";
import { formatDate, formatDateShort, formatDateInput, formatDateTime, todayISODate } from "../utils";

// 03:00 IST on 1 Nov 2026: still 31 October in UTC and in the US.
const NOW = new Date("2026-10-31T21:30:00.000Z");

describe("dashboard / report periods are IST windows", () => {
  it("This Month on 1 Nov 03:00 IST is November: 1 Nov 00:00 IST to the last millisecond of 30 Nov IST", () => {
    expect(getPeriodDates("month", NOW)).toEqual({
      fromDate: "2026-10-31T18:30:00.000Z",
      toDate: "2026-11-30T18:29:59.999Z",
    });
  });

  it("This Quarter (Oct-Dec) starts 1 Oct 00:00 IST and runs to the end of today", () => {
    expect(getPeriodDates("quarter", NOW)).toEqual({
      fromDate: "2026-09-30T18:30:00.000Z",
      toDate: "2026-11-01T18:29:59.999Z", // the last millisecond of 1 Nov IST
    });
  });

  it("This FY starts 1 April 00:00 IST and runs to the end of today", () => {
    expect(getPeriodDates("fy", NOW)).toEqual({
      fromDate: "2026-03-31T18:30:00.000Z",
      toDate: "2026-11-01T18:29:59.999Z",
    });
  });

  it("All Time sends no range", () => {
    expect(getPeriodDates("all", NOW)).toEqual({});
  });

  it("the month flips at 00:00:00.000 IST; the FY flips at 00:00 IST on 1 April", () => {
    expect(getPeriodDates("month", new Date("2026-11-30T18:29:59.999Z")).fromDate).toBe("2026-10-31T18:30:00.000Z");
    expect(getPeriodDates("month", new Date("2026-11-30T18:30:00.000Z")).fromDate).toBe("2026-11-30T18:30:00.000Z");
    expect(getPeriodDates("fy", new Date("2026-03-31T18:29:59.999Z")).fromDate).toBe("2025-03-31T18:30:00.000Z");
    expect(getPeriodDates("fy", new Date("2026-03-31T18:30:00.000Z")).fromDate).toBe("2026-03-31T18:30:00.000Z");
  });

  it("a document at 23:59:59.500 IST on the last day is inside This Month; one at 00:00:00.000 IST on the 1st is outside", () => {
    const { fromDate, toDate } = getPeriodDates("month", new Date("2026-11-15T09:00:00.000Z"));
    const inRange = (instant: string) => instant >= fromDate! && instant <= toDate!;
    expect(inRange("2026-11-30T18:29:59.500Z")).toBe(true); // 23:59:59.500 IST on 30 Nov
    expect(inRange("2026-11-30T18:30:00.000Z")).toBe(false); // 00:00:00.000 IST on 1 Dec
    expect(inRange("2026-10-31T18:30:00.000Z")).toBe(true); // 00:00:00.000 IST on 1 Nov
    expect(inRange("2026-10-31T18:29:59.999Z")).toBe(false); // 23:59:59.999 IST on 31 Oct
  });
});

describe("a custom range of two picked days (device-local Dates), both inclusive", () => {
  // The picker returns the device's local day; build it from local fields so it is the same day in every zone.
  const picked = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15, 30);

  it("1 Nov to 30 Nov is 1 Nov 00:00 IST to the last millisecond of 30 Nov IST", () => {
    expect(getCustomRangeDates(picked(2026, 11, 1), picked(2026, 11, 30))).toEqual({
      fromDate: "2026-10-31T18:30:00.000Z",
      toDate: "2026-11-30T18:29:59.999Z",
    });
  });

  it("an empty side is open", () => {
    expect(getCustomRangeDates(null, null)).toEqual({});
    expect(getCustomRangeDates(picked(2026, 11, 1), null)).toEqual({ fromDate: "2026-10-31T18:30:00.000Z" });
  });
});

describe("account audit-log range", () => {
  it("the last 7 days: 00:00 IST seven days ago through the end of today", () => {
    expect(getAccountTimeRange("week", NOW)).toEqual({
      fromDate: "2026-10-24T18:30:00.000Z", // 25 Oct 00:00 IST (today is 1 Nov IST)
      toDate: "2026-11-01T18:29:59.999Z",
    });
  });

  it("this month is the IST month; all is open", () => {
    expect(getAccountTimeRange("month", NOW)).toEqual({ fromDate: "2026-10-31T18:30:00.000Z", toDate: "2026-11-30T18:29:59.999Z" });
    expect(getAccountTimeRange("all", NOW)).toEqual({});
  });
});

describe("a picked Date is written as 00:00 IST of the picked day, and reads back as that day", () => {
  it.each([[2026, 4, 1], [2026, 3, 31], [2026, 1, 1], [2026, 12, 31], [2024, 2, 29]])("%i-%i-%i", (y, m, d) => {
    const picked = new Date(y, m - 1, d, 23, 45); // late evening on the device: still the picked day
    const iso = pickerDateToISO(picked);
    expect(formatDateInput(iso)).toBe(pickerDay(picked));
    // and loading the stored instant back into the picker gives the same day
    expect(pickerDay(storedToPickerDate(iso))).toBe(pickerDay(picked));
  });

  it("1 April is stored as 31 March 18:30 UTC", () => {
    expect(pickerDateToISO(new Date(2026, 3, 1, 9, 0))).toBe("2026-03-31T18:30:00.000Z");
  });
});

describe("stored dates are shown on the IST calendar", () => {
  it("formats the day, not the phone's day", () => {
    const instant = "2026-10-31T21:30:00.000Z"; // 03:00 IST on 1 Nov
    expect(formatDate(instant)).toBe("1 Nov 2026");
    expect(formatDateShort(instant)).toBe("1 Nov");
    expect(formatDateInput(instant)).toBe("2026-11-01");
    expect(formatDateTime(instant)).toBe("1 Nov 2026, 3:00 AM");
  });

  it("an IST-midnight instant is that day; a date-only string is that day", () => {
    expect(formatDate("2026-03-31T18:30:00.000Z")).toBe("1 Apr 2026");
    expect(formatDate("2026-04-01")).toBe("1 Apr 2026");
  });

  it("today is the IST date", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-31T21:30:00.000Z"));
    try {
      expect(todayISODate()).toBe("2026-11-01");
    } finally {
      jest.useRealTimers();
    }
  });
});
