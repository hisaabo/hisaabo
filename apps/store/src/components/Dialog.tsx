import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { CloseIcon } from "./Icons";

/**
 * The one dialog primitive of the storefront: policy modals, the item view,
 * the cart drawer and phone verification are all a `Dialog`.
 *
 * Every dialog gets, once and the same way:
 *  - role="dialog", aria-modal and a label (a visible `title`, an element of
 *    its own named by `labelledBy`, or a plain `label`);
 *  - Esc and a click on the backdrop close it (the topmost dialog only);
 *  - focus moves in on open, Tab and Shift+Tab wrap inside it, and focus goes
 *    back to whatever opened it on close;
 *  - everything outside it is `inert` (hidden from assistive technology and
 *    unreachable by keyboard) while it is open;
 *  - page scrolling is locked without moving the page: `html` reserves its
 *    scrollbar gutter (styles.css), so hiding overflow changes nothing, and a
 *    browser without `scrollbar-gutter` gets the scrollbar's width as padding.
 *
 * Dialogs can stack (the phone step opens above the cart drawer): only the top
 * one reacts to keys, and closing it hands focus back to its opener.
 *
 * Mark an element that must stay usable above a dialog (a toast) with
 * `data-inert-exempt`.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const INERT_MARK = "data-dialog-inert";
const EXEMPT = "[data-inert-exempt]";

interface Entry {
  root: HTMLElement;
  panel: HTMLElement;
}

// Open dialogs, bottom to top. Module state: there is one document.
const stack: Entry[] = [];
let savedBody: { overflow: string; paddingRight: string } | null = null;

function isVisible(el: HTMLElement): boolean {
  // checkVisibility is absent from older browsers and from jsdom: assume visible.
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden], [inert]") && isVisible(el),
  );
}

function lockScroll(): void {
  const body = document.body;
  savedBody = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  const gutterReserved = typeof CSS !== "undefined" && CSS.supports?.("scrollbar-gutter: stable");
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = "hidden";
  if (!gutterReserved && scrollbar > 0) {
    const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbar}px`;
  }
}

function unlockScroll(): void {
  if (!savedBody) return;
  document.body.style.overflow = savedBody.overflow;
  document.body.style.paddingRight = savedBody.paddingRight;
  savedBody = null;
}

/** Make everything outside the top dialog inert; undo whatever the previous top set. */
function syncInert(): void {
  for (const el of document.querySelectorAll(`[${INERT_MARK}]`)) {
    el.removeAttribute("inert");
    el.removeAttribute(INERT_MARK);
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  let node: HTMLElement = top.root;
  while (node.parentElement && node !== document.body) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.tagName === "SCRIPT") continue;
      // Already inert for another reason, or exempt: leave alone.
      if (sibling.hasAttribute("inert") || sibling.matches(EXEMPT)) continue;
      sibling.setAttribute("inert", "");
      sibling.setAttribute(INERT_MARK, "");
    }
    node = node.parentElement;
  }
}

export interface DialogProps {
  onClose: () => void;
  /** Visible heading in the dialog's header bar; also its accessible name. */
  title?: ReactNode;
  /** The id of a heading inside `children`, for dialogs that draw their own header. */
  labelledBy?: string;
  /** Accessible name when there is neither a title nor a heading to point at. */
  label?: string;
  /** Centered card, or a panel that slides in from the right (a bottom sheet on phones). */
  variant?: "modal" | "drawer";
  size?: "sm" | "md" | "lg";
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Pinned below the scrolling body. */
  footer?: ReactNode;
  /** Focused on open instead of the first focusable element of the body. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Make the body a keyboard-focusable scroll region (for long text with no controls). */
  bodyFocusable?: boolean;
  className?: string;
  children: ReactNode;
}

export function Dialog({
  onClose,
  title,
  labelledBy,
  label,
  variant = "modal",
  size = "md",
  closeLabel = "Close",
  footer,
  initialFocus,
  bodyFocusable = false,
  className = "",
  children,
}: DialogProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The latest props, read by the long-lived listeners below.
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);
  useEffect(() => {
    onCloseRef.current = onClose;
    initialFocusRef.current = initialFocus;
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: Entry = { root, panel };
    stack.push(entry);
    if (stack.length === 1) lockScroll();
    syncInert();

    if (!panel.contains(document.activeElement)) {
      const body = bodyRef.current;
      const target =
        initialFocusRef.current?.current ??
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        (body ? focusableIn(body)[0] : undefined) ??
        focusableIn(panel)[0] ??
        panel;
      target.focus({ preventScroll: true });
    }

    const isTop = () => stack[stack.length - 1] === entry;

    function onKeyDown(event: KeyboardEvent) {
      if (!isTop()) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableIn(panel!);
      if (items.length === 0) {
        event.preventDefault();
        panel!.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel!.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Belt and braces for browsers without `inert`: pull stray focus back in.
    function onFocusIn(event: FocusEvent) {
      if (!isTop()) return;
      const target = event.target;
      if (!(target instanceof Element) || panel!.contains(target) || target.closest(EXEMPT)) return;
      (focusableIn(panel!)[0] ?? panel!).focus({ preventScroll: true });
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      stack.splice(stack.indexOf(entry), 1);
      syncInert();
      if (stack.length === 0) unlockScroll();
      // The opener can be gone (its screen changed): then leave focus where it is.
      if (opener && opener.isConnected && opener !== document.body) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const accessibleName = labelledBy ?? (title != null ? titleId : undefined);

  const closeButton = (
    <button type="button" className="icon-btn dlg-close" onClick={onClose} aria-label={closeLabel}>
      <CloseIcon size={20} />
    </button>
  );

  return (
    <div ref={rootRef} className={`dlg dlg-${variant}`}>
      <div
        className="dlg-backdrop"
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={accessibleName}
        aria-label={accessibleName ? undefined : label}
        tabIndex={-1}
        className={`dlg-panel dlg-${size} ${className}`.trim()}
      >
        {title != null ? (
          <header className="dlg-head">
            <h2 id={titleId} className="dlg-title">
              {title}
            </h2>
            {closeButton}
          </header>
        ) : (
          <div className="dlg-float">{closeButton}</div>
        )}
        <div
          ref={bodyRef}
          className="dlg-body"
          tabIndex={bodyFocusable ? 0 : undefined}
          role={bodyFocusable ? "region" : undefined}
          aria-labelledby={bodyFocusable ? accessibleName : undefined}
        >
          {children}
        </div>
        {footer ? <div className="dlg-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
