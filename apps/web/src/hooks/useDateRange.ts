import { useState, useCallback } from "react";

export type DatePreset = "this-month" | "last-month" | "last-30" | "this-fy" | "last-fy" | "custom" | "all";

export function getDatePreset(preset: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  switch (preset) {
    case "this-month": {
      const from = new Date(yyyy, mm, 1);
      const to = new Date(yyyy, mm + 1, 0, 23, 59, 59);
      return { fromDate: from.toISOString(), toDate: to.toISOString() };
    }
    case "last-month": {
      const from = new Date(yyyy, mm - 1, 1);
      const to = new Date(yyyy, mm, 0, 23, 59, 59);
      return { fromDate: from.toISOString(), toDate: to.toISOString() };
    }
    case "last-30": {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { fromDate: from.toISOString(), toDate: now.toISOString() };
    }
    case "this-fy": {
      const fyYear = mm >= 3 ? yyyy : yyyy - 1;
      return { fromDate: new Date(fyYear, 3, 1).toISOString(), toDate: now.toISOString() };
    }
    case "last-fy": {
      const lastFyYear = mm >= 3 ? yyyy - 1 : yyyy - 2;
      return {
        fromDate: new Date(lastFyYear, 3, 1).toISOString(),
        toDate: new Date(lastFyYear + 1, 2, 31, 23, 59, 59).toISOString(),
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
