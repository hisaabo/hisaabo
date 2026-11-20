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
import { eq } from "drizzle-orm";
import { invoiceItems } from "@hisaabo/db";
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

  it("soft-delete: item with invoice line items is hidden from active reads — itemId FK preserved in DB", async () => {
    // Soft delete preserves the DB row so historical invoice joins
    // still resolve the item_id FK. The active read returns null because
    // deletedAt is now set, but the physical row exists.
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

    await createInvoiceWithItems(
      getTenantTestDb(),
      business1.id,
      party.id,
      [{ itemId: item.id, itemName: "Referenced By Invoice Item", quantity: "1", unitPrice: "50.00" }],
    );

    // Soft-delete the item — should succeed
    const result = await callerRamesh.item.delete({ id: item.id });
    expect(result.success).toBe(true);

    // Active read returns null — soft-deleted item is invisible to catalog queries
    const fetched = await callerRamesh.item.getById({ id: item.id });
    expect(fetched).toBeNull();

    // Should not appear in item list (max limit is 100)
    const listed = await callerRamesh.item.list({ page: 1, limit: 100 });
    const names = listed.data.map((i) => i.name);
    expect(names).not.toContain("Referenced By Invoice Item");
  });

  it("soft-delete is idempotent — deleting the same item twice returns success both times", async () => {
    const item = await callerRamesh.item.create({
      name: "Idempotent Delete Test Item",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
    });

    const first = await callerRamesh.item.delete({ id: item.id });
    expect(first.success).toBe(true);

    // Second delete on the same id must not throw — idempotent no-op
    const second = await callerRamesh.item.delete({ id: item.id });
    expect(second.success).toBe(true);
  });

  it("soft-deleting a variant-mode item also soft-deletes all its active variants", async () => {
    const item = await callerRamesh.item.create({
      name: "Cascade Soft Delete Parent Item",
      itemType: "product",
      itemMode: "variants",
      unit: "pcs",
      variantAttributes: ["Size"],
      variants: [
        { attributeValues: { Size: "S" }, salePrice: "100.00" },
        { attributeValues: { Size: "M" }, salePrice: "110.00" },
      ],
    });

    const beforeDelete = await callerRamesh.item.listVariants({ itemId: item.id });
    expect(beforeDelete.length).toBe(2);

    await callerRamesh.item.delete({ id: item.id });

    // Parent item is soft-deleted — should not appear
    const fetched = await callerRamesh.item.getById({ id: item.id });
    expect(fetched).toBeNull();

    // listVariants on a soft-deleted parent should 404 (item no longer active)
    await expect(
      callerRamesh.item.listVariants({ itemId: item.id })
    ).rejects.toThrow(/not found/i);
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

// ── item.renameUnit (not-found guard) ────────────────────────────────────────

describe("item.renameUnit not-found guard", () => {
  it("renameUnit on non-existent item throws NOT_FOUND", async () => {
    await expect(
      callerRamesh.item.renameUnit({
        id: "00000000-0000-0000-0000-000000000000",
        oldUnit: "kg",
        newUnit: "g",
      })
    ).rejects.toThrow(/not found/i);
  });
});

// ── item.delete (not-found guard) ─────────────────────────────────────────────

describe("item.delete not-found guard", () => {
  it("delete on non-existent item throws NOT_FOUND", async () => {
    await expect(
      callerRamesh.item.delete({
        id: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow(/not found/i);
  });
});

// ── Stock movement direction ─────────────────────────────────────────────────

describe("item.stockMovements — direction correctness", () => {
  let stockItem: TestItem;
  let party: Awaited<ReturnType<typeof createParty>>;

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    party = await createParty(tenantDb, business1.id, { name: "Stock Dir Party" });
    stockItem = await createItem(tenantDb, business1.id, {
      name: "Stock Direction Widget",
      itemType: "product",
      stockQuantity: "100",
    });

    // Sale invoice → should be OUT
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "5", unitPrice: "100" }],
      { type: "sale", documentType: "invoice", status: "sent" },
    );

    // Purchase invoice → should be IN
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "3", unitPrice: "80" }],
      { type: "purchase", documentType: "invoice", status: "sent" },
    );

    // Credit note (sale) → customer returns goods → should be IN
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "2", unitPrice: "100" }],
      { type: "sale", documentType: "credit_note", status: "sent" },
    );

    // Sales return → customer returns goods → should be IN
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "1", unitPrice: "100" }],
      { type: "sale", documentType: "sales_return", status: "sent" },
    );

    // Credit note (purchase) → we return goods to supplier → should be OUT
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "4", unitPrice: "80" }],
      { type: "purchase", documentType: "credit_note", status: "sent" },
    );

    // Delivery challan → should be OUT
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "6", unitPrice: "100" }],
      { type: "sale", documentType: "delivery_challan", status: "sent" },
    );
  });

  it("sale invoice is marked as outflow", async () => {
    const movements = await callerRamesh.item.stockMovements({ id: stockItem.id });
    const saleInvoice = movements.find(m => m.documentType === "invoice" && m.invoiceType === "sale");
    expect(saleInvoice?.direction).toBe("out");
  });

  it("purchase invoice is marked as inflow", async () => {
    const movements = await callerRamesh.item.stockMovements({ id: stockItem.id });
    const purchaseInvoice = movements.find(m => m.documentType === "invoice" && m.invoiceType === "purchase");
    expect(purchaseInvoice?.direction).toBe("in");
  });

  it("credit notes are excluded from stock movements (financial only)", async () => {
    const movements = await callerRamesh.item.stockMovements({ id: stockItem.id });
    const creditNotes = movements.filter(m => m.documentType === "credit_note");
    expect(creditNotes).toHaveLength(0);
  });

  it("sales return is marked as inflow (customer returns goods)", async () => {
    const movements = await callerRamesh.item.stockMovements({ id: stockItem.id });
    const sr = movements.find(m => m.documentType === "sales_return");
    expect(sr?.direction).toBe("in");
  });

  it("delivery challan is marked as outflow", async () => {
    const movements = await callerRamesh.item.stockMovements({ id: stockItem.id });
    const challan = movements.find(m => m.documentType === "delivery_challan");
    expect(challan?.direction).toBe("out");
  });

  it("draft and cancelled documents are excluded", async () => {
    const tenantDb = getTenantTestDb();
    // Create a draft — should NOT appear
    await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: stockItem.id, itemName: "Stock Direction Widget", quantity: "99", unitPrice: "100" }],
      { type: "sale", documentType: "invoice", status: "draft" },
    );
    const movements = await callerRamesh.item.stockMovements({ id: stockItem.id });
    expect(movements.every(m => m.invoiceType !== undefined)).toBe(true);
    // No movement should show qty 99
    expect(movements.find(m => m.quantity === "99")).toBeUndefined();
  });
});

