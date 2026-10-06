import { money } from "./money.js";
import type { invoiceStatuses } from "./validators.js";

export type InvoiceStatusValue = (typeof invoiceStatuses)[number];

// Manual status changes. `partial` is never settable by hand (payments own it);
// `paid` additionally requires allocated payments to cover the total, and
// `draft`/`cancelled` require that no payment has been applied.
const TRANSITIONS: Record<InvoiceStatusValue, readonly InvoiceStatusValue[]> = {
  draft: ["sent", "unfulfilled", "cancelled", "paid"],
  unfulfilled: ["draft", "sent", "overdue", "cancelled", "paid"],
  sent: ["draft", "unfulfilled", "overdue", "cancelled", "paid"],
  overdue: ["draft", "unfulfilled", "sent", "cancelled", "paid"],
  partial: ["sent", "overdue", "cancelled", "paid"],
  paid: [],
  cancelled: [],
  adjusted: [],
};

export function checkInvoiceStatusTransition(
  from: InvoiceStatusValue,
  to: InvoiceStatusValue,
  invoice: { totalAmount: string; amountPaid: string },
): string | null {
  if (from === to) return null;
  if (!TRANSITIONS[from]?.includes(to)) {
    return `Cannot change invoice status from ${from} to ${to}`;
  }
  if (to === "paid" && money.compare(invoice.amountPaid, invoice.totalAmount) < 0) {
    return "Cannot mark as paid until payments cover the invoice total. Record a payment instead.";
  }
  if ((to === "draft" || to === "cancelled") && money.isPositive(invoice.amountPaid)) {
    return `Cannot change status to ${to} while payments are allocated. Remove payments first.`;
  }
  return null;
}
