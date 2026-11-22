/**
 * Scenario 16 — An online-store order for items priced INCLUDING tax, then edited.
 *
 * The store prices a line from the saved price. The ORDER total is on that inclusive price and does
 * not change; the invoice LINE holds the tax-exclusive rate (like any bill), so editing the invoice
 * later does not tax the price a second time (0.10.0 stored the inclusive price as `unit_price`, and
 * editing a quantity then added the GST on top again).
 *
 *   Order (intra-state walk-in, MH):
 *     #  item    saved price        qty  taxable          GST               line total   invoice rate
 *     1  Atta    118.00 incl. 18%    2   200.00           36.00             236.00       100.00   [23600p x 100 / 118 = 20000p]
 *     2  Oil      99.00 incl. 12%    1    88.39           10.61             99.00        88.39    [9900p x 100 / 112 = 8839.29 -> 8839p; GST 9900 - 8839 = 1061p]
 *     3  Steel   100.00 excl. 18%    1   100.00           18.00             118.00       100.00   (no conversion)
 *   subtotal 200.00 + 88.39 + 100.00 = 388.39    GST 36.00 + 10.61 + 18.00 = 64.61    total 453.00 = 236.00 + 99.00 + 118.00
 *
 *   Edit: Atta quantity 2 -> 3 (rates unchanged, the tax-exclusive maths every bill uses):
 *     Atta  3 x 100.00 = 300.00, GST 54.00 -> 354.00        Oil 88.39 + 10.61 = 99.00        Steel 100.00 + 18.00 = 118.00
 *     subtotal 300.00 + 88.39 + 100.00 = 488.39   GST 54.00 + 10.61 + 18.00 = 82.61   total 571.00 = 354.00 + 99.00 + 118.00
 *     (with the inclusive price kept as the rate, as before: 3 x 118.00 = 354.00 + 63.72 GST = 417.72 for Atta alone, a total of 634.72)
 *   CGST 2700 + 531 + 900 = 4131 = 41.31     SGST 2700 + 530 + 900 = 4130 = 41.30
 *   Ledger:  Dr 1100 571.00 / Cr 4000 488.39, Cr 2100 41.31, Cr 2101 41.30
 */
