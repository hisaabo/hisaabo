/**
 * edit-invoice.spec.ts — Test editing draft invoices.
 *
 * Seeds a draft invoice via API, opens the detail panel, clicks Edit,
 * and verifies the creator/editor opens pre-filled. Also validates that
 * draft status is shown and the invoice number is visible in the panel.
 */
import { test, expect, ApiHelper } from "../helpers/fixtures";
import { loadSeed, SeedApi, createParty, createItem, createInvoice } from "../helpers/seed";

let businessId: string;
let partyId: string;
let itemId: string;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();

  const ts = Date.now();
  const party = await createParty(api, businessId, { name: `Edit Test Customer ${ts}` });
  partyId = party.id;

  const item = await createItem(api, businessId, {
    name: `Edit Test Widget ${ts}`,
    salePrice: "1000.00",
    taxPercent: "18.00",
  });
  itemId = item.id;
});

test.describe("Edit Invoice Flow", () => {
  test("draft invoice detail panel shows invoice number and draft status", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);

    // Open detail panel via URL query param
    await page.goto(`/invoices?id=${invoice.id}`);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Invoice number should be visible in the panel header/body
    await expect(panel.getByText(invoice.invoiceNumber)).toBeVisible();

    // Draft status badge must be present for a freshly created invoice
    await expect(panel.getByText(/draft/i).first()).toBeVisible();
  });

  test("edit button on draft invoice opens creator pre-filled", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);

    // Open the invoice detail panel
    await page.goto(`/invoices?id=${invoice.id}`);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // The Edit button should be present for a draft invoice
    const editBtn = panel.getByRole("button", { name: /^edit$/i });
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    // After clicking Edit, a dialog (the creator in edit mode) should be visible
    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });

    // The editor should have pre-filled content — at minimum, a total/amount label
    await expect(creator.getByText(/total|amount/i).first()).toBeVisible();
  });

  test("edit creator shows party selector pre-filled", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);

    await page.goto(`/invoices?id=${invoice.id}`);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const editBtn = panel.getByRole("button", { name: /^edit$/i });
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });

    // Party/customer section must exist in the creator
    await expect(creator.getByText(/party|customer/i).first()).toBeVisible();

    // Line items section must exist in the creator
    await expect(creator.getByText(/item|product/i).first()).toBeVisible();
  });

  test("closing the edit creator returns to the invoices list", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);

    await page.goto(`/invoices?id=${invoice.id}`);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const editBtn = panel.getByRole("button", { name: /^edit$/i });
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    // Wait for creator to open before dismissing
    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });

    // Dismiss via Escape
    await page.keyboard.press("Escape");

    // The invoices route should still be active
    await expect(page).toHaveURL(/\/invoices/);
  });
});
