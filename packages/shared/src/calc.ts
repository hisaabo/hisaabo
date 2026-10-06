import { money } from "./money.js";

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

export function calcLineItem(item: LineItemInput): LineItemResult {
  if (item.taxInclusive) {
    // Tax-inclusive: unitPrice already includes tax
    // Back-calculate: base = price / (1 + tax/100), tax = price - base
    const grossPerUnit = money.toNumber(item.unitPrice);
    const taxRate = money.toNumber(item.taxPercent);
    const basePerUnit = grossPerUnit / (1 + taxRate / 100);
    const basePrice = basePerUnit.toFixed(2);

    const subtotal = money.mul(basePrice, item.quantity);
    const discountAmount = money.percent(subtotal, item.discountPercent);
    const afterDiscount = money.sub(subtotal, discountAmount);
    const taxAmount = money.percent(afterDiscount, item.taxPercent);
    const total = money.add(afterDiscount, taxAmount);

    return { subtotal, discountAmount, afterDiscount, taxAmount, total };
  }

  // Tax-exclusive (default)
  const subtotal = money.mul(item.unitPrice, item.quantity);
  const discountAmount = money.percent(subtotal, item.discountPercent);
  const afterDiscount = money.sub(subtotal, discountAmount);
  const taxAmount = money.percent(afterDiscount, item.taxPercent);
  const total = money.add(afterDiscount, taxAmount);

  return { subtotal, discountAmount, afterDiscount, taxAmount, total };
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

/**
 * Server-side sanity check for invoice-level adjustments. Returns an error
 * message, or null when the document is acceptable. Kept separate from
 * calcInvoiceTotals so live UI previews keep computing while the user types.
 */
export function validateInvoiceTotals(input: InvoiceTotalsInput): string | null {
  const discountInput = input.invoiceDiscount || "0";
  const discountType = input.invoiceDiscountType || "amount";
  if (money.compare(discountInput, 0) < 0) return "Invoice discount cannot be negative";
  if (discountType === "percent" && money.compare(discountInput, 100) > 0) {
    return "Invoice discount cannot exceed 100%";
  }

  const roundOff = input.roundOff || "0";
  if (money.compare(roundOff, MAX_ROUND_OFF) > 0 || money.compare(roundOff, `-${MAX_ROUND_OFF}`) < 0) {
    return `Round off cannot exceed ${MAX_ROUND_OFF} in either direction`;
  }

  const totals = calcInvoiceTotals(input);
  if (money.compare(totals.invoiceDiscountAmount, money.add(totals.subtotal, totals.taxTotal)) > 0) {
    return "Invoice discount cannot exceed the invoice subtotal plus tax";
  }
  if (money.compare(totals.total, 0) < 0) return "Invoice total cannot be negative";
  return null;
}
