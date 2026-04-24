import { useState, useCallback } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { toISOString, toISOStringEndOfDay } from "@/lib/utils";

dayjs.extend(utc);

export type DatePreset = "this-month" | "last-month" | "last-30" | "this-fy" | "last-fy" | "custom" | "all";

/**
 * Build UTC ISO strings for date boundaries.
 *
 * CRITICAL: All FY and calendar-month boundaries are constructed in UTC.
 * Without this, `dayjs().startOf("month")` in IST (UTC+5:30) produces
 * "2025-03-31T18:30:00Z" for April 1 — which pulled the previous March into
 * every FY chart and is the bug the prior implementation had to work around.
 * We rely on the dayjs UTC plugin (loaded at module scope above) so `.utc()`
 * is available.
 *
 * Public contract: the {fromDate, toDate} strings this returns are always
 * UTC ISO-8601, or empty strings for the "all" preset.
 */
export function getDatePreset(preset: string): { fromDate: string; toDate: string } {
  const now = dayjs.utc();
  const yyyy = now.year();
  const mm = now.month();

  switch (preset) {
    case "this-month": {
      return {
        fromDate: now.startOf("month").toISOString(),
        toDate: now.endOf("month").toISOString(),
      };
    }
    case "last-month": {
      const lastMonth = now.subtract(1, "month");
      return {
        fromDate: lastMonth.startOf("month").toISOString(),
        toDate: lastMonth.endOf("month").toISOString(),
      };
    }
    case "last-30": {
      return {
        fromDate: now.subtract(30, "day").toISOString(),
        toDate: now.toISOString(),
      };
    }
    case "this-fy": {
      // Indian FY runs April → March. If we're in Jan–Mar, the FY started
      // last calendar year.
      const fyYear = mm >= 3 ? yyyy : yyyy - 1;
      return {
        fromDate: dayjs.utc().year(fyYear).month(3).date(1).startOf("day").toISOString(),
        toDate: now.toISOString(),
      };
    }
    case "last-fy": {
      const lastFyYear = mm >= 3 ? yyyy - 1 : yyyy - 2;
      return {
        fromDate: dayjs.utc().year(lastFyYear).month(3).date(1).startOf("day").toISOString(),
        toDate: dayjs.utc().year(lastFyYear + 1).month(2).date(31).endOf("day").toISOString(),
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
      fromDate: toISOString(from) ?? "",
      toDate: toISOStringEndOfDay(to) ?? "",
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
