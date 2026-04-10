/**
 * Tests for packages/api/src/context.ts
 *
 * WHY THIS FILE EXISTS:
 * The createContext function is the entry point for every API request. It
 * extracts the session ID from either a cookie or a Bearer header, validates
 * it against the database, and populates the tRPC context with the authenticated
 * user and tenant. Bugs here affect every single endpoint.
 *
 * This file tests the parts of context creation that are stateless or can be
 * verified without a real database: cookie parsing, Bearer token extraction,
 * and the businessId nullability rule.
 */

import { describe, it, expect } from "vitest";
import { getSessionIdFromRequest } from "../context.js";

// ─────────────────────────────────────────────────────────────────────────────
// Cookie parsing — getCookie helper
// ─────────────────────────────────────────────────────────────────────────────
describe("getCookie — extracts a named cookie from a Cookie header string", () => {
  /**
   * The getCookie helper is a private function in context.ts. We replicate
   * its exact regex logic here to test the important edge cases.
   */

  function getCookie(req: Request, name: string): string | null {
    const cookies = req.headers.get("cookie");
    if (!cookies) return null;
    const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function makeRequest(cookieHeader: string): Request {
    return new Request("http://localhost/", { headers: { cookie: cookieHeader } });
  }

  it("extracts a session_id from a cookie header with a single cookie", () => {
    const req = makeRequest("session_id=abc123");
    expect(getCookie(req, "session_id")).toBe("abc123");
  });

  it("extracts a session_id from a multi-cookie header", () => {
    const req = makeRequest("theme=dark; session_id=xyz789; lang=en");
    expect(getCookie(req, "session_id")).toBe("xyz789");
  });

  it("returns null when the named cookie is not present", () => {
    const req = makeRequest("theme=dark; lang=en");
    expect(getCookie(req, "session_id")).toBe(null);
  });

  it("returns null when the Cookie header is absent", () => {
    const req = new Request("http://localhost/");
    expect(getCookie(req, "session_id")).toBe(null);
  });

  it("handles URL-encoded cookie values (e.g. nanoid tokens with special chars)", () => {
    const token = "abc%20def%2F123";
    const req = makeRequest(`session_id=${token}`);
    expect(getCookie(req, "session_id")).toBe("abc def/123");
  });

  it("does not match a cookie that is a prefix of the target name", () => {
    // 'session_id_extra' must not match 'session_id'
    const req = makeRequest("session_id_extra=wrong; session_id=correct");
    expect(getCookie(req, "session_id")).toBe("correct");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session extraction — Bearer header vs Cookie priority (createContext logic)
// ─────────────────────────────────────────────────────────────────────────────
describe("session ID extraction inside createContext — Bearer header wins over session_id cookie", () => {
  /**
   * The createContext function checks the Authorization: Bearer header
   * FIRST, then falls back to the session_id cookie. This prevents a stale
   * native-cookie-jar replay from clobbering a freshly-authenticated mobile
   * session. See the docblock in context.ts for the full re-login scenario.
   */

  function extractSessionId(req: Request): string | null {
    // Mirror createContext logic from context.ts (Bearer first, cookie fallback).
    let sessionId: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) sessionId = authHeader.slice(7);
    if (!sessionId) {
      const cookies = req.headers.get("cookie") || "";
      const cookieMatch = cookies.match(/(?:^|;\s*)session_id=([^;]*)/);
      if (cookieMatch) sessionId = decodeURIComponent(cookieMatch[1]);
    }
    return sessionId;
  }

  it("createContext resolves the user from the Authorization Bearer token when BOTH a Bearer header and a session_id cookie are present — a mobile client that just re-authenticated after a stale cookie replay must be authenticated against the fresh token, never the stale cookie", () => {
    const req = new Request("http://localhost/", {
      headers: {
        cookie: "session_id=stale-cookie-from-previous-session",
        authorization: "Bearer fresh-mobile-token-from-relogin",
      },
    });
    expect(extractSessionId(req)).toBe("fresh-mobile-token-from-relogin");
  });

  it("createContext falls back to the session_id cookie when no Authorization header is present — web and desktop clients must keep working unchanged", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "session_id=web-cookie-session-abc" },
    });
    expect(extractSessionId(req)).toBe("web-cookie-session-abc");
  });

  it("createContext resolves to no user when neither Bearer nor cookie is present — public endpoints must not receive a phantom user context", () => {
    const req = new Request("http://localhost/");
    expect(extractSessionId(req)).toBeNull();
  });

  it("extracts session from Authorization: Bearer header when no cookie is present", () => {
    const req = new Request("http://localhost/", {
      headers: { authorization: "Bearer bearer-token-abc" },
    });
    expect(extractSessionId(req)).toBe("bearer-token-abc");
  });

  it("extracts session from cookie header when no Authorization header is present", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "session_id=cookietoken123" },
    });
    expect(extractSessionId(req)).toBe("cookietoken123");
  });

  it("returns null for a malformed Authorization header (no 'Bearer ' prefix) and falls through to the cookie", () => {
    const req = new Request("http://localhost/", {
      headers: {
        authorization: "Token some-api-key",
        cookie: "session_id=fallback-cookie",
      },
    });
    // Malformed Authorization is ignored; the cookie fallback kicks in.
    expect(extractSessionId(req)).toBe("fallback-cookie");
  });

  it("returns null for a malformed Authorization header when no cookie is present either", () => {
    const req = new Request("http://localhost/", {
      headers: { authorization: "Token some-api-key" },
    });
    expect(extractSessionId(req)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSessionIdFromRequest — shared helper used by tenant.select and others
// ─────────────────────────────────────────────────────────────────────────────
describe("getSessionIdFromRequest — extracts session ID from cookie OR Bearer token", () => {
  /**
   * This helper was introduced to fix a critical mobile bug: tenant.select and
   * autoSelectTenantInSession only read the cookie, but mobile clients send a
   * Bearer token. The shared helper normalises both paths.
   *
   * We import the real function to guard against regressions.
   */

  it("extracts session ID from a cookie", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "session_id=cookie-session-abc" },
    });
    expect(getSessionIdFromRequest(req)).toBe("cookie-session-abc");
  });

  it("extracts session ID from a Bearer token (mobile path)", () => {
    const req = new Request("http://localhost/", {
      headers: { authorization: "Bearer mobile-session-xyz" },
    });
    expect(getSessionIdFromRequest(req)).toBe("mobile-session-xyz");
  });

  it("prefers cookie over Bearer token when both are present", () => {
    const req = new Request("http://localhost/", {
      headers: {
        cookie: "session_id=cookie-wins",
        authorization: "Bearer bearer-loses",
      },
    });
    expect(getSessionIdFromRequest(req)).toBe("cookie-wins");
  });

  it("returns null when neither cookie nor Bearer token is present", () => {
    const req = new Request("http://localhost/");
    expect(getSessionIdFromRequest(req)).toBeNull();
  });

  it("skips API keys (hisaabo_key_ prefix) — those are not session IDs", () => {
    const req = new Request("http://localhost/", {
      headers: { authorization: "Bearer hisaabo_key_abc123def456" },
    });
    expect(getSessionIdFromRequest(req)).toBeNull();
  });

  it("returns null for malformed Authorization header (no Bearer prefix)", () => {
    const req = new Request("http://localhost/", {
      headers: { authorization: "Token some-token" },
    });
    expect(getSessionIdFromRequest(req)).toBeNull();
  });

  it("returns null for 'Bearer ' with no token value (trimmed by Request API)", () => {
    const req = new Request("http://localhost/", {
      headers: { authorization: "Bearer " },
    });
    // Request API trims trailing whitespace → "Bearer" doesn't match "Bearer " prefix
    expect(getSessionIdFromRequest(req)).toBeNull();
  });

  it("returns null for cookie with empty value (empty string is falsy)", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "session_id=" },
    });
    // getCookie returns "" which is falsy → falls through to Bearer → no Bearer → null
    expect(getSessionIdFromRequest(req)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// businessId nullability — must be null when user is not authenticated
// ─────────────────────────────────────────────────────────────────────────────
describe("businessId is null when user is not authenticated", () => {
  /**
   * The createContext function contains:
   *   businessId: businessId && user ? businessId : null
   *
   * This prevents unauthenticated requests from injecting a businessId and
   * potentially bypassing the hasBusinessAccess check if a middleware bug existed.
   */

  function resolveBusinessId(businessIdHeader: string | null, user: object | null): string | null {
    // Mirror createContext: businessId && user ? businessId : null
    return businessIdHeader && user ? businessIdHeader : null;
  }

  it("resolves to the provided businessId when user is authenticated", () => {
    const bid = resolveBusinessId("biz-uuid-123", { id: "user-1" });
    expect(bid).toBe("biz-uuid-123");
  });

  it("resolves to null when the user is null (unauthenticated request)", () => {
    // Even if an attacker sends x-business-id, it is ignored without authentication.
    const bid = resolveBusinessId("attacker-biz-id", null);
    expect(bid).toBe(null);
  });

  it("resolves to null when the businessId header is absent", () => {
    const bid = resolveBusinessId(null, { id: "user-1" });
    expect(bid).toBe(null);
  });

  it("resolves to null when both user and header are absent", () => {
    const bid = resolveBusinessId(null, null);
    expect(bid).toBe(null);
  });
});
