import type { StoreItem, CartItem } from "../types";

interface ItemCardProps {
  item: StoreItem;
  cart: CartItem[];
  onAdd: (item: StoreItem) => void;
  onRemove: (itemId: string) => void;
  currency: string;
  accentColor?: string;
}

export function ItemCard({
  item,
  cart,
  onAdd,
  onRemove,
  currency,
  accentColor,
}: ItemCardProps) {
  const cartEntry = cart.find((c) => c.item.id === item.id);
  const qty = cartEntry?.quantity ?? 0;
  const symbol = currency === "INR" ? "₹" : currency;

  return (
    <div
      className="bg-white rounded-xl overflow-hidden flex flex-col"
      style={{
        boxShadow: "var(--store-card-shadow)",
        border: "1px solid var(--store-border)",
        transition: "box-shadow 0.15s ease, transform 0.15s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "var(--store-card-shadow-hover)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "var(--store-card-shadow)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* Image placeholder */}
      <div
        className="aspect-square flex items-center justify-center text-4xl"
        style={{ background: "var(--store-bg-alt)" }}
      >
        🛍️
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <p
          className="text-sm font-semibold leading-snug line-clamp-2"
          style={{ color: "var(--store-text)" }}
        >
          {item.name}
        </p>
        {item.description && (
          <p
            className="text-xs line-clamp-2 leading-relaxed"
            style={{ color: "var(--store-muted)" }}
          >
            {item.description}
          </p>
        )}
        <div className="mt-auto pt-2 flex items-end justify-between gap-1">
          <div>
            <p
              className="text-base font-bold leading-tight"
              style={{ color: accentColor || "var(--store-accent)" }}
            >
              {symbol}
              {parseFloat(item.price).toFixed(0)}
            </p>
            <p className="text-xs" style={{ color: "var(--store-muted)" }}>
              per {item.unit}
            </p>
          </div>

          {/* Add / Qty control */}
          {!item.inStock ? (
            <span
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{
                background: "var(--store-bg-alt)",
                color: "var(--store-muted)",
              }}
            >
              Out of stock
            </span>
          ) : qty === 0 ? (
            <button
              onClick={() => onAdd(item)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex-shrink-0"
              style={{ background: accentColor || "var(--store-accent)" }}
            >
              + Add
            </button>
          ) : (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => onRemove(item.id)}
                className="qty-btn text-sm"
                style={{ background: accentColor || "var(--store-accent)" }}
                aria-label="Remove one"
              >
                −
              </button>
              <span
                className="w-6 text-center text-sm font-bold tabular-nums"
                style={{ color: "var(--store-text)" }}
              >
                {qty}
              </span>
              <button
                onClick={() => onAdd(item)}
                className="qty-btn text-sm"
                style={{ background: accentColor || "var(--store-accent)" }}
                aria-label="Add one"
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
