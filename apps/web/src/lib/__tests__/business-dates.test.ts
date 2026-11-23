/**
 * The web date helpers read and write the BUSINESS calendar (IST), not the browser's: one stored
 * instant is one calendar day for every viewer. Literals are worked out by hand (IST midnight of a
 * day is 18:30 UTC of the day before) and must hold under TZ=UTC, Asia/Kolkata and America/Los_Angeles.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatMonthYearShort,
  formatDateInput,
  todayISODate,
  toISOString,
  toISOStringEndOfDay,
} from "../utils";

afterEach(() => vi.useRealTimers());

describe("a stored instant is shown as its IST calendar day", () => {
  it.each([
    ["2026-10-31T18:29:59.999Z", "31 Oct 2026", "31 Oct", "Oct 26", "2026-10-31"], // 23:59:59.999 IST
    ["2026-10-31T18:30:00.000Z", "01 Nov 2026", "1 Nov", "Nov 26", "2026-11-01"], // 00:00:00.000 IST
    ["2026-10-31T21:30:00.000Z", "01 Nov 2026", "1 Nov", "Nov 26", "2026-11-01"], // 03:00 IST on 1 Nov
    ["2026-03-31T18:30:00.000Z", "01 Apr 2026", "1 Apr", "Apr 26", "2026-04-01"], // what "1 April" is stored as
  ])("%s", (instant, long, short, monthYear, input) => {
    expect(formatDate(instant)).toBe(long);
    expect(formatDateShort(instant)).toBe(short);
    expect(formatMonthYearShort(instant)).toBe(monthYear);
    expect(formatDateInput(instant)).toBe(input);
  });

  it("a date-only string is that calendar day", () => {
    expect(formatDate("2026-04-01")).toBe("01 Apr 2026");
    expect(formatDateInput("2026-04-01")).toBe("2026-04-01");
  });

  it("a missing or invalid date shows the dash / an empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("garbage")).toBe("—");
    expect(formatDateInput("garbage")).toBe("");
  });
});

describe("a picked day is written as 00:00 IST and reads back as the same day", () => {
  it.each(["2026-04-01", "2026-03-31", "2026-01-01", "2026-12-31", "2024-02-29"])("%s", (day) => {
    const iso = toISOString(day)!;
    expect(formatDateInput(iso)).toBe(day);
  });

  it("1 April is 31 March 18:30 UTC; the end of 31 March is 23:59:59.999 IST", () => {
    expect(toISOString("2026-04-01")).toBe("2026-03-31T18:30:00.000Z");
    expect(toISOStringEndOfDay("2026-03-31")).toBe("2026-03-31T18:29:59.999Z");
  });
});

describe("today is the IST date", () => {
  it("is 1 Nov at 03:00 IST, although it is still 31 Oct in UTC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T21:30:00.000Z"));
    expect(todayISODate()).toBe("2026-11-01");
  });

  it("changes at 00:00 IST", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T18:29:59.999Z"));
    expect(todayISODate()).toBe("2026-10-31");
    vi.setSystemTime(new Date("2026-10-31T18:30:00.000Z"));
    expect(todayISODate()).toBe("2026-11-01");
  });
});
