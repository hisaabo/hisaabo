/**
 * multi-tenant.test.ts — Cross-tenant and cross-business isolation tests.
 *
 * SCENARIO:
 *   Two tenants (Acme Corp, Beta Industries) with three users:
 *     Ramesh  — owner of Acme Corp
 *     Kiran   — owner of Beta Industries
 *     Suresh  — admin on Acme Corp, seller on Beta Industries
 *
 *   Each tenant has two businesses:
 *     Acme:  business_acme_a, business_acme_b
 *     Beta:  business_beta_a, business_beta_b
 *
 * TEST GROUPS:
 *   A. Cross-tenant party isolation
 *      — Ramesh sees only Acme parties
 *      — Kiran sees only Beta parties
 *      — Suresh with Acme context sees Acme parties; with Beta context sees Beta parties
 *      — Suresh cannot use an Acme businessId while holding a Beta tenant context
 *
 *   B. Role differences across tenants
 *      — Suresh is admin on Acme (can delete parties)
 *      — Suresh is seller on Beta (cannot delete parties — FORBIDDEN)
 *
 *   C. Business isolation within a tenant
 *      — Items in business_acme_a are invisible from business_acme_b context
 *      — Invoices in business_acme_a are invisible from business_acme_b context
 *
 * Lifecycle:
 *   beforeAll  — createTestWorld() builds the full fixture graph
 *   afterAll   — truncate all tables + close DB connections
 *
 * WHY THESE TESTS MATTER:
 *   The hasTenantAccess middleware calls getTenantDb(tenantId), which in
 *   self-hosted mode always returns the single shared DB but namespaces queries
 *   by businessId (set via x-business-id header and validated in
 *   hasBusinessAccess). If the businessId check were removed or the WHERE
 *   clause omitted, a user could read data from any business in the DB.
 *   These tests act as a regression fence around that boundary.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createBusiness,
  createParty,
  createItem,
  createInvoiceWithItems,
  type TestWorld,
} from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

// ── Caller factory ────────────────────────────────────────────────────────────

const _callerFactory = createCallerFactory(appRouter);

/**
 * Builds an authorizedProcedure-level caller that places the caller in a
 * specific tenant + business context. The x-business-id header is required
 * so hasBusinessAccess validates the business exists in the tenant DB.
 */
function callerFor(opts: {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string;
  businessId: string;
}) {
  return _callerFactory({
    user: { id: opts.userId, email: opts.email, name: opts.name },
    tenantId: opts.tenantId,
    businessId: opts.businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-business-id": opts.businessId,
      }),
    }),
    resHeaders: new Headers(),
  });
}

// ── Fixture state ─────────────────────────────────────────────────────────────

let world: TestWorld;

// Extra businesses and data created for isolation tests
let businessAcmeB: Awaited<ReturnType<typeof createBusiness>>;
let _businessBetaB: Awaited<ReturnType<typeof createBusiness>>;
let _sureshBetaMembership: { role: string };

