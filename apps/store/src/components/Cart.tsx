import type { CartItem, StoreConfig } from "../types";
import { cartItemKey } from "../types";

interface CartProps {
  cart: CartItem[];
  config: StoreConfig;
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  onClearItem: (key: string) => void;
  onClose: () => void;
  onCheckout: () => void;
  /** When true, renders as an inline flex column (desktop sidebar). No backdrop, no fixed positioning. */
  inline?: boolean;
}

export function Cart({
  cart,
  config,
  onAddToCart,
  onRemoveFromCart,
  onClearItem,
  onClose,
  onCheckout,
  inline = false,
}: CartProps) {
  const { business } = config;
  const symbol = business.currency === "INR" ? "\u20B9" : business.currency;
  const accent = business.accentColor || "var(--store-accent)";

  const subtotal = cart.reduce(
    (s, c) => s + parseFloat(c.effectivePrice) * c.quantity,
    0
  );

  const minOrder = business.minOrderAmount
    ? parseFloat(business.minOrderAmount)
    : 0;
  const belowMin = minOrder > 0 && subtotal < minOrder;

  if (inline) {
    // Desktop sidebar: full-height inline panel, no backdrop
    return (
      <div
        className="flex flex-col h-full"
        style={{ background: "var(--store-bg)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--store-border)" }}
        >
          <div>
            <h2
              className="text-lg font-bold"
              style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
            >
              Your Cart
            </h2>
            {cart.length > 0 && (
              <p className="text-xs mt-0.5" style={{ color: "var(--store-muted)" }}>
                {cart.reduce((s, c) => s + c.quantity, 0)} items
              </p>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <CartItemList
            cart={cart}
            symbol={symbol}
            accent={accent}
            onAddToCart={onAddToCart}
            onRemoveFromCart={onRemoveFromCart}
            onClearItem={onClearItem}
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
            accent={accent}
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
        className="modal-backdrop"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed z-40 flex flex-col
          bottom-0 left-0 right-0 rounded-t-2xl max-h-[85dvh]
          sm:top-0 sm:right-0 sm:bottom-0 sm:left-auto sm:w-[400px] sm:rounded-none sm:rounded-l-2xl sm:max-h-full
          animate-slide-up sm:animate-slide-in-right"
        style={{
          background: "var(--store-bg)",
          boxShadow: "var(--store-shadow-xl)",
        }}
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
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: "var(--store-border)" }}
        >
          <div>
            <h2
              className="text-lg font-bold"
              style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
            >
              Your Cart
            </h2>
            {cart.length > 0 && (
              <p className="text-xs mt-0.5" style={{ color: "var(--store-muted)" }}>
                {cart.reduce((s, c) => s + c.quantity, 0)} items
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
            style={{ background: "var(--store-bg-alt)" }}
            aria-label="Close cart"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <CartItemList
            cart={cart}
            symbol={symbol}
            accent={accent}
            onAddToCart={onAddToCart}
            onRemoveFromCart={onRemoveFromCart}
            onClearItem={onClearItem}
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
            accent={accent}
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
  accent,
  onAddToCart,
  onRemoveFromCart,
  onClearItem,
}: {
  cart: CartItem[];
  symbol: string;
  accent: string;
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  onClearItem: (key: string) => void;
}) {
  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-4 animate-float"
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
            width="32"
            height="32"
            style={{ color: "var(--store-muted)" }}
          >
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 01-8 0" />
          </svg>
        </div>
        <p
          className="font-semibold text-base"
          style={{ color: "var(--store-text)" }}
        >
          Your cart is empty
        </p>
        <p
          className="text-sm mt-1"
          style={{ color: "var(--store-muted)" }}
        >
          Browse items and add something you like
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {cart.map((entry, i) => (
        <CartRow
          key={cartItemKey(entry)}
          entry={entry}
          symbol={symbol}
          accent={accent}
          onAddToCart={onAddToCart}
          onRemoveFromCart={onRemoveFromCart}
          onClearItem={onClearItem}
          isLast={i === cart.length - 1}
        />
      ))}
    </div>
  );
}

function CartFooter({
  subtotal,
  symbol,
  minOrder,
  belowMin,
  deliveryNote,
  accent,
  onCheckout,
}: {
  subtotal: number;
  symbol: string;
  minOrder: number;
  belowMin: boolean;
  deliveryNote?: string;
  accent: string;
  onCheckout: () => void;
}) {
  return (
    <div
      className="border-t px-5 py-4 space-y-3"
      style={{ borderColor: "var(--store-border)" }}
    >
      {/* Delivery note */}
      {deliveryNote && (
        <div
          className="flex items-start gap-2 text-xs p-3 rounded-lg"
          style={{
            background: "var(--store-bg-secondary)",
            color: "var(--store-text-secondary)",
          }}
        >
          <InfoIcon />
          <span>{deliveryNote}</span>
        </div>
      )}

      {/* Minimum order warning */}
      {minOrder > 0 && belowMin && (
        <div
          className="flex items-start gap-2 text-xs p-3 rounded-lg"
          style={{
            background: "var(--store-danger-bg)",
            color: "var(--store-danger)",
          }}
        >
          <span className="font-medium">
            Minimum order: {symbol}
            {minOrder.toFixed(0)} &mdash; add {symbol}
            {(minOrder - subtotal).toFixed(0)} more
          </span>
        </div>
      )}

      {/* Subtotal */}
      <div className="flex justify-between items-center">
        <span
          className="text-sm"
          style={{ color: "var(--store-text-secondary)" }}
        >
          Subtotal
        </span>
        <span
          className="text-lg font-bold tabular-nums"
          style={{ color: "var(--store-text)" }}
        >
          {symbol}
          {subtotal.toFixed(2)}
        </span>
      </div>

      {/* Checkout button */}
      <button
        className="btn-primary w-full py-3.5 text-[15px]"
        onClick={onCheckout}
        disabled={belowMin}
        style={{ background: accent }}
      >
        Proceed to Checkout
        <ArrowRightIcon />
      </button>
    </div>
  );
}

function CartRow({
  entry,
  symbol,
  accent,
  onAddToCart,
  onRemoveFromCart,
  onClearItem,
  isLast,
}: {
  entry: CartItem;
  symbol: string;
  accent: string;
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  onClearItem: (key: string) => void;
  isLast: boolean;
}) {
  const key = cartItemKey(entry);
  const lineTotal = parseFloat(entry.effectivePrice) * entry.quantity;

  // Build display label for variant/unit selection
  let selectionLabel = "";
  if (entry.selectedVariantId && entry.item.variants) {
    const variant = entry.item.variants.find((v) => v.id === entry.selectedVariantId);
    if (variant) {
      selectionLabel = Object.values(variant.attributes).join(" / ");
    }
  } else if (entry.selectedUnit) {
    selectionLabel = entry.selectedUnit;
  }

  // Determine the display unit for "per X" label
  const displayUnit = entry.selectedUnit || entry.item.unit;

  return (
    <div
      className="flex items-center gap-3 py-3.5"
      style={
        !isLast
          ? { borderBottom: "1px solid var(--store-border-light)" }
          : undefined
      }
    >
      {/* Item info */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold leading-snug line-clamp-1"
          style={{ color: "var(--store-text)" }}
        >
          {entry.item.name}
          {selectionLabel && (
            <span
              className="font-normal text-xs ml-1"
              style={{ color: "var(--store-muted)" }}
            >
              ({selectionLabel})
            </span>
          )}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--store-muted)" }}>
          {symbol}
          {parseFloat(entry.effectivePrice).toFixed(0)} per {displayUnit}
        </p>
      </div>

      {/* Qty control */}
      <div
        className="flex items-center gap-0 flex-shrink-0 rounded-lg overflow-hidden"
        style={{ border: `1.5px solid var(--store-border)` }}
      >
        <button
          onClick={() => onRemoveFromCart(key)}
          className="w-7 h-7 flex items-center justify-center text-sm font-bold transition-colors hover:bg-gray-50"
          style={{ color: "var(--store-text-secondary)" }}
          aria-label="Remove one"
        >
          &minus;
        </button>
        <span
          className="w-7 text-center text-sm font-bold tabular-nums"
          style={{ color: "var(--store-text)" }}
        >
          {entry.quantity}
        </span>
        <button
          onClick={() =>
            onAddToCart({
              item: entry.item,
              selectedUnit: entry.selectedUnit,
              conversionFactor: entry.conversionFactor,
              selectedVariantId: entry.selectedVariantId,
              effectivePrice: entry.effectivePrice,
            })
          }
          className="w-7 h-7 flex items-center justify-center text-sm font-bold transition-colors hover:bg-gray-50"
          style={{ color: "var(--store-text-secondary)" }}
          aria-label="Add one more"
        >
          +
        </button>
      </div>

      {/* Line total */}
      <p
        className="text-sm font-bold tabular-nums w-16 text-right flex-shrink-0"
        style={{ color: "var(--store-text)" }}
      >
        {symbol}
        {lineTotal.toFixed(0)}
      </p>

      {/* Remove */}
      <button
        onClick={() => onClearItem(key)}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full transition-colors hover:bg-gray-100"
        style={{ color: "var(--store-muted)" }}
        title="Remove item"
        aria-label={`Remove ${entry.item.name} from cart`}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
      className="flex-shrink-0 mt-0.5"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
