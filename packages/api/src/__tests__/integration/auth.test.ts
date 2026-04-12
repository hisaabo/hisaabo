/**
 * auth.test.ts — Integration tests for the auth router.
 *
 * These tests exercise the full tRPC middleware chain against a real PostgreSQL
 * test database. They cover:
 *   - auth.register: user creation, session issuance, Argon2id hashing, validation
 *   - auth.login: credential verification, no-enumeration invariant
 *   - auth.me: authenticated and unauthenticated responses
 *   - auth.logout: session invalidation
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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { users, sessions, tenantMembers, magicLinkTokens } from "@hisaabo/db";
import {
  createUser,
  createTenant,
  addMember,
  createSession,
} from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
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
  };
  return _callerFactory(ctx);
}

/**
 * Unauthenticated caller — no user, no session cookie.
 */
function unauthCaller() {
  return _callerFactory(createTestContext({}));
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.register
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.register", () => {
  const db = getControlDb();

  it("registers a new user with email and password — creates user, session, and default tenant membership", async () => {
    const caller = unauthCaller();

    const result = await caller.auth.register({
      email: "ramesh.new@vyapar.in",
      name: "Ramesh Kumar",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    // Returned shape is correct
    expect(result.user.email).toBe("ramesh.new@vyapar.in");
    expect(result.user.name).toBe("Ramesh Kumar");
    expect(result.user.id).toBeTruthy();
    expect(typeof result.sessionToken).toBe("string");
    expect(result.sessionToken.length).toBeGreaterThan(30);

    // User row persisted in control DB
    const [dbUser] = await db.select().from(users).where(eq(users.email, "ramesh.new@vyapar.in")).limit(1);
    expect(dbUser).toBeDefined();
    expect(dbUser!.email).toBe("ramesh.new@vyapar.in");

    // Password is NOT stored in plaintext — the hash must start with $argon2id$
    expect(dbUser!.passwordHash).not.toBe("SecurePass1!");
    expect(dbUser!.passwordHash).toMatch(/^\$argon2id\$/);

    // Session row created in control DB
    const [dbSession] = await db.select().from(sessions).where(eq(sessions.userId, dbUser!.id)).limit(1);
    expect(dbSession).toBeDefined();
    // Session expires ~30 days from now: check it's at least 29 days in the future
    const msUntilExpiry = dbSession!.expiresAt.getTime() - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("rejects duplicate email registration — returns CONFLICT without creating a second user", async () => {
    const caller = unauthCaller();

    // First registration
    await caller.auth.register({
      email: "duplicate@vyapar.in",
      name: "First User",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    // Second registration with same email
    await expect(
      caller.auth.register({
        email: "duplicate@vyapar.in",
        name: "Second User",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Email already registered",
    });

    // Still only one user with this email
    const rows = await db.select().from(users).where(eq(users.email, "duplicate@vyapar.in"));
    expect(rows).toHaveLength(1);
  });

  it("rejects mismatched confirmPassword — Zod validation error on confirmPassword field", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "mismatch@vyapar.in",
        name: "Someone",
        password: "SecurePass1!",
        confirmPassword: "DifferentPass1!",
      })
    ).rejects.toSatisfy((err: unknown) => {
      // tRPC wraps Zod errors as BAD_REQUEST
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("rejects password shorter than 8 characters — Zod min(8) validation on password field", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "shortpw@vyapar.in",
        name: "Someone",
        password: "abc",
        confirmPassword: "abc",
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("rejects invalid email format — Zod email() validation", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "not-an-email",
        name: "Someone",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("rejects name shorter than 2 characters — Zod min(2) validation on name field", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "shortname@vyapar.in",
        name: "A",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("stores password as Argon2id hash — plaintext is never persisted in the users table", async () => {
    const caller = unauthCaller();
    const email = "argon2check@vyapar.in";

    await caller.auth.register({
      email,
      name: "Hash Checker",
      password: "PlainTextPassword1!",
      confirmPassword: "PlainTextPassword1!",
    });

    const [dbUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(dbUser).toBeDefined();

    // Must start with Argon2id identifier
    expect(dbUser!.passwordHash).toMatch(/^\$argon2id\$/);
    // Must NOT contain the plaintext
    expect(dbUser!.passwordHash).not.toContain("PlainTextPassword1!");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.login
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.login", () => {
  // Pre-condition: user already exists in DB (via fixtures, no roundtrip through register)
  let loginUserId: string;

  beforeAll(async () => {
    // Create a user with a real Argon2id hash of "Test@1234!" using the auth.register
    // flow so we have a known password we can verify against.
    const caller = unauthCaller();
    const result = await caller.auth.register({
      email: "login.test@vyapar.in",
      name: "Login Tester",
      password: "Test@1234!",
      confirmPassword: "Test@1234!",
    });
    loginUserId = result.user.id;
  });

  it("succeeds with correct email and password — returns user object and session token", async () => {
    const caller = unauthCaller();
    const result = await caller.auth.login({
      email: "login.test@vyapar.in",
      password: "Test@1234!",
    });

    expect(result.user.email).toBe("login.test@vyapar.in");
    expect(result.user.id).toBe(loginUserId);
    expect(typeof result.sessionToken).toBe("string");
    expect(result.sessionToken.length).toBeGreaterThan(30);

    // A new session row should now exist
    const db = getControlDb();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.sessionToken))
      .limit(1);
    expect(session).toBeDefined();
    expect(session!.userId).toBe(loginUserId);
  });

  it("login with wrong password returns UNAUTHORIZED — does not leak whether email exists", async () => {
    const caller = unauthCaller();
    await expect(
      caller.auth.login({
        email: "login.test@vyapar.in",
        password: "WrongPassword!",
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
  });

  it("login with non-existent email returns the same UNAUTHORIZED error — no user enumeration", async () => {
    const caller = unauthCaller();

    let wrongPasswordError: TRPCError | undefined;
    let noUserError: TRPCError | undefined;

    try {
      await caller.auth.login({ email: "login.test@vyapar.in", password: "WrongPw1!" });
    } catch (err) {
      if (err instanceof TRPCError) wrongPasswordError = err;
    }

    try {
      await caller.auth.login({ email: "nobody.exists@vyapar.in", password: "Anything1!" });
    } catch (err) {
      if (err instanceof TRPCError) noUserError = err;
    }

    // Both cases must produce identical code and message — no enumeration possible
    expect(wrongPasswordError).toBeDefined();
    expect(noUserError).toBeDefined();
    expect(wrongPasswordError!.code).toBe(noUserError!.code);
    expect(wrongPasswordError!.message).toBe(noUserError!.message);
  });

  it("login for a user with no passwordHash (magic-link-only account) returns UNAUTHORIZED", async () => {
    // Insert a user without a password hash to simulate a magic-link-only account
    const _db = getControlDb();
    const tenant = await createTenant({ name: "MagicOnly Org" });
    const magicUser = await createUser({
      email: "magiconly@vyapar.in",
      passwordHash: null as unknown as string,
      emailVerified: true,
    });
    await addMember(tenant.id, magicUser.id, "owner");

    const caller = unauthCaller();
    await expect(
      caller.auth.login({ email: "magiconly@vyapar.in", password: "Anything1!" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
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
// CRITICAL INVARIANT: the primary email CTA is ALWAYS an HTTPS URL, never
// a `hisaabo://` custom-scheme anchor. Email clients (Gmail, Outlook, Apple
// Mail, corporate gateways) strip or refuse to render custom URL schemes as
// clickable links, so a `hisaabo://` primary reaches the user as plain,
// unclickable text. If this test fails because someone reverted the primary
// URL to the custom scheme, DO NOT fix the test — fix the server to keep
// shipping HTTPS as the primary and hand off to the native app from the
// /auth/verify page. See apps/web/src/routes/auth/verify.tsx for the
// browser-to-app hand-off logic this relies on.
//
// Historical regression the old suite guarded against (preserved below):
// the deep link path must be `/verify`, never `/auth/verify`, because Expo
// Router uses (auth) as a layout group, so the actual scheme path is
// /verify. Desktop Tauri's deep-link handler translates /verify into the
// webview path /auth/verify.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.sendMagicLink — email URL shape", () => {
  const sendSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);

  afterAll(() => {
    sendSpy.mockRestore();
  });

  it("web source: primary is an https link with no source suffix, secondary is the hisaabo://verify deep link", async () => {
    sendSpy.mockClear();
    const caller = unauthCaller();
    await caller.auth.sendMagicLink({ email: "deeplink-web@vyapar.in", source: "web" });

    expect(sendSpy).toHaveBeenCalledOnce();
    const [, primaryUrl, secondaryUrl] = sendSpy.mock.calls[0]!;
    expect(primaryUrl).toMatch(/^https?:\/\/.+\/auth\/verify\?token=/);
    // Web source does not thread `source` through the URL — the verify
    // page only hands off to the native app when source is desktop/mobile.
    expect(primaryUrl).not.toContain("source=");
    expect(secondaryUrl).toMatch(/^hisaabo:\/\/verify\?token=/);
    expect(secondaryUrl).not.toContain("hisaabo://auth/");
  });

  it("mobile source: primary is an https link with source=mobile, secondary is the hisaabo://verify deep link — primary MUST NOT be a custom-scheme URL because email clients strip non-http anchors and the user ends up with plain, unclickable text", async () => {
    sendSpy.mockClear();
    const caller = unauthCaller();
    await caller.auth.sendMagicLink({ email: "deeplink-mobile@vyapar.in", source: "mobile" });

    expect(sendSpy).toHaveBeenCalledOnce();
    const [, primaryUrl, secondaryUrl] = sendSpy.mock.calls[0]!;
    expect(primaryUrl).toMatch(/^https?:\/\/.+\/auth\/verify\?token=/);
    expect(primaryUrl).toContain("&source=mobile");
    // Regression guard: primary MUST be https so Gmail/Outlook render it as
    // a clickable button.
    expect(primaryUrl).not.toMatch(/^hisaabo:\/\//);
    expect(secondaryUrl).toMatch(/^hisaabo:\/\/verify\?token=/);
    expect(secondaryUrl).not.toContain("hisaabo://auth/");
  });

  it("desktop source: primary is an https link with source=desktop, secondary is the hisaabo://verify deep link — same email-client rationale as mobile", async () => {
    sendSpy.mockClear();
    const caller = unauthCaller();
    await caller.auth.sendMagicLink({ email: "deeplink-desktop@vyapar.in", source: "desktop" });

    expect(sendSpy).toHaveBeenCalledOnce();
    const [, primaryUrl, secondaryUrl] = sendSpy.mock.calls[0]!;
    expect(primaryUrl).toMatch(/^https?:\/\/.+\/auth\/verify\?token=/);
    expect(primaryUrl).toContain("&source=desktop");
    expect(primaryUrl).not.toMatch(/^hisaabo:\/\//);
    expect(secondaryUrl).toMatch(/^hisaabo:\/\/verify\?token=/);
    expect(secondaryUrl).not.toContain("hisaabo://auth/");
  });

  it("primary URL is NEVER a hisaabo:// custom-scheme link for ANY source — this is the load-bearing invariant that kept desktop/mobile users stuck with unclickable email buttons; if this ever regresses, users report 'the link in the email does nothing, I have to copy-paste it into Firefox' (verbatim user report)", async () => {
    for (const source of ["web", "desktop", "mobile"] as const) {
      sendSpy.mockClear();
      const caller = unauthCaller();
      await caller.auth.sendMagicLink({ email: `deeplink-${source}-guard@vyapar.in`, source });

      const [, primaryUrl] = sendSpy.mock.calls[0]!;
      expect(primaryUrl).not.toMatch(/^hisaabo:\/\//);
      expect(primaryUrl).toMatch(/^https?:\/\//);
    }
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
    const caller = unauthCaller();
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

    await caller.auth.register({
      email,
      name: "Existing User",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

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
    const result = await callerA.auth.revokeSession({ sessionId: sessionB.id });
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
      caller.auth.revokeSession({ sessionId: session.id }),
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
      caller1.auth.revokeSession({ sessionId: session2.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  });
});
