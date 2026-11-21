import { describe, it, expect, vi } from "vitest";
import {
  LEGACY_CART_KEY,
  cartStorageKey,
  loadCart,
  saveCart,
  readLegacyCart,
  partitionLegacyCart,
  mergeLegacyLines,
  migrateLegacyCart,
} from "./cartStorage";
import type { CartItem, StoreItem } from "./types";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const ID_RICE = "11111111-1111-4111-8111-111111111111";
const ID_DAL = "22222222-2222-4222-8222-222222222222";
const ID_OIL = "33333333-3333-4333-8333-333333333333";
const ID_TEA = "44444444-4444-4444-8444-444444444444";
const VARIANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mkItem = (id: string, name: string, over: Partial<StoreItem> = {}): StoreItem => ({
  id,
  name,
  price: "10.00",
  unit: "kg",
  inStock: true,
  sortOrder: 0,
  itemMode: "simple",
  ...over,
});
const item = mkItem(ID_RICE, "Rice");
const line = (over: Partial<CartItem> = {}): CartItem => ({ item, quantity: 1, effectivePrice: "10.00", ...over });
const lineFor = (id: string, name: string, quantity = 1, over: Partial<CartItem> = {}): CartItem =>
  line({ item: mkItem(id, name), quantity, ...over });

const legacyJson = (lines: unknown[]) => JSON.stringify(lines);
const stored = (storage: ReturnType<typeof fakeStorage>, key: string) => {
  const raw = storage.data.get(key);
  return raw === undefined ? undefined : (JSON.parse(raw) as CartItem[]);
};

describe("cart storage", () => {
  it("keeps one cart per store, so stores never see each other's lines", () => {
    const storage = fakeStorage();
    saveCart("shop-a", [line({ quantity: 2 })], storage);
    saveCart("shop-b", [line({ quantity: 9 })], storage);
    expect(loadCart("shop-a", storage)[0]!.quantity).toBe(2);
    expect(loadCart("shop-b", storage)[0]!.quantity).toBe(9);
    expect(loadCart("shop-c", storage)).toEqual([]);
  });

  it("treats slugs case-insensitively", () => {
    expect(cartStorageKey("My-Shop")).toBe(cartStorageKey("my-shop"));
  });

  it("does not show the old shared cart in a store's own cart", () => {
    const storage = fakeStorage({ [LEGACY_CART_KEY]: legacyJson([line()]) });
    expect(loadCart("shop-a", storage)).toEqual([]);
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(true);
  });

  it("returns an empty cart for corrupt data", () => {
    const key = cartStorageKey("shop-a");
    expect(loadCart("shop-a", fakeStorage({ [key]: "not json" }))).toEqual([]);
    expect(loadCart("shop-a", fakeStorage({ [key]: '{"a":1}' }))).toEqual([]);
  });

  it("filters out malformed lines", () => {
    const key = cartStorageKey("shop-a");
    const bad = [line(), { item: null, quantity: 1, effectivePrice: "1" }, { ...line(), quantity: 0 }, 7];
    expect(loadCart("shop-a", fakeStorage({ [key]: JSON.stringify(bad) }))).toEqual([line()]);
  });

  it("survives storage that throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadCart("shop-a", hostile)).toEqual([]);
    expect(() => saveCart("shop-a", [line()], hostile)).not.toThrow();
  });
});

describe("readLegacyCart", () => {
  it("returns null when there is no old cart or it is unreadable", () => {
    expect(readLegacyCart(fakeStorage())).toBeNull();
    expect(readLegacyCart(fakeStorage({ [LEGACY_CART_KEY]: "" }))).toBeNull();
    expect(readLegacyCart(fakeStorage({ [LEGACY_CART_KEY]: "not json" }))).toBeNull();
    expect(readLegacyCart(fakeStorage({ [LEGACY_CART_KEY]: '{"a":1}' }))).toBeNull();
    expect(readLegacyCart(fakeStorage({ [LEGACY_CART_KEY]: "null" }))).toBeNull();
  });

  it("keeps well-formed lines and drops malformed ones, including non-UUID item ids", () => {
    const junk = [
      line(),
      { item: { id: "rice" }, quantity: 1, effectivePrice: "1" },
      { item: null, quantity: 1, effectivePrice: "1" },
      { item: { id: ID_DAL }, quantity: -2, effectivePrice: "1" },
      { item: { id: ID_DAL }, quantity: 1, effectivePrice: 5 },
      "x",
      null,
    ];
    const res = readLegacyCart(fakeStorage({ [LEGACY_CART_KEY]: legacyJson(junk) }));
    expect(res).toEqual([line()]);
  });

  it("returns an empty list for an empty array", () => {
    expect(readLegacyCart(fakeStorage({ [LEGACY_CART_KEY]: "[]" }))).toEqual([]);
  });
});

