/**
 * busy-marker.spec.ts — Guards the ready signal the rest of the suite relies on.
 *
 * `settle(page)` replaces fixed sleeps and "any tRPC 200" waits, so if the web
 * app's `<html data-busy>` marker (apps/web/src/lib/busy-marker.ts) ever stops
 * covering in-flight queries or the search debounce, every test that settles
 * would start passing vacuously again. These tests fail first.
 */
import { test, expect, settle, waitForPageReady } from "../helpers/fixtures";

test.describe("Busy marker / settle()", () => {
  test("html[data-busy] is set while a list request is held, and settle() waits for it", async ({ page }) => {
    let releaseRequest!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route(
      (url) => url.pathname.includes("/api/trpc/") && url.pathname.includes("party.list"),
      async (route) => {
        await held;
        await route.continue();
      },
    );

    await page.goto("/parties");
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });

    // The party list request is stuck, so the app must say it is busy…
    await expect(page.locator("html")).toHaveAttribute("data-busy", "");

    // …and settle() must not resolve while it is. (A sleep is the right tool
    // here: the assertion is that nothing happens within the window.)
    let settled = false;
    const settling = settle(page, 20_000).then(() => {
      settled = true;
    });
    await page.waitForTimeout(500);
    expect(settled).toBe(false);

    releaseRequest();
    await settling;
    await expect(page.locator("html")).not.toHaveAttribute("data-busy", /.*/);
    // Settled means the list is there to be counted: the seeded customer is listed.
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });

  test("settle() after a search fill covers the debounce and the request it triggers", async ({ page }) => {
    await page.goto("/parties");
    await waitForPageReady(page);

    const searchTerm = `busy-marker-${Date.now()}`;
    const searchRequests: string[] = [];
    page.on("response", (response) => {
      const url = decodeURIComponent(response.url());
      if (url.includes("party.list") && url.includes(searchTerm)) searchRequests.push(url);
    });

    await page.getByPlaceholder(/search/i).first().fill(searchTerm);
    // No debounce wait of our own: settle() alone must carry us past the 300ms
    // debounce and through the response.
    await settle(page);

    expect(searchRequests.length).toBeGreaterThan(0);
    await expect(page.locator("tbody tr")).toHaveCount(0);
  });

  test("a mutation marks the app busy until it completes", async ({ page }) => {
    await page.goto("/invoices");
    await waitForPageReady(page);

    let releaseRequest!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route(
      (url) => url.pathname.includes("/api/trpc/") && url.pathname.includes("party.create"),
      async (route) => {
        await held;
        await route.continue();
      },
    );

    // Quick-create a party from the invoice creator: submits party.create.
    await page.getByRole("button", { name: /new invoice/i }).first().click();
    const creator = page.locator('[role="dialog"]').first();
    await expect(creator).toBeVisible({ timeout: 5_000 });
    const partyInput = creator.getByRole("combobox").first();
    const name = `Busy Marker Party ${Date.now()}`;
    await partyInput.click();
    await partyInput.fill(name);
    await settle(page);
    const createRow = page.getByRole("option").filter({ hasText: /Create customer/i });
    // Fail fast with a clear message instead of an unbounded click wait
    await expect(createRow).toBeVisible({ timeout: 5_000 });
    await createRow.click();
    const modal = page.getByRole("dialog").last();
    await modal.locator('input[type="tel"]').fill("9876543210");
    await modal.getByRole("button", { name: /Create & Select/i }).click();

    await expect(page.locator("html")).toHaveAttribute("data-busy", "");
    releaseRequest();
    await settle(page);
    await expect(page.locator("html")).not.toHaveAttribute("data-busy", /.*/);
    await expect(partyInput).toHaveValue(name);
  });
});
