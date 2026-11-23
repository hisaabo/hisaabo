/**
 * store-order-inclusive.spec.ts — a REAL online-store order (the public POST /store/:slug/order) for an
 * item priced INCLUDING tax, then an edit of the invoice it created.
 *
 * Saved price ₹118.00 incl. 18% GST, 2 ordered:
 *   order total   2 x 118.00                      = 236.00   (taxable 200.00 + GST 36.00)
 *   invoice line  rate 100.00 (tax-exclusive), tax 36.00, total 236.00   (23600p x 100 / 118 = 20000p)
 *   edit qty 2 -> 3:  3 x 100.00 = 300.00 + GST 54.00 = 354.00   (before the fix the line held 118.00,
 *   and the edit re-taxed it: 3 x 118.00 + 63.72 = 417.72)
 */
import { test, expect } from "../helpers/fixtures";
import { loadSeed, SeedApi } from "../helpers/seed";
import { apiUrl } from "../helpers/worker";

test("a store order of a tax-inclusive item bills at the exclusive rate, and editing the invoice does not tax it twice", async () => {
  const { businessId } = loadSeed();
  const api = new SeedApi();
  const h = { "x-business-id": businessId };
  const ts = Date.now();
  const slug = `incl-${ts}`;

  const item = await api.mutate<{ id: string }>("item.create", {
    name: `Store Atta ${ts}`, itemType: "product", itemMode: "simple", unit: "pcs",
    salePrice: "118.00", taxPercent: "18.00", taxInclusive: true, stockQuantity: "50",
  }, h);
  await api.mutate("store.updateSettings", { storeEnabled: true, storeSlug: slug }, h);
  await api.mutate("store.bulkToggleItems", { itemIds: [item.id], storeEnabled: true }, h);

  // the public endpoint, as a customer's browser calls it (no cookie, no business header)
  const res = await fetch(`${apiUrl()}/store/${slug}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Store Buyer", customerPhone: "9876543210", items: [{ itemId: item.id, quantity: 2 }] }),
  });
  expect(res.status).toBe(201);
  const order = (await res.json()) as { orderNumber: string; totalAmount: string };
  expect(order.totalAmount).toBe("236.00");

  const orders = await api.query<{ data: Array<{ orderNumber: string; invoiceId: string; totalAmount: string }> }>(
    "store.listOrders", { search: order.orderNumber, page: 1, limit: 5 }, h,
  );
  const placed = orders.data.find((o) => o.orderNumber === order.orderNumber)!;
  expect(placed.totalAmount).toBe("236.00");

  const created = await api.query<{
    totalAmount: string; taxAmount: string; subtotal: string; source: string | null;
    lineItems: Array<{ itemId: string; itemName: string; quantity: string; unitPrice: string; taxPercent: string; discountPercent: string; taxAmount: string; totalAmount: string }>;
  }>("invoice.getById", { id: placed.invoiceId }, h);
  expect(created.source).toBe("online_store");
  expect([created.subtotal, created.taxAmount, created.totalAmount]).toEqual(["200.00", "36.00", "236.00"]);
  expect(created.lineItems[0]).toMatchObject({ unitPrice: "100.00", taxAmount: "36.00", totalAmount: "236.00" });

  // edit the quantity, as a shopkeeper would from the invoice form
  const l = created.lineItems[0]!;
  const edited = await api.mutate<{ totalAmount: string; taxAmount: string }>("invoice.update", {
    id: placed.invoiceId,
    lineItems: [{ itemId: l.itemId, itemName: l.itemName, quantity: "3", unitPrice: l.unitPrice, taxPercent: l.taxPercent, discountPercent: l.discountPercent }],
  }, h);
  expect([edited.taxAmount, edited.totalAmount]).toEqual(["54.00", "354.00"]);
});
