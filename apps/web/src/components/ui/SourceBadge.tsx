import { cn } from "@/lib/utils";

const sourceLabels: Record<string, string> = {
  mybillbook: "myBillBook",
  tally: "Tally",
  generic: "CSV Import",
};

const sourceColors: Record<string, string> = {
  mybillbook: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400",
  tally: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-400",
  generic: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function SourceBadge({ source, className }: { source: string | null; className?: string }) {
  if (!source) return null;
  const label = sourceLabels[source] || source;
  const color = sourceColors[source] || sourceColors.generic;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
        color,
        className
      )}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M2 8h12M8 3l5 5-5 5" />
      </svg>
      {label}
    </span>
  );
}