import { describe, it, expect, beforeAll } from "vitest";
import { invoices, invoiceItems } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { priceStoreOrderLines, type StoreOrderLineInput } from "../../../lib/store-order-pricing.js";
import { useGoldenDb, createGoldenWorld, addParty, book, tbRows, expectBooksBalance, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const line = (over: Partial<StoreOrderLineInput> & Pick<StoreOrderLineInput, "itemId" | "name" | "unitPrice" | "taxPercent" | "taxInclusive" | "quantity">): StoreOrderLineInput => ({
  discountPercent: "0",
  ...over,
});

describe("golden 16A: priceStoreOrderLines (the store handler's pricing)", () => {
  const ORDER: StoreOrderLineInput[] = [
    line({ itemId: "a", name: "Atta", quantity: "2", unitPrice: "118.00", taxPercent: "18.00", taxInclusive: true }),
    line({ itemId: "o", name: "Oil", quantity: "1", unitPrice: "99.00", taxPercent: "12.00", taxInclusive: true }),
    line({ itemId: "s", name: "Steel", quantity: "1", unitPrice: "100.00", taxPercent: "18.00", taxInclusive: false }),
  ];

  it("order totals are the inclusive totals, unchanged: 388.39 + 64.61 = 453.00", () => {
    const { totals } = priceStoreOrderLines(ORDER);
    expect([totals.subtotal, totals.taxTotal, totals.total]).toEqual(["388.39", "64.61", "453.00"]);
  });

  it("invoice lines hold the tax-exclusive rate and the exact inclusive line figures", () => {
    const { rows } = priceStoreOrderLines(ORDER);
    expect(rows.map((r) => [r.unitPrice, r.taxAmount, r.totalAmount])).toEqual([
      ["100.00", "36.00", "236.00"], // 23600p x 100 / 118 = 20000p
      ["88.39", "10.61", "99.00"], // 9900p x 100 / 112 = 8839.29 -> 8839p
      ["100.00", "18.00", "118.00"], // exclusive item: untouched
    ]);
  });

  it("alternate unit and variant prices convert the same way; a 0% line keeps the price", () => {
    const { rows } = priceStoreOrderLines([
      line({ itemId: "p", name: "Pack (box)", quantity: "1", unitPrice: "590.00", taxPercent: "18.00", taxInclusive: true, selectedUnit: "box", conversionFactor: "5" }), // 59000p x 100 / 118 = 50000p
      line({ itemId: "t", name: "Tee - M", quantity: "1", unitPrice: "236.00", taxPercent: "18.00", taxInclusive: true, variantId: "v1" }), // 23600p x 100 / 118 = 20000p
      line({ itemId: "z", name: "Exempt", quantity: "1", unitPrice: "118.00", taxPercent: "0", taxInclusive: true }),
    ]);
    expect(rows.map((r) => [r.unitPrice, r.totalAmount, r.selectedUnit, r.variantId])).toEqual([
      ["500.00", "590.00", "box", null],
      ["200.00", "236.00", null, "v1"],
      ["118.00", "118.00", null, null],
    ]);
  });
});

describe("golden 16B: the invoice made from the order, then edited", () => {
  let w: GoldenWorld;
  let invoiceId: string;
  let items: Record<string, string>;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = (await addParty(w, "customer", "MH")).id;
    const mk = (name: string, salePrice: string, taxPercent: string, taxInclusive: boolean) =>
      w.caller.item.create({
        name, itemType: "product", itemMode: "simple", unit: "pcs", salePrice, taxPercent, taxInclusive, stockQuantity: "100",
      } as never);
    items = {
      atta: (await mk("Atta", "118.00", "18", true)).id,
      oil: (await mk("Oil", "99.00", "12", true)).id,
      steel: (await mk("Steel", "100.00", "18", false)).id,
    };

    // exactly what the public store handler writes for this order
    const { totals, rows } = priceStoreOrderLines([
      line({ itemId: items.atta!, name: "Atta", quantity: "2", unitPrice: "118.00", taxPercent: "18.00", taxInclusive: true }),
      line({ itemId: items.oil!, name: "Oil", quantity: "1", unitPrice: "99.00", taxPercent: "12.00", taxInclusive: true }),
      line({ itemId: items.steel!, name: "Steel", quantity: "1", unitPrice: "100.00", taxPercent: "18.00", taxInclusive: false }),
    ]);
    const db = getTenantTestDb();
    const [inv] = await db.insert(invoices).values({
      businessId: w.businessId, partyId: customer, type: "sale", status: "unfulfilled", documentType: "invoice",
      invoiceNumber: "INV-STORE-1", invoiceDate: new Date("2025-06-10T10:00:00.000Z"),
      subtotal: totals.subtotal, taxAmount: totals.taxTotal, discountAmount: "0", additionalCharges: "0", roundOff: "0",
      totalAmount: totals.total, amountPaid: "0", source: "online_store",
    }).returning();
    invoiceId = inv!.id;
    await db.insert(invoiceItems).values(rows.map((r, i) => ({ ...r, invoiceId, sortOrder: i })));
  });

  it("as created: the invoice carries the order total, 453.00, with rates 100.00 / 88.39 / 100.00", async () => {
    const inv = (await w.caller.invoice.getById({ id: invoiceId }))!;
    expect([inv.subtotal, inv.taxAmount, inv.totalAmount]).toEqual(["388.39", "64.61", "453.00"]);
    expect(inv.lineItems.map((l) => [l.unitPrice, l.quantity, l.totalAmount])).toEqual([
      ["100.00", "2.000", "236.00"],
      ["88.39", "1.000", "99.00"],
      ["100.00", "1.000", "118.00"],
    ]);
  });

  it("editing a quantity does not tax the price twice: Atta 2 -> 3 gives 354.00, order total 571.00", async () => {
    const before = (await w.caller.invoice.getById({ id: invoiceId }))!;
    await w.caller.invoice.update({
      id: invoiceId,
      lineItems: before.lineItems.map((l) => ({
        itemId: l.itemId ?? undefined, itemName: l.itemName, quantity: l.itemName === "Atta" ? "3" : l.quantity,
        unitPrice: l.unitPrice, taxPercent: l.taxPercent, discountPercent: l.discountPercent,
      })),
    });
    const inv = (await w.caller.invoice.getById({ id: invoiceId }))!;
    expect([inv.subtotal, inv.taxAmount, inv.totalAmount]).toEqual(["488.39", "82.61", "571.00"]);
    expect(inv.lineItems.map((l) => [l.taxAmount, l.totalAmount])).toEqual([
      ["54.00", "354.00"], // 3 x 100.00 = 300.00 + 18%
      ["10.61", "99.00"],
      ["18.00", "118.00"],
    ]);
  });

  it("ledger: Dr 1100 571.00 / Cr 4000 488.39, CGST 41.31, SGST 41.30", async () => {
    await w.caller.invoice.updateStatus({ id: invoiceId, status: "sent" });
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "571.00", "0.00"],
      ["2100", "0.00", "41.31"], // 27.00 + 5.31 + 9.00
      ["2101", "0.00", "41.30"], // 27.00 + 5.30 + 9.00
      ["4000", "0.00", "488.39"],
    ]);
    expectBooksBalance(b);
  });
});

describe("golden 16C: store invoices made BEFORE this fix are not changed", () => {
  it("an old-style row (unit_price = the inclusive price, inclusive totals) is read back exactly as stored", async () => {
    const w = await createGoldenWorld();
    const customer = (await addParty(w, "customer", "MH")).id;
    const db = getTenantTestDb();
    const [inv] = await db.insert(invoices).values({
      businessId: w.businessId, partyId: customer, type: "sale", status: "unfulfilled", documentType: "invoice",
      invoiceNumber: "INV-OLD-1", invoiceDate: new Date("2025-06-10T10:00:00.000Z"),
      subtotal: "100.00", taxAmount: "18.00", discountAmount: "0", additionalCharges: "0", roundOff: "0",
      totalAmount: "118.00", amountPaid: "0", source: "online_store",
    }).returning();
    await db.insert(invoiceItems).values({
      invoiceId: inv!.id, itemName: "Atta", description: null, quantity: "1", unitPrice: "118.00", taxPercent: "18.00",
      taxAmount: "18.00", discountPercent: "0", totalAmount: "118.00", sortOrder: 0, conversionFactor: "1",
    });
    const got = (await w.caller.invoice.getById({ id: inv!.id }))!;
    // no migration touched it: still the inclusive unit price and the inclusive total
    expect([got.totalAmount, got.lineItems[0]!.unitPrice, got.lineItems[0]!.totalAmount]).toEqual(["118.00", "118.00", "118.00"]);
  });
});
