import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  color?: string;
  size?: "sm" | "md";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "px-1.5 py-0.5 rounded text-[10px] font-medium",
  md: "px-2 py-0.5 rounded-full text-[11px] font-medium",
};

export function Badge({ children, color, size = "sm", className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center", SIZE_CLASSES[size], color, className)}>
      {children}
    </span>
  );
}
