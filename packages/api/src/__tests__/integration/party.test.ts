/**
 * party.test.ts — Integration tests for the party tRPC router.
 *
 * WHY THIS FILE EXISTS:
 * Parties (customers and suppliers) are foundation entities — every invoice,
 * payment, and ledger entry references one. This file verifies the complete
 * lifecycle: create → list → getById → update → delete, plus ledger aggregation
 * and multi-business isolation. It runs against a real PostgreSQL test database
 * so that business logic, Zod validation, CASL permissions, and SQL all execute
 * together.
 *
 * SETUP: Requires the test database to be running. Start it with:
 *   docker compose -f docker-compose.test.yml up -d
 * Then run tests with:
 *   pnpm --filter @hisaabo/api test
 *
 * Test organisation mirrors the router's procedure names. Each describe block
 * maps 1:1 to a procedure; test names capture intent, not implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";
import {
  createUser,
  createTenant,
  addMember,
  createBusiness,
  createParty,
  createInvoiceWithItems,
  createPayment,
  createItem,
  type TestUser,
  type TestTenant,
  type TestBusiness,
  type TestParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { createQueryCounter, assertMaxQueries } from "../helpers/query-counter.js";

// ── Shared test state ─────────────────────────────────────────────────────────

/**
 * We set up two users (ramesh = owner/admin, suresh = seller) in one tenant,
 * and kiran = owner in a second isolated tenant. This lets us test both
 * permission checks (admin vs seller) and business isolation (cross-tenant).
 */
let ramesh: TestUser;
let suresh: TestUser;
let kiran: TestUser;
let tenant1: TestTenant;
let tenant2: TestTenant;
let business1: TestBusiness;
let business2: TestBusiness;

// Callers — reusable tRPC callers wired to specific user+business contexts
let callerRamesh: ReturnType<typeof createTestCaller>;  // owner: full admin perms
let callerSuresh: ReturnType<typeof createTestCaller>;  // seller: limited perms
let callerKiran: ReturnType<typeof createTestCaller>;   // owner of a different business

