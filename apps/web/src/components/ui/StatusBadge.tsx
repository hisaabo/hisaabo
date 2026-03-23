import { cn } from "@/lib/utils";

interface StatusConfig {
  bg: string;
  text: string;
  dot: string;
}

const statusConfig: Record<string, StatusConfig> = {
  paid: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  sent: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    dot: "bg-blue-500",
  },
  draft: {
    bg: "bg-gray-100",
    text: "text-gray-600",
    dot: "bg-gray-400",
  },
  partial: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
  overdue: {
    bg: "bg-red-50",
    text: "text-red-700",
    dot: "bg-red-500",
  },
  cancelled: {
    bg: "bg-gray-50",
    text: "text-gray-500",
    dot: "bg-gray-300",
  },
};

const defaultConfig: StatusConfig = {
  bg: "bg-gray-100",
  text: "text-gray-600",
  dot: "bg-gray-400",
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
