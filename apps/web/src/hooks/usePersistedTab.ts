import { useState } from "react";

/**
 * A tab choice remembered per browser (a convenience only).
 *
 * Only names from `tabs` are ever read or written: a stored value that is not one of
 * them (stale, renamed, hand-edited) falls back, and the value written is the constant
 * from `tabs`, never the caller's string. Storage that throws (private mode, blocked
 * site data) is ignored.
 */
export function usePersistedTab<T extends string>(
  storageKey: string,
  tabs: readonly T[],
  fallback: T,
): [T, (tab: T) => void] {
  const [tab, setTabState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return tabs.find((t) => t === stored) ?? fallback;
    } catch {
      return fallback;
    }
  });

  const setTab = (next: T) => {
    const known = tabs.find((t) => t === next);
    if (known === undefined) return;
    setTabState(known);
    try {
      localStorage.setItem(storageKey, known);
    } catch {
      // remembering the tab is optional
    }
  };

  return [tab, setTab];
}
