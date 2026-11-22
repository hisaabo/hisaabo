import { expect, test, type Page } from "@playwright/test";
import { SLUG } from "./fixtures";
import { mockStoreApi } from "./mockStore";

/** Every dialog of the storefront: Esc, focus trap, focus return, labels, the page behind. */

async function openStore(page: Page): Promise<void> {
  await mockStoreApi(page);
  await page.goto(`/${SLUG}`);
  await page.getByText("Lakadong Turmeric Powder").first().waitFor();
}

const activeIsInside = (page: Page, selector: string) =>
  page.evaluate((s) => Boolean(document.activeElement?.closest(s)), selector);

test.describe("policy dialogs", () => {
  for (const policy of ["Privacy Policy", "Terms of Service", "Refund Policy"]) {
    test(`${policy}: Esc closes it and focus returns to its link`, async ({ page }) => {
      await openStore(page);
      const trigger = page.getByRole("button", { name: policy });
      await trigger.focus();
      await trigger.press("Enter");

      const dialog = page.getByRole("dialog", { name: policy });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

  test("focus stays inside while it is open, in both directions", async ({ page }) => {
    await openStore(page);
    await page.getByRole("button", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("dialog", { name: "Privacy Policy" })).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await activeIsInside(page, "[role=dialog]"), `tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await activeIsInside(page, "[role=dialog]"), `shift+tab ${i + 1}`).toBe(true);
    }
  });

  test("the backdrop and the close button close it; the page behind is inert and scroll is locked", async ({ page }) => {
    await openStore(page);
    await page.getByRole("button", { name: "Terms of Service" }).click();
    await expect(page.getByRole("dialog", { name: "Terms of Service" })).toBeVisible();

    expect(await page.evaluate(() => document.querySelector("main")?.hasAttribute("inert"))).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");

    await page.mouse.click(8, 8); // on the backdrop, away from the panel
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector("main")?.hasAttribute("inert"))).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");

    await page.getByRole("button", { name: "Terms of Service" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("item, cart and phone dialogs", () => {
  test("the item view is a labelled dialog that closes on Esc and returns focus", async ({ page }) => {
    await openStore(page);
    const name = page.getByRole("button", { name: "Black Rice", exact: true });
    await name.focus();
    await name.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Black Rice" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(name).toBeFocused();
  });

  test("the cart drawer closes on Esc and returns focus to the cart button", async ({ page }) => {
    await openStore(page);
    const cartButton = page.getByRole("button", { name: /^Open cart/ });
    await cartButton.click();
    const drawer = page.getByRole("dialog", { name: /your cart/i });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(cartButton).toBeFocused();
  });

  test("phone verification opens above the cart; Esc closes only it and focus returns to Proceed", async ({ page }) => {
    await openStore(page);
    // Enough to pass the minimum order (1500 + 120... turmeric alone is above 1000).
    await page.getByRole("button", { name: "Add Lakadong Turmeric Powder", exact: true }).click();
    await page.getByRole("button", { name: /^Open cart/ }).click();

    const proceed = page.getByRole("button", { name: /proceed to checkout/i });
    await expect(proceed).toBeEnabled();
    await proceed.click();

    const phone = page.getByRole("dialog", { name: "Enter your mobile number" });
    await expect(phone).toBeVisible();
    await expect(page.getByLabel("Mobile number", { exact: true })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(phone).toHaveCount(0);
    // The cart drawer is still there, and focus is back on the button that opened the step.
    await expect(page.getByRole("dialog", { name: /your cart/i })).toBeVisible();
    await expect(proceed).toBeFocused();
  });

  test("keyboard: Add hands focus to the stepper, and removing the last one hands it back", async ({ page }) => {
    await openStore(page);
    const add = page.getByRole("button", { name: "Add Black Rice", exact: true });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Add one more Black Rice" })).toBeFocused();

    await page.keyboard.press("Shift+Tab"); // the bin button
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Add Black Rice", exact: true })).toBeFocused();
  });
});
