/**
 * trpc-headers.test.ts — Regression test for the mobile tRPC client's
 * outbound header posture.
 *
 * WHY THIS FILE EXISTS:
 * The Android app hit an "Unable to transform response from server"
 * error on `auth.sendMagicLink` because:
 *
 *   1. After a successful magic-link verification the API sets a
 *      `session_id` cookie via Set-Cookie.
 *   2. React Native's native HTTP stack (URLSession / OkHttp) stores
 *      that cookie in a per-app cookie jar and replays it on every
 *      subsequent request — even though the JS tRPC client never sets
 *      cookies itself.
 *   3. The API's CSRF middleware then rejected the replay because
 *      the JS tRPC client did not send `X-Requested-With: hisaabo`,
 *      returning a Hono-shaped `{error: "..."}` body that the tRPC
 *      HTTP link cannot deserialize.
 *
 * The fix (see `src/lib/trpc.ts`) adds `X-Requested-With: hisaabo` to
 * every request unconditionally. This test pins that invariant so a
 * future refactor can't silently drop the header and re-break Android
 * login.
 */

// Mock expo-secure-store so auth.ts doesn't try to touch the native
// keychain during module evaluation.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-constants so api-url.ts can resolve a base URL without a
// real Expo runtime.
jest.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { apiUrl: "http://localhost:3000" } } },
}));

// Mock @trpc/* and superjson so the test does not need to transform
// their ESM-only transitive deps (copy-anything, is-what, etc.) that
// sit outside the jest `transformIgnorePatterns` allowlist. We only
// exercise the `commonOptions().headers()` function, which never
// touches these modules at runtime — they are only imported at module
// scope for other exports.
jest.mock("@trpc/react-query", () => ({
  createTRPCReact: () => ({ createClient: jest.fn() }),
}));

jest.mock("@trpc/client", () => ({
  createTRPCClient: jest.fn(),
  httpBatchLink: jest.fn(),
  splitLink: jest.fn(),
  httpLink: jest.fn(),
}));

jest.mock("superjson", () => ({
  default: { serialize: jest.fn(), deserialize: jest.fn() },
  serialize: jest.fn(),
  deserialize: jest.fn(),
}));

describe("mobile tRPC client header posture — CSRF sentinel", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("mobile tRPC client always sends X-Requested-With: hisaabo so the API's CSRF middleware does not reject POSTs carrying stale native-cookie-jar session cookies", () => {
    const { commonOptions } = require("../lib/trpc");
    const options = commonOptions();
    const headers = options.headers();

    expect(headers["X-Requested-With"]).toBe("hisaabo");
  });

  it("mobile tRPC client sends X-Requested-With even when no auth token is cached — the first anonymous call (auth.sendMagicLink) must pass the CSRF gate, which is exactly the call that was failing on Android", () => {
    // No token set in auth module cache → simulates a fresh install.
    const { commonOptions } = require("../lib/trpc");
    const headers = commonOptions().headers();

    expect(headers["X-Requested-With"]).toBe("hisaabo");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("mobile tRPC client still sends Authorization: Bearer alongside X-Requested-With when a token is cached — both headers must coexist so Bearer auth works AND the CSRF gate is satisfied", async () => {
    const auth = require("../lib/auth");
    await auth.setToken("test-session-token-123");

    const { commonOptions } = require("../lib/trpc");
    const headers = commonOptions().headers();

    expect(headers["X-Requested-With"]).toBe("hisaabo");
    expect(headers["Authorization"]).toBe("Bearer test-session-token-123");
  });

  it("mobile tRPC client still sends x-business-id alongside X-Requested-With when a business is selected — multi-business header must not be dropped by the CSRF fix", () => {
    const { useBusinessStore } = require("../stores/business");
    useBusinessStore.setState({
      businessId: "biz-abc-123",
      businessName: "Test Biz",
      isHydrated: true,
    });

    const { commonOptions } = require("../lib/trpc");
    const headers = commonOptions().headers();

    expect(headers["X-Requested-With"]).toBe("hisaabo");
    expect(headers["x-business-id"]).toBe("biz-abc-123");
  });
});
