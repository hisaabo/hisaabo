/**
 * global-setup.ts — Authenticate once, persist session for all tests.
 *
 * Registers a test user via the UI, creates a business via tRPC API,
 * then saves the browser storage state (cookies) so all test projects
 * can reuse the session without logging in again.
 *
 * Login page flow: magic-link (default) → password-login → register
 * Business creation: done via API (more reliable than filling the complex form)
 */
import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

setup("authenticate", async ({ page, request }) => {
  // Ensure .auth directory exists
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const email = `e2e-${Date.now()}@test.hisaabo.in`;
  const password = "Test@1234!";
  const name = "E2E Test User";

  // ── Step 1: Register via UI ───────────────────────────────────
  await page.goto("/login");

  // magic-link → password-login → register
  await page.getByText("Use password instead").click();
  await page.getByText("Create one").click();
  await expect(page.getByText("Create your account")).toBeVisible();

  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("you@yourcompany.com").fill(email);
  await page.getByPlaceholder("Min 8 characters").fill(password);
  await page.getByPlaceholder("Repeat password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for redirect away from login
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  // ── Step 2: Create business via API ───────────────────────────
  // Extract cookies from the browser context to use in API calls
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const apiUrl = process.env.API_URL ?? "http://localhost:3000";

  const createBizRes = await request.post(`${apiUrl}/api/trpc/business.create`, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "hisaabo",
      Cookie: cookieHeader,
    },
    data: {
      json: {
        name: "E2E Test Business",
        gstRegistrationType: "unregistered",
        pan: "AAACE0000A",
        phone: "9876500000",
        email: email,
        address: "123 Test Road",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        currency: "INR",
      },
    },
  });

  expect(createBizRes.ok(), `business.create failed: ${await createBizRes.text()}`).toBeTruthy();

  // ── Step 3: Verify we're in the main app ──────────────────────
  // Reload to pick up the new business
  await page.goto("/invoices");
  await expect(page.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });

  // Save authenticated state
  await page.context().storageState({ path: AUTH_FILE });
});
