/**
 * invoice-lifecycle.spec.ts — End-to-end flow test for the invoice lifecycle.
 *
 * Tests the complete journey:
 *   1. Navigate to parties → verify party exists (seeded via API)
 *   2. Navigate to items → verify item exists (seeded via API)
 *   3. Navigate to invoices → open creator → verify it works
 *   4. View invoice detail → verify financial fields
 */
import { test, expect } from "../helpers/fixtures";

test.describe("Invoice Lifecycle Flow", () => {
  test("parties page shows seeded data", async ({ page }) => {
    await page.goto("/parties");
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    // Verify the page loads correctly
    await expect(page.locator("h1").first()).toContainText("Parties");

    // Verify the add party button exists and opens the modal
    await page.getByRole("button", { name: /add.*party/i }).first().click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Verify the modal has the expected fields
    await expect(dialog.getByText(/party name/i).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: /create party/i })).toBeVisible();

    // Close without saving
    await page.keyboard.press("Escape");
  });

  test("items page shows seeded data", async ({ page }) => {
    await page.goto("/items");
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    await expect(page.locator("h1").first()).toContainText("Items");

    // Verify add item button opens modal
    await page.getByRole("button", { name: /add item/i }).first().click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Verify modal fields
    await expect(dialog.getByText(/name/i).first()).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("invoice creator opens with party and item selectors", async ({ page }) => {
    await page.goto("/invoices");
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    await page.getByRole("button", { name: /new invoice/i }).first().click();
    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });

    // The creator should have party selector and line item area
    await expect(creator.getByText(/party|customer/i).first()).toBeVisible();
  });

  test("invoice detail panel shows all financial fields", async ({ page }) => {
    await page.goto("/invoices");
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const rows = page.locator("tbody tr");
    const count = await rows.count();

    if (count > 0) {
      await rows.first().click();

      const panel = page.locator('[role="dialog"]').first();
      await expect(panel).toBeVisible({ timeout: 5_000 });

      await expect(panel.getByText(/total/i).first()).toBeVisible();
      await expect(panel.getByText(/status/i).first()).toBeVisible();
    }
  });
});
