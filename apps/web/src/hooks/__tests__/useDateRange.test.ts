import { renderHook, act } from "@testing-library/react";
import { getDatePreset, getGranularity, useDateRange } from "@/hooks/useDateRange";

// Pin "now" to 2025-07-15 (month index 6, i.e. July) for all date arithmetic.
// July is after April so mm >= 3 is true → FY year = 2025, last-FY year = 2024.
// 05:30 IST on 15 Jul 2025. Every expectation below is an IST midnight written out by hand
// (IST midnight of a day is 18:30 UTC of the day before) and must hold whatever the TZ of the
// machine running the tests: the suite is run under TZ=UTC, Asia/Kolkata and America/Los_Angeles.
const FIXED_NOW = new Date("2025-07-15T00:00:00.000Z");

describe("getDatePreset (pure helper): boundaries are IST midnights, windows are half-open", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("this-month: 1 Jul 00:00 IST to the last millisecond of 31 Jul IST", () => {
    expect(getDatePreset("this-month")).toEqual({
      fromDate: "2025-06-30T18:30:00.000Z",
      toDate: "2025-07-31T18:29:59.999Z",
    });
  });

  it("last-month: 1 Jun 00:00 IST to the last millisecond of 30 Jun IST", () => {
    expect(getDatePreset("last-month")).toEqual({
      fromDate: "2025-05-31T18:30:00.000Z",
      toDate: "2025-06-30T18:29:59.999Z",
    });
  });

  it("this-fy: 1 Apr 2025 00:00 IST through the end of today (15 Jul IST)", () => {
    expect(getDatePreset("this-fy")).toEqual({
      fromDate: "2025-03-31T18:30:00.000Z",
      toDate: "2025-07-15T18:29:59.999Z",
    });
  });

  it("last-fy: 1 Apr 2024 00:00 IST to the last millisecond of 31 Mar 2025 IST", () => {
    expect(getDatePreset("last-fy")).toEqual({
      fromDate: "2024-03-31T18:30:00.000Z",
      toDate: "2025-03-31T18:29:59.999Z",
    });
  });

  it("last-30: 30 days back from today's IST midnight through the end of today", () => {
    expect(getDatePreset("last-30")).toEqual({
      fromDate: "2025-06-14T18:30:00.000Z", // 15 Jun 00:00 IST
      toDate: "2025-07-15T18:29:59.999Z",
    });
  });

  it("all: returns empty strings", () => {
    expect(getDatePreset("all")).toEqual({ fromDate: "", toDate: "" });
  });

  it("unknown preset: falls back to empty strings", () => {
    expect(getDatePreset("not-a-real-preset")).toEqual({ fromDate: "", toDate: "" });
  });

  it("now-relative presets are stable within an IST day (stable query keys across remounts)", () => {
    const first = [getDatePreset("last-30"), getDatePreset("this-fy")];
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 60 * 60 * 1000));
    const later = [getDatePreset("last-30"), getDatePreset("this-fy")];
    expect(later).toEqual(first);
  });

  // The founder's report: a document dated 1 Nov 03:00 IST (2026-10-31T21:30Z) fell in October.
  it("at 03:00 IST on 1 Nov, This Month is November and Last Month is October (UTC still says 31 Oct)", () => {
    vi.setSystemTime(new Date("2026-10-31T21:30:00.000Z"));
    expect(getDatePreset("this-month")).toEqual({ fromDate: "2026-10-31T18:30:00.000Z", toDate: "2026-11-30T18:29:59.999Z" });
    expect(getDatePreset("last-month")).toEqual({ fromDate: "2026-09-30T18:30:00.000Z", toDate: "2026-10-31T18:29:59.999Z" });
  });

  it("a month flips at 00:00:00.000 IST, not at 00:00 UTC", () => {
    vi.setSystemTime(new Date("2026-11-30T18:29:59.999Z")); // 23:59:59.999 IST on 30 Nov
    expect(getDatePreset("this-month").fromDate).toBe("2026-10-31T18:30:00.000Z");
    vi.setSystemTime(new Date("2026-11-30T18:30:00.000Z")); // 00:00:00.000 IST on 1 Dec
    expect(getDatePreset("this-month").fromDate).toBe("2026-11-30T18:30:00.000Z");
  });

  it("the financial year flips at 00:00 IST on 1 April", () => {
    vi.setSystemTime(new Date("2026-03-31T18:29:59.999Z")); // 31 Mar 23:59:59.999 IST: FY 2025-26
    expect(getDatePreset("this-fy").fromDate).toBe("2025-03-31T18:30:00.000Z");
    vi.setSystemTime(new Date("2026-03-31T18:30:00.000Z")); // 1 Apr 00:00:00.000 IST: FY 2026-27
    expect(getDatePreset("this-fy").fromDate).toBe("2026-03-31T18:30:00.000Z");
    expect(getDatePreset("last-fy")).toEqual({ fromDate: "2025-03-31T18:30:00.000Z", toDate: "2026-03-31T18:29:59.999Z" });
  });

  it("this-fy in January: the FY started the previous April", () => {
    vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
    expect(getDatePreset("this-fy").fromDate).toBe("2025-03-31T18:30:00.000Z");
  });

  it("last-fy in Jan-Mar: the previous FY ran two calendar years back", () => {
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z"));
    expect(getDatePreset("last-fy")).toEqual({ fromDate: "2024-03-31T18:30:00.000Z", toDate: "2025-03-31T18:29:59.999Z" });
  });
});

