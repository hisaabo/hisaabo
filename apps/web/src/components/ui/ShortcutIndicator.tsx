import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useShortcutFlash } from "@/hooks/useHotkeys";

export function ShortcutIndicator(): React.JSX.Element | null {
  const { flash, dismiss } = useShortcutFlash();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!flash) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, 1200);
    return () => clearTimeout(timerRef.current);
  }, [flash, dismiss]);

  if (!flash) return null;

  return createPortal(
    <div
      key={flash.id}
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] pointer-events-none animate-shortcut-flash"
    >
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-text-primary/90 backdrop-blur-sm shadow-modal">
        <span className="inline-flex items-center gap-1">
          {flash.keys.map((key, i) => (
            <kbd
              key={i}
              className="inline-flex items-center justify-center min-w-[22px] h-6 px-1.5 rounded-md bg-white/15 text-[12px] font-mono font-semibold text-white/90 border border-white/10"
            >
              {key}
            </kbd>
          ))}
        </span>
        <span className="text-[13px] font-medium text-white/80">
          {flash.description}
        </span>
      </div>
    </div>,
    document.body
  );
}
