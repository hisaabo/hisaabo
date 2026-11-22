import type { CartLinkNotice as Notice } from "../cartLink";
import { AlertIcon, CheckCircleIcon, CloseIcon } from "./Icons";

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
 * Floats above the cart drawer and item modal so it stays visible with either
 * open; `data-inert-exempt` keeps it readable and dismissible while a dialog
 * has made the rest of the page inert.
 */
export function CartLinkNotice({ notice, onDismiss }: CartLinkNoticeProps) {
  const tone = TONES[notice.kind];
  return (
    <div className="toast" data-inert-exempt>
      <div
        role={notice.kind === "success" ? "status" : "alert"}
        className="toast-card"
        style={{ background: tone.background, borderColor: tone.color }}
      >
        <span className="mt-0.5 flex-none" style={{ color: tone.color }}>
          {notice.kind === "success" ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
        </span>

        <div className="max-h-[40dvh] min-w-0 flex-1 overflow-y-auto">
          <p className="text-[15px] font-semibold" style={{ color: "var(--store-text)" }}>
            {notice.message}
          </p>
          {notice.details.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {notice.details.map((line, i) => (
                <li key={i} className="text-sm leading-snug" style={{ color: "var(--store-text-secondary)" }}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="button" onClick={onDismiss} className="icon-btn -mt-1" aria-label="Dismiss">
          <CloseIcon size={18} />
        </button>
      </div>
    </div>
  );
}
