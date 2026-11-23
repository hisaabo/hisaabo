import { money } from "./money.js";
import { divRoundHalfUp, formatPaise, parseDecimal, pow10, toPaiseExact } from "./decimal.js";
import { splitInclusivePaise } from "./inclusive-price.js";

export interface LineItemInput {
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  taxInclusive?: boolean; // if true, unitPrice includes tax
}

export interface LineItemResult {
  subtotal: string;       // qty * price (tax-exclusive base)
  discountAmount: string; // subtotal * (disc / 100)
  afterDiscount: string;  // subtotal - discountAmount
  taxAmount: string;      // tax on afterDiscount
  total: string;          // afterDiscount + taxAmount (or original amount if tax-inclusive)
}

/**
 * A tax-INCLUSIVE line, in exact integer paise (BigInt): the customer pays
 *
 *   gross       = qty x unitPrice                      (round half-up, once)
 *   total       = gross - discount%                    (the discount is taken off the inclusive amount, once)
 *   afterDiscount = total / (1 + t)  = round(total x 100 / (100 + t))
 *   taxAmount   = total - afterDiscount
 *
 * so `total` is exactly qty x price less the discount, and `afterDiscount + taxAmount = total`
 * to the paisa whatever the rounding. (The old float version rounded the per-unit base first and
 * multiplied after, which drifted from the inclusive total for quantities above 1.)
 * `subtotal` is the tax-exclusive value before the discount; `discountAmount` = subtotal - afterDiscount.
 * Throws when an input is not a plain decimal (see `calcLineItem`).
 */
function calcInclusiveLine(item: LineItemInput): LineItemResult {
  const unit = toPaiseExact(item.unitPrice);
  const qty = parseDecimal(item.quantity);
  const disc = parseDecimal(item.discountPercent || "0");
  const tax = parseDecimal(item.taxPercent || "0");
  // Falling through to the tax-exclusive formula here would silently bill a tax-inclusive price as if it were
  // exclusive (₹118 incl. 18% -> 118 + 21.24): refuse instead. Validated input is always a plain decimal, so this
  // is only reachable from a half-typed form field (".5", "2.", "1e-1"), which the forms already catch.
  if (unit === null) throw new Error(`calcLineItem: unit price "${item.unitPrice}" is not a plain amount`);
  if (!qty) throw new Error(`calcLineItem: quantity "${item.quantity}" is not a plain number`);
  if (!disc) throw new Error(`calcLineItem: discount "${item.discountPercent}" is not a plain percentage`);
  if (!tax) throw new Error(`calcLineItem: GST rate "${item.taxPercent}" is not a plain percentage`);

  const gross = divRoundHalfUp(unit * qty.int, pow10(qty.scale));
  const discountOnGross = divRoundHalfUp(gross * disc.int, 100n * pow10(disc.scale));
  const total = gross - discountOnGross;

  const subtotal = splitInclusivePaise(gross, tax).base;
  const afterDiscount = splitInclusivePaise(total, tax).base;
  return {
    subtotal: formatPaise(subtotal),
    discountAmount: formatPaise(subtotal - afterDiscount),
    afterDiscount: formatPaise(afterDiscount),
    taxAmount: formatPaise(total - afterDiscount),
    total: formatPaise(total),
  };
}

export function calcLineItem(item: LineItemInput): LineItemResult {
  if (item.taxInclusive) return calcInclusiveLine(item);

  // Tax-exclusive (default)
  const subtotal = money.mul(item.unitPrice, item.quantity);
  const discountAmount = money.percent(subtotal, item.discountPercent);
  const afterDiscount = money.sub(subtotal, discountAmount);
  const taxAmount = money.percent(afterDiscount, item.taxPercent);
  const total = money.add(afterDiscount, taxAmount);

  return { subtotal, discountAmount, afterDiscount, taxAmount, total };
}

/**
 * The intra-state CGST / SGST of a document: the sum of each LINE's tax split
 * with `money.splitHalf` (the odd paisa of every line goes to CGST). This is how
 * the e-invoice (IRP) payload splits GST, so it is the single source of truth for
 * the ledger, the ITC ledger, GSTR-1 / 3B / 9, the invoice PDF and the e-way
 * bill. The two halves always add up to the sum of the line taxes.
 */
export function splitGstByLine(lineTaxes: Array<string | number>): { cgst: string; sgst: string } {
  let cgst = "0.00";
  let sgst = "0.00";
  for (const tax of lineTaxes) {
    const [c, s] = money.splitHalf(tax);
    cgst = money.add(cgst, c);
    sgst = money.add(sgst, s);
  }
  return { cgst, sgst };
}

