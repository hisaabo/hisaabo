import { describe, expect, it } from "vitest";
import { availabilityText, showLowStockBadge, stockState } from "./stock";
import type { StoreItem } from "./types";

function item(over: Partial<StoreItem> = {}): StoreItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Turmeric",
    price: "100.00",
    unit: "kg",
    inStock: true,
    sortOrder: 0,
    itemMode: "simple",
    ...over,
  };
}

describe("low-stock badge", () => {
  it("never shows for a store that holds no inventory", () => {
    // What the API sends for every item of an allow-negative-stock store with
    // zero stock on hand: inStock and lowStock together. This was the bug.
    const stockless = item({ inStock: true, lowStock: true });
    expect(showLowStockBadge(stockless)).toBe(false);
    expect(stockState(stockless).onDemand).toBe(true);
  });

  it("does not show for plain in-stock items", () => {
    expect(showLowStockBadge(item())).toBe(false);
    expect(showLowStockBadge(item({ lowStock: false }))).toBe(false);
  });

  it("shows only when the item tracks stock and is genuinely low", () => {
    expect(showLowStockBadge(item({ runningLow: true }))).toBe(true);
  });

  it("never shows for sold-out items, whatever the flags say", () => {
    expect(showLowStockBadge(item({ inStock: false, runningLow: true }))).toBe(false);
  });

  it("does not let the on-demand flag pass as running low", () => {
    expect(showLowStockBadge(item({ lowStock: true, runningLow: true }))).toBe(false);
  });

  it("follows the chosen variant's own flag, not the item's", () => {
    const variant = { id: "v1", attributes: { Size: "S" }, price: "10.00", inStock: true };
    expect(showLowStockBadge(item({ runningLow: true }), { kind: "variant", variant })).toBe(false);
    expect(showLowStockBadge(item(), { kind: "variant", variant: { ...variant, runningLow: true } })).toBe(true);
    expect(showLowStockBadge(item(), { kind: "variant", variant: { ...variant, runningLow: false } })).toBe(false);
  });

  it("never shows for a sold-out variant, whatever its flag says", () => {
    const variant = { id: "v1", attributes: { Size: "S" }, price: "10.00", inStock: false, runningLow: true };
    expect(showLowStockBadge(item(), { kind: "variant", variant })).toBe(false);
  });

  it("stays hidden when the API does not send the field at all", () => {
    // An API that predates runningLow: nothing on the item, nothing on the variants.
    const old = item({ inStock: true, lowStock: false, itemMode: "variants", variants: [{ id: "v1", attributes: { Size: "S" }, price: "10.00", inStock: true }] });
    expect(showLowStockBadge(old)).toBe(false);
    expect(showLowStockBadge(old, { kind: "variant", variant: old.variants![0] })).toBe(false);
  });
});

describe("stockState", () => {
  it("treats an item with no stock and no backorders as sold out", () => {
    expect(stockState(item({ inStock: false })).soldOut).toBe(true);
  });

  it("keeps an on-demand item orderable", () => {
    const state = stockState(item({ inStock: false, lowStock: true }));
    expect(state.soldOut).toBe(false);
    expect(state.onDemand).toBe(true);
  });

  it("follows the chosen variant", () => {
    const base = item({ itemMode: "variants" });
    const soldOutVariant = { id: "v1", attributes: { Size: "S" }, price: "10.00", inStock: false };
    expect(stockState(base, { kind: "variant", variant: soldOutVariant }).soldOut).toBe(true);
    expect(stockState(base, { kind: "variant", variant: { ...soldOutVariant, inStock: true } }).soldOut).toBe(false);
  });

  it("treats a combination that does not exist as sold out", () => {
    expect(stockState(item(), { kind: "no-match" }).soldOut).toBe(true);
  });
});

describe("availabilityText", () => {
  it("describes each state without claiming stock that is not held", () => {
    expect(availabilityText(stockState(item()))).toBe("In stock");
    expect(availabilityText(stockState(item({ lowStock: true })))).toBe("Available to order");
    expect(availabilityText(stockState(item({ runningLow: true })))).toBe("Only a few left");
    expect(availabilityText(stockState(item({ inStock: false })))).toBe("Sold out");
  });

  it("does not claim stock for a variant: its inStock is also true when orders are taken without stock", () => {
    const variant = { id: "v1", attributes: { Size: "S" }, price: "10.00", inStock: true };
    const variants = item({ itemMode: "variants" });
    expect(availabilityText(stockState(variants, { kind: "variant", variant }))).toBe("Available");
    expect(availabilityText(stockState(variants))).toBe("Available");
  });
});
