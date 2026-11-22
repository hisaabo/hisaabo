import { useState, useCallback } from "react";
import { resolveDatePreset, resolveDayRange, windowToQuery, type DatePresetKey } from "@hisaabo/shared";

export type DatePreset = "this-month" | "last-month" | "last-30" | "this-fy" | "last-fy" | "custom" | "all";

const NAMED_PRESETS: readonly DatePresetKey[] = ["this-month", "last-month", "last-30", "this-fy", "last-fy"];

/**
 * The {fromDate, toDate} a preset sends to the API, or empty strings for "all".
 *
 * Boundaries are IST midnights (the business calendar), never UTC or the browser's zone, and the
 * window is half-open: `toDate` is the last millisecond before the next period starts. In UTC,
 * "This Month" ends at 2026-10-31T23:59:59Z, which is 05:29 IST on 1 Nov, so a document dated
 * 1 Nov 03:00 IST fell into October. See @hisaabo/shared business-time for the rules.
 *
 * Public contract: the strings this returns are always UTC ISO-8601 instants, or empty strings for
 * the "all" preset.
 */
export function getDatePreset(preset: string, now: Date = new Date()): { fromDate: string; toDate: string } {
  if (!(NAMED_PRESETS as readonly string[]).includes(preset)) return { fromDate: "", toDate: "" };
  const q = windowToQuery(resolveDatePreset(preset as DatePresetKey, now));
  return { fromDate: q.fromDate ?? "", toDate: q.toDate ?? "" };
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
    // Both picked days are inclusive: "1 Nov" to "30 Nov" is all of November on the business calendar.
    const q = windowToQuery(resolveDayRange(from, to));
    setDateRange({ fromDate: q.fromDate ?? "", toDate: q.toDate ?? "" });
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
