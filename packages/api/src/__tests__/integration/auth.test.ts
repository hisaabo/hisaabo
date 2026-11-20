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

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi, type MockInstance } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { users, sessions, tenants, tenantMembers, magicLinkTokens, invitations, apiKeys, nativeAuthRequests } from "@hisaabo/db";
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
import { appRouter } from "../../router.js";
import { emailService } from "../../lib/email.js";
import { buildInfo } from "../../lib/build-info.js";
import { createLoginLink, type LoginLinkStore } from "../../lib/admin/login-link.js";
import { createContext } from "../../context.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// auth.register
// ─────────────────────────────────────────────────────────────────────────────

// Session ids are never exposed by the API; clients refer to a session by sha256(id).
const hashSessionId = (id: string) => createHash("sha256").update(id).digest("hex");

describe("auth.register", () => {
  const db = getControlDb();

  it("registers a new user with email and password — creates user, session, and default tenant membership", async () => {
    const caller = unauthCaller("mobile");

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
    expect(result.sessionToken!.length).toBeGreaterThan(30);

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
    // Bearer clients (mobile here) get the 7-day sliding window
    expect(msUntilExpiry).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
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
    const caller = unauthCaller("desktop");
    const result = await caller.auth.login({
      email: "login.test@vyapar.in",
      password: "Test@1234!",
    });

    expect(result.user.email).toBe("login.test@vyapar.in");
    expect(result.user.id).toBe(loginUserId);
    expect(typeof result.sessionToken).toBe("string");
    expect(result.sessionToken!.length).toBeGreaterThan(30);

    // A new session row should now exist
    const db = getControlDb();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.sessionToken!))
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
    // Build identity is disclosed to signed-in users only.
    expect(result.server).toEqual({ version: buildInfo.version, commit: buildInfo.commit });
  });

  it("returns null user and null tenant for an unauthenticated request — no session present", async () => {
    const caller = unauthCaller();
    const result = await caller.auth.me();

    expect(result.user).toBeNull();
    expect(result.tenantId).toBeNull();
    expect(result.tenantName).toBeNull();
    expect(result.role).toBeNull();
    expect(result.needsProfile).toBe(false);
    expect(result.server).toBeUndefined(); // no build fingerprint for anonymous callers
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

describe("auth.sendMagicLink — Turnstile enforcement and the DEPRECATED v0.9.x exemption", () => {
  const db = getControlDb();
  let sendSpy: MockInstance<typeof emailService.sendMagicLink>;
  const SAVED_COMPAT = process.env.LEGACY_V09_CLIENT_COMPAT;

  // Header shapes. v0.9.0 mobile: X-Requested-With only (no Origin / Sec-Fetch-*).
  // v0.9.0 desktop (Tauri webview): X-Hisaabo-Client: desktop + a Tauri Origin.
  const legacyMobile = { "x-requested-with": "hisaabo" };
  const tauriDesktop = { "x-hisaabo-client": "desktop", origin: "http://tauri.localhost", "x-requested-with": "hisaabo" };

  const callerWith = (headers: Record<string, string>) => _callerFactory(createTestContext({ headers }));
  const send = (headers: Record<string, string>, email: string, source: "web" | "desktop" | "mobile" = "web") =>
    callerWith(headers).auth.sendMagicLink({ email, source });

  beforeAll(() => {
    sendSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);
  });

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    delete process.env.LEGACY_V09_CLIENT_COMPAT;
    sendSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    if (SAVED_COMPAT === undefined) delete process.env.LEGACY_V09_CLIENT_COMPAT;
    else process.env.LEGACY_V09_CLIENT_COMPAT = SAVED_COMPAT;
  });

  afterAll(() => {
    sendSpy.mockRestore();
  });

  const rejected = { code: "BAD_REQUEST", message: "Turnstile verification required" };

  it("legacy mobile shape + existing user: mail is sent and the link ends &source=mobile", async () => {
    await createUser({ email: "legacy-exempt-existing@vyapar.in", name: "Existing" });
    await expect(send(legacyMobile, "legacy-exempt-existing@vyapar.in", "mobile")).resolves.toEqual({ success: true });
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]![1]).toMatch(/\/auth\/verify\?token=[^&]+&source=mobile$/);
  });

  it("legacy mobile shape + unknown email: success, but no mail and no token row", async () => {
    await expect(send(legacyMobile, "legacy-exempt-unknown@vyapar.in", "mobile")).resolves.toEqual({ success: true });
    expect(sendSpy).not.toHaveBeenCalled();
    const rows = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, "legacy-exempt-unknown@vyapar.in"));
    expect(rows).toHaveLength(0);
  });

  it("legacy mobile shape + invited email: mail is sent", async () => {
    const email = "legacy-exempt-invited@vyapar.in";
    const [tenant] = await db.insert(tenants).values({ name: "Legacy Invite Org", slug: "legacy-invite-" + nanoid(6) }).returning({ id: tenants.id });
    const inviter = await createUser({ email: "legacy-inviter@vyapar.in", name: "Inviter" });
    await addMember(tenant!.id, inviter.id, "owner");
    await db.insert(invitations).values({
      tenantId: tenant!.id,
      email,
      role: "member",
      token: "invite-" + nanoid(32),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      invitedBy: inviter.id,
    });

    await expect(send(legacyMobile, email, "mobile")).resolves.toEqual({ success: true });
    expect(sendSpy).toHaveBeenCalledOnce();
  });

  it("legacy shape: the 11th link for one address within 24h is silently not sent", async () => {
    const email = "legacy-exempt-daily@vyapar.in";
    await createUser({ email, name: "Daily" });
    // Seed 10 recent tokens spread over the day so the 5-per-15-minutes limit is not what stops it.
    for (let i = 0; i < 10; i++) {
      await db.insert(magicLinkTokens).values({
        email,
        tokenHash: createHash("sha256").update(`daily-${i}-${nanoid(8)}`).digest("hex"),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        createdAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000),
      });
    }
    await expect(send(legacyMobile, email, "mobile")).resolves.toEqual({ success: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("Tauri desktop shape + existing user: mail is sent and the link ends &source=desktop", async () => {
    await createUser({ email: "legacy-tauri@vyapar.in", name: "Tauri" });
    // The v0.9.0 desktop webview does not always send `source`; it is inferred from the Tauri shape.
    await expect(send(tauriDesktop, "legacy-tauri@vyapar.in", "web")).resolves.toEqual({ success: true });
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]![1]).toMatch(/\/auth\/verify\?token=[^&]+&source=desktop$/);
  });

  it("X-Hisaabo-Client: mobile | cli alone is rejected", async () => {
    for (const client of ["mobile", "cli"]) {
      await expect(send({ "x-hisaabo-client": client }, "turnstile-required@vyapar.in")).rejects.toMatchObject(rejected);
    }
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("X-Hisaabo-Client: desktop without a Tauri Origin is rejected (also with a web Origin)", async () => {
    await expect(send({ "x-hisaabo-client": "desktop" }, "turnstile-required@vyapar.in")).rejects.toMatchObject(rejected);
    await expect(
      send({ "x-hisaabo-client": "desktop", origin: "https://app.example.com" }, "turnstile-required@vyapar.in"),
    ).rejects.toMatchObject(rejected);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("legacy headers plus an Origin (a browser) are rejected; so is a plain request", async () => {
    await expect(
      send({ ...legacyMobile, origin: "https://app.example.com" }, "turnstile-required@vyapar.in"),
    ).rejects.toMatchObject(rejected);
    await expect(send({}, "turnstile-required@vyapar.in")).rejects.toMatchObject(rejected);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("LEGACY_V09_CLIENT_COMPAT=false rejects every legacy shape and adds no source suffix", async () => {
    process.env.LEGACY_V09_CLIENT_COMPAT = "false";
    await createUser({ email: "legacy-killswitch@vyapar.in", name: "Kill" });
    await expect(send(legacyMobile, "legacy-killswitch@vyapar.in", "mobile")).rejects.toMatchObject(rejected);
    await expect(send(tauriDesktop, "legacy-killswitch@vyapar.in", "desktop")).rejects.toMatchObject(rejected);
    expect(sendSpy).not.toHaveBeenCalled();

    // Without a secret (no Turnstile needed) the handoff suffix is still off.
    delete process.env.TURNSTILE_SECRET_KEY;
    await send(legacyMobile, "legacy-killswitch@vyapar.in", "mobile");
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]![1]).not.toContain("source=");
  });

  it("without TURNSTILE_SECRET_KEY nothing is gated and legacy callers get the normal behaviour", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    await createUser({ email: "legacy-nosecret@vyapar.in", name: "No Secret" });
    await send(legacyMobile, "legacy-nosecret@vyapar.in", "mobile");
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]![1]).toMatch(/&source=mobile$/);
  });

  it("register without a Turnstile token is always rejected, for every legacy shape", async () => {
    const input = {
      email: "turnstile-register@vyapar.in",
      name: "No Token",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    };
    const shapes: Array<Record<string, string>> = [{}, legacyMobile, { "x-hisaabo-client": "desktop" }, { "x-hisaabo-client": "mobile" }];
    for (const headers of shapes) {
      await expect(callerWith(headers).auth.register(input)).rejects.toMatchObject(rejected);
    }
    // The Tauri webview gets an actionable message instead.
    await expect(callerWith(tauriDesktop).auth.register(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Update the Hisaabo desktop app to create an account, or sign up in your browser.",
    });
    const rows = await db.select().from(users).where(eq(users.email, input.email));
    expect(rows).toHaveLength(0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Break-glass: `admin login-link <email>` issues a token the normal
// verifyMagicLink consumes (single use, expiring, existing users only).
// ─────────────────────────────────────────────────────────────────────────────

describe("admin login-link tokens redeem through auth.verifyMagicLink", () => {
  const db = getControlDb();

  const store: LoginLinkStore = {
    async findUserByEmail(email) {
      const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
      return row ?? null;
    },
    async insertToken(row) {
      await db.insert(magicLinkTokens).values(row);
    },
  };
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

  it("signs the user in once, then rejects reuse", async () => {
    const user = await createUser({ email: "breakglass@example.in", name: "Break Glass" });
    const link = await createLoginLink(store, { email: user.email, ttlMinutes: 15, baseUrl: "https://app.example.in" });

    const first = await unauthCaller().auth.verifyMagicLink({ token: tokenOf(link.url) });
    expect(first.user.id).toBe(user.id);
    expect(first.isNewUser).toBe(false);

    await expect(unauthCaller().auth.verifyMagicLink({ token: tokenOf(link.url) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an expired link and marks the row as operator-issued", async () => {
    const user = await createUser({ email: "breakglass-expired@example.in", name: "Expired" });
    const link = await createLoginLink(store, {
      email: user.email,
      ttlMinutes: 1,
      baseUrl: "https://app.example.in",
      now: new Date(Date.now() - 10 * 60 * 1000),
    });

    const [row] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, user.email)).limit(1);
    expect(row.ipAddress).toBe("admin-cli");
    await expect(unauthCaller().auth.verifyMagicLink({ token: tokenOf(link.url) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not create accounts for unknown emails", async () => {
    await expect(
      createLoginLink(store, { email: "nobody-here@example.in", ttlMinutes: 15, baseUrl: "https://app.example.in" }),
    ).rejects.toThrow(/no user/);
    const rows = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, "nobody-here@example.in"));
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email change: the confirmation only takes effect for the REQUESTING account,
// while it is signed in. A token that reaches anyone else (the mailbox owner
// tricked into clicking) must not move the address, and must not be burnable.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.requestEmailChange / auth.confirmEmailChange", () => {
  const db = getControlDb();
  let confirmSpy: MockInstance<typeof emailService.sendEmailChangeConfirmation>;
  let magicSpy: MockInstance<typeof emailService.sendMagicLink>;
  let noticeSpy: MockInstance<typeof emailService.sendEmailChangedNotice>;

  beforeAll(() => {
    confirmSpy = vi.spyOn(emailService, "sendEmailChangeConfirmation").mockResolvedValue(undefined);
    magicSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);
    noticeSpy = vi.spyOn(emailService, "sendEmailChangedNotice").mockResolvedValue(undefined);
  });
  beforeEach(() => {
    confirmSpy.mockClear();
    magicSpy.mockClear();
    noticeSpy.mockClear();
  });
  afterAll(() => {
    confirmSpy.mockRestore();
    magicSpy.mockRestore();
    noticeSpy.mockRestore();
  });

  async function signedInUser(verified = true) {
    const email = `chg.${nanoid(8).toLowerCase()}@example.in`;
    const user = await createUser({ email, name: "Changer", emailVerified: verified });
    const session = await createSession(user.id);
    return { user, email, caller: callerWithSession(session.id, user.id, email) };
  }

  const tokenFromLastMail = () => {
    const url = confirmSpy.mock.calls.at(-1)![1];
    return new URL(url).searchParams.get("token")!;
  };
  const newAddress = () => `new.${nanoid(8).toLowerCase()}@example.in`;
  const rowFor = (token: string) =>
    db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, createHash("sha256").update(token).digest("hex"))).then((r) => r[0]);

  it("request sends the dedicated confirmation mail (not a magic link) to the NEW address with a /auth/confirm-email-change URL", async () => {
    const { email, caller } = await signedInUser();
    const to = newAddress();
    await expect(caller.auth.requestEmailChange({ newEmail: to })).resolves.toEqual({ success: true });

    expect(magicSpy).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledOnce();
    const [recipient, url, current] = confirmSpy.mock.calls[0]!;
    expect(recipient).toBe(to);
    expect(current).toBe(email);
    expect(url).toMatch(/\/auth\/confirm-email-change\?token=[^&]+$/);
    expect(url).not.toContain("/auth/verify");
  });

  it("the requester confirms while signed in: email changes and is verified; replay is rejected; the old address is told", async () => {
    const { user, email, caller } = await signedInUser(true);
    const to = newAddress();
    await caller.auth.requestEmailChange({ newEmail: to });
    const token = tokenFromLastMail();

    await expect(caller.auth.confirmEmailChange({ token })).resolves.toEqual({ success: true, newEmail: to });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.email).toBe(to);
    expect(row!.emailVerified).toBe(true);
    expect((await rowFor(token))!.usedAt).not.toBeNull();

    await expect(caller.auth.confirmEmailChange({ token })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Fire-and-forget notice to the previous (verified) address.
    await vi.waitFor(() => expect(noticeSpy).toHaveBeenCalledWith(email, to));
  });

  it("no notice is sent when the old address was never verified", async () => {
    const { caller } = await signedInUser(false);
    await caller.auth.requestEmailChange({ newEmail: newAddress() });
    await caller.auth.confirmEmailChange({ token: tokenFromLastMail() });
    await new Promise((r) => setTimeout(r, 100));
    expect(noticeSpy).not.toHaveBeenCalled();
  });

  it("an unauthenticated confirm is UNAUTHORIZED and leaves the email and the token untouched", async () => {
    const { user, caller } = await signedInUser();
    await caller.auth.requestEmailChange({ newEmail: newAddress() });
    const token = tokenFromLastMail();

    await expect(unauthCaller().auth.confirmEmailChange({ token })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.email).toBe(user.email);
    expect((await rowFor(token))!.usedAt).toBeNull();
  });

  it("a DIFFERENT signed-in user (the mailbox owner who was tricked into clicking) gets FORBIDDEN; nothing changes and the token is not consumed", async () => {
    const attacker = await signedInUser();
    const victim = await signedInUser();
    const victimAddress = newAddress();
    await attacker.caller.auth.requestEmailChange({ newEmail: victimAddress });
    const token = tokenFromLastMail();

    await expect(victim.caller.auth.confirmEmailChange({ token })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("different Hisaabo account"),
    });
    const [a] = await db.select().from(users).where(eq(users.id, attacker.user.id));
    const [v] = await db.select().from(users).where(eq(users.id, victim.user.id));
    expect(a!.email).toBe(attacker.email);
    expect(v!.email).toBe(victim.email);
    expect((await rowFor(token))!.usedAt).toBeNull();

    // The legitimate requester can still use it.
    await expect(attacker.caller.auth.confirmEmailChange({ token })).resolves.toMatchObject({ newEmail: victimAddress });
  });

  it("an address registered in the meantime is a CONFLICT (not a 500) and the token is not burned", async () => {
    const { user, caller } = await signedInUser();
    const to = newAddress();
    await caller.auth.requestEmailChange({ newEmail: to });
    const token = tokenFromLastMail();
    await createUser({ email: to, name: "Took It" });

    await expect(caller.auth.confirmEmailChange({ token })).rejects.toMatchObject({ code: "CONFLICT", message: "Email already in use" });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.email).toBe(user.email);
    expect((await rowFor(token))!.usedAt).toBeNull();
  });

  it("a plain magic-link token is BAD_REQUEST and is not consumed", async () => {
    const { caller } = await signedInUser();
    const raw = "plain-" + nanoid(32);
    await db.insert(magicLinkTokens).values({
      email: "someone-else@example.in",
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await expect(caller.auth.confirmEmailChange({ token: raw })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await rowFor(raw))!.usedAt).toBeNull();
  });

  it("an operator login-link token (the account's own email) is BAD_REQUEST", async () => {
    const { user, email, caller } = await signedInUser();
    const store: LoginLinkStore = {
      async findUserByEmail(e) {
        const [r] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, e)).limit(1);
        return r ?? null;
      },
      async insertToken(row) {
        await db.insert(magicLinkTokens).values(row);
      },
    };
    const link = await createLoginLink(store, { email, ttlMinutes: 15, baseUrl: "https://app.example.in" });
    const raw = new URL(link.url).searchParams.get("token")!;
    await expect(caller.auth.confirmEmailChange({ token: raw })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await rowFor(raw))!.usedAt).toBeNull();
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.email).toBe(email);
  });

  it("a second request supersedes the first, and the 4th request within an hour is TOO_MANY_REQUESTS", async () => {
    const { caller } = await signedInUser();
    await caller.auth.requestEmailChange({ newEmail: newAddress() });
    const first = tokenFromLastMail();
    await caller.auth.requestEmailChange({ newEmail: newAddress() });
    const second = tokenFromLastMail();

    await expect(caller.auth.confirmEmailChange({ token: first })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.auth.requestEmailChange({ newEmail: newAddress() });
    confirmSpy.mockClear();
    await expect(caller.auth.requestEmailChange({ newEmail: newAddress() })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(second).not.toBe(first);
  });

  it("confirming deletes the account's other unused user-bound tokens", async () => {
    const { user, caller } = await signedInUser();
    await caller.auth.requestEmailChange({ newEmail: newAddress() });
    const token = tokenFromLastMail();
    // An unused operator link for the old address must not outlive the change.
    await db.insert(magicLinkTokens).values({
      email: user.email,
      tokenHash: createHash("sha256").update("op-" + nanoid(16)).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await caller.auth.confirmEmailChange({ token });
    const unused = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.userId, user.id));
    expect(unused.filter((r) => r.usedAt === null)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pre-registration account takeover: the first magic-link verification of an
// account whose email was never verified must kill every credential issued
// before that proof (sessions, API keys, password, pending credential minters).
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.verifyMagicLink — first verification of an unverified account", () => {
  const db = getControlDb();
  const PASSWORD = "Attacker@1234!";

  /** What the real request pipeline resolves for a Bearer token (hits the auth caches). */
  async function resolveBearer(token: string) {
    const req = new Request("http://localhost:3000/api/trpc/auth.me", {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, "x-requested-with": "hisaabo" },
    });
    return createContext({ req, resHeaders: new Headers(), info: {} as never });
  }

  async function seedMagicToken(email: string): Promise<string> {
    const rawToken = "claim-" + nanoid(32);
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    return rawToken;
  }

  async function seedApiKey(userId: string, tenantId: string): Promise<string> {
    const raw = "hisaabo_key_" + nanoid(40);
    await db.insert(apiKeys).values({
      userId,
      tenantId,
      keyHash: createHash("sha256").update(raw).digest("hex"),
      keyPrefix: raw.slice(0, 20),
      name: "attacker key",
    });
    return raw;
  }

  async function register(email: string) {
    // Bearer client: the registrant receives the raw session token.
    const res = await unauthCaller("mobile").auth.register({
      email,
      name: "Pre Registered",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    const [member] = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, res.user.id)).limit(1);
    return { userId: res.user.id, sessionToken: res.sessionToken!, tenantId: member!.tenantId };
  }

  it("kills the attacker's sessions, API keys and password; the victim's new session works", async () => {
    const email = "victim-claim@vyapar.in";
    const atk = await register(email);
    const apiKey = await seedApiKey(atk.userId, atk.tenantId);
    // A second attacker session, and the two credential minters an attacker could leave behind.
    const atk2 = await createSession(atk.userId, atk.tenantId);
    await db.insert(magicLinkTokens).values({
      email: "attacker@evil.example",
      tokenHash: createHash("sha256").update("pending-email-change-" + nanoid(12)).digest("hex"),
      userId: atk.userId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await db.insert(nativeAuthRequests).values({
      client: "cli",
      redirectUri: "http://127.0.0.1:41234/callback",
      codeChallenge: "x".repeat(43),
      state: "s".repeat(16),
      userId: atk.userId,
      codeHash: "h".repeat(64),
      authorizedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    // Everything works for the attacker before the victim signs in (and primes the auth caches).
    expect((await resolveBearer(atk.sessionToken)).user?.id).toBe(atk.userId);
    expect((await resolveBearer(atk2.id)).user?.id).toBe(atk.userId);
    expect((await resolveBearer(apiKey)).user?.id).toBe(atk.userId);
    await expect(unauthCaller().auth.login({ email, password: PASSWORD })).resolves.toMatchObject({ user: { id: atk.userId } });

    // The victim signs in by magic link for the first time.
    const victim = await unauthCaller("mobile").auth.verifyMagicLink({ token: await seedMagicToken(email) });
    expect(victim.user.id).toBe(atk.userId); // same account row, now proven by the mailbox owner
    expect(typeof victim.sessionToken).toBe("string");

    // Attacker: session(s), API key and password are all dead; so are the credential minters.
    expect((await resolveBearer(atk.sessionToken)).user).toBeNull();
    expect((await resolveBearer(atk2.id)).user).toBeNull();
    expect((await resolveBearer(apiKey)).user).toBeNull();
    await expect(unauthCaller().auth.login({ email, password: PASSWORD })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, atk.userId))).toHaveLength(0);
    expect(await db.select().from(nativeAuthRequests).where(eq(nativeAuthRequests.userId, atk.userId))).toHaveLength(0);
    expect(await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.userId, atk.userId))).toHaveLength(0);

    const [row] = await db.select().from(users).where(eq(users.id, atk.userId)).limit(1);
    expect(row!.passwordHash).toBeNull();
    expect(row!.emailVerified).toBe(true);

    // Victim: the new session is the only one and it works.
    const sessionsLeft = await db.select().from(sessions).where(eq(sessions.userId, atk.userId));
    expect(sessionsLeft.map((x) => x.id)).toEqual([victim.sessionToken]);
    expect((await resolveBearer(victim.sessionToken!)).user?.id).toBe(atk.userId);
  });

  it("an already-verified user signing in by magic link keeps their password and other sessions", async () => {
    const email = "verified-claim@vyapar.in";
    const reg = await register(email);
    // First (legitimate) verification: from here on the account is verified.
    await unauthCaller("mobile").auth.verifyMagicLink({ token: await seedMagicToken(email) });
    // The user later sets up another login method: simulate a password + a second device + an API key.
    const passwordHash = (await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, reg.userId)))[0]!.h;
    expect(passwordHash).toBeNull(); // wiped by the first verification, so re-seed it:
    await unauthCaller().auth.register({ email: "second-" + email, name: "Other", password: PASSWORD, confirmPassword: PASSWORD });
    const other = (await db.select({ h: users.passwordHash }).from(users).where(eq(users.email, "second-" + email)))[0]!.h;
    await db.update(users).set({ passwordHash: other }).where(eq(users.id, reg.userId));
    const device2 = await createSession(reg.userId, reg.tenantId);
    const key = await seedApiKey(reg.userId, reg.tenantId);

    const again = await unauthCaller("mobile").auth.verifyMagicLink({ token: await seedMagicToken(email) });
    expect(again.user.id).toBe(reg.userId);

    // Password, the second device and the API key all survive a normal sign-in.
    await expect(unauthCaller().auth.login({ email, password: PASSWORD })).resolves.toMatchObject({ user: { id: reg.userId } });
    expect((await resolveBearer(device2.id)).user?.id).toBe(reg.userId);
    expect((await resolveBearer(key)).user?.id).toBe(reg.userId);
  });

  it("a v0.9.0 user who registered with a password and never verified can still log in with it", async () => {
    const email = "never-verified@vyapar.in";
    await register(email);
    const result = await unauthCaller().auth.login({ email, password: PASSWORD });
    expect(result.user.email).toBe(email);
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(row!.emailVerified).toBe(false);
    expect(row!.passwordHash).not.toBeNull();
  });

  it("an operator break-glass link signs in without verifying the email or wiping credentials", async () => {
    const email = "operator-link@vyapar.in";
    const reg = await register(email);
    const key = await seedApiKey(reg.userId, reg.tenantId);
    const store: LoginLinkStore = {
      async findUserByEmail(e) {
        const [r] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, e)).limit(1);
        return r ?? null;
      },
      async insertToken(row) {
        await db.insert(magicLinkTokens).values(row);
      },
    };
    const link = await createLoginLink(store, { email, ttlMinutes: 15, baseUrl: "https://app.example.in" });
    const token = new URL(link.url).searchParams.get("token")!;

    const res = await unauthCaller("mobile").auth.verifyMagicLink({ token });
    expect(res.user.id).toBe(reg.userId);

    const [row] = await db.select().from(users).where(eq(users.id, reg.userId)).limit(1);
    expect(row!.emailVerified).toBe(false); // the mailbox was not proven
    expect(row!.passwordHash).not.toBeNull();
    expect((await resolveBearer(reg.sessionToken)).user?.id).toBe(reg.userId);
    expect((await resolveBearer(key)).user?.id).toBe(reg.userId);
    // The next real magic link is still the first proof of the mailbox.
    await unauthCaller("mobile").auth.verifyMagicLink({ token: await seedMagicToken(email) });
    expect((await resolveBearer(reg.sessionToken)).user).toBeNull();
    expect((await resolveBearer(key)).user).toBeNull();
  });

  it("a user created by their first magic link is verified and a later sign-in revokes nothing", async () => {
    const email = "fresh-claim@vyapar.in";
    const first = await unauthCaller("mobile").auth.verifyMagicLink({ token: await seedMagicToken(email) });
    expect(first.isNewUser).toBe(true);
    const second = await unauthCaller("mobile").auth.verifyMagicLink({ token: await seedMagicToken(email) });
    expect((await resolveBearer(first.sessionToken!)).user?.id).toBe(first.user.id);
    expect((await resolveBearer(second.sessionToken!)).user?.id).toBe(first.user.id);
  });

  it("password login that was in flight when the wipe committed cannot mint a session", async () => {
    const email = "inflight-claim@vyapar.in";
    const reg = await register(email);

    // Simulate the wipe transaction: it holds the user row lock with password_hash already nulled.
    let releaseWipe!: () => void;
    const wipeHeld = new Promise<void>((resolve) => { releaseWipe = resolve; });
    let wipeLocked!: () => void;
    const locked = new Promise<void>((resolve) => { wipeLocked = resolve; });
    const wipe = db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, reg.userId)).for("update");
      await tx.update(users).set({ passwordHash: null, emailVerified: true }).where(eq(users.id, reg.userId));
      await tx.delete(sessions).where(eq(sessions.userId, reg.userId));
      wipeLocked();
      await wipeHeld;
    });
    await locked;

    // The login reads the OLD hash (the wipe is uncommitted), verifies it, then must wait on the row lock.
    const login = unauthCaller().auth.login({ email, password: PASSWORD });
    const settled = vi.fn();
    login.then(settled, settled);
    await new Promise((r) => setTimeout(r, 1500));
    expect(settled).not.toHaveBeenCalled(); // blocked on the lock

    releaseWipe();
    await wipe;
    await expect(login).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await db.select().from(sessions).where(eq(sessions.userId, reg.userId))).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATED v0.9.0 native-client compatibility (remove in 0.11.0)
