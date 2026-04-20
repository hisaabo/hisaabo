import { useEffect, useRef } from "react";

/**
 * Barcode-scanner detector.
 *
 * Most USB/Bluetooth barcode scanners emulate a keyboard and "type" the
 * decoded digits very quickly followed by Enter. Humans can't type that
 * fast, so we can distinguish the two purely from keypress timing.
 *
 * Algorithm: buffer printable keystrokes on the given element. If the
 * buffer reaches `minLen`, all inter-key gaps are <= `maxGapMs`, and the
 * sequence ends with Enter, call `onScan(code)` and consume the events
 * so the focused input never sees them. Otherwise flush the buffer and
 * let the browser route the keys normally.
 *
 * Scoped to a specific ref (the POS shell) so global app shortcuts are
 * unaffected.
 */
export function useScanner(
  rootRef: React.RefObject<HTMLElement | null>,
  onScan: (code: string) => void,
  opts: { minLen?: number; maxGapMs?: number } = {},
) {
  const minLen = opts.minLen ?? 6;
  const maxGapMs = opts.maxGapMs ?? 35;

  // Refs so we don't re-bind the listener on every buffer keystroke.
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);
  const consumedKeyStrokesRef = useRef<KeyboardEvent[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = performance.now();
      const gap = now - lastKeyAtRef.current;
      lastKeyAtRef.current = now;

      // Non-printable keys (except Enter which finalizes) reset the buffer.
      if (e.key === "Enter") {
        if (bufferRef.current.length >= minLen) {
          const code = bufferRef.current;
          bufferRef.current = "";
          consumedKeyStrokesRef.current = [];
          // Prevent the Enter from reaching the focused input.
          e.preventDefault();
          e.stopPropagation();
          onScan(code);
        } else {
          // Short buffer means human typed 1-2 chars + Enter (e.g. "y\n"
          // into a confirm dialog) — let it through.
          bufferRef.current = "";
          consumedKeyStrokesRef.current = [];
        }
        return;
      }

      // Any modifier keypress = human. Flush.
      if (e.ctrlKey || e.altKey || e.metaKey) {
        bufferRef.current = "";
        consumedKeyStrokesRef.current = [];
        return;
      }

      // Only printable single-char keys participate in the scan buffer.
      if (e.key.length !== 1) {
        bufferRef.current = "";
        consumedKeyStrokesRef.current = [];
        return;
      }

      // Gap too slow — human typing. Reset but let this char through.
      if (gap > maxGapMs && bufferRef.current.length > 0) {
        bufferRef.current = "";
        consumedKeyStrokesRef.current = [];
      }

      bufferRef.current += e.key;
      consumedKeyStrokesRef.current.push(e);
    };

    root.addEventListener("keydown", onKeyDown, true); // capture
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [rootRef, onScan, minLen, maxGapMs]);
}
