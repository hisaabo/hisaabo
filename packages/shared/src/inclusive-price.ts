/**
 * Items priced INCLUDING tax ("Price includes tax", `items.tax_inclusive`).
 *
 * A bill line is always tax-exclusive: `unit_price` is the taxable rate and the
 * server adds the line's GST on top (calcLineItem without `taxInclusive`). An
 * item whose saved price already contains the GST therefore has to be converted
 * to its tax-exclusive rate when it is put on a bill, or the customer is taxed
 * twice (₹118 incl. 18% would become 118 + 21.24 = ₹139.24). Everything here is
 * exact integer-paise arithmetic (BigInt), rounded half-up once.
 *
 *   split:      base = round(gross × 100 / (100 + t)),  tax = gross − base
 *   back:       gross = round(base × (100 + t) / 100)
 *
 * `tax` is always gross − base, so base + tax equals the inclusive price to the
 * paisa. A rate that cannot be written in two decimals (₹99 incl. 18% is
 * ₹83.8983…) is rounded to 83.90; for one unit the bill then totals exactly ₹99.00
 * (83.90 + 15.10), for several units the rate × quantity can differ from
 * quantity × inclusive price by a paisa or two (see PRICE_INCLUSIVE_ROUNDING).
 *
 * WHICH PRICES: the flag is documented, and honoured by the online store, as
 * "the SALE price includes GST". Purchase prices stay tax-exclusive (the buyer
 * claims input credit on the tax shown separately). `priceIsTaxInclusive` is the
 * one place that says so.
 */

import { divRoundHalfUp, formatPaise, parseDecimal, pow10, toPaiseExact, type Decimal } from "./decimal.js";

export const PRICE_INCLUSIVE_ROUNDING =
  "The tax-exclusive rate is rounded half-up to the paisa. One unit ties to the inclusive price exactly; " +
  "for quantity > 1 the bill total can differ from quantity × inclusive price by at most a paisa per unit of quantity.";

/** Does an item's saved price on this side already include GST? Sale only: purchase prices are tax-exclusive. */
export function priceIsTaxInclusive(item: { taxInclusive?: boolean | null }, side: "sale" | "purchase"): boolean {
  return side === "sale" && item.taxInclusive === true;
}

/** gross (inclusive) paise → { base, tax } paise at `tax` percent, exact. */
export function splitInclusivePaise(gross: bigint, tax: Decimal): { base: bigint; tax: bigint } {
  const hundred = 100n * pow10(tax.scale);
  const base = divRoundHalfUp(gross * hundred, hundred + tax.int);
  return { base, tax: gross - base };
}

function taxDecimal(taxPercent: string | number): Decimal | null {
  const t = parseDecimal(taxPercent);
  return t && t.int >= 0n ? t : null;
}

/**
 * Split a tax-inclusive amount into its taxable value and its GST.
 * "118.00" at "18" -> { base: "100.00", tax: "18.00" }. Throws on input that is not a plain amount / rate.
 */
export function splitInclusive(gross: string | number, taxPercent: string | number): { base: string; tax: string } {
  const g = toPaiseExact(gross);
  const t = taxDecimal(taxPercent);
  if (g === null || t === null) throw new Error(`Cannot split "${gross}" at "${taxPercent}"% GST`);
  const { base, tax } = splitInclusivePaise(g, t);
  return { base: formatPaise(base), tax: formatPaise(tax) };
}

/** The tax-exclusive rate of a tax-inclusive price: splitInclusive(...).base. */
export function exclusiveRateFromInclusive(inclusivePrice: string | number, taxPercent: string | number): string {
  return splitInclusive(inclusivePrice, taxPercent).base;
}

/** The tax-inclusive price of a tax-exclusive rate: round(rate × (100 + t) / 100). */
export function inclusiveFromExclusive(rate: string | number, taxPercent: string | number): string {
  const b = toPaiseExact(rate);
  const t = taxDecimal(taxPercent);
  if (b === null || t === null) throw new Error(`Cannot add ${taxPercent}% GST to "${rate}"`);
  const hundred = 100n * pow10(t.scale);
  return formatPaise(divRoundHalfUp(b * (hundred + t.int), hundred));
}

export interface BillRate {
  /** The tax-exclusive rate to put in the bill line's rate field. */
  rate: string;
  /** The item's saved inclusive price the rate was derived from; null when no conversion happened. */
  inclusivePrice: string | null;
  /** The GST inside that price (per unit), for the "₹118 incl. GST → ₹100.00 + ₹18.00" hint; null with inclusivePrice. */
  unitTax: string | null;
}

