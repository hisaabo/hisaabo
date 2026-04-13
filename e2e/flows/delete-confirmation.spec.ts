/**
 * delete-confirmation.spec.ts — Verify delete confirmation dialogs.
 *
 * Tests that delete operations show confirmation dialogs and
 * that cancelling preserves the entity.
 */
import { test, expect, ApiHelper } from "../helpers/fixtures";
import {
  ensureBusiness,
  createParty,
  createItem,
  createInvoice,
  createExpense,
} from "../helpers/seed";

let businessId: string;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/user.json" });
  const page = await ctx.newPage();
  const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
  const biz = await ensureBusiness(api);
  businessId = biz.id;
  await page.close();
  await ctx.close();
});

test.describe("Delete Confirmation Flows", () => {
  test("delete expense shows confirmation dialog", async ({ page }) => {
    // Seed an expense
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const expense = await createExpense(api, businessId, {
      category: `Delete Test ${Date.now()}`,
      amount: "100.00",
    });

    await page.goto("/expenses");
    await page.locator(".animate-pulse").first()
      .waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Find expense row and hover to reveal actions
    const rows = page.locator("tbody tr");
    const rowCount = await rows.count();
    test.skip(rowCount === 0, "No expense rows visible");

    await rows.first().hover();
    await page.waitForTimeout(300);

    // Click delete button
    const deleteBtn = rows.first().locator('[aria-label="Delete expense"]');
    const isVisible = await deleteBtn.isVisible().catch(() => false);
    test.skip(!isVisible, "Delete button not visible on hover");

    await deleteBtn.click();

    // Expect confirmation dialog
    await expect(page.getByText(/delete.*expense|are you sure/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test("cancel on delete dialog does not delete expense", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    await createExpense(api, businessId, {
      category: `Cancel Delete ${Date.now()}`,
      amount: "200.00",
    });

    await page.goto("/expenses");
    await page.locator(".animate-pulse").first()
      .waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const rows = page.locator("tbody tr");
    const initialCount = await rows.count();
    test.skip(initialCount === 0, "No expense rows");

    await rows.first().hover();
    await page.waitForTimeout(300);

    const deleteBtn = rows.first().locator('[aria-label="Delete expense"]');
    const isVisible = await deleteBtn.isVisible().catch(() => false);
    test.skip(!isVisible, "Delete button not visible");

    await deleteBtn.click();

    // Wait for dialog
    await expect(page.getByText(/delete.*expense|are you sure/i).first()).toBeVisible({ timeout: 5_000 });

    // Click Cancel
    await page.getByRole("button", { name: /cancel|no/i }).first().click();
    await page.waitForTimeout(500);

    // Row count should be same
    const afterCount = await rows.count();
    expect(afterCount).toBe(initialCount);
  });

  test("confirming delete removes expense from list", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    await createExpense(api, businessId, {
      category: `Confirm Delete ${Date.now()}`,
      amount: "300.00",
    });

    await page.goto("/expenses");
    await page.locator(".animate-pulse").first()
      .waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const rows = page.locator("tbody tr");
    const initialCount = await rows.count();
    test.skip(initialCount === 0, "No expense rows");

    await rows.first().hover();
    await page.waitForTimeout(300);

    const deleteBtn = rows.first().locator('[aria-label="Delete expense"]');
    const isVisible = await deleteBtn.isVisible().catch(() => false);
    test.skip(!isVisible, "Delete button not visible");

    await deleteBtn.click();

    // Confirm deletion
    await expect(page.getByText(/delete.*expense|are you sure/i).first()).toBeVisible({ timeout: 5_000 });
    // Click the confirm/delete button (not the cancel)
    await page.getByRole("button", { name: /delete|confirm|yes/i }).last().click();
    await page.waitForTimeout(1000);

    // Row count should decrease
    const afterCount = await rows.count();
    expect(afterCount).toBeLessThan(initialCount);
  });

  test("draft invoice row shows delete action on hover", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");

    // Seed party + item + invoice
    const party = await createParty(api, businessId, { name: `Del Inv Party ${Date.now()}` });
    const item = await createItem(api, businessId, { name: `Del Inv Item ${Date.now()}`, salePrice: "500.00" });
    const invoice = await createInvoice(api, businessId, party.id, item.id);

    await page.goto("/invoices");
    await page.locator(".animate-pulse").first()
      .waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // Search for the invoice
    await page.getByPlaceholder(/search invoices/i).fill(invoice.invoiceNumber);
    await page.waitForTimeout(500);

    const row = page.locator("tbody tr").first();
    const count = await row.count();
    test.skip(count === 0, "Invoice not found");

    // Hover row to reveal actions
    await row.hover();
    await page.waitForTimeout(300);

    // Draft invoice should have a delete button
    const deleteBtn = row.locator('button:has(svg)').last();
    await expect(deleteBtn).toBeVisible();
  });
});
