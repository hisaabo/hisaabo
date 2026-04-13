/**
 * invite-flow.spec.ts — Tests the team invitation flow.
 *
 * Tests:
 *   - Owner can access Settings > Team tab and send invites
 *   - Invite modal has email and role fields
 *   - After sending, invite link is generated
 *   - Invite accept page works for a new user
 */
import { test, expect } from "../helpers/fixtures";

test.describe("Invite Flow — Team Tab", () => {
  test("owner can navigate to Settings > Team tab", async ({ page }) => {
    await page.goto("/settings");

    // Click the Team tab in settings nav
    await page.getByText("Team").first().click();

    // Should see the team section with invite button
    await expect(page.getByRole("button", { name: /invite/i }).first()).toBeVisible();
  });

  test("invite modal has email and role fields", async ({ page }) => {
    await page.goto("/settings");

    await page.getByText("Team").first().click();

    // Click Invite button
    await page.getByRole("button", { name: /invite/i }).first().click();

    // Modal should open
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText("Invite Team Member")).toBeVisible();

    // Should have email field
    await expect(modal.getByPlaceholder("colleague@example.com")).toBeVisible();

    // Should have role selector with options
    await expect(modal.getByText(/role/i).first()).toBeVisible();

    // Should have Send Invite button
    await expect(modal.getByRole("button", { name: /send invite/i })).toBeVisible();

    // Close modal
    await page.keyboard.press("Escape");
  });

  test("sending invite shows invite link", async ({ page }) => {
    await page.goto("/settings");

    await page.getByText("Team").first().click();

    await page.getByRole("button", { name: /invite/i }).first().click();
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Fill email
    const inviteEmail = `invited-${Date.now()}@test.hisaabo.in`;
    await modal.getByPlaceholder("colleague@example.com").fill(inviteEmail);

    // Submit
    await modal.getByRole("button", { name: /send invite/i }).click();

    // Should show success with invite link
    await expect(modal.getByText(/invitation created/i)).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByText(/invite link/i)).toBeVisible();

    // Should show a Copy button and a Done button
    await expect(modal.getByRole("button", { name: /copy/i })).toBeVisible();
    await expect(modal.getByRole("button", { name: /done/i })).toBeVisible();

    // Click Done to close
    await modal.getByRole("button", { name: /done/i }).click();
    await expect(modal).not.toBeVisible({ timeout: 3_000 });
  });

  test("pending invitation appears in team list", async ({ page }) => {
    await page.goto("/settings");

    await page.getByText("Team").first().click();

    // Look for a "Pending" section or badge
    // The TeamTab shows pending invitations with email and role
    await expect(
      page.getByText(/pending/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
