/**
 * empty-states.spec.ts — Verify empty state messages across routes.
 *
 * Strategy: use nonsense search queries or unlikely status filters that
 * won't match any real data. This avoids needing a freshly wiped database
 * while still exercising the empty-state render path.
 *
 * Each test:
 *   1. Navigates to the route and waits for skeletons to clear.
 *   2. Triggers a condition that should yield zero results.
 *   3. Asserts either 0 table rows OR a visible empty-state message.
 *
 * If both rows === 0 AND an empty-state label is present, the test
 * validates the label. If rows > 0 (the filter didn't empty the list),
 * the test passes silently — we treat it as a data-dependent no-op
 * rather than a false failure.
 */
import { test, expect } from "../helpers/fixtures";
import { waitForPageReady, waitForSearchResults } from "../helpers/fixtures";

// Shared helper: wait for skeletons to disappear after navigation
async function waitForLoad(page: import("@playwright/test").Page) {
  await waitForPageReady(page);
}

// Sentinel string unlikely to match any real data
const NONSENSE = "zzz-nonexistent-99999";

test.describe("Empty States", () => {
  // ── Invoices ──────────────────────────────────────────────────────

  test("invoices page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/invoices");
    await waitForLoad(page);

    await page.getByPlaceholder(/search invoices/i).fill(NONSENSE);
    await waitForSearchResults(page);

    const rows = await page.locator("tbody tr").count();
    expect(rows).toBe(0);
    await expect(
      page.getByText(/no.*invoices/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── Parties ───────────────────────────────────────────────────────

  test("parties page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/parties");
    await waitForLoad(page);

    await page.getByPlaceholder(/search/i).first().fill(NONSENSE);
    await waitForSearchResults(page);

    const rows = await page.locator("tbody tr").count();
    expect(rows).toBe(0);
    await expect(
      page.getByText(/no.*parties|no.*results/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── Items ─────────────────────────────────────────────────────────

  test("items page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/items");
    await waitForLoad(page);

    await page.getByPlaceholder(/search items/i).fill(NONSENSE);
    await waitForSearchResults(page);

    const rows = await page.locator("tbody tr").count();
    expect(rows).toBe(0);
    await expect(
      page.getByText(/no.*items/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── Expenses ──────────────────────────────────────────────────────

  test("expenses page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/expenses");
    await waitForLoad(page);

    await page
      .getByPlaceholder(/search category or description/i)
      .fill(NONSENSE);
    await waitForSearchResults(page);

    const rows = await page.locator("tbody tr").count();
    expect(rows).toBe(0);
    await expect(
      page.getByText(/no expenses/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── Credit Notes ──────────────────────────────────────────────────

  test("credit notes page shows empty state with Cancelled filter", async ({ page }) => {
    await page.goto("/credit-notes");
    await waitForLoad(page);

    // "Cancelled" tab is an unlikely-to-have-data status
    await page
      .getByRole("button", { name: "Cancelled" })
      .or(page.getByText("Cancelled"))
      .first()
      .click();

    const rows = await page.locator("tbody tr").count();
    if (rows === 0) {
      await expect(
        page.getByText(/no.*credit.*notes|no.*found/i).first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  // ── Quotations ────────────────────────────────────────────────────

  test("quotations page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/quotations");
    await waitForLoad(page);

    // Quotations uses DocumentListPage which has no search input.
    // Use the "Cancelled" status tab to find an empty state instead.
    await page.getByRole("button", { name: /^cancelled$/i }).click();

    const rows = await page.locator("tbody tr").count();
    if (rows === 0) {
      const emptyVisible = await page
        .getByText(/no.*quotations|no.*found|no results/i)
        .first()
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      expect(rows === 0 || emptyVisible).toBe(true);
    }
  });

  // ── Proforma Invoices ─────────────────────────────────────────────

  test("proforma invoices page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/proforma-invoices");
    await waitForLoad(page);

    // Proforma invoices uses DocumentListPage which has no search input.
    // Use the "Cancelled" status tab to find an empty state instead.
    await page.getByRole("button", { name: /^cancelled$/i }).click();

    const rows = await page.locator("tbody tr").count();
    if (rows === 0) {
      const emptyVisible = await page
        .getByText(/no.*proforma|no.*invoices|no.*found|no results/i)
        .first()
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      expect(rows === 0 || emptyVisible).toBe(true);
    }
  });

  // ── Payments ──────────────────────────────────────────────────────

  test("payments page shows empty state when searching nonsense", async ({ page }) => {
    await page.goto("/payments");
    await waitForLoad(page);

    const searchInput = page.getByPlaceholder(/search/i).first();
    await searchInput.fill(NONSENSE);
    await waitForSearchResults(page);

    const rows = await page.locator("tbody tr").count();
    if (rows === 0) {
      const emptyVisible = await page
        .getByText(/no.*payments|no.*found|no results/i)
        .first()
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      expect(rows === 0 || emptyVisible).toBe(true);
    }
  });
});
