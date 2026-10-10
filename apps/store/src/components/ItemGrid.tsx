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
  onOpenDetail?: (item: StoreItem) => void;
  /** A search/category fetch is in flight. */
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
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
  onOpenDetail,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: ItemGridProps) {
  // Search and category are applied by the server, so `items` is already filtered.
  if (items.length === 0 && loading) {
    return (
      <p
        className="py-20 text-center text-sm font-medium"
        style={{ color: "var(--store-muted)" }}
      >
        Loading items...
      </p>
    );
  }

  if (items.length === 0) {
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
            {items.length}{hasMore ? "+" : ""} {items.length === 1 && !hasMore ? "item" : "items"}
          </p>
        </div>
      )}

      {/* Product grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            cart={cart}
            onAddToCart={onAddToCart}
            onRemoveFromCart={onRemoveFromCart}
            currency={currency}
            accentColor={accentColor}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="px-6 py-2.5 text-sm font-semibold rounded-xl border active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{
              color: "var(--store-text)",
              background: "var(--store-bg)",
              borderColor: "var(--store-border)",
            }}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
