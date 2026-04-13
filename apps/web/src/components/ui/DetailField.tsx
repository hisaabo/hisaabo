import type { ReactNode } from "react";

interface DetailFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function DetailField({ label, children, className }: DetailFieldProps) {
  return (
    <div className={className}>
      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-sm text-text-primary">{children}</div>
    </div>
  );
}
