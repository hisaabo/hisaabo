/**
 * party-merge.spec.ts — Test the party merge flow.
 *
 * Seeds two parties, opens a party detail panel, triggers the merge modal,
 * selects the target party, confirms the merge, and verifies the source is gone.
 *
 * Key UI facts (from parties.tsx):
 *   - "Merge" button lives in the PartyDetailPanel SlideOver footer — not the list itself.
 *   - The SlideOver renders as role="dialog".
 *   - MergePartyModal title: "Merge Parties"
 *   - Labels: "Merge FROM" (source, pre-set to the opened party) and "Merge INTO" (target selector).
 *   - Submit button text: "Merge & Delete" — disabled until target selected + checkbox confirmed.
 *   - Confirmation checkbox appears after target is selected.
 */
import { test, expect, waitForPageReady, waitForSearchResults } from "../helpers/fixtures";
import { loadSeed, SeedApi, createParty } from "../helpers/seed";

let businessId: string;
let sourcePartyName: string;
let targetPartyName: string;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();

  const ts = Date.now();
  sourcePartyName = `Merge Source ${ts}`;
  targetPartyName = `Merge Target ${ts}`;

  await createParty(api, businessId, { name: sourcePartyName });
  await createParty(api, businessId, { name: targetPartyName });
});

test.describe("Party Merge Flow", () => {
  test("source party row is visible in the parties list", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    // Search for the source party to confirm it was seeded
    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);

    await expect(page.getByText(sourcePartyName).first()).toBeVisible({ timeout: 5_000 });
  });

  test("clicking a party row opens the detail panel with a Merge button", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    // Search for source party and click its row
    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);

    const row = page.locator("tbody tr").filter({ hasText: sourcePartyName }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    // SlideOver detail panel opens (role="dialog")
    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // "Merge" button should be in the SlideOver footer
    await expect(panel.getByRole("button", { name: /^merge$/i })).toBeVisible({ timeout: 5_000 });
  });

  test("Merge button opens Merge Parties modal", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);

    const row = page.locator("tbody tr").filter({ hasText: sourcePartyName }).first();
    await row.click();

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });

    await panel.getByRole("button", { name: /^merge$/i }).click();

    // A second modal (or the same dialog updated) should show "Merge Parties" title
    await expect(page.getByText("Merge Parties").first()).toBeVisible({ timeout: 5_000 });
  });

  test("merge modal shows FROM and INTO sections with source pre-filled", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);

    const row = page.locator("tbody tr").filter({ hasText: sourcePartyName }).first();
    await row.click();

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel.getByRole("button", { name: /^merge$/i }).click();

    // Modal title
    await expect(page.getByText("Merge Parties").first()).toBeVisible({ timeout: 5_000 });

    // "Merge FROM" label and source party name pre-filled
    await expect(page.getByText(/merge from/i).first()).toBeVisible();
    // "Merge INTO" label visible (target not yet selected)
    await expect(page.getByText(/merge into/i).first()).toBeVisible();

    // Source party name should appear in the FROM column
    await expect(page.getByText(sourcePartyName).first()).toBeVisible();

    // "Merge & Delete" submit button should be disabled (no target yet)
    const submitBtn = page.getByRole("button", { name: /merge.*delete/i }).first();
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test("selecting a target party enables the confirmation step", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);

    const row = page.locator("tbody tr").filter({ hasText: sourcePartyName }).first();
    await row.click();

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel.getByRole("button", { name: /^merge$/i }).click();

    await expect(page.getByText("Merge Parties").first()).toBeVisible({ timeout: 5_000 });

    // Type target name in the search input inside the modal
    const searchInput = page.getByPlaceholder(/search parties/i).first();
    await searchInput.fill(targetPartyName);

    // Click the target party in the dropdown list
    const targetOption = page.getByRole("button", { name: new RegExp(targetPartyName, "i") }).first();
    await expect(targetOption).toBeVisible({ timeout: 5_000 });
    await targetOption.click();

    // INTO column should now show the target party name
    await expect(page.getByText(/merge into/i).first()).toBeVisible();
    await expect(page.getByText(targetPartyName).first()).toBeVisible();

    // Submit button should still be disabled (confirmation checkbox not checked yet)
    const submitBtn = page.getByRole("button", { name: /merge.*delete/i }).first();
    await expect(submitBtn).toBeDisabled();
  });

  test("full merge flow: select target, confirm, submit", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);

    const row = page.locator("tbody tr").filter({ hasText: sourcePartyName }).first();
    const rowCount = await row.count();
    // If source was already merged in a previous run, skip
    test.skip(rowCount === 0, "Source party not found — may have been merged already");

    await row.click();

    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel.getByRole("button", { name: /^merge$/i }).click();

    await expect(page.getByText("Merge Parties").first()).toBeVisible({ timeout: 5_000 });

    // Select the target party
    const searchInput = page.getByPlaceholder(/search parties/i).first();
    await searchInput.fill(targetPartyName);

    const targetOption = page.getByRole("button", { name: new RegExp(targetPartyName, "i") }).first();
    await expect(targetOption).toBeVisible({ timeout: 5_000 });
    await targetOption.click();

    // Tick the confirmation checkbox
    const checkbox = page.getByRole("checkbox").first();
    await expect(checkbox).toBeVisible({ timeout: 5_000 });
    await checkbox.check();

    // Submit button should now be enabled
    const submitBtn = page.getByRole("button", { name: /merge.*delete/i }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
    await submitBtn.click();

    // After successful merge, the modal should close and a success toast fires.
    // The source party should no longer appear in the list.
    await expect(page.getByText("Merge Parties")).toHaveCount(0, { timeout: 8_000 });

    // Search for the now-deleted source party — it should be gone
    await page.getByPlaceholder(/search by name/i).fill(sourcePartyName);
    await waitForSearchResults(page);
    await expect(page.getByText(sourcePartyName)).toHaveCount(0, { timeout: 5_000 });
  });
});
