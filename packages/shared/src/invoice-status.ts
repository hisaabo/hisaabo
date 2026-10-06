import { money } from "./money.js";
import type { invoiceStatuses, DocumentType } from "./validators.js";

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

// Non-invoice document types have their own, smaller status lifecycles.
// `cancelled` is terminal everywhere; credit/debit notes settle via `paid`.
export type NonInvoiceDocumentType = Exclude<DocumentType, "invoice">;

export const DOCUMENT_STATUS_TRANSITIONS: Record<
  NonInvoiceDocumentType,
  Readonly<Record<string, readonly string[]>>
> = {
  quotation: {
    draft: ["sent", "cancelled"],
    sent: ["draft", "cancelled"],
    cancelled: [],
  },
  proforma: {
    draft: ["sent", "cancelled"],
    sent: ["draft", "cancelled"],
    cancelled: [],
  },
  delivery_challan: {
    draft: ["sent", "cancelled"],
    sent: ["cancelled"],
    cancelled: [],
  },
  credit_note: {
    draft: ["sent", "cancelled"],
    sent: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  },
  debit_note: {
    draft: ["sent", "cancelled"],
    sent: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  },
  sales_return: {
    draft: ["sent", "cancelled"],
    sent: ["cancelled"],
    cancelled: [],
  },
  purchase_return: {
    draft: ["sent", "cancelled"],
    sent: ["cancelled"],
    cancelled: [],
  },
};

export function getDocumentStatuses(documentType: NonInvoiceDocumentType): string[] {
  return Object.keys(DOCUMENT_STATUS_TRANSITIONS[documentType]);
}

export function checkDocumentStatusTransition(
  documentType: string,
  from: string,
  to: string,
): string | null {
  const table = DOCUMENT_STATUS_TRANSITIONS[documentType as NonInvoiceDocumentType];
  if (!table) return `Unsupported document type: ${documentType}`;
  if (from === to) return null;
  if (!table[from]?.includes(to)) {
    return `Cannot change ${documentType.replace(/_/g, " ")} status from ${from} to ${to}`;
  }
  return null;
}

// Blocks delete/cancel while money or a live e-invoice depends on the document.
export function checkInvoiceUnlinkAllowed(
  action: "delete" | "cancel",
  doc: {
    amountPaid: string;
    allocationCount: number;
    irn: string | null;
    eInvoiceStatus: string | null;
  },
): string | null {
  if (doc.allocationCount > 0 || money.isPositive(doc.amountPaid)) {
    return `Cannot ${action} this document while payments are allocated to it. Remove the payment allocation first.`;
  }
  const irnActive = doc.eInvoiceStatus === "generated" || (!!doc.irn && doc.eInvoiceStatus !== "cancelled");
  if (irnActive) {
    return `Cannot ${action} this document while it has an active e-invoice (IRN). Cancel the e-invoice first.`;
  }
  return null;
}
