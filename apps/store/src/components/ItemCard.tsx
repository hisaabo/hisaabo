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
  const symbol = currency === "INR" ? "\u20B9" : currency;
  const accent = accentColor || "var(--store-accent)";
  const outOfStock = !item.inStock && !item.lowStock;
  const lowStock = item.lowStock === true;

  return (
    <div
      className="product-card"
      style={{ opacity: outOfStock ? 0.55 : 1 }}
    >
      <div className="flex flex-col p-3.5 flex-1">
        {/* Category tag */}
        {item.category && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--store-muted)" }}
          >
            {item.category}
          </span>
        )}

        {/* Item name */}
        <h3
          className="text-[13.5px] font-semibold leading-snug line-clamp-2 mb-0.5"
          style={{ color: "var(--store-text)", letterSpacing: "-0.01em" }}
        >
          {item.name}
        </h3>

        {/* Description */}
        {item.description && (
          <p
            className="text-[11px] leading-relaxed line-clamp-2 mt-0.5"
            style={{ color: "var(--store-muted)" }}
          >
            {item.description}
          </p>
        )}

        {/* Spacer pushes price + action to bottom */}
        <div className="flex-1 min-h-3" />

        {/* Price row */}
        <div className="flex items-end justify-between gap-2 mt-2">
          <div>
            <p
              className="text-[15px] font-bold tracking-tight leading-tight"
              style={{ color: "var(--store-text)" }}
            >
              {symbol}{formatPrice(item.price)}
            </p>
            <p
              className="text-[10px] mt-0.5"
              style={{ color: "var(--store-muted)" }}
            >
              per {item.unit}
            </p>
          </div>

          {/* Action */}
          {outOfStock ? (
            <span className="badge badge-sold-out">Sold out</span>
          ) : lowStock ? (
            <div className="flex flex-col items-end gap-1">
              <span className="badge badge-low-stock">Low stock</span>
              {qty === 0 ? (
                <button
                  onClick={() => onAdd(item)}
                  className="add-btn"
                  style={{ borderColor: accent, color: accent }}
                  aria-label={`Add ${item.name}`}
                >
                  ADD
                </button>
              ) : (
                <QuantityStepper
                  qty={qty}
                  accent={accent}
                  onAdd={() => onAdd(item)}
                  onRemove={() => onRemove(item.id)}
                />
              )}
            </div>
          ) : qty === 0 ? (
            <button
              onClick={() => onAdd(item)}
              className="add-btn"
              style={{ borderColor: accent, color: accent }}
              aria-label={`Add ${item.name}`}
            >
              ADD
            </button>
          ) : (
            <QuantityStepper
              qty={qty}
              accent={accent}
              onAdd={() => onAdd(item)}
              onRemove={() => onRemove(item.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function QuantityStepper({
  qty,
  accent,
  onAdd,
  onRemove,
}: {
  qty: number;
  accent: string;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="qty-stepper" style={{ borderColor: accent }}>
      <button
        onClick={onRemove}
        style={{ color: accent }}
        aria-label="Remove"
      >
        {qty === 1 ? (
          <TrashIcon size={13} color={accent} />
        ) : (
          <span>&minus;</span>
        )}
      </button>
      <span className="qty-value" style={{ color: accent }}>
        {qty}
      </span>
      <button
        onClick={onAdd}
        className="qty-add"
        style={{ background: accent }}
        aria-label="Add more"
      >
        +
      </button>
    </div>
  );
}

function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (Number.isInteger(num)) return num.toLocaleString("en-IN");
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
