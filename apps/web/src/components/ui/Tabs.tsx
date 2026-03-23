import { cn } from "@/lib/utils";

interface Tab {
  value: string;
  label: string;
  count?: number;
}

interface PillTabsProps {
  tabs: Tab[];
  value: string;
  onChange: (v: string) => void;
}

export function PillTabs({ tabs, value, onChange }: PillTabsProps) {
  return (
    <div className="flex items-center gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1.5",
            tab.value === value
              ? "bg-brand-50 text-brand-700"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                "inline-flex items-center justify-center rounded-full text-[11px] font-medium min-w-[18px] px-1",
                tab.value === value
                  ? "bg-brand-100 text-brand-700"
                  : "bg-surface-3 text-text-tertiary"
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface SegmentedTab {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  tabs: SegmentedTab[];
  value: string;
  onChange: (v: string) => void;
}

export function SegmentedControl({ tabs, value, onChange }: SegmentedControlProps) {
  return (
    <div
      className="inline-flex rounded-lg p-0.5"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-light)",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
            tab.value === value
              ? "bg-surface-0 shadow-sm text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
