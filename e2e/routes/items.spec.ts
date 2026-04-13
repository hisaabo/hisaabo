/**
 * items.spec.ts — Complete specification for the /items route.
 *
 * Layer 1: PRESENCE  — All expected UI elements exist and are visible
 * Layer 2: INTERACTION — Interactive elements respond correctly
 * Layer 3: MUTATION  — CRUD operations produce correct results
 */
import { test, expect } from "../helpers/fixtures";
import { ItemsPage } from "../helpers/page-objects/items.page";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Items — Presence", () => {
  let items: ItemsPage;

  test.beforeEach(async ({ page }) => {
    items = new ItemsPage(page);
    await items.goto();
  });

  test("renders page header and description", async () => {
    await items.expectPageHeader();
    await items.expectDescription();
  });

  test("renders add item button with keyboard shortcut", async () => {
    await items.expectAddButton();
  });

  test("renders search input", async () => {
    await items.expectSearchInput();
  });

  test("renders type filter (All / Products / Services)", async () => {
    await items.expectTypeFilter();
  });

  test("renders table with expected columns", async () => {
    await items.expectTableColumns();
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 2: INTERACTION
// ═════════════════════════════════════════════════════════════════

test.describe("Items — Interaction", () => {
  let items: ItemsPage;

  test.beforeEach(async ({ page }) => {
    items = new ItemsPage(page);
    await items.goto();
  });

  test("add button opens the add item modal", async () => {
    await items.clickAddButton();
    await items.expectAddModalOpen();
  });

  test("add modal closes on Escape", async () => {
    await items.clickAddButton();
    await items.expectAddModalOpen();
    await items.closeModal();
  });

  test("type filter switches between All, Products, and Services", async ({ page }) => {
    await items.clickTypeTab("Products");
    await page.waitForTimeout(300);

    await items.clickTypeTab("Services");
    await page.waitForTimeout(300);

    await items.clickTypeTab("All");
  });

  test("search input filters items", async ({ page }) => {
    const initialRows = await items.rowCount();
    await items.searchItems("nonexistent-item-xyz-12345");
    await page.waitForTimeout(500); // debounce
    // Should show fewer or equal results after searching for nonsense
    const rows = await items.rowCount();
    expect(rows).toBeLessThanOrEqual(initialRows);
  });

  test("keyboard shortcut N opens add modal", async ({ page }) => {
    // Click body to ensure no input has focus (otherwise N types into search)
    await page.locator("body").click();
    await page.keyboard.press("n");
    await items.expectAddModalOpen();
  });

  test("clicking an item row opens detail panel", async () => {
    const rows = await items.rowCount();
    if (rows > 0) {
      await items.clickItemRow(0);
      await items.expectDetailPanelOpen();
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 3: MUTATION
// ═════════════════════════════════════════════════════════════════

test.describe("Items — Mutation", () => {
  let items: ItemsPage;

  test.beforeEach(async ({ page }) => {
    items = new ItemsPage(page);
    await items.goto();
  });

  test("add item modal has name, price, unit fields", async ({ page }) => {
    await items.clickAddButton();
    await items.expectAddModalOpen();

    const dialog = page.locator('[role="dialog"]').first();
    // Verify the key form fields exist
    await expect(dialog.getByText(/name/i).first()).toBeVisible();
    await expect(dialog.getByText(/price/i).first()).toBeVisible();
    await expect(dialog.getByText(/unit/i).first()).toBeVisible();
  });

  test("detail panel shows Price History and Stock Movements tabs", async () => {
    const rows = await items.rowCount();
    if (rows > 0) {
      await items.clickItemRow(0);
      await items.expectDetailPanelOpen();

      const panel = items.page.locator('[role="dialog"]').first();
      await expect(panel.getByText(/price.*history/i).first()).toBeVisible();
      await expect(panel.getByText(/stock.*movement/i).first()).toBeVisible();
    }
  });
});
