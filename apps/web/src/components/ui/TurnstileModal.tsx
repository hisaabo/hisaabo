/**
 * TurnstileModal — Bot protection via Cloudflare Turnstile in a modal.
 *
 * Flow:
 *   1. User fills a form and clicks submit.
 *   2. The form handler opens this modal instead of submitting directly.
 *   3. The modal renders the Turnstile challenge widget.
 *   4. On success, onVerified(token) fires and the modal closes.
 *   5. The form handler receives the token and completes the submission.
 *
 * In dev (no VITE_TURNSTILE_SITE_KEY), the Cloudflare test key is used
 * which always passes immediately — the modal still shows briefly so the
 * flow is exercised, then auto-closes.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          size: "normal" | "flexible" | "compact";
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileModalProps {
  open: boolean;
  onVerified: (token: string) => void;
  onClose: () => void;
}

export function TurnstileModal({ open, onVerified, onClose }: TurnstileModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [error, setError] = useState(false);

  useFocusTrap(dialogRef, open);

  const cleanup = useCallback(() => {
    if (window.turnstile && widgetIdRef.current !== null) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !containerRef.current) return;

    setError(false);

    const sitekey =
      (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ||
      "1x00000000000000000000AA"; // Cloudflare test key — always passes

    function mount() {
      if (!containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current !== null) return;

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey,
        size: "normal",
        theme: "auto",
        callback: (token: string) => {
          onVerified(token);
        },
        "error-callback": () => setError(true),
        "expired-callback": () => setError(true),
      });
    }

    if (window.turnstile) {
      mount();
    } else {
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval);
          mount();
        }
      }, 100);
      return () => {
        clearInterval(interval);
        cleanup();
      };
    }

    return cleanup;
  }, [open, onVerified, cleanup]);

  // Escape key closes
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="turnstile-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-sm rounded-2xl animate-scale-in shadow-modal bg-surface-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2 text-center">
          <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-brand-50 dark:bg-brand-950 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-600">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <h2 id="turnstile-title" className="text-base font-semibold text-text-primary">
            Quick verification
          </h2>
          <p className="text-sm text-text-tertiary mt-1">
            Confirm you're not a robot to continue
          </p>
        </div>

        {/* Turnstile widget */}
        <div className="flex justify-center px-6 py-5">
          <div ref={containerRef} />
        </div>

        {/* Error state */}
        {error && (
          <div className="px-6 pb-2 text-center">
            <p className="text-sm text-red-500">
              Verification failed. Please try again.
            </p>
          </div>
        )}

        {/* Cancel */}
        <div className="px-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
