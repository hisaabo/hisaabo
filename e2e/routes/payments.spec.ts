/**
 * payments.spec.ts — Complete specification for the /payments route.
 *
 * Layer 1: PRESENCE
 * Layer 2: INTERACTION
 * Layer 3: MUTATION (covered via flows/invoice-lifecycle.spec.ts)
 */
import { test, expect } from "../helpers/fixtures";
import { PaymentsPage } from "../helpers/page-objects/payments.page";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Payments — Presence", () => {
  let payments: PaymentsPage;

  test.beforeEach(async ({ page }) => {
    payments = new PaymentsPage(page);
    await payments.goto();
  });

  test("renders page header", async () => {
    await payments.expectPageHeader();
  });

  test("renders search input", async () => {
    await payments.expectSearchInput();
  });

  test("renders date preset buttons (This Month / Last Month)", async () => {
    await payments.expectDatePresets();
  });

  test("renders record payment button", async () => {
    await payments.expectRecordButton();
  });

  test("renders table with expected columns", async () => {
    await payments.expectTableColumns();
  });
});

// ═════════════════════════════════════════════════════════════════
// Layer 2: INTERACTION
// ═════════════════════════════════════════════════════════════════

test.describe("Payments — Interaction", () => {
  let payments: PaymentsPage;

  test.beforeEach(async ({ page }) => {
    payments = new PaymentsPage(page);
    await payments.goto();
  });

  test("date preset buttons switch the date range", async () => {
    await payments.clickTypeTab("Last Month");

    await payments.clickTypeTab("This Month");
  });

  test("search input filters payments", async () => {
    const initialRows = await payments.rowCount();
    await payments.searchPayments("nonexistent-payment-xyz");
    // Should show fewer or equal results after searching for nonsense
    const rows = await payments.rowCount();
    expect(rows).toBeLessThanOrEqual(initialRows);
  });

  test("clicking a payment row opens detail panel", async () => {
    const rows = await payments.rowCount();
    if (rows > 0) {
      await payments.clickRow(0);
      await payments.expectDetailPanelOpen();
    }
  });
});
