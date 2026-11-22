import { billRateFromItemPrice } from "@hisaabo/shared";

/**
 * The rate a bill line starts with when `--rate` is not given: the item's SALE price.
 * A bill rate is tax-exclusive, so an item whose sale price includes GST ("Price
 * includes tax") is converted down at its GST rate (₹118 incl. 18% -> ₹100.00);
 * using it as is would tax the customer twice.
 */
export function defaultSaleRate(item: { salePrice?: string | null; taxPercent: string; taxInclusive?: boolean | null }): string {
  return billRateFromItemPrice({ price: item.salePrice, inclusive: item.taxInclusive === true, taxPercent: item.taxPercent }).rate;
}
