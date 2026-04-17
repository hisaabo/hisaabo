/**
 * quick-create.spec.ts — Test quick-creating parties and items
 * directly from within the invoice creation slide-over.
 *
 * The Combobox dropdowns for party and item selection have a sticky
 * footer row "Create <entity> 'query'" that opens a Modal dialog
 * for quick creation. On success the new entity is auto-selected.
 */
import { test, expect } from "../helpers/fixtures";
import { loadSeed, SeedApi, createParty } from "../helpers/seed";
import { InvoicesPage } from "../helpers/page-objects/invoices.page";

let businessId: string;
let seededPartyName: string;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();

  const ts = Date.now();
  seededPartyName = `QC Seeded Customer ${ts}`;

  // Create a party for tests that need a pre-selected party (item quick-create tests)
  await createParty(api, businessId, { name: seededPartyName });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open the invoice creator slide-over and wait for it to appear. */
async function openInvoiceCreator(page: import("@playwright/test").Page) {
  const invoicesPage = new InvoicesPage(page);
  await invoicesPage.goto();
  await invoicesPage.clickCreateButton();
  await invoicesPage.expectCreatorOpen();
  return invoicesPage;
}

/**
 * Return the quick-create Modal dialog — the *last* visible dialog,
 * since the SlideOver (invoice creator) is the first.
 */
function getQuickCreateModal(page: import("@playwright/test").Page) {
  return page.getByRole("dialog").last();
}

/** Return the invoice creator SlideOver — the first dialog on the page. */
function getCreatorPanel(page: import("@playwright/test").Page) {
  return page.locator('[role="dialog"]').first();
}

// ---------------------------------------------------------------------------
// Quick Party Create
// ---------------------------------------------------------------------------

test.describe("Quick Party Create", () => {
  test("can quick-create a party from the invoice creator", async ({ page }) => {
    await openInvoiceCreator(page);

    const uniqueName = `QC Party ${Date.now()}`;

    // Click on the Customer combobox input and type a unique name
    const partyInput = getCreatorPanel(page).getByRole("combobox").first();
    await partyInput.click();
    await partyInput.fill(uniqueName);

    // Wait for the debounced search to resolve
    await page.waitForTimeout(500);

    // The Combobox should show a "Create customer" footer row
    const createRow = page.getByRole("option").filter({
      hasText: new RegExp(`Create customer.*"${uniqueName}"`, "i"),
    });
    await expect(createRow).toBeVisible({ timeout: 5_000 });
    await createRow.click();

    // A Modal should open with title "New Customer"
    const modal = getQuickCreateModal(page);
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText("New Customer")).toBeVisible();

    // The name field should be pre-filled
    const nameInput = modal.locator('input').first();
    await expect(nameInput).toHaveValue(uniqueName);

    // "Create & Select" button should be disabled (phone is empty)
    const submitBtn = modal.getByRole("button", { name: /Create & Select/i });
    await expect(submitBtn).toBeDisabled();

    // Fill in the phone field
    const phoneInput = modal.locator('input[type="tel"]');
    await phoneInput.fill("9876543210");

    // "Create & Select" should now be enabled
    await expect(submitBtn).toBeEnabled();

    // Click "Create & Select"
    await submitBtn.click();

    // Wait for the modal to close
    await expect(modal.getByText("New Customer")).not.toBeVisible({ timeout: 10_000 });

    // The combobox should now have the new party selected (input shows the name)
    await expect(partyInput).toHaveValue(uniqueName, { timeout: 5_000 });
  });

  test("quick party create button stays disabled without required fields", async ({ page }) => {
    await openInvoiceCreator(page);

    const uniqueName = `QC Validation ${Date.now()}`;

    // Trigger quick party create
    const partyInput = getCreatorPanel(page).getByRole("combobox").first();
    await partyInput.click();
    await partyInput.fill(uniqueName);
    await page.waitForTimeout(500);

    const createRow = page.getByRole("option").filter({
      hasText: /Create customer/i,
    });
    await expect(createRow).toBeVisible({ timeout: 5_000 });
    await createRow.click();

    const modal = getQuickCreateModal(page);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const submitBtn = modal.getByRole("button", { name: /Create & Select/i });

    // Name is pre-filled, phone is empty -> disabled
    await expect(submitBtn).toBeDisabled();

    // Clear the pre-filled name -> still disabled
    const nameInput = modal.locator('input').first();
    await nameInput.clear();
    await expect(submitBtn).toBeDisabled();

    // Type name back, no phone -> still disabled
    await nameInput.fill("Some Name");
    await expect(submitBtn).toBeDisabled();

    // Fill phone -> now enabled
    const phoneInput = modal.locator('input[type="tel"]');
    await phoneInput.fill("9000000000");
    await expect(submitBtn).toBeEnabled();

    // Clear phone again -> disabled
    await phoneInput.clear();
    await expect(submitBtn).toBeDisabled();

    // Close the modal without creating
    await page.keyboard.press("Escape");
  });
});

// ---------------------------------------------------------------------------
// Quick Item Create
// ---------------------------------------------------------------------------

