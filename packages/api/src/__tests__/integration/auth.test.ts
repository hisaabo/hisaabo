/**
 * auth.test.ts — Integration tests for the auth router.
 *
 * These tests exercise the full tRPC middleware chain against a real PostgreSQL
 * test database. They cover:
 *   - password sign-in removed: auth.register / auth.login are not routable
 *   - auth.me: authenticated and unauthenticated responses
 *   - auth.logout: session invalidation
 *   - auth.verifyMagicLink: sign-up, single use, and revocation of credentials
 *     issued before an account's email was first verified
 *
 * Lifecycle:
 *   beforeAll  — nothing (each describe block sets up its own fixtures)
 *   afterEach  — nothing (rows accumulate within a describe, isolated by unique emails)
 *   afterAll   — truncate all tables so the next suite starts clean
 *
 * The test context bypasses cookies: session tokens are injected directly into
 * the tRPC context. Logout is tested using createTestContext with a cookie
 * header so the session-ID extraction path in auth.ts is exercised.
 */

import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from "vitest";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { users, sessions, tenants, tenantMembers, magicLinkTokens, invitations, apiKeys } from "@hisaabo/db";
import { isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  createUser,
  createTenant,
  addMember,
  createSession,
} from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { createContext } from "../../context.js";
import { appRouter } from "../../router.js";
import { emailService } from "../../lib/email.js";

// ── Caller factory ────────────────────────────────────────────────────────────

const _callerFactory = createCallerFactory(appRouter);

/**
 * Build a caller for a fully authenticated user who has a tenant session.
 * The session cookie is set on the synthetic request so that auth.logout and
 * auth.me exercise the real session-extraction code path.
 */
function callerWithSession(sessionId: string, userId: string, email: string, tenantId?: string) {
  const headers = new Headers({
    "content-type": "application/json",
    "cookie": `session_id=${sessionId}`,
    // The tRPC-layer CSRF middleware requires this sentinel on any
    // cookie-authenticated POST (see `packages/api/src/trpc.ts`). Real
    // web clients send it unconditionally; integration tests must match.
    "x-requested-with": "hisaabo",
    ...(tenantId ? {} : {}),
  });
  const req = new Request("http://localhost:3000/api/trpc/test", {
    method: "POST",
    headers,
  });
  const resHeaders = new Headers();
  const ctx = {
    user: { id: userId, email, name: null },
    tenantId: tenantId ?? null,
    businessId: null,
    req,
    resHeaders,
    ipAddress: null,
    authTokenKind: "cookie" as const,
  };
  return _callerFactory(ctx);
}

/**
 * Unauthenticated caller — no user, no session cookie.
 */
