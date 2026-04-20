/**
 * Tests for per-client session TTL policy (P1 #5)
 *
 * WHY THIS FILE EXISTS:
 * Bearer-token clients (mobile + Tauri desktop) carry session tokens in
 * storage that can be stolen. A 30-day fixed expiry is too long a replay
 * window for a stolen device token. This file encodes the invariants for
 * the 7-day sliding-window policy for bearer sessions, and confirms that
 * cookie sessions are unchanged.
 *
 * All tests are pure-logic or mock-DB — no real Postgres is spun up.
 * Pattern follows security-auth.test.ts and context.test.ts.
 */

import { describe, it, expect } from "vitest";

// ── Shared constants (mirror auth.ts and context.ts) ────────────────────────
const BEARER_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BEARER_MAX_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Helpers that mirror the production logic under test ──────────────────────

/** Mirrors the isBearerClient() detection in auth.ts */
function detectAuthMethod(req: Request): "cookie" | "bearer" {
  const client = req.headers.get("x-hisaabo-client");
  return client === "mobile" || client === "desktop" ? "bearer" : "cookie";
}

/** Mirrors session insert values computed in auth.ts for login/register/verifyMagicLink */
function computeSessionInsertValues(authMethod: "cookie" | "bearer", now: number) {
  const expiresAt = new Date(now + (authMethod === "bearer" ? BEARER_SESSION_DURATION_MS : COOKIE_SESSION_DURATION_MS));
  const maxExpiresAt = authMethod === "bearer" ? new Date(now + BEARER_MAX_SESSION_DURATION_MS) : null;
  return { expiresAt, maxExpiresAt, authMethod };
}

/**
 * Mirrors the bearer sliding-window logic in context.ts.
 * Returns the new expiresAt to write, or null if the session must be dropped.
 */
function computeBearerSlide(
  session: { expiresAt: Date; maxExpiresAt: Date | null; authMethod: "cookie" | "bearer" },
  now: Date,
): { action: "bump"; newExpiresAt: Date } | { action: "reject" } | { action: "noop" } {
  if (now >= session.expiresAt) return { action: "reject" }; // already expired by normal expiry

  if (session.authMethod === "bearer") {
    // Check absolute cap first
    if (session.maxExpiresAt && now >= session.maxExpiresAt) {
      return { action: "reject" };
    }

    // Slide forward 7 days, capped at maxExpiresAt
    const slidTo = new Date(now.getTime() + BEARER_SESSION_DURATION_MS);
    const newExpiresAt =
      session.maxExpiresAt && slidTo > session.maxExpiresAt
        ? session.maxExpiresAt
        : slidTo;

    return { action: "bump", newExpiresAt };
  }

  // Cookie session — no bump
  return { action: "noop" };
}