// ── Period-wide price history / stock movements (multi-unit) ─────────────────

describe("item.priceSummary / priceHistoryPage / stockSummary / stockMovementsPage", () => {
  let multi: TestItem;
  let party: Awaited<ReturnType<typeof createParty>>;
  const DAY = 86_400_000;

  /** Creates one invoice line, optionally billed in an alt unit. */
  async function line(opts: {
    daysAgo: number; qty: string; price: string; unit?: string; cf?: string;
    type?: "sale" | "purchase"; status?: "sent" | "draft";
    documentType?: "invoice" | "sales_return";
  }) {
    const tenantDb = getTenantTestDb();
    const { lineItems } = await createInvoiceWithItems(
      tenantDb, business1.id, party.id,
      [{ itemId: multi.id, itemName: multi.name, quantity: opts.qty, unitPrice: opts.price }],
      {
        type: opts.type ?? "sale",
        documentType: opts.documentType ?? "invoice",
        status: opts.status ?? "sent",
        invoiceDate: new Date(Date.now() - opts.daysAgo * DAY),
      },
    );
    if (opts.unit) {
      await tenantDb.update(invoiceItems)
        .set({ selectedUnit: opts.unit, conversionFactor: opts.cf ?? "1" })
        .where(eq(invoiceItems.id, lineItems[0]!.id));
    }
  }

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    party = await createParty(tenantDb, business1.id, { name: "Multi Unit Party" });
    // Base unit kg; "box" = 12 kg. Current stock 100 kg.
    multi = await createItem(tenantDb, business1.id, {
      name: "Multi Unit Rice", unit: "kg", itemMode: "alt_units", stockQuantity: "100",
      unitVariants: [{ unit: "box", conversionFactor: 12, salePrice: "1200" }],
    });
    // Oldest -> newest. Prices per kg: 100, 100, 110, 90 ; plus 80 old (> 1y)
    await line({ daysAgo: 500, qty: "10", price: "80" });                       // kg @80   (outside 1y)
    await line({ daysAgo: 300, qty: "1", price: "1200", unit: "box", cf: "12" });// box @1200 => 100/kg (in 1y, not 6m)
    await line({ daysAgo: 100, qty: "5", price: "100" });                       // kg @100
    await line({ daysAgo: 50, qty: "2", price: "1320", unit: "box", cf: "12" }); // box @1320 => 110/kg
    await line({ daysAgo: 10, qty: "4", price: "90" });                         // kg @90
    await line({ daysAgo: 5, qty: "3", price: "70", type: "purchase" });        // purchase: separate series
    await line({ daysAgo: 4, qty: "9", price: "5", status: "draft" });          // draft ignored
    await line({ daysAgo: 3, qty: "1", price: "100", documentType: "sales_return" }); // not an "invoice" doc
  });

  it("'All' covers every sale line (not just the latest 50 / 10 points) and normalises units", async () => {
    const r = await callerRamesh.item.priceSummary({ id: multi.id, period: "all" });
    expect(r.unit).toBe("kg");
    expect(r.stats.count).toBe(5);
    expect(r.stats.min).toBe("80.0000");
    expect(r.stats.max).toBe("110.0000");
    // (80 + 100 + 100 + 110 + 90) / 5
    expect(r.stats.avg).toBe("96.0000");
    expect(r.stats.latest).toBe("90.0000");
    expect(r.series.map((p) => p.price)).toEqual(["80.0000", "100.0000", "100.0000", "110.0000", "90.0000"]);
    expect(r.downsampled).toBe(false);
  });

  it("windows are applied server-side and stats follow the period", async () => {
    const y = await callerRamesh.item.priceSummary({ id: multi.id, period: "1y" });
    expect(y.stats.count).toBe(4);
    expect(y.stats.min).toBe("90.0000");
    const m = await callerRamesh.item.priceSummary({ id: multi.id, period: "6m" });
    expect(m.stats.count).toBe(3);
    expect(m.stats.avg).toBe("100.0000");
    expect(m.stats.max).toBe("110.0000");
  });

  it("re-expresses prices in the selected unit consistently across periods", async () => {
    for (const period of ["6m", "1y", "all"] as const) {
      const kg = await callerRamesh.item.priceSummary({ id: multi.id, period });
      const box = await callerRamesh.item.priceSummary({ id: multi.id, period, unit: "box" });
      expect(box.unit).toBe("box");
      expect(Number(box.stats.max)).toBeCloseTo(Number(kg.stats.max) * 12, 3);
      expect(Number(box.stats.min)).toBeCloseTo(Number(kg.stats.min) * 12, 3);
      expect(Number(box.stats.avg)).toBeCloseTo(Number(kg.stats.avg) * 12, 3);
    }
  });

  it("purchase prices are a separate series", async () => {
    const r = await callerRamesh.item.priceSummary({ id: multi.id, period: "all", invoiceType: "purchase" });
    expect(r.stats.count).toBe(1);
    expect(r.stats.min).toBe("70.0000");
  });

  it("downsamples the chart series but computes stats from every line", async () => {
    const r = await callerRamesh.item.priceSummary({ id: multi.id, period: "all", maxPoints: 10 });
    expect(r.series.length).toBe(5); // fewer lines than maxPoints -> no loss
    const big = await createItem(getTenantTestDb(), business1.id, { name: "Many Prices", unit: "pcs" });
    const tenantDb = getTenantTestDb();
    for (let i = 0; i < 25; i++) {
      await createInvoiceWithItems(
        tenantDb, business1.id, party.id,
        [{ itemId: big.id, itemName: big.name, quantity: "1", unitPrice: String(100 + i) }],
        { type: "sale", documentType: "invoice", status: "sent", invoiceDate: new Date(Date.now() - (30 - i) * DAY) },
      );
    }
    const d = await callerRamesh.item.priceSummary({ id: big.id, period: "all", maxPoints: 10 });
    expect(d.downsampled).toBe(true);
    expect(d.series).toHaveLength(10);
    expect(d.stats.count).toBe(25);
    expect(d.stats.min).toBe("100.0000");
    expect(d.stats.max).toBe("124.0000");
    expect(d.stats.avg).toBe("112.0000");
    expect(d.series.reduce((a, p) => a + p.count, 0)).toBe(25);
    expect(d.series[9]!.max).toBe("124.0000");
  });

  it("priceHistoryPage pages with a cursor, newest first, showing only price changes", async () => {
    const p1 = await callerRamesh.item.priceHistoryPage({ id: multi.id, period: "all", limit: 2 });
    // Lines in order: 80, 100, 100(dup, hidden), 110, 90 -> changes: 90, 110, 100, 80
    expect(p1.rows.map((r) => r.price)).toEqual(["90.0000", "110.0000"]);
    expect(p1.nextCursor).toBe(2);
    expect(p1.total).toBe(4);
    const p2 = await callerRamesh.item.priceHistoryPage({ id: multi.id, period: "all", limit: 2, cursor: p1.nextCursor! });
    expect(p2.rows.map((r) => r.price)).toEqual(["100.0000", "80.0000"]);
    expect(p2.nextCursor).toBeNull();
    const all = await callerRamesh.item.priceHistoryPage({ id: multi.id, period: "all", changesOnly: false, limit: 50 });
    expect(all.rows).toHaveLength(5);
  });

  it("rejects an unknown display unit", async () => {
    await expect(callerRamesh.item.priceSummary({ id: multi.id, unit: "carton" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("stockSummary converts to the selected unit via conversion factors", async () => {
    // Base-kg deltas (newest first): +1 (sales_return), +3 (purchase), -4, -24, -5, -12, -10
    const kg = await callerRamesh.item.stockSummary({ id: multi.id, period: "all" });
    expect(kg.stats.count).toBe(7);
    expect(kg.stats.totalIn).toBe("4.0000");
    expect(kg.stats.totalOut).toBe("55.0000");
    expect(kg.stats.net).toBe("-51.0000");
    const box = await callerRamesh.item.stockSummary({ id: multi.id, period: "all", unit: "box" });
    expect(box.unit).toBe("box");
    expect(Number(box.stats.totalOut)).toBeCloseTo(55 / 12, 3);
    expect(Number(box.stats.net)).toBeCloseTo(-51 / 12, 3);
    // Latest balance equals current stock in either unit
    expect(kg.series.at(-1)!.balance).toBe("100.0000");
    expect(Number(box.series.at(-1)!.balance)).toBeCloseTo(100 / 12, 3);
  });

  it("stockMovementsPage: balances come from the full history regardless of period, and it pages", async () => {
    const p1 = await callerRamesh.item.stockMovementsPage({ id: multi.id, period: "all", limit: 3 });
    expect(p1.rows).toHaveLength(3);
    expect(p1.nextCursor).toBe(3);
    expect(p1.total).toBe(7);
    expect(p1.rows[0]).toMatchObject({ direction: "in", qtyChange: "1.0000", balance: "100.0000" });
    expect(p1.rows[1]).toMatchObject({ direction: "in", qtyChange: "3.0000", balance: "99.0000" });
    expect(p1.rows[2]).toMatchObject({ direction: "out", qtyChange: "-4.0000", balance: "96.0000" });
    const rest = await callerRamesh.item.stockMovementsPage({ id: multi.id, period: "all", limit: 3, cursor: 3 });
    const rest2 = await callerRamesh.item.stockMovementsPage({ id: multi.id, period: "all", limit: 3, cursor: 6 });
    expect(rest.rows).toHaveLength(3);
    expect(rest2.rows).toHaveLength(1);
    expect(rest2.nextCursor).toBeNull();

    // 6M window: same balances for the same rows (not re-based on the window)
    const m = await callerRamesh.item.stockMovementsPage({ id: multi.id, period: "6m", limit: 50 });
    expect(m.rows).toHaveLength(5);
    expect(m.rows[2]!.balance).toBe("96.0000");

    const box = await callerRamesh.item.stockMovementsPage({ id: multi.id, period: "6m", unit: "box", limit: 50 });
    expect(Number(box.rows[2]!.qtyChange)).toBeCloseTo(-4 / 12, 3);
    expect(Number(box.rows[2]!.balance)).toBeCloseTo(96 / 12, 3);
  });

  it("cannot read another business's item (empty)", async () => {
    const r = await callerKiran.item.priceSummary({ id: multi.id });
    expect(r.stats.count).toBe(0);
    const s = await callerKiran.item.stockMovementsPage({ id: multi.id });
    expect(s.rows).toHaveLength(0);
  });
});

// ── Item type lock ────────────────────────────────────────────────────────────

describe("item.update — itemType lock", () => {
  it("allows changing the type of an item with no transactions", async () => {
    const it1 = await createItem(getTenantTestDb(), business1.id, { name: "Fresh Item", itemType: "product" });
    const r = await callerRamesh.item.update({ id: it1.id, data: { itemType: "service" } });
    expect(r!.itemType).toBe("service");
    expect((await callerRamesh.item.getById({ id: it1.id }))!.hasTransactions).toBe(false);
  });

  it("rejects a type change once the item is on an invoice line", async () => {
    const tenantDb = getTenantTestDb();
    const p = await createParty(tenantDb, business1.id, { name: "Lock Party" });
    const it2 = await createItem(tenantDb, business1.id, { name: "Used Item", itemType: "product" });
    await createInvoiceWithItems(tenantDb, business1.id, p.id,
      [{ itemId: it2.id, itemName: it2.name, quantity: "1", unitPrice: "10" }], { status: "draft" });
    expect((await callerRamesh.item.getById({ id: it2.id }))!.hasTransactions).toBe(true);
    await expect(callerRamesh.item.update({ id: it2.id, data: { itemType: "service" } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Item type cannot be changed") });
    // Unchanged type and other edits still work
    const ok = await callerRamesh.item.update({ id: it2.id, data: { itemType: "product", name: "Used Item 2" } });
    expect(ok!.name).toBe("Used Item 2");
    expect(ok!.itemType).toBe("product");
  });

  it("rejects a type change once the item has a stock adjustment", async () => {
    const it3 = await createItem(getTenantTestDb(), business1.id, { name: "Adjusted Item", itemType: "product" });
    await callerRamesh.item.adjustStock({ itemId: it3.id, quantity: "5", reason: "Opening" });
    await expect(callerRamesh.item.update({ id: it3.id, data: { itemType: "service" } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
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

// ── item.listVariantsForItems ────────────────────────────────────────────────

describe("item.listVariantsForItems", () => {
  const mk = (name: string, sizes: string[]) =>
    callerRamesh.item.create({
      name,
      itemType: "product",
      itemMode: "variants",
      unit: "pcs",
      variantAttributes: ["Size"],
      variants: sizes.map((s) => ({ attributeValues: { Size: s }, salePrice: "100.00" })),
    });

  it("matches listVariants per item (same rows, same order) in one call", async () => {
    const a = await mk("Batched Variants A", ["S", "M", "L"]);
    const b = await mk("Batched Variants B", ["XL"]);
    const grouped = await callerRamesh.item.listVariantsForItems({ itemIds: [a.id, b.id] });
    expect(grouped[a.id]).toEqual(await callerRamesh.item.listVariants({ itemId: a.id }));
    expect(grouped[b.id]).toEqual(await callerRamesh.item.listVariants({ itemId: b.id }));
  });

  it("omits soft-deleted variants and soft-deleted parents", async () => {
    const a = await mk("Batched Deleted Variant", ["S", "M"]);
    const gone = await mk("Batched Deleted Parent", ["S"]);
    const [first] = await callerRamesh.item.listVariants({ itemId: a.id });
    await callerRamesh.item.deleteVariant({ variantId: first.id });
    await callerRamesh.item.delete({ id: gone.id });
    const grouped = await callerRamesh.item.listVariantsForItems({ itemIds: [a.id, gone.id] });
    expect(grouped[a.id]).toHaveLength(1);
    expect(grouped[gone.id]).toBeUndefined();
  });

  it("does not expose another business's variants", async () => {
    const a = await mk("Batched Isolation", ["S"]);
    const grouped = await callerKiran.item.listVariantsForItems({ itemIds: [a.id] });
    expect(grouped).toEqual({});
  });

  it("returns an empty map for no ids and rejects oversized input", async () => {
    expect(await callerRamesh.item.listVariantsForItems({ itemIds: [] })).toEqual({});
    const ids = Array.from({ length: 501 }, () => crypto.randomUUID());
    await expect(callerRamesh.item.listVariantsForItems({ itemIds: ids })).rejects.toThrow();
  });
});

describe("item.relatedInvoices — ordering and de-duplication", () => {
  let relItem: TestItem;
  // Six invoices so a random-UUID order can't match date order by chance
  const dates = ["2025-01-10", "2025-02-10", "2025-03-10", "2025-04-10", "2025-05-10", "2025-06-10"];
  const ids: string[] = [];

  beforeAll(async () => {
    const tenantDb = getTenantTestDb();
    const party = await createParty(tenantDb, business1.id, { name: "Related Inv Party" });
    relItem = await createItem(tenantDb, business1.id, { name: "Related Inv Widget", itemType: "product" });
    const line = { itemId: relItem.id, itemName: "Related Inv Widget", quantity: "1", unitPrice: "10" };
    for (const [i, date] of dates.entries()) {
      // One invoice carries the item on two lines — it must still appear once
      const lines = i === 2 ? [line, line] : [line];
      const { invoice } = await createInvoiceWithItems(tenantDb, business1.id, party.id, lines, {
        type: "sale", documentType: "invoice", status: "sent", invoiceDate: new Date(`${date}T00:00:00.000Z`),
      });
      ids.push(invoice.id);
    }
  });

  it("returns each invoice once, newest first, across pages", async () => {
    const pages = await Promise.all([1, 2, 3].map((page) =>
      callerRamesh.item.relatedInvoices({ id: relItem.id, page, limit: 2 })));
    expect(pages[0].total).toBe(6);
    expect(pages.flatMap((p) => p.data.map((r) => r.id))).toEqual([...ids].reverse());
  });
});
