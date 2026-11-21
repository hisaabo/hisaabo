/**
 * Cart persistence. Every store is served from the same origin
 * (store.hisaabo.in/<slug>), so they share one localStorage; carts are keyed by
 * slug so a cart built for one store is never shown (or checked out) in another.
 */
import type { CartItem } from "./types";

const KEY_PREFIX = "hisaabo-store-cart";

export function cartStorageKey(slug: string): string {
  return `${KEY_PREFIX}:${slug.toLowerCase()}`;
}

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<CartItem>;
  return (
    typeof c.item === "object" &&
    c.item !== null &&
    typeof c.item.id === "string" &&
    typeof c.quantity === "number" &&
    Number.isFinite(c.quantity) &&
    c.quantity > 0 &&
    typeof c.effectivePrice === "string"
  );
}

// `storage` is injectable for tests. Defaulting to localStorage happens inside
// the try because merely touching it can throw when site data is blocked.
export function loadCart(slug: string, storage?: Pick<Storage, "getItem" | "removeItem">): CartItem[] {
  try {
    storage ??= localStorage;
    // Before carts were keyed by slug there was one shared list that cannot be
    // attributed to a store; drop it rather than risk showing it in the wrong one.
    storage.removeItem(KEY_PREFIX);
    const raw = storage.getItem(cartStorageKey(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCartItem) : [];
  } catch {
    return [];
  }
}

export function saveCart(slug: string, cart: CartItem[], storage?: Pick<Storage, "setItem">): void {
  try {
    storage ??= localStorage;
    storage.setItem(cartStorageKey(slug), JSON.stringify(cart));
  } catch {
    // Storage full or blocked (private mode): the cart still works in memory.
  }
}
