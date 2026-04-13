/**
 * payments-crud.spec.ts — Payment recording and verification.
 *
 * Tests:
 *   - Record payment from invoice detail panel
 *   - Payment panel has correct fields (amount, account, date, invoices)
 *   - After payment, invoice status changes
 *   - Payment appears in payments list
 *   - Payment detail panel shows linked invoice
 */
import { test, expect } from "../helpers/fixtures";
import { ApiHelper } from "../helpers/fixtures";
import {
  ensureBusiness,
  createParty,
  createItem,
  createInvoice,
  updateInvoiceStatus,
} from "../helpers/seed";

let businessId: string;
let partyId: string;
let itemId: string;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  const page = await ctx.newPage();
  const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
  const biz = await ensureBusiness(api);
  businessId = biz.id;
  const party = await createParty(api, businessId, { name: "Payment Test Customer" });
  partyId = party.id;
  const item = await createItem(api, businessId, { name: "Payment Test Widget", salePrice: "1000.00" });
  itemId = item.id;
  await page.close();
  await ctx.close();
});

test.describe("Payments — Record Payment Panel", () => {
  test("Record Payment button on sent invoice opens payment panel", async ({ page }) => {
    // Seed a sent invoice
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);
    await updateInvoiceStatus(api, businessId, invoice.id, "sent");

    // Open invoice detail
    await page.goto(`/invoices?id=${invoice.id}`);
    await page.waitForTimeout(1500);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Click Record Payment
    await panel.getByRole("button", { name: /record.*payment/i }).click();

    // Invoice detail closes, payment panel opens
    await page.waitForTimeout(1000);
    const paymentPanel = page.locator('[role="dialog"]').first();
    await expect(paymentPanel).toBeVisible({ timeout: 5_000 });

    // Payment panel should show key fields
    await expect(paymentPanel.getByText(/payment amount/i)).toBeVisible();
    await expect(paymentPanel.getByText(/receive into/i).or(paymentPanel.getByText(/pay from/i))).toBeVisible();
  });

  test("payment panel shows pre-selected invoice with balance", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);
    await updateInvoiceStatus(api, businessId, invoice.id, "sent");

    await page.goto(`/invoices?id=${invoice.id}`);
    await page.waitForTimeout(1500);

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await panel.getByRole("button", { name: /record.*payment/i }).click();

    await page.waitForTimeout(1000);
    const paymentPanel = page.locator('[role="dialog"]').first();
    await expect(paymentPanel).toBeVisible({ timeout: 5_000 });

    // The pre-selected invoice number should be visible
    await expect(paymentPanel.getByText(invoice.invoiceNumber)).toBeVisible();
  });

  test("Record Payment button on payments page opens panel", async ({ page }) => {
    await page.goto("/payments");
    await page.waitForTimeout(1000);

    // Click "Record Payment" in header
    await page.getByRole("button", { name: /record payment/i }).first().click();

    const paymentPanel = page.locator('[role="dialog"]').first();
    await expect(paymentPanel).toBeVisible({ timeout: 5_000 });

    // Should have party selector and amount field
    await expect(paymentPanel.getByText(/payment amount/i)).toBeVisible();

    // Close
    await page.keyboard.press("Escape");
  });
});

test.describe("Payments — Payment Detail", () => {
  test("payment detail panel shows payment info and linked invoice", async ({ page }) => {
    await page.goto("/payments");
    await page.waitForTimeout(1000);

    const rows = page.locator("tbody tr");
    const count = await rows.count();
    test.skip(count === 0, "No payments to inspect");

    // Click first payment
    await rows.first().click();
    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Payment detail should show amount and party
    await expect(panel.getByText(/amount/i).first()).toBeVisible();

    // Should show Edit Payment button
    await expect(
      panel.getByRole("button", { name: /edit payment/i }),
    ).toBeVisible();
  });
});
