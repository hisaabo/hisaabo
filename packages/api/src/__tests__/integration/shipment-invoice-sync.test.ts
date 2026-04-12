/**
 * shipment-invoice-sync.test.ts — Integration tests for shipment↔invoice
 * charge synchronisation.
 *
 * WHY THIS FILE EXISTS:
 * The sync logic spans three routers (shipment.create, shipment.update,
 * shipment.delete) and one helper lib (shipment-invoice-sync.ts). Each mutation
 * must keep the invoice's `charges` JSONB array, `additionalCharges`, and
 * `totalAmount` consistent. These tests verify that contract end-to-end against
 * a real PostgreSQL test database.
 *
 * KEY SCENARIOS:
 *   1. Create shipment with cost → invoice charges updated
 *   2. Create shipment with cost=0 → no charge added
 *   3. Paid invoice blocks shipment creation
 *   4. Update shipment cost → charge updated
 *   5. Update shipment cost to 0 → charge removed
 *   6. Delete shipment → charge removed
 *   7. Delete shipment on paid invoice → blocked
 *   8. Multiple shipments on one invoice → two charge entries
 *   9. Invoice update preserves shipment charges
 *  10. Auto-created shipment from invoice create gets tagged
 *  11-12. invoiceChargeSchema backward compat (validator tests)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { invoices, shipments } from "@hisaabo/db";
import { invoiceChargeSchema } from "@hisaabo/shared";
import {
  createTestWorld,
  createInvoiceWithItems,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

/** Creates a simple draft invoice with one line item and no charges */
async function createDraftInvoice() {
  const db = getTenantTestDb();
  return createInvoiceWithItems(
    db,
    world.business1.id,
    world.party1.id,
    [{ itemName: "Test Item", quantity: "2", unitPrice: "500.00", taxPercent: "0" }],
  );
}

/** Reads the latest invoice row from the DB */
async function getInvoice(invoiceId: string) {
  const db = getTenantTestDb();
  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return row ?? null;
}

// ── Test 1: Create shipment with cost → invoice charges updated ────────────────

describe("Test 1: Create shipment with cost → invoice charges updated", () => {
  it("adds a shipping charge entry and recalculates invoice total", async () => {
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();
    const originalTotal = invoice.totalAmount; // "1000.00"

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "150.00",
      status: "pending",
    });

    const updated = await getInvoice(invoice.id);
    expect(updated).not.toBeNull();

    const charges = updated!.charges as Array<{ label: string; amount: string; shipmentId?: string }> | null;
    expect(charges).not.toBeNull();
    expect(charges!).toHaveLength(1);
    expect(charges![0]!.label).toBe("Shipping");
    expect(charges![0]!.amount).toBe("150.00");
    expect(charges![0]!.shipmentId).toBe(shipment.id);

    expect(updated!.additionalCharges).toBe("150.00");

    // totalAmount must have increased by 150.00
    const expectedTotal = (parseFloat(originalTotal) + 150).toFixed(2);
    expect(updated!.totalAmount).toBe(expectedTotal);
  });
});

// ── Test 2: Create shipment with cost=0 → no charge added ─────────────────────

describe("Test 2: Create shipment with cost=0 → no charge added", () => {
  it("does not modify invoice charges when shipment cost is zero", async () => {
    const { invoice } = await createDraftInvoice();
    const originalTotal = invoice.totalAmount;

    const caller = callerForRamesh();
    await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "0",
      status: "pending",
    });

    const updated = await getInvoice(invoice.id);
    // Charges should remain null/unchanged
    expect(updated!.charges).toBeNull();
    expect(updated!.totalAmount).toBe(originalTotal);
  });
});

// ── Test 3: Paid invoice blocks shipment creation ─────────────────────────────

describe("Test 3: Paid invoice blocks shipment creation", () => {
  it("throws BAD_REQUEST when creating shipment on a paid invoice", async () => {
    const db = getTenantTestDb();
    const { invoice } = await createDraftInvoice();

    // Mark invoice as paid directly in DB
    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoice.id));

    const caller = callerForRamesh();
    await expect(
      caller.shipment.create({
        invoiceId: invoice.id,
        cost: "100.00",
        status: "pending",
      })
    ).rejects.toMatchObject({ message: "Cannot modify shipment on a paid invoice" });
  });
});

