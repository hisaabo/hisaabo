/**
 * items.page.ts — Page object for /items route.
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class ItemsPage extends BasePage {
  readonly addButton: Locator;
  readonly searchInput: Locator;
  readonly typeToggle: Locator;
  readonly tableRows: Locator;
  readonly addModal: Locator;
  readonly detailPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.addButton = page.getByRole("button", { name: /add item/i }).first();
    this.searchInput = page.getByPlaceholder(/search items/i);
    this.typeToggle = page.locator("[class*=SegmentedControl], [role=tablist]").first();
    this.tableRows = page.locator("tbody tr");
    this.addModal = page.locator('[role="dialog"]').first();
    this.detailPanel = page.locator('[role="dialog"]').first();
  }

  async goto() {
    await super.goto("/items");
  }

  // ── Presence ─────────────────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Items");
  }

  async expectDescription() {
    await expect(this.page.getByText("Products and services inventory")).toBeVisible();
  }

  async expectAddButton() {
    await expect(this.addButton).toBeVisible();
  }

  async expectSearchInput() {
    await expect(this.searchInput).toBeVisible();
  }

  async expectTypeFilter() {
    await expect(this.page.getByText("All").first()).toBeVisible();
    await expect(this.page.getByText("Products").first()).toBeVisible();
    await expect(this.page.getByText("Services").first()).toBeVisible();
  }

  async expectTableColumns() {
    // Only assert table columns when the table actually renders (not empty state)
    const hasTable = await this.page.locator("thead").count() > 0;
    if (!hasTable) return;

    const headers = ["Item", "Sale Price", "Stock", "Unit"];
    for (const h of headers) {
      await expect(
        this.page.locator("thead").getByText(h, { exact: false }).first(),
      ).toBeVisible();
    }
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

  async searchItems(query: string) {
    await this.searchInput.fill(query);
    await this.waitForTrpcResponse();
  }

  async clickItemRow(index = 0) {
    await this.tableRows.nth(index).click();
  }

  async rowCount(): Promise<number> {
    return this.tableRows.count();
  }

  async expectDetailPanelOpen() {
    await expect(this.detailPanel).toBeVisible({ timeout: 5_000 });
  }

  /** Fill the add item modal form with basic data */
  async fillAddItemForm(data: {
    name: string;
    salePrice: string;
    unit?: string;
    hsn?: string;
  }) {
    const dialog = this.addModal;
    await dialog.getByPlaceholder(/item name/i).fill(data.name);
    await dialog.getByPlaceholder(/sale.*price|selling.*price/i).first().fill(data.salePrice);
  }

  async submitAddItem() {
    await this.addModal.getByRole("button", { name: /save|add|create/i }).first().click();
  }
}
