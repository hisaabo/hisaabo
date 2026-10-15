import { test, expect, type Page } from "../helpers/fixtures";
import {
  loadSeed,
  SeedApi,
  createItem,
  createInvoice,
  createParty,
  updateInvoiceStatus,
} from "../helpers/seed";

const REGISTRY_CODE = "1001";
const REGISTRY_LABEL = "Payment to government employees other than union government employees";
const API_URL = process.env.API_URL ?? "http://localhost:3000";

async function watchBrowserHealth(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/trpc/") && response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  return { consoleErrors, failedRequests, failedResponses };
}

async function openPaymentPanel(page: Page, invoiceId: string, invoiceNumber?: string) {
  await page.goto(`/invoices?id=${invoiceId}`);
  const invoicePanel = page.locator('[role="dialog"]').first();
  await expect(invoicePanel).toBeVisible({ timeout: 10_000 });
  await invoicePanel.getByRole("button", { name: /record.*payment/i }).click();
  const paymentPanel = page.locator('[role="dialog"]').first();
  await expect(paymentPanel).toBeVisible({ timeout: 5_000 });
  if (invoiceNumber) {
    await expect(paymentPanel.getByText(invoiceNumber)).toBeVisible({ timeout: 10_000 });
  }
  return paymentPanel;
}

async function seedTdsSection(api: SeedApi, businessId: string, version: number) {
  return api.mutate("tdsSection.create", {
    sectionCode: REGISTRY_CODE,
    sectionLabel: "Incorrect caller label",
    effectiveFrom: "2026-04-01T00:00:00.000Z",
    status: "active",
    version,
  }, { "x-business-id": businessId });
}

