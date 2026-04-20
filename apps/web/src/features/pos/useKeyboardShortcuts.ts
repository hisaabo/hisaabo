import { useEffect } from "react";

export type Shortcut = {
  /** Key or Key combo e.g. "F2", "F9", "Escape", "Alt+1", "Ctrl+p". */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** Pass through to the focused input instead of preventing default. */
  passthrough?: boolean;
};

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim().toLowerCase());
  const needsCtrl = parts.includes("ctrl");
  const needsAlt = parts.includes("alt");
  const needsShift = parts.includes("shift");
  const key = parts[parts.length - 1]!;
  if (needsCtrl !== (e.ctrlKey || e.metaKey)) return false;
  if (needsAlt !== e.altKey) return false;
  if (needsShift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key;
}

/**
 * Scoped keyboard shortcuts — listener attaches to `rootRef`'s element, not
 * document, so it can't hijack global browser shortcuts outside the POS.
 *
 * Chords that the browser owns (F5, F11, F12, Ctrl+T/W/N/R) are intentionally
 * not in our whitelist — callers must avoid them.
 */
export function useKeyboardShortcuts(
  rootRef: React.RefObject<HTMLElement | null>,
  shortcuts: Shortcut[],
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const onKeyDown = (e: KeyboardEvent) => {
      for (const s of shortcuts) {
        if (matches(e, s.combo)) {
          if (!s.passthrough) {
            e.preventDefault();
            e.stopPropagation();
          }
          s.handler(e);
          return;
        }
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [rootRef, shortcuts, enabled]);
}
