import { cn } from "@/lib/utils";

interface SkeletonRowsProps {
  count?: number;
  height?: string;
  className?: string;
}

export function SkeletonRows({ count = 6, height = "h-14", className }: SkeletonRowsProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("skeleton rounded-lg", height)} />
      ))}
    </div>
  );
}
