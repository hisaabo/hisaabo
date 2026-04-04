import { pgTable, text, timestamp, numeric, integer, boolean, uuid, pgEnum, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  deliveryChallanPrefix: text("delivery_challan_prefix").default("DC").notNull(),
  nextDeliveryChallanNumber: integer("next_delivery_challan_number").default(1).notNull(),
  proformaPrefix: text("proforma_prefix").default("PI").notNull(),
  nextProformaNumber: integer("next_proforma_number").default(1).notNull(),
  financialYearStart: integer("financial_year_start_month").default(4).notNull(), // April
  currency: text("currency").default("INR").notNull(),
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
}, (t) => [
  index("items_business_idx").on(t.businessId),
  index("items_name_idx").on(t.businessId, t.name),
  index("items_sku_idx").on(t.businessId, t.sku),
  index("items_store_idx").on(t.businessId, t.storeEnabled),
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
}, (t) => [
  index("item_variants_item_idx").on(t.itemId),
  index("item_variants_sku_idx").on(t.sku),
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
  charges: jsonb("charges").$type<Array<{ label: string; amount: string }>>(),
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
  source: text("source"),
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
]);

// ── Invoice Line Items ─────────────────────────────────────────

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  description: text("description").notNull(),
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
    description: string;
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
