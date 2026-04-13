/**
 * gst.spec.ts — Layer 1 (Presence) specification for /gst.
 *
 * The GST / Tax Reports page adapts its title and tab labels based on whether
 * the active business is GST-registered:
 *   - GST-registered  → title "GST Returns", first tab "GSTR-1"
 *   - Unregistered    → title "Tax Reports",  first tab "Sales Report"
 *
 * The global setup seeds a business with gstin "27AABCU9603R1ZM" so the
 * GST-registered variant is expected.
 *
 * Tabs always present regardless of GST status:
 *   Profit & Loss, Trial Balance, Balance Sheet, Aging Report,
 *   Party Ledger, Tally Export.
 *
 * Period selector (month + year dropdowns) is visible when the GSTR-1 or
 * GSTR-3B tab is active (which is the default).
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("GST / Tax Reports — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/gst");
    await waitForPageReady(page);
  });

  test("renders page header", async ({ page }) => {
    // GST-registered business → "GST Returns"; fallback accepts either variant
    await expect(page.locator("h1").first()).toContainText(
      /GST Returns|Tax Reports/i,
    );
  });

  test("renders GSTR-1 tab for GST-registered business", async ({ page }) => {
    // The seeded business has a GSTIN, so the first tab must be "GSTR-1"
    await expect(page.getByText("GSTR-1").first()).toBeVisible();
  });

  test("renders always-present report tabs", async ({ page }) => {
    for (const tab of ["Profit & Loss", "Trial Balance", "Balance Sheet"]) {
      await expect(page.getByText(tab).first()).toBeVisible();
    }
  });

  test("renders period selector with current year", async ({ page }) => {
    // Month + year <select> elements are shown for GSTR-1 / GSTR-3B (default tab)
    const currentYear = new Date().getFullYear().toString();
    await expect(page.getByText(currentYear).first()).toBeVisible();
  });
});
