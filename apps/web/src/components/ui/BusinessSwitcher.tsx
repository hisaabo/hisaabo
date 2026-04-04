import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface BusinessSwitcherProps {
  businesses: Array<{ id: string; name: string }>;
  activeBusinessId: string;
  onSwitch: (id: string) => void;
  onCreateNew: () => void;
}

export function BusinessSwitcher({
  businesses,
  activeBusinessId,
  onSwitch,
  onCreateNew,
}: BusinessSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId) ?? businesses[0];

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev) {
        const idx = businesses.findIndex((b) => b.id === activeBusinessId);
        setFocusedIndex(idx >= 0 ? idx : 0);
      } else {
        setFocusedIndex(-1);
      }
      return !prev;
    });
  }, [businesses, activeBusinessId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const el = menuRef.current?.querySelector(
      `[data-index="${focusedIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) {
          toggle();
        } else if (focusedIndex >= 0 && focusedIndex < businesses.length) {
          onSwitch(businesses[focusedIndex].id);
          close();
          triggerRef.current?.focus();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          toggle();
        } else {
          setFocusedIndex((i) => Math.min(i + 1, businesses.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) {
          setFocusedIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case "Escape":
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        break;
      case "Tab":
        if (open) close();
        break;
    }
  };

  if (!activeBusiness) return null;

  const activeInitial = activeBusiness.name.charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-1 hover:text-text-primary transition-colors cursor-pointer select-none"
      >
        {/* Avatar */}
        <span className="w-7 h-7 rounded-lg bg-brand-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
          {activeInitial}
        </span>

        {/* Business name */}
        <span className="flex-1 min-w-0 text-left text-[13px] font-medium text-text-primary truncate">
          {activeBusiness.name}
        </span>

        {/* Chevron up-down */}
        <ChevronUpDownIcon />
      </button>

      {/* Popover — opens downward */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-border-light bg-surface-0 shadow-dropdown animate-scale-in overflow-hidden"
        >
          {/* Business list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {businesses.map((business, index) => {
              const isActive = business.id === activeBusinessId;
              const isFocused = index === focusedIndex;
              const initial = business.name.charAt(0).toUpperCase();
              return (
                <button
                  key={business.id}
                  type="button"
                  role="menuitem"
                  data-index={index}
                  onMouseEnter={() => setFocusedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSwitch(business.id);
                    close();
                    triggerRef.current?.focus();
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors text-left",
                    isFocused ? "bg-surface-1" : "hover:bg-surface-1",
                    isActive ? "font-medium text-brand-700" : "text-text-secondary"
                  )}
                >
                  {/* Avatar */}
                  <span
                    className={cn(
                      "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0",
                      isActive
                        ? "bg-brand-600 text-white"
                        : "bg-brand-100 text-brand-700"
                    )}
                  >
                    {initial}
                  </span>

                  {/* Name */}
                  <span className="flex-1 min-w-0 truncate">{business.name}</span>

                  {/* Active checkmark */}
                  {isActive && <CheckIcon />}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="h-px bg-border-light mx-0" aria-hidden="true" />

          {/* Create New Business */}
          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => {
                e.preventDefault();
                close();
                onCreateNew();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-1 hover:text-text-primary transition-colors text-left"
            >
              <span className="w-5 h-5 rounded-md border border-dashed border-border flex items-center justify-center shrink-0">
                <PlusIcon />
              </span>
              <span>Create New Business</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────

function ChevronUpDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-text-tertiary"
      aria-hidden="true"
    >
      <path d="M8 9l4-4 4 4" />
      <path d="M16 15l-4 4-4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-brand-600"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
