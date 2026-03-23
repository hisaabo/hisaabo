import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function SlideOver({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: SlideOverProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="fixed inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 bottom-0 w-full max-w-3xl flex flex-col animate-slide-in shadow-modal"
        style={{ background: "var(--surface-0)" }}
      >
        <div
          className="flex items-start justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {title}
            </h2>
            {description && (
              <p className="text-sm mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-icon ml-4 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              className="w-4 h-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div
            className="shrink-0 px-6 py-4"
            style={{ borderTop: "1px solid var(--border-light)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
