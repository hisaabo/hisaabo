/**
 * Desktop session bridge unit tests.
 *
 * The bridge is the only surface between the Tauri keyring (Rust) and the
 * tRPC client, so it is critical that:
 *
 *   1. It is a true no-op on web — an accidental `invoke()` call in a
 *      browser build would throw at runtime because `@tauri-apps/api/core`
 *      has no implementation there.
 *   2. `saveDesktopToken()` mutates the in-memory cache synchronously so
 *      the next tRPC request picks up the Bearer header without waiting
 *      for the keychain round-trip.
 *   3. Keychain failures never prevent the user from continuing — the app
 *      has to stay usable with only the in-memory token (session survives
 *      the current run but not an app restart).
 *   4. `hydrateDesktopSession()` translates IPC errors into "no token
 *      available" rather than propagating them, matching the "never
 *      silently downgrade to plaintext" security posture.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mocks — the factory callback form is required because
// vi.mock is hoisted above imports at transform time.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../isDesktop", () => ({
  isDesktop: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../isDesktop";
import {
  hasCachedToken,
  getTokenSync,
  hydrateDesktopSession,
  saveDesktopToken,
  clearDesktopToken,
  ensureAccessToken,
  _resetForTests,
} from "../desktop-session";

const invokeMock = vi.mocked(invoke);
const isDesktopMock = vi.mocked(isDesktop);

// Drain the module-level cache between tests. clearDesktopToken itself
// performs an invoke, so we queue a resolved `undefined` specifically for
// that call — and do it BEFORE resetting the mock so this arrangement
// doesn't pollute the test's own mockResolvedValueOnce queue.
beforeEach(async () => {
  isDesktopMock.mockReset();
  isDesktopMock.mockReturnValue(true);
  invokeMock.mockReset();
  invokeMock.mockResolvedValueOnce(undefined);
  await clearDesktopToken();
  invokeMock.mockReset(); // drop the queued resolutions used during cleanup
  // Also reset the access-token cache between tests
  _resetForTests();
});

// ─────────────────────────────────────────────────────────────────────────
// Web no-op contract
// ─────────────────────────────────────────────────────────────────────────
describe("desktop-session — web (non-Tauri) is a strict no-op", () => {
  it("hydrateDesktopSession does not call invoke on web", async () => {
    isDesktopMock.mockReturnValue(false);
    await hydrateDesktopSession();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("saveDesktopToken does not call invoke on web", async () => {
    isDesktopMock.mockReturnValue(false);
    await saveDesktopToken("some-token");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clearDesktopToken does not call invoke on web", async () => {
    isDesktopMock.mockReturnValue(false);
    await clearDesktopToken();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("saveDesktopToken on web leaves the cache empty — web uses HttpOnly cookies, never Bearer", async () => {
    isDesktopMock.mockReturnValue(false);
    await saveDesktopToken("should-not-cache");
    expect(getTokenSync()).toBeNull();
    expect(hasCachedToken()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// hydrateDesktopSession
// ─────────────────────────────────────────────────────────────────────────
describe("desktop-session — hydrateDesktopSession", () => {
  it("populates the refresh-token cache from a keychain read so the first tRPC request can issue an access token", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce("session-abc-from-keychain");

    await hydrateDesktopSession();

    expect(invokeMock).toHaveBeenCalledWith("get_session_token");
    // hasCachedToken() reflects whether a refresh token is stored
    expect(hasCachedToken()).toBe(true);
    // getTokenSync() now returns the short-lived access token, NOT the refresh
    // token. After hydrateDesktopSession alone (no ensureAccessToken call yet),
    // no access token exists yet — the first ensureAccessToken() call will issue one.
    expect(getTokenSync()).toBeNull();
  });

  it("treats null from the keychain as 'no token stored yet' — first-run on a clean machine must not throw", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce(null);

    await hydrateDesktopSession();

    expect(getTokenSync()).toBeNull();
    expect(hasCachedToken()).toBe(false);
  });

  it("swallows keychain errors and leaves the cache empty (never downgrades to plaintext fallback)", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockRejectedValueOnce(new Error("libsecret unavailable"));

    // Must not throw — boot sequence cannot be blocked by a keychain error.
    await expect(hydrateDesktopSession()).resolves.toBeUndefined();
    expect(getTokenSync()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// saveDesktopToken
// ─────────────────────────────────────────────────────────────────────────
describe("desktop-session — saveDesktopToken", () => {
  it("updates the refresh-token cache synchronously before the IPC call resolves so the next tRPC request can issue an access token", async () => {
    isDesktopMock.mockReturnValue(true);
    // Use a promise we control so we can inspect cache state mid-flight.
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    invokeMock.mockReturnValueOnce(blocked as unknown as Promise<void>);

    const savePromise = saveDesktopToken("fresh-token");

    // Before the IPC resolves, hasCachedToken() MUST already be true —
    // the refresh token is cached so ensureAccessToken() can use it.
    expect(hasCachedToken()).toBe(true);
    // getTokenSync() returns the access token (null until ensureAccessToken is called)
    expect(getTokenSync()).toBeNull();

    release();
    await savePromise;
  });

  it("passes the token under the exact argument name expected by the Rust command (`token`)", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce(undefined);

    await saveDesktopToken("argument-shape-token");

    // Rust command signature is `save_session_token(token: String)` — the
    // Tauri glue requires the arg key to match the parameter name exactly.
    expect(invokeMock).toHaveBeenCalledWith("save_session_token", { token: "argument-shape-token" });
  });

  it("keeps the refresh token in memory even when the keychain write fails — app stays usable for the current session", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockRejectedValueOnce(new Error("keychain locked"));

    await saveDesktopToken("keychain-failed-token");

    // The refresh token is still held in memory — ensureAccessToken can use it
    expect(hasCachedToken()).toBe(true);
    // getTokenSync() returns the access token (still null — no ensureAccessToken called yet)
    expect(getTokenSync()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// clearDesktopToken
// ─────────────────────────────────────────────────────────────────────────
describe("desktop-session — clearDesktopToken", () => {
  it("empties both refresh and access token caches before the IPC delete resolves so no subsequent request carries the stale token", async () => {
    isDesktopMock.mockReturnValue(true);

    // Seed a refresh token first.
    invokeMock.mockResolvedValueOnce(undefined);
    await saveDesktopToken("to-be-cleared");
    expect(hasCachedToken()).toBe(true);

    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    invokeMock.mockReturnValueOnce(blocked as unknown as Promise<void>);

    const clearPromise = clearDesktopToken();
    expect(getTokenSync()).toBeNull();

    release();
    await clearPromise;
  });

  it("still clears the cache even if the keychain delete command rejects", async () => {
    isDesktopMock.mockReturnValue(true);

    invokeMock.mockResolvedValueOnce(undefined);
    await saveDesktopToken("stale");

    invokeMock.mockRejectedValueOnce(new Error("keychain not reachable"));
    await clearDesktopToken();

    // User's intent — "I am logged out" — is satisfied by clearing the
    // in-memory token; the keychain row can be overwritten on next login.
    expect(getTokenSync()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ensureAccessToken — access token issuance and caching
// ─────────────────────────────────────────────────────────────────────────

// Helper: set up a desktop environment with a seeded refresh token.
async function seedRefreshToken(token: string) {
  isDesktopMock.mockReturnValue(true);
  invokeMock.mockResolvedValueOnce(undefined); // for save_session_token
  await saveDesktopToken(token);
}

// Helper: build a fake successful issueAccessToken API response.
function makeIssueResponse(accessToken: string, expiresAt: Date) {
  return JSON.stringify({
    result: {
      data: {
        json: { accessToken, expiresAt: expiresAt.toISOString() },
      },
    },
  });
}

describe("desktop-session — ensureAccessToken", () => {
  it("returns null on web (non-Tauri) — web clients never need access tokens", async () => {
    isDesktopMock.mockReturnValue(false);
    const result = await ensureAccessToken();
    expect(result).toBeNull();
  });

  it("returns null when no refresh token is seeded (user not logged in)", async () => {
    isDesktopMock.mockReturnValue(true);
    // No refresh token seeded — cachedRefresh is null
    const result = await ensureAccessToken();
    expect(result).toBeNull();
  });

  it("fetches a new access token when cache is empty, populates cache, returns it", async () => {
    await seedRefreshToken("refresh-token-abc");
    invokeMock.mockReset(); // don't pollute subsequent mocks

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(makeIssueResponse("at_newtoken123", expiresAt), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await ensureAccessToken();

    expect(result).toBe("at_newtoken123");
    // getTokenSync should now return the cached access token
    expect(getTokenSync()).toBe("at_newtoken123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it("returns cached access token without a network call when >30s remains on TTL", async () => {
    await seedRefreshToken("refresh-token-xyz");
    invokeMock.mockReset();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min — well within slack
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(makeIssueResponse("at_cachedtoken", expiresAt), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    // First call — fetches from server
    await ensureAccessToken();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call — must use cache (no additional fetch)
    const result = await ensureAccessToken();
    expect(result).toBe("at_cachedtoken");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still only 1 call

    fetchSpy.mockRestore();
  });

  it("fetches a new access token when cached token has <30s remaining (proactive refresh)", async () => {
    await seedRefreshToken("refresh-token-pqr");
    invokeMock.mockReset();

    // Seed an about-to-expire access token directly via the first fetch
    const nearExpiryAt = new Date(Date.now() + 20 * 1000); // only 20s left — within 30s slack
    const freshExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(makeIssueResponse("at_nearexpiry", nearExpiryAt), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(makeIssueResponse("at_freshtoken", freshExpiresAt), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    // First call — populates cache with near-expiry token
    const first = await ensureAccessToken();
    expect(first).toBe("at_nearexpiry");

    // Second call — detects <30s slack, issues a new one
    const second = await ensureAccessToken();
    expect(second).toBe("at_freshtoken");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
  });

  it("concurrent calls to ensureAccessToken coalesce into a single HTTP request", async () => {
    await seedRefreshToken("refresh-token-concurrent");
    invokeMock.mockReset();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    let resolveResponse!: (value: Response) => void;
    const blockedResponse = new Promise<Response>((r) => { resolveResponse = r; });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(blockedResponse);

    // Launch 5 concurrent calls — all should coalesce onto the same in-flight promise
    const calls = [
      ensureAccessToken(),
      ensureAccessToken(),
      ensureAccessToken(),
      ensureAccessToken(),
      ensureAccessToken(),
    ];

    // Resolve the single in-flight fetch
    resolveResponse(
      new Response(makeIssueResponse("at_coalesced", expiresAt), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const results = await Promise.all(calls);

    // All calls return the same token
    expect(results.every((r) => r === "at_coalesced")).toBe(true);
    // fetch was called exactly once
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it("returns null when the server returns an error response (refresh client failed)", async () => {
    await seedRefreshToken("refresh-token-bad");
    invokeMock.mockReset();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await ensureAccessToken();

    expect(result).toBeNull();
    // getTokenSync should still be null after failure
    expect(getTokenSync()).toBeNull();

    fetchSpy.mockRestore();
  });

  it("returns null when fetch throws a network error (graceful degradation)", async () => {
    await seedRefreshToken("refresh-token-neterr");
    invokeMock.mockReset();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("network error"),
    );

    const result = await ensureAccessToken();

    expect(result).toBeNull();

    fetchSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getTokenSync — returns access token (not refresh token) on desktop
// ─────────────────────────────────────────────────────────────────────────

describe("desktop-session — getTokenSync returns access token on desktop", () => {
  it("returns null before any access token has been issued", async () => {
    isDesktopMock.mockReturnValue(true);
    expect(getTokenSync()).toBeNull();
  });

  it("returns the cached access token once ensureAccessToken has been called", async () => {
    await seedRefreshToken("refresh-for-sync-test");
    invokeMock.mockReset();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(makeIssueResponse("at_sync_test", expiresAt), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await ensureAccessToken();
    // getTokenSync now returns the access token, not the refresh token
    expect(getTokenSync()).toBe("at_sync_test");

    fetchSpy.mockRestore();
  });

  it("returns null after clearDesktopToken (access + refresh both wiped)", async () => {
    await seedRefreshToken("refresh-for-clear-test");
    invokeMock.mockReset();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(makeIssueResponse("at_to_be_cleared", expiresAt), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await ensureAccessToken();
    expect(getTokenSync()).toBe("at_to_be_cleared");

    // Clear — simulates logout
    invokeMock.mockResolvedValueOnce(undefined); // for clear_session_token
    await clearDesktopToken();

    expect(getTokenSync()).toBeNull();
    expect(hasCachedToken()).toBe(false);

    fetchSpy.mockRestore();
  });

  it("returns null when the cached access token has passed its expiresAt (stale entry not served)", async () => {
    // Stale-access-token invariant: even if `cachedAccess` still holds a
    // token, `getTokenSync` must return null once wall-clock time is past
    // `expiresAt`. Otherwise a tab that sat idle through the 15-min TTL
    // would keep presenting an expired `at_*` Bearer that the server has
    // already stopped honouring, leading to silent 401s on every request.
    await seedRefreshToken("refresh-for-expiry-test");
    invokeMock.mockReset();

    // Issue a token that is already effectively expired (1ms in the past
    // by the time getTokenSync reads it). The server would have signed a
    // token with this `expiresAt`, and the client must detect it locally.
    const expiresAt = new Date(Date.now() - 1);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(makeIssueResponse("at_already_expired", expiresAt), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await ensureAccessToken();

    // `cachedAccess` is populated, but Date.now() >= expiresAt → getTokenSync
    // must fall through the `if` guard and return null.
    expect(getTokenSync()).toBeNull();

    fetchSpy.mockRestore();
  });
});
