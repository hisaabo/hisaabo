import { useEffect, useId, useRef } from "react";
import type { CartItem, StoreConfig } from "../types";
import { cartItemKey } from "../types";
import { cartPaise, formatMoney, formatPaise, linePaise, toPaise } from "../money";
import { Dialog } from "./Dialog";
import { Stepper } from "./AddControl";
import { AlertIcon, ArrowRightIcon, BagIcon, InfoIcon } from "./Icons";

interface CartProps {
  cart: CartItem[];
  config: StoreConfig;
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  onClearItem: (key: string) => void;
  onClose: () => void;
  onCheckout: () => void;
}

/**
 * The cart is a drawer over the page at every width, never a panel beside it.
 * A docked panel has to take its width from the grid, so the cards re-flow
 * the moment the first item is added or the panel opens. A drawer is a fixed
 * layer: nothing under it moves. The toolbar's cart button always shows the
 * count, so the cart is one tap away whether or not the drawer is open.
 */
export function Cart({ cart, config, onAddToCart, onRemoveFromCart, onClearItem, onClose, onCheckout }: CartProps) {
  const { business } = config;
  const currency = business.currency;
  const count = cart.reduce((s, c) => s + c.quantity, 0);

  // Focus must not fall to the page when the line holding it is removed.
  const listRef = useRef<HTMLUListElement>(null);
  const lines = cart.length;
  useEffect(() => {
    const active = document.activeElement;
    const dialog = listRef.current?.closest("[role='dialog']");
    if (dialog && (!active || active === document.body || !dialog.contains(active))) {
      listRef.current?.focus();
    }
  }, [lines]);

  return (
    <Dialog
      variant="drawer"
      onClose={onClose}
      closeLabel="Close cart"
      title={
        <>
          Your cart
          {count > 0 && (
            <span className="ml-2 text-sm font-normal" style={{ color: "var(--store-muted)", letterSpacing: 0 }}>
              {count} {count === 1 ? "item" : "items"}
            </span>
          )}
        </>
      }
      footer={cart.length > 0 ? <CartFooter cart={cart} config={config} onCheckout={onCheckout} /> : undefined}
    >
      {cart.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <BagIcon size={24} />
          </div>
          <p className="font-semibold">Your cart is empty</p>
          <p className="text-sm mt-1" style={{ color: "var(--store-muted)" }}>
            Add something from the store and it will show up here.
          </p>
          <button type="button" className="btn btn-outline mt-5" onClick={onClose}>
            Keep shopping
          </button>
        </div>
      ) : (
        <ul ref={listRef} tabIndex={-1} className="outline-none">
          {cart.map((entry) => (
            <CartRow
              key={cartItemKey(entry)}
              entry={entry}
              currency={currency}
              onAddToCart={onAddToCart}
              onRemoveFromCart={onRemoveFromCart}
              onClearItem={onClearItem}
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function CartFooter({
  cart,
  config,
  onCheckout,
}: {
  cart: CartItem[];
  config: StoreConfig;
  onCheckout: () => void;
}) {
  const { business } = config;
  const noteId = useId();
  const subtotal = cartPaise(cart);
  const minOrder = toPaise(business.minOrderAmount);
  const belowMin = minOrder > 0 && subtotal < minOrder;
  const pct = minOrder > 0 ? Math.min(100, Math.floor((subtotal / minOrder) * 100)) : 100;

  return (
    <div className="space-y-3">
      {business.deliveryNote && (
        <p className="note">
          <InfoIcon size={16} />
          <span>{business.deliveryNote}</span>
        </p>
      )}

      {belowMin && (
        <div id={noteId} className="note note-warn">
          <AlertIcon size={16} />
          <span className="flex-1">
            Minimum order is {formatPaise(minOrder, business.currency)}. Add{" "}
            {formatPaise(minOrder - subtotal, business.currency)} more to check out.
          </span>
          <div className="meter" style={{ ["--pct" as string]: `${pct}%` }} aria-hidden="true">
            <span />
          </div>
        </div>
      )}

      <div className="bill-row" style={{ alignItems: "baseline" }}>
        <span className="bill-name" style={{ color: "var(--store-text-secondary)" }}>
          Subtotal
        </span>
        <span className="bill-leader" />
        <span className="bill-amount" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, letterSpacing: "-0.02em" }}>
          {formatPaise(subtotal, business.currency)}
        </span>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={onCheckout}
        disabled={belowMin}
        aria-describedby={belowMin ? noteId : undefined}
      >
        Proceed to checkout
        <ArrowRightIcon size={18} />
      </button>
    </div>
  );
}

function CartRow({
  entry,
  currency,
  onAddToCart,
  onRemoveFromCart,
  onClearItem,
}: {
  entry: CartItem;
  currency: string;
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  onClearItem: (key: string) => void;
}) {
  const key = cartItemKey(entry);
  const name = entry.item.name;

  // What was chosen: a variant's attribute values, or the alternate unit.
  let choice = "";
  if (entry.selectedVariantId && entry.item.variants) {
    const variant = entry.item.variants.find((v) => v.id === entry.selectedVariantId);
    if (variant) choice = Object.values(variant.attributes).join(" / ");
  } else if (entry.selectedUnit) {
    choice = entry.selectedUnit;
  }
  const unit = entry.selectedUnit || entry.item.unit;

  return (
    <li className="cart-row">
      <div className="flex items-baseline justify-between gap-4">
        <p className="cart-row-name min-w-0">
          {name}
          {choice && (
            <span className="font-normal" style={{ color: "var(--store-text-secondary)" }}>
              {" "}
              ({choice})
            </span>
          )}
        </p>
        <p className="bill-amount">{formatPaise(linePaise(entry.effectivePrice, entry.quantity), currency)}</p>
      </div>
      <p className="cart-row-sub num">
        {formatMoney(entry.effectivePrice, currency)} per {unit}
      </p>
      <div className="cart-row-ctl">
        <Stepper
          name={name}
          qty={entry.quantity}
          onAdd={() =>
            onAddToCart({
              item: entry.item,
              selectedUnit: entry.selectedUnit,
              conversionFactor: entry.conversionFactor,
              selectedVariantId: entry.selectedVariantId,
              effectivePrice: entry.effectivePrice,
            })
          }
          onRemove={() => onRemoveFromCart(key)}
        />
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onClearItem(key)} aria-label={`Remove ${name} from cart`}>
          Remove
        </button>
      </div>
    </li>
  );
}
