import { describe, it, expect } from "vitest";
import { cartStorageKey, loadCart, saveCart } from "./cartStorage";
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

const item: StoreItem = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rice",
  price: "10.00",
  unit: "kg",
  inStock: true,
  sortOrder: 0,
  itemMode: "simple",
};
const line = (over: Partial<CartItem> = {}): CartItem => ({ item, quantity: 1, effectivePrice: "10.00", ...over });

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

  it("drops the old shared cart instead of showing it in whichever store opens first", () => {
    const storage = fakeStorage({ "hisaabo-store-cart": JSON.stringify([line()]) });
    expect(loadCart("shop-a", storage)).toEqual([]);
    expect(storage.data.has("hisaabo-store-cart")).toBe(false);
  });

  it("returns an empty cart for corrupt data", () => {
    const key = cartStorageKey("shop-a");
    expect(loadCart("shop-a", fakeStorage({ [key]: "not json" }))).toEqual([]);
    expect(loadCart("shop-a", fakeStorage({ [key]: '{"a":1}' }))).toEqual([]);
  });

  it("filters out malformed lines", () => {
    const key = cartStorageKey("shop-a");
    const stored = JSON.stringify([line(), { item: null, quantity: 1, effectivePrice: "1" }, { ...line(), quantity: 0 }, 7]);
    expect(loadCart("shop-a", fakeStorage({ [key]: stored }))).toEqual([line()]);
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
