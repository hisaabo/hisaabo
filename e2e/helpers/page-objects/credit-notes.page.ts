/**
 * credit-notes.page.ts — Page object for /credit-notes route.
 *
 * Credit notes use the shared DocumentListPage component, so the
 * UI elements follow that pattern (type toggle, status tabs, table).
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class CreditNotesPage extends BasePage {
  readonly createButton: Locator;
  readonly typeToggle: Locator;
  readonly tableRows: Locator;
  readonly detailPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.createButton = page.getByRole("button", { name: /new credit note/i }).first();
    this.typeToggle = page.locator("[class*=SegmentedControl], [role=tablist]").first();
    this.tableRows = page.locator("tbody tr");
    this.detailPanel = page.locator('[role="dialog"]').first();
  }

  async goto() {
    await super.goto("/credit-notes");
  }

  // ── Presence ─────────────────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Credit Notes");
  }

  async expectDescription() {
    await expect(this.page.getByText("Manage sales and purchase credit notes")).toBeVisible();
  }

  async expectCreateButton() {
    await expect(this.createButton).toBeVisible();
  }

  async expectTypeFilter() {
    await expect(this.page.getByText("Sales").first()).toBeVisible();
    await expect(this.page.getByText("Purchases").first()).toBeVisible();
  }

  async expectStatusTabs() {
    const tabs = ["All", "Draft", "Sent", "Paid", "Cancelled"];
    for (const tab of tabs) {
      await expect(
        this.page.getByRole("button", { name: tab }).or(this.page.getByText(tab)).first(),
      ).toBeVisible();
    }
  }

  async expectTableColumns() {
    // Only assert table columns when the table actually renders (not empty state)
    const hasTable = await this.page.locator("thead").count() > 0;
    if (!hasTable) return;

    const headers = ["Date", "Credit Note", "Party", "Ref. Invoice", "Amount", "Status"];
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

  async expectCreatorOpen() {
    await expect(this.detailPanel).toBeVisible({ timeout: 5_000 });
  }

  async switchToSales() {
    await this.page.getByText("Sales").first().click();
  }

  async switchToPurchases() {
    await this.page.getByText("Purchases").first().click();
  }

  async clickStatusTab(label: string) {
    await this.page.getByRole("button", { name: label }).or(this.page.getByText(label)).first().click();
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
}
