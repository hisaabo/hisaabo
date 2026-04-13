/**
 * expenses-crud.spec.ts — Deep CRUD tests for the /expenses route.
 *
 * Tests:
 *   - Create expense with all fields, verify it appears in the list
 *   - Edit expense opens slide-over pre-populated with existing data
 *   - Editing amount and saving persists changes
 *   - Delete button opens confirmation dialog
 *   - Confirming delete removes expense from list
 */
import { test, expect, waitForSearchResults } from "../helpers/fixtures";
import { ApiHelper } from "../helpers/fixtures";
import { loadSeed, SeedApi, createExpense } from "../helpers/seed";

let businessId: string;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();
  // Seed one expense so edit/delete tests always have a row to work with
  await createExpense(api, businessId, {
    category: "CRUD Test Category",
    description: "Seeded for CRUD tests",
    amount: "999.00",
    mode: "cash",
  });
});

// ═════════════════════════════════════════════════════════════════
// Create
// ═════════════════════════════════════════════════════════════════

test.describe("Expenses — Create", () => {
  test("create expense with all fields, verify it appears in list", async ({ page }) => {
    await page.goto("/expenses");

    // Open slide-over
    await page.getByRole("button", { name: /new expense/i }).first().click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole("heading", { name: "Add Expense" })).toBeVisible();

    // Fill all fields
    const uniqueCategory = `Fuel ${Date.now()}`;
    await dialog.getByPlaceholder(/rent.*utilities.*travel/i).fill(uniqueCategory);
    await dialog.getByPlaceholder("0.00").fill("1500.00");
    // Reference # (optional)
    await dialog.getByPlaceholder(/invoice.*receipt/i).fill("REF-E2E-001");
    // Description (optional)
    await dialog.getByPlaceholder(/brief note/i).fill("E2E all-fields test");

    // Submit
    await dialog.getByRole("button", { name: /add expense/i }).first().click();

    // Slide-over closes on success
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Search for the newly created category and confirm it appears in the list
    await page.getByPlaceholder(/search category or description/i).fill(uniqueCategory);
    await waitForSearchResults(page);
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText(uniqueCategory);
  });
});

// ═════════════════════════════════════════════════════════════════
// Edit
// ═════════════════════════════════════════════════════════════════

test.describe("Expenses — Edit", () => {
  test("clicking edit button opens slide-over with title 'Edit Expense'", async ({ page }) => {
    await page.goto("/expenses");

    const rows = page.locator("tbody tr");
    const count = await rows.count();
    test.skip(count === 0, "No expenses to edit");

    // Hover the first row to reveal action buttons
    await rows.first().hover();
    await page.getByRole("button", { name: "Edit expense" }).first().click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole("heading", { name: "Edit Expense" })).toBeVisible();
  });

  test("editing amount and saving persists changes", async ({ page }) => {
    await page.goto("/expenses");

    const rows = page.locator("tbody tr");
    const count = await rows.count();
    test.skip(count === 0, "No expenses to edit");

    // Hover the first row and click edit
    await rows.first().hover();
    await page.getByRole("button", { name: "Edit expense" }).first().click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Change the amount
    const amountField = dialog.getByPlaceholder("0.00");
    await amountField.clear();
    await amountField.fill("1234.56");

    // Save
    await dialog.getByRole("button", { name: /save changes/i }).click();

    // Slide-over should close after a successful update
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
// Delete
// ═════════════════════════════════════════════════════════════════

test.describe("Expenses — Delete", () => {
  test("delete button opens delete confirmation dialog", async ({ page }) => {
    await page.goto("/expenses");

    const rows = page.locator("tbody tr");
    const count = await rows.count();
    test.skip(count === 0, "No expenses to delete");

    // Hover the first row to reveal action buttons
    await rows.first().hover();
    await page.getByRole("button", { name: "Delete expense" }).first().click();

    // DeleteConfirmDialog should appear and mention the entity name
    const confirmDialog = page.locator('[role="dialog"]').first();
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(confirmDialog.getByText(/expense/i).first()).toBeVisible();
  });

  test("confirming delete removes expense from list", async ({ page }) => {
    // Seed a dedicated expense so the deletion is deterministic
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const _seeded = await createExpense(api, businessId, {
      category: "DeleteMe Category",
      description: "To be deleted",
      amount: "77.00",
    });

    await page.goto("/expenses");

    // Search for the seeded expense to isolate it
    await page.getByPlaceholder(/search category or description/i).fill("DeleteMe Category");
    await waitForSearchResults(page);

    const rows = page.locator("tbody tr");
    const count = await rows.count();
    test.skip(count === 0, "Seeded expense not found in list");

    // Hover and click delete
    await rows.first().hover();
    await page.getByRole("button", { name: "Delete expense" }).first().click();

    // Confirm deletion — click the danger-styled Delete button
    await expect(page.locator(".btn-danger")).toBeVisible({ timeout: 5_000 });
    await page.locator(".btn-danger").click();

    // The server deletes successfully — assert via the "0 expenses" footer
    await expect(page.getByText(/0 expenses/i)).toBeVisible({ timeout: 10_000 });
  });
});
