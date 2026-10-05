/**
 * Draft → "sent" promotion on PDF download (lib/invoice-pdf-promotion.ts,
 * used by GET /api/invoices/:id/pdf in server.ts).
 *
 * Downloading a draft sale invoice's PDF promotes it to "sent". That is a
 * status change, so — like invoice.updateStatus — it requires update:Invoice.
 * Read-only roles (accountant, legacy "viewer") still get the PDF, but must not
 * change the invoice's status by downloading it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createUser, addMember, type TestWorld } from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { shouldPromoteDraftOnPdf } from "../../lib/invoice-pdf-promotion.js";

let world: TestWorld;
const users: Record<string, string> = {};

const draftSale = { status: "draft", type: "sale", documentType: "invoice" };

beforeAll(async () => {
  world = await createTestWorld(); // ramesh = owner, suresh = seller (tenant1)
  users.owner = world.ramesh.id;
  users.seller = world.suresh.id;
  for (const role of ["seller_manager", "accountant", "member", "viewer", "admin"] as const) {
    const u = await createUser({ email: `pdf-${role}@acmetrading.in`, name: `PDF ${role}` });
    await addMember(world.tenant1.id, u.id, role);
    users[role] = u.id;
  }
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function promote(who: string, invoice = draftSale) {
  return shouldPromoteDraftOnPdf({ invoice, userId: users[who], tenantId: world.tenant1.id });
}

describe("shouldPromoteDraftOnPdf — role permission (update:Invoice)", () => {
  it.each(["owner", "admin", "seller_manager", "seller", "member"])(
    "%s (can update invoices) promotes a draft sale invoice",
    async (who) => {
      expect(await promote(who)).toBe(true);
    },
  );

  it.each(["accountant", "viewer"])("%s (read-only on invoices) does not promote", async (who) => {
    expect(await promote(who)).toBe(false);
  });

  it("a user who is not a member of the tenant does not promote", async () => {
    // kiran is the owner of tenant2, not a member of tenant1
    expect(
      await shouldPromoteDraftOnPdf({ invoice: draftSale, userId: world.kiran.id, tenantId: world.tenant1.id }),
    ).toBe(false);
  });
});

describe("shouldPromoteDraftOnPdf — only draft sale invoices (unchanged from main#41)", () => {
  it.each([
    ["an already-sent invoice", { status: "sent", type: "sale", documentType: "invoice" }],
    ["a paid invoice", { status: "paid", type: "sale", documentType: "invoice" }],
    ["a purchase bill", { status: "draft", type: "purchase", documentType: "invoice" }],
    ["a credit note", { status: "draft", type: "sale", documentType: "credit_note" }],
    ["a quotation", { status: "draft", type: "sale", documentType: "quotation" }],
  ])("never promotes %s, even for the owner", async (_label, invoice) => {
    expect(await promote("owner", invoice)).toBe(false);
  });
});