describe("partitionLegacyCart", () => {
  const legacy = [lineFor(ID_RICE, "Rice", 2), lineFor(ID_OIL, "Oil", 1), lineFor(ID_DAL, "Dal", 3)];

  it("splits lines by whether this store sells the item, keeping order", () => {
    const { mine, rest } = partitionLegacyCart(legacy, [mkItem(ID_DAL, "Dal"), mkItem(ID_RICE, "Rice")]);
    expect(mine.map((l) => l.item.id)).toEqual([ID_RICE, ID_DAL]);
    expect(rest.map((l) => l.item.id)).toEqual([ID_OIL]);
  });

  it("matches ids case-insensitively", () => {
    const { mine } = partitionLegacyCart(legacy, [mkItem(ID_RICE.toUpperCase(), "Rice")]);
    expect(mine).toHaveLength(1);
  });

  it("moves nothing when the store sells none of them", () => {
    const { mine, rest } = partitionLegacyCart(legacy, []);
    expect(mine).toEqual([]);
    expect(rest).toEqual(legacy);
  });

  it("keeps every line of a claimed item, whatever its variant or unit", () => {
    const lines = [
      lineFor(ID_RICE, "Rice", 1),
      lineFor(ID_RICE, "Rice", 2, { selectedUnit: "sack", conversionFactor: 25, effectivePrice: "200.00" }),
      lineFor(ID_RICE, "Rice", 3, { selectedVariantId: VARIANT }),
    ];
    expect(partitionLegacyCart(lines, [mkItem(ID_RICE, "Rice")]).mine).toHaveLength(3);
  });

  it("does not mutate its inputs", () => {
    const copy = JSON.stringify(legacy);
    partitionLegacyCart(legacy, [mkItem(ID_RICE, "Rice")]);
    expect(JSON.stringify(legacy)).toBe(copy);
  });
});

