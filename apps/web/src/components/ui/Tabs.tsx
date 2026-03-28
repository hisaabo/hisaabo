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
  size?: "sm" | "md";
  className?: string;
}

export function PillTabs({ tabs, value, onChange, size = "md", className }: PillTabsProps) {
  const isSmall = size === "sm";
  return (
    <div className={cn("flex items-center gap-0.5", isSmall && "bg-surface-1 rounded-md p-0.5", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => tab.value !== value && onChange(tab.value)}
          className={cn(
            "font-medium transition-colors inline-flex items-center gap-1.5 rounded-md",
            isSmall ? "px-2 py-0.5 text-[10px]" : "px-3 py-1.5 text-sm rounded-lg",
            tab.value === value
              ? isSmall
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400 shadow-sm"
                : "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                "inline-flex items-center justify-center rounded-full font-medium min-w-[18px] px-1",
                isSmall ? "text-[9px]" : "text-[11px]",
                tab.value === value
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-400"
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
      className="inline-flex rounded-lg p-0.5 bg-surface-1 border border-border-light"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => tab.value !== value && onChange(tab.value)}
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
