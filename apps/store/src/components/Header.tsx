import type { StoreConfig, CartItem } from "../types";
import { assetUrl } from "../api";

interface HeaderProps {
  config: StoreConfig;
  cart: CartItem[];
  search: string;
  onSearchChange: (v: string) => void;
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  onCartClick: () => void;
}

export function Header({
  config,
  cart,
  search,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  onCartClick,
}: HeaderProps) {
  const { business, categories } = config;
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);
  const accent = business.accentColor || "var(--store-accent)";

  return (
    <header className="sticky top-0 z-20">
      {/* Accent top line */}
      <div className="h-[3px]" style={{ background: accent }} />

      {/* Main header area */}
      <div
        className="px-4 sm:px-6 pt-5 pb-4"
        style={{ background: "var(--store-bg)" }}
      >
        {/* Business name + Cart row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          {business.logoUrl && (
            <img
              src={assetUrl(business.logoUrl)}
              alt={`${business.name} logo`}
              className="flex-shrink-0 rounded"
              style={{
                // Fixed max height; width scales proportionally via
                // object-contain so tall and wide logos both render cleanly.
                maxHeight: 56,
                maxWidth: 160,
                objectFit: "contain",
              }}
              onError={(e) => {
                // Defense-in-depth: if the logo endpoint returns the 1x1
                // placeholder (e.g. race condition right after delete) the
                // <img> will still decode; but if something fails outright
                // we hide the element rather than showing a broken icon.
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <h1
              className="text-[22px] sm:text-[26px] font-bold leading-tight truncate"
              style={{ color: "var(--store-text)", letterSpacing: "-0.03em" }}
            >
              {business.name}
            </h1>
            {business.tagline && (
              <p
                className="text-[13px] mt-0.5 truncate"
                style={{ color: "var(--store-muted)" }}
              >
                {business.tagline}
              </p>
            )}
          </div>

          {/* Cart button - mobile/tablet only */}
          <button
            onClick={onCartClick}
            className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full lg:hidden"
            style={{ background: "var(--store-bg-secondary)" }}
            aria-label={`Cart with ${cartCount} items`}
          >
            <CartIcon />
            {cartCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1 animate-scale-in"
                style={{ background: accent }}
              >
                {cartCount}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--store-muted)" }}
          >
            <SearchIcon />
          </span>
          <input
            type="search"
            placeholder={`Search in ${business.name}...`}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="store-input pl-9 pr-4 py-2.5 text-[13px]"
            style={{
              borderRadius: "var(--store-radius)",
              background: "var(--store-bg-secondary)",
              borderColor: "transparent",
            }}
          />
        </div>
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div style={{ background: "var(--store-bg)" }}>
          <div className="flex gap-2 overflow-x-auto px-4 sm:px-6 pb-3 scrollbar-hide">
            <CategoryPill
              label="All"
              active={activeCategory === ""}
              onClick={() => onCategoryChange("")}
              accent={accent}
            />
            {categories.map((cat) => (
              <CategoryPill
                key={cat}
                label={cat}
                active={activeCategory === cat}
                onClick={() => onCategoryChange(cat)}
                accent={accent}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom border */}
      <div
        className="h-px"
        style={{ background: "var(--store-border)" }}
      />
    </header>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
  accent,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-all whitespace-nowrap"
      style={
        active
          ? {
              background: accent,
              color: "white",
            }
          : {
              background: "var(--store-bg-secondary)",
              color: "var(--store-text-secondary)",
            }
      }
    >
      {label}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      width="16"
      height="16"
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
      style={{ color: "var(--store-text)" }}
    >
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}
