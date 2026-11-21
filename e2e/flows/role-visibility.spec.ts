/**
 * role-visibility.spec.ts — Verifies nav items and route access per role.
 *
 * For each role (seller, accountant), this test:
 *   1. Invites a user with that role (via owner's API)
 *   2. Registers the invited user via the API
 *   3. Visits the invite link to accept
 *   4. Verifies which sidebar nav items are visible vs. hidden
 *   5. Verifies which routes are accessible vs. redirected
 *
 * Only tests seller + accountant (the two most different permission sets)
 * because the free plan limits to 3 team members total.
 */
import { test, expect, ApiHelper, newContext, settle } from "../helpers/fixtures";
import { markEmailVerified, registerUser, sessionStorageState } from "../helpers/seed";
import { apiUrl, ownerStorageStatePath } from "../helpers/worker";

const API_URL = apiUrl();

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
  // Accountants are read-only on sales (Invoice:read, see role-access.test.ts), so
  // the sales document pages are in their nav; the reports entry is labelled
  // "Business Reports" (getVisibleNavItems).
  accountant: [
    "Invoices",
    "Quotations",
    "Sales Returns",
    "Credit Notes",
    "Delivery Challans",
    "Proforma Invoices",
    "Parties",
    "Items",
    "Payments",
    "Cash & Bank",
    "Expenses",
    "Business Reports",
  ],
};

/**
 * Nav items that each role should NOT see. An accountant can read every
 * resource the nav is gated on, so nothing is hidden from them: what sets them
 * apart is that they cannot create sales documents (asserted separately).
 */
const ROLE_NAV_HIDDEN: Record<string, string[]> = {
  seller: ["Dashboard", "Cash & Bank", "Expenses", "Business Reports"],
  accountant: [],
};

