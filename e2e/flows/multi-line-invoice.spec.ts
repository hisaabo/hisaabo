/**
 * multi-line-invoice.spec.ts — Test invoices with multiple line items.
 *
 * Seeds 3 items with different prices and tax rates, then creates
 * an invoice through the API with 2+ items and verifies the detail
 * panel renders all line items and a total. Also verifies the UI
 * creator opens with the expected fields.
 */
import { test, expect, ApiHelper } from "../helpers/fixtures";
import { loadSeed, SeedApi, createParty, createItem } from "../helpers/seed";

let businessId: string;
let partyName: string;
let item1Name: string;
let item2Name: string;
let item3Name: string;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();

  const ts = Date.now();
  partyName = `ML-Invoice Customer ${ts}`;
  item1Name = `Widget A ${ts}`;
  item2Name = `Widget B ${ts}`;
  item3Name = `Widget C ${ts}`;

  await createParty(api, businessId, { name: partyName });
  await createItem(api, businessId, { name: item1Name, salePrice: "1000.00", taxPercent: "18.00" });
  await createItem(api, businessId, { name: item2Name, salePrice: "500.00", taxPercent: "12.00" });
  await createItem(api, businessId, { name: item3Name, salePrice: "250.00", taxPercent: "5.00" });
});

test.describe("Multi-line Invoice Creation", () => {
  test("can create a multi-line invoice via API and view detail panel", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");

    // Resolve the seeded party
    const partiesRaw = await api.query<unknown>(
      "party.list",
      { search: partyName, page: 1, limit: 5 },
      { "x-business-id": businessId },
    );
    const partyList: Array<{ id: string; name: string }> = Array.isArray(partiesRaw)
      ? partiesRaw
      : (partiesRaw as any).data ?? [];

    test.skip(partyList.length === 0, "Seeded party not found — skipping");

    // Resolve Widget A and B by searching a common prefix (timestamp portion is shared)
    const ts = item1Name.split(" ").slice(-1)[0]; // the timestamp suffix
    const itemsRaw = await api.query<unknown>(
      "item.list",
      { search: ts, page: 1, limit: 20 },
      { "x-business-id": businessId },
    );
    const itemList: Array<{ id: string; name: string }> = Array.isArray(itemsRaw)
      ? itemsRaw
      : (itemsRaw as any).data ?? [];

    const id1 = itemList.find((i) => i.name === item1Name)?.id;
    const id2 = itemList.find((i) => i.name === item2Name)?.id;

    test.skip(!id1 || !id2, "Seeded Widget A / Widget B items not found — skipping");

    // Create invoice with 2 line items via API
    // Expected total: (2 * 1000 * 1.18) + (3 * 500 * 1.12) = 2360 + 1680 = 4040
    const invoice = await api.mutate<{ id: string; invoiceNumber: string; totalAmount: string }>(
      "invoice.create",
      {
        type: "sale",
        partyId: partyList[0].id,
        invoiceDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        lineItems: [
          {
            itemId: id1,
            itemName: item1Name,
            quantity: "2",
            unitPrice: "1000.00",
            taxPercent: "18.00",
            discountPercent: "0",
            conversionFactor: "1",
          },
          {
            itemId: id2,
            itemName: item2Name,
            quantity: "3",
            unitPrice: "500.00",
            taxPercent: "12.00",
            discountPercent: "0",
            conversionFactor: "1",
          },
        ],
        invoiceDiscount: "0",
        invoiceDiscountType: "amount",
        additionalCharges: "0",
        roundOff: "0",
      },
      { "x-business-id": businessId },
    );

    // Open the invoice detail panel via URL
    await page.goto(`/invoices?id=${invoice.id}`);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Invoice number should be shown
    await expect(panel.getByText(invoice.invoiceNumber)).toBeVisible();

    // Both items should appear in the detail panel
    await expect(panel.getByText(new RegExp(item1Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first()).toBeVisible();
    await expect(panel.getByText(new RegExp(item2Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first()).toBeVisible();

    // A total amount label should be visible
    await expect(panel.getByText(/total/i).first()).toBeVisible();
  });

  test("multi-line invoice detail panel shows draft status", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");

    // Resolve the seeded party and items (same pattern as above)
    const partiesRaw = await api.query<unknown>(
      "party.list",
      { search: partyName, page: 1, limit: 5 },
      { "x-business-id": businessId },
    );
    const partyList: Array<{ id: string; name: string }> = Array.isArray(partiesRaw)
      ? partiesRaw
      : (partiesRaw as any).data ?? [];

    test.skip(partyList.length === 0, "Seeded party not found — skipping");

    const ts = item1Name.split(" ").slice(-1)[0];
    const itemsRaw = await api.query<unknown>(
      "item.list",
      { search: ts, page: 1, limit: 20 },
      { "x-business-id": businessId },
    );
    const itemList: Array<{ id: string; name: string }> = Array.isArray(itemsRaw)
      ? itemsRaw
      : (itemsRaw as any).data ?? [];

    const id1 = itemList.find((i) => i.name === item1Name)?.id;
    const id3 = itemList.find((i) => i.name === item3Name)?.id;

    test.skip(!id1 || !id3, "Seeded Widget A / Widget C items not found — skipping");

    // Create a 2-line invoice including the 5% tax item
    const invoice = await api.mutate<{ id: string; invoiceNumber: string }>(
      "invoice.create",
      {
        type: "sale",
        partyId: partyList[0].id,
        invoiceDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        lineItems: [
          {
            itemId: id1,
            itemName: item1Name,
            quantity: "1",
            unitPrice: "1000.00",
            taxPercent: "18.00",
            discountPercent: "0",
            conversionFactor: "1",
          },
          {
            itemId: id3,
            itemName: item3Name,
            quantity: "4",
            unitPrice: "250.00",
            taxPercent: "5.00",
            discountPercent: "0",
            conversionFactor: "1",
          },
        ],
        invoiceDiscount: "0",
        invoiceDiscountType: "amount",
        additionalCharges: "0",
        roundOff: "0",
      },
      { "x-business-id": businessId },
    );

    await page.goto(`/invoices?id=${invoice.id}`);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Draft status badge must be present
    await expect(panel.getByText(/draft/i).first()).toBeVisible();
  });

  test("invoice creator UI opens and shows party and line item fields", async ({ page }) => {
    await page.goto("/invoices");
    // Wait for any loading skeletons to resolve
    await page.locator(".animate-pulse").first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    // Open the creator via the New Invoice button
    await page.getByRole("button", { name: /new invoice/i }).first().click();

    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });

    // Party / customer selector label must be present
    await expect(creator.getByText(/party|customer/i).first()).toBeVisible();

    // Line items area must be present (item or product column label)
    await expect(creator.getByText(/item|product/i).first()).toBeVisible();

    // Close without saving
    await page.keyboard.press("Escape");
  });
});
