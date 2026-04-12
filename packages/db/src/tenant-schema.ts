import { pgTable, text, timestamp, numeric, integer, boolean, uuid, pgEnum, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────

export const partyTypeEnum = pgEnum("party_type", ["customer", "supplier"]);
export const invoiceTypeEnum = pgEnum("invoice_type", ["sale", "purchase"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"]);
export const paymentModeEnum = pgEnum("payment_mode", ["cash", "bank", "upi", "cheque", "other", "credit_card", "debit_card", "net_banking", "wallet"]);
export const unitEnum = pgEnum("unit", ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"]);
export const itemTypeEnum = pgEnum("item_type", ["product", "service"]);
export const itemModeEnum = pgEnum("item_mode", ["simple", "alt_units", "variants"]);
export const documentTypeEnum = pgEnum("document_type", ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"]);
export const bankAccountTypeEnum = pgEnum("bank_account_type", ["savings", "current", "cash", "upi", "credit_card", "payment_gateway"]);
export const bankTransactionTypeEnum = pgEnum("bank_transaction_type", ["deposit", "withdrawal", "transfer"]);
export const gstRegistrationTypeEnum = pgEnum("gst_registration_type", ["regular", "composition", "unregistered"]);
export const recurringFrequencyEnum = pgEnum("recurring_frequency", ["weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"]);
export const recurringTemplateStatusEnum = pgEnum("recurring_template_status", ["active", "paused", "completed", "expired"]);
export const recurringRunStatusEnum = pgEnum("recurring_run_status", ["success", "failed", "skipped_limit"]);
export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "equity", "income", "expense"]);

// ── Business ───────────────────────────────────────────────────

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // No FK to users — plain UUID, users live in control schema (different DB in cloud mode)
  createdByUserId: uuid("created_by_user_id").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  gstRegistrationType: gstRegistrationTypeEnum("gst_registration_type").default("unregistered").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"), // 2-digit GST state code (01-38) for inter/intra-state detection
  pincode: text("pincode"),
  logoUrl: text("logo_url"),
  invoicePrefix: text("invoice_prefix").default("INV").notNull(),
  nextInvoiceNumber: integer("next_invoice_number").default(1).notNull(),
  paymentPrefix: text("payment_prefix").default("PAY").notNull(),
  nextPaymentNumber: integer("next_payment_number").default(1).notNull(),
  quotationPrefix: text("quotation_prefix").default("QTN").notNull(),
  nextQuotationNumber: integer("next_quotation_number").default(1).notNull(),
  creditNotePrefix: text("credit_note_prefix").default("CN").notNull(),
  nextCreditNoteNumber: integer("next_credit_note_number").default(1).notNull(),
  debitNotePrefix: text("debit_note_prefix").default("DN").notNull(),
  nextDebitNoteNumber: integer("next_debit_note_number").default(1).notNull(),
  salesReturnPrefix: text("sales_return_prefix").default("SR").notNull(),
  nextSalesReturnNumber: integer("next_sales_return_number").default(1).notNull(),
  purchaseReturnPrefix: text("purchase_return_prefix").default("PR").notNull(),
  nextPurchaseReturnNumber: integer("next_purchase_return_number").default(1).notNull(),
  deliveryChallanPrefix: text("delivery_challan_prefix").default("DC").notNull(),
  nextDeliveryChallanNumber: integer("next_delivery_challan_number").default(1).notNull(),
  proformaPrefix: text("proforma_prefix").default("PI").notNull(),
  nextProformaNumber: integer("next_proforma_number").default(1).notNull(),
  financialYearStart: integer("financial_year_start_month").default(4).notNull(), // April
  currency: text("currency").default("INR").notNull(),
  annualTurnover: numeric("annual_turnover", { precision: 15, scale: 2 }), // For HSN digit enforcement & e-invoicing threshold
  // ── Online Store settings ──
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  storeSlug: text("store_slug"),
  storeTagline: text("store_tagline"),
  storeAccentColor: text("store_accent_color"),
  storeMinOrderAmount: numeric("store_min_order_amount", { precision: 15, scale: 2 }),
  storeDeliveryNote: text("store_delivery_note"),
  storeWhatsappNumber: text("store_whatsapp_number"),
  storeAllowNegativeStock: boolean("store_allow_negative_stock").default(false).notNull(),
  // Custom shipping/delivery methods configured by the business (in addition to built-in ones)
  customShippingMethods: jsonb("custom_shipping_methods").$type<Array<{ id: string; label: string; hasTracking: boolean }>>(),
  // Carrier API credentials (encrypted at rest) — keyed by carrier slug
  carrierCredentials: jsonb("carrier_credentials").$type<Record<string, { apiKey?: string; apiSecret?: string; accountId?: string; enabled: boolean }>>(),
  nextStoreOrderNumber: integer("next_store_order_number").default(1).notNull(),
  storeOrderPrefix: text("store_order_prefix").default("ORD").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("businesses_owner_idx").on(t.createdByUserId),
  uniqueIndex("businesses_store_slug_idx").on(t.storeSlug),
]);

// ── Parties (Customers / Suppliers) ────────────────────────────

export const parties = pgTable("parties", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  type: partyTypeEnum("type").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  gstin: text("gstin"),
  pan: text("pan"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"), // 2-digit GST state code for inter/intra-state detection
  pincode: text("pincode"),
  openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  category: text("category"),
  creditPeriodDays: integer("credit_period_days"),
  creditLimit: numeric("credit_limit", { precision: 15, scale: 2 }),
  contactPersonName: text("contact_person_name"),
  contactPersonDob: timestamp("contact_person_dob", { withTimezone: true }),
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  bankName: text("bank_name"),
  source: text("source"), // null = manual, "mybillbook", "tally", etc.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("parties_business_idx").on(t.businessId),
  index("parties_type_idx").on(t.businessId, t.type),
  index("parties_name_idx").on(t.businessId, t.name),
]);

// ── Items / Products ───────────────────────────────────────────

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hsn: text("hsn"),
  sku: text("sku"),
  unit: unitEnum("unit").default("pcs").notNull(),
  itemMode: itemModeEnum("item_mode").default("simple").notNull(),
  unitVariants: jsonb("unit_variants").$type<Array<{
    unit: string;
    conversionFactor: number;
    salePrice: string;
    purchasePrice?: string;
  }>>(),
  variantAttributes: jsonb("variant_attributes").$type<string[]>(), // dimension names e.g. ["Size", "Color"]
  salePrice: numeric("sale_price", { precision: 15, scale: 2 }),
  purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  lowStockAlert: numeric("low_stock_alert", { precision: 15, scale: 3 }),
  description: text("description"),
  itemType: itemTypeEnum("item_type").default("product").notNull(),
  category: text("category"),
  taxInclusive: boolean("tax_inclusive").default(false).notNull(),
  source: text("source"),
  // ── Online Store fields ──
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  storePrice: numeric("store_price", { precision: 15, scale: 2 }),
  storeSortOrder: integer("store_sort_order").default(0).notNull(),
  storeCategory: text("store_category"),
  storeDescription: text("store_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Soft delete — historical invoice line items must still resolve item
  // master data for audit/reporting, so deletions are logical rather than
  // physical. Every active read filters on deletedAt IS NULL; historical
  // joins (e.g. rendering a legacy invoice) intentionally include rows
  // where deletedAt IS NOT NULL. See partial index below for query planner
  // support on the active-read hot path.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("items_business_idx").on(t.businessId),
  index("items_name_idx").on(t.businessId, t.name),
  index("items_sku_idx").on(t.businessId, t.sku),
  index("items_store_idx").on(t.businessId, t.storeEnabled),
  // Partial index that mirrors the active-read path (`items.list`, catalog,
  // store, dashboards). The query planner picks this up for any WHERE that
  // includes `business_id` AND `deleted_at IS NULL`, keeping active-item
  // queries off the full table once soft deletes accumulate.
  index("items_active_idx").on(t.businessId, t.name).where(sql`deleted_at IS NULL`),
]);

