import type { Page, Route } from "@playwright/test";
import { SLUG, buildCatalog, type FixtureOptions } from "./fixtures";

const SVG_ART = (hue: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" fill="hsl(${hue} 45% 88%)"/>
<rect x="130" y="110" width="140" height="190" rx="26" fill="hsl(${hue} 55% 42%)"/>
<rect x="150" y="80" width="100" height="40" rx="10" fill="hsl(${hue} 30% 30%)"/>
<circle cx="200" cy="205" r="42" fill="hsl(${hue} 60% 92%)"/></svg>`;

const TURNSTILE_STUB = `
window.turnstile = {
  render(el, opts) {
    el.innerHTML = '<div style="height:65px;border:1px solid #d0d0d0;border-radius:4px;display:flex;align-items:center;padding:0 16px;font:14px sans-serif;color:#333;background:#fafafa">Success!</div>';
    setTimeout(() => opts.callback("test-token"), 0);
    return "w1";
  },
  reset() {},
};`;

const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

export interface MockOptions extends FixtureOptions {
  /** Let Google Fonts through (screenshots); tests block it to stay hermetic. */
  fonts?: boolean;
}

/** Serves the store API from fixtures so the SPA runs with no backend. */
export async function mockStoreApi(page: Page, opts: MockOptions = {}): Promise<void> {
  const catalog = buildCatalog(opts);

  if (!opts.fonts) {
    // Match the exact hostname, not a substring of the URL: an unanchored pattern would also
    // swallow any URL that merely contains "fonts.googleapis.com" in its path or query.
    await page.route((url) => FONT_HOSTS.has(url.hostname), (r) => r.abort());
  }
  await page.route("https://challenges.cloudflare.com/**", (r) =>
    r.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }),
  );

  await page.route(new RegExp(`/store/${SLUG}/items/.*/images/`), (r) =>
    r.fulfill({ contentType: "image/svg+xml", body: SVG_ART(28) }),
  );

  await page.route(new RegExp(`/${SLUG}/catalog\\.json`), (route: Route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get("search")?.toLowerCase() ?? "";
    const category = url.searchParams.get("category") ?? "";
    const ids = url.searchParams.get("ids")?.split(",") ?? null;
    const items = catalog.items.filter(
      (i) =>
        (!search || i.name.toLowerCase().includes(search)) &&
        (!category || i.category === category) &&
        (!ids || ids.includes(i.id)),
    );
    return route.fulfill({ json: { ...catalog, items, total: items.length } });
  });

  await page.route(new RegExp(`/${SLUG}/identify$`), (r) => r.fulfill({ json: { known: false } }));
  await page.route(new RegExp(`/${SLUG}/otp/(send|verify)$`), (r) =>
    r.fulfill({ json: { otpToken: "otp", known: false } }),
  );
  await page.route(new RegExp(`/${SLUG}/order$`), (r) =>
    r.fulfill({ json: { orderId: "o1", orderNumber: "ORD-00042", totalAmount: "1570.00" } }),
  );
}