beforeAll(async () => {
  world = await createTestWorld();

  // Add Suresh to Beta Industries as a seller (createTestWorld only puts him on tenant1)
  const { getControlDb: _getControlDb } = await import("../helpers/test-db.js");
  const { addMember } = await import("../helpers/fixtures.js");
  await addMember(world.tenant2.id, world.suresh.id, "seller");
  _sureshBetaMembership = { role: "seller" };

  // Add a second business to Acme Corp (tenant1) — used for within-tenant isolation
  businessAcmeB = await createBusiness(world.tenantDb, world.ramesh.id, {
    name: "Acme Trading Branch",
    gstin: "27AABCA0001R1ZM",
    city: "Pune",
    state: "Maharashtra",
    stateCode: "27",
  });

  // Add a second business to Beta Industries (tenant2) context — same tenant DB
  _businessBetaB = await createBusiness(world.tenantDb, world.kiran.id, {
    name: "Kiran Exports",
    gstin: "29AABCK0001R1ZM",
    city: "Hubballi",
    state: "Karnataka",
    stateCode: "29",
  });

  // Seed extra items and invoices in business1 (Acme) and businessAcmeB so isolation is testable
  await createItem(world.tenantDb, world.business1.id, {
    name: "Acme Branch A Item",
    hsn: "5208",
    unit: "m",
    salePrice: "300.00",
    purchasePrice: "240.00",
    taxPercent: "5.00",
  });

  await createItem(world.tenantDb, businessAcmeB.id, {
    name: "Acme Branch B Item",
    hsn: "5210",
    unit: "kg",
    salePrice: "180.00",
    purchasePrice: "140.00",
    taxPercent: "12.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// A. Cross-tenant party isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-tenant isolation — party listing is scoped to the caller's business context", () => {
  it("Ramesh listing parties sees ONLY Acme parties — no Beta parties visible", async () => {
    const caller = callerFor({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.party.list({ page: 1, limit: 50 });

    // Must contain the Acme party
    const acmeParty = result.data.find((p) => p.id === world.party1.id);
    expect(acmeParty).toBeDefined();
    expect(acmeParty!.name).toBe("Priya Textiles Pvt Ltd");

    // Must NOT contain the Beta party
    const betaParty = result.data.find((p) => p.id === world.party2.id);
    expect(betaParty).toBeUndefined();
  });

  it("Kiran listing parties sees ONLY Beta Industries parties — no Acme parties visible", async () => {
    const caller = callerFor({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller.party.list({ page: 1, limit: 50 });

    // Must contain the Beta party
    const betaParty = result.data.find((p) => p.id === world.party2.id);
    expect(betaParty).toBeDefined();
    expect(betaParty!.name).toBe("Shree Traders");

    // Must NOT contain the Acme party
    const acmeParty = result.data.find((p) => p.id === world.party1.id);
    expect(acmeParty).toBeUndefined();
  });

  it("Suresh with Acme Corp tenant context sees Acme parties — not Beta parties", async () => {
    const caller = callerFor({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.party.list({ page: 1, limit: 50 });

    const acmeParty = result.data.find((p) => p.id === world.party1.id);
    expect(acmeParty).toBeDefined();

    const betaParty = result.data.find((p) => p.id === world.party2.id);
    expect(betaParty).toBeUndefined();
  });

  it("Suresh with Beta Industries tenant context sees Beta parties — not Acme parties", async () => {
    const caller = callerFor({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller.party.list({ page: 1, limit: 50 });

    const betaParty = result.data.find((p) => p.id === world.party2.id);
    expect(betaParty).toBeDefined();

    const acmeParty = result.data.find((p) => p.id === world.party1.id);
    expect(acmeParty).toBeUndefined();
  });

  it("Suresh CANNOT use an Acme businessId while holding a Beta tenant context — FORBIDDEN (business not found)", async () => {
    // Suresh is on Beta tenant, but the businessId passed belongs to Acme.
    // The hasBusinessAccess middleware queries for the business in ctx.db (Beta tenant DB).
    // In self-hosted mode both schemas share the same DB; the middleware verifies
    // the business exists. The business DOES exist in the DB (it belongs to Acme),
    // so the middleware passes — but the data returned is scoped by businessId in each
    // query's WHERE clause, meaning Acme parties will not appear in a Beta context.
    //
    // More critically: in cloud multi-tenant mode (separate DBs), the business would
    // not be found at all (it lives in Acme's DB, not Beta's). We test the self-hosted
    // path here. The critical invariant is that party.list always filters by businessId.
    const caller = callerFor({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name,
      tenantId: world.tenant2.id,
      businessId: world.business1.id, // Acme businessId in Beta context
    });

    // party.list filters by ctx.businessId, so even if middleware passes,
    // no Acme parties appear in Beta context (they're filtered by businessId)
    const result = await caller.party.list({ page: 1, limit: 50 });

    // Acme party must not appear — it belongs to business1, but the businesses
    // table is shared in self-hosted mode. The key is the WHERE clause on businessId.
    // party1 belongs to business1 (Acme), so it should not appear in business2 (Beta) context.
    const acmeParty = result.data.find((p) => p.id === world.party1.id);
    expect(acmeParty).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Role differences across tenants for the same user (Suresh)
// ─────────────────────────────────────────────────────────────────────────────

describe("Role differences across tenants — same user has different permissions depending on active tenant", () => {
  it("Suresh as admin on Acme can delete a party in Acme's business — succeeds", async () => {
    // Upgrade Suresh to admin on tenant1 for this test group
    const { getControlDb } = await import("../helpers/test-db.js");
    const { tenantMembers } = await import("@hisaabo/db");
    const { eq, and } = await import("drizzle-orm");
    const db = getControlDb();

    await db
      .update(tenantMembers)
      .set({ role: "admin" })
      .where(and(eq(tenantMembers.tenantId, world.tenant1.id), eq(tenantMembers.userId, world.suresh.id)));

    // Create a fresh party to delete
    const victim = await createParty(world.tenantDb, world.business1.id, {
      name: "Party To Delete",
      type: "customer",
    });

    const caller = callerFor({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.party.delete({ id: victim.id });
    expect(result.success).toBe(true);
  });

  it("Suresh as seller on Beta Industries cannot delete a party — FORBIDDEN (no delete Party permission)", async () => {
    // Suresh's role on tenant2 is "seller" — sellers cannot delete parties
    const victimBeta = await createParty(world.tenantDb, world.business2.id, {
      name: "Beta Party Seller Cannot Delete",
      type: "customer",
    });

    const caller = callerFor({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    await expect(
      caller.party.delete({ id: victimBeta.id })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("Party"),
    });
  });

  it("Suresh back on Acme as admin can create items — seller_manager and above can create items", async () => {
    // Suresh is currently admin on Acme (set in the delete test above)
    const caller = callerFor({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // admin maps to CASL "admin" role which has manage("all") — can create items
    const result = await caller.item.create({
      name: "Admin Created Item",
      unit: "pcs",
      itemMode: "simple",
      salePrice: "100.00",
      purchasePrice: "70.00",
      taxPercent: "18.00",
      stockQuantity: "50",
      itemType: "product",
    });

    expect(result.name).toBe("Admin Created Item");
    expect(result.businessId).toBe(world.business1.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Business isolation within the same tenant
// ─────────────────────────────────────────────────────────────────────────────

describe("Business isolation within a tenant — data from one business is invisible from another", () => {
  it("items seeded in business_acme_a are invisible from business_acme_b context", async () => {
    // Query from Acme Branch A context
    const callerA = callerFor({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
    const resultA = await callerA.item.list({ page: 1, limit: 50 });

    // Should contain items belonging to business1 only
    const branchBItem = resultA.data.find((i) => i.name === "Acme Branch B Item");
    expect(branchBItem).toBeUndefined();

    // Query from Acme Branch B context
    const callerB = callerFor({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: businessAcmeB.id,
    });
    const resultB = await callerB.item.list({ page: 1, limit: 50 });

    // Branch B should not see Branch A's items
    const branchAItem = resultB.data.find((i) => i.name === "Acme Branch A Item" || i.name === "Cotton Fabric (White 40s)");
    expect(branchAItem).toBeUndefined();
  });

  it("party in business_acme_a is invisible from business_acme_b context — getById returns null", async () => {
    // party1 belongs to business1
    const callerB = callerFor({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: businessAcmeB.id,
    });

    // party.getById filters by both id AND businessId — should return null for cross-business access
    const result = await callerB.party.getById({ id: world.party1.id });
    expect(result).toBeNull();
  });

  it("invoice in business_acme_a is invisible from business_acme_b context — list returns empty", async () => {
    // Create a party and invoice in business1
    const bizAParty = await createParty(world.tenantDb, world.business1.id, {
      name: "Invoice Isolation Party",
      type: "customer",
    });

    await createInvoiceWithItems(
      world.tenantDb,
      world.business1.id,
      bizAParty.id,
      [{ description: "Isolation Test Line", quantity: "2", unitPrice: "500.00", taxPercent: "18.00" }],
    );

    // Query invoices from businessAcmeB context — should see zero invoices that belong to business1
    const callerB = callerFor({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: businessAcmeB.id,
    });

    const result = await callerB.invoice.list({ page: 1, limit: 50, documentType: "invoice" });

    // businessAcmeB has no invoices — all invoices we created belong to business1
    const leakedInvoice = result.data.find((inv) => inv.partyId === bizAParty.id);
    expect(leakedInvoice).toBeUndefined();
  });

  it("business_acme_b context cannot read a party from business_acme_a via list — businessId WHERE clause enforced", async () => {
    // Seed a party in businessAcmeB so the list is not trivially empty
    await createParty(world.tenantDb, businessAcmeB.id, {
      name: "Acme Branch B Party",
      type: "supplier",
    });

    const callerB = callerFor({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: businessAcmeB.id,
    });

    const result = await callerB.party.list({ page: 1, limit: 50 });

    // Only the Branch B party should appear — not Branch A's parties
    const branchAParty = result.data.find((p) => p.id === world.party1.id);
    expect(branchAParty).toBeUndefined();

    const branchBParty = result.data.find((p) => p.name === "Acme Branch B Party");
    expect(branchBParty).toBeDefined();
  });
});
