import { expect, test, type Page } from "@playwright/test";
import { SLUG } from "./fixtures";
import { mockStoreApi, type MockOptions } from "./mockStore";

/** The visible regressions the storefront redesign fixed, one test each. */

async function openStore(page: Page, opts: MockOptions = {}): Promise<void> {
  await mockStoreApi(page, opts);
  await page.goto(`/${SLUG}`);
  await page.getByText("Lakadong Turmeric Powder").first().waitFor();
}

type Rect = { x: number; y: number; width: number; height: number; right: number; bottom: number };
const rectOf = (page: Page, selector: string, nth = 0) =>
  page.locator(selector).nth(nth).evaluate((el): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });

/** Add enough to pass the 1000 minimum, open the cart, go through the phone step to checkout. */
async function goToCheckout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add Lakadong Turmeric Powder", exact: true }).click();
  await page.getByRole("button", { name: /^Open cart/ }).click();
  await page.getByRole("button", { name: /proceed to checkout/i }).click();
  await page.getByLabel("Mobile number", { exact: true }).fill("9876543210");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Asha Verma");
  await page.getByRole("button", { name: /continue to checkout/i }).click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
}

test("the search icon does not sit on the placeholder", async ({ page }) => {
  await openStore(page);
  const icon = await rectOf(page, ".search-icon");
  const input = await rectOf(page, ".search-input");
  const textStart = await page
    .locator(".search-input")
    .evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  expect(icon.right).toBeLessThanOrEqual(textStart - 8);
  expect(icon.x).toBeGreaterThanOrEqual(input.x);
});

