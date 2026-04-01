import { useState, useCallback } from "react";

export type DatePreset = "this-month" | "last-month" | "last-30" | "this-fy" | "last-fy" | "custom" | "all";

/**
 * Build UTC ISO strings for date boundaries.
 * CRITICAL: We must use Date.UTC() instead of new Date(y, m, d) to avoid
 * local-timezone shifting. In IST (UTC+5:30), `new Date(2025, 3, 1).toISOString()`
 * produces "2025-03-31T18:30:00Z" — March 31 UTC, not April 1. This caused
 * FY charts to include the previous March.
 */
function utcDate(y: number, m: number, d: number, h = 0, min = 0, s = 0): string {
  return new Date(Date.UTC(y, m, d, h, min, s)).toISOString();
}

export function getDatePreset(preset: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = now.getUTCMonth();

  switch (preset) {
    case "this-month": {
      // Calendar month: 1st to last day
      return { fromDate: utcDate(yyyy, mm, 1), toDate: utcDate(yyyy, mm + 1, 0, 23, 59, 59) };
    }
    case "last-month": {
      return { fromDate: utcDate(yyyy, mm - 1, 1), toDate: utcDate(yyyy, mm, 0, 23, 59, 59) };
    }
    case "last-30": {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { fromDate: from.toISOString(), toDate: now.toISOString() };
    }
    case "this-fy": {
      // Indian FY: April 1 to March 31
      const fyYear = mm >= 3 ? yyyy : yyyy - 1;
      return { fromDate: utcDate(fyYear, 3, 1), toDate: now.toISOString() };
    }
    case "last-fy": {
      const lastFyYear = mm >= 3 ? yyyy - 1 : yyyy - 2;
      return {
        fromDate: utcDate(lastFyYear, 3, 1),
        toDate: utcDate(lastFyYear + 1, 2, 31, 23, 59, 59),
      };
    }
    case "all":
    default:
      return { fromDate: "", toDate: "" };
  }
}

export const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "last-30", label: "Last 30 Days" },
  { value: "this-fy", label: "This FY" },
  { value: "last-fy", label: "Last FY" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All" },
];

export function getGranularity(preset: string): "week" | "month" | "fy" {
  switch (preset) {
    case "this-month":
    case "last-month":
    case "last-30":
      return "week";
    case "this-fy":
    case "last-fy":
    case "this-quarter":
      return "month";
    case "all":
      return "fy";
    default:
      return "month"; // custom ranges default to monthly
  }
}

export function useDateRange(pageKey: string, defaultPreset: DatePreset = "all") {
  const storageKey = `hisaabo-daterange-${pageKey}`;

  const [preset, setPresetState] = useState<DatePreset>(() => {
    if (typeof window === "undefined") return defaultPreset;
    return (localStorage.getItem(storageKey) as DatePreset) || defaultPreset;
  });

  const [dateRange, setDateRange] = useState(() => getDatePreset(preset));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const setPreset = useCallback(
    (p: DatePreset) => {
      setPresetState(p);
      localStorage.setItem(storageKey, p);
      if (p !== "custom") {
        setDateRange(getDatePreset(p));
      }
    },
    [storageKey]
  );

  const setCustomRange = useCallback((from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setDateRange({
      fromDate: from ? new Date(from).toISOString() : "",
      toDate: to ? new Date(to + "T23:59:59").toISOString() : "",
    });
  }, []);

  return {
    preset,
    setPreset,
    dateRange,
    customFrom,
    customTo,
    setCustomRange,
    fromDate: dateRange.fromDate || undefined,
    toDate: dateRange.toDate || undefined,
  };
}
