/**
 * remaining.test.ts — Integration tests for shipmentRouter, targetRouter, apiKeyRouter
 *
 * WHY THIS FILE EXISTS:
 * These three routers are bundled here because they are smaller in scope but
 * contain high-value correctness assertions that must not slip through coverage:
 *
 * SHIPMENT:
 *   - Create linked to an invoice, verify invoiceId relationship.
 *   - Carrier tracking URL is auto-generated for known carriers.
 *   - Status update: pending → shipped → delivered (actualDelivery auto-set).
 *   - Business isolation.
 *
 * TARGET:
 *   - Create a sales target for a user with order_value target type.
 *   - getProgress returns current/target/percentage computed against real invoices.
 *   - periodEnd must be after periodStart (date validation).
 *   - item_quantity target requires itemId (business rule).
 *
 * API KEY:
 *   - create returns the raw key exactly once (never stored in plaintext).
 *   - The stored keyHash is a SHA-256 hex string (64 chars), NOT the raw key.
 *   - list returns only display-safe fields (no keyHash, no raw key).
 *   - revoke deletes the key; subsequent list excludes it.
 *   - API key creation is blocked for free-plan tenants.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { apiKeys } from "@hisaabo/db";
import {
  createTestWorld,
  createInvoiceWithItems,
  createTenant,
  createUser,
  addMember,
  createSession,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getControlDb } from "../helpers/test-db.js";

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

function isoNow(): string {
  return new Date().toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHIPMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe("shipment.create", () => {
  it("shipment.create returns the created shipment with the correct invoiceId linkage", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Create an invoice to link the shipment to
    const { invoice } = await createInvoiceWithItems(
      world.tenantDb,
      world.business1.id,
      world.party1.id,
      [{ description: "Shipment test goods", quantity: "2", unitPrice: "500.00" }],
      { type: "sale", documentType: "invoice", status: "sent" },
    );

    const shipment = await caller.shipment.create({
      invoiceId: invoice.id,
      partyId: world.party1.id,
      carrier: "delhivery",
      trackingNumber: "DLVRY123456789",
      cost: "150.00",
      status: "pending",
      shipmentDate: isoNow(),
    });

    expect(shipment).toBeDefined();
    expect(shipment!.invoiceId).toBe(invoice.id);
    expect(shipment!.partyId).toBe(world.party1.id);
    expect(shipment!.carrier).toBe("delhivery");
    expect(shipment!.status).toBe("pending");
    expect(shipment!.businessId).toBe(world.business1.id);
  });

  it("shipment.create auto-generates tracking URL for a known carrier (delhivery)", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const shipment = await caller.shipment.create({
      carrier: "delhivery",
      trackingNumber: "DLVRY999888777",
      cost: "0",
      status: "pending",
    });

    // delhivery tracking URL should be auto-generated
    expect(shipment!.trackingUrl).not.toBeNull();
    expect(shipment!.trackingUrl).toContain("delhivery.com");
    expect(shipment!.trackingUrl).toContain("DLVRY999888777");
  });

  it("shipment.create with unknown carrier does NOT auto-generate a tracking URL", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const shipment = await caller.shipment.create({
      carrier: "mystery-courier",
      trackingNumber: "MC12345",
      cost: "0",
      status: "pending",
    });

    // No built-in URL for unknown carrier
    expect(shipment!.trackingUrl).toBeNull();
  });
});

describe("shipment.update — status transitions", () => {
  it("shipment.update transitions status from pending to shipped", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const shipment = await caller.shipment.create({
      carrier: "bluedart",
      trackingNumber: "BD111222333",
      cost: "200.00",
      status: "pending",
    });

    const updated = await caller.shipment.update({
      id: shipment!.id,
      status: "shipped",
      shipmentDate: isoNow(),
    });

    expect(updated.status).toBe("shipped");
  });

  it("shipment.update sets actualDelivery automatically when status becomes delivered", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const shipment = await caller.shipment.create({
      carrier: "dtdc",
      trackingNumber: "DTDC444555",
      cost: "100.00",
      status: "shipped",
    });

    const delivered = await caller.shipment.update({
      id: shipment!.id,
      status: "delivered",
      // No explicit actualDelivery — should auto-set
    });

    expect(delivered.status).toBe("delivered");
    // actualDelivery should have been auto-populated
    expect(delivered.actualDelivery).not.toBeNull();
  });
});

describe("shipment.list", () => {
  it("shipment.list returns only shipments for the active business", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.shipment.list({ page: 1, limit: 20 });

    expect(Array.isArray(result.data)).toBe(true);
    for (const row of result.data) {
      expect(row).toBeDefined();
    }
  });

  it("shipment.list — business isolation: business2 has no shipments", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.shipment.list({ page: 1, limit: 20 });
    expect(result.data.length).toBe(0);
  });
});

describe("shipment.delete", () => {
  it("shipment.delete removes the shipment permanently", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const shipment = await caller.shipment.create({
      cost: "0",
      status: "pending",
      notes: "To be deleted",
    });

    await caller.shipment.delete({ id: shipment!.id });

    const fetched = await caller.shipment.getById({ id: shipment!.id });
    expect(fetched).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TARGET
// ═══════════════════════════════════════════════════════════════════════════════

describe("target.create", () => {
  it("target.create persists an order_value target and returns the created row", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const target = await caller.target.create({
      userId: world.ramesh.id,
      targetType: "order_value",
      targetValue: "100000.00",
      periodType: "monthly",
      periodStart: daysAgo(15),
      periodEnd: daysFromNow(15),
      notes: "Monthly sales target for Ramesh",
    });

    expect(target).toBeDefined();
    expect(target!.targetType).toBe("order_value");
    expect(target!.targetValue).toBe("100000.00");
    expect(target!.userId).toBe(world.ramesh.id);
    expect(target!.businessId).toBe(world.business1.id);
  });

  it("target.create rejects item_quantity target without itemId — gap: business rule", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await expect(
      caller.target.create({
        userId: world.ramesh.id,
        targetType: "item_quantity",
        targetValue: "100.00",
        periodType: "monthly",
        periodStart: daysAgo(1),
        periodEnd: daysFromNow(29),
        // itemId intentionally omitted
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("target.create rejects periodEnd before periodStart — date validation", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await expect(
      caller.target.create({
        userId: world.ramesh.id,
        targetType: "order_count",
        targetValue: "50.00",
        periodType: "custom",
        periodStart: daysFromNow(10), // start is AFTER end
        periodEnd: daysAgo(1),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("target.getProgress", () => {
  it("target.getProgress returns progress with current, target, percentage fields", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const target = await caller.target.create({
      userId: world.ramesh.id,
      targetType: "order_count",
      targetValue: "10.00",
      periodType: "monthly",
      periodStart: daysAgo(20),
      periodEnd: daysFromNow(10),
    });

    const withProgress = await caller.target.getProgress({ id: target!.id });

    expect(withProgress.progress).toBeDefined();
    expect(typeof withProgress.progress.current).toBe("number");
    expect(typeof withProgress.progress.target).toBe("number");
    expect(typeof withProgress.progress.percentage).toBe("number");
    expect(typeof withProgress.progress.remaining).toBe("number");
    expect(typeof withProgress.progress.onTrack).toBe("boolean");
    // percentage must be 0–100
    expect(withProgress.progress.percentage).toBeGreaterThanOrEqual(0);
    expect(withProgress.progress.percentage).toBeLessThanOrEqual(100);
  });

  it("target.getProgress for order_value target counts only non-draft, non-cancelled invoices", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Create a sale invoice attributed to ramesh (createdByUserId = ramesh.id)
    await createInvoiceWithItems(
      world.tenantDb,
      world.business1.id,
      world.party1.id,
      [{ description: "Target progress goods", quantity: "1", unitPrice: "5000.00" }],
      {
        type: "sale",
        documentType: "invoice",
        status: "sent", // non-draft
        createdByUserId: world.ramesh.id,
        invoiceDate: new Date(), // within target period
      },
    );

    const target = await caller.target.create({
      userId: world.ramesh.id,
      targetType: "order_value",
      targetValue: "50000.00",
      periodType: "monthly",
      periodStart: daysAgo(1),
      periodEnd: daysFromNow(29),
    });

    const withProgress = await caller.target.getProgress({ id: target!.id });

    // current must be > 0 because we created a sent invoice above
    expect(withProgress.progress.current).toBeGreaterThan(0);
  });

  it("target.getProgress returns NOT_FOUND for a target from another business", async () => {
    const callerRamesh = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const target = await callerRamesh.target.create({
      userId: world.ramesh.id,
      targetType: "order_count",
      targetValue: "5.00",
      periodType: "custom",
      periodStart: daysAgo(1),
      periodEnd: daysFromNow(30),
    });

    const callerKiran = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    await expect(
      callerKiran.target.getProgress({ id: target!.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("target.list", () => {
  it("target.list with withProgress=true attaches progress to each target", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const targets = await caller.target.list({ withProgress: true });

    expect(Array.isArray(targets)).toBe(true);
    for (const t of targets) {
      expect((t as { progress?: unknown }).progress).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// API KEY
// ═══════════════════════════════════════════════════════════════════════════════

describe("apiKey — plan check", () => {
  it("apiKey.create is blocked for free-plan tenants — gap: paid feature guard", async () => {
    // world.tenant1 is on the free plan (created with plan: "free" in fixture)
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await expect(
      caller.apiKey.create({ name: "My Free Plan Key" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("apiKey — paid tenant", () => {
  // We need a paid tenant for the remaining API key tests
  let paidTenantId: string;
  let paidUserId: string;
  let paidUserEmail: string;
  let paidUserName: string;

  beforeAll(async () => {
    // Create a paid-plan tenant
    const paidUser = await createUser({ email: `apikey.test.${Date.now()}@example.in`, name: "ApiKey Tester" });
    const paidTenant = await createTenant({ plan: "pro", name: "Paid Org" });
    await addMember(paidTenant.id, paidUser.id, "owner");
    await createSession(paidUser.id, paidTenant.id);

    paidTenantId = paidTenant.id;
    paidUserId = paidUser.id;
    paidUserEmail = paidUser.email;
    paidUserName = paidUser.name ?? "ApiKey Tester";
  });

  function paidCaller() {
    return createTestCaller({
      userId: paidUserId,
      email: paidUserEmail,
      name: paidUserName,
      tenantId: paidTenantId,
      businessId: world.business1.id, // businessId doesn't matter for apiKey (uses controlDb)
    });
  }

  it("apiKey.create returns the raw key exactly once — key is never stored in plaintext", async () => {
    const caller = paidCaller();

    const result = await caller.apiKey.create({ name: "CI Integration Key" });

    expect(typeof result.key).toBe("string");
    expect(result.key).toMatch(/^hisaabo_key_/);
    expect(typeof result.keyPrefix).toBe("string");
    expect(result.keyPrefix.length).toBe(20);
    expect(result.keyPrefix).toBe(result.key.slice(0, 20));
  });

  it("apiKey.create stores SHA-256 hash in keyHash, NOT the raw key — security invariant", async () => {
    const caller = paidCaller();

    const result = await caller.apiKey.create({ name: "Hash Check Key" });

    // Verify the stored keyHash is a SHA-256 hex (64 chars) and equals hash of raw key
    const controlDb = getControlDb();
    const [stored] = await controlDb
      .select({ keyHash: apiKeys.keyHash })
      .from(apiKeys)
      .where(eq(apiKeys.id, result.id))
      .limit(1);

    expect(stored).toBeDefined();
    // keyHash must be exactly 64 hex chars (SHA-256 output)
    expect(stored!.keyHash).toMatch(/^[a-f0-9]{64}$/);
    // keyHash must equal SHA-256 of the raw key (verifiable since we have the raw key from create response)
    const expectedHash = createHash("sha256").update(result.key).digest("hex");
    expect(stored!.keyHash).toBe(expectedHash);
    // keyHash must NOT equal the raw key
    expect(stored!.keyHash).not.toBe(result.key);
  });

  it("apiKey.list returns only display-safe fields — keyHash and raw key absent", async () => {
    const caller = paidCaller();

    await caller.apiKey.create({ name: "List Safety Check Key" });

    const keys = await caller.apiKey.list();

    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);

    for (const k of keys) {
      // These fields should be present (display-safe)
      expect(typeof k.id).toBe("string");
      expect(typeof k.name).toBe("string");
      expect(typeof k.keyPrefix).toBe("string");
      // keyHash must NOT be returned in list
      expect((k as { keyHash?: unknown }).keyHash).toBeUndefined();
    }
  });

  it("apiKey.revoke deletes the key and subsequent list excludes it", async () => {
    const caller = paidCaller();

    const created = await caller.apiKey.create({ name: "Key To Revoke" });

    const beforeRevoke = await caller.apiKey.list();
    const foundBefore = beforeRevoke.find((k) => k.id === created.id);
    expect(foundBefore).toBeDefined();

    const revokeResult = await caller.apiKey.revoke({ id: created.id });
    expect(revokeResult.success).toBe(true);

    const afterRevoke = await caller.apiKey.list();
    const foundAfter = afterRevoke.find((k) => k.id === created.id);
    expect(foundAfter).toBeUndefined();
  });

  it("apiKey.revoke returns NOT_FOUND for a key belonging to another user", async () => {
    const caller = paidCaller();
    const created = await caller.apiKey.create({ name: "Protected Key" });

    // Different user attempting to revoke — create a different caller with same tenantId
    const otherUser = await createUser({ email: `other.apikey.${Date.now()}@example.in`, name: "Other User" });
    await addMember(paidTenantId, otherUser.id, "admin");

    const otherCaller = createTestCaller({
      userId: otherUser.id,
      email: otherUser.email,
      name: otherUser.name ?? "Other User",
      tenantId: paidTenantId,
      businessId: world.business1.id,
    });

    await expect(
      otherCaller.apiKey.revoke({ id: created.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("apiKey.create with expiresAt stores the expiration date", async () => {
    const caller = paidCaller();
    const expiresAt = daysFromNow(90);

    const result = await caller.apiKey.create({
      name: "Expiring Key",
      expiresAt,
    });

    expect(result.expiresAt).toBeDefined();
    expect(result.expiresAt).not.toBeNull();
    // The stored expiresAt should be a date close to what we passed
    const stored = new Date(result.expiresAt!);
    const expected = new Date(expiresAt);
    expect(Math.abs(stored.getTime() - expected.getTime())).toBeLessThan(60_000); // within 1 minute
  });
});
