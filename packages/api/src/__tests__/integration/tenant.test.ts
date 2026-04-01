/**
 * tenant.test.ts — Integration tests for the tenant router.
 *
 * Covers:
 *   - tenant.list: memberships returned, role per tenant
 *   - tenant.select: session tenantId updated, non-member rejection
 *   - tenant.members: full member list with user info
 *   - tenant.updateMemberRole: owner can change role, cannot touch owner/superadmin
 *   - tenant.removeMember: owner can remove members, cannot remove self or superadmin
 *   - tenant.inviteMember: only owner/admin can invite, returns raw token
 *
 * Lifecycle:
 *   beforeAll  — shared fixture world (users + tenants + memberships + sessions)
 *   afterAll   — truncate all tables
 *
 * All callers use the direct tRPC context injection pattern so we exercise
 * the full middleware chain (isAuthenticated, hasTenantAccess) without HTTP.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, tenantMembers } from "@hisaabo/db";
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

/**
 * Build a protectedProcedure-compatible caller with a session cookie embedded
 * so tenant.select (which reads the session-id from the cookie) works correctly.
 */
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

/** protectedProcedure caller (authenticated but no tenantId in context). */
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

// ── Shared fixture state ──────────────────────────────────────────────────────

let ramesh: TestUser;
let suresh: TestUser;
let kiran: TestUser;
let tenant1: TestTenant;
let tenant2: TestTenant;
let rameshSession: TestSession;
let sureshSession: TestSession;
let kiranSession: TestSession;

