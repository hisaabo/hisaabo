/**
 * price-propagation.spec.ts — "Update saved prices?" in the invoice form.
 *
 * The owner (who can update items) edits a catalog item's rate on a new bill and
 * is asked ONCE whether to update the item's saved price:
 *   - [Update item prices]: the bill is created, then the item's price changes;
 *   - [Just this bill]:     the bill is created with the new rate, the item is untouched;
 *   - an unchanged rate:    no prompt at all.
 * Run it on its own with one worker: `E2E_WORKERS=1 pnpm exec playwright test flows/price-propagation.spec.ts`.
 */
import { test, expect, ApiHelper, waitForAppReady, settle } from "../helpers/fixtures";
import { loadSeed, SeedApi, createParty, createItem } from "../helpers/seed";
import { apiUrl } from "../helpers/worker";

let businessId: string;
let customerName: string;
let ts: number;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();
  ts = Date.now();
  customerName = `PP Customer ${ts}`;
  await createParty(api, businessId, { name: customerName });
});

/** A fresh item per test so the tests do not depend on each other's price changes. */
async function seedItem(name: string, salePrice: string) {
  const api = new SeedApi();
  return createItem(api, businessId, { name, salePrice, taxPercent: "18.00" });
}

async function openCreatorWithItem(page: import("@playwright/test").Page, itemName: string) {
  await page.goto("/invoices");
  await waitForAppReady(page);
  await page.getByRole("button", { name: /new invoice/i }).first().click();
  const creator = page.getByRole("dialog").first();
  await expect(creator).toBeVisible();

  const party = creator.getByRole("combobox", { name: /customer/i });
  await party.click();
  await party.fill(customerName);
  await settle(page);
  await page.getByRole("option", { name: new RegExp(customerName) }).first().click();

  const item = creator.getByPlaceholder(/select product or custom item/i).first();
  await item.click();
  await item.fill(itemName);
  await settle(page);
  await page.getByRole("option", { name: new RegExp(itemName) }).first().click();
  return creator;
}

async function itemPrice(page: import("@playwright/test").Page, itemId: string): Promise<string | null> {
  const api = new ApiHelper(page, apiUrl());
  const item = await api.query<{ salePrice: string | null }>("item.getById", { id: itemId }, { "x-business-id": businessId });
  return item.salePrice;
}

test.describe("Update saved prices from the invoice form", () => {
  test("[Update item prices] creates the bill, then updates the item's saved price", async ({ page }) => {
    const name = `PP Rice ${ts}-a`;
    const item = await seedItem(name, "450.00");
    const creator = await openCreatorWithItem(page, name);

    const price = creator.getByLabel("Unit price").first();
    await expect(price).toHaveValue("450.00");
    await price.fill("480");
    await creator.getByRole("button", { name: /create invoice/i }).click();

    const dialog = page.getByRole("dialog", { name: /update saved prices/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(1);
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await expect(dialog.getByText(name)).toBeVisible();
    await expect(dialog.getByText("₹450.00")).toBeVisible();
    await expect(dialog.getByText("₹480.00")).toBeVisible();
    // not saved until the user answers
    expect(await itemPrice(page, item.id)).toBe("450.00");

    await dialog.getByRole("button", { name: "Update item prices" }).click();

    await expect(page.getByText(/Updated 1 item price/)).toBeVisible();
    await expect(page.getByText(/Invoice .* created/)).toBeVisible();
    await expect.poll(() => itemPrice(page, item.id)).toBe("480.00");
  });

  test("[Just this bill] creates the bill at the new rate and leaves the item's price alone", async ({ page }) => {
    const name = `PP Ghee ${ts}-b`;
    const item = await seedItem(name, "620.00");
    const creator = await openCreatorWithItem(page, name);

    await creator.getByLabel("Unit price").first().fill("600");
    await creator.getByRole("button", { name: /create invoice/i }).click();

    const dialog = page.getByRole("dialog", { name: /update saved prices/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Just this bill" }).click();

    await expect(page.getByText(/Invoice .* created/)).toBeVisible();
    await expect(page.getByText(/Updated \d+ item price/)).toHaveCount(0);
    expect(await itemPrice(page, item.id)).toBe("620.00");
  });

  test("Esc on the prompt returns to the form: nothing is saved", async ({ page }) => {
    const name = `PP Dal ${ts}-c`;
    const item = await seedItem(name, "100.00");
    const creator = await openCreatorWithItem(page, name);

    await creator.getByLabel("Unit price").first().fill("110");
    await creator.getByRole("button", { name: /create invoice/i }).click();
    await expect(page.getByRole("dialog", { name: /update saved prices/i })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: /update saved prices/i })).toHaveCount(0);
    await expect(creator.getByLabel("Unit price").first()).toHaveValue("110");
    expect(await itemPrice(page, item.id)).toBe("100.00");
  });

  test("an unchanged rate saves straight away, with no prompt", async ({ page }) => {
    const name = `PP Salt ${ts}-d`;
    const item = await seedItem(name, "20.00");
    const creator = await openCreatorWithItem(page, name);

    await creator.getByRole("button", { name: /create invoice/i }).click();

    await expect(page.getByText(/Invoice .* created/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: /update saved prices/i })).toHaveCount(0);
    expect(await itemPrice(page, item.id)).toBe("20.00");
  });
});
