/**
 * login-negative.spec.ts — Login page error handling and validation.
 *
 * Tests negative paths: validation errors, and
 * unauthenticated redirects. These tests use fresh browser contexts
 * WITHOUT storageState to simulate unauthenticated users.
 */
import { test, expect } from "../helpers/fixtures";

test.describe("Login Negative Paths", () => {
  test("login page renders magic link sign-in with no password option", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/login");
    await page.getByPlaceholder("you@yourcompany.com").waitFor({ state: "visible", timeout: 10_000 });

    // Should show Hisaabo branding
    await expect(page.getByText("Hisaabo").first()).toBeVisible();

    // Should show email input
    await expect(page.getByPlaceholder("you@yourcompany.com")).toBeVisible();

    // Should show "Send magic link" button
    await expect(page.getByRole("button", { name: /send magic link|sign in/i }).first()).toBeVisible();

    // Password sign-in was removed: no password link or field
    await expect(page.getByText(/use password instead/i)).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.close();
    await ctx.close();
  });

  test("invalid email is rejected without sending a magic link", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/login");
    const email = page.getByPlaceholder("you@yourcompany.com");
    await email.waitFor({ state: "visible", timeout: 10_000 });

    await email.fill("not-an-email");
    await page.getByRole("button", { name: /send magic link|sign in|continue/i }).first().click();

    // Stays on the login page; no "check your email" confirmation appears
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/check your (email|inbox)/i)).toHaveCount(0);

    await page.close();
    await ctx.close();
  });

  test("unauthenticated user visiting /invoices is redirected to /login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await page.close();
    await ctx.close();
  });

  test("unauthenticated user visiting /parties is redirected to /login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/parties");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await page.close();
    await ctx.close();
  });
});
