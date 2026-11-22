import { expect, test, type Page } from "@playwright/test";
import { SLUG } from "./fixtures";
import { mockStoreApi } from "./mockStore";

/**
 * WCAG AA text contrast (4.5:1, or 3:1 for large text) on every text element
 * actually painted, in each state of the storefront, for the default accent and
 * for accents that a naive "white text on the accent" would fail on (yellow,
 * light blue). Backgrounds are resolved by compositing the translucent layers.
 */
function auditContrast(): string[] {
  type Rgba = { r: number; g: number; b: number; a: number };
  const parse = (c: string): Rgba => {
    const m = c.match(/[\d.]+/g)!.map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
  };
  const luminance = ({ r, g, b }: Rgba) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const backgroundOf = (el: Element): Rgba => {
    const layers: Rgba[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    let base: Rgba = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };

  const issues: string[] = [];
  const seen = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    if (el.closest("[inert]")) continue;
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (style.visibility === "hidden" || style.display === "none" || box.width === 0 || box.height === 0) continue;

    const background = backgroundOf(el);
    const text = over(parse(style.color), background);
    const [hi, lo] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    const needed = large ? 3 : 4.5;
    if (ratio >= needed) continue;

    const key = `${el.className}|${style.color}|${style.backgroundColor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(`${ratio.toFixed(2)} < ${needed}: ${el.tagName}.${String(el.className).slice(0, 40)} "${el.textContent!.trim().slice(0, 30)}"`);
  }
  return issues;
}

async function expectAccessible(page: Page, state: string): Promise<void> {
  expect(await page.evaluate(auditContrast), state).toEqual([]);
}

for (const accent of ["#2f7d4f", "#f5c518", "#7dd3fc"]) {
  test(`text contrast meets AA in every state, accent ${accent}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockStoreApi(page, { accent });
    await page.goto(`/${SLUG}`);
    await page.getByText("Lakadong Turmeric Powder").first().waitFor();
    await expectAccessible(page, "catalog");

    // The accent-filled option chip and the Add button, selected and not.
    await page.getByRole("button", { name: "Add Stone-ground Whole Wheat Atta", exact: true }).click();
    await expectAccessible(page, "catalog with a stepper");

    await page.getByRole("button", { name: /^Open cart/ }).click();
    await expectAccessible(page, "cart drawer, below the minimum order");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Privacy Policy" }).click();
    await expectAccessible(page, "policy dialog");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Add Lakadong Turmeric Powder", exact: true }).click();
    await page.getByRole("button", { name: /^Open cart/ }).click();
    await page.getByRole("button", { name: /proceed to checkout/i }).click();
    await expectAccessible(page, "phone dialog");

    await page.getByLabel("Mobile number", { exact: true }).fill("9876543210");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByLabel("Your name", { exact: true }).fill("Asha Verma");
    await page.getByRole("button", { name: /continue to checkout/i }).click();
    await page.getByText("Success!").waitFor();
    await expectAccessible(page, "checkout");
  });
}