// ── Item Variants (for items with itemMode = "variants") ─────

export const itemVariants = pgTable("item_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  attributeValues: jsonb("attribute_values").$type<Record<string, string>>().notNull(), // e.g. { "Size": "M", "Color": "Red" }
  sku: text("sku"),
  salePrice: numeric("sale_price", { precision: 15, scale: 2 }),
  purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
  stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  lowStockAlert: numeric("low_stock_alert", { precision: 15, scale: 3 }),
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  storePrice: numeric("store_price", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Soft delete — variants are deleted logically for the same reason as
  // items: historical invoice line items may reference a variantId that
  // was later removed from the catalog. The parent items.onDelete cascade
  // is left in place (physical parent delete still cleans up physically),
  // but both sides switched to soft-delete first so cascade rarely fires.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("item_variants_item_idx").on(t.itemId),
  index("item_variants_sku_idx").on(t.sku),
  // Partial index for the active-variant read path (variant lookups in
  // item detail pages, stock/reporting joins). Mirrors items_active_idx.
  index("item_variants_active_idx").on(t.itemId).where(sql`deleted_at IS NULL`),
]);

// ── Invoices ───────────────────────────────────────────────────

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  type: invoiceTypeEnum("type").notNull(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  documentType: documentTypeEnum("document_type").default("invoice").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).defaultNow().notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).default("0").notNull(),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  discountAmount: numeric("discount_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  charges: jsonb("charges").$type<Array<{ label: string; amount: string; shipmentId?: string }>>(),
  additionalCharges: numeric("additional_charges", { precision: 15, scale: 2 }).default("0").notNull(),
  roundOff: numeric("round_off", { precision: 15, scale: 2 }).default("0").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  amountPaid: numeric("amount_paid", { precision: 15, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  referenceDocumentId: uuid("reference_document_id"),
  // No FK to users — plain UUID, users live in control schema (different DB in cloud mode)
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"), // denormalized for display + imports
  deliveryMethod: text("delivery_method").default("self_pickup"), // self_pickup, hand_delivery, courier, bus, transport, post
  isReverseCharge: boolean("is_reverse_charge").default(false).notNull(),
  source: text("source"),
  // E-Invoicing (IRP) fields
  irn: text("irn"),
  irnAckNumber: text("irn_ack_number"),
  irnAckDate: timestamp("irn_ack_date", { withTimezone: true }),
  signedQrCode: text("signed_qr_code"),
  signedInvoice: jsonb("signed_invoice"),
  eInvoiceStatus: text("e_invoice_status"),  // null | "pending" | "generated" | "cancelled" | "failed"
  eInvoiceError: text("e_invoice_error"),
  eInvoiceRetryCount: integer("e_invoice_retry_count").default(0),
  eInvoiceCancelReason: text("e_invoice_cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("invoices_business_idx").on(t.businessId),
  index("invoices_party_idx").on(t.partyId),
  index("invoices_status_idx").on(t.businessId, t.status),
  index("invoices_date_idx").on(t.businessId, t.invoiceDate),
  uniqueIndex("invoices_number_idx").on(t.businessId, t.invoiceNumber),
  index("invoices_doc_type_idx").on(t.businessId, t.documentType),
  index("invoices_party_date_idx").on(t.businessId, t.partyId, t.invoiceDate),
  index("invoices_ref_doc_idx").on(t.referenceDocumentId),
  index("invoices_einvoice_status_idx").on(t.businessId, t.eInvoiceStatus),
  // Partial indexes for active records — nearly every query filters deletedAt IS NULL
  index("invoices_active_idx").on(t.businessId, t.invoiceDate).where(sql`deleted_at IS NULL`),
  index("invoices_active_type_idx").on(t.businessId, t.type, t.documentType, t.invoiceDate).where(sql`deleted_at IS NULL`),
]);

// ── Invoice Line Items ─────────────────────────────────────────

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  // Snapshot of the item name at billing time. Required — frozen at create.
  // Preserves the name the customer was billed for even if the item is later renamed.
  itemName: text("item_name").notNull(),
  // Optional free-text line notes (e.g. "Keep separate from order #42").
  // Not populated by imports — only set when the user types something.
  description: text("description"),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  selectedUnit: text("selected_unit"), // which unit was used (null = base unit)
  conversionFactor: numeric("conversion_factor", { precision: 10, scale: 4 }).default("1"), // how many base units per selected unit
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "set null" }),
}, (t) => [
  index("invoice_items_invoice_idx").on(t.invoiceId),
  index("invoice_items_item_idx").on(t.itemId),
  index("invoice_items_variant_idx").on(t.variantId),
]);

