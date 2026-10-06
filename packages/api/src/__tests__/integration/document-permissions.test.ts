/**
 * Document permissions — integration tests
 *
 * Quotations, proforma invoices, delivery challans, sales returns, credit
 * notes, debit notes and purchase returns are Invoice-backed documents built
 * by lib/document-router-factory.ts, and `document.convert` turns one into
 * another. They follow the Invoice row of the permission matrix
 * (lib/permissions.ts):
 *
 *   role            create  updateStatus  delete  convert
 *   owner/admin       ✓         ✓           ✓        ✓
 *   seller_manager    ✓         ✓           ✓        ✓
 *   seller            ✓*        ✓           ✗        ✓
 *   (* sale-side only: sellers cannot create debit notes or purchase returns)
 *   accountant        ✗         ✗           ✗        ✗
 *
 * Before these checks existed every tenant member could create, change and
 * delete these documents through the API, CLI and MCP regardless of role.
 * A denied call must not have any side effect.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createUser,
  addMember,
  createItem,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

type Caller = ReturnType<typeof createTestCaller>;

const DOC_ROUTERS = [
  { key: "quotation", type: "sale" },
  { key: "proforma", type: "sale" },
  { key: "deliveryChallan", type: "sale" },
  { key: "salesReturn", type: "sale" },
  { key: "creditNote", type: "sale" },
  { key: "debitNote", type: "purchase" },
  { key: "purchaseReturn", type: "purchase" },
] as const;

type DocKey = (typeof DOC_ROUTERS)[number]["key"];

let world: TestWorld;
let itemId: string;
const callers = {} as Record<"owner" | "sellerManager" | "seller" | "accountant", Caller>;

function callerFor(user: { id: string; email: string; name: string | null }): Caller {
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function input(type: "sale" | "purchase") {
  return {
    partyId: world.party1.id,
    type,
    invoiceDate: new Date().toISOString(),
    lineItems: [{ itemId, itemName: "Permission test line", quantity: "1", unitPrice: "100.00", taxPercent: "5.00" }],
  };
}

// The factory routers share one shape; index them dynamically by key.
function docs(caller: Caller, key: DocKey) {
  return (caller as unknown as Record<DocKey, {
    create: (i: ReturnType<typeof input>) => Promise<{ id: string; status: string }>;
    updateStatus: (i: { id: string; status: "sent" }) => Promise<{ status: string }>;
    delete: (i: { id: string }) => Promise<unknown>;
    getById: (i: { id: string }) => Promise<{ id: string; status: string } | null>;
    list: (i: { page: number; limit: number }) => Promise<{ total: number }>;
  }>)[key];
}

beforeAll(async () => {
  world = await createTestWorld();
  const sm = await createUser({ email: "meena.sm@acmetrading.in", name: "Meena (seller_manager)" });
  const acc = await createUser({ email: "anil.acc@acmetrading.in", name: "Anil (accountant)" });
  await addMember(world.tenant1.id, sm.id, "seller_manager");
  await addMember(world.tenant1.id, acc.id, "accountant");

  const item = await createItem(world.tenantDb, world.business1.id, {
    name: "Permission Test Item",
    stockQuantity: "10000.000",
    salePrice: "100.00",
    purchasePrice: "80.00",
    taxPercent: "5.00",
  });
  itemId = item.id;

  callers.owner = callerFor(world.ramesh);
  callers.seller = callerFor(world.suresh); // seller in tenant1 (fixture)
  callers.sellerManager = callerFor(sm);
  callers.accountant = callerFor(acc);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const FORBIDDEN = { code: "FORBIDDEN" };

describe.each(DOC_ROUTERS)("$key", ({ key, type }) => {
  describe("create", () => {
    it.each(["owner", "sellerManager"] as const)("%s can create", async (who) => {
      const doc = await docs(callers[who], key).create(input(type));
      expect(doc.id).toBeTruthy();
    });

    if (type === "sale" && !["debitNote", "purchaseReturn"].includes(key)) {
      it("seller can create", async () => {
        expect((await docs(callers.seller, key).create(input(type))).id).toBeTruthy();
      });
    } else {
      it("seller is forbidden from purchase-side documents", async () => {
        await expect(docs(callers.seller, key).create(input(type))).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("purchase-side"),
        });
      });
    }

    it("accountant is forbidden and nothing is created", async () => {
      const before = (await docs(callers.owner, key).list({ page: 1, limit: 1 })).total;
      await expect(docs(callers.accountant, key).create(input(type))).rejects.toMatchObject(FORBIDDEN);
      const after = (await docs(callers.owner, key).list({ page: 1, limit: 1 })).total;
      expect(after).toBe(before);
    });
  });

  describe("updateStatus", () => {
    it.each(["owner", "sellerManager", "seller"] as const)("%s can change status", async (who) => {
      const doc = await docs(callers.owner, key).create(input(type));
      const updated = await docs(callers[who], key).updateStatus({ id: doc.id, status: "sent" });
      expect(updated.status).toBe("sent");
    });

    it("accountant is forbidden and the status is unchanged", async () => {
      const doc = await docs(callers.owner, key).create(input(type));
      await expect(docs(callers.accountant, key).updateStatus({ id: doc.id, status: "sent" })).rejects.toMatchObject(
        FORBIDDEN,
      );
      expect((await docs(callers.owner, key).getById({ id: doc.id }))?.status).toBe(doc.status);
    });
  });

  describe("delete", () => {
    it.each(["owner", "sellerManager"] as const)("%s can delete", async (who) => {
      const doc = await docs(callers.owner, key).create(input(type));
      // Soft delete: the API reports success and the document is cancelled.
      expect(await docs(callers[who], key).delete({ id: doc.id })).toEqual({ success: true });
      expect((await docs(callers.owner, key).getById({ id: doc.id }))?.status).toBe("cancelled");
    });

    it.each(["seller", "accountant"] as const)("%s is forbidden and the document survives", async (who) => {
      const doc = await docs(callers.owner, key).create(input(type));
      await expect(docs(callers[who], key).delete({ id: doc.id })).rejects.toMatchObject(FORBIDDEN);
      expect((await docs(callers.owner, key).getById({ id: doc.id }))?.status).toBe(doc.status);
    });
  });
});

describe("document.convert", () => {
  it.each(["owner", "sellerManager", "seller"] as const)("%s can convert a quotation to an invoice", async (who) => {
    const quotation = await docs(callers.owner, "quotation").create(input("sale"));
    const converted = await callers[who].document.convert({
      sourceDocumentId: quotation.id,
      targetDocumentType: "invoice",
    });
    expect(converted.documentType).toBe("invoice");
  });

  it("accountant is forbidden and no invoice is created", async () => {
    const quotation = await docs(callers.owner, "quotation").create(input("sale"));
    const before = (await callers.owner.invoice.list({ page: 1, limit: 1 })).total;
    await expect(
      callers.accountant.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "invoice" }),
    ).rejects.toMatchObject(FORBIDDEN);
    expect((await callers.owner.invoice.list({ page: 1, limit: 1 })).total).toBe(before);
  });
});
