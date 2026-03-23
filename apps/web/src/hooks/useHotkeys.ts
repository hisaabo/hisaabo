import { useEffect, useRef, useState, useCallback } from "react";

export interface HotkeyDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
  scope?: string;
}

// Module-level registry so CommandPalette (and other consumers) can read all
// currently registered hotkeys.
const hotkeyRegistry: HotkeyDef[] = [];

export function getRegisteredHotkeys(): HotkeyDef[] {
  return [...hotkeyRegistry];
}

// ── Shortcut indicator event system ──────────────────────────────────────────

export interface ShortcutFlash {
  id: number;
  keys: string[];
  description: string;
}

type FlashListener = (flash: ShortcutFlash) => void;
const flashListeners: Set<FlashListener> = new Set();
let flashId = 0;

function emitFlash(def: HotkeyDef) {
  const keys: string[] = [];
  if (def.ctrl) keys.push("⌘");
  if (def.alt) keys.push("Alt");
  if (def.shift) keys.push("⇧");
  keys.push(def.key.length === 1 ? def.key.toUpperCase() : def.key);
  const flash: ShortcutFlash = { id: ++flashId, keys, description: def.description };
  flashListeners.forEach((fn) => fn(flash));
}

export function useShortcutFlash() {
  const [flash, setFlash] = useState<ShortcutFlash | null>(null);

  useEffect(() => {
    const listener: FlashListener = (f) => {
      setFlash(f);
    };
    flashListeners.add(listener);
    return () => { flashListeners.delete(listener); };
  }, []);

  const dismiss = useCallback(() => setFlash(null), []);

  return { flash, dismiss };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.contentEditable === "true" || el.contentEditable === "plaintext-only")
    return true;
  return false;
}

export function useHotkeys(hotkeys: HotkeyDef[]): void {
  // Stable ref so the effect closure always sees the latest hotkeys without
  // needing to re-register the listener on every render.
  const hotkeysRef = useRef(hotkeys);
  hotkeysRef.current = hotkeys;

  useEffect(() => {
    const defs = hotkeysRef.current;

    // Register in the module-level registry
    defs.forEach((d) => hotkeyRegistry.push(d));

    const handler = (e: KeyboardEvent) => {
      for (const def of hotkeysRef.current) {
        const keyMatch = e.key.toLowerCase() === def.key.toLowerCase();
        if (!keyMatch) continue;

        const ctrlMatch = def.ctrl
          ? e.ctrlKey || e.metaKey
          : !e.ctrlKey && !e.metaKey;
        const shiftMatch = def.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = def.alt ? e.altKey : !e.altKey;

        if (!ctrlMatch || !shiftMatch || !altMatch) continue;

        // Skip when user is typing — except always handle Escape
        if (e.key !== "Escape" && isTypingTarget(e.target)) {
          // Allow modifier combos (e.g. Ctrl+K) even inside inputs
          const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
          if (!hasModifier) continue;
        }

        e.preventDefault();
        // Flash indicator (skip for Escape and toggle-type shortcuts like ?)
        if (e.key !== "Escape") {
          emitFlash(def);
        }
        def.handler();
        break;
      }
    };

    document.addEventListener("keydown", handler);

    return () => {
      document.removeEventListener("keydown", handler);
      // Remove our definitions from the registry
      defs.forEach((d) => {
        const idx = hotkeyRegistry.indexOf(d);
        if (idx !== -1) hotkeyRegistry.splice(idx, 1);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
