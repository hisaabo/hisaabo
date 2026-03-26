import { useId, useState, ReactNode, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface DisclosureProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
  count?: number;
}

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  icon,
  count,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const contentId = `disclosure-content-${uid}`;
  const triggerId = `disclosure-trigger-${uid}`;

  const toggle = () => setOpen((v) => !v);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  const hasFilled = typeof count === "number" && count > 0;

  return (
    <div>
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-surface-1 transition-colors text-left"
      >
        {icon && (
          <span className="shrink-0" style={{ color: "var(--text-tertiary)" }}>
            {icon}
          </span>
        )}

        <span
          className="flex-1 text-sm font-medium flex items-center gap-1.5"
          style={
            hasFilled
              ? { color: "var(--text-primary)" }
              : { color: "var(--text-secondary)" }
          }
        >
          {hasFilled && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0"
              aria-hidden="true"
            />
          )}
          {label}
        </span>

        {hasFilled && (
          <span
            className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-secondary)",
            }}
          >
            {count} filled
          </span>
        )}

        <ChevronRightIcon
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200",
            open && "rotate-90"
          )}
          style={{ color: "var(--text-tertiary)" }}
        />
      </button>

      <div
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className={open ? "overflow-visible" : "overflow-hidden"}>
          <div className="pt-2 pb-1 px-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ChevronRightIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
