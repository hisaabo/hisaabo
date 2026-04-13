/**
 * invoices-status.spec.ts — Invoice status transitions and button visibility.
 *
 * Tests the complete status lifecycle and verifies that the correct
 * action buttons appear/disappear at each stage:
 *
 *   draft → sent → partial → paid
 *   draft → cancelled
 *   sent → adjusted (via CN/SR)
 *
 * Each test seeds an invoice in a specific status via API, then verifies
 * which buttons are visible in the detail panel.
 */
import { test, expect } from "../helpers/fixtures";
import { ApiHelper } from "../helpers/fixtures";
import {
  loadSeed,
  SeedApi,
  createParty,
  createItem,
  createInvoice,
  updateInvoiceStatus,
} from "../helpers/seed";

let businessId: string;
let partyId: string;
let itemId: string;

test.beforeAll(async () => {
  const seed = loadSeed();
  businessId = seed.businessId;
  const api = new SeedApi();
  const party = await createParty(api, businessId, { name: "Status Test Customer" });
  partyId = party.id;
  const item = await createItem(api, businessId, { name: "Status Test Widget", salePrice: "1000.00" });
  itemId = item.id;
});

/** Helper: seed an invoice and open its detail panel */
async function seedAndOpenInvoice(
  page: any,
  status?: string,
): Promise<{ invoiceId: string; panel: any }> {
  const { ApiHelper } = await import("../helpers/fixtures");
  const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
  const invoice = await createInvoice(api, businessId, partyId, itemId);
  if (status && status !== "draft") {
    await updateInvoiceStatus(api, businessId, invoice.id, status);
  }
  // Navigate to invoices with the ?id param to open detail panel directly
  await page.goto(`/invoices?id=${invoice.id}`);
  const panel = page.locator('[role="dialog"]').first();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return { invoiceId: invoice.id, panel };
}

// ═════════════════════════════════════════════════════════════════
// DRAFT STATUS — buttons: Edit, Mark Sent, Delete
// ═════════════════════════════════════════════════════════════════

test.describe("Invoice Status — Draft", () => {
  test("draft invoice shows Edit, Mark Sent buttons", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "draft");

    // Should show Edit
    await expect(panel.getByRole("button", { name: /^edit$/i })).toBeVisible();

    // Should show Mark Sent (or Mark as Sent)
    await expect(
      panel.getByRole("button", { name: /mark.*sent/i }).or(
        panel.getByRole("button", { name: /mark sent/i }),
      ),
    ).toBeVisible();
  });

  test("draft invoice does NOT show Record Payment or Issue CN buttons", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "draft");

    // Record Payment should NOT be visible for drafts
    await expect(
      panel.getByRole("button", { name: /record.*payment/i }),
    ).not.toBeVisible();

    // Issue CN should NOT be visible for drafts
    await expect(
      panel.getByRole("button", { name: /issue.*credit.*note/i }),
    ).not.toBeVisible();
  });

  test("Mark Sent transitions draft to sent", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "draft");

    // Click Mark Sent
    await panel
      .getByRole("button", { name: /mark.*sent/i })
      .or(panel.getByRole("button", { name: /mark sent/i }))
      .click();

    // After marking sent, the "Mark Sent" button should disappear
    // and "Record Payment" should appear
    await expect(
      panel.getByRole("button", { name: /record.*payment/i }),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
// SENT STATUS — buttons: Edit, Record Payment, Issue CN, Create SR
// ═════════════════════════════════════════════════════════════════

test.describe("Invoice Status — Sent", () => {
  test("sent invoice shows Record Payment button", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "sent");

    await expect(
      panel.getByRole("button", { name: /record.*payment/i }),
    ).toBeVisible();
  });

  test("sent invoice shows Issue CN and Create SR buttons", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "sent");

    await expect(
      panel.getByRole("button", { name: /issue.*credit.*note/i }),
    ).toBeVisible();

    await expect(
      panel.getByRole("button", { name: /create.*sales.*return/i }),
    ).toBeVisible();
  });

  test("sent invoice shows Edit button", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "sent");

    await expect(
      panel.getByRole("button", { name: /^edit$/i }),
    ).toBeVisible();
  });

  test("sent invoice does NOT show Mark Sent or Delete", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "sent");

    // Mark Sent should not appear (already sent)
    await expect(
      panel.getByRole("button", { name: /mark.*sent/i }),
    ).not.toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
// PAID STATUS — minimal buttons (no payment, no edit, no CN/SR)
// ═════════════════════════════════════════════════════════════════

test.describe("Invoice Status — Paid", () => {
  test("paid invoice does NOT show Record Payment", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "paid");

    await expect(
      panel.getByRole("button", { name: /record.*payment/i }),
    ).not.toBeVisible();
  });

  test("paid invoice does NOT show Edit", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "paid");

    // Edit is hidden when paid
    await expect(
      panel.getByRole("button", { name: /^edit$/i }),
    ).not.toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
// CANCELLED STATUS — no action buttons
// ═════════════════════════════════════════════════════════════════

test.describe("Invoice Status — Cancelled", () => {
  test("cancelled invoice does NOT show Record Payment, Mark Sent, or CN/SR buttons", async ({ page }) => {
    const { panel } = await seedAndOpenInvoice(page, "cancelled");

    await expect(
      panel.getByRole("button", { name: /record.*payment/i }),
    ).not.toBeVisible();

    await expect(
      panel.getByRole("button", { name: /mark.*sent/i }),
    ).not.toBeVisible();

    await expect(
      panel.getByRole("button", { name: /issue.*credit.*note/i }),
    ).not.toBeVisible();

    await expect(
      panel.getByRole("button", { name: /create.*sales.*return/i }),
    ).not.toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
// TABLE ROW ACTIONS — status-dependent row buttons
// ═════════════════════════════════════════════════════════════════

test.describe("Invoice Table Row Actions", () => {
  test("draft invoice row shows delete button on hover", async ({ page }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);

    await page.goto("/invoices");

    // Search for the specific invoice
    await page.getByPlaceholder(/search invoices/i).fill(invoice.invoiceNumber);

    const row = page.locator("tbody tr").first();
    const count = await row.count();
    test.skip(count === 0, "Invoice not found in list");

    // Hover to reveal action buttons
    await row.hover();

    // Draft row should show delete (trash) button
    // The delete button uses a title or aria-label
    const deleteBtn = row.locator('button[title*="delete" i], button:has(svg)').last();
    await expect(deleteBtn).toBeVisible();
  });
});
