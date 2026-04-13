/**
 * role-visibility.spec.ts — Verifies nav items and route access per role.
 *
 * For each role (seller, accountant), this test:
 *   1. Invites a user with that role (via owner's API)
 *   2. Registers the invited user via UI
 *   3. Visits the invite link to accept
 *   4. Verifies which sidebar nav items are visible vs. hidden
 *   5. Verifies which routes are accessible vs. redirected
 *
 * Only tests seller + accountant (the two most different permission sets)
 * because the free plan limits to 3 team members total.
 */
import { test, expect, ApiHelper } from "../helpers/fixtures";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

/** Nav items that each role should see in the sidebar */
const ROLE_NAV_VISIBLE: Record<string, string[]> = {
  seller: [
    "Invoices",
    "Quotations",
    "Sales Returns",
    "Credit Notes",
    "Delivery Challans",
    "Proforma Invoices",
    "Parties",
    "Items",
    "Payments",
  ],
  accountant: [
    "Invoices",
    "Parties",
    "Items",
    "Payments",
    "Cash & Bank",
    "Expenses",
    "Reports",
  ],
};

/** Nav items that each role should NOT see */
const ROLE_NAV_HIDDEN: Record<string, string[]> = {
  seller: ["Dashboard", "Cash & Bank", "Expenses", "Reports"],
  accountant: [
    "Quotations",
    "Sales Returns",
    "Credit Notes",
    "Delivery Challans",
    "Proforma Invoices",
  ],
};

/**
 * Helper: invite a user, register them via UI, accept the invite via
 * the /invite/:token page, and return the authenticated page.
 */
async function createRoleUser(
  browser: any,
  ownerPage: any,
  role: "seller" | "accountant",
) {
  const api = new ApiHelper(ownerPage, API_URL);
  const ts = Date.now();
  const email = `e2e-${role}-${ts}@test.hisaabo.in`;
  const password = "Test@1234!";
  const name = `E2E ${role} User`;

  // Clean up any stale pending invitations to stay within plan limits
  const pending = await api.query<Array<{ id: string }>>("tenant.pendingInvitations");
  for (const inv of pending) {
    await api.mutate("tenant.revokeInvitation", { id: inv.id }).catch(() => {});
  }

  // Step 1: Owner sends invite via API
  const invite = await api.mutate<{ token: string }>("tenant.inviteMember", {
    email,
    role,
  });

  // Step 2: Register the new user via UI in a fresh context
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByText("Use password instead").click();
  await page.getByText("Create one").click();
  await expect(page.getByText("Create your account")).toBeVisible();

  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("you@yourcompany.com").fill(email);
  await page.getByPlaceholder("Min 8 characters").fill(password);
  await page.getByPlaceholder("Repeat password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for redirect — user has a pending invite so may land differently
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  // Step 3: Visit the invite acceptance page
  await page.goto(`/invite/${invite.token}`);
  await page.waitForTimeout(3_000);

  // The invite page should auto-accept and show "You've joined [org]!"
  // or the user may already be redirected
  const joinedText = page.getByText(/you've joined/i);
  const isJoined = await joinedText.isVisible({ timeout: 5_000 }).catch(() => false);

  if (isJoined) {
    // Click "Continue with [org]"
    await page.getByText(/continue with/i).first().click();
    await page.waitForTimeout(2_000);
  }

  // We should now be in the app — wait for any page to load
  await page.waitForTimeout(2_000);

  return { context, page };
}

// ═════════════════════════════════════════════════════════════════
// SELLER — can see sales + inventory, not dashboard/money/compliance
// ═════════════════════════════════════════════════════════════════

test.describe("Role: Seller", () => {
  let rolePage: any;
  let roleCtx: any;

  test.beforeAll(async ({ browser }) => {
    const ownerCtx = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const ownerPage = await ownerCtx.newPage();

    const result = await createRoleUser(browser, ownerPage, "seller");
    rolePage = result.page;
    roleCtx = result.context;

    await ownerPage.close();
    await ownerCtx.close();
  });

  test.afterAll(async () => {
    await rolePage?.close();
    await roleCtx?.close();
  });

  test("seller sees expected nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.waitForTimeout(1_500);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_VISIBLE.seller) {
      await expect(
        sidebar.getByText(item, { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("seller does NOT see restricted nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.waitForTimeout(1_000);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_HIDDEN.seller) {
      await expect(
        sidebar.getByText(item, { exact: true }),
      ).not.toBeVisible();
    }
  });

  test("seller is redirected from dashboard to invoices", async () => {
    await rolePage.goto("/");
    await rolePage.waitForTimeout(2_000);
    // Seller can't see Dashboard (no Report:read), should redirect to /invoices
    await expect(rolePage).toHaveURL(/\/invoices/);
  });

  test("seller can access invoices page", async () => {
    await rolePage.goto("/invoices");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Invoices");
  });

  test("seller can access items page", async () => {
    await rolePage.goto("/items");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Items");
  });

  test("seller can access parties page", async () => {
    await rolePage.goto("/parties");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Parties");
  });

  test("seller can access payments page", async () => {
    await rolePage.goto("/payments");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Payments");
  });
});

// ═════════════════════════════════════════════════════════════════
// ACCOUNTANT — sees money/compliance, limited sales
// ═════════════════════════════════════════════════════════════════

test.describe("Role: Accountant", () => {
  let rolePage: any;
  let roleCtx: any;
  let setupFailed = false;

  test.beforeAll(async ({ browser }) => {
    const ownerCtx = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const ownerPage = await ownerCtx.newPage();

    try {
      const result = await createRoleUser(browser, ownerPage, "accountant");
      rolePage = result.page;
      roleCtx = result.context;
    } catch (err: any) {
      // Plan limit may prevent adding a 4th member — mark for skip
      if (err.message?.includes("plan allows up to")) {
        setupFailed = true;
      } else {
        throw err;
      }
    }

    await ownerPage.close();
    await ownerCtx.close();
  });

  test.afterAll(async () => {
    await rolePage?.close();
    await roleCtx?.close();
  });

  test.beforeEach(() => {
    test.skip(setupFailed, "Skipped: plan member limit reached — cannot invite accountant");
  });

  test("accountant sees expected nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.waitForTimeout(1_500);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_VISIBLE.accountant) {
      await expect(
        sidebar.getByText(item, { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("accountant does NOT see restricted nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.waitForTimeout(1_000);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_HIDDEN.accountant) {
      await expect(
        sidebar.getByText(item, { exact: true }),
      ).not.toBeVisible();
    }
  });

  test("accountant can access expenses page", async () => {
    await rolePage.goto("/expenses");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Expenses");
  });

  test("accountant can access cash & bank page", async () => {
    await rolePage.goto("/cash-and-bank");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText(/cash|bank/i);
  });

  test("accountant can access reports page", async () => {
    await rolePage.goto("/reports");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Reports");
  });

  test("accountant can access invoices page", async () => {
    await rolePage.goto("/invoices");
    await rolePage.waitForTimeout(1_000);
    await expect(rolePage.locator("h1").first()).toContainText("Invoices");
  });
});
