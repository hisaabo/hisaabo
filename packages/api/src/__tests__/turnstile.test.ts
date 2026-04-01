/**
 * Tests for verifyTurnstile in lib/turnstile.ts.
 *
 * WHY THIS FILE EXISTS:
 * verifyTurnstile is the only server-side gatekeeper against bot sign-ups on
 * the public registration and magic-link endpoints. Two failure modes have
 * serious consequences:
 *
 * 1. FALSE PASS in production — if the function returns true when it should
 *    return false (e.g. missing key in prod silently allows all bots through),
 *    the rate-limit and bot-protection layer is completely bypassed.
 *
 * 2. FALSE BLOCK in dev/self-hosted — if the function returns false when no
 *    key is configured in a non-production environment, every developer and
 *    self-hosted operator would be locked out of their own instance without
 *    a clear error message.
 *
 * These tests pin both behaviours. Additionally they verify the exact request
 * body sent to the Cloudflare siteverify API so a refactor cannot silently
 * omit the secret or the response token.
 *
 * APPROACH:
 * verifyTurnstile IS exported — it is imported directly.
 * global.fetch is stubbed via vi.stubGlobal. process.env.TURNSTILE_SECRET_KEY
 * is managed per-test: set before calling, deleted in afterEach.
 * NODE_ENV is also managed per-test for the production-key-missing branch.
 *
 * SOURCE REFERENCE:
 *   packages/api/src/lib/turnstile.ts  lines 9-30
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTurnstile } from "../lib/turnstile";

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal successful Cloudflare siteverify response. */
function cfResponse(success: boolean): Response {
  return new Response(JSON.stringify({ success }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// =============================================================================
// Environment teardown
//
// We mutate process.env in several tests. Always clean up after each test so
// state does not bleed into the next test.
// =============================================================================

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  // Restore NODE_ENV to "test" (the Vitest default)
  process.env.NODE_ENV = "test";
  vi.unstubAllGlobals();
});

// =============================================================================
// Section 1: Key-absent behaviour — dev vs production divergence
//
// This is the most operationally critical divergence in the function.
// Self-hosted operators who haven't configured Cloudflare should be able
// to sign in. Production deployments without the key must be blocked to
// prevent the operator from accidentally shipping an open door.
// =============================================================================

describe("verifyTurnstile — key-absent behaviour differs between dev and production", () => {
  it("returns true in non-production when TURNSTILE_SECRET_KEY is not set", async () => {
    /**
     * Developers running the API locally have no Cloudflare Turnstile key.
     * Self-hosted operators who do not want bot protection simply omit the
     * env var. Both groups must be able to log in — returning false here
     * would lock them out.
     *
     * NODE_ENV defaults to "test" in Vitest, which is != "production".
     */
    delete process.env.TURNSTILE_SECRET_KEY;
    // Fetch should NOT be called — stub it to fail loudly if it is
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch must not be called when key is absent")));

    const result = await verifyTurnstile("any-token", null);
    expect(result).toBe(true);
  });

  it("returns false in production when TURNSTILE_SECRET_KEY is not set", async () => {
    /**
     * A production deployment without a Turnstile key is a misconfiguration.
     * The function must refuse to pass tokens through in production so that
     * the operator is forced to investigate rather than running with bots
     * silently bypassing the check.
     */
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch must not be called")));

    const result = await verifyTurnstile("any-token", null);
    expect(result).toBe(false);
  });

  it("does not call fetch when the key is absent (dev path)", async () => {
    /**
     * No network call should be made when the early-return path triggers.
     * Making an HTTP call without a secret would expose the token to
     * Cloudflare's API with an invalid request — wasting quota and leaking
     * the token value unnecessarily.
     */
    delete process.env.TURNSTILE_SECRET_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("some-token", null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call fetch when the key is absent (production path)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.NODE_ENV = "production";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("some-token", null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Section 2: Successful and failed Cloudflare verification
//
// When the key is present the function must make a real HTTP call to
// Cloudflare and faithfully return the `success` field from the response.
// No local logic should override what Cloudflare says.
// =============================================================================

describe("verifyTurnstile — Cloudflare response drives the return value", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key-27";
  });

  it("returns true when Cloudflare responds with success: true", async () => {
    /**
     * The happy path: a real human filled in the CAPTCHA widget and the
     * token is valid. The function must pass the request through.
     */
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cfResponse(true)));

    const result = await verifyTurnstile("valid-turnstile-token", "203.0.113.42");
    expect(result).toBe(true);
  });

  it("returns false when Cloudflare responds with success: false", async () => {
    /**
     * The token is invalid — expired, already used, or forged by a bot.
     * Returning false causes the caller to reject the request (400/403).
     */
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cfResponse(false)));

    const result = await verifyTurnstile("expired-or-bot-token", "198.51.100.7");
    expect(result).toBe(false);
  });
});

