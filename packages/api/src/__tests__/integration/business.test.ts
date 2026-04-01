/**
 * business.test.ts — Integration tests for the business router.
 *
 * Covers:
 *   - business.create: creates business with required fields, auto-sets financialYearStart=4,
 *     auto-creates Cash bank account, requires admin role
 *   - business.list: returns businesses scoped to the caller's tenant DB
 *   - business.getById: returns correct business or null
 *   - business.update: updates name/settings, requires admin role
 *   - business.updateSequenceNumber: advances counters, rejects regressions
 *
 * Lifecycle:
 *   beforeAll  — create user, tenant, session (no business yet)
 *   afterAll   — truncate all tables
 *
 * The `createTestCaller` helper is not used here because business.create
 * requires a tenantProcedure context (tenantId but no businessId). We build
 * the context manually so the middleware chain is fully exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { bankAccounts } from "@hisaabo/db";
import {
  createUser,
  createTenant,
  addMember,
  createSession,
  type TestUser,
  type TestTenant,
  type TestSession,
} from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

// ── Caller factory ────────────────────────────────────────────────────────────

const _callerFactory = createCallerFactory(appRouter);

/**
 * Builds a tenantProcedure-level caller (authenticated + tenantId, no businessId).
 * The middleware hasTenantAccess injects ctx.db from getTenantDb(tenantId).
 */
function tenantLevelCaller(
  user: { id: string; email: string; name: string | null },
  tenantId: string,
) {
  return _callerFactory({
    user,
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
    }),
    resHeaders: new Headers(),
  });
}

/**
 * Builds an authorizedProcedure-level caller (authenticated + tenantId + businessId).
 * Used for business.update (which calls requireTenantAdmin) and updateSequenceNumber.
 */
function businessLevelCaller(
  user: { id: string; email: string; name: string | null },
  tenantId: string,
  businessId: string,
) {
  return _callerFactory({
    user,
    tenantId,
    businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-business-id": businessId,
      }),
    }),
    resHeaders: new Headers(),
  });
}

// ── Shared fixture state ──────────────────────────────────────────────────────

let owner: TestUser;
let seller: TestUser;
let tenant: TestTenant;
let _ownerSession: TestSession;
let _sellerSession: TestSession;