/**
 * Helper: invite a user, register them via the API, accept the invite via
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

  // Clean up stale pending invitations left by earlier runs of THIS spec to stay
  // within plan limits. Only our own (e2e-seller-* / e2e-accountant-*): other
  // specs' invitations (invite-flow) are theirs to manage, not ours to revoke.
  const pending = await api.query<Array<{ id: string; email: string }>>("tenant.pendingInvitations");
  const ours = /^e2e-(seller|accountant)-\d+@test\.hisaabo\.in$/i;
  for (const inv of pending.filter((p) => ours.test(p.email))) {
    await api.mutate("tenant.revokeInvitation", { invitationId: inv.id });
  }

  // Step 1: Owner sends invite via API
  const invited = await api.mutate<{ inviteUrl?: string }>("tenant.inviteMember", {
    email,
    role,
    returnLink: true,
  });
  const invite = { token: invited.inviteUrl?.split("/invite/")[1] };
  if (!invite.token) throw new Error("tenant.inviteMember did not return an inviteUrl");

  // Step 2: Register the invited user via the API (no password UI) and
  // load the resulting session cookie into a fresh browser context.
  const { sessionToken } = await registerUser(API_URL, { email, password, name });
  await markEmailVerified(email); // invite acceptance requires a verified email
  const context = await newContext(browser, { storageState: sessionStorageState(sessionToken) });
  const page = await context.newPage();

  // Step 3: Visit the invite acceptance page
  await page.goto(`/invite/${invite.token}`);

  // The invite page should auto-accept and show "You've joined [org]!"
  // or the user may already be redirected
  const joinedText = page.getByText(/you've joined/i);
  const isJoined = await joinedText
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (isJoined) {
    // Click "Continue with [org]"
    await page.getByText(/continue with/i).first().click();
    // Roles with report access land on the dashboard at "/"; sellers on /invoices.
    await expect(page).toHaveURL(
      (u) => /^\/(invoices|dashboard|items|parties|settings)?\/?$/.test(u.pathname),
      { timeout: 10_000 },
    );
  } else {
    // Already redirected into the app — wait for a known page
    await expect(page).toHaveURL(/\/(invoices|dashboard|items|parties|settings)/, { timeout: 10_000 });
  }

  return { context, page };
}

// ═════════════════════════════════════════════════════════════════
// SELLER — can see sales + inventory, not dashboard/money/compliance
// ═════════════════════════════════════════════════════════════════

test.describe("Role: Seller", () => {
  let rolePage: any;
  let roleCtx: any;

  test.beforeAll(async ({ browser }) => {
    const ownerCtx = await newContext(browser, { storageState: ownerStorageStatePath() });
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
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_VISIBLE.seller) {
      await expect(
        sidebar.getByText(item, { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("seller does NOT see restricted nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_HIDDEN.seller) {
      await expect(
        sidebar.getByText(item, { exact: true }),
      ).not.toBeVisible();
    }
  });

  test("seller is redirected from dashboard to invoices", async () => {
    await rolePage.goto("/");
    // Seller can't see Dashboard (no Report:read), should redirect to /invoices
    await expect(rolePage).toHaveURL(/\/invoices/, { timeout: 10_000 });
  });

  test("seller can access invoices page", async () => {
    await rolePage.goto("/invoices");
    await expect(rolePage.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });
  });

  test("seller can access items page", async () => {
    await rolePage.goto("/items");
    await expect(rolePage.locator("h1").first()).toContainText("Items", { timeout: 10_000 });
  });

  test("seller can access parties page", async () => {
    await rolePage.goto("/parties");
    await expect(rolePage.locator("h1").first()).toContainText("Parties", { timeout: 10_000 });
  });

  test("seller can access payments page", async () => {
    await rolePage.goto("/payments");
    await expect(rolePage.locator("h1").first()).toContainText("Payments", { timeout: 10_000 });
  });

  test("seller does NOT see delete button on invoice rows", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    // If there are rows, hover and check for absence of delete
    if (count > 0) {
      await rows.first().hover();
      // Seller should NOT have delete/trash button
      const deleteBtn = rows.first().locator('[aria-label*="delete" i], [aria-label*="Delete" i], [title*="delete" i]');
      await expect(deleteBtn).not.toBeVisible();
    }
  });

  test("seller does NOT see delete button in invoice detail panel", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      await settle(rolePage);
      const panel = rolePage.locator('[role="dialog"]').first();
      const panelVisible = await panel.isVisible().catch(() => false);
      if (panelVisible) {
        // Seller should NOT see Delete button in the detail panel
        await expect(
          panel.getByRole("button", { name: /^delete$/i }),
        ).not.toBeVisible();
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// ACCOUNTANT — sees money/compliance, read-only on sales
// ═════════════════════════════════════════════════════════════════

test.describe("Role: Accountant", () => {
  let rolePage: any;
  let roleCtx: any;
  let setupFailed = false;

  test.beforeAll(async ({ browser }) => {
    const ownerCtx = await newContext(browser, { storageState: ownerStorageStatePath() });
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
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const sidebar = rolePage.locator("nav, aside").first();

    for (const item of ROLE_NAV_VISIBLE.accountant) {
      await expect(
        sidebar.getByText(item, { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("accountant has read-only access to sales: no create action", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    // Positive anchor: the page and its sales-document nav rendered for them...
    await expect(rolePage.locator("h1").first()).toContainText("Invoices");
    const sidebar = rolePage.locator("nav, aside").first();
    await expect(sidebar.getByText("Quotations", { exact: true }).first()).toBeVisible();

    // ...but they cannot create invoices (Invoice: read only).
    await expect(rolePage.getByRole("button", { name: /new invoice/i })).toHaveCount(0);

    for (const item of ROLE_NAV_HIDDEN.accountant) {
      await expect(sidebar.getByText(item, { exact: true })).not.toBeVisible();
    }
  });

  test("accountant can access expenses page", async () => {
    await rolePage.goto("/expenses");
    await expect(rolePage.locator("h1").first()).toContainText("Expenses", { timeout: 10_000 });
  });

  test("accountant can access cash & bank page", async () => {
    await rolePage.goto("/cash-and-bank");
    await expect(rolePage.locator("h1").first()).toContainText(/cash|bank/i, { timeout: 10_000 });
  });

  test("accountant can access reports page", async () => {
    await rolePage.goto("/reports");
    // The page header is the active report; the default one is "Daybook" (see reports.spec.ts)
    await expect(rolePage).toHaveURL(/\/reports/);
    await expect(rolePage.locator("h1").first()).toContainText("Daybook", { timeout: 10_000 });
  });

  test("accountant can access invoices page", async () => {
    await rolePage.goto("/invoices");
    await expect(rolePage.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });
  });

  test("accountant does NOT see delete button on invoice rows", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().hover();
      const deleteBtn = rows.first().locator('[aria-label*="delete" i], [aria-label*="Delete" i], [title*="delete" i]');
      await expect(deleteBtn).not.toBeVisible();
    }
  });

  test("accountant does NOT see delete button in invoice detail panel", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });
    await settle(rolePage);

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      await settle(rolePage);
      const panel = rolePage.locator('[role="dialog"]').first();
      const panelVisible = await panel.isVisible().catch(() => false);
      if (panelVisible) {
        await expect(
          panel.getByRole("button", { name: /^delete$/i }),
        ).not.toBeVisible();
      }
    }
  });
});