// ── Payments ───────────────────────────────────────────────────

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentNumber: text("payment_number"),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 15, scale: 2 }).default("0").notNull(),
  mode: paymentModeEnum("mode").notNull(),
  referenceNumber: text("reference_number"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).defaultNow().notNull(),
  notes: text("notes"),
  bankAccountId: uuid("bank_account_id"),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("payments_business_idx").on(t.businessId),
  index("payments_invoice_idx").on(t.invoiceId),
  index("payments_party_idx").on(t.partyId),
  index("payments_date_idx").on(t.businessId, t.paymentDate),
  index("payments_party_date_idx").on(t.businessId, t.partyId, t.paymentDate),
  index("payments_active_idx").on(t.businessId, t.paymentDate).where(sql`deleted_at IS NULL`),
]);

// ── Payment Allocations (M:N link between payments and invoices) ──

export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payment_alloc_payment_idx").on(t.paymentId),
  index("payment_alloc_invoice_idx").on(t.invoiceId),
]);

// ── Expenses ───────────────────────────────────────────────────

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  mode: paymentModeEnum("mode").notNull(),
  expenseDate: timestamp("expense_date", { withTimezone: true }).defaultNow().notNull(),
  referenceNumber: text("reference_number"),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("expenses_business_idx").on(t.businessId),
  index("expenses_date_idx").on(t.businessId, t.expenseDate),
  index("expenses_category_idx").on(t.businessId, t.category),
  index("expenses_active_idx").on(t.businessId, t.expenseDate).where(sql`deleted_at IS NULL`),
]);

// ── Bank Accounts ──────────────────────────────────────────────

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  accountName: text("account_name").notNull(),
  accountNumber: text("account_number"),
  ifsc: text("ifsc"),
  bankName: text("bank_name"),
  accountType: bankAccountTypeEnum("account_type").default("savings").notNull(),
  openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  currentBalance: numeric("current_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bank_accounts_business_idx").on(t.businessId),
]);

// ── Bank Transactions ───────────────────────────────────────────

export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  type: bankTransactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  description: text("description"),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  paymentId: uuid("payment_id"), // links gateway charge/settlement txns to originating payment
  transactionDate: timestamp("transaction_date", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bank_txn_business_idx").on(t.businessId),
  index("bank_txn_account_idx").on(t.bankAccountId),
  index("bank_txn_date_idx").on(t.bankAccountId, t.transactionDate),
  index("bank_txn_ref_idx").on(t.referenceType, t.referenceId),
  index("bank_txn_payment_idx").on(t.paymentId),
]);

// ── Payment Gateway Configs ───────────────────────────────────

export const paymentGatewayConfigs = pgTable("payment_gateway_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  settlementAccountId: uuid("settlement_account_id").notNull().references(() => bankAccounts.id, { onDelete: "restrict" }),
  chargeConfig: jsonb("charge_config").notNull().$type<{
    credit_card?: { type: "percentage" | "flat"; value: string };
    debit_card?: { type: "percentage" | "flat"; value: string };
    upi?: { type: "percentage" | "flat"; value: string };
    net_banking?: { type: "percentage" | "flat"; value: string };
    wallet?: { type: "percentage" | "flat"; value: string };
    default?: { type: "percentage" | "flat"; value: string };
  }>(),
  expenseCategory: text("expense_category").default("Payment Gateway Charges").notNull(),
  autoSettle: boolean("auto_settle").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pg_config_account_idx").on(t.bankAccountId),
  index("pg_config_business_idx").on(t.businessId),
]);

