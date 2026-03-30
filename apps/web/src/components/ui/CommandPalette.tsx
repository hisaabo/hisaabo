import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { KbdShortcut } from "./KbdShortcut";

interface CommandItem {
  id: string;
  label: string;
  section: string;
  action: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();

  // Commands hardcoded per spec
  const allCommands: CommandItem[] = [
    { id: "nav-dashboard",    label: "Go to Dashboard",    section: "Navigation", action: () => navigate({ to: "/" }) },
    { id: "nav-invoices",     label: "Go to Invoices",     section: "Navigation", action: () => navigate({ to: "/invoices" }) },
    { id: "nav-parties",      label: "Go to Parties",      section: "Navigation", action: () => navigate({ to: "/parties" }) },
    { id: "nav-items",        label: "Go to Items",        section: "Navigation", action: () => navigate({ to: "/items" }) },
    { id: "nav-payments",     label: "Go to Payments",     section: "Navigation", action: () => navigate({ to: "/payments" }) },
    { id: "nav-gst",          label: "Go to GST Reports",  section: "Navigation", action: () => navigate({ to: "/gst" }) },
    { id: "nav-settings",     label: "Go to Settings",     section: "Navigation", action: () => navigate({ to: "/settings" }) },
    { id: "nav-quotations",   label: "Go to Quotations",   section: "Navigation", action: () => navigate({ to: "/quotations" }) },
    { id: "nav-credit-notes", label: "Go to Credit Notes", section: "Navigation", action: () => navigate({ to: "/credit-notes" }) },
    { id: "nav-cash-bank",    label: "Go to Cash & Bank",  section: "Navigation", action: () => navigate({ to: "/cash-and-bank" }) },
  ];

  const filtered = query.trim()
    ? allCommands.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase())
      )
    : allCommands;

  // Group by section for rendering
  const sections = filtered.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
    if (!acc[cmd.section]) acc[cmd.section] = [];
    acc[cmd.section].push(cmd);
    return acc;
  }, {});

  // Focus input and reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(
      '[data-active="true"]'
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const executeCommand = (cmd: CommandItem) => {
    cmd.action();
    onClose();
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[activeIndex]) {
          executeCommand(filtered[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[18vh]">
      {/* Backdrop — full screen cover */}
      <div
        className="fixed inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-lg rounded-2xl shadow-modal border border-border-light animate-scale-in overflow-hidden bg-surface-0"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search field */}
        <div
          className="flex items-center gap-3 px-4 bg-surface-0 border-b border-border-light"
        >
          <SearchIcon className="w-4 h-4 shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={true}
            aria-controls="command-palette-listbox"
            aria-activedescendant={
              filtered[activeIndex]
                ? `cp-cmd-${filtered[activeIndex].id}`
                : undefined
            }
            aria-autocomplete="list"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search commands…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 py-4 text-sm bg-transparent outline-none text-text-primary placeholder:text-text-tertiary"
          />
          <KbdShortcut
            keys={["⌘", "K"]}
            className="shrink-0 opacity-50"
          />
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id="command-palette-listbox"
          role="listbox"
          aria-label="Commands"
          className="max-h-[300px] overflow-y-auto py-1.5"
        >
          {filtered.length === 0 ? (
            <li
              className="px-4 py-10 text-center text-sm text-text-tertiary"
              role="option"
              aria-selected={false}
            >
              <div className="flex flex-col items-center gap-2">
                <svg
                  className="w-8 h-8 opacity-30"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <span>No results for &ldquo;{query}&rdquo;</span>
              </div>
            </li>
          ) : (
            Object.entries(sections).map(([section, cmds]) => (
              <li key={section}>
                <p
                  className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary"
                  role="presentation"
                >
                  {section}
                </p>
                <ul role="presentation">
                  {cmds.map((cmd) => {
                    const globalIdx = filtered.indexOf(cmd);
                    const isActive = globalIdx === activeIndex;
                    return (
                      <li
                        key={cmd.id}
                        id={`cp-cmd-${cmd.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive ? "true" : undefined}
                        className={cn(
                          "mx-1.5 px-3 py-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-colors",
                          isActive
                            ? "bg-brand-600/10 text-brand-700"
                            : "text-text-primary hover:bg-surface-1"
                        )}
                        onMouseEnter={() => setActiveIndex(globalIdx)}
                        onClick={() => executeCommand(cmd)}
                      >
                        <span className="text-sm font-medium">
                          {cmd.label}
                        </span>
                        {isActive && (
                          <EnterIcon className="w-3.5 h-3.5 shrink-0 opacity-60" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        {/* Footer hint */}
        <div
          className="px-4 py-2.5 flex items-center gap-4 text-[11px] text-text-tertiary border-t border-border-light bg-surface-1"
        >
          <span className="flex items-center gap-1.5">
            <KbdShortcut keys={["↑"]} />
            <KbdShortcut keys={["↓"]} />
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <KbdShortcut keys={["↵"]} />
            select
          </span>
          <span className="flex items-center gap-1.5">
            <KbdShortcut keys={["Esc"]} />
            close
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SearchIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

function EnterIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
      />
    </svg>
  );
}