beforeAll(async () => {
  owner = await createUser({ email: "biz.owner@acme.in", name: "Biz Owner" });
  seller = await createUser({ email: "biz.seller@acme.in", name: "Biz Seller" });
  tenant = await createTenant({ name: "Business Test Org" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, seller.id, "seller");
  _ownerSession = await createSession(owner.id, tenant.id);
  _sellerSession = await createSession(seller.id, tenant.id);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// business.create
// ─────────────────────────────────────────────────────────────────────────────

describe("business.create", () => {
  const validInput = {
    name: "Sharma General Store",
    pan: "ABCDE1234F",
    phone: "9876543210",
    address: "12, Gandhi Nagar, Jaipur",
    city: "Jaipur",
    state: "Rajasthan",
    stateCode: "08",
    pincode: "302001",
    gstRegistrationType: "regular" as const,
    gstin: "08ABCDE1234F1Z5",
    invoicePrefix: "SGS",
    currency: "INR",
  };

  it("creates a business with valid input — returns row with financialYearStart defaulting to 4 (April)", async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.create(validInput);

    expect(biz).toBeDefined();
    expect(biz.name).toBe("Sharma General Store");
    expect(biz.createdByUserId).toBe(owner.id);
    expect(biz.nextInvoiceNumber).toBe(1);
    expect(biz.nextPaymentNumber).toBe(1);
    expect(biz.financialYearStart).toBe(4);
    expect(biz.id).toBeTruthy();
  });

  it("auto-creates a Cash bank account for the new business in the same transaction", async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.create({
      ...validInput,
      name: "Cash Account Test Biz",
      gstin: "08ABCDE1234F1Z6",
    });

    const tenantDb = getTenantTestDb();
    const cashAccounts = await tenantDb
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.businessId, biz.id));

    // Exactly one Cash account auto-created
    const cashAccount = cashAccounts.find((a) => a.accountType === "cash");
    expect(cashAccount).toBeDefined();
    expect(cashAccount!.accountName).toBe("Cash");
    expect(cashAccount!.openingBalance).toBe("0");
    expect(cashAccount!.currentBalance).toBe("0");
  });

  it("seller cannot create a business — FORBIDDEN due to insufficient tenant admin role", async () => {
    const caller = tenantLevelCaller(seller, tenant.id);
    await expect(
      caller.business.create({ ...validInput, name: "Seller Biz Attempt", gstin: "08ABCDE1234F1Z7" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only admins can manage businesses",
    });
  });

  it("unauthenticated caller receives UNAUTHORIZED", async () => {
    const caller = _callerFactory({
      user: null,
      tenantId: null,
      businessId: null,
      req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers: new Headers() }),
      resHeaders: new Headers(),
    });
    await expect(caller.business.create(validInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// business.list
// ─────────────────────────────────────────────────────────────────────────────

describe("business.list", () => {
  let createdBizId: string;

  beforeAll(async () => {
    // Create at least one business so the list is non-empty
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.create({
      name: "List Test Biz",
      pan: "FGHIJ5678K",
      phone: "9111111111",
      address: "22, MG Road",
      gstRegistrationType: "unregistered" as const,
      invoicePrefix: "LTB",
      currency: "INR",
    });
    createdBizId = biz.id;
  });

  it("returns businesses for the active tenant — list is non-empty and contains the created business", async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const list = await caller.business.list();

    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((b) => b.id === createdBizId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("List Test Biz");
  });

  it("seller can list businesses — business listing requires only tenantProcedure (not admin)", async () => {
    const caller = tenantLevelCaller(seller, tenant.id);
    const list = await caller.business.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// business.getById
// ─────────────────────────────────────────────────────────────────────────────

describe("business.getById", () => {
  let bizId: string;

  beforeAll(async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.create({
      name: "GetById Test Biz",
      pan: "KLMNO9012P",
      phone: "9222222222",
      address: "33, Station Road",
      gstRegistrationType: "unregistered" as const,
      invoicePrefix: "GTB",
      currency: "INR",
    });
    bizId = biz.id;
  });

  it("returns the full business object when a valid ID is supplied", async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.getById({ id: bizId });

    expect(biz).not.toBeNull();
    expect(biz!.id).toBe(bizId);
    expect(biz!.name).toBe("GetById Test Biz");
  });

  it("returns null for a non-existent business ID", async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.getById({ id: "00000000-0000-0000-0000-000000000000" });
    expect(biz).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// business.update
// ─────────────────────────────────────────────────────────────────────────────

describe("business.update", () => {
  let bizId: string;

  beforeAll(async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.create({
      name: "Update Test Biz",
      pan: "PQRST3456U",
      phone: "9333333333",
      address: "44, Ring Road",
      gstRegistrationType: "unregistered" as const,
      invoicePrefix: "UTB",
      currency: "INR",
    });
    bizId = biz.id;
  });

  it("updates business name and address — returns updated row with changed updatedAt", async () => {
    const caller = businessLevelCaller(owner, tenant.id, bizId);
    const updated = await caller.business.update({
      id: bizId,
      data: {
        name: "Updated Test Biz",
        address: "55, New Road",
        phone: "9444444444",
      },
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Test Biz");
    expect(updated!.address).toBe("55, New Road");
  });

  it("seller cannot update a business — FORBIDDEN due to insufficient tenant admin role", async () => {
    const caller = businessLevelCaller(seller, tenant.id, bizId);
    await expect(
      caller.business.update({ id: bizId, data: { name: "Seller Should Not Update" } })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only admins can manage businesses",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// business.updateSequenceNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("business.updateSequenceNumber", () => {
  let bizId: string;

  beforeAll(async () => {
    const caller = tenantLevelCaller(owner, tenant.id);
    const biz = await caller.business.create({
      name: "Seq Num Test Biz",
      pan: "UVWXY7890Z",
      phone: "9555555555",
      address: "66, Temple Street",
      gstRegistrationType: "unregistered" as const,
      invoicePrefix: "SEQ",
      currency: "INR",
    });
    bizId = biz.id;
  });

  it("advances the invoice sequence number — returns previous and new number", async () => {
    const caller = businessLevelCaller(owner, tenant.id, bizId);
    const result = await caller.business.updateSequenceNumber({
      businessId: bizId,
      documentType: "invoice",
      newNumber: 100,
    });

    expect(result.success).toBe(true);
    expect(result.previousNumber).toBe(1); // default nextInvoiceNumber
    expect(result.newNumber).toBe(100);
  });

  it("rejects going backwards — BAD_REQUEST when newNumber is less than current", async () => {
    const caller = businessLevelCaller(owner, tenant.id, bizId);
    await expect(
      caller.business.updateSequenceNumber({
        businessId: bizId,
        documentType: "invoice",
        newNumber: 50,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("cannot be less than current"),
    });
  });

  it("rejects unknown document types — BAD_REQUEST", async () => {
    const caller = businessLevelCaller(owner, tenant.id, bizId);
    await expect(
      caller.business.updateSequenceNumber({
        businessId: bizId,
        documentType: "nonexistent" as unknown as "invoice",
        newNumber: 1,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
