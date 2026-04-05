/**
 * tenant-invite-flow.test.ts — Integration tests for the invite acceptance flow.
 *
 * Covers:
 *   - tenant.acceptInvitation: token validation, email matching, membership creation,
 *     session auto-select, tenantName return, idempotent re-accept, expiry
 *   - tenant.pendingInvitations: scoped to current tenant, excludes accepted/expired
 *   - tenant.revokeInvitation: permission checks, cross-tenant isolation, accepted guard
 *   - tenant.inviteMember (updated): duplicate pending invite rejection, email sending
 *   - Multi-tenant isolation: invitations never leak across tenants
 *
 * Lifecycle:
 *   beforeAll  — shared fixture world (2 tenants, 3 users, sessions)
 *   afterAll   — truncate all tables
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { sessions, tenantMembers, invitations, magicLinkTokens } from "@hisaabo/db";
import { createHash, randomUUID } from "crypto";
import {
  createUser,
  createTenant,
  addMember,
  createSession,
  type TestUser,
  type TestTenant,
  type TestSession,
} from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

// ── Caller helpers ────────────────────────────────────────────────────────────

const _callerFactory = createCallerFactory(appRouter);

/** tenantProcedure-compatible caller with session cookie (for pendingInvitations, revokeInvitation). */
function callerForTenant(
  sessionId: string,
  user: { id: string; email: string; name: string | null },
  tenantId: string,
) {
  const headers = new Headers({
    "content-type": "application/json",
    "cookie": `session_id=${sessionId}`,
  });
  const req = new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers });
  return _callerFactory({
    user,
    tenantId,
    businessId: null,
    req,
    resHeaders: new Headers(),
  });
}

/** protectedProcedure caller (no tenant in context — for acceptInvitation). */
function callerNoTenant(sessionId: string, user: { id: string; email: string; name: string | null }) {
  const headers = new Headers({
    "content-type": "application/json",
    "cookie": `session_id=${sessionId}`,
  });
  const req = new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers });
  return _callerFactory({
    user,
    tenantId: null,
    businessId: null,
    req,
    resHeaders: new Headers(),
  });
}

/** Hash a raw token the same way the router does. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Insert a raw invitation directly into the DB (bypassing the router). */
async function insertInvitation(opts: {
  tenantId: string;
  email: string;
  role?: string;
  invitedBy: string;
  rawToken: string;
  expiresAt?: Date;
  acceptedAt?: Date | null;
}) {
  const db = getControlDb();
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [row] = await db.insert(invitations).values({
    tenantId: opts.tenantId,
    email: opts.email,
    role: (opts.role ?? "seller") as any,
    token: hashToken(opts.rawToken),
    invitedBy: opts.invitedBy,
    expiresAt,
    acceptedAt: opts.acceptedAt ?? undefined,
  }).returning();
  return row!;
}

// ── Shared fixture state ──────────────────────────────────────────────────────

let admin: TestUser;      // owner of tenant1
let seller: TestUser;     // seller on tenant1
let outsider: TestUser;   // owner of tenant2 — should never see tenant1 data
let newUser: TestUser;    // user with no memberships (simulates invited new user)

let tenant1: TestTenant;  // "Sharma Traders"
let tenant2: TestTenant;  // "Kiran Enterprises"

let adminSession: TestSession;
let sellerSession: TestSession;
let outsiderSession: TestSession;
let newUserSession: TestSession;

