import { useState } from "react";
import dayjs from "dayjs";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface MonthPeriodBarProps {
  year: number;
  /** 1-indexed month (1 = January) */
  month: number;
  onChange: (year: number, month: number) => void;
  className?: string;
}

/**
 * Period pills for month-based returns (GSTR-1 / GSTR-3B style reports).
 * Same pill design as DateRangeBar, but the backend filing period is a single
 * calendar month, so the presets are "This Month" / "Last Month" and a
 * "Custom" pill that reveals month + year selectors for any other period.
 */
export function MonthPeriodBar({ year, month, onChange, className }: MonthPeriodBarProps) {
  const now = dayjs();
  const last = now.subtract(1, "month");
  const isThis = year === now.year() && month === now.month() + 1;
  const isLast = year === last.year() && month === last.month() + 1;

  const [customOpen, setCustomOpen] = useState(!isThis && !isLast);
  const active: "this-month" | "last-month" | "custom" =
    customOpen ? "custom" : isThis ? "this-month" : isLast ? "last-month" : "custom";

  const years = Array.from({ length: 5 }, (_, i) => now.year() - i);
  if (!years.includes(year)) years.push(year);

  const pills = [
    { value: "this-month", label: "This Month" },
    { value: "last-month", label: "Last Month" },
    { value: "custom", label: "Custom" },
  ] as const;

  function select(value: (typeof pills)[number]["value"]) {
    if (value === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    const target = value === "this-month" ? now : last;
    onChange(target.year(), target.month() + 1);
  }

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {pills.map((p) => (
        <button
          key={p.value}
          type="button"
          aria-pressed={active === p.value}
          onClick={() => select(p.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            active === p.value
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {p.label}
        </button>
      ))}

      {active === "custom" && (
        <div className="flex items-center gap-2 ml-1">
          <select
            aria-label="Month"
            className="input py-1 text-xs w-32"
            value={month}
            onChange={(e) => onChange(year, Number(e.target.value))}
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            aria-label="Year"
            className="input py-1 text-xs w-24"
            value={year}
            onChange={(e) => onChange(Number(e.target.value), month)}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
