/**
 * fixtures.ts — Entity factory functions for integration tests.
 *
 * WHY THIS FILE EXISTS:
 * Each factory inserts a real row into the test database and returns the
 * created entity (via .returning()). Factories accept optional overrides so
 * callers can tweak only the fields relevant to a given test while keeping
 * all other required columns filled with sensible Indian-context defaults.
 *
 * Design rules:
 *   - No required overrides — every factory works with zero arguments.
 *   - All money values are strings ("100.00"), never JS floats.
 *   - IDs use randomUUID() so parallel test suites don't collide.
 *   - Indian business names, GSTINs, phone numbers for realistic test data.
 *   - Factory return types are the full inserted row (all columns).
 *
 * Usage pattern:
 *   const { user, tenant, business } = await createTestWorld();
 *   const party = await createParty(db, business.id);
 */

import { randomUUID } from "crypto";
import {
  users,
  tenants,
  sessions,
  tenantMembers,
  businesses,
  parties,
  items,
  invoices,
  invoiceItems,
  payments,
  expenses,
  bankAccounts,
} from "@hisaabo/db";
import { getControlDb, getTenantTestDb, type TenantTestDb } from "./test-db.js";

// ── Type helpers ───────────────────────────────────────────────────────────────

// Extract the row type returned by a Drizzle .returning() call for a given table.
type InferInserted<T extends { $inferInsert: unknown }> = T["$inferInsert"];

// Concrete return types for each factory — the full inserted row shape
export type TestUser = typeof users.$inferSelect;
export type TestTenant = typeof tenants.$inferSelect;
export type TestSession = typeof sessions.$inferSelect;
export type TestMember = typeof tenantMembers.$inferSelect;
export type TestBusiness = typeof businesses.$inferSelect;
export type TestParty = typeof parties.$inferSelect;
export type TestItem = typeof items.$inferSelect;
export type TestInvoice = typeof invoices.$inferSelect;
export type TestInvoiceItem = typeof invoiceItems.$inferSelect;
export type TestPayment = typeof payments.$inferSelect;
export type TestExpense = typeof expenses.$inferSelect;
export type TestBankAccount = typeof bankAccounts.$inferSelect;

// ── Control plane factories ────────────────────────────────────────────────────

/**
 * Creates a user row in the control schema and returns the full row.
 *
 * The password_hash is a bcrypt hash of "Test@1234!" for tests that need to
 * verify the auth flow, but most tests should use session factories instead.
 */