export const paymentGatewayConfigsRelations = relations(paymentGatewayConfigs, ({ one }) => ({
  business: one(businesses, { fields: [paymentGatewayConfigs.businessId], references: [businesses.id] }),
  bankAccount: one(bankAccounts, { fields: [paymentGatewayConfigs.bankAccountId], references: [bankAccounts.id] }),
  settlementAccount: one(bankAccounts, { fields: [paymentGatewayConfigs.settlementAccountId], references: [bankAccounts.id] }),
}));

// ── Stock Adjustments ─────────────────────────────────────────

export const stockAdjustments = pgTable("stock_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  // +ve = stock added, -ve = stock removed
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  previousStock: numeric("previous_stock", { precision: 15, scale: 3 }).notNull(),
  newStock: numeric("new_stock", { precision: 15, scale: 3 }).notNull(),
  reason: text("reason"), // e.g. "Damaged goods", "Physical count correction", "Opening stock"
  adjustmentDate: timestamp("adjustment_date", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("stock_adj_business_idx").on(t.businessId),
  index("stock_adj_item_idx").on(t.itemId),
  index("stock_adj_variant_idx").on(t.variantId),
  index("stock_adj_date_idx").on(t.businessId, t.adjustmentDate),
]);

// ── Sales Targets ─────────────────────────────────────────────

export const salesTargets = pgTable("sales_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(), // the seller this target is for — no FK (users live in control schema)

  // Target type — what metric to track
  targetType: text("target_type").notNull(), // "order_count" | "order_value" | "item_quantity"

  // Target value
  targetValue: numeric("target_value", { precision: 15, scale: 2 }).notNull(), // e.g., 50 orders, ₹500000, 1000 units

  // Optional: specific item the target applies to (null = all items)
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),

  // Period
  periodType: text("period_type").notNull(), // "daily" | "weekly" | "monthly" | "quarterly" | "custom"
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

  // Metadata
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("sales_targets_business_idx").on(t.businessId),
  index("sales_targets_user_idx").on(t.businessId, t.userId),
  index("sales_targets_period_idx").on(t.businessId, t.periodStart, t.periodEnd),
]);

// ── Audit Log ──────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // No FK to users — plain UUID, users live in control schema (different DB in cloud mode)
  userId: uuid("user_id").notNull(),
  action: text("action").notNull(), // e.g., "invoice.create", "payment.delete"
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: text("metadata"), // JSON string of changes
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_log_business_idx").on(t.businessId),
  index("audit_log_entity_idx").on(t.entityType, t.entityId),
  index("audit_log_date_idx").on(t.businessId, t.createdAt),
]);

// ── Shipments ─────────────────────────────────────────────────

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "pending", "shipped", "in_transit", "delivered", "returned",
]);

export const shipments = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  partyId: uuid("party_id").references(() => parties.id, { onDelete: "set null" }),
  // Shipping details
  carrier: text("carrier"),                     // e.g. "Delhivery", "BlueDart", "Self", "Transport"
  mode: text("mode"),                           // e.g. "courier", "transport", "hand_delivery", "post"
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  // Costs & weight
  cost: numeric("cost", { precision: 15, scale: 2 }).default("0").notNull(),
  weight: numeric("weight", { precision: 10, scale: 3 }),  // in kg
  // Addresses
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  shippingPincode: text("shipping_pincode"),
  // Carrier API integration (future-proofing)
  carrierOrderId: text("carrier_order_id"),    // carrier's internal order/AWB ID
  labelUrl: text("label_url"),                  // shipping label PDF URL from carrier
  manifestId: text("manifest_id"),              // carrier manifest/pickup ID
  carrierMeta: jsonb("carrier_meta"),           // carrier-specific data (weight slabs, dimensions, COD, etc.)
  // Status & dates
  status: shipmentStatusEnum("status").default("pending").notNull(),
  shipmentDate: timestamp("shipment_date", { withTimezone: true }),
  estimatedDelivery: timestamp("estimated_delivery", { withTimezone: true }),
  actualDelivery: timestamp("actual_delivery", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("shipments_business_idx").on(t.businessId),
  index("shipments_invoice_idx").on(t.invoiceId),
  index("shipments_party_idx").on(t.partyId),
  index("shipments_status_idx").on(t.businessId, t.status),
  index("shipments_date_idx").on(t.businessId, t.shipmentDate),
  index("shipments_carrier_order_idx").on(t.carrierOrderId),
]);

// Shipment status timeline — each event is a scan/status update from carrier or manual
export const shipmentEvents = pgTable("shipment_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  status: text("status").notNull(),               // our status or carrier-specific status string
  statusDetail: text("status_detail"),             // human-readable detail (e.g. "Package arrived at Mumbai hub")
  location: text("location"),                      // scan location from carrier
  source: text("source").default("manual"),        // "manual" | "webhook" | "api_poll"
  carrierStatus: text("carrier_status"),           // raw carrier status code before mapping
  eventTime: timestamp("event_time", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("shipment_events_shipment_idx").on(t.shipmentId),
  index("shipment_events_time_idx").on(t.shipmentId, t.eventTime),
]);

