/**
 * cash-and-bank.spec.ts — Layer 1 (Presence) specification for /cash-and-bank.
 *
 * The page renders:
 *   - A PageHeader with title "Cash & Bank"
 *   - An "+ Add Account" button that opens the Add Bank Account modal
 *   - Stat cards for Cash in Hand and Bank Balance
 *   - An account list section (may be empty for a fresh test business)
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Cash & Bank — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cash-and-bank");
    await waitForPageReady(page);
  });

  test("renders page header", async ({ page }) => {
    // PageHeader title is "Cash & Bank"
    await expect(page.locator("h1").first()).toContainText(/cash|bank/i);
  });

  test("renders Add Account button", async ({ page }) => {
    // The top-right action is labeled "+ Add Account"
    await expect(
      page.getByRole("button", { name: /add.*account/i }).first(),
    ).toBeVisible();
  });

  test("renders account or balance section", async ({ page }) => {
    // Stat cards ("Cash in Hand", "Bank Balance") or account labels are always present
    await expect(page.getByText(/account|balance|cash/i).first()).toBeVisible();
  });
});