//
// The v0.9.0 mobile app never sends X-Hisaabo-Client; it sends only
// `X-Requested-With: hisaabo` and reads `data.sessionToken`. Browsers always
// carry Origin / Sec-Fetch-* and must never receive the token in the body.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth sign-in — v0.9.0 legacy native client compat", () => {
  const db = getControlDb();

  function callerWithHeaders(headers: Record<string, string>) {
    return _callerFactory(createTestContext({ headers }));
  }

  async function seedMagicToken(email: string) {
    const rawToken = "legacy-compat-" + nanoid(24);
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    return rawToken;
  }

  it("verifyMagicLink returns sessionToken (bearer session) for the v0.9.0 mobile signature", async () => {
    const rawToken = await seedMagicToken("legacy-mobile@vyapar.in");
    const result = await callerWithHeaders({ "x-requested-with": "hisaabo" }).auth.verifyMagicLink({ token: rawToken });

    expect(typeof result.sessionToken).toBe("string");
    const [row] = await db.select().from(sessions).where(eq(sessions.id, result.sessionToken!)).limit(1);
    expect(row?.authMethod).toBe("bearer");
  });

  it("verifyMagicLink does NOT return sessionToken for a browser (Origin + Sec-Fetch-* present)", async () => {
    const rawToken = await seedMagicToken("legacy-browser@vyapar.in");
    const ctx = createTestContext({
      headers: {
        "x-requested-with": "hisaabo",
        origin: "https://app.example.com",
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "cors",
      },
    });
    const result = await _callerFactory(ctx).auth.verifyMagicLink({ token: rawToken });

    expect(result.sessionToken).toBeUndefined();
    // Cookie session: Set-Cookie is written instead.
    expect(ctx.resHeaders.get("set-cookie")).toContain("session_id=");
  });

  it("verifyMagicLink returns sessionToken for the current X-Hisaabo-Client header", async () => {
    const rawToken = await seedMagicToken("legacy-newhdr@vyapar.in");
    const result = await callerWithHeaders({ "x-hisaabo-client": "mobile" }).auth.verifyMagicLink({ token: rawToken });
    expect(typeof result.sessionToken).toBe("string");
  });

  it("password login returns sessionToken for the v0.9.0 mobile signature but not for a browser", async () => {
    await unauthCaller().auth.register({
      email: "legacy-login@vyapar.in",
      name: "Legacy Login",
      password: "Test@1234!",
      confirmPassword: "Test@1234!",
    });

    const legacy = await callerWithHeaders({ "x-requested-with": "hisaabo" }).auth.login({
      email: "legacy-login@vyapar.in",
      password: "Test@1234!",
    });
    expect(typeof legacy.sessionToken).toBe("string");

    const browser = await callerWithHeaders({
      "x-requested-with": "hisaabo",
      origin: "https://app.example.com",
    }).auth.login({ email: "legacy-login@vyapar.in", password: "Test@1234!" });
    expect(browser.sessionToken).toBeUndefined();
  });
});
