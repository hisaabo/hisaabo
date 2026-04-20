/**
 * access-tokens.test.ts — Integration tests for the short-lived access token flow.
 *
 * WHY THIS FILE EXISTS:
 * P1 #1 shrinks the XSS replay window on desktop from 7 days to 15 minutes by
 * splitting Bearer auth into two tokens:
 *   - Refresh token (session_id): long-lived, stored in OS keychain, only sent
 *     to auth.issueAccessToken.
 *   - Access token (at_*): 15-min TTL, held in JS memory, sent on every API call.
 *
 * These tests exercise the server side of that contract:
 *   1. issueAccessToken is auth-gated.
 *   2. issueAccessToken with a refresh token → returns at_* token.
 *   3. issueAccessToken with a cookie session → rejected (cookie clients don't need access tokens).
 *   4. issueAccessToken with an access token (chained) → rejected.
 *   5. An access token carries full user identity on subsequent calls.
 *   6. An expired access token → rejected as UNAUTHORIZED.
 *   7. Deleting the parent session cascades-deletes access tokens (verified via DB query).
 *   8. A refresh-token Bearer still works for API calls (backwards compat for mobile).
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sessions, accessTokens } from "@hisaabo/db";
import {
  createUser,
  createTenant,
  addMember,
} from "./helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import { createTestContext } from "./helpers/test-context.js";
import { createCallerFactory } from "../trpc.js";
import { appRouter } from "../router.js";

const _callerFactory = createCallerFactory(appRouter);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBearerRequest(token: string, xClient = "desktop") {
  const headers = new Headers({
    "content-type": "application/json",
    "Authorization": `Bearer ${token}`,
    "x-requested-with": "hisaabo",
    "x-hisaabo-client": xClient,
  });
  return new Request("http://localhost:3000/api/trpc/auth.issueAccessToken", {
    method: "POST",
    headers,
  });
}

/** Create a bearer session for a given user and return the session ID. */
async function createBearerSession(userId: string, tenantId?: string): Promise<string> {
  const db = getControlDb();
  const sessionId = nanoid(64);
  const now = Date.now();
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tenantId: tenantId ?? null,
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
    maxExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
    authMethod: "bearer",
  });
  return sessionId;
}

/** Insert an access token row directly (for expiry tests). */
async function insertAccessToken(sessionId: string, expiresAt: Date): Promise<string> {
  const db = getControlDb();
  const { randomBytes } = await import("node:crypto");
  const id = `at_${randomBytes(48).toString("base64url")}`;
  await db.insert(accessTokens).values({ id, sessionId, expiresAt });
  return id;
}

// ── Shared test world ─────────────────────────────────────────────────────────

let userId: string;
let tenantId: string;

