import type { StoreItem, CartItem } from "../types";
import { ItemCard } from "./ItemCard";

interface ItemGridProps {
  items: StoreItem[];
  cart: CartItem[];
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  currency: string;
  accentColor?: string;
  search: string;
  activeCategory: string;
}

export function ItemGrid({
  items,
  cart,
  onAddToCart,
  onRemoveFromCart,
  currency,
  accentColor,
  search,
  activeCategory,
}: ItemGridProps) {
  const filtered = items.filter((item) => {
    const matchesCategory =
      !activeCategory || item.category === activeCategory;
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description?.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
          style={{ background: "var(--store-bg-alt)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="24"
            height="24"
            style={{ color: "var(--store-muted)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <p
          className="text-[15px] font-semibold mb-1"
          style={{ color: "var(--store-text)" }}
        >
          No items found
        </p>
        <p className="text-[13px]" style={{ color: "var(--store-muted)" }}>
          {search
            ? `No results for "${search}"`
            : "No items in this category"}
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-5">
      {/* Category heading */}
      {activeCategory && (
        <div className="flex items-center justify-between mb-3">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--store-muted)" }}
          >
            {activeCategory}
          </p>
          <p className="text-[11px]" style={{ color: "var(--store-muted)" }}>
            {filtered.length} {filtered.length === 1 ? "item" : "items"}
          </p>
        </div>
      )}

      {/* Product grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            cart={cart}
            onAddToCart={onAddToCart}
            onRemoveFromCart={onRemoveFromCart}
            currency={currency}
            accentColor={accentColor}
          />
        ))}
      </div>
    </div>
  );
}