/**
 * The rate a bill line should start with when an item's saved `price` is put on
 * it. Tax-exclusive prices (and purchase prices, and a 0% line, and anything that
 * is not a plain amount) pass through unchanged; a tax-inclusive sale price is
 * converted at the LINE's tax rate.
 */
export function billRateFromItemPrice(input: {
  price: string | null | undefined;
  /** True when this price includes tax, i.e. `priceIsTaxInclusive(item, side)`. */
  inclusive: boolean;
  taxPercent: string | number | null | undefined;
}): BillRate {
  const price = input.price ?? "";
  if (!input.inclusive || price === "") return { rate: price, inclusivePrice: null, unitTax: null };
  const gross = toPaiseExact(price);
  const t = taxDecimal(input.taxPercent ?? "0");
  if (gross === null || t === null || t.int === 0n) return { rate: price, inclusivePrice: null, unitTax: null };
  const { base, tax } = splitInclusivePaise(gross, t);
  return { rate: formatPaise(base), inclusivePrice: formatPaise(gross), unitTax: formatPaise(tax) };
}

// ── Bill-line behaviour shared by the web and mobile forms ───────────────────

/** The fields of a bill line that the inclusive-price behaviour reads and writes. */
export interface InclusiveLine {
  /** The tax-exclusive rate. */
  unitPrice: string;
  taxPercent: string;
  /** What the rate field held when the line was picked / re-derived (see price-propagation.ts). */
  originalUnitPrice?: string;
  /** The saved price WITH tax the rate was derived from; undefined once the user states the rate themselves. */
  inclusivePrice?: string;
  /** The picked item's sale price includes tax, so a unit / variant picked later is converted the same way. */
  itemPriceIncludesTax?: boolean;
}

/**
 * The price fields for a line that has just had an item's saved `price` put on it
 * (item pick, unit pick, variant pick). Spread the result into the line.
 */
export function lineFieldsFromItemPrice(input: {
  price: string | null | undefined;
  /** `priceIsTaxInclusive(item, side)` */
  inclusive: boolean;
  taxPercent: string | number | null | undefined;
}): Pick<InclusiveLine, "unitPrice" | "originalUnitPrice" | "inclusivePrice" | "itemPriceIncludesTax"> {
  const r = billRateFromItemPrice(input);
  return {
    unitPrice: r.rate,
    originalUnitPrice: r.rate,
    inclusivePrice: r.inclusivePrice ?? undefined,
    itemPriceIncludesTax: input.inclusive,
  };
}

/**
 * Apply an edit of one field of a bill line.
 *  - the RATE: the user is now stating the tax-exclusive rate, so it is no longer derived
 *    from the shelf price (`inclusivePrice` cleared) and later GST edits leave it alone;
 *  - the GST %: for a line derived from an inclusive price the shelf price stays what it is and the
 *    taxable rate follows (₹118 incl. at 12% is 105.36 + 12.64, not 100 + 12). The re-derived rate
 *    is also the new `originalUnitPrice`, so it is not mistaken for a price edit;
 *  - anything else: set as is.
 */
export function applyLineEdit<T extends InclusiveLine>(li: T, field: keyof T & string, value: string): T {
  if (field === "unitPrice") return { ...li, unitPrice: value, inclusivePrice: undefined };
  if (field === "taxPercent" && li.inclusivePrice) {
    const derived = billRateFromItemPrice({ price: li.inclusivePrice, inclusive: true, taxPercent: value || "0" });
    return { ...li, taxPercent: value, unitPrice: derived.rate, originalUnitPrice: derived.rate };
  }
  return { ...li, [field]: value };
}

/** "₹118.00 incl. GST -> ₹100.00 + ₹18.00" as numbers, or null when the line is not derived from an inclusive price (or has no GST). */
export function inclusiveBreakdown(li: Pick<InclusiveLine, "inclusivePrice" | "taxPercent">): { inclusive: string; base: string; tax: string } | null {
  if (!li.inclusivePrice) return null;
  try {
    const { base, tax } = splitInclusive(li.inclusivePrice, li.taxPercent || "0");
    return tax === "0.00" ? null : { inclusive: li.inclusivePrice, base, tax };
  } catch {
    return null;
  }
}
