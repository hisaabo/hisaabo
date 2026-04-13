/**
 * reports.spec.ts — Layer 1 (Presence) specification for /reports.
 *
 * The Reports page uses a two-panel layout:
 *   - Left sidebar: group headings (Financial, Receivables & Payables,
 *     Inventory, Payments & Tax) with individual report buttons beneath each.
 *   - Right panel: active report content with a sticky date-range bar.
 *
 * Default active report is "Daybook" (persisted in localStorage; the global
 * setup uses a fresh context so localStorage is empty → falls back to daybook).
 */
import { test, expect } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Reports — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reports");
    await page
      .locator(".animate-pulse")
      .first()
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  });

  test("renders sidebar with Daybook entry visible", async ({ page }) => {
    // Sidebar always renders all report buttons; Daybook is in the Financial group
    await expect(
      page.getByText("Daybook").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("renders report group headings", async ({ page }) => {
    // Each group label is rendered as uppercase tracking text above the report list
    for (const group of ["Financial", "Receivables", "Inventory", "Payments"]) {
      await expect(
        page.getByText(group, { exact: false }).first(),
      ).toBeVisible();
    }
  });

  test("renders individual report buttons in sidebar", async ({ page }) => {
    for (const report of [
      "Daybook",
      "Sales Register",
      "Outstanding Report",
    ]) {
      await expect(page.getByText(report).first()).toBeVisible();
    }
  });
});