// =============================================================================
// Section 3: Correct request body sent to Cloudflare
//
// The siteverify API requires three fields: secret, response (the token),
// and optionally remoteip. Sending the wrong field names or omitting the
// secret would cause Cloudflare to return success:false for all requests,
// effectively disabling sign-in for all users in production.
// =============================================================================

describe("verifyTurnstile — request body sent to Cloudflare siteverify API", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "cf-secret-key-for-hisaabo";
  });

  it("sends the secret key in the request body", async () => {
    /**
     * The siteverify API authenticates the caller via the secret key in the
     * POST body (not in headers). Without it, Cloudflare returns an error.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("user-token", null);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.secret).toBe("cf-secret-key-for-hisaabo");
  });

  it("sends the Turnstile token as 'response' field in the request body", async () => {
    /**
     * Cloudflare's field name for the client-side token is "response", not
     * "token". Sending it under the wrong key means Cloudflare cannot find
     * the token and returns success:false for all legitimate users.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("the-client-token-0xABCDEF", null);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response).toBe("the-client-token-0xABCDEF");
  });

  it("sends a POST request to the Cloudflare siteverify endpoint URL", async () => {
    /**
     * The exact URL is https://challenges.cloudflare.com/turnstile/v0/siteverify.
     * A typo in the URL or use of a v1 endpoint path would silently fail
     * all verifications.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("some-token", null);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends Content-Type: application/json header", async () => {
    /**
     * Without the correct Content-Type header Cloudflare may reject or
     * misparse the JSON body.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("token", null);

    const options = fetchMock.mock.calls[0][1];
    expect(options.headers["Content-Type"]).toBe("application/json");
  });
});

// =============================================================================
// Section 4: IP parameter handling
//
// The remoteip field is optional but valuable — it lets Cloudflare cross-
// check the token against the IP that originally solved the CAPTCHA. If the
// IP is null (e.g. behind a proxy with no forwarded-for header), the field
// must be omitted rather than sent as null, because Cloudflare rejects
// null values for this field.
// =============================================================================

describe("verifyTurnstile — IP parameter handling in request body", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "secret-ip-test";
  });

  it("includes remoteip in the body when a non-null IP is provided", async () => {
    /**
     * When the client IP is available (read from x-forwarded-for or
     * cf-connecting-ip headers), it must be forwarded to Cloudflare.
     * This improves bot detection accuracy.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("token", "103.21.244.0");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.remoteip).toBe("103.21.244.0");
  });

  it("omits remoteip (sets to undefined) when IP is null", async () => {
    /**
     * The function uses `ip || undefined` which coerces null → undefined.
     * JSON.stringify drops keys with value undefined, so the key must not
     * appear in the serialised body at all.
     *
     * Cloudflare treats an explicit null remoteip as invalid input on some
     * API versions — omitting it is safer than sending null.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTurnstile("token", null);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("remoteip");
  });

  it("omits remoteip when IP is an empty string", async () => {
    /**
     * An empty string is falsy in JS. The `ip || undefined` expression
     * coerces "" → undefined, which is then dropped by JSON.stringify.
     * This handles the edge case of a misconfigured reverse proxy that
     * sets an empty forwarded-for header.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    // TypeScript signature is `ip: string | null` but we exercise the
    // empty-string coercion by casting — this is a runtime edge case.
    await verifyTurnstile("token", "" as unknown as null);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("remoteip");
  });

  it("uses the IP verbatim — no normalisation applied", async () => {
    /**
     * IPv6 addresses should not be normalised, truncated, or converted.
     * They must be forwarded exactly as received from the request headers.
     */
    const fetchMock = vi.fn().mockResolvedValue(cfResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const ipv6 = "2001:db8::1";
    await verifyTurnstile("token", ipv6);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.remoteip).toBe(ipv6);
  });
});