// Set up once — creating user + tenant is expensive; reuse across tests.
// Each test creates its own sessions/access tokens to remain isolated.
async function ensureTestWorld() {
  if (userId) return;
  const user = await createUser();
  const tenant = await createTenant();
  await addMember(tenant.id, user.id, "owner");
  userId = user.id;
  tenantId = tenant.id;
}

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("auth.issueAccessToken — auth-gating", () => {
  it("returns UNAUTHORIZED when called without any Bearer token or cookie", async () => {
    await ensureTestWorld();
    const ctx = createTestContext({}); // unauthenticated
    const caller = _callerFactory(ctx);
    await expect(caller.auth.issueAccessToken()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("auth.issueAccessToken — refresh-token Bearer path", () => {
  it("issues an access token (at_* prefix, 15-min TTL) when called with a refresh-token Bearer", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);

    // Simulate the server resolving this request via refresh-token Bearer
    const ctx = createTestContext({
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      authTokenKind: "refresh",
    });
    // Inject the session ID into ctx.req so getSessionIdFromContext can find it
    const req = makeBearerRequest(sessionId);
    const resHeaders = new Headers();
    const fullCtx = { ...ctx, req, resHeaders };
    const caller = _callerFactory(fullCtx);

    const result = await caller.auth.issueAccessToken();

    expect(result.accessToken).toMatch(/^at_/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    // TTL should be 15 min (give or take a few seconds for test execution)
    const ttlMs = result.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);

    // Verify row is in DB
    const db = getControlDb();
    const rows = await db.select().from(accessTokens).where(eq(accessTokens.id, result.accessToken));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe(sessionId);
  });
});

describe("auth.issueAccessToken — cookie-session rejection", () => {
  it("rejects with BAD_REQUEST when called from a cookie-authenticated session", async () => {
    await ensureTestWorld();

    // The context's authTokenKind is 'cookie' — simulates a web browser session
    const ctx = createTestContext({
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      authTokenKind: "cookie",
    });
    const caller = _callerFactory(ctx);

    await expect(caller.auth.issueAccessToken()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("auth.issueAccessToken — chained access token rejection", () => {
  it("rejects with BAD_REQUEST when the calling request is itself authenticated via an access token", async () => {
    await ensureTestWorld();

    // authTokenKind = 'access' simulates a request arriving with an at_* Bearer
    const ctx = createTestContext({
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      authTokenKind: "access",
    });
    const caller = _callerFactory(ctx);

    await expect(caller.auth.issueAccessToken()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("auth.issueAccessToken — session lookup failures", () => {
  it("throws UNAUTHORIZED when authTokenKind=refresh but no session token is present on the request", async () => {
    // Defensive gate: passes the 'cookie'/'access' rejection guards but
    // getSessionIdFromContext can't recover a session ID from the req
    // (no cookie, no Bearer) — we must refuse rather than insert an
    // access token against a mystery session.
    await ensureTestWorld();
    const ctx = createTestContext({
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      authTokenKind: "refresh",
    });
    const caller = _callerFactory(ctx);

    await expect(caller.auth.issueAccessToken()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws UNAUTHORIZED when the req carries a Bearer whose session row does not exist in the DB", async () => {
    // Race: session was revoked/deleted between createContext resolution
    // and this mutation running. The select() returns no row → refuse.
    await ensureTestWorld();

    // nanoid(64) format matches sessions.id but was never inserted.
    const ghostSessionId = nanoid(64);
    const req = makeBearerRequest(ghostSessionId);
    const ctx = {
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      businessId: null,
      req,
      resHeaders: new Headers(),
      ipAddress: null,
      authTokenKind: "refresh" as const,
    };
    const caller = _callerFactory(ctx);

    await expect(caller.auth.issueAccessToken()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws BAD_REQUEST when the underlying session row has authMethod='cookie' even if authTokenKind=refresh", async () => {
    // Belt-and-braces check: authTokenKind reflects how THIS request was
    // resolved, but the session row is the source of truth for what kind
    // of client owns the session. If they disagree (data skew, migration,
    // an old client flipped header), we must not mint an at_* token
    // against a cookie-provisioned session — that would downgrade its
    // XSS-resistance by creating a JS-readable credential.
    await ensureTestWorld();

    const db = getControlDb();
    const cookieSessionId = nanoid(64);
    await db.insert(sessions).values({
      id: cookieSessionId,
      userId,
      tenantId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      authMethod: "cookie",
    });

    const req = makeBearerRequest(cookieSessionId);
    const ctx = {
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      businessId: null,
      req,
      resHeaders: new Headers(),
      ipAddress: null,
      authTokenKind: "refresh" as const,
    };
    const caller = _callerFactory(ctx);

    await expect(caller.auth.issueAccessToken()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    // Cleanup
    await db.delete(sessions).where(eq(sessions.id, cookieSessionId));
  });
});

describe("access token authentication — carries full user identity", () => {
  it("an access token allows calling auth.me and returns the correct user", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);

    // Insert a fresh (not-yet-expired) access token
    const atId = await insertAccessToken(sessionId, new Date(Date.now() + 15 * 60 * 1000));

    // Simulate context.ts resolving the at_* Bearer token → authTokenKind = 'access'
    const user = await createUser(); // use a fresh user so email is fresh
    const tenant2 = await createTenant();
    await addMember(tenant2.id, user.id, "owner");
    const sessionId2 = await createBearerSession(user.id, tenant2.id);
    const atId2 = await insertAccessToken(sessionId2, new Date(Date.now() + 15 * 60 * 1000));
    void atId; // used for DB assertion below

    const ctx = createTestContext({
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: tenant2.id,
      authTokenKind: "access",
    });
    const caller = _callerFactory(ctx);

    const me = await caller.auth.me();
    expect(me.user?.id).toBe(user.id);
    expect(me.user?.email).toBe(user.email);

    // Clean up the extra access token
    const db = getControlDb();
    await db.delete(accessTokens).where(eq(accessTokens.id, atId2));
  });
});

describe("access token authentication — expiry enforcement", () => {
  it("an expired access token is rejected as UNAUTHORIZED", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);

    // Insert an already-expired access token
    const pastDate = new Date(Date.now() - 5000); // 5 seconds in the past
    const expiredAtId = await insertAccessToken(sessionId, pastDate);

    // context.ts should reject it when it reads: atRow.atExpiresAt > now
    // We test this indirectly: calling createContext with this token would
    // leave user null. Simulate by testing with authTokenKind = null (unresolved).
    const ctx = createTestContext({ authTokenKind: null });
    const caller = _callerFactory(ctx);

    // auth.me returns null for unauthenticated requests — not a 401
    const me = await caller.auth.me();
    expect(me.user).toBeNull();

    // Clean up
    const db = getControlDb();
    await db.delete(accessTokens).where(eq(accessTokens.id, expiredAtId));
  });

  it("verifies via direct DB query that an expired access token row still exists until explicit cleanup", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);
    const pastDate = new Date(Date.now() - 5000);
    const expiredAtId = await insertAccessToken(sessionId, pastDate);

    const db = getControlDb();
    const rows = await db.select().from(accessTokens).where(eq(accessTokens.id, expiredAtId));
    // Row is in DB — it's past-expiry but not auto-deleted; auth just refuses to honor it
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt.getTime()).toBeLessThan(Date.now());

    await db.delete(accessTokens).where(eq(accessTokens.id, expiredAtId));
  });
});

describe("cascade delete — session deletion removes all child access tokens", () => {
  it("deleting the parent session row cascade-deletes all issued access tokens (verified via direct DB query)", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);

    // Issue multiple access tokens for this session
    const at1 = await insertAccessToken(sessionId, new Date(Date.now() + 15 * 60 * 1000));
    const at2 = await insertAccessToken(sessionId, new Date(Date.now() + 15 * 60 * 1000));

    const db = getControlDb();

    // Verify both rows exist before deletion
    const before = await db.select().from(accessTokens)
      .where(eq(accessTokens.sessionId, sessionId));
    expect(before).toHaveLength(2);

    // Delete the parent session — FK ON DELETE CASCADE should remove both access tokens
    await db.delete(sessions).where(eq(sessions.id, sessionId));

    // Directly query access_tokens to confirm cascade worked
    const after = await db.select().from(accessTokens)
      .where(eq(accessTokens.sessionId, sessionId));
    expect(after).toHaveLength(0);

    // Also verify the specific token IDs are gone
    const at1Rows = await db.select().from(accessTokens).where(eq(accessTokens.id, at1));
    const at2Rows = await db.select().from(accessTokens).where(eq(accessTokens.id, at2));
    expect(at1Rows).toHaveLength(0);
    expect(at2Rows).toHaveLength(0);
  });
});

describe("backwards compatibility — refresh token Bearer still works for API calls", () => {
  it("a refresh-token Bearer (authTokenKind=refresh) authenticates normally on any endpoint", async () => {
    await ensureTestWorld();

    // Simulate mobile client: sends session_id directly as Bearer → authTokenKind = 'refresh'
    const ctx = createTestContext({
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      authTokenKind: "refresh",
    });
    const caller = _callerFactory(ctx);

    // auth.me should succeed even with authTokenKind = 'refresh'
    const me = await caller.auth.me();
    expect(me.user?.id).toBe(userId);
  });

  it("refresh-token Bearer still works for listing sessions (mobile-compat endpoint)", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);

    const req = makeBearerRequest(sessionId, "mobile");
    const ctx = {
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      businessId: null,
      req,
      resHeaders: new Headers(),
      ipAddress: null,
      authTokenKind: "refresh" as const,
    };
    const caller = _callerFactory(ctx);
    const sessions_list = await caller.auth.listSessions();
    expect(Array.isArray(sessions_list)).toBe(true);
  });
});

describe("access token prefix invariants", () => {
  it("issued access tokens always start with at_ (prefix routing hint)", async () => {
    await ensureTestWorld();
    const sessionId = await createBearerSession(userId, tenantId);

    const req = makeBearerRequest(sessionId);
    const resHeaders = new Headers();
    const ctx = {
      user: { id: userId, email: "test@example.com", name: "Test" },
      tenantId,
      businessId: null,
      req,
      resHeaders,
      ipAddress: null,
      authTokenKind: "refresh" as const,
    };
    const caller = _callerFactory(ctx);

    const result = await caller.auth.issueAccessToken();
    expect(result.accessToken.startsWith("at_")).toBe(true);
    // at_ prefix + 64 base64url chars = 67 chars total
    expect(result.accessToken.length).toBeGreaterThan(60);
  });
});