test.describe("Quick Item Create", () => {
  test("can quick-create an item from the invoice creator", async ({ page }) => {
    await openInvoiceCreator(page);

    // First, select the seeded party so we can access line items
    const partyInput = getCreatorPanel(page).getByRole("combobox").first();
    await partyInput.click();
    await partyInput.fill(seededPartyName);
    await page.waitForTimeout(500);

    // Select the seeded party from the dropdown
    const partyOption = page.getByRole("option").filter({
      hasText: new RegExp(seededPartyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
    await expect(partyOption.first()).toBeVisible({ timeout: 5_000 });
    await partyOption.first().click();

    // Now type into the item combobox in the first line item row
    const uniqueItemName = `QC Item ${Date.now()}`;
    const creator = getCreatorPanel(page);

    // The item combobox is the second combobox in the creator (first is party).
    // Match the exact item-picker placeholder so we don't collide with the
    // party combobox's "Search customer..." placeholder.
    const itemInput = creator.getByPlaceholder(/select product or custom item/i).first();
    await itemInput.click();
    await itemInput.fill(uniqueItemName);
    await page.waitForTimeout(500);

    // Look for the "Create item" footer row
    const createItemRow = page.getByRole("option").filter({
      hasText: new RegExp(`Create item.*"${uniqueItemName}"`, "i"),
    });
    await expect(createItemRow).toBeVisible({ timeout: 5_000 });
    await createItemRow.click();

    // A Modal should open with title "New Item"
    const modal = getQuickCreateModal(page);
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText("New Item")).toBeVisible();

    // The name field should be pre-filled
    const nameInput = modal.locator('input').first();
    await expect(nameInput).toHaveValue(uniqueItemName);

    // "Create & Select" should be disabled (unit not selected yet)
    const submitBtn = modal.getByRole("button", { name: /Create & Select/i });
    await expect(submitBtn).toBeDisabled();

    // Select a unit from the dropdown (the SelectField renders a native <select>)
    const unitSelect = modal.locator("select");
    await unitSelect.selectOption("pcs");

    // Optionally fill a price
    const priceInput = modal.locator('input[type="number"]').first();
    await priceInput.fill("250");

    // "Create & Select" should now be enabled
    await expect(submitBtn).toBeEnabled();

    // Click "Create & Select"
    await submitBtn.click();

    // Wait for the modal to close
    await expect(modal.getByText("New Item")).not.toBeVisible({ timeout: 10_000 });

    // The item combobox should now have the new item selected
    await expect(itemInput).toHaveValue(uniqueItemName, { timeout: 5_000 });
  });

  test("quick item create button stays disabled without unit", async ({ page }) => {
    await openInvoiceCreator(page);

    // Select seeded party first
    const partyInput = getCreatorPanel(page).getByRole("combobox").first();
    await partyInput.click();
    await partyInput.fill(seededPartyName);
    await page.waitForTimeout(500);

    const partyOption = page.getByRole("option").filter({
      hasText: new RegExp(seededPartyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
    await expect(partyOption.first()).toBeVisible({ timeout: 5_000 });
    await partyOption.first().click();

    // Trigger quick item create
    const uniqueItemName = `QC ItemVal ${Date.now()}`;
    const creator = getCreatorPanel(page);
    const itemInput = creator.getByPlaceholder(/select product or custom item/i).first();
    await itemInput.click();
    await itemInput.fill(uniqueItemName);
    await page.waitForTimeout(500);

    const createItemRow = page.getByRole("option").filter({
      hasText: /Create item/i,
    });
    await expect(createItemRow).toBeVisible({ timeout: 5_000 });
    await createItemRow.click();

    const modal = getQuickCreateModal(page);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const submitBtn = modal.getByRole("button", { name: /Create & Select/i });

    // Name is pre-filled but unit is "Select unit..." (empty value) -> disabled
    await expect(submitBtn).toBeDisabled();

    // Fill price — still disabled without unit
    const priceInput = modal.locator('input[type="number"]').first();
    await priceInput.fill("100");
    await expect(submitBtn).toBeDisabled();

    // Select unit -> enabled
    const unitSelect = modal.locator("select");
    await unitSelect.selectOption("pcs");
    await expect(submitBtn).toBeEnabled();

    // Close without creating
    await page.keyboard.press("Escape");
  });
});

// ---------------------------------------------------------------------------
// Escape key layering
// ---------------------------------------------------------------------------

test.describe("Escape key layering", () => {
  test("Escape closes quick-create modal without closing invoice creator", async ({ page }) => {
    await openInvoiceCreator(page);

    const uniqueName = `QC Escape ${Date.now()}`;

    // Trigger quick party create
    const partyInput = getCreatorPanel(page).getByRole("combobox").first();
    await partyInput.click();
    await partyInput.fill(uniqueName);
    await page.waitForTimeout(500);

    const createRow = page.getByRole("option").filter({
      hasText: /Create customer/i,
    });
    await expect(createRow).toBeVisible({ timeout: 5_000 });
    await createRow.click();

    // Modal should be open
    const modal = getQuickCreateModal(page);
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText("New Customer")).toBeVisible();

    // Press Escape — modal should close
    await page.keyboard.press("Escape");

    // The quick-create modal should be gone
    // Wait briefly for the close animation / DOM removal
    await expect(modal.getByText("New Customer")).not.toBeVisible({ timeout: 3_000 });

    // But the invoice creator slide-over should still be open
    const creator = getCreatorPanel(page);
    await expect(creator).toBeVisible();

    // Verify we can still interact with the creator (party combobox is still there)
    await expect(creator.getByRole("combobox").first()).toBeVisible();
  });
});
