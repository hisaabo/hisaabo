import { z } from "zod";

// ── Common ─────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const searchSchema = z.object({
  query: z.string().min(1).max(200),
});

// ── Auth ───────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(128),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const magicLinkRequestSchema = z.object({
  email: z.string().email().max(255),
});

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1).max(128),
});

export const completeProfileSchema = z.object({
  name: z.string().min(2).max(100),
});

// ── Business ───────────────────────────────────────────────────

export const gstRegistrationTypes = ["regular", "composition", "unregistered"] as const;
export type GstRegistrationType = (typeof gstRegistrationTypes)[number];

export const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  gstRegistrationType: z.enum(gstRegistrationTypes).default("unregistered"),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional().or(z.literal("")),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/),
  phone: z.string().min(1).max(15),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().min(1).max(500),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  stateCode: z.string().max(2).optional(),
  pincode: z.string().max(10).optional(),
  invoicePrefix: z.string().min(1).max(10).default("INV"),
  currency: z.string().length(3).default("INR"),
  paymentPrefix: z.string().min(1).max(10).default("PAY"),
  quotationPrefix: z.string().min(1).max(10).default("QTN"),
  creditNotePrefix: z.string().min(1).max(10).default("CN"),
  deliveryChallanPrefix: z.string().min(1).max(10).default("DC"),
  proformaPrefix: z.string().min(1).max(10).default("PI"),
});

export const updateBusinessSchema = createBusinessSchema.partial();

export const updateSequenceNumberSchema = z.object({
  documentType: z.enum(["invoice", "payment", "quotation", "credit_note", "delivery_challan", "proforma"]),
  newNumber: z.number().int().min(1),
});

// ── Party ──────────────────────────────────────────────────────

export const itemTypes = ["product", "service"] as const;
export type ItemType = (typeof itemTypes)[number];

export const documentTypes = ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"] as const;
export type DocumentType = (typeof documentTypes)[number];

export const bankAccountTypes = ["savings", "current", "cash", "upi", "credit_card"] as const;
export type BankAccountType = (typeof bankAccountTypes)[number];

export const bankTransactionTypes = ["deposit", "withdrawal", "transfer"] as const;
export type BankTransactionType = (typeof bankTransactionTypes)[number];

export const partyTypes = ["customer", "supplier"] as const;
export type PartyType = (typeof partyTypes)[number];

export const createPartySchema = z.object({
  type: z.enum(partyTypes),
  name: z.string().min(1).max(200),
  phone: z.string().max(15).optional(),
  email: z.string().email().optional().or(z.literal("")),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional().or(z.literal("")),
  pan: z.string().optional().or(z.literal("")),
  billingAddress: z.string().max(500).optional(),
  shippingAddress: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  stateCode: z.string().max(2).optional(),
  pincode: z.string().max(10).optional(),
  openingBalance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default("0"),
  category: z.string().max(100).optional(),
  creditPeriodDays: z.number().int().min(0).max(365).optional(),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  contactPersonName: z.string().max(200).optional(),
  contactPersonDob: z.string().datetime().optional(),
  bankAccountNumber: z.string().max(34).optional(),
  bankIfsc: z.string().max(11).optional(),
  bankName: z.string().max(200).optional(),
});

export const updatePartySchema = createPartySchema.partial().omit({ type: true });

// ── Item ───────────────────────────────────────────────────────

export const units = ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"] as const;
export type Unit = (typeof units)[number];

export const itemModes = ["simple", "alt_units", "variants"] as const;
export type ItemMode = (typeof itemModes)[number];

