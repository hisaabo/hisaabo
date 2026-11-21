import { describe, it, expect } from "vitest";
import { MAX_IDS_PER_REQUEST, chunkIds, onlyRequestedItems } from "./catalogIds";
import type { StoreItem } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mkItem = (id: string): StoreItem => ({
  id,
  name: `Item ${id}`,
  price: "1.00",
  unit: "pcs",
  inStock: true,
  sortOrder: 0,
  itemMode: "simple",
});

describe("onlyRequestedItems", () => {
  it("keeps only the requested items, in the order returned", () => {
    const returned = [mkItem(uuid(1)), mkItem(uuid(2)), mkItem(uuid(3)), mkItem(uuid(4))];
    expect(onlyRequestedItems(returned, [uuid(4), uuid(2)]).map((i) => i.id)).toEqual([uuid(2), uuid(4)]);
  });

  it("filters out the first page an older API returns when it ignores ids", () => {
    // 24 unrelated items, as the first catalog page; the one asked for is not among them.
    const firstPage = Array.from({ length: 24 }, (_, i) => mkItem(uuid(i + 100)));
    expect(onlyRequestedItems(firstPage, [uuid(1)])).toEqual([]);
    // ...and when it happens to be on that page, only it is kept.
    expect(onlyRequestedItems(firstPage, [uuid(105)]).map((i) => i.id)).toEqual([uuid(105)]);
  });

  it("matches ids case-insensitively", () => {
    expect(onlyRequestedItems([mkItem(uuid(1))], [uuid(1).toUpperCase()])).toHaveLength(1);
    expect(onlyRequestedItems([mkItem("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")], ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])).toHaveLength(1);
  });

  it("returns nothing when nothing was requested", () => {
    expect(onlyRequestedItems([mkItem(uuid(1))], [])).toEqual([]);
  });
});

describe("chunkIds", () => {
  it("splits into requests of at most 50 ids", () => {
    const ids = Array.from({ length: 120 }, (_, i) => uuid(i));
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(chunks.flat()).toEqual(ids);
    expect(MAX_IDS_PER_REQUEST).toBe(50);
  });

  it("de-duplicates and lower-cases", () => {
    expect(chunkIds([uuid(1), uuid(1), uuid(2), "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"])).toEqual([
      [uuid(1), uuid(2), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ]);
  });

  it("sorts ids so the same set always gives the same requests", () => {
    const shuffled = [uuid(5), uuid(1), uuid(9), uuid(3)];
    expect(chunkIds(shuffled)).toEqual([[uuid(1), uuid(3), uuid(5), uuid(9)]]);
    expect(chunkIds([...shuffled].reverse())).toEqual(chunkIds(shuffled));
    const many = Array.from({ length: 70 }, (_, i) => uuid(i));
    expect(chunkIds([...many].reverse())).toEqual(chunkIds(many));
  });

  it("returns no requests for no ids", () => {
    expect(chunkIds([])).toEqual([]);
  });
});
