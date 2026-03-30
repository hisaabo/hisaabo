import {
  useId,
  useRef,
  useState,
  useEffect,
  useCallback,
  KeyboardEvent,
  ChangeEvent,
} from "react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  className?: string;
  emptyMessage?: string;
  /** Called with the raw text input value — use this for server-side search */
  onQueryChange?: (query: string) => void;
  /** Show a loading indicator while server-side results are fetching */
  isLoading?: boolean;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Search...",
  label,
  required,
  error,
  className,
  emptyMessage = "No results found",
  onQueryChange,
  isLoading,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const uid = useId();
  const listboxId = `combobox-listbox-${uid}`;
  const labelId = `combobox-label-${uid}`;

  const selectedOption = options.find((o) => o.value === value) ?? null;

  // Filter options based on query — when onQueryChange is provided (server-side search),
  // skip client-side filtering and show all supplied options.
  const filteredOptions = onQueryChange
    ? options
    : query
    ? options.filter((o) => {
        const q = query.toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          (o.description?.toLowerCase().includes(q) ?? false)
        );
      })
    : options;

  // When query changes, reset active index
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active option into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const optionEl = listboxRef.current?.querySelector(
      `[id="${uid}-cb-option-${activeIndex}"]`
    ) as HTMLElement | null;
    optionEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, uid]);

  const openDropdown = () => setOpen(true);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    // If nothing was selected or query doesn't match selection, reset query
    if (!value) {
      setQuery("");
    } else if (selectedOption) {
      setQuery("");
    }
  }, [value, selectedOption]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closeDropdown]);

  const selectOption = useCallback(
    (index: number) => {
      if (index >= 0 && index < filteredOptions.length) {
        onChange(filteredOptions[index].value);
        setQuery("");
        setOpen(false);
        inputRef.current?.blur();
      }
    },
    [filteredOptions, onChange]
  );

  const clearSelection = useCallback(() => {
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  }, [onChange]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onQueryChange?.(e.target.value);
    if (!open) openDropdown();
  };

  const handleInputFocus = () => {
    openDropdown();
    // Show current selection in input as query so user can edit/filter
    if (value && selectedOption) {
      setQuery("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          openDropdown();
        } else {
          setActiveIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(filteredOptions.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (open && filteredOptions.length > 0) {
          selectOption(activeIndex);
        }
        break;
      case "Escape":
        e.preventDefault();
        if (open) {
          setOpen(false);
          setQuery("");
        }
        break;
      case "Backspace":
        if (query === "" && value) {
          clearSelection();
        }
        break;
      default:
        break;
    }
  };

  const displayValue = open
    ? query
    : selectedOption
    ? selectedOption.label
    : query;

  const activeDescendant =
    open && filteredOptions.length > 0
      ? `${uid}-cb-option-${activeIndex}`
      : undefined;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label && (
        <label
          id={labelId}
          className="label"
          htmlFor={`${uid}-cb-input`}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-red-600">
              *
            </span>
          )}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={`${uid}-cb-input`}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          aria-labelledby={label ? labelId : undefined}
          autoComplete="off"
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "input pr-8",
            error && "border-red-500 focus:border-red-500"
          )}
        />
        <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
          {value ? (
            <button
              type="button"
              className="pointer-events-auto p-0.5 rounded text-text-tertiary"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                clearSelection();
              }}
              aria-label="Clear selection"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          ) : (
            <ChevronDownIcon
              className={cn(
                "w-4 h-4 transition-transform duration-150 text-text-tertiary",
                open && "rotate-180"
              )}
            />
          )}
        </div>
      </div>

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
          {isLoading ? (
            <li className="px-3 py-2 text-sm text-text-tertiary flex items-center gap-2" role="option" aria-selected={false}>
              <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
              Searching...
            </li>
          ) : filteredOptions.length === 0 ? (
            <li
              className="px-3 py-2 text-sm text-text-tertiary"
              role="option"
              aria-selected={false}
            >
              {emptyMessage}
            </li>
          ) : (
            filteredOptions.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  id={`${uid}-cb-option-${index}`}
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
                  {isSelected && (
                    <CheckIcon className="w-4 h-4 shrink-0 text-brand-600" />
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function ChevronDownIcon({
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

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
