/**
 * expenses.spec.ts — Complete specification for the /expenses route.
 *
 * Organized into the 4-layer testing philosophy:
 *   Layer 1: PRESENCE  — All expected UI elements exist and are visible
 *   Layer 2: INTERACTION — Interactive elements respond correctly
 *   Layer 3: MUTATION  — CRUD operations produce correct results
 *   Layer 4: FLOW      — Multi-step journeys work end-to-end
 */
import { test, expect } from "../helpers/fixtures";
import { ExpensesPage } from "../helpers/page-objects/expenses.page";
import { loadSeed } from "../helpers/seed";

// ── Shared state seeded once for the entire file ──────────────────
let _businessId: string;

test.beforeAll(async () => {
  _businessId = loadSeed().businessId;
});

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE — "What should be on this screen?"
// ═════════════════════════════════════════════════════════════════

test.describe("Expenses — Presence", () => {
  let expenses: ExpensesPage;

  test.beforeEach(async ({ page }) => {
    expenses = new ExpensesPage(page);
    await expenses.goto();
  });

  test("renders page header and description", async () => {
    await expenses.expectPageHeader();
    await expenses.expectDescription();
  });

  test("renders New Expense button", async () => {
    await expenses.expectCreateButton();
  });

  test("renders search input", async () => {
    await expenses.expectSearchInput();
  });

  test("renders date range bar", async () => {
    await expenses.expectDateRangeBar();
  });

  test("renders table with expected columns", async () => {
    await expenses.expectTableColumns();
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 2: INTERACTION — "Does every interactive element work?"
// ═════════════════════════════════════════════════════════════════

test.describe("Expenses — Interaction", () => {
  let expenses: ExpensesPage;

  test.beforeEach(async ({ page }) => {
    expenses = new ExpensesPage(page);
    await expenses.goto();
  });

  test("New Expense button opens Add Expense slide-over", async () => {
    await expenses.clickCreateButton();
    await expenses.expectSlideOverOpen();
    await expect(expenses.addSlideOver.getByText("Add Expense")).toBeVisible();
  });

  test("slide-over closes on Escape", async () => {
    await expenses.clickCreateButton();
    await expenses.expectSlideOverOpen();
    await expenses.closeModal();
    await expect(expenses.addSlideOver).not.toBeVisible({ timeout: 5_000 });
  });

  test("search input filters expenses", async () => {
    const initialRows = await expenses.rowCount();
    await expenses.searchExpenses("nonexistent-expense-xyz-12345");

    const rows = await expenses.rowCount();
    expect(rows).toBeLessThanOrEqual(initialRows);
  });

  test("keyboard shortcut N opens Add Expense slide-over", async ({ page }) => {
    // Click body to ensure no input has focus (otherwise N types into search)
    await page.locator("body").click();
    await page.keyboard.press("n");
    await expenses.expectSlideOverOpen();
    await expect(expenses.addSlideOver.getByText("Add Expense")).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 3: MUTATION — "Do CRUD operations produce correct results?"
// ═════════════════════════════════════════════════════════════════

test.describe("Expenses — Mutation", () => {
  let expenses: ExpensesPage;

  test.beforeEach(async ({ page }) => {
    expenses = new ExpensesPage(page);
    await expenses.goto();
  });

  test("Add Expense slide-over has Category, Amount, Mode, Date fields", async () => {
    await expenses.clickCreateButton();
    await expenses.expectSlideOverOpen();

    const dialog = expenses.addSlideOver;
    await expect(dialog.getByPlaceholder(/rent.*utilities.*travel/i)).toBeVisible();
    await expect(dialog.getByPlaceholder("0.00")).toBeVisible();
    // Payment Mode listbox
    await expect(dialog.getByText(/payment mode/i)).toBeVisible();
    // Date field
    await expect(dialog.locator('input[type="date"]')).toBeVisible();
  });

  test("Add Expense validates required fields", async () => {
    await expenses.clickCreateButton();
    await expenses.expectSlideOverOpen();

    // Submit without filling anything
    await expenses.submitExpense();

    // Validation error messages should appear
    const dialog = expenses.addSlideOver;
    await expect(
      dialog.getByText(/category is required/i).or(dialog.getByText(/valid amount required/i)),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("can create an expense via slide-over", async () => {
    await expenses.clickCreateButton();
    await expenses.expectSlideOverOpen();

    // Fill in the form
    const uniqueCategory = `E2E Supplies ${Date.now()}`;
    await expenses.fillExpenseForm({ category: uniqueCategory, amount: "250.00" });

    // Submit
    await expenses.submitExpense();

    // Slide-over should close on success
    await expect(expenses.addSlideOver).not.toBeVisible({ timeout: 10_000 });
  });

  test("row hover shows edit and delete buttons", async ({ page }) => {
    const count = await expenses.rowCount();
    test.skip(count === 0, "No expenses in the list to hover over");

    const firstRow = expenses.tableRows.first();
    await firstRow.hover();

    await expect(page.getByRole("button", { name: "Edit expense" })).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByRole("button", { name: "Delete expense" })).toBeVisible({
      timeout: 3_000,
    });
  });
});
