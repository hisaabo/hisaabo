import { trpc } from "@/lib/trpc";
import { cn, formatCurrency } from "@/lib/utils";

interface TargetProgress {
  current: number;
  target: number;
  percentage: number;
  remaining: number;
  unit: string;
  onTrack: boolean;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

interface MyTarget {
  id: string;
  targetType: string;
  targetValue: string;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  notes: string | null;
  progress: TargetProgress;
}

function TargetProgressBar({
  percentage,
  onTrack,
}: {
  percentage: number;
  onTrack: boolean;
}) {
  return (
    <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all duration-700",
          percentage >= 100
            ? "bg-emerald-500"
            : onTrack
              ? "bg-brand-500"
              : "bg-amber-500",
        )}
        style={{ width: `${Math.min(100, percentage)}%` }}
      />
    </div>
  );
}

function formatCurrentValue(targetType: string, current: number, unit: string): string {
  if (unit === "₹") return formatCurrency(String(current));
  return `${current.toLocaleString("en-IN")} ${unit}`;
}

function formatTargetVal(targetType: string, targetValue: string): string {
  if (targetType === "order_value") return formatCurrency(targetValue);
  const suffix = targetType === "order_count" ? " orders" : " units";
  return `${parseFloat(targetValue).toLocaleString("en-IN")}${suffix}`;
}

function TargetItem({ target }: { target: MyTarget }) {
  const { progress } = target;
  const isExpired = new Date(target.periodEnd) < new Date();

  const typeLabel =
    target.targetType === "order_count"
      ? "Order count"
      : target.targetType === "order_value"
        ? "Order value"
        : "Item quantity";

  return (
    <div className="py-3 border-b border-border-light last:border-0">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary">{typeLabel}</p>
          <p className="text-[11px] text-text-tertiary capitalize">
            {target.periodType} target
            {isExpired && " (ended)"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className={cn(
              "text-sm font-bold tabular-nums",
              progress.percentage >= 100
                ? "text-emerald-600"
                : progress.onTrack
                  ? "text-brand-600"
                  : "text-amber-600",
            )}
          >
            {progress.percentage}%
          </p>
          {!isExpired && progress.daysRemaining > 0 && (
            <p className="text-[10px] text-text-tertiary">{progress.daysRemaining}d left</p>
          )}
        </div>
      </div>

      <TargetProgressBar percentage={progress.percentage} onTrack={progress.onTrack} />

      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-text-secondary">
          {formatCurrentValue(target.targetType, progress.current, progress.unit)}
          <span className="text-text-tertiary"> / {formatTargetVal(target.targetType, target.targetValue)}</span>
        </span>
        {progress.percentage >= 100 ? (
          <span className="text-emerald-600 font-medium">Achieved</span>
        ) : (
          <span className="text-text-tertiary">
            {formatCurrentValue(target.targetType, progress.remaining, progress.unit)} to go
          </span>
        )}
      </div>
    </div>
  );
}

export function MyTargetsWidget() {
  const { data: targets, isLoading } = trpc.target.myTargets.useQuery();

  // Don't render widget at all if there are no targets
  if (!isLoading && (!targets || targets.length === 0)) {
    return null;
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
        <TargetIcon className="w-4 h-4 text-brand-600 shrink-0" />
        <h3 className="text-sm font-semibold text-text-primary">My Targets</h3>
        {targets && targets.length > 0 && (
          <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded bg-brand-600/[0.08] text-brand-700 dark:text-brand-400 font-medium">
            {targets.length} active
          </span>
        )}
      </div>

      <div className="px-4">
        {isLoading ? (
          <div className="py-4 space-y-3">
            <div className="skeleton h-12 rounded" />
            <div className="skeleton h-12 rounded" />
          </div>
        ) : (
          <div>
            {(targets as MyTarget[]).map((t) => (
              <TargetItem key={t.id} target={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TargetIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