// ── Store Orders ───────────────────────────────────────────────

export const storeOrderStatusEnum = pgEnum("store_order_status", [
  "pending", "confirmed", "preparing", "ready", "delivered", "cancelled",
]);

export const storeOrders = pgTable("store_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  orderNumber: text("order_number").notNull(),
  status: storeOrderStatusEnum("status").default("pending").notNull(),
  // Customer info (not a party — anonymous store customer)
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email"),
  deliveryAddress: text("delivery_address"),
  deliveryCity: text("delivery_city"),
  deliveryPincode: text("delivery_pincode"),
  deliveryNotes: text("delivery_notes"),
  // Totals (denormalized from invoice for quick display)
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  itemCount: integer("item_count").default(0).notNull(),
  source: text("source").default("online_store").notNull(), // extensible: "whatsapp", "shopify"
  // Lifecycle timestamps
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("store_orders_business_idx").on(t.businessId),
  index("store_orders_status_idx").on(t.businessId, t.status),
  index("store_orders_date_idx").on(t.businessId, t.createdAt),
  index("store_orders_phone_idx").on(t.businessId, t.customerPhone),
  uniqueIndex("store_orders_number_idx").on(t.businessId, t.orderNumber),
  index("store_orders_invoice_idx").on(t.invoiceId),
]);

// ── Recurring Invoice Templates ────────────────────────────────

export const recurringInvoiceTemplates = pgTable("recurring_invoice_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: invoiceTypeEnum("type").notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  customIntervalDays: integer("custom_interval_days"), // only when frequency = 'custom'
  lineItems: jsonb("line_items").$type<Array<{
    itemId?: string;
    itemName: string;
    description?: string | null;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    discountPercent: string;
    selectedUnit?: string | null;
    conversionFactor?: string | null;
    variantId?: string | null;
  }>>().notNull(),
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  additionalCharges: numeric("additional_charges", { precision: 15, scale: 2 }).default("0").notNull(),
  charges: jsonb("charges").$type<Array<{ label: string; amount: string }>>(),
  status: recurringTemplateStatusEnum("status").default("active").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  nextRunDate: timestamp("next_run_date", { withTimezone: true }).notNull(),
  lastRunDate: timestamp("last_run_date", { withTimezone: true }),
  totalRuns: integer("total_runs").default(0).notNull(),
  maxRuns: integer("max_runs"), // null = unlimited
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("recurring_tpl_business_idx").on(t.businessId),
  index("recurring_tpl_party_idx").on(t.partyId),
  index("recurring_tpl_status_idx").on(t.businessId, t.status),
  index("recurring_tpl_next_run_idx").on(t.status, t.nextRunDate),
]);

// ── Recurring Invoice Runs (execution history) ────────────────

export const recurringInvoiceRuns = pgTable("recurring_invoice_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => recurringInvoiceTemplates.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  status: recurringRunStatusEnum("status").notNull(),
  errorMessage: text("error_message"),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("recurring_run_template_idx").on(t.templateId),
  index("recurring_run_business_idx").on(t.businessId),
  index("recurring_run_executed_idx").on(t.businessId, t.executedAt),
]);

// ── Chart of Accounts ──────────────────────────────────────────

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  parentId: uuid("parent_id"),  // self-ref for hierarchy, null = root
  isSystem: boolean("is_system").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("coa_business_idx").on(t.businessId),
  uniqueIndex("coa_business_code_idx").on(t.businessId, t.code),
  index("coa_parent_idx").on(t.parentId),
  index("coa_type_idx").on(t.businessId, t.accountType),
]);

// ── Journal Entries (manual double-entry for CA adjustments) ──

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  entryNumber: text("entry_number").notNull(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull(),
  narration: text("narration"),
  source: text("source").default("manual").notNull(), // "manual" | "system"
  isVoided: boolean("is_voided").default(false).notNull(),
  voidedByEntryId: uuid("voided_by_entry_id"),   // points to the reversing entry
  reversesEntryId: uuid("reverses_entry_id"),     // on the reversal, points to original
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("je_business_idx").on(t.businessId),
  index("je_date_idx").on(t.businessId, t.entryDate),
  uniqueIndex("je_number_idx").on(t.businessId, t.entryNumber),
]);

export const journalEntryLines = pgTable("journal_entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  debit: numeric("debit", { precision: 15, scale: 2 }).default("0").notNull(),
  credit: numeric("credit", { precision: 15, scale: 2 }).default("0").notNull(),
  narration: text("narration"),
}, (t) => [
  index("jel_entry_idx").on(t.journalEntryId),
  index("jel_account_idx").on(t.accountId),
]);

// ── Journal Entry Templates ──────────────────────────────────

export const journalEntryTemplates = pgTable("journal_entry_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  narration: text("narration"),
  lines: jsonb("lines").$type<Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
    narration?: string;
  }>>().notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("jet_business_idx").on(t.businessId),
]);

// ── ITC (Input Tax Credit) Tracking ─────────────────────────

export const itcStatusEnum = pgEnum("itc_status", [
  "available",    // ITC available for utilization
  "utilized",     // ITC utilized against output liability
  "reversed",     // ITC reversed (180-day rule, ineligibility, etc.)
  "reclaimed",    // ITC re-availed after reversal
  "blocked",      // Blocked under Section 17(5)
]);

