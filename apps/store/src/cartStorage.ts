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
/**
 * When the old shared cart was first seen (ms since epoch). Deliberately not of
 * the form `hisaabo-store-cart:<slug>`, so it can never collide with a store.
 */
export const LEGACY_SEEN_KEY = "hisaabo-store-cart-legacy-seen";
/** After this long the old shared cart is deleted, claimed or not. */
export const LEGACY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    // A catalog price can be null (no sale or store price set); the old store
    // kept such lines, with a price that never parsed, so they are not dropped.
    (c.effectivePrice == null || typeof c.effectivePrice === "string")
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

/** A usable old-cart line: well formed, with a catalog (UUID) item id. */
export function isLegacyLine(value: unknown): value is CartItem {
  return isCartItem(value) && isUuid(value.item.id);
}

/**
 * The entries of the old shared cart exactly as stored, or `null` when there is
 * no such key or its data is not a JSON array (the caller then leaves it alone).
 * Entries are not filtered: ones that fail validation must survive a migration.
 */
export function readLegacyCart(storage: Pick<Store, "getItem">): unknown[] | null {
  const raw = storage.getItem(LEGACY_CART_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Distinct (lower-cased) item ids of the usable lines, to look up in a store. */
export function legacyItemIds(entries: unknown[]): string[] {
  return [...new Set(entries.filter(isLegacyLine).map((line) => line.item.id.toLowerCase()))];
}

/**
 * Split old-cart entries into usable lines whose item `storeItems` contains
 * (`mine`) and everything else (`rest`), in their original order. `rest` keeps
 * entries that fail validation as they are: only a store that recognises a line
 * may take it out of the old cart.
 */
export function partitionLegacyCart(
  entries: unknown[],
  storeItems: StoreItem[],
): { mine: CartItem[]; rest: unknown[] } {
  const ids = new Set(storeItems.map((item) => item.id.toLowerCase()));
  const mine: CartItem[] = [];
  const rest: unknown[] = [];
  for (const entry of entries) {
    if (isLegacyLine(entry) && ids.has(entry.item.id.toLowerCase())) mine.push(entry);
    else rest.push(entry);
  }
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
 * Has the old shared cart been around for more than LEGACY_MAX_AGE_MS? The
 * first time it is seen the time is recorded (and it is not expired); a missing
 * or unreadable stamp is treated as first seen now.
 */
function legacyExpired(storage: Store, now: number): boolean {
  let seen = NaN;
  try {
    seen = Number(storage.getItem(LEGACY_SEEN_KEY));
  } catch {
    // treated as never seen
  }
  if (Number.isFinite(seen) && seen > 0) return now - seen > LEGACY_MAX_AGE_MS;
  try {
    storage.setItem(LEGACY_SEEN_KEY, String(now));
  } catch {
    // Without a stamp the old cart cannot expire; migrating still works.
  }
  return false;
}

function clearLegacy(storage: Store): void {
  for (const key of [LEGACY_CART_KEY, LEGACY_SEEN_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      // try the other key anyway
    }
  }
}

/**
 * Move this store's lines out of the old shared cart into its own cart.
 *
 * `fetchItems` looks ids up in THIS store (see `fetchItemsByIds`); lines whose
 * item it returns move to the per-store cart (existing lines there win) and are
 * removed from the old list. Lines for other stores, and entries that fail
 * validation, stay for later; the old key is deleted once nothing is left in
 * it, or once it is more than 30 days old (after this store has claimed what it
 * can), so the lookup does not repeat forever for lines nobody claims. Never
 * throws: if the lookup fails, or a write fails, the old key is left exactly as
 * it was.
 *
 * Returns the lines moved, so the caller can add them to its in-memory cart.
 */
export async function migrateLegacyCart(
  slug: string,
  fetchItems: (ids: string[]) => Promise<StoreItem[]>,
  storage?: Store,
  now: number = Date.now(),
): Promise<CartItem[]> {
  try {
    storage ??= localStorage;
    if (storage.getItem(LEGACY_CART_KEY) === null) {
      storage.removeItem(LEGACY_SEEN_KEY); // nothing left to age
      return [];
    }
    const expired = legacyExpired(storage, now);

    const before = readLegacyCart(storage);
    const ids = before ? legacyItemIds(before) : [];
    if (ids.length === 0) {
      // Nothing a store could claim: an empty list is just removed; anything
      // else (unreadable, or only unusable entries) is kept until it expires.
      if (expired || before?.length === 0) clearLegacy(storage);
      return [];
    }

    // Fetch everything first so a failure part-way through changes nothing.
    const found = await fetchItems(ids);

    // Re-read: another tab may have migrated its store while the lookup ran.
    const entries = readLegacyCart(storage);
    if (!entries) return [];
    const { mine, rest } = partitionLegacyCart(entries, found);

    // The store's own cart is written first, so a failure never loses lines.
    if (mine.length > 0) {
      storage.setItem(cartStorageKey(slug), JSON.stringify(mergeLegacyLines(loadCart(slug, storage), mine)));
    }
    if (rest.length === 0 || expired) clearLegacy(storage);
    else if (mine.length > 0) storage.setItem(LEGACY_CART_KEY, JSON.stringify(rest));
    return mine;
  } catch {
    return [];
  }
}
