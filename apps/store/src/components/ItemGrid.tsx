import { useRef } from "react";
import type { StoreItem, CartItem } from "../types";
import { ItemCard, type CardLayout } from "./ItemCard";
import { Spinner, SearchIcon } from "./Icons";

interface ItemGridProps {
  items: StoreItem[];
  cart: CartItem[];
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  currency: string;
  search: string;
  activeCategory: string;
  onOpenDetail: (item: StoreItem) => void;
  /** A search/category fetch is in flight. */
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Photo cards when at least half of the catalog has a picture, text cards
 * otherwise. Judged on the unfiltered catalog only: a search or category that
 * happens to match photographed items must not re-flow the whole store.
 */
function useCardLayout(items: StoreItem[], filtered: boolean): CardLayout {
  const layout = useRef<CardLayout>("compact");
  if (!filtered && items.length > 0) {
    const withPhoto = items.filter((i) => i.primaryImageUrl).length;
    layout.current = withPhoto * 2 >= items.length ? "photo" : "compact";
  }
  return layout.current;
}

export function ItemGrid({
  items,
  cart,
  onAddToCart,
  onRemoveFromCart,
  currency,
  search,
  activeCategory,
  onOpenDetail,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: ItemGridProps) {
  const layout = useCardLayout(items, Boolean(search || activeCategory));

  // Search and category are applied by the server, so `items` is already filtered.
  if (items.length === 0 && loading) {
    return (
      <p role="status" className="empty" style={{ color: "var(--store-muted)" }}>
        Loading items...
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <SearchIcon size={24} />
        </div>
        <p className="font-semibold">No items found</p>
        <p className="text-sm mt-1" style={{ color: "var(--store-muted)" }}>
          {search ? `No results for "${search}"` : "No items in this category"}
        </p>
      </div>
    );
  }

  return (
    <div className="pt-5">
      {(activeCategory || search) && (
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <h2 className="co-h">{activeCategory || `Results for "${search}"`}</h2>
          <p className="text-sm" style={{ color: "var(--store-muted)" }}>
            {items.length}
            {hasMore ? "+" : ""} {items.length === 1 && !hasMore ? "item" : "items"}
          </p>
        </div>
      )}

      <div className="grid-products" data-layout={layout}>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            cart={cart}
            onAddToCart={onAddToCart}
            onRemoveFromCart={onRemoveFromCart}
            currency={currency}
            layout={layout}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-8">
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className="btn btn-outline">
            {loadingMore ? (
              <>
                <Spinner size={16} /> Loading...
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
