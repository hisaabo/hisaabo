import type { StoreItem, CartItem } from "../types";
import { ItemCard } from "./ItemCard";

interface ItemGridProps {
  items: StoreItem[];
  cart: CartItem[];
  onAdd: (item: StoreItem) => void;
  onRemove: (itemId: string) => void;
  currency: string;
  accentColor?: string;
  search: string;
  activeCategory: string;
}

export function ItemGrid({
  items,
  cart,
  onAdd,
  onRemove,
  currency,
  accentColor,
  search,
  activeCategory,
}: ItemGridProps) {
  // Filter items client-side
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
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <span className="text-5xl mb-4">🔍</span>
        <p
          className="text-base font-semibold mb-1"
          style={{ color: "var(--store-text)" }}
        >
          No items found
        </p>
        <p className="text-sm" style={{ color: "var(--store-muted)" }}>
          {search
            ? `No results for "${search}"`
            : `No items in this category`}
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      {/* Section heading when category is active */}
      {activeCategory && (
        <p
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: "var(--store-muted)" }}
        >
          {activeCategory} · {filtered.length} items
        </p>
      )}

      {/* 2-col on mobile, 3-col on sm, 4-col on lg */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        }}
      >
        {filtered.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            cart={cart}
            onAdd={onAdd}
            onRemove={onRemove}
            currency={currency}
            accentColor={accentColor}
          />
        ))}
      </div>
    </div>
  );
}
