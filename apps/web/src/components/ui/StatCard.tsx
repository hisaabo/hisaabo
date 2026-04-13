import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  valueColor?: string;
  labelColor?: string;
  accentColor?: string;
  note?: string;
  subItems?: { label: string; value: string }[];
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StatCard({
  label,
  value,
  valueColor,
  labelColor,
  accentColor,
  note,
  subItems,
  size = "sm",
  className,
}: StatCardProps) {
  if (size === "lg") {
    return (
      <div
        className={cn(
          "bg-surface rounded-xl border border-border px-4 py-3",
          accentColor && `border-l-4 ${accentColor}`,
          className,
        )}
      >
        <p className={cn("text-[11px] font-semibold uppercase tracking-wider text-text-tertiary", labelColor)}>
          {label}
        </p>
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums mt-1",
            valueColor ?? "text-text-primary",
          )}
        >
          {value}
        </p>
        {note && <p className="text-sm text-text-secondary mt-0.5">{note}</p>}
        {subItems && subItems.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {subItems.map((item) => (
              <p key={item.label} className="text-[11px] text-text-tertiary">
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (size === "md") {
    return (
      <div
        className={cn(
          "card px-5 py-4",
          accentColor && `border-l-4 ${accentColor}`,
          className,
        )}
      >
        <p className={cn("text-xs font-medium text-text-tertiary mb-1", labelColor)}>{label}</p>
        <p
          className={cn(
            "text-xl font-bold tabular-nums",
            valueColor ?? "text-text-primary",
          )}
        >
          {value}
        </p>
        {note && <p className="text-sm text-text-secondary mt-0.5">{note}</p>}
        {subItems && subItems.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {subItems.map((item) => (
              <p key={item.label} className="text-[11px] text-text-tertiary">
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // size === "sm" (default)
  return (
    <div
      className={cn(
        "card px-4 py-3",
        accentColor && `border-l-4 ${accentColor}`,
        className,
      )}
    >
      <p className={cn("text-xs text-text-tertiary mb-1", labelColor)}>{label}</p>
      <p
        className={cn(
          "text-base font-semibold tabular-nums",
          valueColor ?? "text-text-primary",
        )}
      >
        {value}
      </p>
      {note && <p className="text-sm text-text-secondary mt-0.5">{note}</p>}
      {subItems && subItems.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {subItems.map((item) => (
            <p key={item.label} className="text-[11px] text-text-tertiary">
              {item.label}: {item.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
