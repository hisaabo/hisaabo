/**
 * eway-bill.test.ts — Integration tests for E-Way Bill management.
 *
 * WHY THIS FILE EXISTS:
 * E-Way Bill (EWB) is a mandatory GST compliance document for goods movements
 * above ₹50,000 in India. Incorrect handling can lead to penalties and detention
 * of goods. We verify:
 *
 *   Generation:      Goods invoice > ₹50K creates an EWB record.
 *   Rejection:       Service-only invoices are rejected.
 *   Rejection:       Invoices below ₹50K are rejected.
 *   Cancellation:    EWB can be cancelled within 24h.
 *   Cancellation:    EWB cancellation is rejected after 24h.
 *   Vehicle update:  Part-B update persists new vehicle and records history.
 *   History:         Vehicle update history tracks all vehicle changes.
 *   Dashboard:       Paginated EWB list respects status filters.
 *   Expiring list:   Returns only EWBs expiring within 24h.
 *
 * The EWBClient is mocked via vitest.mock() so no real NIC API calls are made.
 * The mock returns realistic response shapes matching the actual NIC API.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ewayBills, ewayBillVehicleUpdates } from "@hisaabo/db";
import {
  createTestWorld,
  createParty,
  createInvoiceWithItems,
  createItem,
  type TestWorld,
  type TestParty,
  type TestItem,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";

// ── Mock the EWB client ───────────────────────────────────────────────────────

// We intercept the EWBClient constructor and replace it with a mock that returns
// predictable responses. This avoids real NIC API calls while still exercising
// all the router logic.

const MOCK_EWB_NUMBER = "121600005025";
const MOCK_EWB_DATE   = "04/04/2026 10:30:00 AM";
const MOCK_VALID_UPTO = "05/04/2026 10:30:00 AM";

vi.mock("../../lib/ewb-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ewb-client.js")>();

  class MockEWBClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
    constructor(config: unknown) {
      this.config = config;
    }

    async authenticate() {
      return { authToken: "mock-token", sek: "mock-sek", expiresAt: new Date(Date.now() + 6 * 3600_000) };
    }

    async generateEWB() {
      return {
        ewayBillNo: MOCK_EWB_NUMBER,
        ewayBillDate: MOCK_EWB_DATE,
        validUpto: MOCK_VALID_UPTO,
      };
    }

    async cancelEWB() {
      return {
        ewayBillNo: MOCK_EWB_NUMBER,
        cancelDate: "04/04/2026 11:00:00 AM",
      };
    }

    async updateVehicle() {
      return {
        ewayBillNo: MOCK_EWB_NUMBER,
        transUpdateDate: "04/04/2026 12:00:00 AM",
        validUpto: MOCK_VALID_UPTO,
      };
    }

    async extendValidity() {
      return {
        ewayBillNo: MOCK_EWB_NUMBER,
        validUpto: "06/04/2026 10:30:00 AM",
      };
    }
  }

  return {
    ...actual,
    EWBClient: MockEWBClient,
  };
});

// Ensure NIC credentials are set so requireEWBClient() doesn't throw
process.env.NIC_EWB_CLIENT_ID     = "TEST_CLIENT_ID";
process.env.NIC_EWB_CLIENT_SECRET = "TEST_CLIENT_SECRET";
process.env.NIC_EWB_USERNAME      = "test@nic.in";
process.env.NIC_EWB_PASSWORD      = "TestPassword123";
process.env.NIC_EWB_SANDBOX       = "true";

// ── Fixture ───────────────────────────────────────────────────────────────────

let world: TestWorld;
let goodsItem: TestItem;
let serviceItem: TestItem;
let customerParty: TestParty;

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  // Goods item (product)
  goodsItem = await createItem(db, world.business1.id, {
    name: "Steel Rods",
    hsn: "7213",
    unit: "kg",
    itemType: "product",
    salePrice: "100.00",
    taxPercent: "18.00",
    stockQuantity: "10000.000",
  });

  // Service item
  serviceItem = await createItem(db, world.business1.id, {
    name: "Consulting Services",
    hsn: "9983",
    unit: "pcs",
    itemType: "service",
    salePrice: "5000.00",
    taxPercent: "18.00",
    stockQuantity: "0.000",
  });

  // Customer with GSTIN (Pune, Maharashtra — same state as business = intra-state)
  customerParty = await createParty(db, world.business1.id, {
    name: "Bajaj Industries",
    type: "customer",
    gstin: "27AABCB1234R1ZM",
    city: "Pune",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "411001",
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── 1. Generate EWB for goods invoice > ₹50K ─────────────────────────────────

describe("EWB generation", () => {
  it("generates EWB for a goods invoice above ₹50,000", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // 600 kg × ₹100 = ₹60,000 (above ₹50K threshold)
    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Steel Rods (grade Fe500)",
          quantity: "600",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB1234",
      vehicleType: "regular",
      transportMode: "road",
      distance: 250,
    });

    expect(ewb.ewbNumber).toBe(MOCK_EWB_NUMBER);
    expect(ewb.status).toBe("generated");
    expect(ewb.invoiceId).toBe(invoice.id);
    expect(ewb.vehicleNumber).toBe("MH12AB1234");
    expect(ewb.distance).toBe(250);
    expect(ewb.transportMode).toBe("road");

    // validUpto should be ~2.5 days from now (250km / 100km/day = 3 days, rounded up = 72h)
    expect(ewb.validUpto).toBeTruthy();
    expect(ewb.ewbDate).toBeTruthy();
  });

  it("rejects EWB for a service-only invoice", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: serviceItem.id,
          description: "IT Consulting",
          quantity: "10",
          unitPrice: "6000.00",
          taxPercent: "18",
        },
      ],
    );

    await expect(
      caller.ewayBill.generate({
        invoiceId: invoice.id,
        vehicleNumber: "MH12AB9999",
        vehicleType: "regular",
        transportMode: "road",
        distance: 100,
      }),
    ).rejects.toThrow("goods");
  });

  it("rejects EWB for an invoice below ₹50,000", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // 100 kg × ₹100 = ₹10,000 (below ₹50K threshold)
    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Small shipment",
          quantity: "100",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    await expect(
      caller.ewayBill.generate({
        invoiceId: invoice.id,
        vehicleNumber: "MH12AB8888",
        vehicleType: "regular",
        transportMode: "road",
        distance: 50,
      }),
    ).rejects.toThrow("50,000");
  });

  it("prevents duplicate EWB generation for the same invoice", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Large steel order",
          quantity: "800",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB5555",
      vehicleType: "regular",
      transportMode: "road",
      distance: 150,
    });

    // Attempting again should conflict
    await expect(
      caller.ewayBill.generate({
        invoiceId: invoice.id,
        vehicleNumber: "MH12AB5555",
        vehicleType: "regular",
        transportMode: "road",
        distance: 150,
      }),
    ).rejects.toThrow("already exists");
  });
});

// ── 2. Cancel EWB ─────────────────────────────────────────────────────────────

describe("EWB cancellation", () => {
  let ewbForCancelId: string;

  beforeAll(async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Cancel test goods",
          quantity: "700",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB2222",
      vehicleType: "regular",
      transportMode: "road",
      distance: 100,
    });

    ewbForCancelId = ewb.id;
  });

  it("cancels an EWB that was generated within 24 hours", async () => {
    const caller = callerForRamesh();

    const cancelled = await caller.ewayBill.cancel({
      ewayBillId: ewbForCancelId,
      cancelReason: "Order Cancelled",
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("Order Cancelled");
  });

  it("rejects cancellation of an already-cancelled EWB", async () => {
    const caller = callerForRamesh();

    await expect(
      caller.ewayBill.cancel({
        ewayBillId: ewbForCancelId,
        cancelReason: "Others",
      }),
    ).rejects.toThrow("already cancelled");
  });

  it("rejects cancellation after 24 hours", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Old shipment",
          quantity: "600",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB3333",
      vehicleType: "regular",
      transportMode: "road",
      distance: 200,
    });

    // Backdate ewbDate by 25 hours to simulate past-24h scenario
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(ewayBills)
      .set({ ewbDate: oldDate })
      .where(eq(ewayBills.id, ewb.id));

    await expect(
      caller.ewayBill.cancel({
        ewayBillId: ewb.id,
        cancelReason: "Data Entry Mistake",
      }),
    ).rejects.toThrow("24 hours");
  });
});

// ── 3. Update Vehicle (Part-B) ────────────────────────────────────────────────

describe("EWB vehicle update", () => {
  let ewbId: string;

  beforeAll(async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Vehicle update test goods",
          quantity: "600",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB6666",
      vehicleType: "regular",
      transportMode: "road",
      distance: 300,
    });

    ewbId = ewb.id;
  });

  it("updates vehicle number and records history", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const updated = await caller.ewayBill.updateVehicle({
      ewayBillId: ewbId,
      vehicleNumber: "MH12CD7777",
      fromPlace: "Nashik",
      reason: "breakdown",
    });

    expect(updated.vehicleNumber).toBe("MH12CD7777");

    // Verify history was recorded
    const history = await db
      .select()
      .from(ewayBillVehicleUpdates)
      .where(eq(ewayBillVehicleUpdates.ewayBillId, ewbId));

    expect(history.length).toBeGreaterThanOrEqual(1);
    const latest = history[history.length - 1]!;
    expect(latest.vehicleNumber).toBe("MH12CD7777");
    expect(latest.fromPlace).toBe("Nashik");
    expect(latest.reason).toBe("breakdown");
  });

  it("tracks multiple vehicle updates in history", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // Second vehicle update
    await caller.ewayBill.updateVehicle({
      ewayBillId: ewbId,
      vehicleNumber: "GJ05EF8888",
      fromPlace: "Surat",
      reason: "transshipment",
    });

    const history = await db
      .select()
      .from(ewayBillVehicleUpdates)
      .where(eq(ewayBillVehicleUpdates.ewayBillId, ewbId));

    expect(history.length).toBeGreaterThanOrEqual(2);
    const vehicles = history.map((h) => h.vehicleNumber);
    expect(vehicles).toContain("MH12CD7777");
    expect(vehicles).toContain("GJ05EF8888");
  });
});

// ── 4. Dashboard with status filters ─────────────────────────────────────────

describe("EWB dashboard", () => {
  it("returns all EWBs with summary counts", async () => {
    const caller = callerForRamesh();

    const result = await caller.ewayBill.dashboard({ page: 1, limit: 50 });

    expect(result.data).toBeInstanceOf(Array);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(typeof result.summary).toBe("object");
  });

  it("filters by status", async () => {
    const caller = callerForRamesh();

    const cancelled = await caller.ewayBill.dashboard({
      status: "cancelled",
      page: 1,
      limit: 50,
    });

    // All returned rows should be cancelled
    for (const row of cancelled.data) {
      expect(row.status).toBe("cancelled");
    }
  });

  it("returns invoice and party details in the list", async () => {
    const caller = callerForRamesh();

    const result = await caller.ewayBill.dashboard({ page: 1, limit: 50 });

    // At least some rows should have invoice/party info joined
    const withInvoice = result.data.filter((r) => r.invoiceNumber !== null);
    expect(withInvoice.length).toBeGreaterThan(0);
  });
});

// ── 5. Expiring list ──────────────────────────────────────────────────────────

describe("EWB expiring list", () => {
  it("returns EWBs expiring within 24 hours", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // Create a fresh EWB and backdate its validUpto to 12h from now
    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Expiring test shipment",
          quantity: "600",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB9111",
      vehicleType: "regular",
      transportMode: "road",
      distance: 100,
    });

    // Set validUpto to 12 hours from now (within expiring window)
    const expiringAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await db
      .update(ewayBills)
      .set({ validUpto: expiringAt })
      .where(eq(ewayBills.id, ewb.id));

    const expiringList = await caller.ewayBill.expiringList();
    const found = expiringList.find((e) => e.id === ewb.id);

    expect(found).toBeDefined();
  });

  it("does not include EWBs expiring after 24 hours", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // Create EWB with 48h validity
    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Long validity shipment",
          quantity: "600",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB9222",
      vehicleType: "regular",
      transportMode: "road",
      distance: 200,
    });

    // Set validUpto to 48 hours from now (outside expiring window)
    const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await db
      .update(ewayBills)
      .set({ validUpto: farFuture })
      .where(eq(ewayBills.id, ewb.id));

    const expiringList = await caller.ewayBill.expiringList();
    const found = expiringList.find((e) => e.id === ewb.id);

    expect(found).toBeUndefined();
  });
});

// ── 6. getByInvoice ───────────────────────────────────────────────────────────

describe("getByInvoice", () => {
  it("returns EWB details with vehicle history for an invoice", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "Detail view test",
          quantity: "700",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const ewb = await caller.ewayBill.generate({
      invoiceId: invoice.id,
      vehicleNumber: "MH12AB9333",
      vehicleType: "regular",
      transportMode: "road",
      distance: 150,
    });

    // Add a vehicle update to populate history
    await caller.ewayBill.updateVehicle({
      ewayBillId: ewb.id,
      vehicleNumber: "MH12XY4444",
      fromPlace: "Aurangabad",
      reason: "transshipment",
    });

    const detail = await caller.ewayBill.getByInvoice({ invoiceId: invoice.id });

    expect(detail).toBeTruthy();
    expect(detail!.id).toBe(ewb.id);
    expect(detail!.vehicleHistory).toBeInstanceOf(Array);
    expect(detail!.vehicleHistory.length).toBeGreaterThanOrEqual(1);
    expect(detail!.vehicleHistory[0]!.vehicleNumber).toBe("MH12XY4444");
  });

  it("returns null for an invoice with no EWB", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      customerParty.id,
      [
        {
          itemId: goodsItem.id,
          description: "No EWB invoice",
          quantity: "600",
          unitPrice: "100.00",
          taxPercent: "18",
        },
      ],
    );

    const detail = await caller.ewayBill.getByInvoice({ invoiceId: invoice.id });
    expect(detail).toBeNull();
  });
});
