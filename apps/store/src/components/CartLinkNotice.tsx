import type { CartLinkNotice as Notice } from "../cartLink";

interface CartLinkNoticeProps {
  notice: Notice;
  onDismiss: () => void;
}

const TONES = {
  success: { color: "var(--store-success)", background: "var(--store-success-bg)" },
  warning: { color: "var(--store-warning)", background: "var(--store-warning-bg)" },
  error: { color: "var(--store-danger)", background: "var(--store-danger-bg)" },
} as const;

/**
 * Dismissible banner reporting what a cart link did: how many items it added,
 * and which of its lines were dropped (unavailable, out of stock, unreadable).
 * Floats above the cart drawer and item modal so it stays visible with either open.
 */
export function CartLinkNotice({ notice, onDismiss }: CartLinkNoticeProps) {
  const tone = TONES[notice.kind];
  return (
    <div className="fixed top-3 left-0 right-0 z-[60] px-3 pointer-events-none">
      <div
        role={notice.kind === "success" ? "status" : "alert"}
        className="pointer-events-auto mx-auto w-full max-w-md rounded-xl border animate-scale-in flex items-start gap-3 px-4 py-3"
        style={{
          background: tone.background,
          borderColor: tone.color,
          boxShadow: "var(--store-shadow-lg)",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke={tone.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="18"
          height="18"
          className="flex-shrink-0 mt-0.5"
          aria-hidden="true"
        >
          {notice.kind === "success" ? (
            <>
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </>
          )}
        </svg>

        <div className="flex-1 min-w-0 max-h-[40dvh] overflow-y-auto">
          <p className="text-[13.5px] font-semibold" style={{ color: "var(--store-text)" }}>
            {notice.message}
          </p>
          {notice.details.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {notice.details.map((line, i) => (
                <li
                  key={i}
                  className="text-[12px] leading-snug"
                  style={{ color: "var(--store-text-secondary)" }}
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 w-7 h-7 -mr-1 -mt-0.5 flex items-center justify-center rounded-full"
          style={{ color: "var(--store-text-secondary)" }}
          aria-label="Dismiss"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
