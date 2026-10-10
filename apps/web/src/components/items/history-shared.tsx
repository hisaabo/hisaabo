import { cn } from "@/lib/utils";

export type HistoryPeriod = "6m" | "1y" | "all";

const PERIOD_OPTIONS: { value: HistoryPeriod; label: string }[] = [
  { value: "6m", label: "Last 6M" },
  { value: "1y", label: "Last 1Y" },
  { value: "all", label: "All" },
];

export function PeriodToggle({ value, onChange }: { value: HistoryPeriod; onChange: (v: HistoryPeriod) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Period">
      {PERIOD_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
            value === o.value
              ? "bg-brand-600 text-white"
              : "bg-surface-1 text-text-secondary hover:bg-surface-2 border border-border-light"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface UnitVariantLike {
  unit: string;
  conversionFactor: number | string;
}

/** Base unit + every alt unit of the item, as a display-unit picker. Hidden when the item has no alt units. */
export function UnitSelect({
  baseUnit,
  variants,
  value,
  onChange,
}: {
  baseUnit: string;
  variants: UnitVariantLike[] | null | undefined;
  value: string;
  onChange: (unit: string) => void;
}) {
  if (!variants || variants.length === 0) return null;
  const units = [baseUnit, ...variants.map((v) => v.unit).filter((u) => u !== baseUnit)];
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
      Unit
      <select
        aria-label="Display unit"
        className="input py-1 text-xs w-24"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {units.map((u) => (
          <option key={u} value={u}>
            {u}{u === baseUnit ? " (base)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Currency for per-unit prices: at least 2, up to 4 decimals (per-gram prices need them). */
export function formatUnitPrice(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface-0)",
    border: "1px solid var(--border-light)",
    borderRadius: "8px",
    fontSize: "12px",
  },
};
