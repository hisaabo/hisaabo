import { renderHook, act } from "@testing-library/react";
import { getDatePreset, getGranularity, useDateRange } from "@/hooks/useDateRange";

// Pin "now" to 2025-07-15 (month index 6, i.e. July) for all date arithmetic.
// July is after April so mm >= 3 is true → FY year = 2025, last-FY year = 2024.
const FIXED_NOW = new Date("2025-07-15T00:00:00.000Z");

describe("getDatePreset (pure helper)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("this-month: returns calendar month 1st to last day in UTC", () => {
    const { fromDate, toDate } = getDatePreset("this-month");
    const from = new Date(fromDate);
    const to = new Date(toDate);

    expect(from.getUTCFullYear()).toBe(2025);
    expect(from.getUTCMonth()).toBe(6);
    expect(from.getUTCDate()).toBe(1);

    expect(to.getUTCFullYear()).toBe(2025);
    expect(to.getUTCMonth()).toBe(6);
    expect(to.getUTCDate()).toBe(31);
    expect(to.getUTCHours()).toBe(23);
    expect(to.getUTCMinutes()).toBe(59);
  });

  it("last-month: returns previous calendar month boundaries in UTC", () => {
    const { fromDate, toDate } = getDatePreset("last-month");
    const from = new Date(fromDate);
    const to = new Date(toDate);

    expect(from.getUTCFullYear()).toBe(2025);
    expect(from.getUTCMonth()).toBe(5);
    expect(from.getUTCDate()).toBe(1);

    expect(to.getUTCFullYear()).toBe(2025);
    expect(to.getUTCMonth()).toBe(5);
    expect(to.getUTCDate()).toBe(30);
    expect(to.getUTCHours()).toBe(23);
  });

  it("this-fy: starts April 1 of current FY in UTC", () => {
    const { fromDate } = getDatePreset("this-fy");
    const from = new Date(fromDate);

    expect(from.getUTCFullYear()).toBe(2025);
    expect(from.getUTCMonth()).toBe(3); // April
    expect(from.getUTCDate()).toBe(1);
    expect(from.getUTCHours()).toBe(0);
  });

  it("last-fy: April 1 to March 31 of previous FY in UTC", () => {
    const { fromDate, toDate } = getDatePreset("last-fy");
    const from = new Date(fromDate);
    const to = new Date(toDate);

    expect(from.getUTCFullYear()).toBe(2024);
    expect(from.getUTCMonth()).toBe(3);
    expect(from.getUTCDate()).toBe(1);

    expect(to.getUTCFullYear()).toBe(2025);
    expect(to.getUTCMonth()).toBe(2); // March
    expect(to.getUTCDate()).toBe(31);
    expect(to.getUTCHours()).toBe(23);
  });

  it("all: returns empty strings", () => {
    const { fromDate, toDate } = getDatePreset("all");
    expect(fromDate).toBe("");
    expect(toDate).toBe("");
  });

  // ── TIMEZONE REGRESSION TESTS ─────────────────────────────────────────
  // Bug: using local-time Date constructor caused April 1 IST → March 31 UTC,
  // making FY charts include the previous March. These tests ensure all
  // boundaries are in UTC regardless of the runtime's local timezone.

  it("REGRESSION: this-fy fromDate ISO string contains April, never March", () => {
    const { fromDate } = getDatePreset("this-fy");
    // The raw ISO string must show month 04, not 03
    expect(fromDate).toMatch(/2025-04-01T00:00:00/);
  });

  it("REGRESSION: last-fy fromDate ISO string contains April of the previous year", () => {
    const { fromDate } = getDatePreset("last-fy");
    expect(fromDate).toMatch(/2024-04-01T00:00:00/);
  });

  it("REGRESSION: this-month fromDate ISO string is 1st of current month in UTC", () => {
    const { fromDate } = getDatePreset("this-month");
    expect(fromDate).toMatch(/2025-07-01T00:00:00/);
  });

  it("REGRESSION: last-month fromDate ISO string is 1st of previous month in UTC", () => {
    const { fromDate } = getDatePreset("last-month");
    expect(fromDate).toMatch(/2025-06-01T00:00:00/);
  });

  // Edge case: "now" is in January (before April) — FY starts previous year
  it("this-fy when month < April: FY starts previous calendar year", () => {
    vi.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
    const { fromDate } = getDatePreset("this-fy");
    expect(fromDate).toMatch(/2025-04-01T00:00:00/);
  });

  // Edge case: "now" is exactly April 1 — FY starts same year
  it("this-fy on April 1: FY starts same year", () => {
    vi.setSystemTime(new Date("2025-04-01T00:00:00.000Z"));
    const { fromDate } = getDatePreset("this-fy");
    expect(fromDate).toMatch(/2025-04-01T00:00:00/);
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

    const from = new Date(result.current.fromDate!);
    const to = new Date(result.current.toDate!);

    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(0); // January
    expect(from.getDate()).toBe(1);

    expect(to.getFullYear()).toBe(2025);
    expect(to.getMonth()).toBe(2); // March
    expect(to.getDate()).toBe(31);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getSeconds()).toBe(59);
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
