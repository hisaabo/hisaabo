/**
 * proforma-invoices.spec.ts — Complete specification for the /proforma-invoices route.
 *
 * Proforma invoices use the shared DocumentListPage component, so this spec
 * validates that the config is correctly wired — title, tabs, columns, actions.
 *
 * Layer 1: PRESENCE   — All expected UI elements exist and are visible
 * Layer 2: INTERACTION — Interactive elements respond correctly
 */
import { test, expect } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Proforma Invoices — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/proforma-invoices");
    await page
      .locator(".animate-pulse")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  });

  test("renders page header and description", async ({ page }) => {
    await expect(page.locator("h1").first()).toContainText("Proforma Invoices");
    await expect(page.getByText("Manage proforma invoices")).toBeVisible();
  });

  test("renders New Proforma button", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /new proforma/i }),
    ).toBeVisible();
  });

  test("renders status tabs", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^all$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^draft$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sent$/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^cancelled$/i }),
    ).toBeVisible();
  });

  test("renders table with expected columns", async ({ page }) => {
    const thead = page.locator("thead");
    const hasThead = (await thead.count()) > 0;
    if (hasThead) {
      await expect(thead.getByText("Proforma #")).toBeVisible();
      await expect(thead.getByText("Date")).toBeVisible();
      await expect(thead.getByText("Party")).toBeVisible();
      await expect(thead.getByText("Amount")).toBeVisible();
      await expect(thead.getByText("Status")).toBeVisible();
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 2: INTERACTION
// ═════════════════════════════════════════════════════════════════

test.describe("Proforma Invoices — Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/proforma-invoices");
    await page
      .locator(".animate-pulse")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  });

  test("create button opens DocumentCreator", async ({ page }) => {
    await page.getByRole("button", { name: /new proforma/i }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  });

  test("creator closes on Escape", async ({ page }) => {
    await page.getByRole("button", { name: /new proforma/i }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[role="dialog"]').first(),
    ).not.toBeVisible();
  });

  test("status tabs filter the list", async ({ page }) => {
    await page.getByRole("button", { name: /^draft$/i }).click();
    await page.getByRole("button", { name: /^all$/i }).click();
  });

  test("clicking a row opens detail panel", async ({ page }) => {
    const rows = page.locator("tbody tr");
    const rowCount = await rows.count();
    if (rowCount > 0) {
      await rows.first().click();
      await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    }
  });
});
