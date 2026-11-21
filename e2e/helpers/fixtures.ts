/**
 * fixtures.ts — Custom Playwright test fixtures for Hisaabo E2E tests.
 *
 * Provides:
 *   - Authenticated page (via storageState from global-setup)
 *   - API helper for calling tRPC procedures directly (seeding)
 *   - Common navigation helpers
 */
import { test as base, expect, type Page } from "@playwright/test";
import { settle } from "./settle";

export { settle };
export type { Page };

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
  api: async ({ page }, use) => {
    const baseUrl = process.env.API_URL ?? "http://localhost:3000";
    const api = new ApiHelper(page, baseUrl);
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
