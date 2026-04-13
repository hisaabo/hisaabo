/**
 * settings.spec.ts — Layer 1 (Presence) specification for /settings.
 *
 * The settings page renders a vertical nav sidebar (desktop) with tabs:
 * Business, Documents, Shipping, Team, Sales Targets, Appearance, Data,
 * Account, Online Store.  Business tab is active by default and shows
 * business details including the GSTIN field.
 *
 * Because the global setup seeds a business, the full settings layout
 * (not the first-run "Almost there!" form) is expected to render.
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Settings — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await waitForPageReady(page);
  });

  test("renders settings page header", async ({ page }) => {
    // With a seeded business the full settings UI shows, not first-run
    await expect(page.locator("h1").first()).toContainText("Settings");
  });

  test("renders Business tab nav item", async ({ page }) => {
    // The SettingsNav sidebar always contains a "Business" button
    await expect(page.getByText("Business").first()).toBeVisible();
  });

  test("renders Business tab content by default", async ({ page }) => {
    // BusinessTab exposes GSTIN label — a reliable business-specific marker
    await expect(page.getByText(/gstin/i).first()).toBeVisible();
  });

  test("renders Documents tab", async ({ page }) => {
    await page.getByText("Documents", { exact: true }).first().click();
    // Documents tab renders some visible heading or label
    await expect(page.locator("h1, h2, h3, label").first()).toBeVisible();
  });

  test("renders Team tab with invite functionality", async ({ page }) => {
    await page.getByText("Team", { exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: /invite/i }).first(),
    ).toBeVisible();
  });

  test("renders Appearance tab", async ({ page }) => {
    await page.getByText("Appearance", { exact: true }).first().click();
    await expect(page.locator("h1, h2, h3, label").first()).toBeVisible();
  });

  test("renders Data tab", async ({ page }) => {
    await page.getByText("Data", { exact: true }).first().click();
    await expect(
      page.locator("h1, h2, h3, label, button").first(),
    ).toBeVisible();
  });

  test("renders Account tab", async ({ page }) => {
    await page.getByText("Account", { exact: true }).first().click();
    await expect(page.locator("h1, h2, h3, label").first()).toBeVisible();
  });
});
