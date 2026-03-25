import { pgTable, text, timestamp, numeric, integer, boolean, uuid, pgEnum, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────

export const partyTypeEnum = pgEnum("party_type", ["customer", "supplier"]);
export const invoiceTypeEnum = pgEnum("invoice_type", ["sale", "purchase"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"]);
export const paymentModeEnum = pgEnum("payment_mode", ["cash", "bank", "upi", "cheque", "other"]);
export const unitEnum = pgEnum("unit", ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"]);
export const itemTypeEnum = pgEnum("item_type", ["product", "service"]);
export const documentTypeEnum = pgEnum("document_type", ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"]);
export const bankAccountTypeEnum = pgEnum("bank_account_type", ["savings", "current", "cash", "upi", "credit_card"]);
export const bankTransactionTypeEnum = pgEnum("bank_transaction_type", ["deposit", "withdrawal", "transfer"]);
export const gstRegistrationTypeEnum = pgEnum("gst_registration_type", ["regular", "composition", "unregistered"]);

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
  unitVariants: jsonb("unit_variants").$type<Array<{
    unit: string;
    conversionFactor: number;
    salePrice: string;
    purchasePrice?: string;
  }>>(),
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
}, (t) => [
  index("invoice_items_invoice_idx").on(t.invoiceId),
  index("invoice_items_item_idx").on(t.itemId),
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
  transactionDate: timestamp("transaction_date", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bank_txn_business_idx").on(t.businessId),
  index("bank_txn_account_idx").on(t.bankAccountId),
  index("bank_txn_date_idx").on(t.bankAccountId, t.transactionDate),
  index("bank_txn_ref_idx").on(t.referenceType, t.referenceId),
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
}));

export const partiesRelations = relations(parties, ({ one, many }) => ({
  business: one(businesses, { fields: [parties.businessId], references: [businesses.id] }),
  invoices: many(invoices),
  payments: many(payments),
}));

export const itemsRelations = relations(items, ({ one }) => ({
  business: one(businesses, { fields: [items.businessId], references: [businesses.id] }),
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