function unauthCaller(client?: "desktop" | "mobile" | "cli" | "web-spoof") {
  return _callerFactory(createTestContext(client ? { headers: { "x-hisaabo-client": client } } : {}));
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// Session ids are never exposed by the API; clients refer to a session by sha256(id).
const hashSessionId = (id: string) => createHash("sha256").update(id).digest("hex");

// ─────────────────────────────────────────────────────────────────────────────
// Password sign-in removed
// ─────────────────────────────────────────────────────────────────────────────

describe("password sign-in is not exposed", () => {
  it("auth.register and auth.login are not procedures on the router", async () => {
    expect(Object.keys(appRouter._def.procedures)).not.toContain("auth.register");
    expect(Object.keys(appRouter._def.procedures)).not.toContain("auth.login");

    const auth = unauthCaller().auth as unknown as Record<string, (input: unknown) => Promise<unknown>>;
    const credentials = { email: "nopassword@vyapar.in", password: "SecurePass1!", confirmPassword: "SecurePass1!", name: "No Password" };
    await expect(auth.register!(credentials)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(auth.login!(credentials)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.me
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.me", () => {
  let meUser: Awaited<ReturnType<typeof createUser>>;
  let meTenant: Awaited<ReturnType<typeof createTenant>>;
  let meSession: Awaited<ReturnType<typeof createSession>>;

  beforeAll(async () => {
    meUser = await createUser({ email: "me.test@vyapar.in", name: "Me Tester" });
    meTenant = await createTenant({ name: "Me Test Org" });
    await addMember(meTenant.id, meUser.id, "owner");
    meSession = await createSession(meUser.id, meTenant.id);
  });

  it("returns current user info when the request carries a valid session", async () => {
    const caller = callerWithSession(meSession.id, meUser.id, meUser.email, meTenant.id);
    const result = await caller.auth.me();

    expect(result.user).not.toBeNull();
    expect(result.user!.id).toBe(meUser.id);
    expect(result.user!.email).toBe("me.test@vyapar.in");
    expect(result.tenantId).toBe(meTenant.id);
    expect(result.tenantName).toBe("Me Test Org");
    // me returns the raw DB role; mapDbRole is applied in the permission middleware
    expect(result.role).toBe("owner");
  });

  it("returns null user and null tenant for an unauthenticated request — no session present", async () => {
    const caller = unauthCaller();
    const result = await caller.auth.me();

    expect(result.user).toBeNull();
    expect(result.tenantId).toBeNull();
    expect(result.tenantName).toBeNull();
    expect(result.role).toBeNull();
    expect(result.needsProfile).toBe(false);
  });

  it("needsProfile is true when user has no display name", async () => {
    const namelessUser = await createUser({ email: "nameless@vyapar.in", name: null as unknown as string });
    const namelessTenant = await createTenant({ name: "Nameless Org" });
    await addMember(namelessTenant.id, namelessUser.id, "owner");
    const namelessSession = await createSession(namelessUser.id, namelessTenant.id);

    const caller = callerWithSession(namelessSession.id, namelessUser.id, namelessUser.email, namelessTenant.id);
    const result = await caller.auth.me();

    expect(result.needsProfile).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.logout
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.logout", () => {
  let logoutUser: Awaited<ReturnType<typeof createUser>>;
  let logoutTenant: Awaited<ReturnType<typeof createTenant>>;
  let logoutSession: Awaited<ReturnType<typeof createSession>>;

  beforeAll(async () => {
    logoutUser = await createUser({ email: "logout.test@vyapar.in", name: "Logout Tester" });
    logoutTenant = await createTenant({ name: "Logout Org" });
    await addMember(logoutTenant.id, logoutUser.id, "owner");
    logoutSession = await createSession(logoutUser.id, logoutTenant.id);
  });

  it("invalidates the session — session row is deleted from the DB after logout", async () => {
    const db = getControlDb();

    // Confirm session exists before logout
    const [before] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, logoutSession.id))
      .limit(1);
    expect(before).toBeDefined();

    // Perform logout using a caller that carries the session cookie
    const caller = callerWithSession(logoutSession.id, logoutUser.id, logoutUser.email, logoutTenant.id);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);

    // Session row must be gone from control DB
    const [after] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, logoutSession.id))
      .limit(1);
    expect(after).toBeUndefined();
  });

  it("logout on an unauthenticated request returns UNAUTHORIZED", async () => {
    const caller = unauthCaller();
    await expect(caller.auth.logout()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.sendMagicLink — email URL shape
//
// The email CTA is ALWAYS an HTTPS link (email clients strip custom URL
// schemes). The secondary hisaabo:// link was removed; native clients sign in
// through the browser handoff (auth.nativeStart) instead.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.sendMagicLink — email URL shape", () => {
  let sendSpy: MockInstance<typeof emailService.sendMagicLink>;
  beforeAll(() => {
    sendSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);
  });

  afterAll(() => {
    sendSpy.mockRestore();
  });

  it("web source: https link with no source suffix and no secondary deep link", async () => {
    sendSpy.mockClear();
    await unauthCaller().auth.sendMagicLink({ email: "deeplink-web@vyapar.in", source: "web" });

    expect(sendSpy).toHaveBeenCalledOnce();
    const args = sendSpy.mock.calls[0]!;
    expect(args[1]).toMatch(/^https?:\/\/.+\/auth\/verify\?token=/);
    expect(args[1]).not.toContain("source=");
    expect(args.some((a) => typeof a === "string" && a.startsWith("hisaabo://"))).toBe(false);
  });

  it("mobile/desktop source: still https and keeps the source param for older clients; never a hisaabo:// link", async () => {
    for (const source of ["mobile", "desktop"] as const) {
      sendSpy.mockClear();
      await unauthCaller().auth.sendMagicLink({ email: `deeplink-${source}@vyapar.in`, source });
      const args = sendSpy.mock.calls[0]!;
      expect(args[1]).toMatch(/^https?:\/\//);
      expect(args[1]).toContain(`&source=${source}`);
      expect(args.some((a) => typeof a === "string" && a.startsWith("hisaabo://"))).toBe(false);
    }
  });
});

describe("auth.sendMagicLink — Turnstile is never skipped by a client header", () => {
  let sendSpy: MockInstance<typeof emailService.sendMagicLink>;
  beforeAll(() => {
    sendSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);
  });

  afterAll(() => {
    sendSpy.mockRestore();
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("requires a Turnstile token when TURNSTILE_SECRET_KEY is set, even for X-Hisaabo-Client: desktop", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    sendSpy.mockClear();
    for (const client of [undefined, "desktop", "mobile", "cli"] as const) {
      await expect(
        unauthCaller(client).auth.sendMagicLink({ email: "turnstile-required@vyapar.in", source: "web" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Turnstile verification required" });
    }
    expect(sendSpy).not.toHaveBeenCalled();
    delete process.env.TURNSTILE_SECRET_KEY;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.verifyMagicLink — transaction isolation regression test
//
// Regression: assignTenantToNewUser() used controlDb directly instead of the
// parent transaction's tx. The user row (inserted by tx) was invisible to
// tenant_members insert (using controlDb) → FK violation on user_id.
// Fix: pass tx through to getOrCreateDefaultTenant / assignTenantToNewUser.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.verifyMagicLink", () => {
  const db = getControlDb();

  it("creates a new user AND tenant membership atomically — no FK violation", async () => {
    const caller = unauthCaller("mobile");
    const email = "magic-link-new@vyapar.in";
    const rawToken = "test-magic-token-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const result = await caller.auth.verifyMagicLink({ token: rawToken });

    expect(result.user.email).toBe(email);
    expect(result.isNewUser).toBe(true);
    expect(result.needsProfile).toBe(true);
    expect(typeof result.sessionToken).toBe("string");

    const [dbUser] = await db.select().from(users)
      .where(eq(users.email, email)).limit(1);
    expect(dbUser).toBeDefined();

    const memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, dbUser!.id));
    expect(memberships.length).toBeGreaterThanOrEqual(1);
  });

  it("returns existing user for repeated magic link verify — no duplicate", async () => {
    const caller = unauthCaller();
    const email = "magic-link-existing@vyapar.in";

    await createUser({ email, name: "Existing User" });

    const rawToken = "test-magic-existing-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const result = await caller.auth.verifyMagicLink({ token: rawToken });
    expect(result.user.email).toBe(email);
    expect(result.isNewUser).toBe(false);
  });

  // ── Accounts created before their email was proven ─────────────────────
  //
  // A legacy password sign-up could create an account (with a session and API
  // keys) for an email the creator did not own. The first magic link to that
  // mailbox must not inherit any of it.
  it("revokes pre-verification sessions and API keys and clears the password on first verification", async () => {
    const email = "legacy-unverified@vyapar.in";
    const legacy = await createUser({ email, emailVerified: false, passwordHash: "$argon2id$v=19$legacy" });
    const tenant = await createTenant();
    await addMember(tenant.id, legacy.id, "owner");
    const oldSession = await createSession(legacy.id, tenant.id);
    await db.insert(apiKeys).values({
      userId: legacy.id, tenantId: tenant.id, keyHash: "legacy-key-hash", keyPrefix: "hisaabo_key_legacy", name: "legacy",
    });

    const rawToken = "test-magic-legacy-" + Date.now();
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const result = await unauthCaller("desktop").auth.verifyMagicLink({ token: rawToken });
    expect(result.isNewUser).toBe(false);

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, legacy.id));
    expect(remaining.map((r) => r.id)).toEqual([result.sessionToken]);
    expect(remaining.map((r) => r.id)).not.toContain(oldSession.id);
    expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, legacy.id))).toHaveLength(0);

    const [dbUser] = await db.select().from(users).where(eq(users.id, legacy.id));
    expect(dbUser!.emailVerified).toBe(true);
    expect(dbUser!.passwordHash).toBeNull();

    // The new session authenticates through the real context; the old one does not.
    const bearer = (token: string) => createContext({
      req: new Request("http://localhost:3000/api/trpc/auth.me", { headers: { authorization: `Bearer ${token}` } }),
      resHeaders: new Headers(),
      info: {} as never,
    });
    expect((await bearer(result.sessionToken!)).user?.id).toBe(legacy.id);
    expect((await bearer(oldSession.id)).user).toBeNull();
  });

  it("keeps a verified user's existing sessions and API keys on a later magic-link sign-in", async () => {
    const email = "verified-keeps@vyapar.in";
    const user = await createUser({ email });
    const tenant = await createTenant();
    await addMember(tenant.id, user.id, "owner");
    const existing = await createSession(user.id, tenant.id);
    await db.insert(apiKeys).values({
      userId: user.id, tenantId: tenant.id, keyHash: "verified-key-hash", keyPrefix: "hisaabo_key_verified", name: "cli",
    });

    const rawToken = "test-magic-verified-" + Date.now();
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await unauthCaller("desktop").auth.verifyMagicLink({ token: rawToken });

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining.map((r) => r.id)).toContain(existing.id);
    expect(remaining).toHaveLength(2);
    expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id))).toHaveLength(1);
  });

  it("rejects expired magic link token", async () => {
    const caller = unauthCaller();
    const rawToken = "test-magic-expired-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await db.insert(magicLinkTokens).values({
      email: "expired@vyapar.in",
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(caller.auth.verifyMagicLink({ token: rawToken })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  // ── Protective: token is single-use on success (P0-2) ───────────────────
  //
  // Regression guard: after a successful verify, the same raw token must NOT
  // be reusable. Protects against the claim UPDATE moving back outside the
  // tx in a way that doesn't preserve single-use semantics.
  it("burns the token on a successful verify — same raw token fails on replay", async () => {
    const caller = unauthCaller();
    const email = "magic-single-use@vyapar.in";
    const rawToken = "test-magic-single-use-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // First use succeeds
    const first = await caller.auth.verifyMagicLink({ token: rawToken });
    expect(first.user.email).toBe(email);

    // Replay returns BAD_REQUEST — not INTERNAL_SERVER_ERROR, not success.
    // The atomic UPDATE ... WHERE usedAt IS NULL ... RETURNING is the sole
    // gate; on replay it returns 0 rows and the handler throws BAD_REQUEST.
    await expect(caller.auth.verifyMagicLink({ token: rawToken }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── Protective: pending invitation skips tenant auto-creation (P1-9) ────
  //
  // When an email has a pending invitation, verify must NOT auto-create an
  // organization. The user will join the invited org after completing their
  // profile. Protects the invitation branch at auth.ts inside verifyMagicLink
  // — if someone removes the invitation peek or the in-tx re-check, new
  // invited users would get an unwanted free org auto-created and the
  // onboarding flow would bifurcate silently.
  it("skips auto-tenant creation when the user has a pending invitation", async () => {
    const caller = unauthCaller();
    const email = "invited-new-user@vyapar.in";

    // Seed: an inviting tenant + a pending invitation for our email
    const [invitingTenant] = await db.insert(tenants).values({
      name: "Inviting Org",
      slug: "inviting-org-" + nanoid(6),
    }).returning({ id: tenants.id });

    // Need a user to be the inviter (FK on invitations.invitedBy)
    const inviter = await createUser({ email: "inviter@vyapar.in", name: "Inviter" });
    await addMember(invitingTenant!.id, inviter.id, "owner");

    const inviteToken = "invite-" + nanoid(32);
    await db.insert(invitations).values({
      tenantId: invitingTenant!.id,
      email: email.toLowerCase(),
      role: "member",
      token: inviteToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      invitedBy: inviter.id,
    });

    // Now verify a magic link for the SAME email — should NOT create a new tenant
    const rawToken = "magic-invited-" + Date.now();
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const result = await caller.auth.verifyMagicLink({ token: rawToken });

    expect(result.user.email).toBe(email);
    expect(result.isNewUser).toBe(true);
    expect(result.needsProfile).toBe(true);

    // The user has ZERO memberships because no tenant was auto-created and
    // the invitation hasn't been accepted yet. The invitation is accepted via
    // a separate call (tenant.acceptById / acceptInvitation).
    const [dbUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(dbUser).toBeDefined();
    const memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, dbUser!.id));
    expect(memberships).toHaveLength(0);

    // The session row has tenantId=null — user must accept the invite / pick
    // an org before any business operations.
    const [sess] = await db.select().from(sessions)
      .where(eq(sessions.userId, dbUser!.id)).limit(1);
    expect(sess).toBeDefined();
    expect(sess!.tenantId).toBeNull();

    // And the invitation is still pending (not auto-accepted by the magic
    // link flow — that's the responsibility of tenant.acceptById).
    const pending = await db.select().from(invitations)
      .where(isNull(invitations.acceptedAt));
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.revokeSession
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.revokeSession", () => {
  it("revokes another session — session row is deleted, revoking user's session A still works", async () => {
    const db = getControlDb();

    // Create a user with two sessions (simulates two devices)
    const user = await createUser({ email: "revoke.test@example.in", name: "Revoke User" });
    const tenant = await createTenant({ name: "Revoke Test Org" });
    await addMember(tenant.id, user.id, "owner");
    const sessionA = await createSession(user.id, tenant.id); // "this device"
    const sessionB = await createSession(user.id, tenant.id); // "other device"

    // From session A, revoke session B
    const callerA = callerWithSession(sessionA.id, user.id, user.email, tenant.id);
    const result = await callerA.auth.revokeSession({ sessionId: hashSessionId(sessionB.id) });
    expect(result.success).toBe(true);

    // Verify session B is gone from DB — createContext will return user:null
    // for this session, causing protectedProcedure to throw UNAUTHORIZED
    const [remaining] = await db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionB.id))
      .limit(1);
    expect(remaining).toBeUndefined();

    // Verify session A still works
    const meA = await callerA.auth.me();
    expect(meA.user?.email).toBe("revoke.test@example.in");

    // Verify session A is still in DB
    const [sessionARow] = await db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionA.id))
      .limit(1);
    expect(sessionARow).toBeDefined();
  });

  it("cannot revoke your own current session — BAD_REQUEST", async () => {
    const user = await createUser({ email: "self.revoke@example.in", name: "Self Revoker" });
    const session = await createSession(user.id);

    const caller = callerWithSession(session.id, user.id, user.email);
    await expect(
      caller.auth.revokeSession({ sessionId: hashSessionId(session.id) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot revoke your current session. Use logout instead.",
    });
  });

  it("cannot revoke another user's session — NOT_FOUND", async () => {
    const user1 = await createUser({ email: "user1.revoke@example.in", name: "User 1" });
    const user2 = await createUser({ email: "user2.revoke@example.in", name: "User 2" });
    const session1 = await createSession(user1.id);
    const session2 = await createSession(user2.id);

    // User 1 tries to revoke User 2's session
    const caller1 = callerWithSession(session1.id, user1.id, user1.email);
    await expect(
      caller1.auth.revokeSession({ sessionId: hashSessionId(session2.id) }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  });
});
