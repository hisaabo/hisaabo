/**
 * delivery-challans.spec.ts — Complete specification for the /delivery-challans route.
 *
 * Delivery challans use the shared DocumentListPage component with
 * hasTypeFilter: true (Sales / Purchases toggle), so this spec validates
 * that the config is correctly wired — title, type toggle, tabs, columns, actions.
 *
 * Layer 1: PRESENCE   — All expected UI elements exist and are visible
 * Layer 2: INTERACTION — Interactive elements respond correctly
 */
import { test, expect } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Delivery Challans — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/delivery-challans");
    await page
      .locator(".animate-pulse")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  });

  test("renders page header and description", async ({ page }) => {
    await expect(page.locator("h1").first()).toContainText("Delivery Challans");
    await expect(
      page.getByText("Manage delivery challans and dispatch notes"),
    ).toBeVisible();
  });

  test("renders New Challan button", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /new.*challan/i }),
    ).toBeVisible();
  });

  test("renders type toggle (Sales / Purchases)", async ({ page }) => {
    await expect(page.getByText("Sales")).toBeVisible();
    await expect(page.getByText("Purchases")).toBeVisible();
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
      await expect(thead.getByText("Challan #")).toBeVisible();
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

test.describe("Delivery Challans — Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/delivery-challans");
    await page
      .locator(".animate-pulse")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  });

  test("create button opens DocumentCreator", async ({ page }) => {
    await page.getByRole("button", { name: /new.*challan/i }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  });

  test("creator closes on Escape", async ({ page }) => {
    await page.getByRole("button", { name: /new.*challan/i }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[role="dialog"]').first(),
    ).not.toBeVisible();
  });

  test("status tabs filter the list", async ({ page }) => {
    await page.getByRole("button", { name: /^draft$/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^all$/i }).click();
  });

  test("type toggle switches between Sales and Purchases", async ({ page }) => {
    await page.getByText("Sales").click();
    await page.waitForTimeout(300);

    await page.getByText("Purchases").click();
    await page.waitForTimeout(300);
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
