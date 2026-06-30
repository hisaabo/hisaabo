import { describe, it, expect } from "vitest";
import { mergeWithFallback } from "../lib/og/top-sellers.js";
import type { OgSeller } from "../lib/og/types.js";

const seller = (id: string): OgSeller => ({
  itemId: id,
  name: `Item ${id}`,
  price: "100",
  imageStorageKey: null,
  imageMimeType: null,
  imageVersion: 0,
});

describe("mergeWithFallback", () => {
  it("keeps ranked order, then fills remaining slots from fallback", () => {
    const ranked = [seller("a"), seller("b")];
    const fallback = [seller("c"), seller("d"), seller("e")];
    const out = mergeWithFallback(ranked, fallback, 4);
    expect(out.map((s) => s.itemId)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not repeat an item already chosen via ranking", () => {
    const ranked = [seller("a"), seller("b")];
    const fallback = [seller("b"), seller("c")]; // 'b' overlaps
    const out = mergeWithFallback(ranked, fallback, 4);
    expect(out.map((s) => s.itemId)).toEqual(["a", "b", "c"]);
  });

  it("caps at the limit", () => {
    const ranked = [seller("a"), seller("b"), seller("c"), seller("d"), seller("e")];
    const out = mergeWithFallback(ranked, [], 4);
    expect(out).toHaveLength(4);
  });

  it("handles the empty/cold-start case", () => {
    expect(mergeWithFallback([], [], 4)).toEqual([]);
  });
});