test("no 'low stock' badge on a store that holds no inventory", async ({ page }) => {
  await openStore(page); // the fixture reports inStock + lowStock on every item
  await expect(page.getByText(/low stock/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Black Rice", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/low stock/i)).toHaveCount(0);
  await expect(page.getByText("Available to order")).toBeVisible();
});

test("a store that tracks stock does not get the badge either, until the API says an item is running low", async ({ page }) => {
  await openStore(page, { trackStock: true });
  await expect(page.getByText(/low stock/i)).toHaveCount(0);
});

test("prices are written one way everywhere: Indian grouping, paise only when there are some", async ({ page }) => {
  await openStore(page);
  await expect(page.getByText("₹1,500", { exact: true }).first()).toBeVisible(); // card
  await expect(page.locator(".price", { hasText: "₹640.50" })).toBeVisible();

  const noUngroupedMoney = async () => {
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/₹\d{4}/); // "₹1500"
    expect(text).not.toMatch(/\.00\b/); // "₹1,500.00"
  };
  await noUngroupedMoney();

  await goToCheckout(page);
  await expect(page.getByText("₹1,500").first()).toBeVisible();
  await noUngroupedMoney();
});

test("image-less cards are compact and share one rhythm", async ({ page }) => {
  await openStore(page);
  const heights = await page.locator(".pcard").evaluateAll((cards) =>
    cards.map((c) => ({
      name: c.querySelector(".pcard-name")?.textContent ?? "",
      height: c.getBoundingClientRect().height,
      hasPhoto: Boolean(c.querySelector("img")),
    })),
  );
  for (const card of heights.filter((c) => !c.hasPhoto && ["Black Rice", "Rock Salt", "Moringa Leaf Powder"].includes(c.name))) {
    expect(card.height, `${card.name} should be compact`).toBeLessThan(180);
  }
  // The one photographed item keeps its picture, as a thumbnail, without stretching its row.
  const jam = heights.find((c) => c.name === "Mixed Fruit Jam")!;
  expect(jam.hasPhoto).toBe(true);
  expect(jam.height).toBeLessThan(220);
});

test("a photo-led catalog shows square pictures, with a tinted initial where an item has none", async ({ page }) => {
  await openStore(page, { photoLed: true });
  expect(await page.locator(".pcard[data-layout=photo]").count()).toBe(12);
  expect(await page.locator(".pcard-media img").count()).toBe(8);
  expect(await page.locator(".monogram").count()).toBe(4);
  const media = await rectOf(page, ".pcard-media");
  expect(Math.abs(media.width - media.height)).toBeLessThanOrEqual(1);
});

test("the footer, the grid and the masthead share one container", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStore(page);
  const grid = await rectOf(page, ".grid-products");
  const masthead = await rectOf(page, ".masthead");
  const footer = await rectOf(page, ".footer-grid");
  for (const other of [masthead, footer]) {
    expect(Math.abs(other.x - grid.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(other.right - grid.right)).toBeLessThanOrEqual(0.5);
  }
});

test("the disabled checkout button is clearly off and still legible; the minimum is spelled out", async ({ page }) => {
  await openStore(page);
  await page.getByRole("button", { name: "Add Stone-ground Whole Wheat Atta", exact: true }).click();
  await page.getByRole("button", { name: /^Open cart/ }).click();

  await expect(page.getByText("Minimum order is ₹1,000. Add ₹930 more to check out.")).toBeVisible();
  const button = page.getByRole("button", { name: /proceed to checkout/i });
  await expect(button).toBeDisabled();

  const ratio = await button.evaluate((el) => {
    const parse = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const style = getComputedStyle(el);
    const [a, b] = [lum(parse(style.color)), lum(parse(style.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test.describe("checkout layout", () => {
  test("desktop: two columns in the store's own container, the summary sticky", async ({ page }) => {
    // Short enough that the form scrolls: the summary has to stick to show it.
    await page.setViewportSize({ width: 1440, height: 560 });
    await openStore(page);
    const mastheadBefore = await rectOf(page, ".masthead");
    await goToCheckout(page);

    // Same masthead, same container as the storefront.
    const masthead = await rectOf(page, ".masthead");
    expect(Math.abs(masthead.x - mastheadBefore.x)).toBeLessThanOrEqual(0.5);
    await expect(page.getByText("Jaisa Organics").first()).toBeVisible();
    await expect(page.getByText("Farm-fresh spices, honey and staples from our family farm")).toBeVisible();

    const form = await rectOf(page, ".co-form");
    const aside = await rectOf(page, ".co-aside");
    const wrap = await rectOf(page, "main.wrap");
    expect(form.right).toBeLessThan(aside.x); // side by side
    expect(form.width).toBeGreaterThan(560); // uses the width, not a 450px column
    expect(wrap.width).toBeGreaterThan(1100);
    expect(Math.abs(aside.right - wrap.right + 32)).toBeLessThanOrEqual(1); // flush with the container's padding

    // Order, total, the store's note and the place-order button are all on the right.
    await expect(page.locator(".co-aside").getByText("Total")).toBeVisible();
    await expect(page.locator(".co-aside").getByText("We hold no inventory")).toBeVisible();
    await expect(page.locator(".co-aside").getByRole("button", { name: /place order/i })).toBeVisible();
    await expect(page.locator(".co-aside").getByText("Success!")).toBeVisible(); // the Turnstile widget

    // Sticky: scroll the long form, the summary stays in view.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(200);
    const stuck = await rectOf(page, ".co-aside");
    expect(stuck.y).toBeGreaterThanOrEqual(0);
    expect(stuck.y).toBeLessThan(40);
  });

  test("phone: one column, the order first and collapsed, then the form, then the button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStore(page);
    await goToCheckout(page);

    const summary = await rectOf(page, ".co-summary");
    const form = await rectOf(page, ".co-form");
    const place = await rectOf(page, ".co-place");
    expect(summary.bottom).toBeLessThanOrEqual(form.y + 1);
    expect(form.bottom).toBeLessThanOrEqual(place.y + 1);
    expect(Math.abs(summary.width - form.width)).toBeLessThanOrEqual(1);

    const toggle = page.getByRole("button", { name: /order summary/i });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".co-summary").getByText("Black Rice")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".co-summary").getByText("Lakadong Turmeric Powder")).toBeVisible();

    // Nothing runs off the side of the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("placing the order works and shows the confirmation", async ({ page }) => {
    await openStore(page);
    await goToCheckout(page);
    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
    await expect(page.getByText("ORD-00042")).toBeVisible();
    await expect(page.getByText("₹1,570")).toBeVisible();
  });
});

test("tap targets are at least 44px on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStore(page);
  const small = await page.evaluate(() => {
    // (A card's name is a text link whose hit area is stretched over the whole card: see the next test.)
    const selectors = [".btn", ".chip", ".opt", ".stepper-btn", ".icon-btn", ".cart-btn", ".search-input", ".link-btn"];
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selectors.join(","))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.height < 43.5) bad.push(`${el.className} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.height)}px`);
    }
    return bad;
  });
  expect(small).toEqual([]);
});

test("tapping a card anywhere outside its controls opens the item", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStore(page);
  // The empty strip to the right of a one-line name is a large target, not just the text.
  const card = page.locator(".pcard", { hasText: "Black Rice" });
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width - 24, box.y + 24);
  await expect(page.getByRole("dialog", { name: "Black Rice" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The controls inside the card still do their own job.
  await card.getByRole("button", { name: "Add Black Rice" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Add one more Black Rice" })).toBeVisible();
});
