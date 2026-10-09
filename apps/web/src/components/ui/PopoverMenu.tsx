import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;
const GAP = 4;

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Collision-aware placement for a dropdown anchored to a trigger. Opens below
 * and right-aligned to the trigger; flips above when there is not enough room
 * below (and more room above); clamps horizontally inside the viewport.
 */
export function computeMenuPosition(
  trigger: Rect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; placement: "bottom" | "top" } {
  const spaceBelow = viewport.height - trigger.bottom - GAP - VIEWPORT_MARGIN;
  const spaceAbove = trigger.top - GAP - VIEWPORT_MARGIN;
  const placement = menu.height > spaceBelow && spaceAbove > spaceBelow ? "top" : "bottom";

  let top = placement === "bottom" ? trigger.bottom + GAP : trigger.top - GAP - menu.height;
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewport.height - VIEWPORT_MARGIN - menu.height));

  let left = trigger.right - menu.width;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewport.width - VIEWPORT_MARGIN - menu.width));

  return { top, left, placement };
}

interface PopoverMenuProps {
  open: boolean;
  onClose: () => void;
  /** Element the menu is anchored to (usually the trigger button). */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
}

/**
 * Dropdown panel rendered in a portal with fixed, viewport-safe placement, so
 * it is never clipped by (or overflows) a slide-over, table or scroll area.
 */
export function PopoverMenu({ open, onClose, anchorRef, children, className }: PopoverMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      setPos(
        computeMenuPosition(
          anchor.getBoundingClientRect(),
          { width: menu.offsetWidth, height: menu.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef]);

  // Escape closes only the menu, not the slide-over hosting it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        data-placement={pos?.placement}
        style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className={
          className ??
          "z-[71] min-w-[172px] max-w-[calc(100vw-16px)] rounded-lg border border-border-light bg-surface-1 shadow-lg py-1"
        }
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
