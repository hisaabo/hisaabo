import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Called before any close attempt (Escape, overlay click, header X).
   * Return false to veto the close — typically used to show a "discard
   * unsaved changes?" confirm dialog. If omitted (or returns true), the
   * default onClose runs.
   */
  onCloseAttempt?: () => boolean;
}

export function SlideOver({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  onCloseAttempt,
}: SlideOverProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, open);

  function attemptClose() {
    if (onCloseAttempt && onCloseAttempt() === false) return;
    onClose();
  }

  // Move focus inside the dialog when it opens (ARIA dialog best practice).
  // Prefer an element marked [autofocus] / [data-autofocus]; fall back to the
  // first focusable child.
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const target =
      dialogRef.current.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ??
      dialogRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    // Defer focus by one event-loop tick so the panel slide-in animation
    // has begun before we move focus.  setTimeout(fn, 0) is used instead
    // of requestAnimationFrame so that the timing is predictable in tests
    // (vi.useFakeTimers() + vi.runAllTimers() flushes setTimeout but rAF
    // flushing behaviour is environment-dependent in jsdom).
    const id = setTimeout(() => target?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") attemptClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, onCloseAttempt]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slideover-title"
    >
      <div
        className="fixed inset-0 bg-black/40 animate-fade-in"
        onClick={attemptClose}
      />
      <div
        ref={dialogRef}
        className="fixed right-0 top-0 bottom-0 w-full max-w-3xl flex flex-col animate-slide-in shadow-modal bg-surface-0"
      >
        <div className="flex items-start justify-between px-6 py-4 shrink-0 border-b border-border-light">
          <div>
            <h2
              id="slideover-title"
              className="text-base font-semibold text-text-primary"
            >
              {title}
            </h2>
            {description && (
              <p className="text-sm mt-0.5 text-text-tertiary">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn-icon ml-4 shrink-0"
            onClick={attemptClose}
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
          <div className="shrink-0 px-6 py-4 border-t border-border-light">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