export async function createUser(
  overrides: Partial<InferInserted<typeof users>> = {},
): Promise<TestUser> {
  const db = getControlDb();
  const id = randomUUID();

  const [row] = await db
    .insert(users)
    .values({
      id,
      email: `user.${id.slice(0, 8)}@example.in`,
      name: "Test User",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder_test_hash",
      emailVerified: true,
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates a tenant row and returns the full row.
 * In self-hosted mode dbName/dbHost/dbPort/dbUser/dbPassword are null —
 * getTenantDb() ignores them and uses DATABASE_URL.
 */
export async function createTenant(
  overrides: Partial<InferInserted<typeof tenants>> = {},
): Promise<TestTenant> {
  const db = getControlDb();
  const id = randomUUID();
  const slug = `tenant-${id.slice(0, 8)}`;

  const [row] = await db
    .insert(tenants)
    .values({
      id,
      name: "Acme Trading Co",
      slug,
      plan: "business",
      status: "active",
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates a session for a given userId and returns the session row.
 * The session is valid for 30 days from now.
 *
 * Pass tenantId if the session should have a tenant pre-selected (normal
 * post-login state after the user chooses an organisation).
 */
export async function createSession(
  userId: string,
  tenantId?: string,
): Promise<TestSession> {
  const db = getControlDb();
  const id = randomUUID(); // use UUID as session token — not cryptographically correct for prod but fine for tests

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const [row] = await db
    .insert(sessions)
    .values({
      id,
      userId,
      expiresAt,
      tenantId: tenantId ?? null,
    })
    .returning();

  return row!;
}

/**
 * Adds a member to a tenant and returns the membership row.
 * role must be one of the memberRoleEnum values.
 */
export async function addMember(
  tenantId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "viewer" | "superadmin" | "seller_manager" | "seller" | "accountant" = "owner",
): Promise<TestMember> {
  const db = getControlDb();

  const acceptedAt = new Date(); // mark as already accepted

  const [row] = await db
    .insert(tenantMembers)
    .values({
      tenantId,
      userId,
      role,
      acceptedAt,
    })
    .returning();

  return row!;
}

// ── Tenant plane factories ────────────────────────────────────────────────────

/**
 * Creates a business row in the tenant DB.
 *
 * The createdByUserId is a plain UUID (no FK — users live in control schema).
 * In cloud mode the two schemas are in different databases.
 */
export async function createBusiness(
  db: TenantTestDb,
  createdByUserId: string,
  overrides: Partial<InferInserted<typeof businesses>> = {},
): Promise<TestBusiness> {
  const [row] = await db
    .insert(businesses)
    .values({
      createdByUserId,
      name: "Acme Trading Co",
      gstRegistrationType: "regular",
      gstin: "27AABCU9603R1ZM",
      phone: "9876543210",
      email: "acme@example.in",
      address: "123 MG Road",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400001",
      currency: "INR",
      invoicePrefix: "INV",
      nextInvoiceNumber: 1,
      paymentPrefix: "PAY",
      nextPaymentNumber: 1,
      quotationPrefix: "QTN",
      nextQuotationNumber: 1,
      creditNotePrefix: "CN",
      nextCreditNoteNumber: 1,
      deliveryChallanPrefix: "DC",
      nextDeliveryChallanNumber: 1,
      proformaPrefix: "PI",
      nextProformaNumber: 1,
      financialYearStart: 4,
      storeEnabled: false,
      storeAllowNegativeStock: false,
      nextStoreOrderNumber: 1,
      storeOrderPrefix: "ORD",
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates a party (customer or supplier) in the given business.
 */
export async function createParty(
  db: TenantTestDb,
  businessId: string,
  overrides: Partial<InferInserted<typeof parties>> = {},
): Promise<TestParty> {
  const [row] = await db
    .insert(parties)
    .values({
      businessId,
      type: "customer",
      name: "Priya Textiles",
      phone: "9123456780",
      email: "priya.textiles@example.in",
      gstin: "27AABCP0000R1ZM",
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0.00",
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates an inventory item in the given business.
 */
export async function createItem(
  db: TenantTestDb,
  businessId: string,
  overrides: Partial<InferInserted<typeof items>> = {},
): Promise<TestItem> {
  const [row] = await db
    .insert(items)
    .values({
      businessId,
      name: "Cotton Fabric",
      hsn: "5208",
      unit: "m",
      itemMode: "simple",
      salePrice: "250.00",
      purchasePrice: "200.00",
      taxPercent: "5.00",
      stockQuantity: "100.000",
      itemType: "product",
      taxInclusive: false,
      storeEnabled: false,
      storeSortOrder: 0,
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates an invoice with line items in a single transaction.
 *
 * Each entry in the items array specifies which item row to reference plus
 * the quantity and unit price for that line.
 *
 * Returns both the invoice row and the inserted invoice item rows.
 */
export async function createInvoiceWithItems(
  db: TenantTestDb,
  businessId: string,
  partyId: string,
  lineItems: Array<{
    itemId?: string;
    description: string;
    quantity: string;
    unitPrice: string;
    taxPercent?: string;
  }>,
  invoiceOverrides: Partial<InferInserted<typeof invoices>> = {},
): Promise<{ invoice: TestInvoice; lineItems: TestInvoiceItem[] }> {
  // Build totals from line items
  let subtotal = 0;
  let taxTotal = 0;
  for (const li of lineItems) {
    const qty = parseFloat(li.quantity);
    const price = parseFloat(li.unitPrice);
    const tax = parseFloat(li.taxPercent ?? "0");
    subtotal += qty * price;
    taxTotal += qty * price * (tax / 100);
  }
  const totalAmount = subtotal + taxTotal;

  const invoiceNumber = `INV-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;

  const [invoice] = await db
    .insert(invoices)
    .values({
      businessId,
      partyId,
      type: "sale",
      status: "draft",
      documentType: "invoice",
      invoiceNumber,
      invoiceDate: new Date(),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxTotal.toFixed(2),
      discountAmount: "0.00",
      additionalCharges: "0.00",
      roundOff: "0.00",
      totalAmount: totalAmount.toFixed(2),
      amountPaid: "0.00",
      ...invoiceOverrides,
    })
    .returning();

  const insertedLineItems: TestInvoiceItem[] = [];
  for (let i = 0; i < lineItems.length; i++) {
    const li = lineItems[i]!;
    const qty = parseFloat(li.quantity);
    const price = parseFloat(li.unitPrice);
    const taxPct = parseFloat(li.taxPercent ?? "0");
    const lineTotal = qty * price * (1 + taxPct / 100);

    const [lineItem] = await db
      .insert(invoiceItems)
      .values({
        invoiceId: invoice!.id,
        itemId: li.itemId ?? null,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent ?? "0.00",
        taxAmount: (qty * price * (taxPct / 100)).toFixed(2),
        discountPercent: "0.00",
        totalAmount: lineTotal.toFixed(2),
        sortOrder: i,
        conversionFactor: "1",
      })
      .returning();

    insertedLineItems.push(lineItem!);
  }

  return { invoice: invoice!, lineItems: insertedLineItems };
}

/**
 * Creates a payment record linked to a business and party.
 */
export async function createPayment(
  db: TenantTestDb,
  businessId: string,
  partyId: string,
  overrides: Partial<InferInserted<typeof payments>> = {},
): Promise<TestPayment> {
  const [row] = await db
    .insert(payments)
    .values({
      businessId,
      partyId,
      amount: "1000.00",
      discount: "0.00",
      mode: "cash",
      paymentDate: new Date(),
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates an expense record for the given business.
 */
export async function createExpense(
  db: TenantTestDb,
  businessId: string,
  overrides: Partial<InferInserted<typeof expenses>> = {},
): Promise<TestExpense> {
  const [row] = await db
    .insert(expenses)
    .values({
      businessId,
      category: "Office Supplies",
      description: "Pens and paper",
      amount: "500.00",
      mode: "cash",
      expenseDate: new Date(),
      ...overrides,
    })
    .returning();

  return row!;
}

/**
 * Creates a bank account for the given business.
 */
export async function createBankAccount(
  db: TenantTestDb,
  businessId: string,
  overrides: Partial<InferInserted<typeof bankAccounts>> = {},
): Promise<TestBankAccount> {
  const [row] = await db
    .insert(bankAccounts)
    .values({
      businessId,
      accountName: "HDFC Current Account",
      accountNumber: "12345678901234",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
      accountType: "current",
      openingBalance: "0.00",
      currentBalance: "0.00",
      isDefault: true,
      ...overrides,
    })
    .returning();

  return row!;
}

// ── Composite factory ─────────────────────────────────────────────────────────

/**
 * TestWorld describes the full set of entities created by createTestWorld().
 *
 * Layout:
 *   tenant1  →  ramesh (owner), suresh (seller)
 *   tenant2  →  kiran (owner)
 *   Each tenant has one business, one party, and one item.
 */
export interface TestWorld {
  // Users
  ramesh: TestUser;    // owner of tenant1
  suresh: TestUser;    // seller in tenant1
  kiran: TestUser;     // owner of tenant2

  // Tenants
  tenant1: TestTenant;
  tenant2: TestTenant;

  // Memberships
  rameshMembership: TestMember;
  sureshMembership: TestMember;
  kiranMembership: TestMember;

  // Sessions (valid for 30 days)
  rameshSession: TestSession;
  sureshSession: TestSession;
  kiranSession: TestSession;

  // Businesses (one per tenant)
  business1: TestBusiness;  // belongs to tenant1, created by ramesh
  business2: TestBusiness;  // belongs to tenant2, created by kiran

  // Tenant DB (shared in self-hosted mode)
  tenantDb: TenantTestDb;

  // Parties
  party1: TestParty;   // customer in business1
  party2: TestParty;   // customer in business2

  // Items
  item1: TestItem;     // product in business1
  item2: TestItem;     // product in business2
}

/**
 * Creates a complete test world: 2 tenants, 3 users, 2 businesses,
 * one party and one item per business.
 *
 * Use this as the beforeAll fixture for tests that need a realistic
 * multi-user, multi-tenant environment without setting everything up manually.
 *
 * Example:
 *   let world: TestWorld;
 *   beforeAll(async () => { world = await createTestWorld(); });
 *   afterAll(async () => { await truncateAllTables(); });
 */
export async function createTestWorld(): Promise<TestWorld> {
  const tenantDb = getTenantTestDb();

  // ── Users ──
  const ramesh = await createUser({
    email: "ramesh.kumar@acmetrading.in",
    name: "Ramesh Kumar",
  });
  const suresh = await createUser({
    email: "suresh.sharma@acmetrading.in",
    name: "Suresh Sharma",
  });
  const kiran = await createUser({
    email: "kiran.mehta@kiranbiz.in",
    name: "Kiran Mehta",
  });

  // ── Tenants ──
  const tenant1 = await createTenant({
    name: "Acme Trading Co",
    slug: `acme-${randomUUID().slice(0, 6)}`,
  });
  const tenant2 = await createTenant({
    name: "Kiran Enterprises",
    slug: `kiran-${randomUUID().slice(0, 6)}`,
  });

  // ── Memberships ──
  const rameshMembership = await addMember(tenant1.id, ramesh.id, "owner");
  const sureshMembership = await addMember(tenant1.id, suresh.id, "seller");
  const kiranMembership = await addMember(tenant2.id, kiran.id, "owner");

  // ── Sessions ──
  const rameshSession = await createSession(ramesh.id, tenant1.id);
  const sureshSession = await createSession(suresh.id, tenant1.id);
  const kiranSession = await createSession(kiran.id, tenant2.id);

  // ── Businesses ──
  const business1 = await createBusiness(tenantDb, ramesh.id, {
    name: "Acme Trading Co",
    gstin: "27AABCA0000R1ZM",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
  });
  const business2 = await createBusiness(tenantDb, kiran.id, {
    name: "Kiran Enterprises",
    gstin: "29AABCK0000R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
  });

  // ── Parties ──
  const party1 = await createParty(tenantDb, business1.id, {
    name: "Priya Textiles Pvt Ltd",
    type: "customer",
    gstin: "27AABCP0000R1ZM",
    city: "Pune",
    state: "Maharashtra",
    stateCode: "27",
  });
  const party2 = await createParty(tenantDb, business2.id, {
    name: "Shree Traders",
    type: "customer",
    gstin: "29AABCS0000R1ZM",
    city: "Mysuru",
    state: "Karnataka",
    stateCode: "29",
  });

  // ── Items ──
  const item1 = await createItem(tenantDb, business1.id, {
    name: "Cotton Fabric (White 40s)",
    hsn: "5208",
    unit: "m",
    salePrice: "250.00",
    purchasePrice: "200.00",
    taxPercent: "5.00",
  });
  const item2 = await createItem(tenantDb, business2.id, {
    name: "Sandalwood Incense Sticks",
    hsn: "3307",
    unit: "box",
    salePrice: "120.00",
    purchasePrice: "90.00",
    taxPercent: "12.00",
  });

  return {
    ramesh,
    suresh,
    kiran,
    tenant1,
    tenant2,
    rameshMembership,
    sureshMembership,
    kiranMembership,
    rameshSession,
    sureshSession,
    kiranSession,
    business1,
    business2,
    tenantDb,
    party1,
    party2,
    item1,
    item2,
  };
}
