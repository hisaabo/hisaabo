import { cn } from "@/lib/utils";

interface StatusConfig {
  bg: string;
  text: string;
  dot: string;
}

const statusConfig: Record<string, StatusConfig> = {
  paid: {
    bg: "bg-emerald-50 dark:bg-emerald-950",
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  sent: {
    bg: "bg-blue-50 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  draft: {
    bg: "bg-surface-2",
    text: "text-text-secondary",
    dot: "bg-text-tertiary",
  },
  unfulfilled: {
    bg: "bg-orange-50 dark:bg-orange-950",
    text: "text-orange-700 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  partial: {
    bg: "bg-amber-50 dark:bg-amber-950",
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  overdue: {
    bg: "bg-red-50 dark:bg-red-950",
    text: "text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  cancelled: {
    bg: "bg-surface-2",
    text: "text-text-tertiary",
    dot: "bg-text-tertiary",
  },
  adjusted: {
    bg: "bg-purple-50 dark:bg-purple-950",
    text: "text-purple-700 dark:text-purple-400",
    dot: "bg-purple-500",
  },
};

const defaultConfig: StatusConfig = {
  bg: "bg-surface-2",
  text: "text-text-secondary",
  dot: "bg-text-tertiary",
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = statusConfig[status] ?? defaultConfig;
  const sizeClass = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        sizeClass,
        config.bg,
        config.text
      )}
    >
      <span className={cn("rounded-full w-1.5 h-1.5 shrink-0", config.dot)} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
