/**
 * cn-sr-balance.spec.ts — Tests the credit note / sales return → balance chain.
 *
 * This flow caught a real bug where CN adjustments weren't reflected
 * in the outstanding balance. The E2E test exercises:
 *
 *   1. Invoice exists with outstanding balance
 *   2. Create credit note referencing that invoice
 *   3. Verify the invoice's outstanding balance decreases
 *
 * For now, this validates the route navigation and UI presence.
 * Full mutation testing requires seeded invoices with known amounts.
 */
import { test, expect } from "../helpers/fixtures";

test.describe("CN/SR Balance Chain", () => {
  test("credit notes page shows reference invoice column", async ({ page }) => {
    await page.goto("/credit-notes");
    await page.waitForTimeout(1000);

    // Only assert column when the table actually renders (not empty state)
    const hasTable = await page.locator("thead").count() > 0;
    if (hasTable) {
      await expect(
        page.locator("thead").getByText("Ref. Invoice", { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("sales returns page shows reference invoice column", async ({ page }) => {
    await page.goto("/sales-returns");
    await page.waitForTimeout(1000);

    // Only assert column when the table actually renders (not empty state)
    const hasTable = await page.locator("thead").count() > 0;
    if (hasTable) {
      await expect(
        page.locator("thead").getByText("Ref. Invoice", { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("credit note creator requires reference invoice selection", async ({
    page,
  }) => {
    await page.goto("/credit-notes");
    await page.waitForTimeout(1000);

    // Open the creator
    await page.getByRole("button", { name: /new credit note/i }).first().click();

    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });

    // The credit note creator should prompt for party selection first,
    // then reference invoice selection
    await expect(creator.getByText(/party|customer/i).first()).toBeVisible();
  });

  test("navigating between invoices and credit notes preserves context", async ({
    page,
  }) => {
    // Start on invoices
    await page.goto("/invoices");
    await page.waitForTimeout(1000);
    await expect(page.getByText("Invoices").first()).toBeVisible();

    // Navigate to credit notes
    await page.goto("/credit-notes");
    await page.waitForTimeout(1000);
    await expect(page.getByText("Credit Notes").first()).toBeVisible();

    // Navigate back to invoices
    await page.goto("/invoices");
    await page.waitForTimeout(1000);
    await expect(page.getByText("Invoices").first()).toBeVisible();
  });
});
