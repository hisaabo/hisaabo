import { billRateFromItemPrice } from "@hisaabo/shared";

export type BillSide = "sale" | "purchase";

interface PricedItem {
  salePrice?: string | null;
  purchasePrice?: string | null;
  taxPercent: string;
  taxInclusive?: boolean | null;
}

/** The saved price a bill of this side starts from: the SALE price on a sale-side document, the PURCHASE price on a purchase-side one. Never the other. */
export function savedPriceFor(item: PricedItem, side: BillSide): string | null {
  return (side === "purchase" ? item.purchasePrice : item.salePrice) || null;
}

/**
 * The rate a bill line starts with when `--rate` is not given, as on web and mobile: the item's SALE
 * price on a sale-side document and its PURCHASE price on a purchase-side one (a purchase bill used to
 * default to the sale price). A bill rate is tax-exclusive, so a sale price that includes GST ("Price
 * includes tax") is converted down at the item's GST rate (₹118 incl. 18% -> ₹100.00); using it as is
 * would tax the customer twice. Purchase prices are always tax-exclusive. "" when the item has no price
 * for that side.
 */
export function defaultBillRate(item: PricedItem, side: BillSide): string {
  const price = savedPriceFor(item, side);
  if (price === null) return "";
  return billRateFromItemPrice({ price, inclusive: side === "sale" && item.taxInclusive === true, taxPercent: item.taxPercent }).rate;
}

/** "no price" / "no purchase price" wording for messages. */
export function priceWord(side: BillSide): string {
  return side === "purchase" ? "purchase price" : "price";
}