export const itcLedgerEntries = pgTable("itc_ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  returnPeriod: text("return_period").notNull(),  // "2026-04" format
  status: itcStatusEnum("status").notNull(),
  cgst: numeric("cgst", { precision: 15, scale: 2 }).default("0").notNull(),
  sgst: numeric("sgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igst: numeric("igst", { precision: 15, scale: 2 }).default("0").notNull(),
  cess: numeric("cess", { precision: 15, scale: 2 }).default("0").notNull(),
  isReverseCharge: boolean("is_reverse_charge").default(false).notNull(),
  blockReason: text("block_reason"),   // "motor_vehicle", "food_beverage", "personal", "membership", etc.
  reversalReason: text("reversal_reason"),  // "section_16_4_180_days", "rule_42", "rule_43", "section_17_5"
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("itc_business_idx").on(t.businessId),
  index("itc_invoice_idx").on(t.invoiceId),
  index("itc_period_idx").on(t.businessId, t.returnPeriod),
  index("itc_status_idx").on(t.businessId, t.status),
]);

export const itcUtilizations = pgTable("itc_utilizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  returnPeriod: text("return_period").notNull(),  // "2026-04"
  cgstUtilized: numeric("cgst_utilized", { precision: 15, scale: 2 }).default("0").notNull(),
  sgstUtilized: numeric("sgst_utilized", { precision: 15, scale: 2 }).default("0").notNull(),
  igstUtilizedAgainstCgst: numeric("igst_utilized_against_cgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igstUtilizedAgainstSgst: numeric("igst_utilized_against_sgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igstUtilizedAgainstIgst: numeric("igst_utilized_against_igst", { precision: 15, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("itc_util_business_idx").on(t.businessId),
  uniqueIndex("itc_util_period_idx").on(t.businessId, t.returnPeriod),
]);

// ── Bank Statement Templates ─────────────────────────────────

export const bankStatementTemplates = pgTable("bank_statement_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankSlug: text("bank_slug").notNull(),
  bankDisplayName: text("bank_display_name").notNull(),
  version: integer("version").default(1).notNull(),
  label: text("label"),
  isSeeded: boolean("is_seeded").default(false).notNull(),
  forkedFromId: uuid("forked_from_id"),
  columnMapping: jsonb("column_mapping").$type<{
    date: number;
    narration: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    reference?: number;
    balance?: number;
    dateFormat: string;
    skipRows: number;
    amountSignConvention?: "debit_positive" | "credit_positive";
  }>().notNull(),
  preprocessRules: jsonb("preprocess_rules").$type<{
    extraHeaderRows?: number;
    skipRowPatterns?: string[];
    amountParsingMode?: "standard" | "dr_cr_suffix" | "parentheses_negative" | "signed";
    skipSubtotalRows?: boolean;
    encoding?: string;
  }>(),
  detectionRules: jsonb("detection_rules").$type<{
    headerPatterns?: string[];
    columnCount?: { min: number; max: number };
    firstRowPatterns?: string[];
    ifscPrefix?: string;
  }>(),
  fileFormat: text("file_format").default("csv").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bst_business_idx").on(t.businessId),
  index("bst_bank_slug_idx").on(t.businessId, t.bankSlug),
  uniqueIndex("bst_business_bank_version_idx").on(t.businessId, t.bankSlug, t.version, t.fileFormat),
]);

// ── Bank Statement Reconciliation ────────────────────────────

export const bankStatementImportStatusEnum = pgEnum("bank_statement_import_status", [
  "pending", "mapped", "processing", "review", "completed",
]);

export const bankStatementMatchStatusEnum = pgEnum("bank_statement_match_status", [
  "auto_matched", "manual_matched", "unmatched", "created", "ignored",
]);

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  status: bankStatementImportStatusEnum("status").default("pending").notNull(),
  templateId: uuid("template_id").references(() => bankStatementTemplates.id, { onDelete: "set null" }),
  templateVersion: integer("template_version"),
  columnMapping: jsonb("column_mapping").$type<{
    date: number;
    narration: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    reference?: number;
    balance?: number;
    dateFormat: string;
    skipRows: number;
    amountSignConvention?: "debit_positive" | "credit_positive";
  }>(),
  totalLines: integer("total_lines").default(0).notNull(),
  matchedLines: integer("matched_lines").default(0).notNull(),
  unmatchedLines: integer("unmatched_lines").default(0).notNull(),
  statementStartDate: timestamp("statement_start_date", { withTimezone: true }),
  statementEndDate: timestamp("statement_end_date", { withTimezone: true }),
  closingBalance: numeric("closing_balance", { precision: 15, scale: 2 }),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bsi_business_idx").on(t.businessId),
  index("bsi_bank_account_idx").on(t.bankAccountId),
]);

