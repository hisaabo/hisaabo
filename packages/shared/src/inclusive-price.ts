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
 * THE ROUNDING MISS (be precise about it): the BILL computes its tax as
 * round(rate × t%), not as gross − base, and a two-decimal rate cannot always reach
 * the shelf price. So even for ONE unit the bill can miss the shelf price by a paisa:
 * ₹10.00 incl. 18% is rate 8.47 + GST 1.52 = ₹9.99; ₹41 is 41.01; ₹2 is 1.99. Over
 * whole-rupee prices ₹1–₹5000 the single-unit bill misses the shelf price for about
 * 4.8% of prices at 5%, never at 12%, 15.2% at 18% (both directions), 12.5% at 28% and
 * 28.6% at 40% (see inclusive-price.sweep.test.ts, which pins the counts). The miss is
 * a paisa for small quantities and grows with quantity (PRICE_INCLUSIVE_ROUNDING).
 * The forms show the real figure on the line (`inclusiveBreakdown`) and bring a bill
 * back to its shelf total with the invoice's round-off (`inclusiveTieOut`,
 * `autoRoundOff`). A per-line "inclusive" flag, tax = gross − base, would remove the miss
 * at the source: planned with the invoice-line snapshot in 0.11.0 (compliance-audit.md,
 * Appendix C, design note).
 *
 * WHICH PRICES: the flag is documented, and honoured by the online store, as
 * "the SALE price includes GST". Purchase prices stay tax-exclusive (the buyer
 * claims input credit on the tax shown separately). `priceIsTaxInclusive` is the
 * one place that says so.
 */

import { divRoundHalfUp, formatPaise, parseDecimal, pow10, toPaiseExact, type Decimal } from "./decimal.js";

export const PRICE_INCLUSIVE_ROUNDING =
  "The tax-exclusive rate is rounded half-up to the paisa and the bill takes GST = round(rate x GST%) on it, so a bill " +
  "can miss quantity x shelf price by a paisa even for one unit (₹10.00 incl. 18% bills at 9.99); for quantity q the miss is " +
  "at most (0.5 + 0.5 x q) x (1 + GST%) + 0.5 paise (3 x ₹99.00 at 18%: 297.01; 10 x ₹99.00: 990.02). " +
  "Invoice round-off brings the bill back to the shelf total.";

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
  if (!input.inclusive || price === "") return { rate: price, inclusivePrice: null };
  const gross = toPaiseExact(price);
  const t = taxDecimal(input.taxPercent ?? "0");
  if (gross === null || t === null || t.int === 0n) return { rate: price, inclusivePrice: null };
  const { base } = splitInclusivePaise(gross, t);
  return { rate: formatPaise(base), inclusivePrice: formatPaise(gross) };
}
