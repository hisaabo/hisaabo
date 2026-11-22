/**
 * item-price-propagation.test.ts — item.updatePricesFromDocument.
 *
 * "Update saved prices?": after a bill is made, the rates typed on it can be
 * written to the catalog. The bill is saved by its own call; this procedure is
 * the second, independent write. The tests cover the permission gate, business
 * isolation, the three price slots (base / alternate unit / variant), tax basis,
 * all-or-nothing and idempotent behaviour, the audit trail, and that a failure
 * here never touches the bill.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, invoiceItems, invoices, items, itemVariants } from "@hisaabo/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import {
  addMember,
  createBusiness,
  createItem,
  createParty,
  createTenant,
  createUser,
  type TestBusiness,
  type TestItem,
  type TestParty,
  type TestTenant,
  type TestUser,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

type Caller = ReturnType<typeof createTestCaller>;

let tenant: TestTenant;
let otherTenant: TestTenant;
let business: TestBusiness;
let otherBusiness: TestBusiness;
let customer: TestParty;
let supplier: TestParty;
let owner: TestUser;
let manager: TestUser;
let seller: TestUser;
let accountant: TestUser;
let stranger: TestUser;

let asOwner: Caller;
let asManager: Caller;
let asSeller: Caller;
let asAccountant: Caller;
let asAgent: Caller;
let asStranger: Caller;

let rice: TestItem; // base kg, one alt unit "5 kg"
let ghee: TestItem; // simple, tax-inclusive
let tee: TestItem; // variants
let foreign: TestItem; // another business
let teeVariantId: string;

function caller(user: TestUser, t: TestTenant, b: TestBusiness, headers?: Record<string, string>): Caller {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId: t.id, businessId: b.id, headers });
}

async function freshItem(id: string) {
  const db = getTenantTestDb();
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row!;
}

async function auditRowsFor(entityId: string) {
  const db = getTenantTestDb();
  return db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, "item.updatePriceFromDocument")));
}

async function makeSaleInvoice(lines: Array<{ itemId: string; unitPrice: string; quantity?: string; selectedUnit?: string; conversionFactor?: string }>) {
  const created = await asOwner.invoice.create({
    partyId: customer.id,
    type: "sale",
    lineItems: lines.map((l) => ({
      itemId: l.itemId,
      itemName: "line",
      quantity: l.quantity ?? "1",
      unitPrice: l.unitPrice,
      taxPercent: "0",
      selectedUnit: l.selectedUnit,
      conversionFactor: l.conversionFactor,
    })),
  } as never);
  return created as { id: string; invoiceNumber: string; totalAmount: string };
}

beforeAll(async () => {
  const db = getTenantTestDb();
  owner = await createUser({ email: "owner.pp@acme.in", name: "Owner" });
  manager = await createUser({ email: "manager.pp@acme.in", name: "Manager" });
  seller = await createUser({ email: "seller.pp@acme.in", name: "Seller" });
  accountant = await createUser({ email: "accountant.pp@acme.in", name: "Accountant" });
  stranger = await createUser({ email: "stranger.pp@other.in", name: "Stranger" });

  tenant = await createTenant({ name: "Price Propagation Co" });
  otherTenant = await createTenant({ name: "Other Co" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, manager.id, "seller_manager");
  await addMember(tenant.id, seller.id, "seller");
  await addMember(tenant.id, accountant.id, "accountant");
  await addMember(otherTenant.id, stranger.id, "owner");

  business = await createBusiness(db, owner.id, { name: "Price Propagation Co" });
  otherBusiness = await createBusiness(db, stranger.id, { name: "Other Co", gstin: "29AABCK1111R1ZM", stateCode: "29" });
  customer = await createParty(db, business.id, { name: "Priya Textiles", type: "customer" });
  supplier = await createParty(db, business.id, { name: "Mill Supplier", type: "supplier" });

  rice = await createItem(db, business.id, {
    name: "Basmati Rice",
    unit: "kg",
    itemMode: "alt_units",
    salePrice: "90.00",
    purchasePrice: "70.00",
    taxPercent: "5.00",
    unitVariants: [{ unit: "5 kg", conversionFactor: 5, salePrice: "450.00" }],
  });
  ghee = await createItem(db, business.id, {
    name: "Ghee 1L",
    unit: "pcs",
    salePrice: "620.00",
    purchasePrice: "540.00",
    taxPercent: "18.00",
    taxInclusive: true,
  });
  tee = await createItem(db, business.id, { name: "Tee", unit: "pcs", itemMode: "variants", salePrice: null, purchasePrice: null });
  const [variant] = await db.insert(itemVariants).values({
    itemId: tee.id,
    attributeValues: { Size: "M" },
    salePrice: "300.00",
    stockQuantity: "10.000",
  }).returning();
  teeVariantId = variant!.id;
  foreign = await createItem(db, otherBusiness.id, { name: "Foreign Item", salePrice: "10.00" });

  asOwner = caller(owner, tenant, business);
  asManager = caller(manager, tenant, business);
  asSeller = caller(seller, tenant, business);
  asAccountant = caller(accountant, tenant, business);
  asAgent = caller(owner, tenant, business, { "x-hisaabo-agent": "webmcp" });
  asStranger = caller(stranger, otherTenant, otherBusiness);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("item.updatePricesFromDocument — happy paths", () => {
  it("updates a sale price and a purchase price, and records audit rows with old/new price and the source bill", async () => {
    const sale = await makeSaleInvoice([{ itemId: ghee.id, unitPrice: "600" }]);

    const result = await asOwner.item.updatePricesFromDocument({
      documentId: sale.id,
      updates: [{ itemId: ghee.id, side: "sale", newPrice: "600" }],
    });
    expect(result.documentId).toBe(sale.id);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({ itemId: ghee.id, side: "sale", oldPrice: "620.00", newPrice: "600.00" });
    expect(result.unchanged).toEqual([]);

    const after = await freshItem(ghee.id);
    expect(after.salePrice).toBe("600.00");
    expect(after.purchasePrice).toBe("540.00"); // the other side is untouched
    expect(after.taxInclusive).toBe(true); // the basis flag is never changed by this feature

    const [audit] = await auditRowsFor(ghee.id);
    expect(audit).toBeDefined();
    expect(audit!.businessId).toBe(business.id);
    expect(audit!.userId).toBe(owner.id);
    expect(audit!.entityType).toBe("item");
    expect(JSON.parse(audit!.metadata as string)).toMatchObject({
      itemId: ghee.id,
      side: "sale",
      oldPrice: "620.00",
      newPrice: "600.00",
      documentId: sale.id,
      documentNumber: sale.invoiceNumber,
      documentType: "invoice",
    });

    // purchase side, from a purchase bill
    const purchase = await asOwner.invoice.create({
      partyId: supplier.id,
      type: "purchase",
      lineItems: [{ itemId: ghee.id, itemName: "Ghee 1L", quantity: "2", unitPrice: "560", taxPercent: "18" }],
    } as never);
    const bought = await asOwner.item.updatePricesFromDocument({
      documentId: purchase.id,
      updates: [{ itemId: ghee.id, side: "purchase", newPrice: "560" }],
    });
    expect(bought.updated[0]).toMatchObject({ side: "purchase", oldPrice: "540.00", newPrice: "560.00" });
    expect((await freshItem(ghee.id)).purchasePrice).toBe("560.00");
    expect((await freshItem(ghee.id)).salePrice).toBe("600.00");
  });

  it("a seller_manager (who has Item:update) may update prices", async () => {
    const res = await asManager.item.updatePricesFromDocument({ updates: [{ itemId: rice.id, side: "sale", newPrice: "92" }] });
    expect(res.updated[0]).toMatchObject({ oldPrice: "90.00", newPrice: "92.00" });
    expect((await freshItem(rice.id)).salePrice).toBe("92.00");
  });

  it("updates an alternate unit's own price and leaves the base price and other units alone", async () => {
    const res = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: rice.id, unit: "5 kg", side: "sale", newPrice: "480" }],
    });
    expect(res.updated[0]).toMatchObject({ unit: "5 kg", label: "Basmati Rice (5 kg)", oldPrice: "450.00", newPrice: "480.00" });
    const after = await freshItem(rice.id);
    expect(after.unitVariants).toEqual([{ unit: "5 kg", conversionFactor: 5, salePrice: "480.00" }]);
    expect(after.salePrice).toBe("92.00");
  });

  it("sets a first purchase price on an alternate unit that had none (old price null)", async () => {
    const res = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: rice.id, unit: "5 kg", side: "purchase", newPrice: "340" }],
    });
    expect(res.updated[0]).toMatchObject({ oldPrice: null, newPrice: "340.00" });
    const after = await freshItem(rice.id);
    expect(after.unitVariants).toEqual([{ unit: "5 kg", conversionFactor: 5, salePrice: "480.00", purchasePrice: "340.00" }]);
  });

  it("updates a product variant's price (audited as an itemVariant)", async () => {
    const res = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: tee.id, variantId: teeVariantId, side: "sale", newPrice: "320" }],
    });
    expect(res.updated[0]).toMatchObject({ variantId: teeVariantId, label: "Tee (M)", oldPrice: "300.00", newPrice: "320.00" });
    const db = getTenantTestDb();
    const [v] = await db.select().from(itemVariants).where(eq(itemVariants.id, teeVariantId));
    expect(v!.salePrice).toBe("320.00");
    const [audit] = await auditRowsFor(teeVariantId);
    expect(audit!.entityType).toBe("itemVariant");
  });

  it("converts a price stated in the other tax basis at the item's GST rate", async () => {
    // ghee stores GST-inclusive prices; 500 ex-GST at 18% is 590 inclusive
    const res = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: ghee.id, side: "sale", newPrice: "500", priceIncludesTax: false }],
    });
    expect(res.updated[0]!.newPrice).toBe("590.00");
    expect((await freshItem(ghee.id)).salePrice).toBe("590.00");
  });

  it("only SALE prices can include tax: a purchase price is stored tax-exclusive, whatever the item's flag", async () => {
    // ghee is flagged "price includes tax" (18%). A purchase price stated INCLUDING tax is converted down:
    // 11800 x 100 / 118 = 10000 -> 100.00
    const incl = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: ghee.id, side: "purchase", newPrice: "118", priceIncludesTax: true }],
    });
    expect(incl.updated[0]!.newPrice).toBe("100.00");
    // stated tax-exclusive (the only basis a purchase bill has): stored as it is, no conversion
    const excl = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: ghee.id, side: "purchase", newPrice: "95.50", priceIncludesTax: false }],
    });
    expect(excl.updated[0]!.newPrice).toBe("95.50");
    expect((await freshItem(ghee.id)).purchasePrice).toBe("95.50");
    // and the exact conversion back for a sale price: 10500 x 118 / 100 = 12390 -> 123.90
    const sale = await asOwner.item.updatePricesFromDocument({
      updates: [{ itemId: ghee.id, side: "sale", newPrice: "105", priceIncludesTax: false }],
    });
    expect(sale.updated[0]!.newPrice).toBe("123.90");
  });

  it("stamps the audit row with the caller's source (a browser agent)", async () => {
    await asAgent.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "purchase", newPrice: "570" }] });
    const rows = await auditRowsFor(ghee.id);
    expect(rows.some((r) => r.source === "webmcp")).toBe(true);
  });
});

describe("item.updatePricesFromDocument — idempotent", () => {
  it("a second identical call changes and logs nothing", async () => {
    const [before] = await Promise.all([auditRowsFor(rice.id)]);
    const first = await asOwner.item.updatePricesFromDocument({ updates: [{ itemId: rice.id, side: "sale", newPrice: "95" }] });
    expect(first.updated).toHaveLength(1);
    const afterFirst = await auditRowsFor(rice.id);
    expect(afterFirst.length).toBe(before.length + 1);

    const again = await asOwner.item.updatePricesFromDocument({ updates: [{ itemId: rice.id, side: "sale", newPrice: "95.00" }] });
    expect(again.updated).toEqual([]);
    expect(again.unchanged).toHaveLength(1);
    expect((await auditRowsFor(rice.id)).length).toBe(afterFirst.length);
  });

  it("two concurrent calls leave one consistent price and one audit row per real change", async () => {
    const before = (await auditRowsFor(ghee.id)).length;
    const results = await Promise.all([
      asOwner.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "sale", newPrice: "610" }] }),
      asManager.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "sale", newPrice: "610" }] }),
    ]);
    expect(results.flatMap((r) => r.updated)).toHaveLength(1);
    expect(results.flatMap((r) => r.unchanged)).toHaveLength(1);
    expect((await freshItem(ghee.id)).salePrice).toBe("610.00");
    expect((await auditRowsFor(ghee.id)).length).toBe(before + 1);
  });
});

describe("item.updatePricesFromDocument — permissions", () => {
  it("refuses a seller (no Item:update) and changes nothing", async () => {
    const before = (await freshItem(ghee.id)).salePrice;
    const audits = (await auditRowsFor(ghee.id)).length;
    await expect(
      asSeller.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "sale", newPrice: "1" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await freshItem(ghee.id)).salePrice).toBe(before);
    expect((await auditRowsFor(ghee.id)).length).toBe(audits);
  });

  it("refuses an accountant (read-only on items)", async () => {
    await expect(
      asAccountant.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "sale", newPrice: "1" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("item.updatePricesFromDocument — business isolation", () => {
  it("refuses an item of another business, and the whole request is rolled back", async () => {
    const before = (await freshItem(ghee.id)).salePrice;
    await expect(
      asOwner.item.updatePricesFromDocument({
        updates: [
          { itemId: ghee.id, side: "sale", newPrice: "1.00" }, // valid, comes first
          { itemId: foreign.id, side: "sale", newPrice: "2.00" },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await freshItem(ghee.id)).salePrice).toBe(before);
    expect((await freshItem(foreign.id)).salePrice).toBe("10.00");
  });

  it("refuses to be driven from another business's bill or by another business's user", async () => {
    const sale = await makeSaleInvoice([{ itemId: ghee.id, unitPrice: "605" }]);
    // the stranger cannot see this business's bill ...
    await expect(
      asStranger.item.updatePricesFromDocument({
        documentId: sale.id,
        updates: [{ itemId: foreign.id, side: "sale", newPrice: "3" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // ... nor this business's item
    await expect(
      asStranger.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "sale", newPrice: "3" }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a variant that belongs to a different item", async () => {
    await expect(
      asOwner.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, variantId: teeVariantId, side: "sale", newPrice: "5" }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("item.updatePricesFromDocument — validation", () => {
  it("rejects a variant item without a chosen variant, an unknown unit, a zero price and duplicates", async () => {
    await expect(
      asOwner.item.updatePricesFromDocument({ updates: [{ itemId: tee.id, side: "sale", newPrice: "5" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asOwner.item.updatePricesFromDocument({ updates: [{ itemId: rice.id, unit: "10 kg", side: "sale", newPrice: "5" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asOwner.item.updatePricesFromDocument({ updates: [{ itemId: ghee.id, side: "sale", newPrice: "0" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asOwner.item.updatePricesFromDocument({
        updates: [
          { itemId: ghee.id, side: "sale", newPrice: "5" },
          { itemId: ghee.id, side: "sale", newPrice: "6" },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a soft-deleted item", async () => {
    const db = getTenantTestDb();
    const gone = await createItem(db, business.id, { name: "Gone", deletedAt: new Date() });
    await expect(
      asOwner.item.updatePricesFromDocument({ updates: [{ itemId: gone.id, side: "sale", newPrice: "5" }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("checks the source bill: its side, and that it is a document that sets prices", async () => {
    const sale = await makeSaleInvoice([{ itemId: ghee.id, unitPrice: "600" }]);
    await expect(
      asOwner.item.updatePricesFromDocument({ documentId: sale.id, updates: [{ itemId: ghee.id, side: "purchase", newPrice: "5" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const quote = await asOwner.quotation.create({
      partyId: customer.id,
      type: "sale",
      lineItems: [{ itemId: ghee.id, itemName: "Ghee 1L", quantity: "1", unitPrice: "100", taxPercent: "0" }],
    } as never);
    await expect(
      asOwner.item.updatePricesFromDocument({ documentId: quote.id, updates: [{ itemId: ghee.id, side: "sale", newPrice: "100" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      asOwner.item.updatePricesFromDocument({
        documentId: "99999999-9999-4999-8999-999999999999",
        updates: [{ itemId: ghee.id, side: "sale", newPrice: "5" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("item.updatePricesFromDocument — the bill is unaffected", () => {
  it("a failed price update leaves the saved bill, its lines and its totals exactly as they were", async () => {
    const sale = await makeSaleInvoice([{ itemId: ghee.id, unitPrice: "640", quantity: "2" }]);
    const db = getTenantTestDb();
    const linesBefore = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, sale.id));
    const [billBefore] = await db.select().from(invoices).where(eq(invoices.id, sale.id));

    // refused: a seller cannot do it ...
    await expect(
      asSeller.item.updatePricesFromDocument({ documentId: sale.id, updates: [{ itemId: ghee.id, side: "sale", newPrice: "640" }] }),
    ).rejects.toBeDefined();
    // ... and an update naming a foreign item fails as a whole
    await expect(
      asOwner.item.updatePricesFromDocument({ documentId: sale.id, updates: [{ itemId: foreign.id, side: "sale", newPrice: "640" }] }),
    ).rejects.toBeDefined();

    const linesAfter = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, sale.id));
    const [billAfter] = await db.select().from(invoices).where(eq(invoices.id, sale.id));
    expect(billAfter).toEqual(billBefore);
    expect(linesAfter).toEqual(linesBefore);
    expect(linesAfter).toHaveLength(1);
    expect(linesAfter[0]!.unitPrice).toBe("640.00");
  });

  it("a successful price update does not touch the bill that prompted it (history stays the prices actually billed)", async () => {
    const sale = await makeSaleInvoice([{ itemId: ghee.id, unitPrice: "650" }]);
    const db = getTenantTestDb();
    const [before] = await db.select().from(invoices).where(eq(invoices.id, sale.id));
    await asOwner.item.updatePricesFromDocument({ documentId: sale.id, updates: [{ itemId: ghee.id, side: "sale", newPrice: "650" }] });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, sale.id));
    expect(after).toEqual(before);

    // item.priceHistory is derived from the (non-draft) bill lines: it still shows 650 for this bill
    await asOwner.invoice.updateStatus({ id: sale.id, status: "sent" });
    const history = await asOwner.item.priceHistory({ id: ghee.id, period: "all", limit: 50 });
    expect(history.some((h) => h.invoiceId === sale.id && h.unitPrice === "650.00")).toBe(true);
  });
});