export const bankStatementLines = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => bankStatementImports.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  narration: text("narration"),
  debit: numeric("debit", { precision: 15, scale: 2 }).default("0").notNull(),
  credit: numeric("credit", { precision: 15, scale: 2 }).default("0").notNull(),
  balance: numeric("balance", { precision: 15, scale: 2 }),
  referenceNumber: text("reference_number"),
  rawData: jsonb("raw_data"),
  matchStatus: bankStatementMatchStatusEnum("match_status").default("unmatched").notNull(),
  matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
  matchedPaymentId: uuid("matched_payment_id"),
  matchedExpenseId: uuid("matched_expense_id"),
  matchedBankTransactionId: uuid("matched_bank_transaction_id"),
  autoCategory: text("auto_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bsl_import_idx").on(t.importId),
  index("bsl_business_idx").on(t.businessId),
  index("bsl_date_idx").on(t.businessId, t.transactionDate),
  index("bsl_status_idx").on(t.importId, t.matchStatus),
  index("bsl_dedup_idx").on(t.businessId, t.transactionDate, t.debit, t.credit, t.referenceNumber),
]);

export const bankCategorizationRules = pgTable("bank_categorization_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, { onDelete: "cascade" }),
  matchField: text("match_field").notNull(),       // "narration" | "reference"
  matchType: text("match_type").notNull(),          // "contains" | "starts_with" | "exact" | "regex"
  matchValue: text("match_value").notNull(),
  action: text("action").notNull(),                 // "create_expense" | "ignore" | "tag_party"
  expenseCategory: text("expense_category"),
  partyId: uuid("party_id"),
  priority: integer("priority").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  hitCount: integer("hit_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bcr_business_idx").on(t.businessId),
]);

// ── E-Invoice Configuration ─────────────────────────────────

export const eInvoiceConfigs = pgTable("e_invoice_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  gstin: text("gstin").notNull(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  authToken: text("auth_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  isSandbox: boolean("is_sandbox").default(true).notNull(),
  isEnabled: boolean("is_enabled").default(false).notNull(),
  thresholdCrore: numeric("threshold_crore", { precision: 5, scale: 2 }).default("5").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("einv_config_business_idx").on(t.businessId),
]);

// ── E-Way Bill ──────────────────────────────────────────────

export const ewayBillStatusEnum = pgEnum("eway_bill_status", [
  "generated", "active", "cancelled", "expired",
]);

export const ewayBills = pgTable("eway_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  ewbNumber: text("ewb_number"),
  ewbDate: timestamp("ewb_date", { withTimezone: true }),
  validUpto: timestamp("valid_upto", { withTimezone: true }),
  status: ewayBillStatusEnum("status").default("generated").notNull(),
  transporterId: text("transporter_id"),
  transporterName: text("transporter_name"),
  vehicleNumber: text("vehicle_number"),
  vehicleType: text("vehicle_type"),
  transportMode: text("transport_mode"),
  distance: integer("distance"),
  fromAddress: text("from_address"),
  fromPincode: text("from_pincode"),
  fromState: text("from_state"),
  toAddress: text("to_address"),
  toPincode: text("to_pincode"),
  toState: text("to_state"),
  cancelReason: text("cancel_reason"),
  apiResponse: jsonb("api_response"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ewb_business_idx").on(t.businessId),
  index("ewb_invoice_idx").on(t.invoiceId),
  index("ewb_number_idx").on(t.ewbNumber),
  index("ewb_status_idx").on(t.businessId, t.status),
  index("ewb_validity_idx").on(t.businessId, t.validUpto),
]);

export const ewayBillVehicleUpdates = pgTable("eway_bill_vehicle_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  ewayBillId: uuid("eway_bill_id").notNull().references(() => ewayBills.id, { onDelete: "cascade" }),
  vehicleNumber: text("vehicle_number").notNull(),
  fromPlace: text("from_place"),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ewb_vehicle_ewb_idx").on(t.ewayBillId),
]);

// ── GSTR-2B Reconciliation ────────────────────────────────────

export const gstr2bUploads = pgTable("gstr2b_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  returnPeriod: text("return_period").notNull(),  // "2026-04"
  fileName: text("file_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  totalRecords: integer("total_records").default(0).notNull(),
  matchedRecords: integer("matched_records").default(0).notNull(),
  unmatchedRecords: integer("unmatched_records").default(0).notNull(),
  newRecords: integer("new_records").default(0).notNull(),  // In 2B but not in our books
  createdByUserId: uuid("created_by_user_id"),
}, (t) => [
  index("g2b_business_idx").on(t.businessId),
  index("g2b_period_idx").on(t.businessId, t.returnPeriod),
]);

export const gstr2bRecords = pgTable("gstr2b_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull().references(() => gstr2bUploads.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  supplierGstin: text("supplier_gstin").notNull(),
  supplierName: text("supplier_name"),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }),
  invoiceValue: numeric("invoice_value", { precision: 15, scale: 2 }).default("0").notNull(),
  taxableValue: numeric("taxable_value", { precision: 15, scale: 2 }).default("0").notNull(),
  cgst: numeric("cgst", { precision: 15, scale: 2 }).default("0").notNull(),
  sgst: numeric("sgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igst: numeric("igst", { precision: 15, scale: 2 }).default("0").notNull(),
  cess: numeric("cess", { precision: 15, scale: 2 }).default("0").notNull(),
  itcAvailable: text("itc_available"),  // "Y" | "N"
  reason: text("reason"),               // Reason if ITC not available
  sourceType: text("source_type"),      // "B2B" | "B2BA" | "CDNR" | "ISD" | etc.
  // Reconciliation
  matchStatus: text("match_status").default("pending").notNull(),  // "matched" | "mismatched" | "missing_in_books" | "pending" | "ignored"
  matchedInvoiceId: uuid("matched_invoice_id"),  // Links to our purchase invoice
  mismatchReasons: jsonb("mismatch_reasons").$type<string[]>(),  // ["amount_difference", "date_difference", etc.]
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("g2br_upload_idx").on(t.uploadId),
  index("g2br_business_idx").on(t.businessId),
  index("g2br_gstin_idx").on(t.businessId, t.supplierGstin),
  index("g2br_match_idx").on(t.uploadId, t.matchStatus),
]);

