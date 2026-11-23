/**
 * Bill-line behaviour for items priced INCLUDING tax, shared by the web and mobile forms
 * (the conversion itself and the rounding caveats are in inclusive-price.ts).
 *
 * A bill line holds the tax-exclusive RATE; the server adds the GST on top. These helpers keep a
 * line that was derived from a tax-inclusive shelf price honest as the user edits it, show what the
 * bill really computes, and bring the whole bill back to its shelf total with the invoice round-off.
 */
import { calcLineItem, calcInvoiceTotals } from "./calc.js";
import { billRateFromItemPrice } from "./inclusive-price.js";
import { formatPaise, toPaiseExact } from "./decimal.js";
import { MAX_ROUND_OFF } from "./calc.js";
import type { InvoiceTotals } from "./calc.js";

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

/**
 * What the bill really computes for ONE unit of a line derived from a tax-inclusive price:
 * the rate, the GST the server takes on it (`calcLineItem`, round(rate x GST%)), and their sum.
 * `ties` is false when that sum misses the shelf price by a paisa or two (₹10.00 incl. 18%:
 * 8.47 + 1.52 = 9.99): the hint then says so, instead of promising a split that is not what is billed.
 * null when the line is not derived from an inclusive price, or carries no GST.
 */
export function inclusiveBreakdown(
  li: Pick<InclusiveLine, "inclusivePrice" | "taxPercent" | "unitPrice">,
): { inclusive: string; base: string; tax: string; total: string; ties: boolean } | null {
  if (!li.inclusivePrice) return null;
  try {
    const unit = calcLineItem({ unitPrice: li.unitPrice, quantity: "1", taxPercent: li.taxPercent || "0", discountPercent: "0" });
    if (unit.taxAmount === "0.00") return null;
    const inclusive = formatPaise(toPaiseExact(li.inclusivePrice)!);
    return { inclusive, base: unit.afterDiscount, tax: unit.taxAmount, total: unit.total, ties: unit.total === inclusive };
  } catch {
    return null;
  }
}

/**
 * The round-off that brings the lines derived from a tax-inclusive price back to their SHELF total:
 * the sum over those lines of (quantity x shelf price, less the line discount, exact) minus (what the
 * bill computes for the line). Positive = the bill is short of the shelf total. "0.00" when there is
 * no such line.
 */
export function inclusiveTieOut(
  lines: ReadonlyArray<Pick<InclusiveLine, "inclusivePrice" | "taxPercent" | "unitPrice"> & { quantity: string; discountPercent: string }>,
): string {
  let paise = 0n;
  for (const li of lines) {
    if (!li.inclusivePrice) continue;
    try {
      const shelf = calcLineItem({ unitPrice: li.inclusivePrice, quantity: li.quantity || "0", taxPercent: li.taxPercent || "0", discountPercent: li.discountPercent || "0", taxInclusive: true });
      const billed = calcLineItem({ unitPrice: li.unitPrice || "0", quantity: li.quantity || "0", taxPercent: li.taxPercent || "0", discountPercent: li.discountPercent || "0" });
      paise += toPaiseExact(shelf.total)! - toPaiseExact(billed.total)!;
    } catch {
      // a half-typed quantity: no tie-out for that line until it is a plain number
    }
  }
  return formatPaise(paise);
}

/**
 * The AUTO round-off of a new document, exactly (integer paise):
 *   desired total = raw total + tie-out        (back to the shelf prices of tax-inclusive lines)
 *   if the business rounds down: desired total = whole rupees at or below it
 *   round-off     = desired total - raw total
 * so a ₹10 incl. 18% bill (raw 9.99, tie-out +0.01) is 10.00, and with "round down" on, a raw total of
 * 10.37 stays 10.00. The server bounds a round-off to +/- MAX_ROUND_OFF; a result outside it falls back to
 * the plain rule (round down, or none) rather than a bill that cannot be saved.
 */
export function autoRoundOff(rawTotal: string, tieOut: string, roundDown: boolean): string {
  const raw = toPaiseExact(rawTotal) ?? 0n;
  const tie = toPaiseExact(tieOut) ?? 0n;
  const floorRupee = (p: bigint) => (p >= 0n ? (p / 100n) * 100n : -(((-p + 99n) / 100n) * 100n));
  const desired = (p: bigint) => (roundDown ? floorRupee(p) : p);
  let off = desired(raw + tie) - raw;
  const bound = toPaiseExact(MAX_ROUND_OFF)!;
  if (off > bound || off < -bound) off = desired(raw) - raw;
  return formatPaise(off);
}

/**
 * `calcInvoiceTotals` of plain bill lines with the round-off that brings tax-inclusive lines back to their shelf
 * total, for the forms that have no invoice discount, charges or round-off field of their own (mobile). The
 * round-off is in the result (`roundOff`) and is what the form must send with the document.
 */
export function calcTotalsWithShelfTieOut(
  lines: ReadonlyArray<Pick<InclusiveLine, "inclusivePrice" | "taxPercent" | "unitPrice"> & { quantity: string; discountPercent: string }>,
): InvoiceTotals {
  const plain = lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, taxPercent: l.taxPercent, discountPercent: l.discountPercent }));
  const raw = calcInvoiceTotals({ lineItems: plain });
  return calcInvoiceTotals({ lineItems: plain, roundOff: autoRoundOff(raw.total, inclusiveTieOut(lines), false) });
}
