import type { CartItem, StoreConfig } from "../types";

interface CartProps {
  cart: CartItem[];
  config: StoreConfig;
  onAdd: (item: CartItem["item"]) => void;
  onRemove: (itemId: string) => void;
  onClearItem: (itemId: string) => void;
  onClose: () => void;
  onCheckout: () => void;
  /** When true, renders as an inline flex column (desktop sidebar). No backdrop, no fixed positioning. */
  inline?: boolean;
}

export function Cart({
  cart,
  config,
  onAdd,
  onRemove,
  onClearItem,
  onClose,
  onCheckout,
  inline = false,
}: CartProps) {
  const { business } = config;
  const symbol = business.currency === "INR" ? "₹" : business.currency;

  const subtotal = cart.reduce(
    (s, c) => s + parseFloat(c.item.price) * c.quantity,
    0
  );

  const minOrder = business.minOrderAmount
    ? parseFloat(business.minOrderAmount)
    : 0;
  const belowMin = minOrder > 0 && subtotal < minOrder;

  if (inline) {
    // Desktop sidebar: full-height inline panel, no backdrop
    return (
      <div className="flex flex-col h-full bg-white">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--store-border)" }}
        >
          <h2
            className="text-base font-bold"
            style={{ color: "var(--store-text)" }}
          >
            Your Order
            {cart.length > 0 && (
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: "var(--store-muted)" }}
              >
                {cart.reduce((s, c) => s + c.quantity, 0)} items
              </span>
            )}
          </h2>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <CartItemList
            cart={cart}
            symbol={symbol}
            onAdd={onAdd}
            onRemove={onRemove}
            onClearItem={onClearItem}
            accentColor={business.accentColor}
          />
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <CartFooter
            subtotal={subtotal}
            symbol={symbol}
            minOrder={minOrder}
            belowMin={belowMin}
            deliveryNote={business.deliveryNote}
            accentColor={business.accentColor}
            onCheckout={onCheckout}
          />
        )}
      </div>
    );
  }

  // Mobile/tablet overlay: backdrop + slide-up drawer
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/40 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed z-40 bg-white flex flex-col
          bottom-0 left-0 right-0 rounded-t-2xl max-h-[90dvh]
          sm:top-0 sm:right-0 sm:bottom-0 sm:left-auto sm:w-96 sm:rounded-none sm:rounded-l-2xl sm:max-h-full
          animate-slide-up sm:animate-slide-in-right"
        style={{ boxShadow: "0 -8px 32px rgb(0 0 0 / 0.12)" }}
      >
        {/* Handle bar (mobile only) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div
            className="w-10 h-1 rounded-full"
            style={{ background: "var(--store-border)" }}
          />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--store-border)" }}
        >
          <h2
            className="text-base font-bold"
            style={{ color: "var(--store-text)" }}
          >
            Your Order
            {cart.length > 0 && (
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: "var(--store-muted)" }}
              >
                {cart.reduce((s, c) => s + c.quantity, 0)} items
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-lg"
            aria-label="Close cart"
          >
            ✕
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <CartItemList
            cart={cart}
            symbol={symbol}
            onAdd={onAdd}
            onRemove={onRemove}
            onClearItem={onClearItem}
            accentColor={business.accentColor}
          />
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <CartFooter
            subtotal={subtotal}
            symbol={symbol}
            minOrder={minOrder}
            belowMin={belowMin}
            deliveryNote={business.deliveryNote}
            accentColor={business.accentColor}
            onCheckout={onCheckout}
          />
        )}
      </div>
    </>
  );
}

// ── Shared sub-components ──

function CartItemList({
  cart,
  symbol,
  onAdd,
  onRemove,
  onClearItem,
  accentColor,
}: {
  cart: CartItem[];
  symbol: string;
  onAdd: (item: CartItem["item"]) => void;
  onRemove: (itemId: string) => void;
  onClearItem: (itemId: string) => void;
  accentColor?: string;
}) {
  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <span className="text-5xl mb-3">🛒</span>
        <p className="font-semibold" style={{ color: "var(--store-text)" }}>
          Your cart is empty
        </p>
        <p className="text-sm mt-1" style={{ color: "var(--store-muted)" }}>
          Add items from the store
        </p>
      </div>
    );
  }

  return (
    <>
      {cart.map((entry) => (
        <CartRow
          key={entry.item.id}
          entry={entry}
          symbol={symbol}
          onAdd={onAdd}
          onRemove={onRemove}
          onClearItem={onClearItem}
          accentColor={accentColor}
        />
      ))}
    </>
  );
}

function CartFooter({
  subtotal,
  symbol,
  minOrder,
  belowMin,
  deliveryNote,
  accentColor,
  onCheckout,
}: {
  subtotal: number;
  symbol: string;
  minOrder: number;
  belowMin: boolean;
  deliveryNote?: string;
  accentColor?: string;
  onCheckout: () => void;
}) {
  return (
    <div
      className="border-t px-4 py-4 space-y-3"
      style={{ borderColor: "var(--store-border)" }}
    >
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--store-text-secondary)" }}>Subtotal</span>
          <span
            className="font-semibold"
            style={{ color: "var(--store-text)" }}
          >
            {symbol}
            {subtotal.toFixed(2)}
          </span>
        </div>
        {minOrder > 0 && belowMin && (
          <p className="text-xs" style={{ color: "var(--store-danger)" }}>
            Minimum order: {symbol}
            {minOrder.toFixed(0)} (add {symbol}
            {(minOrder - subtotal).toFixed(0)} more)
          </p>
        )}
        {deliveryNote && (
          <p className="text-xs" style={{ color: "var(--store-muted)" }}>
            {deliveryNote}
          </p>
        )}
      </div>

      <button
        className="btn-accent w-full"
        onClick={onCheckout}
        disabled={belowMin}
        style={accentColor ? { background: accentColor } : undefined}
      >
        Proceed to Checkout →
      </button>
    </div>
  );
}

function CartRow({
  entry,
  symbol,
  onAdd,
  onRemove,
  onClearItem,
  accentColor,
}: {
  entry: CartItem;
  symbol: string;
  onAdd: (item: CartItem["item"]) => void;
  onRemove: (itemId: string) => void;
  onClearItem: (itemId: string) => void;
  accentColor?: string;
}) {
  const lineTotal = parseFloat(entry.item.price) * entry.quantity;

  return (
    <div
      className="flex items-start gap-3 py-2 border-b last:border-b-0"
      style={{ borderColor: "var(--store-border)" }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold leading-snug"
          style={{ color: "var(--store-text)" }}
        >
          {entry.item.name}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--store-muted)" }}>
          {symbol}
          {parseFloat(entry.item.price).toFixed(0)} × {entry.quantity}{" "}
          {entry.item.unit}
        </p>
      </div>

      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <p
          className="text-sm font-bold tabular-nums"
          style={{ color: accentColor || "var(--store-accent)" }}
        >
          {symbol}
          {lineTotal.toFixed(0)}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onRemove(entry.item.id)}
            className="qty-btn"
            style={{
              background: accentColor || "var(--store-accent)",
              width: "1.5rem",
              height: "1.5rem",
              fontSize: "0.875rem",
            }}
            aria-label="Remove one"
          >
            −
          </button>
          <span
            className="w-5 text-center text-sm font-bold tabular-nums"
            style={{ color: "var(--store-text)" }}
          >
            {entry.quantity}
          </span>
          <button
            onClick={() => onAdd(entry.item)}
            className="qty-btn"
            style={{
              background: accentColor || "var(--store-accent)",
              width: "1.5rem",
              height: "1.5rem",
              fontSize: "0.875rem",
            }}
            aria-label="Add one"
          >
            +
          </button>
          <button
            onClick={() => onClearItem(entry.item.id)}
            className="ml-1 text-xs px-1.5 py-0.5 rounded"
            style={{
              color: "var(--store-muted)",
              background: "var(--store-bg-alt)",
            }}
            title="Remove item"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
