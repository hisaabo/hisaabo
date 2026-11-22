import { test, type Page } from "@playwright/test";
import { SLUG } from "./fixtures";
import { mockStoreApi } from "./mockStore";

/**
 * Screenshot capture for design review; skipped unless STORE_SHOTS_DIR is set:
 *
 *   STORE_SHOTS_DIR=/tmp/shots STORE_SHOTS_PREFIX=after pnpm --filter @hisaabo/store test:e2e capture
 *
 * Writes `<prefix>-<view>-<width>.png` for the catalog, the catalog with the
 * cart open (below the minimum order, to show the disabled checkout button),
 * checkout and a policy modal at three viewport sizes.
 */
const DIR = process.env.STORE_SHOTS_DIR;
const PREFIX = process.env.STORE_SHOTS_PREFIX ?? "after";

const SIZES = [
  { width: 2000, height: 1100 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

test.skip(!DIR, "set STORE_SHOTS_DIR to capture screenshots");

const add = (page: Page, name: string) => page.getByRole("button", { name: `Add ${name}`, exact: true }).click();

async function openCartIfClosed(page: Page): Promise<void> {
  // Before the redesign a docked panel appeared by itself on wide screens.
  const button = page.getByRole("button", { name: /^(Cart with|Open cart)/ });
  if (await button.first().isVisible()) await button.first().click();
}

for (const { width, height } of SIZES) {
  test(`capture ${PREFIX} @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockStoreApi(page, { fonts: true });
    const shot = (view: string) => page.screenshot({ path: `${DIR}/${PREFIX}-${view}-${width}.png` });

    await page.goto(`/${SLUG}`);
    await page.getByText("Lakadong Turmeric Powder").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot("catalog");

    // One cheap item: below the 1000 minimum, so checkout is disabled.
    await add(page, "Stone-ground Whole Wheat Atta");
    await openCartIfClosed(page);
    await page.waitForTimeout(700);
    await shot("cart");

    // Close the drawer if there is one, then add enough to pass the minimum.
    await page.keyboard.press("Escape");
    const close = page.getByRole("button", { name: "Close cart" });
    if (await close.isVisible()) await close.click();
    await add(page, "Lakadong Turmeric Powder");
    await add(page, "Black Rice");
    await openCartIfClosed(page);
    await page.getByRole("button", { name: /proceed to checkout/i }).click();
    await page.getByLabel("Mobile number", { exact: true }).or(page.getByPlaceholder("9876543210")).fill("9876543210");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByLabel("Your name", { exact: true }).or(page.getByPlaceholder("Your name")).fill("Asha Verma");
    await page.getByRole("button", { name: /continue to checkout/i }).click();
    await page.getByText("Success!").waitFor();
    await page.waitForTimeout(500);
    await shot("checkout");

    // Policy modal on a fresh page load.
    await page.goto(`/${SLUG}`);
    await page.getByText("Lakadong Turmeric Powder").first().waitFor();
    await page.getByRole("button", { name: "Privacy Policy" }).click();
    await page.waitForTimeout(500);
    await shot("policy");
  });
}

// Extras for the redesigned storefront only (the old one has no photo cards to show).
for (const { width, height } of SIZES) {
  test(`capture extras ${PREFIX} @${width}`, async ({ page }) => {
    test.skip(PREFIX === "before", "the extras use the redesigned storefront");
    await page.setViewportSize({ width, height });
    await mockStoreApi(page, { fonts: true, photoLed: true });
    await page.goto(`/${SLUG}`);
    await page.getByText("Lakadong Turmeric Powder").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${DIR}/${PREFIX}-photos-${width}.png` });

    await page.getByRole("button", { name: "Raw Forest Honey", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "500 g" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/${PREFIX}-item-${width}.png` });
  });
}
