import type { StoreItem } from "./types";

/**
 * What the storefront says about an item's stock.
 *
 * The catalog API sends `inStock` and `lowStock`, and `lowStock` does not mean
 * what its name says: the server sets `lowStock: allowNegativeStock && !inStock`,
 * i.e. "no stock on hand, but this store takes orders anyway". A farm that
 * holds no inventory therefore reports `lowStock` on every item, and showing a
 * "Low stock" badge for it is wrong twice over: nothing is low, nothing is
 * tracked.
 *
 * A badge for stock that is genuinely running low needs a signal the API does
 * not send yet: `runningLow`, true only for an item that tracks stock and whose
 * quantity is above zero but at or below its own low-stock alert level (both
 * are known to the server: `items.stockQuantity` and `items.lowStockAlert`).
 * Until the API sends it, the badge stays hidden for every item. That is the
 * conservative side of the rule: no badge is better than a false one.
 */

type Variant = NonNullable<StoreItem["variants"]>[number];

/** The shopper's current choice on an item with options. */
export type Selection =
  /** Nothing chosen yet, or a simple item: judge the item as a whole. */
  | { kind: "item" }
  /** One variant is chosen. */
  | { kind: "variant"; variant: Variant }
  /** The chosen combination of options does not exist. */
  | { kind: "no-match" };

export interface StockState {
  /** Nothing to buy: the Add control is replaced by "Sold out". */
  soldOut: boolean;
  /** Orderable although none is on hand (a store that takes orders without stock). */
  onDemand: boolean;
  /** Tracked stock that is genuinely running low. Drives the "Low stock" badge. */
  runningLow: boolean;
  /**
   * Stock is known to be on hand. True for an item judged as a whole; not for a
   * chosen variant, because a variant's `inStock` is also true when the store
   * takes orders without stock, and the API does not say which.
   */
  onHand: boolean;
}

export function stockState(item: StoreItem, selection: Selection = { kind: "item" }): StockState {
  if (selection.kind === "no-match") {
    return { soldOut: true, onDemand: false, runningLow: false, onHand: false };
  }
  if (selection.kind === "variant") {
    // Variants carry no low-stock signal: only sold out or not.
    return { soldOut: !selection.variant.inStock, onDemand: false, runningLow: false, onHand: false };
  }
  const onDemand = item.lowStock === true;
  return {
    soldOut: !item.inStock && !onDemand,
    onDemand,
    runningLow: item.inStock === true && !onDemand && item.runningLow === true,
    onHand: item.inStock === true && !onDemand && item.itemMode !== "variants",
  };
}

/** Whether to show the "Low stock" badge. The only place that decides. */
export function showLowStockBadge(item: StoreItem, selection: Selection = { kind: "item" }): boolean {
  return stockState(item, selection).runningLow;
}

/** The availability line of the item view. */
export function availabilityText(state: StockState): string {
  if (state.soldOut) return "Sold out";
  if (state.runningLow) return "Only a few left";
  if (state.onDemand) return "Available to order";
  return state.onHand ? "In stock" : "Available";
}