test.describe("TDS payment allocation", () => {
  test("records, edits, replaces, and clears a gross TDS settlement", async ({ page, api }) => {
    const health = await watchBrowserHealth(page);
    const seed = loadSeed();
    const seedApi = new SeedApi(API_URL);
    const party = await createParty(seedApi, seed.businessId, { name: `TDS Customer ${Date.now()}` });
    const item = await createItem(seedApi, seed.businessId, {
      name: `TDS Item ${Date.now()}`,
      salePrice: "100000.00",
      taxPercent: "0.00",
    });
    const invoice = await createInvoice(seedApi, seed.businessId, party.id, item.id, {
      quantity: "1",
      unitPrice: "100000.00",
      taxPercent: "0.00",
    });
    const replacementInvoice = await createInvoice(seedApi, seed.businessId, party.id, item.id, {
      quantity: "1",
      unitPrice: "100000.00",
      taxPercent: "0.00",
    });
    await updateInvoiceStatus(seedApi, seed.businessId, invoice.id, "sent");
    await updateInvoiceStatus(seedApi, seed.businessId, replacementInvoice.id, "sent");
    await seedTdsSection(seedApi, seed.businessId, Date.now() % 1_000_000);

    const beforeTrialBalance = await api.query<{ accounts: Array<{ accountCode: string; debit: string; credit: string }> }>(
      "reports.trialBalance",
      { asOfDate: "2026-12-31T23:59:59.999Z", fromDate: "2026-01-01T00:00:00.000Z" },
      { "x-business-id": seed.businessId },
    );
    const beforeAccount = (code: string) => beforeTrialBalance.accounts.find((entry) => entry.accountCode === code);
    const initialCash = parseFloat(beforeAccount("1000")?.debit ?? "0");
    const initialTds = parseFloat(beforeAccount("1600")?.debit ?? "0");
    const initialArCredit = parseFloat(beforeAccount("1100")?.credit ?? "0");

    const paymentPanel = await openPaymentPanel(page, invoice.id, invoice.invoiceNumber);
    await paymentPanel.locator('input[type="number"]').nth(2).fill("100000.00");
    await expect(paymentPanel.locator("option").filter({ hasText: `${REGISTRY_CODE} - ${REGISTRY_LABEL}` })).toHaveCount(1);
    await paymentPanel.getByLabel("TDS Amount (₹)").fill("2000.00");
    await paymentPanel.getByLabel("TDS Rate (%)").fill("2.00");
    await paymentPanel.locator("select").selectOption(REGISTRY_CODE);
    await expect(paymentPanel.getByText(/Gross settlement: ₹100000\.00 \(cash ₹98000\.00\) \+ TDS ₹2000\.00/)).toBeVisible();

    await paymentPanel.getByRole("button", { name: /Record ₹98,000\.00/ }).click();
    await expect(paymentPanel).not.toBeVisible({ timeout: 10_000 });

    const paymentList = await api.query<{ data: Array<{ id: string; amount: string; paymentNumber: string; invoiceId: string | null }> }>(
      "payment.list",
      { page: 1, limit: 100 },
      { "x-business-id": seed.businessId },
    );
    const saved = paymentList.data.find((entry) => entry.invoiceId === invoice.id);
    expect(saved).toBeDefined();

    const paymentDetails = await api.query<typeof saved>("payment.getById", { id: saved!.id }, { "x-business-id": seed.businessId });
    expect(paymentDetails.amount).toBe("98000.00");
    expect(paymentDetails.linkedInvoices).toEqual(expect.arrayContaining([expect.objectContaining({
      invoiceId: invoice.id,
      amount: "100000.00",
      tdsAmount: "2000.00",
      tdsSectionCode: REGISTRY_CODE,
      tdsRate: "2.00",
    })]));
    const invoiceDetails = await api.query<{ amountPaid: string; status: string }>("invoice.getById", { id: invoice.id }, { "x-business-id": seed.businessId });
    expect(invoiceDetails.amountPaid).toBe("100000.00");
    expect(invoiceDetails.status).toBe("paid");

    const trialBalance = await api.query<{ accounts: Array<{ accountCode: string; debit: string; credit: string }>; totalDebit: string; totalCredit: string }>(
      "reports.trialBalance",
      { asOfDate: "2026-12-31T23:59:59.999Z", fromDate: "2026-01-01T00:00:00.000Z" },
      { "x-business-id": seed.businessId },
    );
    const account = (code: string) => trialBalance.accounts.find((entry) => entry.accountCode === code);
    expect((parseFloat(account("1000")?.debit ?? "0") - initialCash).toFixed(2)).toBe("98000.00");
    expect((parseFloat(account("1600")?.debit ?? "0") - initialTds).toFixed(2)).toBe("2000.00");
    expect((parseFloat(account("1100")?.credit ?? "0") - initialArCredit).toFixed(2)).toBe("100000.00");
    expect(trialBalance.totalDebit).toBe(trialBalance.totalCredit);

    await page.goto("/payments");
    await page.getByPlaceholder(/search/i).fill(saved!.paymentNumber);
    await page.waitForTimeout(400);
    await page.locator("tbody tr").first().click();
    const detail = page.locator('[role="dialog"]').first();
    await detail.getByRole("button", { name: /edit payment/i }).click();
    const editPanel = page.locator('[role="dialog"]').first();
    await expect(editPanel.getByLabel("TDS Amount (₹)")).toHaveValue("2000.00");
    await expect(editPanel.getByLabel("TDS Rate (%)")).toHaveValue("2.00");
    await editPanel.getByRole("button", { name: "Select All" }).click();
    await editPanel.getByRole("button", { name: "Clear All" }).click();
    await editPanel.getByRole("checkbox", { name: new RegExp(replacementInvoice.invoiceNumber) }).click();
    await expect(editPanel.getByText(replacementInvoice.invoiceNumber)).toBeVisible();
    await editPanel.getByLabel("TDS Amount (₹)").fill("0.00");
    await editPanel.getByLabel("TDS Rate (%)").fill("");
    await editPanel.locator("select").selectOption("");
    await editPanel.locator('input[type="number"]').nth(2).fill("98000.00");
    await editPanel.getByLabel("Payment Amount (₹)").fill("98000.00");
    await editPanel.getByRole("button", { name: /Save ₹98,000\.00/ }).click();
    await expect(editPanel).not.toBeVisible({ timeout: 10_000 });

    const replacedInvoice = await api.query<{ amountPaid: string }>("invoice.getById", { id: replacementInvoice.id }, { "x-business-id": seed.businessId });
    expect(replacedInvoice.amountPaid).toBe("98000.00");
    const reversedInvoice = await api.query<{ amountPaid: string }>("invoice.getById", { id: invoice.id }, { "x-business-id": seed.businessId });
    expect(reversedInvoice.amountPaid).toBe("0.00");

    await page.goto("/payments");
    await page.getByPlaceholder(/search/i).fill(saved!.paymentNumber);
    await page.waitForTimeout(400);
    await page.locator("tbody tr").first().click();
    await page.locator('[role="dialog"]').first().getByRole("button", { name: /edit payment/i }).click();
    const clearPanel = page.locator('[role="dialog"]').first();
    await expect(clearPanel.getByLabel("Payment Amount (₹)")).toHaveValue("98000.00");
    await api.mutate("payment.update", {
      id: saved!.id,
      allocations: [],
    }, { "x-business-id": seed.businessId });
    await clearPanel.getByRole("button", { name: "Cancel" }).click();
    await expect(clearPanel).not.toBeVisible({ timeout: 10_000 });
    const clearedInvoice = await api.query<{ amountPaid: string }>("invoice.getById", { id: replacementInvoice.id }, { "x-business-id": seed.businessId });
    expect(clearedInvoice.amountPaid).toBe("0.00");

    expect(health.consoleErrors).toEqual([]);
    expect(health.failedRequests).toEqual([]);
    expect(health.failedResponses).toEqual([]);
  });

  test("rejects positive TDS without a valid rate or section", async ({ page }) => {
    const seed = loadSeed();
    const seedApi = new SeedApi(API_URL);
    const party = await createParty(seedApi, seed.businessId, { name: `Invalid TDS Customer ${Date.now()}` });
    const item = await createItem(seedApi, seed.businessId, { name: `Invalid TDS Item ${Date.now()}`, taxPercent: "0.00" });
    const invoice = await createInvoice(seedApi, seed.businessId, party.id, item.id, {
      quantity: "1",
      unitPrice: "100000.00",
      taxPercent: "0.00",
    });
    await updateInvoiceStatus(seedApi, seed.businessId, invoice.id, "sent");

    const paymentPanel = await openPaymentPanel(page, invoice.id, invoice.invoiceNumber);
    await paymentPanel.locator('input[type="number"]').nth(2).fill("98000.00");
    await paymentPanel.getByLabel("TDS Amount (₹)").fill("2000.00");
    await paymentPanel.getByLabel("TDS Rate (%)").fill("0.00");
    await paymentPanel.getByRole("button", { name: /Record ₹96,000\.00/ }).click();
    await expect(page.getByText(/TDS amount requires section code and rate|TDS rate must be greater than zero/i)).toBeVisible();
    await expect(paymentPanel).toBeVisible();
  });
});