describe("mergeLegacyLines", () => {
  it("appends migrated lines the store's cart does not have", () => {
    const merged = mergeLegacyLines([lineFor(ID_RICE, "Rice", 2)], [lineFor(ID_DAL, "Dal", 3)]);
    expect(merged.map((l) => [l.item.id, l.quantity])).toEqual([
      [ID_RICE, 2],
      [ID_DAL, 3],
    ]);
  });

  it("lets the store's existing line win on a conflict", () => {
    const merged = mergeLegacyLines([lineFor(ID_RICE, "Rice", 2)], [lineFor(ID_RICE, "Rice", 9)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quantity).toBe(2);
  });

  it("treats a different unit or variant of the same item as a different line", () => {
    const merged = mergeLegacyLines(
      [lineFor(ID_RICE, "Rice", 2)],
      [
        lineFor(ID_RICE, "Rice", 4, { selectedUnit: "sack", conversionFactor: 25 }),
        lineFor(ID_RICE, "Rice", 5, { selectedVariantId: VARIANT }),
      ],
    );
    expect(merged.map((l) => l.quantity)).toEqual([2, 4, 5]);
  });

  it("keeps only the first of duplicate migrated lines and never mutates its inputs", () => {
    const cart = [lineFor(ID_RICE, "Rice", 2)];
    const snapshot = JSON.stringify(cart);
    const merged = mergeLegacyLines(cart, [lineFor(ID_DAL, "Dal", 1), lineFor(ID_DAL, "Dal", 8)]);
    expect(merged.map((l) => l.quantity)).toEqual([2, 1]);
    expect(JSON.stringify(cart)).toBe(snapshot);
  });
});

describe("migrateLegacyCart", () => {
  const sells = (...items: StoreItem[]) => vi.fn(async (ids: string[]) => items.filter((i) => ids.includes(i.id)));
  const slugKey = cartStorageKey("shop-a");

  it("moves this store's lines into its cart and leaves other stores' lines for them", async () => {
    const storage = fakeStorage({
      [LEGACY_CART_KEY]: legacyJson([lineFor(ID_RICE, "Rice", 2), lineFor(ID_OIL, "Oil", 1), lineFor(ID_DAL, "Dal", 3)]),
    });
    const fetchItems = sells(mkItem(ID_RICE, "Rice"), mkItem(ID_DAL, "Dal"));
    const moved = await migrateLegacyCart("shop-a", fetchItems, storage);

    expect(moved.map((l) => l.item.id)).toEqual([ID_RICE, ID_DAL]);
    expect(stored(storage, slugKey)!.map((l) => [l.item.id, l.quantity])).toEqual([
      [ID_RICE, 2],
      [ID_DAL, 3],
    ]);
    expect(stored(storage, LEGACY_CART_KEY)!.map((l) => l.item.id)).toEqual([ID_OIL]);
    // Asked the store about each distinct id once.
    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(fetchItems.mock.calls[0]![0].sort()).toEqual([ID_DAL, ID_OIL, ID_RICE].sort());
  });

  it("deletes the old key once nothing is left in it", async () => {
    const storage = fakeStorage({ [LEGACY_CART_KEY]: legacyJson([lineFor(ID_RICE, "Rice", 2)]) });
    await migrateLegacyCart("shop-a", sells(mkItem(ID_RICE, "Rice")), storage);
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(false);
    expect(stored(storage, slugKey)).toHaveLength(1);
  });

  it("lets lines already in the store's cart win, and only moves the rest", async () => {
    const storage = fakeStorage({
      [slugKey]: JSON.stringify([lineFor(ID_RICE, "Rice", 7)]),
      [LEGACY_CART_KEY]: legacyJson([lineFor(ID_RICE, "Rice", 2), lineFor(ID_DAL, "Dal", 3)]),
    });
    await migrateLegacyCart("shop-a", sells(mkItem(ID_RICE, "Rice"), mkItem(ID_DAL, "Dal")), storage);
    expect(stored(storage, slugKey)!.map((l) => [l.item.id, l.quantity])).toEqual([
      [ID_RICE, 7],
      [ID_DAL, 3],
    ]);
    // The conflicting old line is gone from the old list too.
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(false);
  });

  it("lets each store claim its own lines in turn", async () => {
    const storage = fakeStorage({
      [LEGACY_CART_KEY]: legacyJson([lineFor(ID_RICE, "Rice", 2), lineFor(ID_TEA, "Tea", 4)]),
    });
    await migrateLegacyCart("shop-a", sells(mkItem(ID_RICE, "Rice")), storage);
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(true);
    await migrateLegacyCart("shop-b", sells(mkItem(ID_TEA, "Tea")), storage);
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(false);
    expect(stored(storage, cartStorageKey("shop-a"))!.map((l) => l.item.id)).toEqual([ID_RICE]);
    expect(stored(storage, cartStorageKey("shop-b"))!.map((l) => l.item.id)).toEqual([ID_TEA]);
  });

  it("changes nothing when the store sells none of the items", async () => {
    const original = legacyJson([lineFor(ID_OIL, "Oil", 1)]);
    const storage = fakeStorage({ [LEGACY_CART_KEY]: original });
    expect(await migrateLegacyCart("shop-a", sells(), storage)).toEqual([]);
    expect(storage.data.get(LEGACY_CART_KEY)).toBe(original);
    expect(storage.data.has(slugKey)).toBe(false);
  });

  it("leaves the old cart untouched when the lookup fails", async () => {
    const original = legacyJson([lineFor(ID_RICE, "Rice", 2)]);
    const storage = fakeStorage({ [LEGACY_CART_KEY]: original });
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(migrateLegacyCart("shop-a", failing, storage)).resolves.toEqual([]);
    expect(storage.data.get(LEGACY_CART_KEY)).toBe(original);
    expect(storage.data.has(slugKey)).toBe(false);
  });

  it("leaves the old cart untouched when the store's cart cannot be written", async () => {
    const original = legacyJson([lineFor(ID_RICE, "Rice", 2)]);
    const storage = fakeStorage({ [LEGACY_CART_KEY]: original });
    const failingWrites = {
      ...storage,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    await expect(migrateLegacyCart("shop-a", sells(mkItem(ID_RICE, "Rice")), failingWrites)).resolves.toEqual([]);
    expect(storage.data.get(LEGACY_CART_KEY)).toBe(original);
  });

  it("does not look anything up when there is no old cart, or it is unreadable", async () => {
    const fetchItems = sells(mkItem(ID_RICE, "Rice"));
    await migrateLegacyCart("shop-a", fetchItems, fakeStorage());
    const garbled = fakeStorage({ [LEGACY_CART_KEY]: "{oops" });
    await migrateLegacyCart("shop-a", fetchItems, garbled);
    expect(fetchItems).not.toHaveBeenCalled();
    expect(garbled.data.get(LEGACY_CART_KEY)).toBe("{oops");
  });

  it("removes an old cart that holds no usable lines", async () => {
    const storage = fakeStorage({ [LEGACY_CART_KEY]: legacyJson([{ item: { id: "x" }, quantity: 1, effectivePrice: "1" }]) });
    const fetchItems = sells();
    await migrateLegacyCart("shop-a", fetchItems, storage);
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(false);
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("re-reads the old cart after the lookup, so a concurrent migration is not undone", async () => {
    const storage = fakeStorage({
      [LEGACY_CART_KEY]: legacyJson([lineFor(ID_RICE, "Rice", 2), lineFor(ID_TEA, "Tea", 4)]),
    });
    // While this store's lookup is in flight, another tab claims the tea.
    const fetchItems = vi.fn(async (ids: string[]) => {
      storage.setItem(LEGACY_CART_KEY, legacyJson([lineFor(ID_RICE, "Rice", 2)]));
      return [mkItem(ID_RICE, "Rice"), mkItem(ID_TEA, "Tea")].filter((i) => ids.includes(i.id));
    });
    await migrateLegacyCart("shop-a", fetchItems, storage);
    // The tea was already claimed elsewhere, so it is not resurrected here.
    expect(stored(storage, slugKey)!.map((l) => l.item.id)).toEqual([ID_RICE]);
    expect(storage.data.has(LEGACY_CART_KEY)).toBe(false);
  });

  it("never throws, even when storage itself is unusable", async () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    await expect(migrateLegacyCart("shop-a", sells(), hostile)).resolves.toEqual([]);
  });
});