// ── Relations ──────────────────────────────────────────────────

export const businessesRelations = relations(businesses, ({ many }) => ({
  parties: many(parties),
  items: many(items),
  invoices: many(invoices),
  payments: many(payments),
  expenses: many(expenses),
  bankAccounts: many(bankAccounts),
  storeOrders: many(storeOrders),
  salesTargets: many(salesTargets),
  recurringInvoiceTemplates: many(recurringInvoiceTemplates),
}));

export const partiesRelations = relations(parties, ({ one, many }) => ({
  business: one(businesses, { fields: [parties.businessId], references: [businesses.id] }),
  invoices: many(invoices),
  payments: many(payments),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  business: one(businesses, { fields: [items.businessId], references: [businesses.id] }),
  variants: many(itemVariants),
}));

export const itemVariantsRelations = relations(itemVariants, ({ one }) => ({
  item: one(items, { fields: [itemVariants.itemId], references: [items.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  business: one(businesses, { fields: [invoices.businessId], references: [businesses.id] }),
  party: one(parties, { fields: [invoices.partyId], references: [parties.id] }),
  lineItems: many(invoiceItems),
  payments: many(payments),
  referenceDocument: one(invoices, { fields: [invoices.referenceDocumentId], references: [invoices.id], relationName: "referenceDoc" }),
  linkedDocuments: many(invoices, { relationName: "referenceDoc" }),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
  item: one(items, { fields: [invoiceItems.itemId], references: [items.id] }),
  variant: one(itemVariants, { fields: [invoiceItems.variantId], references: [itemVariants.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  business: one(businesses, { fields: [payments.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  party: one(parties, { fields: [payments.partyId], references: [parties.id] }),
  bankAccount: one(bankAccounts, { fields: [payments.bankAccountId], references: [bankAccounts.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  business: one(businesses, { fields: [expenses.businessId], references: [businesses.id] }),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  business: one(businesses, { fields: [bankAccounts.businessId], references: [businesses.id] }),
  transactions: many(bankTransactions),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  business: one(businesses, { fields: [bankTransactions.businessId], references: [businesses.id] }),
  bankAccount: one(bankAccounts, { fields: [bankTransactions.bankAccountId], references: [bankAccounts.id] }),
}));

export const storeOrdersRelations = relations(storeOrders, ({ one }) => ({
  business: one(businesses, { fields: [storeOrders.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [storeOrders.invoiceId], references: [invoices.id] }),
}));

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one }) => ({
  business: one(businesses, { fields: [stockAdjustments.businessId], references: [businesses.id] }),
  item: one(items, { fields: [stockAdjustments.itemId], references: [items.id] }),
  variant: one(itemVariants, { fields: [stockAdjustments.variantId], references: [itemVariants.id] }),
}));

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  business: one(businesses, { fields: [shipments.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [shipments.invoiceId], references: [invoices.id] }),
  party: one(parties, { fields: [shipments.partyId], references: [parties.id] }),
  events: many(shipmentEvents),
}));

export const shipmentEventsRelations = relations(shipmentEvents, ({ one }) => ({
  shipment: one(shipments, { fields: [shipmentEvents.shipmentId], references: [shipments.id] }),
}));

export const salesTargetsRelations = relations(salesTargets, ({ one }) => ({
  business: one(businesses, { fields: [salesTargets.businessId], references: [businesses.id] }),
  item: one(items, { fields: [salesTargets.itemId], references: [items.id] }),
}));

export const recurringInvoiceTemplatesRelations = relations(recurringInvoiceTemplates, ({ one, many }) => ({
  business: one(businesses, { fields: [recurringInvoiceTemplates.businessId], references: [businesses.id] }),
  party: one(parties, { fields: [recurringInvoiceTemplates.partyId], references: [parties.id] }),
  runs: many(recurringInvoiceRuns),
}));

export const recurringInvoiceRunsRelations = relations(recurringInvoiceRuns, ({ one }) => ({
  template: one(recurringInvoiceTemplates, { fields: [recurringInvoiceRuns.templateId], references: [recurringInvoiceTemplates.id] }),
  business: one(businesses, { fields: [recurringInvoiceRuns.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [recurringInvoiceRuns.invoiceId], references: [invoices.id] }),
}));

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  business: one(businesses, { fields: [journalEntries.businessId], references: [businesses.id] }),
  lines: many(journalEntryLines),
}));

export const journalEntryLinesRelations = relations(journalEntryLines, ({ one }) => ({
  journalEntry: one(journalEntries, { fields: [journalEntryLines.journalEntryId], references: [journalEntries.id] }),
  account: one(chartOfAccounts, { fields: [journalEntryLines.accountId], references: [chartOfAccounts.id] }),
}));
