import { money } from "./money.js";

export interface LineItemInput {
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

export interface LineItemResult {
  subtotal: string;       // qty * price
  discountAmount: string; // subtotal * (disc / 100)
  afterDiscount: string;  // subtotal - discountAmount
  taxAmount: string;      // afterDiscount * (tax / 100)
  total: string;          // afterDiscount + taxAmount
}

export function calcLineItem(item: LineItemInput): LineItemResult {
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
