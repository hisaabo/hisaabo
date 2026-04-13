/**
 * base.page.ts — Base page object for all route page objects.
 *
 * Contains common selectors and assertions shared across all routes:
 * sidebar navigation, page header pattern, loading states, etc.
 */
import { type Page, type Locator, expect } from "@playwright/test";

export class BasePage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly pageHeader: Locator;
  readonly pageDescription: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.locator("nav, aside").first();
    this.pageHeader = page.locator("h1").first();
    this.pageDescription = page.locator("h1 + p, [class*=description]").first();
  }

  /** Navigate to a route and wait for the page to settle */
  async goto(path: string) {
    await this.page.goto(path);
    await this.waitForReady();
  }

  /** Wait for loading indicators to disappear */
  async waitForReady() {
    // Wait for positive signal: h1 from PageHeader means the route rendered
    await this.page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });

    // Now wait for skeleton rows to disappear (used across list pages)
    await this.page
      .locator(".animate-pulse")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {
        /* no skeleton — fine */
      });

    // Also wait for any loading spinners
    await this.page
      .locator('[role="status"]')
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {
        /* no spinner — fine */
      });
  }

  /** Wait for a tRPC network response after a debounced action (e.g. search) */
  protected async waitForTrpcResponse(timeout = 5_000) {
    await this.page.waitForResponse(
      (resp) => resp.url().includes("/api/trpc/") && resp.status() === 200,
      { timeout },
    ).catch(() => {});
  }

  /** Assert the page title matches expected text */
  async expectTitle(text: string | RegExp) {
    await expect(this.pageHeader).toContainText(text);
  }

  /** Assert search input is present */
  async expectSearchInput() {
    await expect(
      this.page.getByPlaceholder(/search/i).first(),
    ).toBeVisible();
  }

  /** Type into the search input and wait for results */
  async search(query: string) {
    const input = this.page.getByPlaceholder(/search/i).first();
    await input.fill(query);
    await this.waitForTrpcResponse();
  }

  /** Click a status/filter tab by label text */
  async clickTab(label: string) {
    await this.page
      .getByRole("button", { name: label })
      .or(this.page.locator(`button:has-text("${label}")`))
      .first()
      .click();
  }

  /** Assert a table has specific column headers */
  async expectTableHeaders(headers: string[]) {
    const headerRow = this.page.locator("thead tr, [role=row]").first();
    for (const h of headers) {
      await expect(
        headerRow.getByText(h, { exact: false }),
      ).toBeVisible();
    }
  }

  /** Assert table has at least N rows (body rows, not header) */
  async expectMinRows(count: number) {
    const rows = this.page.locator("tbody tr, [role=row]");
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });
    const actual = await rows.count();
    expect(actual).toBeGreaterThanOrEqual(count);
  }

  /** Get count of visible table body rows */
  async getRowCount(): Promise<number> {
    return this.page.locator("tbody tr").count();
  }

  /** Assert empty state is shown */
  async expectEmptyState(text?: string | RegExp) {
    const empty = this.page.locator(
      '[class*="empty"], [data-testid="empty-state"]',
    );
    await expect(empty.first()).toBeVisible({ timeout: 5_000 });
    if (text) {
      await expect(empty.first()).toContainText(text);
    }
  }

  /** Assert a button with given text is visible */
  async expectButton(name: string | RegExp) {
    await expect(
      this.page.getByRole("button", { name }).first(),
    ).toBeVisible();
  }

  /** Click a button by accessible name */
  async clickButton(name: string | RegExp) {
    await this.page.getByRole("button", { name }).first().click();
  }

  /** Assert a modal/dialog is open */
  async expectModalOpen(title?: string | RegExp) {
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    if (title) {
      await expect(dialog).toContainText(title);
    }
  }

  /** Assert a slide-over panel is visible */
  async expectSlideOverOpen() {
    // SlideOver uses Headless UI Dialog or custom slide-over
    await expect(
      this.page.locator('[role="dialog"], [class*="slide-over"], [class*="SlideOver"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  }

  /** Close any open modal by pressing Escape */
  async closeModal() {
    await this.page.keyboard.press("Escape");
  }
}
