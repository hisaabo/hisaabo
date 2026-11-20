/**
 * Customer-receipt TDS helpers shared by every client (web, CLI, MCP, mobile).
 *
 * The server validates TDS BOUND-ONLY (0 < tds <= gross allocation, section and
 * rate required, rate stored as metadata). These helpers only help a client
 * PRE-FILL a sensible amount; the user may always override it.
 */

import { money } from "./money.js";

/** Parse a decimal string to integer hundredths (paise / hundredths of a percent). */
function toHundredths(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Invoice value excluding GST (total minus tax). When GST is shown separately
 * on the invoice this is the amount customers normally deduct TDS on
 * (CBDT Circular 23/2017).
 */
export function invoiceTaxableValue(totalAmount: string, taxAmount: string): string {
  return money.max0(money.sub(totalAmount, taxAmount));
}

export interface SuggestTdsInput {
  /** Gross amount being settled against the invoice (what the allocation carries). */
  allocationAmount: string;
  invoiceTotal: string;
  invoiceTaxAmount: string;
  /** TDS rate in percent, e.g. "10" or "1.50". */
  rate: string;
}

/**
 * Suggested TDS for one allocation: the allocation's share of the invoice's
 * taxable value (excluding GST) x rate. A partial allocation takes the same
 * proportion of the taxable value as of the invoice total.
 *
 *   invoice 11,800 (10,000 + 18% GST), settling all 11,800 at 10%  ->  1,000.00
 *   same invoice, settling 5,900 at 10%                           ->    500.00
 *
 * Returns "0.00" when any input is not a positive amount/rate.
 */
export function suggestTdsAmount(input: SuggestTdsInput): string {
  const alloc = toHundredths(input.allocationAmount);
  const total = toHundredths(input.invoiceTotal);
  const rate = toHundredths(input.rate); // percent x 100
  if (alloc <= 0 || total <= 0 || rate <= 0) return "0.00";

  const taxable = Math.max(0, total - toHundredths(input.invoiceTaxAmount));
  const sharePaise = Math.round((alloc * taxable) / total);
  const tdsPaise = Math.round((sharePaise * rate) / 10000);
  return money.add(tdsPaise / 100, "0");
}

/**
 * Normalise a user-typed amount ("500.", "12.345", " 7 ") to the 2-decimal
 * string the API requires. Unparseable input becomes "0.00" (which the API
 * rejects as non-positive where a positive amount is needed).
 */
export function normalizeMoneyInput(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? "0.00" : money.add(trimmed, "0");
}