/**
 * [CGST, SGST] of a document from its line taxes (`splitGstByLine`), falling
 * back to splitting the document's `taxAmount` as one amount when there are no
 * lines or they do not add up to it (a legacy import, a document without items).
 */
export function splitDocumentGst(
  taxAmount: string | number,
  lineTaxes: ReadonlyArray<string | number>,
): [string, string] {
  const tax = money.add(taxAmount, "0");
  const lines = splitGstByLine([...lineTaxes]);
  if (lineTaxes.length > 0 && money.compare(money.add(lines.cgst, lines.sgst), tax) === 0) {
    return [lines.cgst, lines.sgst];
  }
  return money.splitHalf(tax);
}

export interface InvoiceTotalsInput {
  lineItems: LineItemInput[];
  charges?: Array<{ amount: string }>;
  roundOff?: string;
  invoiceDiscount?: string;
  invoiceDiscountType?: "amount" | "percent";
}

export interface InvoiceTotals {
  subtotal: string;
  lineDiscountTotal: string;
  invoiceDiscountAmount: string;
  taxTotal: string;
  chargesTotal: string;
  roundOff: string;
  total: string;
}

export function calcInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const results = input.lineItems.map((li) => calcLineItem(li));

  const subtotal = money.sum(results.map((r) => r.afterDiscount));
  const lineDiscountTotal = money.sum(results.map((r) => r.discountAmount));
  const taxTotal = money.sum(results.map((r) => r.taxAmount));

  // Invoice-level discount (applied after line items, before charges)
  const discountInput = input.invoiceDiscount || "0";
  const discountType = input.invoiceDiscountType || "amount";
  const invoiceDiscountAmount = discountType === "percent"
    ? money.percent(subtotal, discountInput)
    : discountInput;

  const chargesTotal = input.charges
    ? money.sum(input.charges.map((c) => c.amount))
    : "0.00";
  const roundOff = input.roundOff || "0.00";

  // total = subtotal + tax - invoiceDiscount + charges + roundOff
  const total = money.add(
    money.sub(money.add(subtotal, taxTotal), invoiceDiscountAmount),
    money.add(chargesTotal, roundOff)
  );

  return { subtotal, lineDiscountTotal, invoiceDiscountAmount, taxTotal, chargesTotal, roundOff, total };
}

/** Largest absolute round-off a document may carry (the UI floors to a whole rupee, so < 1). */
export const MAX_ROUND_OFF = "1.00";

/** True when `roundOff` is within +/- MAX_ROUND_OFF. */
export function isRoundOffWithinBound(roundOff: string | number | null | undefined): boolean {
  const value = roundOff ?? "0";
  return money.compare(value, MAX_ROUND_OFF) <= 0 && money.compare(value, `-${MAX_ROUND_OFF}`) >= 0;
}

export interface ValidateInvoiceTotalsOptions {
  /**
   * Skip the +/- MAX_ROUND_OFF bound. Only for UPDATES where the round-off is
   * the value already stored on the document: documents saved before the bound
   * existed (v0.9.0 accepted any round-off) must stay editable, and "only
   * changed values are validated" is the rule. Never set it for a new value.
   */
  skipRoundOffBound?: boolean;
}

/**
 * Server-side sanity check for invoice-level adjustments. Returns an error
 * message, or null when the document is acceptable. Kept separate from
 * calcInvoiceTotals so live UI previews keep computing while the user types.
 */
export function validateInvoiceTotals(
  input: InvoiceTotalsInput,
  opts: ValidateInvoiceTotalsOptions = {},
): string | null {
  const discountInput = input.invoiceDiscount || "0";
  const discountType = input.invoiceDiscountType || "amount";
  if (money.compare(discountInput, 0) < 0) return "Invoice discount cannot be negative";
  if (discountType === "percent" && money.compare(discountInput, 100) > 0) {
    return "Invoice discount cannot exceed 100%";
  }

  if (!opts.skipRoundOffBound && !isRoundOffWithinBound(input.roundOff || "0")) {
    return `Round off cannot exceed ${MAX_ROUND_OFF} in either direction`;
  }

  const totals = calcInvoiceTotals(input);
  if (money.compare(totals.invoiceDiscountAmount, money.add(totals.subtotal, totals.taxTotal)) > 0) {
    return "Invoice discount cannot exceed the invoice subtotal plus tax";
  }
  if (money.compare(totals.total, 0) < 0) return "Invoice total cannot be negative";
  return null;
}
