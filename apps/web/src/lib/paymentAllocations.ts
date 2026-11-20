/**
 * Pure helpers behind RecordPaymentPanel's submit: turn the form state into the
 * `allocations` array payment.create / payment.update expect.
 *
 * Kept free of React / tRPC so it can be unit-tested directly.
 */

import { money, normalizeMoneyInput } from "@hisaabo/shared";

export interface AllocationPayload {
  invoiceId: string;
  /** Gross amount settled against the invoice (net cash + TDS), 2dp string. */
  amount: string;
  tdsAmount?: string;
  tdsSectionCode?: string;
  /** Percent, 2dp string. Stored as metadata by the server. */
  tdsRate?: string;
}

export interface TdsFormValues {
  amount: string;
  sectionCode: string;
  rate: string;
}

export type BuildAllocationsResult =
  | { ok: true; allocations: AllocationPayload[] }
  | { ok: false; error: string };

/**
 * Build the allocation payload from the checked invoices and the TDS inputs.
 *
 * - every amount is normalised to a 2-decimal string ("500." -> "500.00",
 *   "12.345" -> "12.35") so the API's regex never rejects a typed value;
 * - TDS applies to a single invoice (the UI cannot split one deduction across
 *   invoices); it needs a section and a rate in (0, 100] and may not exceed the
 *   gross allocation. The amount is whatever the user entered — the server
 *   checks bounds only, never `rate x gross`.
 */
export function buildAllocationPayload(args: {
  checkedInvoiceIds: Iterable<string>;
  allocations: Record<string, string>;
  tds: TdsFormValues;
  isCustomer: boolean;
}): BuildAllocationsResult {
  const tdsAmount = args.isCustomer ? normalizeMoneyInput(args.tds.amount) : "0.00";
  const hasTds = money.compare(tdsAmount, "0") > 0;

  const lines: Array<{ invoiceId: string; amount: string }> = [];
  for (const invoiceId of args.checkedInvoiceIds) {
    const amount = normalizeMoneyInput(args.allocations[invoiceId]);
    if (money.isPositive(amount)) lines.push({ invoiceId, amount });
  }

  if (!hasTds) {
    return { ok: true, allocations: lines };
  }

  if (lines.length > 1) {
    return {
      ok: false,
      error: "Multi-invoice payments with TDS are not supported. Please select one invoice or remove TDS.",
    };
  }
  const [line] = lines;
  if (line && money.compare(tdsAmount, line.amount) > 0) {
    return { ok: false, error: "TDS amount cannot exceed gross allocation" };
  }
  const section = args.tds.sectionCode.trim();
  const rate = normalizeMoneyInput(args.tds.rate);
  if (!section || !money.isPositive(rate) || money.compare(rate, "100") > 0) {
    return { ok: false, error: "TDS amount requires a section code and a rate between 0 and 100" };
  }
  if (!line) {
    return { ok: false, error: "Select an invoice to record TDS against" };
  }

  return {
    ok: true,
    allocations: [{ ...line, tdsAmount, tdsSectionCode: section, tdsRate: rate }],
  };
}

/**
 * The `allocations` value to send. Creating: omit it when nothing is allocated
 * (an advance payment). Editing: ALWAYS send the array — `[]` is the explicit
 * "clear every allocation" signal; omitting it makes the server re-apply the
 * payment's existing allocations, so unchecking all invoices would silently do
 * nothing.
 */
export function allocationsForRequest(
  isEditMode: boolean,
  allocations: AllocationPayload[],
): AllocationPayload[] | undefined {
  if (isEditMode) return allocations;
  return allocations.length > 0 ? allocations : undefined;
}
