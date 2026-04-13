/**
 * invoices.page.ts — Page object for /invoices route.
 *
 * Inventories all expected UI elements and provides action methods
 * for the 4-layer E2E spec (Presence, Interaction, Mutation, Flow).
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class InvoicesPage extends BasePage {
  // ── Page-level elements ──────────────────────────────────────
  readonly createButton: Locator;
  readonly searchInput: Locator;
  readonly typeToggle: Locator;
  readonly exportButton: Locator;
  readonly dateRangeBar: Locator;

  // ── Status tabs ──────────────────────────────────────────────
  readonly statusTabs: Locator;

  // ── Table ────────────────────────────────────────────────────
  readonly table: Locator;
  readonly tableBody: Locator;
  readonly tableRows: Locator;

  // ── Detail panel (slide-over) ────────────────────────────────
  readonly detailPanel: Locator;

  // ── Invoice creator (slide-over) ─────────────────────────────
  readonly creatorPanel: Locator;

  // ── Record payment panel ─────────────────────────────────────
  readonly paymentPanel: Locator;

  constructor(page: Page) {
    super(page);

    this.createButton = page.getByRole("button", { name: /new invoice/i }).first();
    this.searchInput = page.getByPlaceholder(/search invoices/i);
    this.typeToggle = page.locator("[class*=SegmentedControl], [role=tablist]").first();
    this.exportButton = page.getByRole("button", { name: /export|csv/i }).first();
    this.dateRangeBar = page.getByRole("button", { name: /this month|last month|this quarter|custom/i }).first();

    this.statusTabs = page.locator("[class*=PillTabs], [role=tablist]").first();

    this.table = page.locator("table").first();
    this.tableBody = page.locator("tbody").first();
    this.tableRows = page.locator("tbody tr");

    // Only one dialog is open at a time (SlideOver or Modal).
    // All three are aliases for the same locator.
    const dialog = page.locator('[role="dialog"]').first();
    this.detailPanel = dialog;
    this.creatorPanel = dialog;
    this.paymentPanel = dialog;
  }

  async goto() {
    await super.goto("/invoices");
  }

  // ── Presence assertions ──────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Invoices");
  }

  async expectDescription() {
    await expect(this.page.getByText("Manage sales and purchase invoices")).toBeVisible();
  }

  async expectCreateButton() {
    await expect(this.createButton).toBeVisible();
  }

  async expectSearchInput() {
    await expect(this.searchInput).toBeVisible();
  }

  async expectTypeToggle() {
    await expect(this.page.getByText("Sales").first()).toBeVisible();
    await expect(this.page.getByText("Purchases").first()).toBeVisible();
  }

  async expectStatusTabs() {
    const tabs = ["All", "Draft", "Unfulfilled", "Sent", "Partial", "Paid", "Overdue"];
    for (const tab of tabs) {
      await expect(this.page.getByRole("button", { name: tab }).or(this.page.getByText(tab)).first()).toBeVisible();
    }
  }

  async expectTableColumns() {
    // Only assert table columns when the table actually renders (not empty state)
    const hasTable = await this.page.locator("thead").count() > 0;
    if (!hasTable) return;

    const headers = ["#", "Date", "Party", "Amount", "Status"];
    for (const h of headers) {
      await expect(
        this.page.locator("thead").getByText(h, { exact: false }).first(),
      ).toBeVisible();
    }
  }

  async expectEmptyState() {
    await expect(this.page.getByText(/no.*invoices/i)).toBeVisible({ timeout: 5_000 });
  }

  async expectDateRangeBar() {
    await expect(this.dateRangeBar).toBeVisible();
  }

  // ── Interaction methods ──────────────────────────────────────

  async clickCreateButton() {
    await this.createButton.click();
  }

  async clickStatusTab(label: string) {
    await this.page.getByRole("button", { name: label }).or(this.page.getByText(label)).first().click();
  }

  async switchToSales() {
    await this.page.getByText("Sales").first().click();
  }

  async switchToPurchases() {
    await this.page.getByText("Purchases").first().click();
  }

  async searchInvoices(query: string) {
    await this.searchInput.fill(query);
    await this.waitForTrpcResponse();
  }

  async clickInvoiceRow(index = 0) {
    await this.tableRows.nth(index).click();
  }

  /** Get the text content of the Nth invoice row */
  async getRowText(index = 0): Promise<string> {
    return (await this.tableRows.nth(index).textContent()) ?? "";
  }

  /** Get the count of visible table rows */
  async rowCount(): Promise<number> {
    return this.tableRows.count();
  }

  // ── Detail panel actions ─────────────────────────────────────

  async expectDetailPanelOpen() {
    await expect(this.detailPanel).toBeVisible({ timeout: 5_000 });
  }

  async expectDetailPanelClosed() {
    await expect(this.detailPanel).not.toBeVisible({ timeout: 3_000 });
  }

  async closeDetailPanel() {
    await this.page.keyboard.press("Escape");
    await this.expectDetailPanelClosed();
  }

  // ── Creator panel ────────────────────────────────────────────

  async expectCreatorOpen() {
    await expect(this.creatorPanel).toBeVisible({ timeout: 5_000 });
  }

  // ── Mutation helpers ─────────────────────────────────────────

  /** Click record payment in the detail panel */
  async clickRecordPayment() {
    await this.detailPanel.getByRole("button", { name: /record.*payment/i }).click();
  }

  /** Click the cancel/delete button for an invoice in the list */
  async clickDeleteOnRow(index = 0) {
    await this.tableRows.nth(index).hover();
    await this.tableRows
      .nth(index)
      .getByRole("button", { name: /delete|cancel/i })
      .click();
  }
}
