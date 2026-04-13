/**
 * login-negative.spec.ts — Login page error handling and validation.
 *
 * Tests negative paths: wrong credentials, validation errors, and
 * unauthenticated redirects. These tests use fresh browser contexts
 * WITHOUT storageState to simulate unauthenticated users.
 */
import { test, expect } from "../helpers/fixtures";

test.describe("Login Negative Paths", () => {
  test("login page renders with magic link mode by default", async ({ browser }) => {
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

    // Should show "Use password instead" link
    await expect(page.getByText(/use password instead/i).first()).toBeVisible();

    await page.close();
    await ctx.close();
  });

  test("switching to password mode shows password field", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/login");
    await page.getByPlaceholder("you@yourcompany.com").waitFor({ state: "visible", timeout: 10_000 });

    // Switch to password mode
    await page.getByText(/use password instead/i).first().click();

    // Should now show password field
    await expect(page.getByPlaceholder("Min 8 characters")).toBeVisible();

    // Should show "Sign in" button
    await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible();

    await page.close();
    await ctx.close();
  });

  test("wrong password shows error message", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/login");
    await page.getByPlaceholder("you@yourcompany.com").waitFor({ state: "visible", timeout: 10_000 });

    // Switch to password mode
    await page.getByText(/use password instead/i).first().click();

    // Fill in email and wrong password
    await page.getByPlaceholder("you@yourcompany.com").fill("nonexistent-user@test.hisaabo.in");
    await page.getByPlaceholder("Min 8 characters").fill("WrongPassword123!");

    // Click Sign in
    await page.getByRole("button", { name: /sign in/i }).first().click();

    // Either an error toast or inline error should appear
    await expect(
      page.getByText(/invalid|error|incorrect|wrong|not found|failed/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    await page.close();
    await ctx.close();
  });

  test("register with mismatched passwords shows error", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/login");
    await page.getByPlaceholder("you@yourcompany.com").waitFor({ state: "visible", timeout: 10_000 });

    // Switch to password mode then register
    await page.getByText(/use password instead/i).first().click();
    await page.getByText(/create one/i).first().click();

    // Should show register form
    await expect(page.getByPlaceholder("Your name")).toBeVisible();
    await expect(page.getByPlaceholder("Repeat password")).toBeVisible();

    // Fill form with mismatched passwords
    await page.getByPlaceholder("Your name").fill("Test User");
    await page.getByPlaceholder("you@yourcompany.com").fill(`mismatch-${Date.now()}@test.hisaabo.in`);
    await page.getByPlaceholder("Min 8 characters").fill("Test@1234!");
    await page.getByPlaceholder("Repeat password").fill("DifferentPass123!");

    // Click Create account
    await page.getByRole("button", { name: /create account/i }).first().click();

    // Should show error about password mismatch
    await expect(
      page.getByText(/match|mismatch|same|don't match|do not match/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    await page.close();
    await ctx.close();
  });

  test("unauthenticated user visiting /invoices is redirected to /login", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    await page.close();
    await ctx.close();
  });

  test("unauthenticated user visiting /parties is redirected to /login", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto("/parties");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    await page.close();
    await ctx.close();
  });
});