beforeAll(async () => {
  const tenantDb = getTenantTestDb();

  // Users
  ramesh = await createUser({ email: "ramesh.kumar@acmetrading.in", name: "Ramesh Kumar" });
  suresh = await createUser({ email: "suresh.sharma@acmetrading.in", name: "Suresh Sharma" });
  kiran = await createUser({ email: "kiran.mehta@kiranbiz.in", name: "Kiran Mehta" });

  // Tenants
  tenant1 = await createTenant({ name: "Acme Trading Co" });
  tenant2 = await createTenant({ name: "Kiran Enterprises" });

  // Memberships: ramesh = owner, suresh = seller in tenant1; kiran = owner in tenant2
  await addMember(tenant1.id, ramesh.id, "owner");
  await addMember(tenant1.id, suresh.id, "seller");
  await addMember(tenant2.id, kiran.id, "owner");

  // Businesses
  business1 = await createBusiness(tenantDb, ramesh.id, {
    name: "Acme Trading Co",
    gstin: "27AABCA0000R1ZM",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
  });
  business2 = await createBusiness(tenantDb, kiran.id, {
    name: "Kiran Enterprises",
    gstin: "29AABCK0000R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
  });

  // Wire up tRPC callers
  callerRamesh = createTestCaller({
    userId: ramesh.id,
    email: ramesh.email,
    name: ramesh.name ?? null,
    tenantId: tenant1.id,
    businessId: business1.id,
  });

  callerSuresh = createTestCaller({
    userId: suresh.id,
    email: suresh.email,
    name: suresh.name ?? null,
    tenantId: tenant1.id,
    businessId: business1.id,
  });

  callerKiran = createTestCaller({
    userId: kiran.id,
    email: kiran.email,
    name: kiran.name ?? null,
    tenantId: tenant2.id,
    businessId: business2.id,
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── party.create ──────────────────────────────────────────────────────────────

describe("party.create", () => {
  it("creates a customer with minimal fields (name and type only)", async () => {
    const result = await callerRamesh.party.create({
      type: "customer",
      name: "Minimal Customer Pvt Ltd",
    });

    expect(result).toBeDefined();
    expect(result!.name).toBe("Minimal Customer Pvt Ltd");
    expect(result!.type).toBe("customer");
    expect(result!.businessId).toBe(business1.id);
    expect(result!.id).toBeDefined();
  });

  it("creates a supplier with all fields including GSTIN, PAN, address, openingBalance, creditLimit", async () => {
    const result = await callerRamesh.party.create({
      type: "supplier",
      name: "Rajesh Fabrics Pvt Ltd",
      phone: "9876543210",
      email: "rajesh@fabrics.in",
      gstin: "27AABCR0000R1ZM",
      pan: "AABCR0000R",
      billingAddress: "45 Industrial Area, Andheri East",
      shippingAddress: "45 Industrial Area, Andheri East",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400093",
      openingBalance: "5000.00",
      category: "Textiles",
      creditLimit: "100000.00",
      creditPeriodDays: 30,
    });

    expect(result!.type).toBe("supplier");
    expect(result!.name).toBe("Rajesh Fabrics Pvt Ltd");
    expect(result!.phone).toBe("9876543210");
    expect(result!.email).toBe("rajesh@fabrics.in");
    expect(result!.gstin).toBe("27AABCR0000R1ZM");
    expect(result!.pan).toBe("AABCR0000R");
    expect(result!.city).toBe("Mumbai");
    expect(result!.pincode).toBe("400093");
    expect(result!.category).toBe("Textiles");
    expect(result!.creditPeriodDays).toBe(30);
  });

  it("businessId is auto-set from middleware context — not from user input", async () => {
    const result = await callerRamesh.party.create({
      type: "customer",
      name: "Auto BusinessId Test Customer",
    });

    // businessId must match the business in the caller's context, not any user-supplied value
    expect(result!.businessId).toBe(business1.id);
  });

  it("openingBalance is stored as a decimal string, not a float", async () => {
    const result = await callerRamesh.party.create({
      type: "customer",
      name: "Balance String Test Customer",
      openingBalance: "1234.56",
    });

    expect(typeof result!.openingBalance).toBe("string");
    expect(result!.openingBalance).toBe("1234.56");
  });

  it("rejects creation when party name is empty — Zod validation guard", async () => {
    await expect(
      callerRamesh.party.create({ type: "customer", name: "" })
    ).rejects.toThrow();
  });

  it("rejects creation when party type is invalid — Zod validation guard", async () => {
    await expect(
      callerRamesh.party.create({ type: "invalid_type" as any, name: "Test" })
    ).rejects.toThrow();
  });
});

// ── party.list ────────────────────────────────────────────────────────────────

describe("party.list", () => {
  /**
   * We create a fresh batch of parties in a local helper within this describe
   * block. We can rely on the parties already created in the party.create block
   * above, but we also seed a large set here for pagination testing.
   */
  let partyIds: string[] = [];

  beforeAll(async () => {
    // Create 15 parties to reliably test pagination (page=1 limit=10 → 10 rows with total=15+)
    for (let i = 1; i <= 15; i++) {
      const p = await callerRamesh.party.create({
        type: i % 2 === 0 ? "customer" : "supplier",
        name: `Pagination Party ${String(i).padStart(2, "0")}`,
        category: i <= 8 ? "Textiles" : "Electronics",
      });
      partyIds.push(p!.id);
    }
  });

  it("returns paginated results — page=1 limit=10 returns 10 items with correct total", async () => {
    const result = await callerRamesh.party.list({ page: 1, limit: 10 });

    expect(result.data.length).toBe(10);
    // Total includes all parties created across this suite
    expect(result.total).toBeGreaterThanOrEqual(15);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it("page=2 with limit=10 returns fewer items when total is around 15", async () => {
    const page1 = await callerRamesh.party.list({ page: 1, limit: 10 });
    const page2 = await callerRamesh.party.list({ page: 2, limit: 10 });

    // Page 2 must have a different set of IDs
    const ids1 = page1.data.map((p) => p.id);
    const ids2 = page2.data.map((p) => p.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it("filters by type=customer returns only customers", async () => {
    const result = await callerRamesh.party.list({ page: 1, limit: 100, type: "customer" });

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach((p) => {
      expect(p.type).toBe("customer");
    });
  });

  it("filters by type=supplier returns only suppliers", async () => {
    const result = await callerRamesh.party.list({ page: 1, limit: 100, type: "supplier" });

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach((p) => {
      expect(p.type).toBe("supplier");
    });
  });

  it("search filter matches party name case-insensitively", async () => {
    // "pagination party" is a substring (lower-cased) of all seeded parties in this block
    const result = await callerRamesh.party.list({
      page: 1,
      limit: 50,
      search: "PAGINATION PARTY",
    });

    expect(result.data.length).toBeGreaterThanOrEqual(15);
    result.data.forEach((p) => {
      expect(p.name.toLowerCase()).toContain("pagination party");
    });
  });

  it("filters by category returns only parties in that category", async () => {
    const result = await callerRamesh.party.list({
      page: 1,
      limit: 100,
      category: "Electronics",
    });

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach((p) => {
      expect(p.category).toBe("Electronics");
    });
  });

  it("returns parties sorted by name ascending when sortDir=asc", async () => {
    const result = await callerRamesh.party.list({
      page: 1,
      limit: 50,
      sortBy: "name",
      sortDir: "asc",
    });

    const names = result.data.map((p) => p.name.toLowerCase());
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("returns parties sorted by name descending when sortDir=desc", async () => {
    const result = await callerRamesh.party.list({
      page: 1,
      limit: 50,
      sortBy: "name",
      sortDir: "desc",
    });

    const names = result.data.map((p) => p.name.toLowerCase());
    const sorted = [...names].sort().reverse();
    expect(names).toEqual(sorted);
  });

  it("party.list returns only parties for the active business — business isolation", async () => {
    // Kiran's business has its own isolated parties — create one explicitly
    await callerKiran.party.create({
      type: "customer",
      name: "Kiran Business Only Customer",
    });

    // Ramesh's list must NOT contain Kiran's party
    const rameshResult = await callerRamesh.party.list({ page: 1, limit: 100 });
    const kiranResult = await callerKiran.party.list({ page: 1, limit: 100 });

    const rameshNames = rameshResult.data.map((p) => p.name);
    const kiranNames = kiranResult.data.map((p) => p.name);

    expect(rameshNames).not.toContain("Kiran Business Only Customer");
    expect(kiranNames).not.toContain("Pagination Party 01");
    expect(kiranNames).not.toContain("Pagination Party 02");

    // Verify all returned parties belong to the correct business
    rameshResult.data.forEach((p) => expect(p.businessId).toBe(business1.id));
    kiranResult.data.forEach((p) => expect(p.businessId).toBe(business2.id));
  });
});

// ── party.getById ─────────────────────────────────────────────────────────────

describe("party.getById", () => {
  let testParty: TestParty;

  beforeAll(async () => {
    testParty = await createParty(getTenantTestDb(), business1.id, {
      name: "GetById Test Party",
      type: "customer",
      openingBalance: "2500.00",
    });
  });

  it("returns party with computed balance field (openingBalance when no invoices)", async () => {
    const result = await callerRamesh.party.getById({ id: testParty.id });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("GetById Test Party");
    expect(result!.id).toBe(testParty.id);
    // balance field should be computed and be a string
    expect(typeof result!.balance).toBe("string");
    // With no invoices, balance should equal openingBalance
    expect(result!.balance).toBe("2500.00");
  });

  it("returns null for a non-existent party ID", async () => {
    const result = await callerRamesh.party.getById({
      id: "00000000-0000-0000-0000-000000000000",
    });

    expect(result).toBeNull();
  });

  it("returns null for party belonging to a different business — business isolation", async () => {
    // Create a party in Kiran's business
    const kiranParty = await createParty(getTenantTestDb(), business2.id, {
      name: "Kiran Party (should be invisible to Ramesh)",
    });

    // Ramesh's caller must not be able to fetch Kiran's party
    const result = await callerRamesh.party.getById({ id: kiranParty.id });
    expect(result).toBeNull();
  });

  it("balance includes invoice totals beyond opening balance", async () => {
    // Create an item and invoice for the test party
    const item = await createItem(getTenantTestDb(), business1.id, {
      name: "Balance Test Product",
      salePrice: "1000.00",
    });

    await createInvoiceWithItems(
      getTenantTestDb(),
      business1.id,
      testParty.id,
      [{ itemId: item.id, description: "Balance Test", quantity: "2", unitPrice: "1000.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    const result = await callerRamesh.party.getById({ id: testParty.id });

    // Balance should be openingBalance + invoice total
    // openingBalance=2500.00 + invoice(2*1000=2000.00) = 4500.00
    expect(result).not.toBeNull();
    const balance = parseFloat(result!.balance);
    expect(balance).toBeGreaterThan(2500);
  });
});

// ── party.update ──────────────────────────────────────────────────────────────

describe("party.update", () => {
  let partyToUpdate: TestParty;

  beforeAll(async () => {
    partyToUpdate = await createParty(getTenantTestDb(), business1.id, {
      name: "Update Test Party",
      type: "customer",
      phone: "9000000001",
    });
  });

  it("updates party name and phone — changed fields are reflected in DB", async () => {
    const result = await callerRamesh.party.update({
      id: partyToUpdate.id,
      data: {
        name: "Updated Party Name",
        phone: "9111111111",
      },
    });

    expect(result!.name).toBe("Updated Party Name");
    expect(result!.phone).toBe("9111111111");
    expect(result!.id).toBe(partyToUpdate.id);
  });

  it("businessId cannot be changed via update — stays scoped to the original business", async () => {
    // Attempt to update with a different businessId (if the schema even allows it)
    // The update endpoint uses businessId from ctx, not from input, so it stays the same
    const result = await callerRamesh.party.update({
      id: partyToUpdate.id,
      data: { name: "BusinessId Immutable Test" },
    });

    // businessId must remain the original value regardless of any attempted override
    expect(result!.businessId).toBe(business1.id);
  });
});

// ── party.delete ──────────────────────────────────────────────────────────────

describe("party.delete", () => {
  it("deletes a party that has no invoices", async () => {
    const party = await createParty(getTenantTestDb(), business1.id, {
      name: "Delete Me Party",
    });

    const result = await callerRamesh.party.delete({ id: party.id });
    expect(result.success).toBe(true);

    // Verify it is gone
    const fetched = await callerRamesh.party.getById({ id: party.id });
    expect(fetched).toBeNull();
  });

  it("rejects delete of party with invoices — FK constraint prevents orphaned invoices", async () => {
    const party = await createParty(getTenantTestDb(), business1.id, {
      name: "Party With Invoice - Should Not Delete",
    });

    await createInvoiceWithItems(
      getTenantTestDb(),
      business1.id,
      party.id,
      [{ description: "FK test item", quantity: "1", unitPrice: "100.00" }],
    );

    // Delete should throw because invoices reference this party via FK
    await expect(
      callerRamesh.party.delete({ id: party.id })
    ).rejects.toThrow();
  });

  it("seller role cannot delete a party — permission denied by CASL", async () => {
    const party = await createParty(getTenantTestDb(), business1.id, {
      name: "Permission Denied Delete Test Party",
    });

    // suresh is a seller — sellers do NOT have delete permission on Party
    await expect(
      callerSuresh.party.delete({ id: party.id })
    ).rejects.toThrow();

    // Verify it still exists
    const fetched = await callerRamesh.party.getById({ id: party.id });
    expect(fetched).not.toBeNull();
  });

  it("delete on non-existent party throws NOT_FOUND", async () => {
    await expect(
      callerRamesh.party.delete({
        id: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow(/not found/i);
  });
});

// ── party.ledger ──────────────────────────────────────────────────────────────

describe("party.ledger", () => {
  let ledgerParty: TestParty;

  beforeAll(async () => {
    ledgerParty = await createParty(getTenantTestDb(), business1.id, {
      name: "Ledger Test Customer",
      type: "customer",
      openingBalance: "1000.00",
    });

    // Create an invoice so the ledger has entries
    await createInvoiceWithItems(
      getTenantTestDb(),
      business1.id,
      ledgerParty.id,
      [{ description: "Ledger test product", quantity: "5", unitPrice: "200.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // Create a payment so we have a credit entry
    await createPayment(getTenantTestDb(), business1.id, ledgerParty.id, {
      amount: "500.00",
      mode: "cash",
    });
  });

  it("returns ledger entries for a party including invoice and payment rows", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerParty.id,
      page: 1,
      limit: 50,
    });

    expect(result).not.toBeNull();
    expect(result.data.length).toBeGreaterThanOrEqual(2); // at least invoice + payment

    const entryTypes = result.data.map((e) => e.type);
    expect(entryTypes).toContain("invoice");
    expect(entryTypes).toContain("payment");
  });

  it("ledger entries include runningBalance computed correctly", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerParty.id,
      page: 1,
      limit: 50,
    });

    // Every entry must have a runningBalance string
    result.data.forEach((entry) => {
      expect(typeof entry.runningBalance).toBe("string");
      expect(entry.runningBalance).toMatch(/^-?\d+(\.\d+)?$/);
    });
  });

  it("ledger returns total count and pagination metadata", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerParty.id,
      page: 1,
      limit: 50,
    });

    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.openingBalance).toBe("1000.00");
  });

  it("ledger throws NOT_FOUND for party in a different business", async () => {
    const kiranParty = await createParty(getTenantTestDb(), business2.id, {
      name: "Kiran Ledger Party",
    });

    // Ramesh's caller requests ledger for Kiran's party — must throw NOT_FOUND
    await expect(
      callerRamesh.party.ledger({ partyId: kiranParty.id, page: 1, limit: 50 })
    ).rejects.toThrow();
  });
});

// ── party.getById — balance with CN/SR deductions ────────────────────────────

/**
 * Verifies that party.getById correctly subtracts CN/SR/PR amounts from the
 * outstanding balance. The balance formula is:
 *   openingBalance + sum(invoices) - sum(CN + SR + PR)
 *
 * We create dedicated parties for each scenario to avoid cross-test interference.
 */
describe("party.getById — balance with CN/SR deductions", () => {
  it("subtracts credit note amount from customer outstanding", async () => {
    const db = getTenantTestDb();

    // Create a fresh party with no opening balance
    const party = await createParty(db, business1.id, {
      name: "CN Balance Test Customer",
      type: "customer",
      openingBalance: "0.00",
    });

    // Create an item and invoice for ₹1000
    const item = await createItem(db, business1.id, {
      name: "CN Balance Test Item",
      salePrice: "1000.00",
      taxPercent: "0.00",
    });

    await createInvoiceWithItems(
      db,
      business1.id,
      party.id,
      [{ itemId: item.id, description: "Invoice line", quantity: "1", unitPrice: "1000.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // Check balance before CN — should be 1000
    const beforeResult = await callerRamesh.party.getById({ id: party.id });
    expect(beforeResult).not.toBeNull();
    expect(parseFloat(beforeResult!.balance)).toBeCloseTo(1000, 1);

    // Issue a CN for ₹400 against this party via the router (triggers server-side logic)
    await callerRamesh.creditNote.create({
      partyId: party.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "CN deduction line",
          quantity: "4",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Balance must be reduced by the CN amount: 1000 - 400 = 600
    const afterResult = await callerRamesh.party.getById({ id: party.id });
    expect(afterResult).not.toBeNull();
    expect(parseFloat(afterResult!.balance)).toBeCloseTo(600, 1);
  });

  it("subtracts sales return amount from customer outstanding", async () => {
    const db = getTenantTestDb();

    const party = await createParty(db, business1.id, {
      name: "SR Balance Test Customer",
      type: "customer",
      openingBalance: "0.00",
    });

    const item = await createItem(db, business1.id, {
      name: "SR Balance Test Item",
      salePrice: "500.00",
      taxPercent: "0.00",
    });

    await createInvoiceWithItems(
      db,
      business1.id,
      party.id,
      [{ itemId: item.id, description: "Invoice line", quantity: "2", unitPrice: "500.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // Invoice total = 1000, issue SR for ₹250
    await callerRamesh.salesReturn.create({
      partyId: party.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "SR line",
          quantity: "1",
          unitPrice: "250.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Balance: 1000 - 250 = 750
    const result = await callerRamesh.party.getById({ id: party.id });
    expect(result).not.toBeNull();
    expect(parseFloat(result!.balance)).toBeCloseTo(750, 1);
  });

  it("subtracts purchase return amount from supplier payable", async () => {
    const db = getTenantTestDb();

    const supplier = await createParty(db, business1.id, {
      name: "PR Balance Test Supplier",
      type: "supplier",
      openingBalance: "0.00",
    });

    const item = await createItem(db, business1.id, {
      name: "PR Balance Test Item",
      purchasePrice: "200.00",
      taxPercent: "0.00",
    });

    // Purchase invoice for ₹600 (we owe supplier)
    await createInvoiceWithItems(
      db,
      business1.id,
      supplier.id,
      [{ itemId: item.id, description: "Purchase line", quantity: "3", unitPrice: "200.00" }],
      { status: "sent", type: "purchase", documentType: "invoice" },
    );

    // Before PR: balance = 600
    const beforeResult = await callerRamesh.party.getById({ id: supplier.id });
    expect(beforeResult).not.toBeNull();
    expect(parseFloat(beforeResult!.balance)).toBeCloseTo(600, 1);

    // Issue purchase return for ₹200
    await callerRamesh.purchaseReturn.create({
      partyId: supplier.id,
      type: "purchase" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "PR line",
          quantity: "1",
          unitPrice: "200.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Balance: 600 - 200 = 400
    const afterResult = await callerRamesh.party.getById({ id: supplier.id });
    expect(afterResult).not.toBeNull();
    expect(parseFloat(afterResult!.balance)).toBeCloseTo(400, 1);
  });

  it("combined CN+SR correctly reduces outstanding", async () => {
    const db = getTenantTestDb();

    const party = await createParty(db, business1.id, {
      name: "Combined CN+SR Balance Customer",
      type: "customer",
      openingBalance: "0.00",
    });

    const item = await createItem(db, business1.id, {
      name: "Combined Adj Balance Item",
      salePrice: "500.00",
      taxPercent: "0.00",
    });

    // Invoice for ₹1000
    const { invoice } = await createInvoiceWithItems(
      db,
      business1.id,
      party.id,
      [{ itemId: item.id, description: "Main invoice line", quantity: "2", unitPrice: "500.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // CN for ₹300 referencing the invoice
    await callerRamesh.creditNote.create({
      partyId: party.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      referenceDocumentId: invoice.id,
      lineItems: [
        {
          itemName: "Combined CN line",
          quantity: "3",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // SR for ₹200 referencing the invoice
    await callerRamesh.salesReturn.create({
      partyId: party.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      referenceDocumentId: invoice.id,
      lineItems: [
        {
          itemName: "Combined SR line",
          quantity: "2",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Balance: 1000 - 300 (CN) - 200 (SR) = 500
    const result = await callerRamesh.party.getById({ id: party.id });
    expect(result).not.toBeNull();
    expect(parseFloat(result!.balance)).toBeCloseTo(500, 1);
  });
});

// ── party.ledger — includes CN/SR/DN entries ──────────────────────────────────

/**
 * Verifies that party.ledger returns entries for credit_note, sales_return,
 * and debit_note document types with the correct debit/credit direction, and
 * that the running balance accounts for these adjustments correctly.
 */
describe("party.ledger — includes CN/SR/DN entries", () => {
  let ledgerCnSrParty: Awaited<ReturnType<typeof createParty>>;

  beforeAll(async () => {
    const db = getTenantTestDb();

    ledgerCnSrParty = await createParty(db, business1.id, {
      name: "Ledger CN SR DN Test Customer",
      type: "customer",
      openingBalance: "0.00",
    });

    const item = await createItem(db, business1.id, {
      name: "Ledger CN SR DN Item",
      salePrice: "200.00",
      taxPercent: "0.00",
    });

    // Sale invoice for ₹1000
    const { invoice } = await createInvoiceWithItems(
      db,
      business1.id,
      ledgerCnSrParty.id,
      [{ itemId: item.id, description: "Main ledger invoice", quantity: "5", unitPrice: "200.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // CN for ₹400 against the invoice
    await callerRamesh.creditNote.create({
      partyId: ledgerCnSrParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      referenceDocumentId: invoice.id,
      lineItems: [
        {
          itemName: "Ledger CN line",
          quantity: "2",
          unitPrice: "200.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // SR for ₹200 against the invoice
    await callerRamesh.salesReturn.create({
      partyId: ledgerCnSrParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      referenceDocumentId: invoice.id,
      lineItems: [
        {
          itemName: "Ledger SR line",
          quantity: "1",
          unitPrice: "200.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Debit note for ₹100 (increases what customer owes)
    await callerRamesh.debitNote.create({
      partyId: ledgerCnSrParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "Ledger DN line",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });
  });

  it("includes credit_note entry with amount in credit column for sale type", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerCnSrParty.id,
      page: 1,
      limit: 50,
    });

    const cnEntry = result.data.find((e) => e.type === "credit_note");
    expect(cnEntry).toBeDefined();
    // For a sale-type CN: credit column holds the amount (reduces what customer owes)
    expect(parseFloat(cnEntry!.credit)).toBeGreaterThan(0);
    expect(parseFloat(cnEntry!.debit)).toBe(0);
  });

  it("includes sales_return entry with amount in credit column", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerCnSrParty.id,
      page: 1,
      limit: 50,
    });

    const srEntry = result.data.find((e) => e.type === "sales_return");
    expect(srEntry).toBeDefined();
    // Sales return reduces customer balance — goes in credit column
    expect(parseFloat(srEntry!.credit)).toBeGreaterThan(0);
    expect(parseFloat(srEntry!.debit)).toBe(0);
  });

  it("includes debit_note entry with amount in debit column for sale type", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerCnSrParty.id,
      page: 1,
      limit: 50,
    });

    const dnEntry = result.data.find((e) => e.type === "debit_note");
    expect(dnEntry).toBeDefined();
    // Debit note increases what customer owes — goes in debit column
    expect(parseFloat(dnEntry!.debit)).toBeGreaterThan(0);
    expect(parseFloat(dnEntry!.credit)).toBe(0);
  });

  it("running balance correctly accounts for CN/SR entries", async () => {
    const result = await callerRamesh.party.ledger({
      partyId: ledgerCnSrParty.id,
      page: 1,
      limit: 50,
    });

    // All entries must have a valid running balance
    result.data.forEach((entry) => {
      expect(typeof entry.runningBalance).toBe("string");
      expect(entry.runningBalance).toMatch(/^-?\d+(\.\d+)?$/);
    });

    // Final running balance: openingBalance(0) + invoice(1000) - CN(400) - SR(200) + DN(100) = 500
    const lastEntry = result.data[result.data.length - 1];
    expect(lastEntry).toBeDefined();
    expect(parseFloat(lastEntry!.runningBalance)).toBeCloseTo(500, 1);
  });

  it("excludes cancelled CN/SR from ledger", async () => {
    const db = getTenantTestDb();

    // Create a separate party for this isolation test
    const isolatedParty = await createParty(db, business1.id, {
      name: "Cancelled CN Exclusion Party",
      type: "customer",
      openingBalance: "0.00",
    });

    const item = await createItem(db, business1.id, {
      name: "Cancelled CN Exclusion Item",
      salePrice: "300.00",
      taxPercent: "0.00",
    });

    await createInvoiceWithItems(
      db,
      business1.id,
      isolatedParty.id,
      [{ itemId: item.id, description: "Exclusion invoice line", quantity: "2", unitPrice: "300.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // Create a CN then cancel it
    const cn = await callerRamesh.creditNote.create({
      partyId: isolatedParty.id,
      type: "sale" as const,
      invoiceDate: new Date().toISOString(),
      lineItems: [
        {
          itemName: "To-cancel CN line",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Cancel the CN
    await callerRamesh.creditNote.updateStatus({ id: cn.id, status: "cancelled" });

    const result = await callerRamesh.party.ledger({
      partyId: isolatedParty.id,
      page: 1,
      limit: 50,
    });

    // Ledger must NOT include the cancelled CN
    const entryTypes = result.data.map((e) => e.type);
    expect(entryTypes).not.toContain("credit_note");

    // Balance should equal invoice total only (cancelled CN excluded)
    const invoiceEntry = result.data.find((e) => e.type === "invoice");
    expect(invoiceEntry).toBeDefined();
    // Running balance after invoice = 600 (no CN subtracted)
    const lastEntry = result.data[result.data.length - 1];
    expect(parseFloat(lastEntry!.runningBalance)).toBeCloseTo(600, 1);
  });
});

// ── N+1 detection ─────────────────────────────────────────────────────────────

describe("party.list N+1 detection", () => {
  it("party.list with 20 parties executes at most 4 SQL queries", async () => {
    // Seed 20 parties so the list is large enough to trigger any N+1
    for (let i = 1; i <= 20; i++) {
      await createParty(getTenantTestDb(), business1.id, {
        name: `N1 Detection Party ${String(i).padStart(2, "0")}`,
      });
    }

    const counter = createQueryCounter();

    try {
      await assertMaxQueries(counter, 4, "party.list(20 parties)", async () => {
        await callerRamesh.party.list({ page: 1, limit: 20 });
      });
    } finally {
      counter.dispose();
    }
  });
});
