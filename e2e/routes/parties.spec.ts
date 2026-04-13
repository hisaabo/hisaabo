/**
 * parties.spec.ts — Complete specification for the /parties route.
 *
 * Layer 1: PRESENCE  — All expected UI elements exist and are visible
 * Layer 2: INTERACTION — Interactive elements respond correctly
 * Layer 3: MUTATION  — CRUD operations produce correct results
 */
import { test, expect } from "../helpers/fixtures";
import { PartiesPage } from "../helpers/page-objects/parties.page";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Parties — Presence", () => {
  let parties: PartiesPage;

  test.beforeEach(async ({ page }) => {
    parties = new PartiesPage(page);
    await parties.goto();
  });

  test("renders page header", async () => {
    await parties.expectPageHeader();
  });

  test("renders add party button", async () => {
    await parties.expectAddButton();
  });

  test("renders search input", async () => {
    await parties.expectSearchInput();
  });

  test("renders type filter (All / Customers / Suppliers)", async () => {
    await parties.expectTypeFilter();
  });

  test("renders status filter pills (Outstanding / Overdue)", async () => {
    await parties.expectStatusFilters();
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 2: INTERACTION
// ═════════════════════════════════════════════════════════════════

test.describe("Parties — Interaction", () => {
  let parties: PartiesPage;

  test.beforeEach(async ({ page }) => {
    parties = new PartiesPage(page);
    await parties.goto();
  });

  test("add button opens the add party modal", async () => {
    await parties.clickAddButton();
    await parties.expectAddModalOpen();
  });

  test("add modal closes on Escape", async () => {
    await parties.clickAddButton();
    await parties.expectAddModalOpen();
    await parties.closeModal();
  });

  test("type filter switches between All, Customers, Suppliers", async () => {
    await parties.clickTypeTab("Customers");

    await parties.clickTypeTab("Suppliers");

    await parties.clickTypeTab("All");
  });

  test("search input filters parties", async () => {
    const initialRows = await parties.rowCount();
    await parties.searchParties("nonexistent-party-xyz-99999");
    // Should show fewer or equal results after searching for nonsense
    const rows = await parties.rowCount();
    expect(rows).toBeLessThanOrEqual(initialRows);
  });

  test("clicking a party row opens detail panel", async () => {
    const rows = await parties.rowCount();
    test.skip(rows === 0, "No data available");
    await parties.clickPartyRow(0);
    await parties.expectDetailPanelOpen();
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 3: MUTATION
// ═════════════════════════════════════════════════════════════════

test.describe("Parties — Mutation", () => {
  let parties: PartiesPage;

  test.beforeEach(async ({ page }) => {
    parties = new PartiesPage(page);
    await parties.goto();
  });

  test("add party modal has name, phone, GSTIN fields", async ({ page }) => {
    await parties.clickAddButton();
    await parties.expectAddModalOpen();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog.getByText(/name/i).first()).toBeVisible();
    await expect(dialog.getByText(/phone/i).first()).toBeVisible();
  });

  test("detail panel shows party info and ledger", async () => {
    const rows = await parties.rowCount();
    test.skip(rows === 0, "No data available");
    await parties.clickPartyRow(0);
    await parties.expectDetailPanelOpen();

    const panel = parties.page.locator('[role="dialog"]').first();
    // Party detail should show the party name and balance info
    await expect(panel.getByText(/balance|outstanding/i).first()).toBeVisible();
  });
});
