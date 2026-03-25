import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    previousFocus.current = document.activeElement as HTMLElement;

    // Focus: only elements that explicitly request it via autofocus/data-autofocus
    // This prevents opening Combobox dropdowns or focusing the wrong field in edit mode
    const autoFocusEl = ref.current.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
    if (autoFocusEl) {
      requestAnimationFrame(() => autoFocusEl.focus());
    }
    // If no autofocus element, don't auto-focus anything — let the user click where they want

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !ref.current) return;
      const focusableEls = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      if (focusableEls.length === 0) return;
      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [active, ref]);
}
