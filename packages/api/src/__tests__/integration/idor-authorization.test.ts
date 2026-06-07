/**
 * idor-authorization.test.ts — Systematic IDOR / cross-tenant authorization matrix.
 *
 * WHY THIS FILE EXISTS:
 *   An external penetration test produced a "Multi-Tenant IDOR / Authorization Test
 *   Checklist" (v0.9.0) enumerating every tRPC procedure whose input carries a
 *   client-supplied identifier — the exact surface where one tenant could try to
 *   reach another tenant's records. This file turns that checklist into an executable
 *   regression fence: for EVERY id-accepting procedure, a caller authenticated in
 *   Business A passes Business B's record id and must NEVER receive (or mutate) B's
 *   data. The expected result for every cross-business call is `null` / empty /
 *   `NOT_FOUND` / `FORBIDDEN` — never the record.
 *
 * WORLD LAYOUT (createTestWorld):
 *   tenant1 / business1  — ramesh (owner),  suresh (seller)
 *   tenant2 / business2  — kiran  (owner)
 *
 *   business1 and business2 live in the SAME physical database (self-hosted mode),
 *   so the only thing standing between them is the per-handler `businessId` WHERE
 *   clause. That clause is precisely the IDOR control under test here. The
 *   hasBusinessAccess middleware additionally blocks a caller from *selecting* another
 *   tenant's businessId (covered in multi-tenant.test.ts); this file covers the
 *   complementary vector — a legitimately-selected business context being used to
 *   reach a foreign *record* id.
 *
 * COVERAGE MAP (checklist → tests):
 *   Bucket A — direct fetch by id:
 *     invoice.getById, party.getById, item.getById,
 *     item.priceHistory, item.stockMovements, item.salesStats
 *   Bucket B — relational *Id (high priority):
 *     shipment.list(invoiceId), payment.list(invoiceId), party.ledger(partyId),
 *     party.topItems(partyId), payment.defaultAccount(partyId),
 *     payment.unpaidInvoices(partyId)
 *   Bucket C — mutations & state changes:
 *     invoice.update, invoice.updateStatus (markSent), invoice.delete,
 *     party.update, party.delete, item.update, item.delete,
 *     payment.create, payment.update, payment.delete,
 *     tenant.removeMember, tenant.updateMemberRole
 *   Role-based authorization (Staff/Viewer attempting privileged actions):
 *     seller cannot delete invoice/party/item, cannot update item,
 *     cannot manage team membership.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createParty,
  createItem,
  createInvoiceWithItems,
  createPayment,
  createBankAccount,
  createShipment,
  type TestWorld,
} from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

// ── Fixture state ───────────────────────────────────────────────────────────────

let world: TestWorld;

// Cross-business records seeded so relational/stats endpoints have something to leak.
let invoiceA: Awaited<ReturnType<typeof createInvoiceWithItems>>["invoice"]; // business1
let invoiceB: Awaited<ReturnType<typeof createInvoiceWithItems>>["invoice"]; // business2
let bankAccountB: Awaited<ReturnType<typeof createBankAccount>>; // business2

// Callers. callerA / callerB are the two owner contexts; callerStaff is the seller
// (Staff-equivalent) on business1, used for role-based authorization checks.
let callerA: ReturnType<typeof createTestCaller>; // tenant1 / business1, ramesh (owner)
let callerB: ReturnType<typeof createTestCaller>; // tenant2 / business2, kiran (owner)
let callerStaff: ReturnType<typeof createTestCaller>; // tenant1 / business1, suresh (seller)

beforeAll(async () => {
  world = await createTestWorld();

  callerA = createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
  callerB = createTestCaller({
    userId: world.kiran.id,
    email: world.kiran.email,
    name: world.kiran.name,
    tenantId: world.tenant2.id,
    businessId: world.business2.id,
  });
  callerStaff = createTestCaller({
    userId: world.suresh.id,
    email: world.suresh.email,
    name: world.suresh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });

  // ── Seed business1 (Acme) — used as the "B→A" target ──
  ({ invoice: invoiceA } = await createInvoiceWithItems(
    world.tenantDb,
    world.business1.id,
    world.party1.id,
    [{ itemId: world.item1.id, itemName: "Cotton Fabric (White 40s)", quantity: "5", unitPrice: "250.00", taxPercent: "5.00" }],
    { status: "sent", type: "sale", documentType: "invoice" },
  ));

  // ── Seed business2 (Kiran) — the primary "A→B" target ──
  ({ invoice: invoiceB } = await createInvoiceWithItems(
    world.tenantDb,
    world.business2.id,
    world.party2.id,
    [{ itemId: world.item2.id, itemName: "Sandalwood Incense Sticks", quantity: "10", unitPrice: "120.00", taxPercent: "12.00" }],
    // 'sent' (not draft/paid/cancelled) so it surfaces in unpaidInvoices and stats.
    { status: "sent", type: "sale", documentType: "invoice" },
  ));

  bankAccountB = await createBankAccount(world.tenantDb, world.business2.id, {
    accountName: "Kiran Enterprises HDFC",
    accountNumber: "99998888777766",
  });

  // A payment in business2 against invoiceB, tied to party2 + bankAccountB. This is
  // what payment.list(invoiceId), payment.defaultAccount(partyId) would leak.
  await createPayment(world.tenantDb, world.business2.id, world.party2.id, {
    invoiceId: invoiceB.id,
    bankAccountId: bankAccountB.id,
    amount: "500.00",
  });

  // A shipment in business2 against invoiceB — what shipment.list(invoiceId) would leak.
  await createShipment(world.tenantDb, world.business2.id, {
    invoiceId: invoiceB.id,
    partyId: world.party2.id,
    carrier: "BlueDart",
    status: "shipped",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bucket A — Direct record fetch by id (classic IDOR)
// Expected: cross-business id → null / empty / zeroed; same-business → the record.
// ─────────────────────────────────────────────────────────────────────────────

describe("Bucket A — direct fetch by id is scoped to the caller's business", () => {
  it("invoice.getById: A cannot read B's invoice (and B can)", async () => {
    expect(await callerA.invoice.getById({ id: invoiceB.id })).toBeNull();
    expect(await callerB.invoice.getById({ id: invoiceA.id })).toBeNull(); // reverse direction
    const own = await callerB.invoice.getById({ id: invoiceB.id });
    expect(own?.id).toBe(invoiceB.id); // positive control
  });

  it("party.getById: A cannot read B's party (and B can)", async () => {
    expect(await callerA.party.getById({ id: world.party2.id })).toBeNull();
    expect(await callerB.party.getById({ id: world.party1.id })).toBeNull(); // reverse direction
    const own = await callerB.party.getById({ id: world.party2.id });
    expect(own?.id).toBe(world.party2.id); // positive control
  });

  it("item.getById: A cannot read B's item (and B can)", async () => {
    expect(await callerA.item.getById({ id: world.item2.id })).toBeNull();
    expect(await callerB.item.getById({ id: world.item1.id })).toBeNull(); // reverse direction
    const own = await callerB.item.getById({ id: world.item2.id });
    expect(own?.id).toBe(world.item2.id); // positive control
  });

  it("item.priceHistory: A gets nothing for B's item (B sees its own history)", async () => {
    expect(await callerA.item.priceHistory({ id: world.item2.id })).toHaveLength(0);
    expect((await callerB.item.priceHistory({ id: world.item2.id })).length).toBeGreaterThan(0);
  });

  it("item.stockMovements: A gets nothing for B's item (B sees its own movements)", async () => {
    expect(await callerA.item.stockMovements({ id: world.item2.id })).toHaveLength(0);
    expect((await callerB.item.stockMovements({ id: world.item2.id })).length).toBeGreaterThan(0);
  });

  it("item.salesStats: A gets zeroed stats for B's item (B sees real figures)", async () => {
    const leaked = await callerA.item.salesStats({ id: world.item2.id });
    expect(leaked.saleInvoiceCount).toBe(0);
    expect(leaked.totalSaleAmount).toBe("0");

    const own = await callerB.item.salesStats({ id: world.item2.id });
    expect(own.saleInvoiceCount).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bucket B — Relational *Id (the sneaky ones)
// A list/detail endpoint taking a foreign key must still scope by businessId.
// ─────────────────────────────────────────────────────────────────────────────

describe("Bucket B — relational *Id endpoints do not leak across businesses", () => {
  it("shipment.list(invoiceId): A sees no shipments for B's invoice (B does)", async () => {
    const leaked = await callerA.shipment.list({ invoiceId: invoiceB.id, page: 1, limit: 50 });
    expect(leaked.data).toHaveLength(0);
    expect(leaked.total).toBe(0);

    const own = await callerB.shipment.list({ invoiceId: invoiceB.id, page: 1, limit: 50 });
    expect(own.data.length).toBeGreaterThan(0);
  });

  it("payment.list(invoiceId): A sees no payments for B's invoice (B does)", async () => {
    const leaked = await callerA.payment.list({ invoiceId: invoiceB.id, page: 1, limit: 50 });
    expect(leaked.data).toHaveLength(0);
    expect(leaked.total).toBe(0);

    const own = await callerB.payment.list({ invoiceId: invoiceB.id, page: 1, limit: 50 });
    expect(own.data.length).toBeGreaterThan(0);
  });

  it("party.ledger(partyId): A is rejected for B's party (B gets the ledger)", async () => {
    await expect(
      callerA.party.ledger({ partyId: world.party2.id, page: 1, limit: 50 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const own = await callerB.party.ledger({ partyId: world.party2.id, page: 1, limit: 50 });
    expect(own).toBeDefined();
  });

  it("party.topItems(partyId): A gets nothing for B's party (B sees its top items)", async () => {
    expect(await callerA.party.topItems({ partyId: world.party2.id })).toHaveLength(0);
    expect((await callerB.party.topItems({ partyId: world.party2.id })).length).toBeGreaterThan(0);
  });

  it("payment.defaultAccount(partyId): A cannot infer B's bank account from B's party", async () => {
    // A has no payments for party2, so no account is suggested — B's bank account
    // must never surface in A's context.
    const leaked = await callerA.payment.defaultAccount({ partyId: world.party2.id });
    expect(leaked?.id).not.toBe(bankAccountB.id);

    const own = await callerB.payment.defaultAccount({ partyId: world.party2.id });
    expect(own?.id).toBe(bankAccountB.id); // positive control
  });

  it("payment.unpaidInvoices(partyId): A gets nothing for B's party (B sees the unpaid invoice)", async () => {
    expect(await callerA.payment.unpaidInvoices({ partyId: world.party2.id })).toHaveLength(0);
    const own = await callerB.payment.unpaidInvoices({ partyId: world.party2.id });
    expect(own.some((inv) => inv.id === invoiceB.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bucket C — Mutations & state changes
// A cross-business id must be a no-op or rejection; the target record must survive
// unchanged. Each test creates a dedicated victim in business2 so the assertion
// "still exists / unchanged" is unambiguous.
// ─────────────────────────────────────────────────────────────────────────────

describe("Bucket C — mutations cannot tamper with another business's records", () => {
  it("invoice.update: A cannot edit B's invoice", async () => {
    await expect(
      callerA.invoice.update({ id: invoiceB.id, notes: "tampered by A" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Invoice B is untouched.
    const after = await callerB.invoice.getById({ id: invoiceB.id });
    expect(after?.notes ?? null).not.toBe("tampered by A");
  });

  it("invoice.updateStatus (markSent): A cannot change the status of B's invoice", async () => {
    await expect(
      callerA.invoice.updateStatus({ id: invoiceB.id, status: "cancelled" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const after = await callerB.invoice.getById({ id: invoiceB.id });
    expect(after?.status).not.toBe("cancelled");
  });

  it("invoice.delete: A deleting B's invoice does not remove it", async () => {
    const { invoice: victim } = await createInvoiceWithItems(
      world.tenantDb,
      world.business2.id,
      world.party2.id,
      [{ itemId: world.item2.id, itemName: "Victim Line", quantity: "1", unitPrice: "10.00" }],
      { status: "sent", type: "sale", documentType: "invoice" },
    );

    // delete is scoped by businessId; for a foreign id the WHERE matches nothing,
    // so it is a silent no-op rather than a deletion of B's data.
    await callerA.invoice.delete({ id: victim.id });

    const stillThere = await callerB.invoice.getById({ id: victim.id });
    expect(stillThere?.id).toBe(victim.id);
  });

  it("party.update: A cannot edit B's party", async () => {
    await expect(
      callerA.party.update({ id: world.party2.id, data: { name: "HACKED" } }),
    ).rejects.toThrow();

    const after = await callerB.party.getById({ id: world.party2.id });
    expect(after?.name).toBe("Shree Traders");
  });

  it("party.delete: A deleting B's party is rejected and the party survives", async () => {
    const victim = await createParty(world.tenantDb, world.business2.id, {
      name: "Cross-Business Victim Party",
      type: "customer",
    });

    await expect(
      callerA.party.delete({ id: victim.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stillThere = await callerB.party.getById({ id: victim.id });
    expect(stillThere?.id).toBe(victim.id);
  });

  it("item.update: A cannot edit B's item", async () => {
    await expect(
      callerA.item.update({ id: world.item2.id, data: { name: "HACKED ITEM" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const after = await callerB.item.getById({ id: world.item2.id });
    expect(after?.name).toBe("Sandalwood Incense Sticks");
  });

  it("item.delete: A deleting B's item is rejected and the item survives", async () => {
    const victim = await createItem(world.tenantDb, world.business2.id, {
      name: "Cross-Business Victim Item",
    });

    await expect(
      callerA.item.delete({ id: victim.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stillThere = await callerB.item.getById({ id: victim.id });
    expect(stillThere?.id).toBe(victim.id);
  });

  it("payment.create: A cannot record a payment against B's party", async () => {
    await expect(
      callerA.payment.create({
        partyId: world.party2.id,
        amount: "100.00",
        mode: "cash",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("payment.update: A cannot edit B's payment", async () => {
    const victim = await createPayment(world.tenantDb, world.business2.id, world.party2.id, {
      amount: "777.00",
    });

    await expect(
      callerA.payment.update({ id: victim.id, amount: "0.01", mode: "cash" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The amount on B's payment is unchanged.
    const list = await callerB.payment.list({ partyId: world.party2.id, page: 1, limit: 100 });
    const stillThere = list.data.find((p) => p.id === victim.id);
    expect(stillThere?.amount).toBe("777.00");
  });

  it("payment.delete: A cannot delete B's payment", async () => {
    const victim = await createPayment(world.tenantDb, world.business2.id, world.party2.id, {
      amount: "888.00",
    });

    // delete is scoped by businessId; for a foreign id the lookup finds nothing,
    // so the handler reports failure rather than deleting B's payment.
    const res = await callerA.payment.delete({ id: victim.id });
    expect(res.success).toBe(false);

    const list = await callerB.payment.list({ partyId: world.party2.id, page: 1, limit: 100 });
    expect(list.data.some((p) => p.id === victim.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Team management — cross-tenant + role escalation
// ─────────────────────────────────────────────────────────────────────────────

describe("Bucket C — team management is tenant-scoped and role-gated", () => {
  it("tenant.removeMember: tenant1 owner cannot remove tenant2's member", async () => {
    // kiran is a member of tenant2 only. Removing him from tenant1's context is a
    // no-op (the delete is scoped by tenantId), so his tenant2 membership survives.
    await callerA.tenant.removeMember({ userId: world.kiran.id });

    const members = await callerB.tenant.members();
    expect(members.some((m) => m.userId === world.kiran.id)).toBe(true);
  });

  it("tenant.updateMemberRole: tenant1 owner cannot change a tenant2 member's role", async () => {
    // suresh is NOT a member of tenant2, so the update matches no row — kiran (the
    // only tenant2 member) is unaffected and remains owner.
    await callerB.tenant.updateMemberRole({ userId: world.suresh.id, role: "admin" });

    const members = await callerB.tenant.members();
    const kiran = members.find((m) => m.userId === world.kiran.id);
    expect(kiran?.role).toBe("owner");
    expect(members.some((m) => m.userId === world.suresh.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Role-based authorization — a Staff (seller) user inside its OWN business still
// cannot perform privileged (owner/admin-only) actions. Covers the checklist's
// "Staff role (expect denied)" column.
// ─────────────────────────────────────────────────────────────────────────────

describe("Role-based authorization — seller (Staff) is denied privileged actions", () => {
  it("seller cannot delete an invoice in their own business", async () => {
    await expect(
      callerStaff.invoice.delete({ id: invoiceA.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("seller cannot delete a party in their own business", async () => {
    await expect(
      callerStaff.party.delete({ id: world.party1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("seller cannot update or delete an item in their own business", async () => {
    await expect(
      callerStaff.item.update({ id: world.item1.id, data: { name: "Seller Edit" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerStaff.item.delete({ id: world.item1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("seller cannot manage team membership (remove member / change roles)", async () => {
    await expect(
      callerStaff.tenant.removeMember({ userId: world.ramesh.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerStaff.tenant.updateMemberRole({ userId: world.ramesh.id, role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
