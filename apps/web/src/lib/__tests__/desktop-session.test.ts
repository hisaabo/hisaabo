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
  it("populates the cache from a keychain read so the first tRPC request carries the Bearer header", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce("session-abc-from-keychain");

    await hydrateDesktopSession();

    expect(invokeMock).toHaveBeenCalledWith("get_session_token");
    expect(getTokenSync()).toBe("session-abc-from-keychain");
    expect(hasCachedToken()).toBe(true);
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
  it("updates the synchronous cache before the IPC call resolves so the next request sees the token", async () => {
    isDesktopMock.mockReturnValue(true);
    // Use a promise we control so we can inspect cache state mid-flight.
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    invokeMock.mockReturnValueOnce(blocked as unknown as Promise<void>);

    const savePromise = saveDesktopToken("fresh-token");

    // Before the IPC resolves, the cache MUST already reflect the new token.
    expect(getTokenSync()).toBe("fresh-token");

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

  it("keeps the in-memory token even when the keychain write fails — app stays usable for the current session", async () => {
    isDesktopMock.mockReturnValue(true);
    invokeMock.mockRejectedValueOnce(new Error("keychain locked"));

    await saveDesktopToken("keychain-failed-token");

    expect(getTokenSync()).toBe("keychain-failed-token");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// clearDesktopToken
// ─────────────────────────────────────────────────────────────────────────
describe("desktop-session — clearDesktopToken", () => {
  it("empties the cache before the IPC delete resolves so no subsequent request carries the stale token", async () => {
    isDesktopMock.mockReturnValue(true);

    // Seed a token first.
    invokeMock.mockResolvedValueOnce(undefined);
    await saveDesktopToken("to-be-cleared");
    expect(getTokenSync()).toBe("to-be-cleared");

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
