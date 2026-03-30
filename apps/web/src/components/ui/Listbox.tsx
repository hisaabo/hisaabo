import {
  useId,
  useRef,
  useState,
  useEffect,
  useCallback,
  KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";

export interface ListboxOption {
  value: string;
  label: string;
  description?: string;
}

export interface ListboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ListboxOption[];
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  className?: string;
}

export function Listbox({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  label,
  required,
  error,
  className,
}: ListboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const uid = useId();
  const listboxId = `listbox-${uid}`;
  const labelId = `listbox-label-${uid}`;

  const selectedOption = options.find((o) => o.value === value) ?? null;

  // Typeahead state
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openDropdown = useCallback(() => {
    const selectedIndex = options.findIndex((o) => o.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [options, value]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const selectOption = useCallback(
    (index: number) => {
      if (index >= 0 && index < options.length) {
        onChange(options[index].value);
      }
      closeDropdown();
    },
    [options, onChange, closeDropdown]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        listboxRef.current &&
        !listboxRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll active option into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const optionEl = listboxRef.current?.querySelector(
      `[id="${uid}-option-${activeIndex}"]`
    ) as HTMLElement | null;
    optionEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, uid]);

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) {
          selectOption(activeIndex);
        } else {
          openDropdown();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          openDropdown();
        } else {
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          openDropdown();
        } else {
          setActiveIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case "Home":
        e.preventDefault();
        if (open) setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        if (open) setActiveIndex(options.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        closeDropdown();
        break;
      case "Tab":
        if (open) closeDropdown();
        break;
      default: {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (!open) openDropdown();
          const char = e.key.toLowerCase();
          if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
          typeaheadRef.current += char;
          const query = typeaheadRef.current;
          const idx = options.findIndex((o) =>
            o.label.toLowerCase().startsWith(query)
          );
          if (idx >= 0) setActiveIndex(idx);
          typeaheadTimerRef.current = setTimeout(() => {
            typeaheadRef.current = "";
          }, 500);
        }
      }
    }
  };

  const activeDescendant =
    open && activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined;

  return (
    <div className={cn("relative", className)}>
      {label && (
        <label
          id={labelId}
          className="label"
          onClick={() => triggerRef.current?.focus()}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-red-600">
              *
            </span>
          )}
        </label>
      )}

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={label ? labelId : undefined}
        aria-activedescendant={activeDescendant}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "input flex items-center justify-between gap-2 text-left cursor-pointer select-none",
          error && "border-red-500 focus:border-red-500"
        )}
      >
        <span
          className={cn(
            "flex-1 truncate",
            !selectedOption && "text-text-tertiary"
          )}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDownIcon
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {error && (
        <p className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}

      {open && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={label ? labelId : undefined}
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border shadow-dropdown bg-surface-0 max-h-60 overflow-y-auto animate-scale-in"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={`${uid}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-2",
                  isActive && "bg-surface-2",
                  !isActive && "hover:bg-surface-1",
                  isSelected && "font-medium text-brand-700"
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(index);
                }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.description && (
                    <span className="block text-xs truncate text-text-tertiary">
                      {option.description}
                    </span>
                  )}
                </span>
                {isSelected && <CheckIcon className="w-4 h-4 shrink-0 text-brand-600" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