// ── Test 4: Update shipment cost → charge updated ─────────────────────────────

describe("Test 4: Update shipment cost → charge updated (50 → 80)", () => {
  it("updates the charge amount and recalculates invoice total", async () => {
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();
    const originalTotal = parseFloat(invoice.totalAmount);

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "50.00",
      status: "pending",
    });

    await caller.shipment.update({ id: shipment.id, cost: "80.00" });

    const updated = await getInvoice(invoice.id);
    const charges = updated!.charges as Array<{ amount: string; shipmentId?: string }> | null;
    expect(charges).not.toBeNull();
    expect(charges!).toHaveLength(1);
    expect(charges![0]!.amount).toBe("80.00");
    expect(updated!.additionalCharges).toBe("80.00");

    // Total should be original + 80 (not original + 50 + 80)
    expect(parseFloat(updated!.totalAmount)).toBeCloseTo(originalTotal + 80, 2);
  });
});

// ── Test 5: Update shipment cost to 0 → charge removed ────────────────────────

describe("Test 5: Update shipment cost to 0 → charge entry removed", () => {
  it("removes the charge entry when cost is updated to zero", async () => {
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();
    const originalTotal = parseFloat(invoice.totalAmount);

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "75.00",
      status: "pending",
    });

    await caller.shipment.update({ id: shipment.id, cost: "0" });

    const updated = await getInvoice(invoice.id);
    expect(updated!.charges).toBeNull();
    expect(updated!.additionalCharges).toBe("0.00");
    expect(parseFloat(updated!.totalAmount)).toBeCloseTo(originalTotal, 2);
  });
});

// ── Test 6: Delete shipment → charge removed ──────────────────────────────────

describe("Test 6: Delete shipment → charge removed from invoice", () => {
  it("removes the charge and restores original total after shipment deletion", async () => {
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();
    const originalTotal = parseFloat(invoice.totalAmount);

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "200.00",
      status: "pending",
    });

    // Verify charge was added
    const withCharge = await getInvoice(invoice.id);
    expect(parseFloat(withCharge!.totalAmount)).toBeCloseTo(originalTotal + 200, 2);

    await caller.shipment.delete({ id: shipment.id });

    const afterDelete = await getInvoice(invoice.id);
    expect(afterDelete!.charges).toBeNull();
    expect(afterDelete!.additionalCharges).toBe("0.00");
    expect(parseFloat(afterDelete!.totalAmount)).toBeCloseTo(originalTotal, 2);
  });
});

// ── Test 7: Delete shipment on paid invoice → blocked ─────────────────────────

describe("Test 7: Delete shipment on paid invoice → blocked", () => {
  it("throws BAD_REQUEST when deleting shipment linked to a paid invoice", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "100.00",
      status: "pending",
    });

    // Mark invoice as paid
    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoice.id));

    await expect(
      caller.shipment.delete({ id: shipment.id })
    ).rejects.toMatchObject({ message: "Cannot modify shipment on a paid invoice" });
  });
});

// ── Test 8: Multiple shipments on one invoice ─────────────────────────────────

describe("Test 8: Multiple shipments → two charge entries; delete one → one remains", () => {
  it("handles multiple shipments keyed by individual shipmentIds", async () => {
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();
    const originalTotal = parseFloat(invoice.totalAmount);

    const s1 = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "100.00",
      status: "pending",
    });

    const s2 = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "50.00",
      status: "pending",
    });

    const withTwo = await getInvoice(invoice.id);
    const charges2 = withTwo!.charges as Array<{ shipmentId?: string; amount: string }> | null;
    expect(charges2).not.toBeNull();
    expect(charges2!).toHaveLength(2);

    const ids = charges2!.map((c) => c.shipmentId);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);

    expect(parseFloat(withTwo!.additionalCharges)).toBeCloseTo(150, 2);
    expect(parseFloat(withTwo!.totalAmount)).toBeCloseTo(originalTotal + 150, 2);

    // Delete the first shipment
    await caller.shipment.delete({ id: s1.id });

    const withOne = await getInvoice(invoice.id);
    const charges1 = withOne!.charges as Array<{ shipmentId?: string; amount: string }> | null;
    expect(charges1).not.toBeNull();
    expect(charges1!).toHaveLength(1);
    expect(charges1![0]!.shipmentId).toBe(s2.id);

    expect(parseFloat(withOne!.additionalCharges)).toBeCloseTo(50, 2);
    expect(parseFloat(withOne!.totalAmount)).toBeCloseTo(originalTotal + 50, 2);
  });
});

