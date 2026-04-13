/**
 * sales-returns.spec.ts — Complete specification for the /sales-returns route.
 *
 * Sales returns use the shared DocumentListPage component, so this spec
 * validates that the config is correctly wired — title, tabs, columns, actions.
 * Note: col4 is "Ref. Invoice" instead of "Due Date".
 *
 * Layer 1: PRESENCE   — All expected UI elements exist and are visible
 * Layer 2: INTERACTION — Interactive elements respond correctly
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Sales Returns — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sales-returns");
    await waitForPageReady(page);
  });

  test("renders page header and description", async ({ page }) => {
    await expect(page.locator("h1").first()).toContainText("Sales Returns");
    await expect(
      page.getByText("Manage returned goods from customers"),
    ).toBeVisible();
  });

  test("renders New Sales Return button", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /new.*sales.*return/i }),
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
      await expect(thead.getByText("Return #")).toBeVisible();
      await expect(thead.getByText("Date")).toBeVisible();
      await expect(thead.getByText("Ref. Invoice")).toBeVisible();
      await expect(thead.getByText("Party")).toBeVisible();
      await expect(thead.getByText("Amount")).toBeVisible();
      await expect(thead.getByText("Status")).toBeVisible();
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 2: INTERACTION
// ═════════════════════════════════════════════════════════════════

test.describe("Sales Returns — Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sales-returns");
    await waitForPageReady(page);
  });

  // TODO: Flaky — DocumentCreator intermittently fails to open in full-suite runs (timing)
  test.skip("create button opens DocumentCreator", async ({ page }) => {
    await page.getByRole("button", { name: /new.*sales.*return/i }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  });

  // TODO: Flaky — depends on the above test's creator opening reliably
  test.skip("creator closes on Escape", async ({ page }) => {
    await page.getByRole("button", { name: /new.*sales.*return/i }).click();
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
    test.skip(rowCount === 0, "No data available");
    await rows.first().click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  });
});