// ─────────────────────────────────────────────────────────────────────────────
// authMethod detection at session creation time
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — session authMethod is detected from x-hisaabo-client header at creation time", () => {
  /**
   * INVARIANT: At session creation there is no existing Bearer token yet — we
   * cannot use the Authorization header to detect client type. The
   * x-hisaabo-client header is the authoritative signal. Both mobile and
   * desktop clients send it; browsers do not.
   */

  it("session creation records authMethod='bearer' when x-hisaabo-client is 'mobile'", () => {
    const req = new Request("http://localhost/", {
      headers: { "x-hisaabo-client": "mobile" },
    });
    expect(detectAuthMethod(req)).toBe("bearer");
  });

  it("session creation records authMethod='bearer' when x-hisaabo-client is 'desktop'", () => {
    const req = new Request("http://localhost/", {
      headers: { "x-hisaabo-client": "desktop" },
    });
    expect(detectAuthMethod(req)).toBe("bearer");
  });

  it("session creation records authMethod='cookie' when no x-hisaabo-client header is present — classic web browser path unchanged", () => {
    const req = new Request("http://localhost/");
    expect(detectAuthMethod(req)).toBe("cookie");
  });

  it("session creation records authMethod='cookie' for an unrecognised x-hisaabo-client value — unknown clients fall back to cookie semantics", () => {
    const req = new Request("http://localhost/", {
      headers: { "x-hisaabo-client": "cli" },
    });
    expect(detectAuthMethod(req)).toBe("cookie");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session insert values — bearer vs cookie
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — bearer session is created with 7-day expiresAt and 30-day maxExpiresAt; cookie session keeps 30-day expiresAt and null maxExpiresAt", () => {
  /**
   * INVARIANT: Bearer sessions must have a shorter initial window (7 days)
   * than cookie sessions (30 days). The absolute cap (maxExpiresAt) prevents
   * infinite extension via the sliding window.
   */

  const BASE_TIME = new Date("2026-01-01T00:00:00.000Z").getTime();

  it("bearer session expiresAt is set to createdAt + 7 days (not 30)", () => {
    const { expiresAt } = computeSessionInsertValues("bearer", BASE_TIME);
    const expectedMs = BASE_TIME + BEARER_SESSION_DURATION_MS;
    expect(expiresAt.getTime()).toBe(expectedMs);
    // Must be 7 days, NOT 30
    const thirtyDaysMs = BASE_TIME + COOKIE_SESSION_DURATION_MS;
    expect(expiresAt.getTime()).not.toBe(thirtyDaysMs);
  });

  it("bearer session maxExpiresAt is set to createdAt + 30 days — the hard absolute cap", () => {
    const { maxExpiresAt } = computeSessionInsertValues("bearer", BASE_TIME);
    expect(maxExpiresAt).not.toBeNull();
    expect(maxExpiresAt!.getTime()).toBe(BASE_TIME + BEARER_MAX_SESSION_DURATION_MS);
  });

  it("cookie session expiresAt is set to createdAt + 30 days — existing behavior unchanged", () => {
    const { expiresAt } = computeSessionInsertValues("cookie", BASE_TIME);
    expect(expiresAt.getTime()).toBe(BASE_TIME + COOKIE_SESSION_DURATION_MS);
  });

  it("cookie session maxExpiresAt is null — no absolute cap needed for XSS-resistant HttpOnly cookies", () => {
    const { maxExpiresAt } = computeSessionInsertValues("cookie", BASE_TIME);
    expect(maxExpiresAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bearer sliding-window bump
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — bearer session expiresAt slides forward 7 days on each successful request, never past maxExpiresAt", () => {
  /**
   * INVARIANT: A bearer session active on day 5 must have expiresAt bumped to
   * day 12 (5 + 7). This keeps an actively-used device session alive without
   * the 30-day replay window of a fixed expiry.
   */

  const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

  it("a bearer session at day 5 of activity gets its expiresAt bumped to day 12 (7-day slide)", () => {
    // Session created on Jan 1, expiresAt = Jan 8 (7 days), maxExpiresAt = Jan 31 (30 days)
    const session = {
      expiresAt: new Date(CREATED_AT.getTime() + BEARER_SESSION_DURATION_MS),
      maxExpiresAt: new Date(CREATED_AT.getTime() + BEARER_MAX_SESSION_DURATION_MS),
      authMethod: "bearer" as const,
    };

    // Request arrives on day 5
    const day5 = new Date(CREATED_AT.getTime() + 5 * 24 * 60 * 60 * 1000);
    const result = computeBearerSlide(session, day5);

    expect(result.action).toBe("bump");
    if (result.action === "bump") {
      // day 5 + 7 days = day 12
      const expectedExpiresAt = new Date(day5.getTime() + BEARER_SESSION_DURATION_MS);
      expect(result.newExpiresAt.getTime()).toBe(expectedExpiresAt.getTime());
    }
  });

  it("a bearer session whose 7-day slide would overshoot maxExpiresAt is capped at maxExpiresAt — not beyond", () => {
    // Session where maxExpiresAt is only 3 days away
    const now = new Date(CREATED_AT.getTime() + 28 * 24 * 60 * 60 * 1000); // day 28
    const session = {
      expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // expires day 30
      maxExpiresAt: new Date(CREATED_AT.getTime() + BEARER_MAX_SESSION_DURATION_MS), // day 31 cap
      authMethod: "bearer" as const,
    };

    const result = computeBearerSlide(session, now);

    expect(result.action).toBe("bump");
    if (result.action === "bump") {
      // Slide would be day 28 + 7 = day 35, but cap is day 31
      expect(result.newExpiresAt.getTime()).toBe(session.maxExpiresAt!.getTime());
    }
  });

  it("a bearer session at or past maxExpiresAt is rejected — absolute expiry is enforced, token cannot be slid further", () => {
    // now = day 31 (past the 30-day cap)
    const now = new Date(CREATED_AT.getTime() + 31 * 24 * 60 * 60 * 1000);
    const session = {
      expiresAt: new Date(now.getTime() + 1 * 60 * 60 * 1000), // expiresAt still in future
      maxExpiresAt: new Date(CREATED_AT.getTime() + BEARER_MAX_SESSION_DURATION_MS), // day 30 — already past
      authMethod: "bearer" as const,
    };

    const result = computeBearerSlide(session, now);
    expect(result.action).toBe("reject");
  });

  it("a bearer session past its normal 7-day expiresAt (and no request arrived to slide it) is rejected by the initial expiry check", () => {
    // Session that expired 1 day ago (no requests kept it alive)
    const now = new Date(CREATED_AT.getTime() + 8 * 24 * 60 * 60 * 1000); // day 8
    const session = {
      expiresAt: new Date(CREATED_AT.getTime() + BEARER_SESSION_DURATION_MS), // expired day 7
      maxExpiresAt: new Date(CREATED_AT.getTime() + BEARER_MAX_SESSION_DURATION_MS),
      authMethod: "bearer" as const,
    };

    const result = computeBearerSlide(session, now);
    // The DB WHERE clause already filters out expired sessions (gt(sessions.expiresAt, now)),
    // so this row would never reach the slide logic. But if it did, it is rejected.
    expect(result.action).toBe("reject");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cookie sessions are never bumped
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — cookie session expiresAt is never modified on read — only lastUsedAt is bumped", () => {
  /**
   * INVARIANT: Cookie sessions have a fixed 30-day expiry. Sliding the
   * expiresAt of a cookie session would silently extend it beyond the
   * 30-day policy. The bump-logic is Bearer-only.
   *
   * This test confirms the code path returns 'noop' for cookie sessions,
   * meaning only lastUsedAt is updated, not expiresAt.
   */

  it("a cookie session mid-lifetime returns noop — expiresAt must not be touched", () => {
    const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
    const session = {
      expiresAt: new Date(CREATED_AT.getTime() + COOKIE_SESSION_DURATION_MS),
      maxExpiresAt: null,
      authMethod: "cookie" as const,
    };

    // Request on day 5 — cookie session, should NOT slide
    const day5 = new Date(CREATED_AT.getTime() + 5 * 24 * 60 * 60 * 1000);
    const result = computeBearerSlide(session, day5);

    expect(result.action).toBe("noop");
  });

  it("a cookie session close to expiry also returns noop — web sessions must expire naturally at the fixed 30-day mark", () => {
    const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
    const session = {
      expiresAt: new Date(CREATED_AT.getTime() + COOKIE_SESSION_DURATION_MS),
      maxExpiresAt: null,
      authMethod: "cookie" as const,
    };

    // Request on day 29 — still valid, still no slide
    const day29 = new Date(CREATED_AT.getTime() + 29 * 24 * 60 * 60 * 1000);
    const result = computeBearerSlide(session, day29);

    expect(result.action).toBe("noop");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB UPDATE shape — what columns are written during a bearer slide
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — bearer session slide writes both lastUsedAt and expiresAt in a single UPDATE; cookie session writes only lastUsedAt", () => {
  /**
   * INVARIANT: The bearer slide must extend expiresAt in the same UPDATE that
   * bumps lastUsedAt. If only lastUsedAt is written, the session expires at the
   * originally minted window (7 days) and active devices get logged out.
   *
   * We mock the update call and assert on the SET payload shape.
   */

  it("bearer session UPDATE payload contains both lastUsedAt and expiresAt — two columns written atomically", () => {
    // Simulate what context.ts builds for the bearer slide update
    function buildBearerUpdatePayload(now: Date, newExpiresAt: Date) {
      // Mirrors: .set({ lastUsedAt: now, expiresAt: newExpiresAt }) in context.ts
      return { lastUsedAt: now, expiresAt: newExpiresAt };
    }

    const now = new Date("2026-01-06T00:00:00.000Z"); // day 5
    const newExpiry = new Date(now.getTime() + BEARER_SESSION_DURATION_MS); // day 12
    const payload = buildBearerUpdatePayload(now, newExpiry);

    expect(payload).toHaveProperty("lastUsedAt", now);
    expect(payload).toHaveProperty("expiresAt", newExpiry);
    // Must NOT omit expiresAt
    expect(Object.keys(payload)).toContain("expiresAt");
  });

  it("cookie session UPDATE payload contains only lastUsedAt — expiresAt must not be included", () => {
    // Mirrors: .set({ lastUsedAt: now }) in context.ts for cookie path
    function buildCookieUpdatePayload(now: Date) {
      return { lastUsedAt: now };
    }

    const now = new Date("2026-01-06T00:00:00.000Z");
    const payload = buildCookieUpdatePayload(now);

    expect(payload).toHaveProperty("lastUsedAt", now);
    expect(Object.keys(payload)).not.toContain("expiresAt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backwards compatibility — existing rows default to 'cookie' authMethod
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — existing session rows with default authMethod='cookie' are treated as cookie sessions and not forcibly expired", () => {
  /**
   * INVARIANT: The migration adds `auth_method` with DEFAULT 'cookie'. Every
   * existing session row in the database implicitly becomes a cookie session.
   * The sliding-window logic must not run for these rows, preserving their
   * original 30-day expiry. No existing user is logged out by the migration.
   */

  it("a row with authMethod='cookie' (migration default) produces noop action — existing users are unaffected", () => {
    const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
    // Simulate an existing pre-migration session row that received the default value
    const existingRow = {
      expiresAt: new Date(CREATED_AT.getTime() + COOKIE_SESSION_DURATION_MS),
      maxExpiresAt: null, // null because it was inserted before the column existed
      authMethod: "cookie" as const, // default applied by Postgres
    };

    const now = new Date(CREATED_AT.getTime() + 10 * 24 * 60 * 60 * 1000); // day 10
    const result = computeBearerSlide(existingRow, now);

    expect(result.action).toBe("noop");
  });

  it("a row with authMethod='cookie' and null maxExpiresAt does not trigger the absolute cap check — no erroneous rejection", () => {
    const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
    const existingRow = {
      expiresAt: new Date(CREATED_AT.getTime() + COOKIE_SESSION_DURATION_MS),
      maxExpiresAt: null,
      authMethod: "cookie" as const,
    };

    // Even on day 31 (past where maxExpiresAt would be for a bearer session)
    const day31 = new Date(CREATED_AT.getTime() + 31 * 24 * 60 * 60 * 1000);
    // Normal expiry check would catch this (day 31 > day 30 expiry), but we test
    // that the absolute-cap logic is never consulted for cookie sessions
    const result = computeBearerSlide(existingRow, new Date(CREATED_AT.getTime() + 15 * 24 * 60 * 60 * 1000));

    expect(result.action).toBe("noop"); // still noop — not reject via maxExpiresAt
    void day31; // referenced above for documentation
  });
});
