/**
 * expenses.page.ts — Page object for /expenses route.
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class ExpensesPage extends BasePage {
  readonly createButton: Locator;
  readonly searchInput: Locator;
  readonly tableRows: Locator;
  readonly addSlideOver: Locator;
  readonly dateRangeBar: Locator;

  constructor(page: Page) {
    super(page);
    this.createButton = page.getByRole("button", { name: /new expense/i }).first();
    this.searchInput = page.getByPlaceholder(/search category or description/i);
    this.tableRows = page.locator("tbody tr");
    this.addSlideOver = page.locator('[role="dialog"]').first();
    this.dateRangeBar = page
      .getByRole("button", { name: /this month|last month|this quarter|custom/i })
      .first();
  }

  async goto() {
    await super.goto("/expenses");
  }

  // ── Presence ─────────────────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Expenses");
  }

  async expectDescription() {
    await expect(
      this.page.getByText("Track business expenses and outflows"),
    ).toBeVisible();
  }

  async expectCreateButton() {
    await expect(this.createButton).toBeVisible();
  }

  async expectSearchInput() {
    await expect(this.searchInput).toBeVisible();
  }

  async expectDateRangeBar() {
    await expect(this.dateRangeBar).toBeVisible();
  }

  async expectTableColumns() {
    const hasTable = (await this.page.locator("thead").count()) > 0;
    if (!hasTable) return;
    const headers = ["Date", "Category", "Description", "Mode", "Reference", "Amount"];
    for (const h of headers) {
      await expect(
        this.page.locator("thead").getByText(h, { exact: false }).first(),
      ).toBeVisible();
    }
  }

  // ── Interaction ──────────────────────────────────────────────

  async clickCreateButton() {
    await this.createButton.click();
  }

  async expectSlideOverOpen() {
    await expect(this.addSlideOver).toBeVisible({ timeout: 5_000 });
  }

  async searchExpenses(query: string) {
    await this.searchInput.fill(query);
  }

  async rowCount(): Promise<number> {
    return this.tableRows.count();
  }

  async fillExpenseForm(data: { category: string; amount: string; mode?: string }) {
    const dialog = this.addSlideOver;
    await dialog.getByPlaceholder(/rent.*utilities.*travel/i).fill(data.category);
    await dialog.getByPlaceholder("0.00").fill(data.amount);
  }

  async submitExpense() {
    await this.addSlideOver
      .getByRole("button", { name: /add expense|save changes/i })
      .first()
      .click();
  }
}
