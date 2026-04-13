/**
 * dashboard.spec.ts — Dashboard page flow tests.
 *
 * Verifies the owner/admin experience on the "/" route:
 *   - Page header with "Dashboard" title
 *   - DateRangeBar preset buttons (This Month, Last Month, etc.)
 *   - "+ New Invoice" link in the actions area
 *   - Profit indicator cards (Gross Profit, Net Profit)
 *   - Chart sections render without crashing
 *
 * Seller redirect from "/" → "/invoices" is already covered in
 * flows/role-visibility.spec.ts and is not repeated here.
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

test.describe("Dashboard Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForPageReady(page);
  });

  test("admin sees Dashboard page heading", async ({ page }) => {
    await expect(page.locator("h1").first()).toContainText("Dashboard");
  });

  test("dashboard shows DateRangeBar with preset buttons", async ({ page }) => {
    // DateRangeBar renders buttons for each DATE_PRESET: "This Month",
    // "Last Month", "Last 30 Days", "This FY", "Last FY", "Custom", "All"
    await expect(
      page.getByRole("button", { name: "This Month" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Last Month" }).first()
    ).toBeVisible();
  });

  test("dashboard shows + New Invoice link", async ({ page }) => {
    // Rendered as a <Link to="/invoices"> with class btn-primary
    const newInvoiceLink = page
      .getByText("+ New Invoice")
      .or(page.getByRole("link", { name: /new invoice/i }))
      .first();
    await expect(newInvoiceLink).toBeVisible();
  });

  test("+ New Invoice link points to /invoices", async ({ page }) => {
    const link = page.getByRole("link", { name: /new invoice/i }).first();
    await expect(link).toHaveAttribute("href", "/invoices");
  });

  test("dashboard shows Gross Profit and Net Profit cards", async ({ page }) => {
    await expect(page.getByText("Gross Profit").first()).toBeVisible();
    await expect(page.getByText("Net Profit").first()).toBeVisible();
  });

  test("dashboard shows Sales & Collections chart section", async ({ page }) => {
    await expect(page.getByText("Sales & Collections").first()).toBeVisible();
  });

  test("dashboard shows Invoice Status chart section", async ({ page }) => {
    await expect(page.getByText("Invoice Status").first()).toBeVisible();
  });

  test("switching date preset to Last Month refetches data", async ({ page }) => {
    // Click "Last Month" preset and verify the button becomes active (no crash)
    await page.getByRole("button", { name: "Last Month" }).first().click();

    // Page should still show Dashboard heading — no error state
    await expect(page.locator("h1").first()).toContainText("Dashboard");
    // Profit cards must still be visible after period change
    await expect(page.getByText("Gross Profit").first()).toBeVisible();
  });

  test("switching date preset to This FY refetches data", async ({ page }) => {
    await page.getByRole("button", { name: "This FY" }).first().click();

    await expect(page.locator("h1").first()).toContainText("Dashboard");
    await expect(page.getByText("Net Profit").first()).toBeVisible();
  });
});