beforeAll(async () => {
  // Users
  admin = await createUser({ email: "admin.invite@sharma.in", name: "Admin Sharma" });
  seller = await createUser({ email: "seller.invite@sharma.in", name: "Seller Kumar" });
  outsider = await createUser({ email: "outsider@kiran.in", name: "Kiran Mehta" });
  newUser = await createUser({ email: "newuser.invite@example.in", name: "New User" });

  // Tenants
  tenant1 = await createTenant({ name: "Sharma Traders" });
  tenant2 = await createTenant({ name: "Kiran Enterprises" });

  // Memberships
  await addMember(tenant1.id, admin.id, "owner");
  await addMember(tenant1.id, seller.id, "seller");
  await addMember(tenant2.id, outsider.id, "owner");
  // newUser has NO memberships — simulates a fresh invited user

  // Sessions (newUser session has no tenant selected)
  adminSession = await createSession(admin.id, tenant1.id);
  sellerSession = await createSession(seller.id, tenant1.id);
  outsiderSession = await createSession(outsider.id, tenant2.id);
  newUserSession = await createSession(newUser.id);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.acceptInvitation
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.acceptInvitation", () => {
  it("accepts a valid invitation — creates membership, returns tenantId + tenantName", async () => {
    const db = getControlDb();
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: newUser.email,
      role: "seller",
      invitedBy: admin.id,
      rawToken,
    });

    const caller = callerNoTenant(newUserSession.id, newUser);
    const result = await caller.tenant.acceptInvitation({ token: rawToken });

    expect(result.tenantId).toBe(tenant1.id);
    expect(result.tenantName).toBe("Sharma Traders");

    // Verify membership was created
    const [membership] = await db.select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, tenant1.id),
        eq(tenantMembers.userId, newUser.id),
      ))
      .limit(1);
    expect(membership).toBeDefined();
    expect(membership!.role).toBe("seller");
  });

  it("auto-selects the invited tenant in the session", async () => {
    const db = getControlDb();

    // Verify the session was updated to point at tenant1
    const [sess] = await db.select({ tenantId: sessions.tenantId })
      .from(sessions)
      .where(eq(sessions.id, newUserSession.id))
      .limit(1);
    expect(sess!.tenantId).toBe(tenant1.id);
  });

  it("rejects invitation when authenticated email does not match — FORBIDDEN", async () => {
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "someone.else@example.in", // different email
      invitedBy: admin.id,
      rawToken,
    });

    const caller = callerNoTenant(newUserSession.id, newUser);
    await expect(
      caller.tenant.acceptInvitation({ token: rawToken }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This invitation was sent to a different email address",
    });
  });

  it("rejects expired invitation — NOT_FOUND", async () => {
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: newUser.email,
      invitedBy: admin.id,
      rawToken,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const caller = callerNoTenant(newUserSession.id, newUser);
    await expect(
      caller.tenant.acceptInvitation({ token: rawToken }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Invalid or expired invitation",
    });
  });

  it("already-accepted invitation is handled idempotently — succeeds if user is member", async () => {
    // newUser is already a member of tenant1 from the first test.
    // An already-accepted invite should succeed silently (not throw).
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: newUser.email,
      invitedBy: admin.id,
      rawToken,
      acceptedAt: new Date(),
    });

    const caller = callerNoTenant(newUserSession.id, newUser);
    const result = await caller.tenant.acceptInvitation({ token: rawToken });
    expect(result.tenantId).toBe(tenant1.id);
    expect(result.tenantName).toBe("Sharma Traders");
  });

  it("handles double-accept gracefully — already a member returns success", async () => {
    // newUser is already a member of tenant1 from the first test
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: newUser.email,
      invitedBy: admin.id,
      rawToken,
    });

    const caller = callerNoTenant(newUserSession.id, newUser);
    const result = await caller.tenant.acceptInvitation({ token: rawToken });

    // Should succeed gracefully, not create a duplicate membership
    expect(result.tenantId).toBe(tenant1.id);
    expect(result.tenantName).toBe("Sharma Traders");
  });

  it("rejects invalid token — NOT_FOUND", async () => {
    const caller = callerNoTenant(newUserSession.id, newUser);
    await expect(
      caller.tenant.acceptInvitation({ token: "completely-bogus-token" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Invalid or expired invitation",
    });
  });

  it("requires authentication — unauthenticated caller receives UNAUTHORIZED", async () => {
    const ctx = createTestContext({});
    const caller = _callerFactory(ctx);
    await expect(
      caller.tenant.acceptInvitation({ token: "any-token" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("REGRESSION: accepting an already-accepted invite succeeds idempotently if user is a member", async () => {
    // Scenario: user accepted invite, clicks old link again. Should not error.
    const rawToken = randomUUID();
    const reinviteUser = await createUser({ email: `reinvite.idem.${randomUUID().slice(0, 8)}@example.in`, name: "Reinvite User" });
    await addMember(tenant1.id, reinviteUser.id, "seller");

    // Insert an already-accepted invite for this user
    await insertInvitation({
      tenantId: tenant1.id,
      email: reinviteUser.email,
      invitedBy: admin.id,
      rawToken,
      acceptedAt: new Date(),
    });

    const reinviteSession = await createSession(reinviteUser.id);
    const caller = callerNoTenant(reinviteSession.id, reinviteUser);
    const result = await caller.tenant.acceptInvitation({ token: rawToken });

    // Should succeed idempotently — not throw "already accepted"
    expect(result.tenantId).toBe(tenant1.id);
    expect(result.tenantName).toBe("Sharma Traders");
  });

  it("REGRESSION: accepting an already-accepted invite re-adds a removed member", async () => {
    // Scenario: user accepted invite, was removed, clicks old link again.
    // Should re-add them to the org.
    const rawToken = randomUUID();
    const email = `reinvite.readd.${randomUUID().slice(0, 8)}@example.in`;
    const readdUser = await createUser({ email, name: "Re-add User" });

    // Insert an already-accepted invite (from first invite cycle)
    await insertInvitation({
      tenantId: tenant1.id,
      email,
      role: "accountant",
      invitedBy: admin.id,
      rawToken,
      acceptedAt: new Date(),
    });

    // User is NOT a member (was removed after accepting)
    const readdSession = await createSession(readdUser.id);
    const caller = callerNoTenant(readdSession.id, readdUser);
    const result = await caller.tenant.acceptInvitation({ token: rawToken });

    expect(result.tenantId).toBe(tenant1.id);

    // Should now be a member again
    const db = getControlDb();
    const [membership] = await db.select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, tenant1.id),
        eq(tenantMembers.userId, readdUser.id),
      ))
      .limit(1);
    expect(membership).toBeDefined();
    expect(membership!.role).toBe("accountant");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.pendingInvitations
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.pendingInvitations", () => {
  let pendingToken1: string;
  let pendingToken2: string;

  beforeAll(async () => {
    // Seed: create 2 pending invitations on tenant1, 1 on tenant2
    pendingToken1 = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "pending.alice@example.in",
      role: "admin",
      invitedBy: admin.id,
      rawToken: pendingToken1,
    });

    pendingToken2 = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "pending.bob@example.in",
      role: "seller",
      invitedBy: admin.id,
      rawToken: pendingToken2,
    });

    // Invitation on tenant2 — should NEVER appear in tenant1 queries
    await insertInvitation({
      tenantId: tenant2.id,
      email: "pending.charlie@kiran.in",
      role: "accountant",
      invitedBy: outsider.id,
      rawToken: randomUUID(),
    });

    // Expired invitation on tenant1 — should be excluded
    await insertInvitation({
      tenantId: tenant1.id,
      email: "expired@example.in",
      invitedBy: admin.id,
      rawToken: randomUUID(),
      expiresAt: new Date(Date.now() - 1000),
    });

    // Already-accepted invitation on tenant1 — should be excluded
    await insertInvitation({
      tenantId: tenant1.id,
      email: "accepted@example.in",
      invitedBy: admin.id,
      rawToken: randomUUID(),
      acceptedAt: new Date(),
    });
  });

  it("returns only pending (non-expired, non-accepted) invitations for the current tenant", async () => {
    const caller = callerForTenant(adminSession.id, admin, tenant1.id);
    const pending = await caller.tenant.pendingInvitations();

    // Should include alice and bob, not charlie (tenant2), expired, or accepted
    const emails = pending.map((p) => p.email);
    expect(emails).toContain("pending.alice@example.in");
    expect(emails).toContain("pending.bob@example.in");
    expect(emails).not.toContain("pending.charlie@kiran.in");
    expect(emails).not.toContain("expired@example.in");
    expect(emails).not.toContain("accepted@example.in");
  });

  it("includes role, inviter name, and timestamps", async () => {
    const caller = callerForTenant(adminSession.id, admin, tenant1.id);
    const pending = await caller.tenant.pendingInvitations();

    const alice = pending.find((p) => p.email === "pending.alice@example.in");
    expect(alice).toBeDefined();
    expect(alice!.role).toBe("admin");
    expect(alice!.invitedByName).toBe("Admin Sharma");
    expect(alice!.createdAt).toBeInstanceOf(Date);
    expect(alice!.expiresAt).toBeInstanceOf(Date);
  });

  it("MULTI-TENANT: tenant2 owner cannot see tenant1 pending invitations", async () => {
    const caller = callerForTenant(outsiderSession.id, outsider, tenant2.id);
    const pending = await caller.tenant.pendingInvitations();

    const emails = pending.map((p) => p.email);
    expect(emails).not.toContain("pending.alice@example.in");
    expect(emails).not.toContain("pending.bob@example.in");
    // Should only see tenant2's invitation
    expect(emails).toContain("pending.charlie@kiran.in");
  });

  it("sellers can also list pending invitations (read-only)", async () => {
    const caller = callerForTenant(sellerSession.id, seller, tenant1.id);
    const pending = await caller.tenant.pendingInvitations();
    expect(pending.length).toBeGreaterThanOrEqual(2);
  });

  it("requires tenantId in context — BAD_REQUEST without tenant", async () => {
    const caller = callerNoTenant(adminSession.id, admin);
    await expect(caller.tenant.pendingInvitations()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.revokeInvitation
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.revokeInvitation", () => {
  let revocableInvitation: { id: string };

  beforeAll(async () => {
    const rawToken = randomUUID();
    revocableInvitation = await insertInvitation({
      tenantId: tenant1.id,
      email: "revocable@example.in",
      invitedBy: admin.id,
      rawToken,
    });
  });

  it("owner can revoke a pending invitation — row is deleted", async () => {
    const db = getControlDb();
    const caller = callerForTenant(adminSession.id, admin, tenant1.id);
    const result = await caller.tenant.revokeInvitation({ invitationId: revocableInvitation.id });
    expect(result.success).toBe(true);

    // Verify the row is gone
    const [remaining] = await db.select()
      .from(invitations)
      .where(eq(invitations.id, revocableInvitation.id))
      .limit(1);
    expect(remaining).toBeUndefined();
  });

  it("seller cannot revoke invitations — FORBIDDEN", async () => {
    const inv = await insertInvitation({
      tenantId: tenant1.id,
      email: "seller.cant.revoke@example.in",
      invitedBy: admin.id,
      rawToken: randomUUID(),
    });

    const caller = callerForTenant(sellerSession.id, seller, tenant1.id);
    await expect(
      caller.tenant.revokeInvitation({ invitationId: inv.id }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only owners and admins can revoke invitations",
    });
  });

  it("MULTI-TENANT: cannot revoke an invitation from another tenant", async () => {
    // Create an invitation on tenant2
    const tenant2Inv = await insertInvitation({
      tenantId: tenant2.id,
      email: "cross-tenant-revoke@kiran.in",
      invitedBy: outsider.id,
      rawToken: randomUUID(),
    });

    // Try to revoke it from tenant1 context — should silently fail (no match)
    const caller = callerForTenant(adminSession.id, admin, tenant1.id);
    const result = await caller.tenant.revokeInvitation({ invitationId: tenant2Inv.id });
    // The DELETE runs but matches 0 rows — returns success (idempotent)
    expect(result.success).toBe(true);

    // Verify tenant2's invitation is still intact
    const db = getControlDb();
    const [stillExists] = await db.select()
      .from(invitations)
      .where(eq(invitations.id, tenant2Inv.id))
      .limit(1);
    expect(stillExists).toBeDefined();
  });

  it("cannot revoke an already-accepted invitation", async () => {
    const db = getControlDb();
    const acceptedInv = await insertInvitation({
      tenantId: tenant1.id,
      email: "already.accepted.revoke@example.in",
      invitedBy: admin.id,
      rawToken: randomUUID(),
      acceptedAt: new Date(),
    });

    const caller = callerForTenant(adminSession.id, admin, tenant1.id);
    await caller.tenant.revokeInvitation({ invitationId: acceptedInv.id });

    // Row should still exist (isNull(acceptedAt) filter prevented deletion)
    const [stillExists] = await db.select()
      .from(invitations)
      .where(eq(invitations.id, acceptedInv.id))
      .limit(1);
    expect(stillExists).toBeDefined();
    expect(stillExists!.acceptedAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.inviteMember (updated behaviour)
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.inviteMember — duplicate guard", () => {
  it("rejects duplicate pending invitation for the same email on the same tenant — CONFLICT", async () => {
    // First invite: should succeed
    const caller = callerForTenant(adminSession.id, admin, tenant1.id);
    await caller.tenant.inviteMember({
      email: "duplicate.test@example.in",
      role: "accountant",
    });

    // Second invite with same email: should fail
    await expect(
      caller.tenant.inviteMember({
        email: "duplicate.test@example.in",
        role: "seller",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A pending invitation for this email already exists",
    });
  });

  it("allows re-inviting after previous invitation was accepted", async () => {
    // Create and manually accept an invitation
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "reinvite.after.accept@example.in",
      invitedBy: admin.id,
      rawToken,
      acceptedAt: new Date(),
    });

    // Re-inviting should work since the old one is accepted (not pending)
    const caller = callerForTenant(adminSession.id, admin, tenant1.id);

    // Note: this will fail with "User is already a member" if the user exists
    // and is a member. We're using a non-existent email, so only the pending
    // duplicate check applies.
    const result = await caller.tenant.inviteMember({
      email: "reinvite.after.accept@example.in",
      role: "admin",
    });
    expect(result.token).toBeDefined();
    expect(result.token.length).toBeGreaterThan(10);
  });

  it("allows same email to be invited to different tenants simultaneously", async () => {
    const caller1 = callerForTenant(adminSession.id, admin, tenant1.id);
    const caller2 = callerForTenant(outsiderSession.id, outsider, tenant2.id);

    const email = `multi.tenant.invite.${randomUUID().slice(0, 8)}@example.in`;

    const result1 = await caller1.tenant.inviteMember({ email, role: "seller" });
    const result2 = await caller2.tenant.inviteMember({ email, role: "admin" });

    // Both should succeed — different tenants
    expect(result1.token).toBeDefined();
    expect(result2.token).toBeDefined();
    expect(result1.token).not.toBe(result2.token);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan limit enforcement — accepted invitations must not count
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.inviteMember — plan limit counting", () => {
  it("accepted invitations do not count against the team member limit", async () => {
    // Create a fresh tenant on the free plan (maxTeamMembers=3)
    const limitTenant = await createTenant({ name: "Limit Test Org", plan: "free" });
    const limitAdmin = await createUser({ email: `limit.admin.${randomUUID().slice(0, 8)}@test.in`, name: "Limit Admin" });
    await addMember(limitTenant.id, limitAdmin.id, "owner");
    const limitSession = await createSession(limitAdmin.id, limitTenant.id);

    const caller = callerForTenant(limitSession.id, limitAdmin, limitTenant.id);

    // Free plan: 3 max members. Owner = 1 member.
    // Invite person 1 — should succeed (1 member + 1 pending = 2)
    const invite1 = await caller.tenant.inviteMember({
      email: `limit.user1.${randomUUID().slice(0, 8)}@test.in`,
      role: "seller",
    });
    expect(invite1.token).toBeDefined();

    // Accept invite 1 (simulate: mark as accepted in DB)
    const db = getControlDb();
    await db.update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.token, hashToken(invite1.token)));

    // Add the user as a member (simulates what acceptInvitation does)
    const user1 = await createUser({ email: `limit.user1.${randomUUID().slice(0, 8)}@test.in` });
    await addMember(limitTenant.id, user1.id, "seller");
    // Now: 2 members, 0 pending invites = 2 total

    // Invite person 2 — should succeed (2 members + 1 pending = 3, at limit)
    const invite2 = await caller.tenant.inviteMember({
      email: `limit.user2.${randomUUID().slice(0, 8)}@test.in`,
      role: "seller",
    });
    expect(invite2.token).toBeDefined();

    // Invite person 3 — should FAIL (2 members + 1 pending = 3, hits limit)
    await expect(
      caller.tenant.inviteMember({
        email: `limit.user3.${randomUUID().slice(0, 8)}@test.in`,
        role: "seller",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("Upgrade"),
    });
  });

  it("REGRESSION: accepted-but-unexpired invite does not double-count with the member row", async () => {
    // This is the exact bug: person accepts invite, now they're counted as
    // BOTH a member AND a pending invite (because acceptedAt wasn't checked).
    const regTenant = await createTenant({ name: "Regression Limit Org", plan: "free" });
    const regAdmin = await createUser({ email: `reg.admin.${randomUUID().slice(0, 8)}@test.in`, name: "Reg Admin" });
    await addMember(regTenant.id, regAdmin.id, "owner");
    const regSession = await createSession(regAdmin.id, regTenant.id);

    const caller = callerForTenant(regSession.id, regAdmin, regTenant.id);

    // Invite and accept user 1
    const email1 = `reg.user1.${randomUUID().slice(0, 8)}@test.in`;
    await caller.tenant.inviteMember({ email: email1, role: "seller" });

    // Simulate acceptance: mark invite accepted + add member
    const db = getControlDb();
    const user1 = await createUser({ email: email1 });
    await addMember(regTenant.id, user1.id, "seller");
    await db.update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(
        eq(invitations.tenantId, regTenant.id),
        eq(invitations.email, email1),
      ));

    // State: 2 members (owner + user1), 0 truly pending invites
    // With the bug: would count as 2 members + 1 "pending" (accepted but unexpired) = 3 → blocked
    // After fix: correctly counts as 2 members + 0 pending = 2 → allowed

    // Invite user 2 — MUST succeed
    const invite2 = await caller.tenant.inviteMember({
      email: `reg.user2.${randomUUID().slice(0, 8)}@test.in`,
      role: "accountant",
    });
    expect(invite2.token).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-tenant isolation (cross-cutting)
// ─────────────────────────────────────────────────────────────────────────────

describe("Multi-tenant isolation — invitation flow", () => {
  it("accepting an invitation for tenant2 does not grant access to tenant1 data", async () => {
    // Create a fresh user and invite them to tenant2
    const freshUser = await createUser({ email: "fresh.isolation@example.in", name: "Fresh User" });
    const freshSession = await createSession(freshUser.id);
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant2.id,
      email: freshUser.email,
      invitedBy: outsider.id,
      rawToken,
    });

    // Accept the invitation
    const caller = callerNoTenant(freshSession.id, freshUser);
    const result = await caller.tenant.acceptInvitation({ token: rawToken });
    expect(result.tenantId).toBe(tenant2.id);
    expect(result.tenantName).toBe("Kiran Enterprises");

    // Verify the user is a member of tenant2
    const db = getControlDb();
    const [membership] = await db.select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.userId, freshUser.id),
        eq(tenantMembers.tenantId, tenant2.id),
      ))
      .limit(1);
    expect(membership).toBeDefined();

    // Verify the user is NOT a member of tenant1
    const [noMembership] = await db.select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.userId, freshUser.id),
        eq(tenantMembers.tenantId, tenant1.id),
      ))
      .limit(1);
    expect(noMembership).toBeUndefined();

    // Verify session points to tenant2, not tenant1
    const [sess] = await db.select({ tenantId: sessions.tenantId })
      .from(sessions)
      .where(eq(sessions.id, freshSession.id))
      .limit(1);
    expect(sess!.tenantId).toBe(tenant2.id);
  });

  it("pendingInvitations query is completely isolated between tenants", async () => {
    // Create unique invitations for each tenant
    const t1Email = `isolation.t1.${randomUUID().slice(0, 8)}@example.in`;
    const t2Email = `isolation.t2.${randomUUID().slice(0, 8)}@example.in`;

    await insertInvitation({
      tenantId: tenant1.id,
      email: t1Email,
      invitedBy: admin.id,
      rawToken: randomUUID(),
    });
    await insertInvitation({
      tenantId: tenant2.id,
      email: t2Email,
      invitedBy: outsider.id,
      rawToken: randomUUID(),
    });

    // Tenant1 sees only its invitation
    const caller1 = callerForTenant(adminSession.id, admin, tenant1.id);
    const pending1 = await caller1.tenant.pendingInvitations();
    const emails1 = pending1.map((p) => p.email);
    expect(emails1).toContain(t1Email);
    expect(emails1).not.toContain(t2Email);

    // Tenant2 sees only its invitation
    const caller2 = callerForTenant(outsiderSession.id, outsider, tenant2.id);
    const pending2 = await caller2.tenant.pendingInvitations();
    const emails2 = pending2.map((p) => p.email);
    expect(emails2).toContain(t2Email);
    expect(emails2).not.toContain(t1Email);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth flow: skip auto-tenant when pending invitation exists
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyMagicLink — skip auto-tenant for invited users", () => {
  const db = getControlDb();

  /** Unauthenticated caller for auth endpoints. */
  function unauthCaller() {
    return _callerFactory(createTestContext({}));
  }

  it("new user WITH pending invitation gets NO auto-created tenant", async () => {
    const email = `invited.notenant.${randomUUID().slice(0, 8)}@example.in`;

    // Create a pending invitation for this email
    await insertInvitation({
      tenantId: tenant1.id,
      email,
      invitedBy: admin.id,
      rawToken: randomUUID(),
    });

    // Create a magic link token
    const rawToken = "magic-invited-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // Verify magic link — should create user but NOT auto-tenant
    const caller = unauthCaller();
    const result = await caller.auth.verifyMagicLink({ token: rawToken });

    expect(result.isNewUser).toBe(true);
    expect(result.needsProfile).toBe(true);

    // Verify the user has NO memberships (no auto-created tenant)
    const memberships = await db.select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, result.user.id));
    expect(memberships.length).toBe(0);
  });

  it("REGRESSION: invited user can complete profile → accept invite → tenant.list returns membership", async () => {
    // This test covers the exact flow that was broken: an invited user verifies
    // via magic link, has 0 memberships (tenantId=null on session), but must
    // still be able to complete profile and accept the invitation. The frontend
    // root layout was blocking with "No organization found" before this fix.
    const email = `invited.fullflow.${randomUUID().slice(0, 8)}@example.in`;
    const inviteRawToken = randomUUID();

    // Step 1: Admin creates invitation for this email
    await insertInvitation({
      tenantId: tenant1.id,
      email,
      role: "seller",
      invitedBy: admin.id,
      rawToken: inviteRawToken,
    });

    // Step 2: User clicks magic link and verifies
    const magicRawToken = "magic-fullflow-" + Date.now();
    const magicHash = createHash("sha256").update(magicRawToken).digest("hex");
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash: magicHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const unauthenticated = _callerFactory(createTestContext({}));
    const verifyResult = await unauthenticated.auth.verifyMagicLink({ token: magicRawToken });

    expect(verifyResult.isNewUser).toBe(true);
    expect(verifyResult.needsProfile).toBe(true);

    // User has 0 memberships — this is the state that broke the frontend
    const membershipsBeforeAccept = await db.select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, verifyResult.user.id));
    expect(membershipsBeforeAccept.length).toBe(0);

    // tenant.list returns empty — this is what triggered "No organization found"
    const sessionId = verifyResult.sessionToken;
    const authedCaller = callerNoTenant(sessionId, {
      id: verifyResult.user.id,
      email,
      name: null,
    });
    const tenantsBeforeAccept = await authedCaller.tenant.list();
    expect(tenantsBeforeAccept.length).toBe(0);

    // Step 3: User completes profile
    await authedCaller.auth.completeProfile({ name: "Invited User" });

    // Step 4: User accepts the invitation
    const acceptResult = await authedCaller.tenant.acceptInvitation({ token: inviteRawToken });
    expect(acceptResult.tenantId).toBe(tenant1.id);
    expect(acceptResult.tenantName).toBe("Sharma Traders");

    // Step 5: tenant.list NOW returns the invited tenant
    const tenantsAfterAccept = await authedCaller.tenant.list();
    expect(tenantsAfterAccept.length).toBe(1);
    expect(tenantsAfterAccept[0]!.tenantId).toBe(tenant1.id);
  });

  it("REGRESSION: removed member can create a personal org via create", async () => {
    // This covers the edge case where a user was invited, joined an org,
    // was later removed, and is now stuck with "No organization found".
    // create gives them an escape hatch.
    const db = getControlDb();

    // 1. Create a user who joins tenant1 via invite
    const email = `removed.member.${randomUUID().slice(0, 8)}@example.in`;
    const removedUser = await createUser({ email, name: "Removed User" });
    await addMember(tenant1.id, removedUser.id, "seller");
    const removedSession = await createSession(removedUser.id, tenant1.id);

    // Confirm they have 1 membership
    let memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, removedUser.id));
    expect(memberships.length).toBe(1);

    // 2. Admin removes them
    const adminCaller = callerForTenant(adminSession.id, admin, tenant1.id);
    await adminCaller.tenant.removeMember({ userId: removedUser.id });

    // 3. User now has 0 memberships
    memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, removedUser.id));
    expect(memberships.length).toBe(0);

    // 4. User calls create — gets a new org
    const caller = callerNoTenant(removedSession.id, {
      id: removedUser.id, email, name: "Removed User",
    });
    const result = await caller.tenant.create();
    expect(result.tenantId).toBeDefined();
    expect(result.tenantName).toBeDefined();

    // 5. User now has 1 membership (owner of new org)
    memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, removedUser.id));
    expect(memberships.length).toBe(1);
    expect(memberships[0]!.role).toBe("owner");
  });

  it("REGRESSION: invite-only user removed from org can create their first org", async () => {
    // User was invited, joined, then removed. They own 0 orgs.
    // Free plan limit is 1 owned org — they should be able to create.
    const db = getControlDb();
    const email = `invite.only.removed.${randomUUID().slice(0, 8)}@test.in`;
    const inviteOnlyUser = await createUser({ email, name: "Invite Only" });

    // Simulate: was a member (not owner) of tenant1, then removed
    // They never owned any org — ownedOrgs count = 0
    const inviteOnlySession = await createSession(inviteOnlyUser.id);
    const caller = callerNoTenant(inviteOnlySession.id, inviteOnlyUser);

    // canCreateOrg should be true (0 owned < 1 max)
    const canCreate = await caller.tenant.canCreateOrg();
    expect(canCreate).toBe(true);

    // Creating should succeed
    const result = await caller.tenant.create();
    expect(result.tenantId).toBeDefined();
    expect(result.tenantName).toBeDefined();

    // User should be a member of the new tenant
    const [membership] = await db.select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, result.tenantId),
        eq(tenantMembers.userId, inviteOnlyUser.id),
      ))
      .limit(1);
    expect(membership).toBeDefined();
  });

  it("free plan user who already owns 1 org cannot create a second", async () => {
    const email = `limit.hit.${randomUUID().slice(0, 8)}@test.in`;
    const limitUser = await createUser({ email, name: "Limit Hit" });
    const limitSession = await createSession(limitUser.id);
    const caller = callerNoTenant(limitSession.id, limitUser);

    // Manually create a free-plan tenant owned by this user
    const freeTenant = await createTenant({ name: "Limit Test Org", plan: "free" });
    await addMember(freeTenant.id, limitUser.id, "owner");

    // canCreateOrg should now be false (owns 1, free limit = 1)
    const canCreate = await caller.tenant.canCreateOrg();
    expect(canCreate).toBe(false);

    // Second create should fail
    await expect(caller.tenant.create()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("Upgrade"),
    });
  });

  it("new user WITHOUT pending invitation still gets auto-created tenant", async () => {
    const email = `noinvite.autotenant.${randomUUID().slice(0, 8)}@example.in`;

    // NO pending invitation for this email
    const rawToken = "magic-noinvite-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const caller = unauthCaller();
    const result = await caller.auth.verifyMagicLink({ token: rawToken });

    expect(result.isNewUser).toBe(true);

    // Verify the user HAS a membership (auto-created tenant)
    const memberships = await db.select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, result.user.id));
    expect(memberships.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.peekInvitation — preview invite without accepting
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.peekInvitation", () => {
  it("returns tenantName and role for a valid pending invitation", async () => {
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "peek.test@example.in",
      role: "accountant",
      invitedBy: admin.id,
      rawToken,
    });

    const caller = _callerFactory(createTestContext({}));
    const result = await caller.tenant.peekInvitation({ token: rawToken });

    expect(result).not.toBeNull();
    expect(result!.tenantName).toBe("Sharma Traders");
    expect(result!.role).toBe("accountant");
    // Must NOT return email (no PII leak via token possession)
    expect((result as any).email).toBeUndefined();
  });

  it("returns null for an accepted invitation", async () => {
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "peek.accepted@example.in",
      invitedBy: admin.id,
      rawToken,
      acceptedAt: new Date(),
    });

    const caller = _callerFactory(createTestContext({}));
    const result = await caller.tenant.peekInvitation({ token: rawToken });
    expect(result).toBeNull();
  });

  it("returns null for an expired invitation", async () => {
    const rawToken = randomUUID();
    await insertInvitation({
      tenantId: tenant1.id,
      email: "peek.expired@example.in",
      invitedBy: admin.id,
      rawToken,
      expiresAt: new Date(Date.now() - 1000),
    });

    const caller = _callerFactory(createTestContext({}));
    const result = await caller.tenant.peekInvitation({ token: rawToken });
    expect(result).toBeNull();
  });

  it("returns null for a bogus token", async () => {
    const caller = _callerFactory(createTestContext({}));
    const result = await caller.tenant.peekInvitation({ token: "totally-fake" });
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.myInvitations — pending invites for user's email
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.myInvitations", () => {
  it("returns pending invitations matching the user's email", async () => {
    const email = `my.invites.${randomUUID().slice(0, 8)}@example.in`;
    const myUser = await createUser({ email, name: "My Invites" });
    const mySession = await createSession(myUser.id);

    await insertInvitation({
      tenantId: tenant1.id,
      email,
      role: "seller",
      invitedBy: admin.id,
      rawToken: randomUUID(),
    });

    const caller = callerNoTenant(mySession.id, myUser);
    const invites = await caller.tenant.myInvitations();

    expect(invites.length).toBe(1);
    expect(invites[0]!.tenantName).toBe("Sharma Traders");
    expect(invites[0]!.role).toBe("seller");
  });

  it("excludes accepted and expired invitations", async () => {
    const email = `my.filtered.${randomUUID().slice(0, 8)}@example.in`;
    const filterUser = await createUser({ email, name: "Filter Test" });
    const filterSession = await createSession(filterUser.id);

    // Accepted invite — should be excluded
    await insertInvitation({ tenantId: tenant1.id, email, invitedBy: admin.id, rawToken: randomUUID(), acceptedAt: new Date() });
    // Expired invite — should be excluded
    await insertInvitation({ tenantId: tenant1.id, email, invitedBy: admin.id, rawToken: randomUUID(), expiresAt: new Date(Date.now() - 1000) });

    const caller = callerNoTenant(filterSession.id, filterUser);
    const invites = await caller.tenant.myInvitations();
    expect(invites.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.acceptById — accept by invitation ID (in-app, no token)
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.acceptById", () => {
  it("accepts invitation by ID — creates membership and returns tenant info", async () => {
    const db = getControlDb();
    const email = `accept.byid.${randomUUID().slice(0, 8)}@example.in`;
    const byIdUser = await createUser({ email, name: "ById User" });
    const byIdSession = await createSession(byIdUser.id);

    const rawToken = randomUUID();
    const invite = await insertInvitation({
      tenantId: tenant1.id,
      email,
      role: "seller",
      invitedBy: admin.id,
      rawToken,
    });

    const caller = callerNoTenant(byIdSession.id, byIdUser);
    const result = await caller.tenant.acceptById({ invitationId: invite.id });

    expect(result.tenantId).toBe(tenant1.id);
    expect(result.tenantName).toBe("Sharma Traders");

    // Membership created
    const [membership] = await db.select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant1.id), eq(tenantMembers.userId, byIdUser.id)))
      .limit(1);
    expect(membership!.role).toBe("seller");
  });

  it("rejects if email doesn't match authenticated user", async () => {
    const rawToken = randomUUID();
    const invite = await insertInvitation({
      tenantId: tenant1.id,
      email: "someone.else@example.in",
      invitedBy: admin.id,
      rawToken,
    });

    // newUser's email doesn't match
    const caller = callerNoTenant(newUserSession.id, newUser);
    await expect(
      caller.tenant.acceptById({ invitationId: invite.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects expired invitation", async () => {
    const email = `accept.byid.expired.${randomUUID().slice(0, 8)}@example.in`;
    const expUser = await createUser({ email });
    const expSession = await createSession(expUser.id);

    const invite = await insertInvitation({
      tenantId: tenant1.id,
      email,
      invitedBy: admin.id,
      rawToken: randomUUID(),
      expiresAt: new Date(Date.now() - 1000),
    });

    const caller = callerNoTenant(expSession.id, expUser);
    await expect(
      caller.tenant.acceptById({ invitationId: invite.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
