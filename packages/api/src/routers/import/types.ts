import { z } from "zod";
import { units } from "@hisaabo/shared";

// ── Money string: allows integers ("0", "100"), decimals ("10.50"), and negatives ──
const moneyString = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, "Must be a numeric money string (e.g. '0', '10.50', '-5.00')")
  .or(z.literal("0"));

// Coerce empty / nullish strings to "0" at adapter boundary
export const moneyStringOrZero = z
  .string()
  .transform((v) => (v === "" || v === undefined ? "0" : v))
  .pipe(moneyString);

// ── Payment mode ──────────────────────────────────────────────────────────────
export const paymentModeEnum = z.enum(["cash", "bank", "upi", "cheque", "other"]);
export type PaymentMode = z.infer<typeof paymentModeEnum>;

// ── Canonical Party ───────────────────────────────────────────────────────────
export const canonicalPartySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["customer", "supplier"]),
  phone: z.string().optional(),
  // Empty string is acceptable (maps to null in DB)
  email: z.string().email().optional().or(z.literal("")),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  openingBalance: moneyString,
  billingAddress: z.string().optional(),
  shippingAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
});
export type CanonicalParty = z.infer<typeof canonicalPartySchema>;

// ── Canonical Item ────────────────────────────────────────────────────────────
export const canonicalItemSchema = z.object({
  name: z.string().min(1),
  itemType: z.enum(["product", "service"]),
  salePrice: z.string().optional(),
  purchasePrice: z.string().optional(),
  taxPercent: moneyString,
  hsn: z.string().optional(),
  unit: z.enum(units),
  // Always "0" — stock is built from imported invoices
  stockQuantity: z.literal("0"),
  sku: z.string().optional(),
  category: z.string().optional(),
});
export type CanonicalItem = z.infer<typeof canonicalItemSchema>;

// ── Canonical Invoice Line Item ───────────────────────────────────────────────
export const canonicalLineItemSchema = z.object({
  itemName: z.string().optional(),
  description: z.string(),
  quantity: z.string(),
  unit: z.string().optional(),
  conversionFactor: z.string().optional(),
  unitPrice: z.string(),
  taxPercent: moneyString,
  discountPercent: moneyString,
});
export type CanonicalLineItem = z.infer<typeof canonicalLineItemSchema>;

// ── Canonical Invoice ─────────────────────────────────────────────────────────
export const canonicalInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.date(),
  dueDate: z.date().optional(),
  partyName: z.string().min(1),
  type: z.enum(["sale", "purchase"]),
  status: z.enum(["draft", "sent", "paid", "partial", "overdue", "cancelled"]),
  subtotal: moneyString,
  taxAmount: moneyString,
  discountAmount: moneyString,
  totalAmount: moneyString,
  amountPaid: moneyString,
  charges: z
    .array(z.object({ label: z.string(), amount: z.string() }))
    .optional(),
  paymentMode: paymentModeEnum.optional(),
  notes: z.string().optional(),
  createdByName: z.string().optional(),
  lineItems: z.array(canonicalLineItemSchema).optional(),
});
export type CanonicalInvoice = z.infer<typeof canonicalInvoiceSchema>;

// ── Canonical Payment ─────────────────────────────────────────────────────────
export const canonicalPaymentSchema = z.object({
  paymentNumber: z.string().optional(),
  paymentDate: z.date(),
  partyName: z.string().min(1),
  amount: moneyString,
  mode: paymentModeEnum,
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  invoiceNumbers: z.array(z.string()).optional(),
});
export type CanonicalPayment = z.infer<typeof canonicalPaymentSchema>;

// ── Canonical Transfer ────────────────────────────────────────────────────────
export const canonicalTransferSchema = z.object({
  date: z.date(),
  amount: moneyString,
  fromMode: z.string(),
  toMode: z.string(),
  notes: z.string().optional(),
  txnNo: z.string().optional(),
});
export type CanonicalTransfer = z.infer<typeof canonicalTransferSchema>;