export const unitVariantSchema = z.object({
  unit: z.string().min(1).max(50),
  conversionFactor: z.number().positive(),
  salePrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  purchasePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

export type UnitVariant = z.infer<typeof unitVariantSchema>;

export const decimalStr = z.string().regex(/^\d+(\.\d{1,2})?$/);
export const decimalStr3 = z.string().regex(/^-?\d+(\.\d{1,3})?$/);

export const itemVariantSchema = z.object({
  attributeValues: z.record(z.string().min(1), z.string().min(1)),
  sku: z.string().max(50).optional(),
  salePrice: decimalStr.optional(),
  purchasePrice: decimalStr.optional(),
  stockQuantity: decimalStr3.default("0"),
  lowStockAlert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
});

export type ItemVariant = z.infer<typeof itemVariantSchema>;

const createItemBaseSchema = z.object({
  name: z.string().min(1).max(200),
  hsn: z.string().max(20).optional(),
  sku: z.string().max(50).optional(),
  unit: z.enum(units).default("pcs"),
  itemMode: z.enum(itemModes).default("simple"),
  salePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  purchasePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  taxPercent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  stockQuantity: z.string().regex(/^-?\d+(\.\d{1,3})?$/).default("0"),
  lowStockAlert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
  description: z.string().max(1000).optional(),
  itemType: z.enum(itemTypes).default("product"),
  category: z.string().max(100).optional(),
  taxInclusive: z.boolean().default(false),
  unitVariants: z.array(unitVariantSchema).optional(),
  variantAttributes: z.array(z.string().min(1).max(50)).max(5).optional(),
  variants: z.array(itemVariantSchema).optional(),
});

export const createItemSchema = createItemBaseSchema.refine((d) => {
  if (d.itemMode === "variants" && d.unitVariants && d.unitVariants.length > 0) return false;
  if (d.itemMode === "alt_units" && d.variantAttributes && d.variantAttributes.length > 0) return false;
  if (d.itemMode === "alt_units" && d.variants && d.variants.length > 0) return false;
  return true;
}, { message: "An item cannot have both unit variants and product variants" });

export const updateItemSchema = createItemBaseSchema.partial();

// ── Invoice ────────────────────────────────────────────────────

export const invoiceTypes = ["sale", "purchase"] as const;
export const invoiceStatuses = ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"] as const;
export const deliveryMethods = ["self_pickup", "hand_delivery", "courier", "bus", "transport", "post"] as const;
export type DeliveryMethod = (typeof deliveryMethods)[number];

export const invoiceChargeSchema = z.object({
  label: z.string().min(1).max(100),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const invoiceLineItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).refine((v) => parseFloat(v) > 0, { message: "Quantity must be greater than 0" }),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  taxPercent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0").refine((v) => parseFloat(v) <= 56, { message: "Tax percent cannot exceed 56%" }),
  discountPercent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0").refine((v) => parseFloat(v) <= 100, { message: "Discount cannot exceed 100%" }),
  selectedUnit: z.string().nullish(),
  conversionFactor: z.string().nullish(), // stored as string like all numerics
  variantId: z.string().uuid().nullish(),
});

export const createInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  type: z.enum(invoiceTypes),
  documentType: z.enum(documentTypes).default("invoice"),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(2000).optional(),
  additionalCharges: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  charges: z.array(invoiceChargeSchema).optional(),
  invoiceDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  invoiceDiscountType: z.enum(["amount", "percent"]).default("amount"),
  roundOff: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default("0"),
  referenceDocumentId: z.string().uuid().optional(),
  lineItems: z.array(invoiceLineItemSchema).min(1),
  /**
   * When true, skip stock adjustment on create. Used when converting a
   * delivery_challan → invoice to avoid double-decrementing stock (the
   * challan already decremented it).
   */
  skipStockAdjustment: z.boolean().optional(),
  deliveryMethod: z.enum(deliveryMethods).default("self_pickup"),
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(invoiceStatuses),
});

// ── Payment ────────────────────────────────────────────────────

export const paymentModes = ["cash", "bank", "upi", "cheque", "other"] as const;

export const paymentAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  partyId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  discount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  mode: z.enum(paymentModes),
  referenceNumber: z.string().max(100).optional(),
  paymentDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  bankAccountId: z.string().uuid().optional(),
  // Multi-invoice allocation: allocate a single payment across multiple invoices
  allocations: z.array(paymentAllocationSchema).optional(),
});

export const updatePaymentSchema = z.object({
  id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  discount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  mode: z.enum(paymentModes).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
  paymentDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  // Replace all allocations (reverse old, apply new)
  allocations: z.array(paymentAllocationSchema).optional(),
});

// ── Expense ────────────────────────────────────────────────────

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  mode: z.enum(paymentModes),
  expenseDate: z.string().datetime().optional(),
  referenceNumber: z.string().max(100).optional(),
});

// ── Bank Accounts ──────────────────────────────────────────────

export const createBankAccountSchema = z.object({
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(34).optional(),
  ifsc: z.string().max(11).optional(),
  bankName: z.string().max(200).optional(),
  accountType: z.enum(bankAccountTypes).default("savings"),
  openingBalance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default("0"),
  isDefault: z.boolean().default(false),
});

export const updateBankAccountSchema = createBankAccountSchema.partial();

export const createBankTransactionSchema = z.object({
  bankAccountId: z.string().uuid(),
  type: z.enum(bankTransactionTypes),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  description: z.string().max(500).optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().uuid().optional(),
  transactionDate: z.string().datetime().optional(),
});

export const bankTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  description: z.string().max(500).optional(),
  transactionDate: z.string().datetime().optional(),
});

export const convertDocumentSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  targetDocumentType: z.enum(documentTypes),
});

// ── Reports ────────────────────────────────────────────────────

export const daybookInputSchema = z.object({
  fromDate: z.string().date(),
  toDate: z.string().date(),
  typeFilter: z.enum(["all", "invoices", "payments", "expenses"]).default("all"),
});

export const outstandingInputSchema = z.object({
  type: z.enum(["receivable", "payable", "both"]).default("receivable"),
  asOfDate: z.string().datetime().optional(),
});

export const registerInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  partyId: z.string().uuid().optional(),
});

export const taxSummaryInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  type: z.enum(["sales", "purchases", "both"]).default("both"),
});

export const cashFlowForecastInputSchema = z.object({
  businessId: z.string().uuid().optional(),
});

export const collectionEfficiencyInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
});

export const itemSalesInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  category: z.string().optional(),
  itemType: z.enum(["product", "service"]).optional(),
  sortBy: z.enum(["revenue", "quantity", "invoices", "margin"]).default("revenue"),
  compareToPrevious: z.boolean().default(false),
});

export const stockSummaryInputSchema = z.object({
  category: z.string().optional(),
  showZeroStock: z.boolean().default(false),
});

export const partyStatementInputSchema = z.object({
  partyId: z.string().uuid(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const paymentSummaryInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  type: z.enum(["received", "made", "both"]).default("both"),
  bankAccountId: z.string().uuid().optional(),
});

// ── Dashboard ──────────────────────────────────────────────────

export type DashboardSummary = {
  totalSales: string;
  totalPurchases: string;
  totalExpenses: string;
  receivable: string;
  payable: string;
  cashInHand: string;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    partyName: string;
    totalAmount: string;
    status: string;
    invoiceDate: string;
  }>;
};