// ── Test 9: Invoice update preserves shipment charges ─────────────────────────

describe("Test 9: Invoice update preserves shipment-linked charges", () => {
  it("does not strip shipment charges when user updates invoice with different charges", async () => {
    const caller = callerForRamesh();
    const { invoice } = await createDraftInvoice();

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      cost: "90.00",
      status: "pending",
    });

    // User updates invoice with a "Packaging" charge but no shipping charge
    await caller.invoice.update({
      id: invoice.id,
      charges: [{ label: "Packaging", amount: "25.00" }],
    });

    const updated = await getInvoice(invoice.id);
    const charges = updated!.charges as Array<{ label: string; shipmentId?: string }> | null;
    expect(charges).not.toBeNull();

    // Both packaging (user) and shipping (shipment-linked) must exist
    const labels = charges!.map((c) => c.label);
    expect(labels).toContain("Packaging");
    expect(labels).toContain("Shipping");

    // The shipping charge must retain its shipmentId
    const shippingCharge = charges!.find((c) => c.label === "Shipping");
    expect(shippingCharge?.shipmentId).toBe(shipment.id);

    // additionalCharges = 25 + 90 = 115
    expect(parseFloat(updated!.additionalCharges)).toBeCloseTo(115, 2);
  });
});

// ── Test 10: Auto-created shipment from invoice create gets tagged ─────────────

describe("Test 10: Auto-created shipment from invoice.create gets tagged", () => {
  it("tags the shipping charge entry with the auto-created shipment ID", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    const result = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: new Date().toISOString(),
      charges: [{ label: "Shipping Charges", amount: "120.00" }],
      lineItems: [
        {
          itemName: "Test Goods",
          quantity: "1",
          unitPrice: "500.00",
          taxPercent: "0",
          discountPercent: "0",
        },
      ],
    });

    // Verify the charge has a shipmentId
    const charges = result.charges as Array<{ label: string; amount: string; shipmentId?: string }> | null;
    expect(charges).not.toBeNull();
    const shippingCharge = charges!.find((c) => c.label === "Shipping Charges");
    expect(shippingCharge).toBeDefined();
    expect(shippingCharge!.shipmentId).toBeDefined();

    // Verify the shipment row actually exists with matching cost
    const [shipmentRow] = await db
      .select()
      .from(shipments)
      .where(and(eq(shipments.invoiceId, result.id), eq(shipments.businessId, world.business1.id)))
      .limit(1);

    expect(shipmentRow).toBeDefined();
    expect(shipmentRow!.id).toBe(shippingCharge!.shipmentId);
    expect(shipmentRow!.cost).toBe("120.00");
  });
});

// ── Tests 11-12: invoiceChargeSchema backward-compat ──────────────────────────

describe("invoiceChargeSchema backward compatibility", () => {
  it("Test 11: accepts entries without shipmentId (existing data shape)", () => {
    const result = invoiceChargeSchema.safeParse({ label: "Packaging", amount: "25.00" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipmentId).toBeUndefined();
    }
  });

  it("Test 12: accepts entries with a valid shipmentId UUID", () => {
    const result = invoiceChargeSchema.safeParse({
      label: "Shipping",
      amount: "150.00",
      shipmentId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipmentId).toBe("550e8400-e29b-41d4-a716-446655440000");
    }
  });

  it("rejects an invalid UUID in shipmentId", () => {
    const result = invoiceChargeSchema.safeParse({
      label: "Shipping",
      amount: "100.00",
      shipmentId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty amount string", () => {
    const result = invoiceChargeSchema.safeParse({ label: "Shipping", amount: "" });
    expect(result.success).toBe(false);
  });
});
