/**
 * parties.page.ts — Page object for /parties route.
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class PartiesPage extends BasePage {
  readonly addButton: Locator;
  readonly searchInput: Locator;
  readonly typeToggle: Locator;
  readonly tableRows: Locator;
  readonly addModal: Locator;
  readonly detailPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.addButton = page.getByRole("button", { name: /add.*party|new.*party/i }).first();
    this.searchInput = page.getByPlaceholder(/search/i);
    this.typeToggle = page.locator("[class*=SegmentedControl], [role=tablist]").first();
    this.tableRows = page.locator("tbody tr");
    this.addModal = page.locator('[role="dialog"]').first();
    this.detailPanel = page.locator('[role="dialog"]').first();
  }

  async goto() {
    await super.goto("/parties");
  }

  // ── Presence ─────────────────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Parties");
  }

  async expectAddButton() {
    await expect(this.addButton).toBeVisible();
  }

  async expectSearchInput() {
    await expect(this.searchInput).toBeVisible();
  }

  async expectTypeFilter() {
    await expect(this.page.getByText("All").first()).toBeVisible();
    await expect(this.page.getByText("Customers").first()).toBeVisible();
    await expect(this.page.getByText("Suppliers").first()).toBeVisible();
  }

  async expectStatusFilters() {
    await expect(this.page.getByText("Outstanding").first()).toBeVisible();
    await expect(this.page.getByText("Overdue").first()).toBeVisible();
  }

  // ── Interaction ──────────────────────────────────────────────

  async clickAddButton() {
    await this.addButton.click();
  }

  async expectAddModalOpen() {
    await expect(this.addModal).toBeVisible({ timeout: 5_000 });
  }

  async clickTypeTab(label: string) {
    await this.page.getByText(label).first().click();
  }

  async searchParties(query: string) {
    await this.searchInput.fill(query);
    await this.waitForTrpcResponse();
  }

  async clickPartyRow(index = 0) {
    await this.tableRows.nth(index).click();
  }

  async rowCount(): Promise<number> {
    return this.tableRows.count();
  }

  async expectDetailPanelOpen() {
    await expect(this.detailPanel).toBeVisible({ timeout: 5_000 });
  }

  /** Fill the add party modal form */
  async fillAddPartyForm(data: {
    name: string;
    type?: "customer" | "supplier";
    phone?: string;
  }) {
    const dialog = this.addModal;
    // Party name
    await dialog.getByPlaceholder(/party.*name|name/i).first().fill(data.name);
    // Phone (optional)
    if (data.phone) {
      await dialog.getByPlaceholder(/phone/i).first().fill(data.phone);
    }
  }

  async submitAddParty() {
    await this.addModal.getByRole("button", { name: /save|add|create/i }).first().click();
  }
}
