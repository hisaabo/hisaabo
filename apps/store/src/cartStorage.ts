/**
 * Cart persistence. Every store is served from the same origin
 * (store.hisaabo.in/<slug>), so they share one localStorage; carts are keyed by
 * slug so a cart built for one store is never shown (or checked out) in another.
 *
 * Earlier versions kept a single shared list under `hisaabo-store-cart`. That
 * list cannot be attributed to a store by its key, so it is migrated lazily:
 * each store that loads claims the lines whose items it actually sells.
 */
import type { CartItem, StoreItem } from "./types";
import { cartItemKey } from "./types";
import { isUuid } from "./cartLink";

/** The pre-per-store shared cart key. */
export const LEGACY_CART_KEY = "hisaabo-store-cart";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function cartStorageKey(slug: string): string {
  return `${LEGACY_CART_KEY}:${slug.toLowerCase()}`;
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
export function loadCart(slug: string, storage?: Pick<Store, "getItem">): CartItem[] {
  try {
    storage ??= localStorage;
    const raw = storage.getItem(cartStorageKey(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCartItem) : [];
  } catch {
    return [];
  }
}

export function saveCart(slug: string, cart: CartItem[], storage?: Pick<Store, "setItem">): void {
  try {
    storage ??= localStorage;
    storage.setItem(cartStorageKey(slug), JSON.stringify(cart));
  } catch {
    // Storage full or blocked (private mode): the cart still works in memory.
  }
}

// ---------------------------------------------------------------------------
// Migrating the old shared cart
// ---------------------------------------------------------------------------

/**
 * Lines of the old shared cart, validated (a line's item id must be a UUID, as
 * catalog ids are). `null` when there is nothing readable to work with — no
 * key, or data that is not a JSON array — so the caller leaves it untouched.
 */
export function readLegacyCart(storage: Pick<Store, "getItem">): CartItem[] | null {
  const raw = storage.getItem(LEGACY_CART_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((line): line is CartItem => isCartItem(line) && isUuid(line.item.id));
}

/** Split old-cart lines into those whose item `storeItems` contains (`mine`) and the rest. */
export function partitionLegacyCart(
  legacy: CartItem[],
  storeItems: StoreItem[],
): { mine: CartItem[]; rest: CartItem[] } {
  const ids = new Set(storeItems.map((item) => item.id.toLowerCase()));
  const mine: CartItem[] = [];
  const rest: CartItem[] = [];
  for (const line of legacy) (ids.has(line.item.id.toLowerCase()) ? mine : rest).push(line);
  return { mine, rest };
}

/**
 * Add migrated lines to a store's cart. A line the cart already has (same
 * item+variant+unit) is kept as it is: what the shopper did in this store's own
 * cart outranks a leftover from the old shared one. Does not mutate its inputs.
 */
export function mergeLegacyLines(cart: CartItem[], migrated: CartItem[]): CartItem[] {
  const known = new Set(cart.map(cartItemKey));
  const next = [...cart];
  for (const line of migrated) {
    const key = cartItemKey(line);
    if (known.has(key)) continue;
    known.add(key);
    next.push(line);
  }
  return next;
}

/**
 * Move this store's lines out of the old shared cart into its own cart.
 *
 * `fetchItems` looks ids up in THIS store (see `fetchItemsByIds`); lines whose
 * item it returns move to the per-store cart (existing lines there win) and are
 * removed from the old list. Lines for other stores stay for them to claim, and
 * the old key is deleted only once nothing is left in it. Never throws: if the
 * lookup fails, or a write fails, the old key is left exactly as it was.
 *
 * Returns the lines moved, so the caller can add them to its in-memory cart.
 */
export async function migrateLegacyCart(
  slug: string,
  fetchItems: (ids: string[]) => Promise<StoreItem[]>,
  storage?: Store,
): Promise<CartItem[]> {
  try {
    storage ??= localStorage;
    const before = readLegacyCart(storage);
    if (!before) return [];
    if (before.length === 0) {
      storage.removeItem(LEGACY_CART_KEY);
      return [];
    }

    // Fetch everything first so a failure part-way through changes nothing.
    const found = await fetchItems([...new Set(before.map((l) => l.item.id.toLowerCase()))]);

    // Re-read: another tab may have migrated its store while the lookup ran.
    const legacy = readLegacyCart(storage);
    if (!legacy) return [];
    const { mine, rest } = partitionLegacyCart(legacy, found);
    if (mine.length === 0) return [];

    // The store's own cart is written first, so a failure never loses lines.
    storage.setItem(cartStorageKey(slug), JSON.stringify(mergeLegacyLines(loadCart(slug, storage), mine)));
    if (rest.length === 0) storage.removeItem(LEGACY_CART_KEY);
    else storage.setItem(LEGACY_CART_KEY, JSON.stringify(rest));
    return mine;
  } catch {
    return [];
  }
}
