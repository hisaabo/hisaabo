import { expect, test, type Page } from "@playwright/test";
import { SLUG } from "./fixtures";
import { mockStoreApi } from "./mockStore";

/**
 * Nothing on the page may move when the cart is used: not when the first item
 * is added, not when more are added, not when the cart opens or closes.
 *
 * Two independent measurements per step:
 *  - the browser's own layout-shift entries, summed with the "recent input"
 *    exemption ignored (a tap on Add would otherwise excuse the shift it
 *    causes, which is exactly the case under test), and
 *  - the boxes of landmarks across the page (brand, search, first and last
 *    card, footer link, and the body itself) before and after, with the scroll
 *    position held fixed.
 *
 * The scrollbar is real here (see playwright.config.ts), so a page that loses
 * its scrollbar when the cart locks scrolling shows up in both.
 */

const SIZES = [
  { width: 2000, height: 1100 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

type Box = { x: number; y: number; width: number; height: number };
type Boxes = Record<string, Box | null>;

async function observeShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: number[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__shifts.push((entry as unknown as { value: number }).value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

const shiftTotal = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts.reduce((a, b) => a + b, 0));

const resetShifts = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __shifts: number[] }).__shifts.length = 0;
  });

async function measure(page: Page): Promise<Boxes> {
  const landmarks = {
    brand: page.getByRole("heading", { level: 1 }),
    search: page.getByRole("searchbox"),
    firstCard: page.getByRole("heading", { name: "Lakadong Turmeric Powder" }),
    lastCard: page.getByRole("heading", { name: "Hand-pounded Red Rice" }),
    footerLink: page.getByRole("button", { name: "Privacy Policy" }),
  };
  const out: Boxes = {};
  for (const [name, locator] of Object.entries(landmarks)) {
    out[name] = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  }
  out.body = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  out.scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY, width: 0, height: 0 }));
  return out;
}

function expectStill(before: Boxes, after: Boxes, step: string): void {
  for (const name of Object.keys(before)) {
    const a = before[name];
    const b = after[name];
    expect(b, `${step}: ${name} vanished`).not.toBeNull();
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(a![key] - b![key]),
        `${step}: ${name}.${key} moved ${a![key]} -> ${b![key]}`,
      ).toBeLessThanOrEqual(0.5);
    }
  }
}

/** A click that does not scroll the target into view, so only layout moves things. */
const press = (page: Page, name: string | RegExp, within?: string) =>
  (within ? page.getByRole("dialog", { name: within }) : page)
    .getByRole("button", { name, exact: typeof name === "string" })
    .first()
    .dispatchEvent("click");

for (const { width, height } of SIZES) {
  for (const scrolled of [false, true]) {
    test.describe(`cart layout stability @${width}${scrolled ? " (scrolled)" : ""}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height });
        await observeShifts(page);
        await mockStoreApi(page);
        await page.goto(`/${SLUG}`);
        await page.getByText("Lakadong Turmeric Powder").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (scrolled) await page.evaluate(() => window.scrollTo(0, 420));
        await page.waitForTimeout(300);
        await resetShifts(page);
      });

      test("adding the first item, adding more, opening and closing the cart shift nothing", async ({ page }, info) => {
        const report: string[] = [];
        let before = await measure(page);

        // 1. The first item in an empty cart.
        await press(page, "Add Black Rice");
        await page.waitForTimeout(500);
        let after = await measure(page);
        report.push(`first item ${(await shiftTotal(page)).toFixed(4)}`);
        expectStill(before, after, "first item added");

        // 2. More items, including a stepper change.
        before = after;
        await press(page, "Add Jaggery Powder");
        await press(page, /^Add one more/);
        await page.waitForTimeout(400);
        after = await measure(page);
        report.push(`more items ${(await shiftTotal(page)).toFixed(4)}`);
        expectStill(before, after, "more items added");

        // 3. Open the cart.
        before = after;
        await page.getByRole("button", { name: /^Open cart/ }).click();
        await expect(page.getByRole("dialog", { name: /your cart/i })).toBeVisible();
        await page.waitForTimeout(600);
        after = await measure(page);
        report.push(`cart opened ${(await shiftTotal(page)).toFixed(4)}`);
        expectStill(before, after, "cart opened");

        // 4. Change quantities inside the cart, then close it.
        await press(page, /^Add one more/, "Your cart");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.waitForTimeout(400);
        after = await measure(page);
        report.push(`cart closed ${(await shiftTotal(page)).toFixed(4)}`);
        expectStill(before, after, "cart closed");

        // Layout-shift entries, summed from the start of the test (cumulative).
        const total = await shiftTotal(page);
        info.annotations.push({ type: "layout shift (cumulative)", description: report.join(", ") });
        console.log(`[layout shift @${width}${scrolled ? " scrolled" : ""}] ${report.join(", ")}`);
        expect(total).toBeLessThan(0.001);
      });
    });
  }
}
