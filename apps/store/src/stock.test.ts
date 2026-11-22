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

  it("stays hidden for variants, which carry no low-stock signal", () => {
    const variant = { id: "v1", attributes: { Size: "S" }, price: "10.00", inStock: true };
    expect(showLowStockBadge(item({ runningLow: true }), { kind: "variant", variant })).toBe(false);
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
});
