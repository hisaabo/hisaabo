import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {icon && (
        <div
          className="flex items-center justify-center w-12 h-12 rounded-xl"
          style={{ background: "var(--surface-2)" }}
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      {description && (
        <p
          className="text-sm text-center max-w-xs"
          style={{ color: "var(--text-tertiary)" }}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
