/**
 * payments.page.ts — Page object for /payments route.
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class PaymentsPage extends BasePage {
  readonly searchInput: Locator;
  readonly tableRows: Locator;
  readonly detailPanel: Locator;
  readonly dateRangeBar: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByPlaceholder(/search/i);
    this.tableRows = page.locator("tbody tr");
    this.detailPanel = page.locator('[role="dialog"]').first();
    this.dateRangeBar = page.getByRole("button", { name: /this month|last month|this quarter|custom/i }).first();
  }

  async goto() {
    await super.goto("/payments");
  }

  // ── Presence ─────────────────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Payments");
  }

  async expectSearchInput() {
    await expect(this.searchInput).toBeVisible();
  }

  async expectDatePresets() {
    // Payments page has date preset buttons, not a type toggle
    await expect(this.page.getByText("This Month").first()).toBeVisible();
    await expect(this.page.getByText("Last Month").first()).toBeVisible();
  }

  async expectRecordButton() {
    await expect(this.page.getByRole("button", { name: /record payment/i }).first()).toBeVisible();
  }

  async expectDateRangeBar() {
    await expect(this.dateRangeBar).toBeVisible();
  }

  async expectTableColumns() {
    // Only assert table columns when the table actually renders (not empty state)
    const hasTable = await this.page.locator("thead").count() > 0;
    if (!hasTable) return;

    const headers = ["Payment", "Date", "Party", "Amount"];
    for (const h of headers) {
      await expect(
        this.page.locator("thead").getByText(h, { exact: false }).first(),
      ).toBeVisible();
    }
  }

  // ── Interaction ──────────────────────────────────────────────

  async searchPayments(query: string) {
    await this.searchInput.fill(query);
    await this.waitForTrpcResponse();
  }

  async clickRow(index = 0) {
    await this.tableRows.nth(index).click();
  }

  async rowCount(): Promise<number> {
    return this.tableRows.count();
  }

  async expectDetailPanelOpen() {
    await expect(this.detailPanel).toBeVisible({ timeout: 5_000 });
  }

  async clickTypeTab(label: string) {
    await this.page.getByText(label).first().click();
  }
}
