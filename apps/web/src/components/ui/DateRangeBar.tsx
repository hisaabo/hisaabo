import { cn } from "@/lib/utils";
import { DATE_PRESETS, type DatePreset } from "@/hooks/useDateRange";

interface DateRangeBarProps {
  preset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
  onExport?: () => void;
  exporting?: boolean;
  className?: string;
}

export function DateRangeBar({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomChange,
  onExport,
  exporting,
  className,
}: DateRangeBarProps) {
  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {DATE_PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onPresetChange(p.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            preset === p.value
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {p.label}
        </button>
      ))}

      {preset === "custom" && onCustomChange && (
        <div className="flex items-center gap-2 ml-1">
          <input
            type="date"
            value={customFrom || ""}
            onChange={(e) => onCustomChange(e.target.value, customTo || "")}
            className="input py-1 text-xs w-32"
          />
          <span className="text-text-tertiary text-xs">to</span>
          <input
            type="date"
            value={customTo || ""}
            onChange={(e) => onCustomChange(customFrom || "", e.target.value)}
            className="input py-1 text-xs w-32"
          />
        </div>
      )}

      {onExport && (
        <button
          onClick={onExport}
          disabled={exporting}
          className="btn-secondary text-xs px-3 py-1.5 ml-auto shrink-0 inline-flex items-center gap-1.5"
        >
          {exporting ? (
            <>
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Preparing...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
              </svg>
              Export CSV
            </>
          )}
        </button>
      )}
    </div>
  );
}
