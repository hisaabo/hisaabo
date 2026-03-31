import { renderHook, act } from "@testing-library/react";
import { getDatePreset, useDateRange } from "@/hooks/useDateRange";

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

  it("this-month: returns correct first and last day of current month", () => {
    const { fromDate, toDate } = getDatePreset("this-month");

    const from = new Date(fromDate);
    const to = new Date(toDate);

    // July 1 2025
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(6); // 0-indexed July
    expect(from.getDate()).toBe(1);

    // July 31 2025 at end-of-day
    expect(to.getFullYear()).toBe(2025);
    expect(to.getMonth()).toBe(6);
    expect(to.getDate()).toBe(31);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getSeconds()).toBe(59);
  });

  it("last-month: returns correct first and last day of previous month", () => {
    const { fromDate, toDate } = getDatePreset("last-month");

    const from = new Date(fromDate);
    const to = new Date(toDate);

    // June 1 2025
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(5); // 0-indexed June
    expect(from.getDate()).toBe(1);

    // June 30 2025 at end-of-day
    expect(to.getFullYear()).toBe(2025);
    expect(to.getMonth()).toBe(5);
    expect(to.getDate()).toBe(30);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getSeconds()).toBe(59);
  });

  it("this-fy: starts April 1 of current FY and ends today", () => {
    const { fromDate, toDate } = getDatePreset("this-fy");

    const from = new Date(fromDate);
    const to = new Date(toDate);

    // FY 2025-26 started April 1 2025
    expect(from.getFullYear()).toBe(2025);
    expect(from.getMonth()).toBe(3); // April = 3
    expect(from.getDate()).toBe(1);

    // "to" is `now` so it should be the fake-timer date (2025-07-15)
    expect(to.getFullYear()).toBe(2025);
    expect(to.getMonth()).toBe(6); // July
    expect(to.getDate()).toBe(15);
  });

  it("last-fy: returns April 1 of last FY through March 31", () => {
    const { fromDate, toDate } = getDatePreset("last-fy");

    const from = new Date(fromDate);
    const to = new Date(toDate);

    // Last FY was 2024-25: Apr 1 2024 → Mar 31 2025
    expect(from.getFullYear()).toBe(2024);
    expect(from.getMonth()).toBe(3); // April
    expect(from.getDate()).toBe(1);

    expect(to.getFullYear()).toBe(2025);
    expect(to.getMonth()).toBe(2); // March = 2
    expect(to.getDate()).toBe(31);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(to.getSeconds()).toBe(59);
  });

  it("all: returns empty strings", () => {
    const { fromDate, toDate } = getDatePreset("all");
    expect(fromDate).toBe("");
    expect(toDate).toBe("");
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
