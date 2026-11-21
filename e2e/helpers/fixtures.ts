/**
 * fixtures.ts — Custom Playwright test fixtures for Hisaabo E2E tests.
 *
 * Provides:
 *   - Authenticated page (via storageState from global-setup)
 *   - API helper for calling tRPC procedures directly (seeding)
 *   - Common navigation helpers
 */
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { settle } from "./settle";
import { apiUrl, baseUrl, ownerStorageStatePath } from "./worker";

export { settle };
export type { Page };

/**
 * index.html pulls in Google Fonts (a render-blocking stylesheet that also
 * delays the `load` event and script execution) and Cloudflare's Turnstile
 * script. Every test starts a fresh browser context, so each page load paid a
 * fresh round trip to the public internet and could stall on a slow or
 * unreachable host (the one baseline failure, gst.spec's `page.goto`, was a 30s
 * wait for `load` during which the app made no requests at all). Serve them
 * empty instead: nothing under test depends
 * on web fonts or on the Turnstile widget (the e2e web build has no Turnstile
 * site key, so sign-in never opens the challenge). E2E_ALLOW_EXTERNAL=1 (or
 * E2E_DEV=1, whose dev build does use Turnstile's test key) restores real fetches.
 */
const THIRD_PARTY_HOSTS: Record<string, string> = {
  "fonts.googleapis.com": "text/css",
  "fonts.gstatic.com": "font/woff2",
  "challenges.cloudflare.com": "text/javascript",
};

export async function stubThirdParty(context: BrowserContext): Promise<void> {
  if (process.env.E2E_ALLOW_EXTERNAL === "1" || process.env.E2E_DEV === "1") return;
  await context.route(
    (url) => url.hostname in THIRD_PARTY_HOSTS,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: THIRD_PARTY_HOSTS[new URL(route.request().url()).hostname],
        body: "",
      }),
  );
}

/** `browser.newContext()` with the third-party stubs applied. */
export async function newContext(browser: Browser, options?: BrowserContextOptions): Promise<BrowserContext> {
  // baseURL explicitly: contexts made from hooks (beforeAll) would otherwise get the config's, i.e. worker 0's.
  const context = await browser.newContext({ baseURL: baseUrl(), ...options });
  await stubThirdParty(context);
  return context;
}

/** Helper to call tRPC mutations/queries directly via HTTP for seeding */
export class ApiHelper {
  constructor(
    private page: Page,
    private baseUrl: string,
  ) {}

  /** Call a tRPC mutation via HTTP POST, using the browser's auth cookies */
  async mutate<T = unknown>(
    procedure: string,
    input: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const cookies = await this.page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await fetch(`${this.baseUrl}/api/trpc/${procedure}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "hisaabo",
        Cookie: cookieHeader,
        ...headers,
      },
      body: JSON.stringify({ json: input }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tRPC ${procedure} failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.result?.data?.json ?? data.result?.data ?? data;
  }

  /** Call a tRPC query via HTTP GET */
  async query<T = unknown>(
    procedure: string,
    input?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const cookies = await this.page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const inputParam = input
      ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : "";

    const res = await fetch(
      `${this.baseUrl}/api/trpc/${procedure}${inputParam}`,
      {
        method: "GET",
        headers: {
          "X-Requested-With": "hisaabo",
          Cookie: cookieHeader,
          ...headers,
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tRPC ${procedure} query failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.result?.data?.json ?? data.result?.data ?? data;
  }
}

/** Extended test fixtures */
export const test = base.extend<{
  api: ApiHelper;
}>({
  context: async ({ context }, use) => {
    await stubThirdParty(context);
    await use(context);
  },
  // Every worker has its own web server, API and owner session (see worker.ts).
  baseURL: async ({}, use, testInfo) => {
    await use(baseUrl(testInfo.parallelIndex));
  },
  storageState: async ({}, use, testInfo) => {
    await use(ownerStorageStatePath(testInfo.parallelIndex));
  },
  api: async ({ page }, use) => {
    const api = new ApiHelper(page, apiUrl());
    await use(api);
  },
});

export { expect };

/**
 * Wait for the app to be fully loaded: the route rendered (positive signal: the
 * PageHeader h1) and the app has no query, mutation or debounce in flight, so
 * lists are populated (or empty for real) before the test counts rows or
 * asserts that something is absent.
 */
export async function waitForAppReady(page: Page) {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });
  await settle(page);
}

/**
 * Same as waitForAppReady. Use in inline beforeEach blocks that don't use a PageObject.
 */
export async function waitForPageReady(page: Page) {
  await waitForAppReady(page);
}

/**
 * Wait for a debounced search (page.fill() on a search input) to finish: the
 * debounce, the request it triggers and the re-render. Use after page.fill()
 * on search inputs in inline tests.
 */
export async function waitForSearchResults(page: Page) {
  await settle(page);
}

/**
 * Ensure we're on a specific route and the page header is visible.
 */
export async function navigateAndWait(page: Page, path: string) {
  await page.goto(path);
  await waitForAppReady(page);
}
