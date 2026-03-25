import type { StoreConfig, CartItem } from "../types";

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
  const cartTotal = cart.reduce(
    (s, c) => s + parseFloat(c.item.price) * c.quantity,
    0
  );

  return (
    <header
      style={{ borderBottom: "1.5px solid var(--store-border)" }}
      className="sticky top-0 z-20 bg-white"
    >
      {/* Business info bar */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: "var(--store-accent)" }}
      >
        <div className="min-w-0">
          <h1
            className="text-white font-bold text-lg leading-tight truncate"
            style={{ letterSpacing: "-0.02em" }}
          >
            {business.name}
          </h1>
          {business.tagline && (
            <p className="text-white/75 text-xs mt-0.5 truncate">
              {business.tagline}
            </p>
          )}
        </div>

        {/* Cart button (header) — visible on desktop */}
        {cartCount > 0 && (
          <button
            onClick={onCartClick}
            className="hidden sm:flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white rounded-lg px-3 py-1.5 text-sm font-semibold flex-shrink-0"
          >
            <span>🛒</span>
            <span>{cartCount}</span>
            <span className="opacity-70">·</span>
            <span>
              {business.currency === "INR" ? "₹" : business.currency}
              {cartTotal.toFixed(0)}
            </span>
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="px-3 pt-2.5 pb-1">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base pointer-events-none">
            🔍
          </span>
          <input
            type="search"
            placeholder="Search items..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="store-input pl-9 py-2 text-sm"
          />
        </div>
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2.5 pt-1 scrollbar-hide">
          <CategoryPill
            label="All"
            active={activeCategory === ""}
            onClick={() => onCategoryChange("")}
            accent={business.accentColor}
          />
          {categories.map((cat) => (
            <CategoryPill
              key={cat}
              label={cat}
              active={activeCategory === cat}
              onClick={() => onCategoryChange(cat)}
              accent={business.accentColor}
            />
          ))}
        </div>
      )}

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
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium border transition-all"
      style={
        active
          ? {
              background: accent || "var(--store-accent)",
              color: "white",
              borderColor: accent || "var(--store-accent)",
            }
          : {
              background: "transparent",
              color: "var(--store-text-secondary)",
              borderColor: "var(--store-border)",
            }
      }
    >
      {label}
    </button>
  );
}
