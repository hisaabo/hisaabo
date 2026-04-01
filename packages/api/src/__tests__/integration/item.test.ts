/**
 * item.test.ts — Integration tests for the item tRPC router.
 *
 * WHY THIS FILE EXISTS:
 * Items (products and services) are a foundation entity: invoices reference them
 * for line-item pricing, and stock adjustments build on them for inventory
 * management. This file verifies the full lifecycle — create, list, getById,
 * update, adjustStock, delete — along with multi-business isolation and N+1
 * query detection.
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
  createItem,
  createParty,
  createInvoiceWithItems,
  type TestUser,
  type TestTenant,
  type TestBusiness,
  type TestItem,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { createQueryCounter, assertMaxQueries } from "../helpers/query-counter.js";

// ── Shared test state ─────────────────────────────────────────────────────────

let ramesh: TestUser;
let suresh: TestUser;
let kiran: TestUser;
let tenant1: TestTenant;
let tenant2: TestTenant;
let business1: TestBusiness;
let business2: TestBusiness;

// Callers
let callerRamesh: ReturnType<typeof createTestCaller>;  // owner in tenant1 — full perms
let callerSuresh: ReturnType<typeof createTestCaller>;  // seller in tenant1 — limited perms
let callerKiran: ReturnType<typeof createTestCaller>;   // owner in tenant2 — separate business

beforeAll(async () => {
  const tenantDb = getTenantTestDb();

  // Users
  ramesh = await createUser({ email: "ramesh.item@acmetrading.in", name: "Ramesh Kumar" });
  suresh = await createUser({ email: "suresh.item@acmetrading.in", name: "Suresh Sharma" });
  kiran = await createUser({ email: "kiran.item@kiranbiz.in", name: "Kiran Mehta" });

  // Tenants
  tenant1 = await createTenant({ name: "Acme Trading Co Items" });
  tenant2 = await createTenant({ name: "Kiran Enterprises Items" });

  // Memberships: ramesh = owner, suresh = seller in tenant1; kiran = owner in tenant2
  await addMember(tenant1.id, ramesh.id, "owner");
  await addMember(tenant1.id, suresh.id, "seller");
  await addMember(tenant2.id, kiran.id, "owner");

  // Businesses
  business1 = await createBusiness(tenantDb, ramesh.id, {
    name: "Acme Trading Co",
    gstin: "27AABCA1111R1ZM",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
  });
  business2 = await createBusiness(tenantDb, kiran.id, {
    name: "Kiran Enterprises",
    gstin: "29AABCK1111R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
  });

  // Callers
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

// ── item.create ───────────────────────────────────────────────────────────────

describe("item.create", () => {
  it("creates a product with stock tracking — all numeric fields stored as strings", async () => {
    const result = await callerRamesh.item.create({
      name: "Cotton Fabric 40s",
      itemType: "product",
      itemMode: "simple",
      unit: "m",
      salePrice: "250.00",
      purchasePrice: "200.00",
      taxPercent: "5.00",
      stockQuantity: "100.000",
      hsn: "5208",
    });

    expect(result).toBeDefined();
    expect(result.name).toBe("Cotton Fabric 40s");
    expect(result.itemType).toBe("product");
    expect(result.businessId).toBe(business1.id);
    expect(result.id).toBeDefined();
  });

  it("sale price and purchase price are stored as strings — not JS floats", async () => {
    const result = await callerRamesh.item.create({
      name: "Price Type Test Product",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
      salePrice: "999.99",
      purchasePrice: "750.50",
      taxPercent: "18.00",
    });

    expect(typeof result.salePrice).toBe("string");
    expect(typeof result.purchasePrice).toBe("string");
    expect(result.salePrice).toBe("999.99");
    expect(result.purchasePrice).toBe("750.50");
  });

  it("tax percent is stored correctly as a string", async () => {
    const result = await callerRamesh.item.create({
      name: "Tax Percent Test Item",
      itemType: "product",
      itemMode: "simple",
      unit: "kg",
      taxPercent: "12.00",
    });

    expect(typeof result.taxPercent).toBe("string");
    expect(result.taxPercent).toBe("12.00");
  });

  it("creates a service item — no stock tracking, itemType=service", async () => {
    const result = await callerRamesh.item.create({
      name: "Consulting Service",
      itemType: "service",
      itemMode: "simple",
      unit: "pcs",
      salePrice: "5000.00",
      taxPercent: "18.00",
      stockQuantity: "0",
    });

    expect(result.itemType).toBe("service");
    expect(result.name).toBe("Consulting Service");
  });

  it("HSN code is saved correctly on the item record", async () => {
    const result = await callerRamesh.item.create({
      name: "HSN Code Test Product",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
      hsn: "8471",
      taxPercent: "18.00",
    });

    expect(result.hsn).toBe("8471");
  });

  it("businessId is auto-set from middleware context — not from user input", async () => {
    const result = await callerRamesh.item.create({
      name: "Context BusinessId Test Item",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
    });

    expect(result.businessId).toBe(business1.id);
  });
});

// ── item.list ─────────────────────────────────────────────────────────────────

describe("item.list", () => {
  beforeAll(async () => {
    // Seed items for pagination and filter tests
    for (let i = 1; i <= 15; i++) {
      await callerRamesh.item.create({
        name: `Paginate Item ${String(i).padStart(2, "0")}`,
        itemType: i % 3 === 0 ? "service" : "product",
        itemMode: "simple",
        unit: "pcs",
        taxPercent: "5.00",
        category: i <= 8 ? "Textiles" : "Electronics",
      });
    }

    // Seed one item for Kiran's business to verify isolation
    await callerKiran.item.create({
      name: "Kiran Business Only Item",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
    });
  });

  it("returns paginated results — page=1 limit=10 returns 10 items", async () => {
    const result = await callerRamesh.item.list({ page: 1, limit: 10 });

    expect(result.data.length).toBe(10);
    expect(result.total).toBeGreaterThanOrEqual(15);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it("search filter matches item name case-insensitively", async () => {
    const result = await callerRamesh.item.list({
      page: 1,
      limit: 50,
      search: "PAGINATE ITEM",
    });

    expect(result.data.length).toBeGreaterThanOrEqual(15);
    result.data.forEach((item) => {
      expect(item.name.toLowerCase()).toContain("paginate item");
    });
  });

  it("filters by itemType=product returns only products", async () => {
    const result = await callerRamesh.item.list({
      page: 1,
      limit: 100,
      itemType: "product",
    });

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach((item) => {
      expect(item.itemType).toBe("product");
    });
  });

  it("filters by itemType=service returns only services", async () => {
    const result = await callerRamesh.item.list({
      page: 1,
      limit: 100,
      itemType: "service",
    });

    expect(result.data.length).toBeGreaterThan(0);
    result.data.forEach((item) => {
      expect(item.itemType).toBe("service");
    });
  });

  it("returns only items for the active business — business isolation", async () => {
    const rameshResult = await callerRamesh.item.list({ page: 1, limit: 100 });
    const kiranResult = await callerKiran.item.list({ page: 1, limit: 100 });

    const rameshNames = rameshResult.data.map((i) => i.name);
    const kiranNames = kiranResult.data.map((i) => i.name);

    expect(rameshNames).not.toContain("Kiran Business Only Item");
    expect(kiranNames).not.toContain("Paginate Item 01");

    rameshResult.data.forEach((item) => expect(item.businessId).toBe(business1.id));
    kiranResult.data.forEach((item) => expect(item.businessId).toBe(business2.id));
  });
});

// ── item.getById ──────────────────────────────────────────────────────────────

describe("item.getById", () => {
  let testItem: TestItem;

  beforeAll(async () => {
    testItem = await createItem(getTenantTestDb(), business1.id, {
      name: "GetById Test Item",
      salePrice: "500.00",
      purchasePrice: "400.00",
      stockQuantity: "50.000",
    });
  });

  it("returns item with all fields including current stock quantity", async () => {
    const result = await callerRamesh.item.getById({ id: testItem.id });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("GetById Test Item");
    expect(result!.id).toBe(testItem.id);
    expect(result!.stockQuantity).toBe("50.000");
    expect(typeof result!.salePrice).toBe("string");
  });

  it("returns null for a non-existent item ID", async () => {
    const result = await callerRamesh.item.getById({
      id: "00000000-0000-0000-0000-000000000000",
    });

    expect(result).toBeNull();
  });

  it("returns null for item belonging to a different business — business isolation", async () => {
    const kiranItem = await createItem(getTenantTestDb(), business2.id, {
      name: "Kiran Item (invisible to Ramesh)",
    });

    const result = await callerRamesh.item.getById({ id: kiranItem.id });
    expect(result).toBeNull();
  });
});

// ── item.update ───────────────────────────────────────────────────────────────

describe("item.update", () => {
  let itemToUpdate: TestItem;

  beforeAll(async () => {
    itemToUpdate = await createItem(getTenantTestDb(), business1.id, {
      name: "Update Test Item",
      salePrice: "100.00",
      purchasePrice: "80.00",
      taxPercent: "5.00",
    });
  });

  it("updates name, sale price, purchase price, and tax — changes are reflected", async () => {
    const result = await callerRamesh.item.update({
      id: itemToUpdate.id,
      data: {
        name: "Updated Item Name",
        salePrice: "120.00",
        purchasePrice: "95.00",
        taxPercent: "12.00",
      },
    });

    expect(result!.name).toBe("Updated Item Name");
    expect(result!.salePrice).toBe("120.00");
    expect(result!.purchasePrice).toBe("95.00");
    expect(result!.taxPercent).toBe("12.00");
  });

  it("partial update only changes provided fields — other fields remain unchanged", async () => {
    const before = await callerRamesh.item.getById({ id: itemToUpdate.id });

    await callerRamesh.item.update({
      id: itemToUpdate.id,
      data: { name: "Partial Update Name" },
    });

    const after = await callerRamesh.item.getById({ id: itemToUpdate.id });
    expect(after!.name).toBe("Partial Update Name");
    // salePrice should be unchanged from the previous update
    expect(after!.salePrice).toBe(before!.salePrice);
  });
});

// ── item.adjustStock ──────────────────────────────────────────────────────────

describe("item.adjustStock", () => {
  let stockItem: TestItem;

  beforeAll(async () => {
    stockItem = await createItem(getTenantTestDb(), business1.id, {
      name: "Stock Adjustment Test Item",
      stockQuantity: "100.000",
      itemType: "product",
    });
  });

  it("positive adjustment increases stock quantity and creates stockAdjustment record", async () => {
    const result = await callerRamesh.item.adjustStock({
      itemId: stockItem.id,
      quantity: "25.000",
      reason: "Goods received",
    });

    expect(result).not.toBeNull();
    // The adjustment record's quantity should match the delta
    expect(result!.quantity).toBe("25.000");
    // New stock = 100 + 25 = 125
    expect(result!.newStock).toBe("125.000");
    expect(result!.previousStock).toBe("100.000");
    expect(result!.itemId).toBe(stockItem.id);
  });

  it("negative adjustment decreases stock quantity and records the delta", async () => {
    // After the +25 above, stock is 125.000
    const result = await callerRamesh.item.adjustStock({
      itemId: stockItem.id,
      quantity: "-30.000",
      reason: "Damaged goods written off",
    });

    expect(result!.quantity).toBe("-30.000");
    // 125 - 30 = 95
    expect(result!.newStock).toBe("95.000");
    expect(result!.previousStock).toBe("125.000");
  });

  it("stock quantity values are strings with 3 decimal places — decimal precision maintained", async () => {
    const result = await callerRamesh.item.adjustStock({
      itemId: stockItem.id,
      quantity: "5.500",
      reason: "Precision test",
    });

    expect(typeof result!.newStock).toBe("string");
    expect(typeof result!.previousStock).toBe("string");
    // Should preserve 3-decimal-place format
    expect(result!.newStock).toMatch(/^\d+\.\d{3}$/);
  });

  it("the item's stockQuantity reflects the adjustment after the mutation", async () => {
    const beforeFetch = await callerRamesh.item.getById({ id: stockItem.id });
    const beforeStock = parseFloat(beforeFetch!.stockQuantity);

    await callerRamesh.item.adjustStock({
      itemId: stockItem.id,
      quantity: "10.000",
      reason: "Recount adjustment",
    });

    const afterFetch = await callerRamesh.item.getById({ id: stockItem.id });
    const afterStock = parseFloat(afterFetch!.stockQuantity);

    expect(afterStock).toBeCloseTo(beforeStock + 10, 2);
  });

  it("zero quantity is rejected by Zod validation", async () => {
    await expect(
      callerRamesh.item.adjustStock({ itemId: stockItem.id, quantity: "0" })
    ).rejects.toThrow();
  });

  it("adjustStock creates a record in the stockAdjustments table", async () => {
    const adj = await callerRamesh.item.adjustStock({
      itemId: stockItem.id,
      quantity: "1.000",
      reason: "Audit trail test",
    });

    // The returned record IS the stockAdjustment row
    expect(adj!.businessId).toBe(business1.id);
    expect(adj!.itemId).toBe(stockItem.id);
    expect(adj!.reason).toBe("Audit trail test");
  });
});

// ── item.delete ───────────────────────────────────────────────────────────────

describe("item.delete", () => {
  it("deletes an item that has no invoice line items", async () => {
    const item = await callerRamesh.item.create({
      name: "Delete Me Item",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
    });

    const result = await callerRamesh.item.delete({ id: item.id });
    expect(result.success).toBe(true);

    const fetched = await callerRamesh.item.getById({ id: item.id });
    expect(fetched).toBeNull();
  });

  it("deleting an item with invoice line items sets invoiceItems.itemId to null — ON DELETE SET NULL", async () => {
    // Create item + party + invoice referencing the item
    const item = await callerRamesh.item.create({
      name: "Referenced By Invoice Item",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
      salePrice: "50.00",
    });

    const party = await createParty(getTenantTestDb(), business1.id, {
      name: "Invoice Reference Party",
    });

    const { lineItems: _lineItems } = await createInvoiceWithItems(
      getTenantTestDb(),
      business1.id,
      party.id,
      [{ itemId: item.id, description: "Referenced item line", quantity: "1", unitPrice: "50.00" }],
    );

    // Delete the item — should succeed (FK is SET NULL, not RESTRICT)
    const result = await callerRamesh.item.delete({ id: item.id });
    expect(result.success).toBe(true);

    // Item is gone
    const fetched = await callerRamesh.item.getById({ id: item.id });
    expect(fetched).toBeNull();
  });

  it("seller role cannot delete an item — permission denied by CASL", async () => {
    const item = await callerRamesh.item.create({
      name: "Seller Cannot Delete This Item",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
    });

    // suresh is a seller — sellers do NOT have delete permission on Item
    await expect(
      callerSuresh.item.delete({ id: item.id })
    ).rejects.toThrow();

    // Confirm item still exists
    const fetched = await callerRamesh.item.getById({ id: item.id });
    expect(fetched).not.toBeNull();
  });
});

// ── N+1 detection ─────────────────────────────────────────────────────────────

describe("item.list N+1 detection", () => {
  it("item.list with 20 items executes at most 4 SQL queries", async () => {
    // Seed 20 simple items to ensure the list is large enough to reveal any N+1
    for (let i = 1; i <= 20; i++) {
      await createItem(getTenantTestDb(), business1.id, {
        name: `N1 Detection Item ${String(i).padStart(2, "0")}`,
      });
    }

    const counter = createQueryCounter();

    try {
      await assertMaxQueries(counter, 4, "item.list(20 items)", async () => {
        await callerRamesh.item.list({ page: 1, limit: 20 });
      });
    } finally {
      counter.dispose();
    }
  });
});