beforeAll(async () => {
  // Users
  ramesh = await createUser({ email: "ramesh.tenant@acme.in", name: "Ramesh Kumar" });
  suresh = await createUser({ email: "suresh.tenant@acme.in", name: "Suresh Sharma" });
  kiran = await createUser({ email: "kiran.tenant@kiran.in", name: "Kiran Mehta" });

  // Tenants
  tenant1 = await createTenant({ name: "Acme Corp" });
  tenant2 = await createTenant({ name: "Beta Industries" });

  // Memberships: Ramesh = owner@tenant1, Suresh = seller@tenant1, Kiran = owner@tenant2
  await addMember(tenant1.id, ramesh.id, "owner");
  await addMember(tenant1.id, suresh.id, "seller");
  await addMember(tenant2.id, kiran.id, "owner");

  // Sessions
  rameshSession = await createSession(ramesh.id, tenant1.id);
  sureshSession = await createSession(suresh.id, tenant1.id);
  kiranSession = await createSession(kiran.id, tenant2.id);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.list
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.list", () => {
  it("returns tenants the user is a member of — includes role and tenant metadata", async () => {
    const caller = callerNoTenant(rameshSession.id, ramesh);
    const memberships = await caller.tenant.list();

    expect(memberships.length).toBeGreaterThanOrEqual(1);
    const acme = memberships.find((m) => m.tenantId === tenant1.id);
    expect(acme).toBeDefined();
    expect(acme!.role).toBe("owner");
    expect(acme!.tenantName).toBe("Acme Corp");
    expect(acme!.tenantPlan).toBe("free");
  });

  it("shows correct role per tenant — Suresh is seller on Acme Corp", async () => {
    const caller = callerNoTenant(sureshSession.id, suresh);
    const memberships = await caller.tenant.list();

    const acme = memberships.find((m) => m.tenantId === tenant1.id);
    expect(acme).toBeDefined();
    expect(acme!.role).toBe("seller");
  });

  it("does not include tenants the user has no membership in — Ramesh cannot see Beta Industries", async () => {
    const caller = callerNoTenant(rameshSession.id, ramesh);
    const memberships = await caller.tenant.list();

    const beta = memberships.find((m) => m.tenantId === tenant2.id);
    expect(beta).toBeUndefined();
  });

  it("requires authentication — unauthenticated caller receives UNAUTHORIZED", async () => {
    const ctx = createTestContext({});
    const caller = _callerFactory(ctx);
    await expect(caller.tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.select
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.select", () => {
  it("switches active tenant — updates session.tenantId in the database", async () => {
    const db = getControlDb();

    // Add Suresh to tenant2 so he can switch to it
    await addMember(tenant2.id, suresh.id, "seller");

    const caller = callerNoTenant(sureshSession.id, suresh);
    const result = await caller.tenant.select({ tenantId: tenant2.id });
    expect(result.success).toBe(true);

    // Verify the session row was updated
    const [sess] = await db
      .select({ tenantId: sessions.tenantId })
      .from(sessions)
      .where(eq(sessions.id, sureshSession.id))
      .limit(1);
    expect(sess!.tenantId).toBe(tenant2.id);

    // Restore suresh to tenant1 context for subsequent tests
    await db.update(sessions).set({ tenantId: tenant1.id }).where(eq(sessions.id, sureshSession.id));
  });

  it("rejects switching to a tenant the user is NOT a member of — FORBIDDEN", async () => {
    const unrelatedTenant = await createTenant({ name: "Unrelated Org" });
    const caller = callerNoTenant(rameshSession.id, ramesh);

    await expect(
      caller.tenant.select({ tenantId: unrelatedTenant.id })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Not a member of this organization",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.members
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.members", () => {
  it("lists all members of the current tenant with their roles and user info", async () => {
    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    const members = await caller.tenant.members();

    // Tenant1 has Ramesh (owner) and Suresh (seller) at minimum
    expect(members.length).toBeGreaterThanOrEqual(2);

    const rameshMember = members.find((m) => m.userId === ramesh.id);
    expect(rameshMember).toBeDefined();
    expect(rameshMember!.role).toBe("owner");
    expect(rameshMember!.userEmail).toBe("ramesh.tenant@acme.in");
    expect(rameshMember!.userName).toBe("Ramesh Kumar");

    const sureshMember = members.find((m) => m.userId === suresh.id);
    expect(sureshMember).toBeDefined();
    expect(sureshMember!.role).toBe("seller");
  });

  it("does not leak members from a different tenant — Kiran only sees Beta Industries members", async () => {
    const caller = callerForTenant(kiranSession.id, kiran, tenant2.id);
    const members = await caller.tenant.members();

    // Kiran should only see Beta Industries members (herself)
    const rameshInBeta = members.find((m) => m.userId === ramesh.id);
    expect(rameshInBeta).toBeUndefined();
  });

  it("requires tenantId in context — caller without tenant receives BAD_REQUEST", async () => {
    const caller = callerNoTenant(rameshSession.id, ramesh);
    await expect(caller.tenant.members()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.updateMemberRole
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.updateMemberRole", () => {
  it("owner can change a seller's role to admin", async () => {
    const db = getControlDb();

    // Create a fresh seller to avoid affecting Suresh in other tests
    const target = await createUser({ email: "target.role@acme.in", name: "Target Member" });
    await addMember(tenant1.id, target.id, "seller");

    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    const result = await caller.tenant.updateMemberRole({ userId: target.id, role: "admin" });
    expect(result.success).toBe(true);

    // Verify the DB was updated
    const [membership] = await db
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, target.id))
      .limit(1);
    expect(membership!.role).toBe("admin");
  });

  it("cannot change the role of an owner/superadmin — FORBIDDEN", async () => {
    // Suresh is a seller, but add a second owner to try to demote
    const secondOwner = await createUser({ email: "secondowner@acme.in", name: "Second Owner" });
    await addMember(tenant1.id, secondOwner.id, "owner");

    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    await expect(
      caller.tenant.updateMemberRole({ userId: secondOwner.id, role: "seller" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Cannot change the role of a superadmin",
    });
  });

  it("seller cannot change member roles — FORBIDDEN due to insufficient permissions", async () => {
    const caller = callerForTenant(sureshSession.id, suresh, tenant1.id);
    await expect(
      caller.tenant.updateMemberRole({ userId: ramesh.id, role: "seller" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only owners and admins can change roles",
    });
  });

  it("cannot escalate to superadmin — the input schema rejects superadmin as a valid role", async () => {
    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    // The updateMemberRole input schema uses z.enum(["admin","seller_manager","seller","accountant"])
    // so passing "superadmin" should fail Zod validation
    await expect(
      caller.tenant.updateMemberRole({ userId: suresh.id, role: "superadmin" as unknown as "admin" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.removeMember
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.removeMember", () => {
  it("owner can remove a regular member — tenant_members row is deleted", async () => {
    const db = getControlDb();

    const removable = await createUser({ email: "removable@acme.in", name: "Removable Member" });
    await addMember(tenant1.id, removable.id, "seller");

    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    const result = await caller.tenant.removeMember({ userId: removable.id });
    expect(result.success).toBe(true);

    // Membership should be gone
    const [remaining] = await db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, removable.id))
      .limit(1);
    expect(remaining).toBeUndefined();
  });

  it("cannot remove yourself — BAD_REQUEST", async () => {
    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    await expect(
      caller.tenant.removeMember({ userId: ramesh.id })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot remove yourself",
    });
  });

  it("cannot remove a superadmin/owner — FORBIDDEN", async () => {
    // Kiran is owner of tenant2; use a different owner to try to remove her
    const anotherOwner = await createUser({ email: "anotherowner@beta.in", name: "Another Owner" });
    await addMember(tenant2.id, anotherOwner.id, "owner");
    const anotherOwnerSession = await createSession(anotherOwner.id, tenant2.id);

    const caller = callerForTenant(anotherOwnerSession.id, anotherOwner, tenant2.id);
    await expect(
      caller.tenant.removeMember({ userId: kiran.id })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Cannot remove a superadmin",
    });
  });

  it("seller cannot remove members — FORBIDDEN due to insufficient permissions", async () => {
    const victim = await createUser({ email: "victim@acme.in", name: "Victim" });
    await addMember(tenant1.id, victim.id, "accountant");

    const caller = callerForTenant(sureshSession.id, suresh, tenant1.id);
    await expect(
      caller.tenant.removeMember({ userId: victim.id })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only owners and admins can remove members",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tenant.inviteMember
// ─────────────────────────────────────────────────────────────────────────────

describe("tenant.inviteMember", () => {
  it("owner can invite a new member — returns raw token and expiry 7 days from now", async () => {
    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    const result = await caller.tenant.inviteMember({
      email: "newcomer@acme.in",
      role: "seller",
    });

    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(10);
    const msUntilExpiry = result.expiresAt.getTime() - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(msUntilExpiry).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it("seller cannot invite members — FORBIDDEN due to insufficient permissions", async () => {
    const caller = callerForTenant(sureshSession.id, suresh, tenant1.id);
    await expect(
      caller.tenant.inviteMember({ email: "noone@acme.in", role: "seller" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only owners and admins can invite members",
    });
  });

  it("inviting an already-existing member returns CONFLICT", async () => {
    // Suresh is already a member of tenant1
    const caller = callerForTenant(rameshSession.id, ramesh, tenant1.id);
    await expect(
      caller.tenant.inviteMember({ email: suresh.email, role: "accountant" })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "User is already a member",
    });
  });
});