describe("getGranularity", () => {
  it("this-month and last-month use weekly granularity", () => {
    expect(getGranularity("this-month")).toBe("week");
    expect(getGranularity("last-month")).toBe("week");
  });

  it("last-30 uses weekly granularity", () => {
    expect(getGranularity("last-30")).toBe("week");
  });

  it("FY presets use monthly granularity", () => {
    expect(getGranularity("this-fy")).toBe("month");
    expect(getGranularity("last-fy")).toBe("month");
  });

  it("all uses FY granularity", () => {
    expect(getGranularity("all")).toBe("fy");
  });

  it("custom defaults to monthly", () => {
    expect(getGranularity("custom")).toBe("month");
  });
});

describe("useDateRange (hook)", () => {
  const PAGE_KEY = "test-page";
  const STORAGE_KEY = `hisaabo-daterange-${PAGE_KEY}`;

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("initializes with default preset when localStorage is empty", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));
    expect(result.current.preset).toBe("all");
    expect(result.current.fromDate).toBeUndefined();
    expect(result.current.toDate).toBeUndefined();
  });

  it("reads saved preset from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, "this-month");
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));
    expect(result.current.preset).toBe("this-month");
  });

  it("setPreset updates the preset state", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setPreset("last-month");
    });

    expect(result.current.preset).toBe("last-month");
  });

  it("setPreset persists the selection to localStorage", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setPreset("this-fy");
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("this-fy");
  });

  it("setPreset updates dateRange for non-custom presets", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    // "all" starts with empty dates
    expect(result.current.fromDate).toBeUndefined();

    act(() => {
      result.current.setPreset("this-month");
    });

    // After switching to this-month we should have actual date strings
    expect(result.current.fromDate).toBeDefined();
    expect(result.current.toDate).toBeDefined();
  });

  it("setPreset to custom does NOT call getDatePreset (dateRange stays as-is)", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "this-month"));

    const fromBefore = result.current.fromDate;

    act(() => {
      result.current.setPreset("custom");
    });

    expect(result.current.preset).toBe("custom");
    // dateRange should be unchanged because setPreset skips getDatePreset for "custom"
    expect(result.current.fromDate).toBe(fromBefore);
  });

  it("setCustomRange updates dateRange and custom date strings", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setCustomRange("2025-01-01", "2025-03-31");
    });

    expect(result.current.customFrom).toBe("2025-01-01");
    expect(result.current.customTo).toBe("2025-03-31");
    expect(result.current.fromDate).toBeDefined();
    expect(result.current.toDate).toBeDefined();

    // both picked days are inclusive, on the business calendar: 1 Jan 00:00 IST to the last millisecond of 31 Mar IST
    expect(result.current.fromDate).toBe("2024-12-31T18:30:00.000Z");
    expect(result.current.toDate).toBe("2025-03-31T18:29:59.999Z");
  });

  it("setCustomRange with empty strings yields undefined fromDate/toDate", () => {
    const { result } = renderHook(() => useDateRange(PAGE_KEY, "all"));

    act(() => {
      result.current.setCustomRange("", "");
    });

    expect(result.current.fromDate).toBeUndefined();
    expect(result.current.toDate).toBeUndefined();
  });
});
