import { parseFlexibleDate } from "../../helpers.js";
import { normalizeUnit } from "./normalize-unit.js";
import { normalizeMode } from "./normalize-mode.js";
import type {
  CanonicalParty,
  CanonicalItem,
  CanonicalInvoice,
  CanonicalPayment,
  CanonicalTransfer,
} from "../../types.js";

// ── Helper ────────────────────────────────────────────────────────────────────
function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

// Normalize a money string: empty or non-numeric → "0"
function moneyStr(v: unknown): string {
  const s = str(v, "0");
  if (s === "") return "0";
  // Keep the value if it looks like a valid money string
  if (/^-?\d+(\.\d{1,2})?$/.test(s)) return s;
  // Try to parse as a float and convert
  const n = parseFloat(s);
  if (isNaN(n)) return "0";
  return n.toFixed(2).replace(/\.?0+$/, "") || "0";
}

// ── transformParty ────────────────────────────────────────────────────────────
export function transformParty(raw: Record<string, unknown>): CanonicalParty | null {
  const name = str(raw.name);
  if (!name) return null;

  return {
    name,
    type: (raw.type === "supplier" ? "supplier" : "customer"),
    phone: str(raw.phone) || undefined,
    email: str(raw.email) || undefined,
    gstin: str(raw.gstin) || undefined,
    pan: str(raw.pan) || undefined,
    openingBalance: moneyStr(raw.openingBalance),
    billingAddress: str(raw.billingAddress) || undefined,
    shippingAddress: str(raw.shippingAddress) || undefined,
    city: str(raw.city) || undefined,
    state: str(raw.state) || undefined,
    pincode: str(raw.pincode) || undefined,
  };
}

// ── transformItem ─────────────────────────────────────────────────────────────
export function transformItem(raw: Record<string, unknown>): CanonicalItem | null {
  const name = str(raw.name);
  if (!name) return null;

  return {
    name,
    itemType: (raw.itemType === "service" ? "service" : "product"),
    salePrice: str(raw.salePrice) || undefined,
    purchasePrice: str(raw.purchasePrice) || undefined,
    taxPercent: moneyStr(raw.taxPercent),
    hsn: str(raw.hsn) || undefined,
    unit: normalizeUnit(str(raw.unit, "pcs")),
    stockQuantity: "0",
    sku: str(raw.sku) || undefined,
    category: str(raw.category) || undefined,
  };
}

// ── transformInvoice ──────────────────────────────────────────────────────────
export function transformInvoice(raw: Record<string, unknown>): CanonicalInvoice | null {
  const invoiceNumber = str(raw.invoiceNumber);
  const partyName = str(raw.partyName);
  if (!invoiceNumber || !partyName) return null;

  const invoiceDate = parseFlexibleDate(str(raw.invoiceDate));
  if (!invoiceDate) return null;

  const dueDate = raw.dueDate ? parseFlexibleDate(str(raw.dueDate)) : null;

  // Normalize payment mode if provided (for autoCreatePayments)
  const rawMode = str(raw.paymentMode);
  const paymentMode = rawMode ? normalizeMode(rawMode) : undefined;

  // Line items
  //
  // Post-schema-split (Bug B): the CSV's "Item Name" column is the primary
  // source of truth; the legacy "Description" column (rare in MyBillBook
  // exports) is a fallback so old CSVs don't break. Imported historical
  // invoices never carry a user-authored description, so the optional notes
  // column is left blank (null) — user notes only make sense when a human
  // authored the line in Hisaabo.
  let lineItems: CanonicalInvoice["lineItems"] = undefined;
  if (Array.isArray(raw.lineItems) && raw.lineItems.length > 0) {
    lineItems = (raw.lineItems as Record<string, unknown>[]).map((li) => ({
      itemName: str(li.itemName) || str(li.description) || "Imported item",
      description: null,
      quantity: str(li.quantity, "1") || "1",
      unit: str(li.unit) || undefined,
      conversionFactor: str(li.conversionFactor) || undefined,
      unitPrice: str(li.unitPrice, "0"),
      taxPercent: moneyStr(li.taxPercent),
      discountPercent: moneyStr(li.discountPercent),
    }));
  }

  // Charges: pass through as-is (already typed correctly by tRPC input schema)
  let charges: CanonicalInvoice["charges"] = undefined;
  if (Array.isArray(raw.charges) && raw.charges.length > 0) {
    charges = (raw.charges as Array<{ label: string; amount: string }>);
  }

  const validStatuses = ["draft", "sent", "paid", "partial", "overdue", "cancelled"] as const;
  const rawStatus = str(raw.status, "sent");
  const status = (validStatuses as readonly string[]).includes(rawStatus)
    ? (rawStatus as typeof validStatuses[number])
    : "sent";

  const validTypes = ["sale", "purchase"] as const;
  const rawType = str(raw.type, "sale");
  const type = (validTypes as readonly string[]).includes(rawType)
    ? (rawType as typeof validTypes[number])
    : "sale";

  return {
    invoiceNumber,
    invoiceDate,
    dueDate: dueDate ?? undefined,
    partyName,
    type,
    status,
    subtotal: moneyStr(raw.subtotal),
    taxAmount: moneyStr(raw.taxAmount),
    discountAmount: moneyStr(raw.discountAmount),
    totalAmount: moneyStr(raw.totalAmount),
    amountPaid: moneyStr(raw.amountPaid),
    charges,
    paymentMode,
    notes: str(raw.notes) || undefined,
    createdByName: str(raw.createdByName) || undefined,
    lineItems,
  };
}

// ── transformPayment ──────────────────────────────────────────────────────────
export function transformPayment(raw: Record<string, unknown>): CanonicalPayment | null {
  const partyName = str(raw.partyName);
  if (!partyName) return null;

  const paymentDate = parseFlexibleDate(str(raw.paymentDate));
  if (!paymentDate) return null;

  const validModes = ["cash", "bank", "upi", "cheque", "other"] as const;
  const rawMode = str(raw.mode, "cash");
  const mode = (validModes as readonly string[]).includes(rawMode)
    ? (rawMode as typeof validModes[number])
    : "cash";

  return {
    paymentNumber: str(raw.paymentNumber) || undefined,
    paymentDate,
    partyName,
    amount: moneyStr(raw.amount),
    mode,
    referenceNumber: str(raw.referenceNumber) || undefined,
    notes: str(raw.notes) || undefined,
    invoiceNumbers: Array.isArray(raw.invoiceNumbers)
      ? (raw.invoiceNumbers as string[]).filter(Boolean)
      : undefined,
  };
}

// ── transformTransfer ─────────────────────────────────────────────────────────
export function transformTransfer(raw: Record<string, unknown>): CanonicalTransfer | null {
  const date = parseFlexibleDate(str(raw.date));
  if (!date) return null;

  return {
    date,
    amount: moneyStr(raw.amount),
    fromMode: str(raw.fromMode, "cash"),
    toMode: str(raw.toMode, "bank"),
    notes: str(raw.notes) || undefined,
    txnNo: str(raw.txnNo) || undefined,
  };
}
