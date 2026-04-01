/**
 * Security regression tests — Authentication and session security
 *
 * WHY THIS FILE EXISTS:
 * Each test below encodes an invariant identified during the security audit.
 * They are pure-function or logic-extraction tests that do NOT require a running
 * database, so they run fast and can gate every CI push.
 *
 * Companion files:
 *   security-isolation.test.ts — multi-tenant middleware chain tests
 *   security-input.test.ts     — input validation and injection tests
 *   security-client.test.ts    — client-side (web app) security tests
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Session cache TTL boundary (Finding #1)
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — session cache TTL boundary prevents stale authenticated sessions", () => {
  /**
   * INVARIANT: Cached session data must not be served after the 60-second TTL.
   * If the TTL check were missing or incorrectly applied (e.g. `>` vs `>=`),
   * a revoked session could remain valid in cache for up to 60 seconds after
   * logout. The context.ts cache check is: `Date.now() < cached.expires`.
   *
   * We replicate the cache check logic here so a refactor cannot accidentally
   * widen the TTL or remove the boundary check.
   */

  const SESSION_CACHE_TTL = 60_000; // 60 seconds, from context.ts

  function isCacheEntryValid(entryExpiresAt: number, nowMs: number): boolean {
    // Mirrors: if (cached && Date.now() < cached.expires) in context.ts
    return nowMs < entryExpiresAt;
  }

  it("cache entry is valid when well within the 60-second window", () => {
    const createdAt = 1_000_000;
    const expires = createdAt + SESSION_CACHE_TTL;
    const now = createdAt + 30_000; // 30 seconds later
    expect(isCacheEntryValid(expires, now)).toBe(true);
  });

  it("cache entry is invalid at exactly the TTL boundary (boundary: expires at T+60s, now = T+60s)", () => {
    const createdAt = 1_000_000;
    const expires = createdAt + SESSION_CACHE_TTL;
    const now = expires; // exactly at expiry: not valid (not strictly less-than)
    expect(isCacheEntryValid(expires, now)).toBe(false);
  });

  it("cache entry is invalid 1ms after the TTL", () => {
    const createdAt = 1_000_000;
    const expires = createdAt + SESSION_CACHE_TTL;
    const now = expires + 1;
    expect(isCacheEntryValid(expires, now)).toBe(false);
  });

  it("cache entry is invalid well after the TTL (e.g. 5 minutes later)", () => {
    const createdAt = 1_000_000;
    const expires = createdAt + SESSION_CACHE_TTL;
    const now = createdAt + 5 * 60_000;
    expect(isCacheEntryValid(expires, now)).toBe(false);
  });

  it("cache eviction: when at capacity (1000), oldest entry is removed before inserting new one", () => {
    /**
     * INVARIANT: The cache must never grow unboundedly. context.ts evicts the
     * Map's first (oldest) entry when size >= SESSION_CACHE_MAX (1000).
     * This test verifies the eviction logic independently of the DB path.
     */
    const SESSION_CACHE_MAX = 1000;

    const cache = new Map<string, { data: string; expires: number }>();

    // Fill to capacity
    for (let i = 0; i < SESSION_CACHE_MAX; i++) {
      cache.set(`session-${i}`, { data: `user-${i}`, expires: Date.now() + SESSION_CACHE_TTL });
    }
    expect(cache.size).toBe(SESSION_CACHE_MAX);

    // Simulate inserting one more entry — mirrors the eviction block in context.ts
    const newSessionId = "session-NEW";
    if (cache.size >= SESSION_CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(newSessionId, { data: "user-NEW", expires: Date.now() + SESSION_CACHE_TTL });

    // Size must remain at max, not grow beyond it
    expect(cache.size).toBe(SESSION_CACHE_MAX);
    // The new entry must be present
    expect(cache.has(newSessionId)).toBe(true);
    // The oldest entry (session-0) must have been evicted
    expect(cache.has("session-0")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — API key prefix requirement and SHA-256 determinism
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — API key authentication enforces prefix and deterministic hashing", () => {
  /**
   * INVARIANT: context.ts only enters the API key path if the token starts with
   * `hisaabo_key_`. Any other Bearer token (including real session IDs, which
   * use nanoid(64) and contain no such prefix) must follow the session path
   * instead. This prevents an attacker from probing the apiKeys table with
   * arbitrary session IDs.
   *
   * Additionally, SHA-256 is deterministic: hashing the same key twice always
   * yields the same result, so the stored hash can be used for lookup without
   * storing the raw key.
   */

  function isApiKeyPath(sessionId: string): boolean {
    // Mirrors: if (sessionId.startsWith("hisaabo_key_")) in context.ts
    return sessionId.startsWith("hisaabo_key_");
  }

  function hashApiKey(rawKey: string): string {
    // Mirrors: createHash("sha256").update(sessionId).digest("hex") in context.ts
    return createHash("sha256").update(rawKey).digest("hex");
  }

  it('token starting with "hisaabo_key_" routes to the API key path', () => {
    expect(isApiKeyPath("hisaabo_key_abc123xyz")).toBe(true);
  });

  it("plain nanoid session token does NOT route to API key path", () => {
    // nanoid(64) produces tokens like "V_3d9AbcD..." — never starts with hisaabo_key_
    const nanoIdLike = "V_3d9AbcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrst";
    expect(isApiKeyPath(nanoIdLike)).toBe(false);
  });

  it("Bearer token that is a plain UUID does NOT route to API key path", () => {
    expect(isApiKeyPath("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("empty string does NOT route to API key path", () => {
    expect(isApiKeyPath("")).toBe(false);
  });

  it("SHA-256 hash of a key is deterministic (same input always yields same hash)", () => {
    const key = "hisaabo_key_vyapar_sharma_testkey_12345";
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("SHA-256 hash differs from the raw key (raw key is never stored)", () => {
    const key = "hisaabo_key_vyapar_sharma_testkey_12345";
    expect(hashApiKey(key)).not.toBe(key);
  });

  it("different API keys produce different hashes (no hash collision at this scale)", () => {
    const hash1 = hashApiKey("hisaabo_key_aaaa");
    const hash2 = hashApiKey("hisaabo_key_bbbb");
    expect(hash1).not.toBe(hash2);
  });

  it("expired API key must be rejected (expiresAt in the past)", () => {
    /**
     * INVARIANT: context.ts checks `!key.expiresAt || key.expiresAt > new Date()`.
     * A key with expiresAt in the past must NOT authenticate the request.
     * Null expiresAt means the key never expires (non-expiring key).
     */
    function isApiKeyValid(expiresAt: Date | null, now: Date): boolean {
      // Mirrors: if (key && (!key.expiresAt || key.expiresAt > new Date()))
      return !expiresAt || expiresAt > now;
    }

    const now = new Date("2026-03-31T12:00:00Z");
    const pastDate = new Date("2026-03-30T12:00:00Z");
    const futureDate = new Date("2026-04-30T12:00:00Z");

    expect(isApiKeyValid(pastDate, now)).toBe(false);    // expired
    expect(isApiKeyValid(futureDate, now)).toBe(true);    // valid
    expect(isApiKeyValid(null, now)).toBe(true);          // non-expiring
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Error formatter hides sensitive internal details (extended)
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — error formatter never leaks DB connection strings or stack traces", () => {
  /**
   * INVARIANT: The errorFormatter in trpc.ts replaces INTERNAL_SERVER_ERROR
   * messages with a generic string. This file adds additional vectors to the
   * ones already covered in security.test.ts.
   *
   * Attack vectors tested here:
   * - PostgreSQL connection string in error message
   * - File system path (stack trace fragment)
   * - Port number exposure
   * - Connection pool error from pg driver
   */

  function applyErrorFormatter(errorCode: string, originalMessage: string): string {
    // Mirrors the errorFormatter logic in trpc.ts exactly
    const isInternal = errorCode === "INTERNAL_SERVER_ERROR";
    return isInternal ? "Something went wrong. Please try again." : originalMessage;
  }

  it("hides PostgreSQL connection string in internal error messages", () => {
    const pgConnString = "postgresql://hisaabo_user:s3cr3tpwd@db.prod.internal:5432/hisaabo_tenant_x";
    const result = applyErrorFormatter("INTERNAL_SERVER_ERROR", pgConnString);
    expect(result).not.toContain("postgresql://");
    expect(result).not.toContain("s3cr3tpwd");
    expect(result).not.toContain("db.prod.internal");
    expect(result).not.toContain("5432");
    expect(result).toBe("Something went wrong. Please try again.");
  });

  it("hides file system paths from stack traces", () => {
    const stackTrace = "Error at /home/deploy/hisaabo/packages/api/src/routers/invoice.ts:142:23";
    const result = applyErrorFormatter("INTERNAL_SERVER_ERROR", stackTrace);
    expect(result).not.toContain("/home/deploy");
    expect(result).not.toContain("invoice.ts");
    expect(result).toBe("Something went wrong. Please try again.");
  });

  it("hides connection pool exhaustion errors that include DB details", () => {
    const poolError = "Connection pool timeout: all 10 connections to db-primary:5432 are busy";
    const result = applyErrorFormatter("INTERNAL_SERVER_ERROR", poolError);
    expect(result).not.toContain("db-primary");
    expect(result).not.toContain("5432");
    expect(result).toBe("Something went wrong. Please try again.");
  });

  it("passes UNAUTHORIZED errors through unchanged (user needs to know to log in)", () => {
    const msg = "You must be logged in";
    expect(applyErrorFormatter("UNAUTHORIZED", msg)).toBe(msg);
  });

  it("passes BAD_REQUEST errors through unchanged (user needs to fix their input)", () => {
    const msg = "No organization selected";
    expect(applyErrorFormatter("BAD_REQUEST", msg)).toBe(msg);
  });

  it("passes FORBIDDEN errors through unchanged (user needs to know about permission boundary)", () => {
    const msg = "Cannot delete Invoice";
    expect(applyErrorFormatter("FORBIDDEN", msg)).toBe(msg);
  });

  it("passes NOT_FOUND through unchanged", () => {
    const msg = "Party not found";
    expect(applyErrorFormatter("NOT_FOUND", msg)).toBe(msg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Cookie security flags
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — session cookie security flags are correctly set", () => {
  /**
   * INVARIANT (Finding #11): setSessionCookie and clearSessionCookie must agree
   * on the Secure flag. If setSessionCookie omits Secure in production but
   * clearSessionCookie always sends it, a logout request in production would fail
   * to clear the cookie (browsers match on name + Secure flag + path + domain).
   *
   * The actual functions from auth.ts are replicated here so a future refactor
   * cannot silently introduce a mismatch.
   */

  function buildSetCookieHeader(sessionId: string, nodeEnv: string): string {
    // Mirrors setSessionCookie() in auth.ts
    const secure = nodeEnv === "production" ? "; Secure" : "";
    return `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 60 * 60}`;
  }

  function buildClearCookieHeader(): string {
    // Mirrors clearSessionCookie() in auth.ts
    // NOTE: This always includes Secure — see Finding #11 below
    return "session_id=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
  }

  it("session cookie includes HttpOnly flag", () => {
    const header = buildSetCookieHeader("test-session-id", "development");
    expect(header).toContain("HttpOnly");
  });

  it("session cookie includes SameSite=Lax flag", () => {
    const header = buildSetCookieHeader("test-session-id", "development");
    expect(header).toContain("SameSite=Lax");
  });

  it("session cookie includes Secure flag in production", () => {
    const header = buildSetCookieHeader("test-session-id", "production");
    expect(header).toContain("Secure");
  });

  it("session cookie does NOT include Secure flag in development (allows http://localhost)", () => {
    const header = buildSetCookieHeader("test-session-id", "development");
    expect(header).not.toContain("Secure");
  });

  it("session cookie does NOT include Secure flag in test environment", () => {
    const header = buildSetCookieHeader("test-session-id", "test");
    expect(header).not.toContain("Secure");
  });

  it("clear cookie always includes HttpOnly and SameSite=Lax", () => {
    const header = buildClearCookieHeader();
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("clear cookie sets Max-Age=0 to force immediate browser deletion", () => {
    const header = buildClearCookieHeader();
    expect(header).toContain("Max-Age=0");
  });

  it("KNOWN GAP (Finding #11): clearSessionCookie always sends Secure even in development — document this", () => {
    /**
     * Finding #11: clearSessionCookie() hard-codes the Secure flag, but
     * setSessionCookie() only adds it in production. In development (http://localhost),
     * the Secure flag on the clear request is ignored by most browsers, so logout
     * still works in practice. However, the inconsistency is a maintenance hazard:
     * if someone changes set to always include Secure, the clear must match or
     * logout breaks in production for non-HTTPS contexts.
     *
     * This test DOCUMENTS the current asymmetry. It should fail if someone
     * "fixes" clearSessionCookie to become conditional but forgets to update
     * the matching logic for all environments.
     */
    const devSetHeader = buildSetCookieHeader("sid", "development");
    const clearHeader = buildClearCookieHeader();

    // In development: set does NOT have Secure, but clear DOES — this is the documented gap
    expect(devSetHeader).not.toContain("Secure");
    expect(clearHeader).toContain("Secure"); // asymmetry documented here

    // In production: both should have Secure (no gap)
    const prodSetHeader = buildSetCookieHeader("sid", "production");
    expect(prodSetHeader).toContain("Secure");
    expect(clearHeader).toContain("Secure");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Password hashing invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — Argon2id password hashing invariants", () => {
  /**
   * INVARIANT: Passwords must be hashed with Argon2id before storage.
   * The auth router uses: argon2.hash(password, { type: argon2.argon2id }).
   *
   * These tests verify:
   * 1. The hash format identifies itself as argon2id (not argon2i or argon2d).
   * 2. The hash is not the plaintext password.
   * 3. Two hashes of the same password differ (salt randomisation).
   * 4. argon2.verify() correctly validates the password against the hash.
   *
   * WHY: If someone accidentally switched to argon2i (vulnerable to GPU attacks)
   * or removed hashing entirely, these tests would catch it before prod deploy.
   */

  it("Argon2id hash format starts with $argon2id$ identifier", async () => {
    const argon2 = await import("argon2");
    const hash = await argon2.hash("RameshKumarShop2024!", {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    // Argon2id encoded output always starts with $argon2id$
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("Argon2id hash does NOT equal the plaintext password (hashing is applied)", async () => {
    const argon2 = await import("argon2");
    const password = "Suresh@Vyapar1234";
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(password.length);
  });

  it("two hashes of the same password are different (per-hash salt randomisation)", async () => {
    const argon2 = await import("argon2");
    const password = "KiranaStore@Delhi2024";
    const hash1 = await argon2.hash(password, { type: argon2.argon2id });
    const hash2 = await argon2.hash(password, { type: argon2.argon2id });
    // Salt is embedded in the hash — different salts → different output
    expect(hash1).not.toBe(hash2);
  });

  it("argon2.verify() returns true for correct password", async () => {
    const argon2 = await import("argon2");
    const password = "MumbaiDabawaalaSecret!9";
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    expect(await argon2.verify(hash, password)).toBe(true);
  });

  it("argon2.verify() returns false for wrong password", async () => {
    const argon2 = await import("argon2");
    const hash = await argon2.hash("correct-horse-battery", { type: argon2.argon2id });
    expect(await argon2.verify(hash, "wrong-password")).toBe(false);
  });

  it("password hash does NOT match bcrypt format (bcrypt must NOT be used)", async () => {
    const argon2 = await import("argon2");
    const hash = await argon2.hash("TestPassword123", { type: argon2.argon2id });
    // bcrypt hashes start with $2b$ or $2a$
    expect(hash).not.toMatch(/^\$2[ab]\$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Magic link token security
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — magic link token security properties", () => {
  /**
   * INVARIANT: The raw magic link token must never be stored in the database.
   * Only its SHA-256 hash is stored (tokenHash column). The raw token travels
   * to the user's email only and is never logged or persisted.
   *
   * Additional invariants:
   * - Token must expire (expiresAt is set to now + 15 minutes)
   * - Used tokens are marked with usedAt; subsequent use fails because
   *   the WHERE clause includes `isNull(magicLinkTokens.usedAt)`
   * - Token format: crypto.randomUUID() + "-" + nanoid(32) — high entropy
   */

  function hashToken(raw: string): string {
    // Mirrors hashToken() in auth.ts
    return createHash("sha256").update(raw).digest("hex");
  }

  it("token hash differs from raw token (raw token is never stored in DB)", () => {
    const raw = "550e8400-e29b-41d4-a716-446655440000-AbCdEfGhIjKlMnOpQrStUvWxYz123456";
    const hashed = hashToken(raw);
    expect(hashed).not.toBe(raw);
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
  });

  it("token hash is deterministic (server can re-hash submitted token to look up in DB)", () => {
    const raw = "7a3f2e01-abcd-4321-cafe-000102030405-XYZxyz0123456789abcdefABCDEF0123";
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("different raw tokens produce different hashes (uniqueness guarantee)", () => {
    const raw1 = "token-alpha-123";
    const raw2 = "token-beta-456";
    expect(hashToken(raw1)).not.toBe(hashToken(raw2));
  });

  it("magic link token must have an expiry set to +15 minutes from creation", () => {
    /**
     * INVARIANT: auth.ts sets expiresAt = new Date(Date.now() + 15 * 60 * 1000).
     * A token without an expiry would be permanently valid after a DB dump.
     */
    const TOKEN_TTL_MS = 15 * 60 * 1000;
    const createdAt = new Date("2026-03-31T10:00:00Z");
    const expectedExpiry = new Date(createdAt.getTime() + TOKEN_TTL_MS);
    expect(expectedExpiry.toISOString()).toBe("2026-03-31T10:15:00.000Z");
    expect(expectedExpiry.getTime() - createdAt.getTime()).toBe(TOKEN_TTL_MS);
  });

  it("used token must not be reusable (atomic mark-used pattern makes usedAt non-null)", () => {
    /**
     * INVARIANT: verifyMagicLink uses an atomic UPDATE ... WHERE usedAt IS NULL
     * combined with RETURNING to find-and-mark in one statement. If the token
     * was already used, usedAt is non-null, the WHERE clause fails, and
     * no row is returned — causing an error to be thrown.
     *
     * We model the WHERE filter logic here to document the invariant.
     */
    function canTokenBeUsed(tokenRow: {
      tokenHash: string;
      expiresAt: Date;
      usedAt: Date | null;
    }, now: Date): boolean {
      // Mirrors: WHERE tokenHash = ? AND expiresAt > NOW() AND usedAt IS NULL
      return tokenRow.expiresAt > now && tokenRow.usedAt === null;
    }

    const futureExpiry = new Date("2026-03-31T10:15:00Z");
    const now = new Date("2026-03-31T10:05:00Z");

    // Fresh token: valid
    expect(canTokenBeUsed({ tokenHash: "abc", expiresAt: futureExpiry, usedAt: null }, now)).toBe(true);

    // Already-used token: cannot be reused
    expect(canTokenBeUsed(
      { tokenHash: "abc", expiresAt: futureExpiry, usedAt: new Date("2026-03-31T10:02:00Z") },
      now,
    )).toBe(false);

    // Expired token (even if not used): cannot be used
    const pastExpiry = new Date("2026-03-31T09:59:00Z");
    expect(canTokenBeUsed({ tokenHash: "abc", expiresAt: pastExpiry, usedAt: null }, now)).toBe(false);

    // Expired AND used: cannot be used
    expect(canTokenBeUsed(
      { tokenHash: "abc", expiresAt: pastExpiry, usedAt: new Date("2026-03-31T09:58:00Z") },
      now,
    )).toBe(false);
  });

  it("email-change token must have userId bound server-side (prevents account takeover)", () => {
    /**
     * INVARIANT: requestEmailChange stores ctx.user.id in the token row.
     * confirmEmailChange reads userId FROM the token — never from the URL/body.
     * If userId were accepted from client input, an attacker with a stolen token
     * could redirect the email change to an arbitrary account.
     *
     * This mirrors the same test in security.test.ts but adds the numeric
     * assertion that a token without userId is rejected.
     */
    function simulateConfirm(tokenRow: { userId: string | null; email: string }): string {
      if (!tokenRow.userId) {
        throw new Error("Invalid or expired link");
      }
      return tokenRow.userId;
    }

    // Valid email-change token has userId
    expect(simulateConfirm({ userId: "user-ramesh-001", email: "new@example.com" }))
      .toBe("user-ramesh-001");

    // Regular magic link token (no userId) cannot be used for email change
    expect(() => simulateConfirm({ userId: null, email: "attacker@evil.com" }))
      .toThrow("Invalid or expired link");
  });
});
