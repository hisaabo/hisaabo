/**
 * Tests for `src/lib/api-url.ts` — API URL resolution
 *
 * WHY these tests matter for contributors:
 * getApiUrl() is called by the tRPC client on startup. It controls which
 * server the entire app talks to. A mistake here means:
 *   - Dev builds silently point to production (real merchant data gets mutated)
 *   - Production builds silently point to localhost (app shows empty screens
 *     with no error message for every real user)
 *   - CI builds fail to connect to the test API server
 *
 * The function has two resolution strategies (in order of priority):
 *   1. expo-constants `expoConfig.extra.apiUrl` — set in app.json/eas.json
 *   2. process.env.EXPO_PUBLIC_API_URL — set in .env or CI pipeline
 *   3. Fallback: the hardcoded production URL "https://api.hisaabo.in"
 *
 * These tests verify that priority ordering is respected.
 *
 * Implementation note on testing strategy:
 * getApiUrl() reads both expo-constants and process.env at CALL TIME (not
 * at module evaluation time). This means we can control the env var via
 * process.env mutation per-test. For expo-constants, we use a mutable object
 * reference that the mock returns — mutations to `mockConstants.expoConfig`
 * propagate into the imported module because both share the same reference.
 */

// ---------------------------------------------------------------------------
// We create a mutable object that the mock exposes. Mutating
// `mockConstantsDefault.expoConfig` in tests is reflected in the module
// because the mock factory captures a reference, not a value snapshot.
// ---------------------------------------------------------------------------
const mockConstantsDefault: { expoConfig: null | Record<string, any> } = {
  expoConfig: null,
};

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: mockConstantsDefault,
}));

import { getApiUrl } from "../api-url";

const originalEnv = process.env;

beforeEach(() => {
  // Fresh copy of env — mutations in one test don't bleed into the next
  process.env = { ...originalEnv };
  delete (process.env as any).EXPO_PUBLIC_API_URL;
  // Reset constants mock to "no app.json extra" state
  mockConstantsDefault.expoConfig = null;
});

afterAll(() => {
  process.env = originalEnv;
});

// ---------------------------------------------------------------------------
describe("getApiUrl — API URL resolution for different build environments", () => {
  // -------------------------------------------------------------------------
  it("returns the hardcoded production URL when no env vars are set", () => {
    // WHAT: Neither expo-constants nor EXPO_PUBLIC_API_URL is set — this is
    //       the state for a vanilla production build distributed via the
    //       Play Store / App Store.
    // WHY: If the fallback URL is wrong or missing, every production user
    //      gets network errors on every screen. The production URL is
    //      "https://api.hisaabo.in" — this test pins that exact value so a
    //      typo in the source file is caught by CI before release.
    // PRECONDITION: process.env.EXPO_PUBLIC_API_URL is deleted in beforeEach
    //               and mockConstantsDefault.expoConfig is null.

    const url = getApiUrl();

    expect(url).toBe("https://api.hisaabo.in");
  });

  // -------------------------------------------------------------------------
  it("returns EXPO_PUBLIC_API_URL when set, ignoring the production fallback", () => {
    // WHAT: Dev or staging build — engineer sets EXPO_PUBLIC_API_URL in .env
    //       to point to their local or staging API server.
    // WHY: If process.env is not read, every developer's build hits production
    //      regardless of their .env file, making local development impossible
    //      (every mutation, invoice creation, and login affects real customers).
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.42:3000";

    const url = getApiUrl();

    expect(url).toBe("http://192.168.1.42:3000");
  });

  // -------------------------------------------------------------------------
  it("returns expo-constants apiUrl over EXPO_PUBLIC_API_URL (highest priority)", () => {
    // WHAT: When app.json `extra.apiUrl` is set (e.g. in an EAS build profile),
    //       it takes priority over both the env var and the hardcoded fallback.
    // WHY: EAS build profiles use expo-constants to inject environment-specific
    //      configuration at build time. This is the recommended EAS pattern for
    //      Expo apps. If this priority is reversed, an EAS production build
    //      could point to a staging server, or vice versa.
    process.env.EXPO_PUBLIC_API_URL = "http://env-var-api:3000";
    mockConstantsDefault.expoConfig = {
      extra: { apiUrl: "https://api-staging.hisaabo.in" },
    };

    const url = getApiUrl();

    expect(url).toBe("https://api-staging.hisaabo.in");
  });

  // -------------------------------------------------------------------------
  it("falls back to EXPO_PUBLIC_API_URL when expoConfig exists but has no apiUrl field", () => {
    // WHAT: app.json has an `extra` section but it does not include `apiUrl`
    //       (common when app.json has other extra fields like `eas.projectId`).
    // WHY: Accessing a missing field returns `undefined`. The function must
    //      fall through to the env var in this case rather than returning
    //      `undefined` as the URL (which would cause every fetch to fail with
    //      a "Invalid URL" error on startup).
    process.env.EXPO_PUBLIC_API_URL = "http://fallback-to-env:3000";
    mockConstantsDefault.expoConfig = {
      extra: { someOtherField: "value" }, // no apiUrl
    };

    const url = getApiUrl();

    expect(url).toBe("http://fallback-to-env:3000");
  });

  // -------------------------------------------------------------------------
  it("falls back to production URL when expoConfig.extra is null", () => {
    // WHAT: expoConfig exists but `extra` is null or undefined — an unusual
    //       but valid Expo configuration state.
    // WHY: Guards against a `Cannot read properties of null` TypeError when
    //      accessing `expoConfig.extra.apiUrl` with a null `extra`.
    delete (process.env as any).EXPO_PUBLIC_API_URL;
    mockConstantsDefault.expoConfig = { extra: null };

    // Should not throw — should fall through to the production URL
    const url = getApiUrl();

    expect(url).toBe("https://api.hisaabo.in");
  });

  // -------------------------------------------------------------------------
  it("returns the dev:android LAN URL when EXPO_PUBLIC_API_URL is set to a local IP", () => {
    // WHAT: The `dev:android` script sets EXPO_PUBLIC_API_URL to the host
    //       machine's LAN IP so the Android emulator can reach the API.
    //       (See the `dev:android` script in package.json.)
    // WHY: This is the daily developer workflow. If the env var is stripped
    //      or ignored, every Android developer must hardcode their IP in the
    //      source — defeating the purpose of the script entirely.
    process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:3000";

    const url = getApiUrl();

    expect(url).toBe("http://10.0.2.2:3000");
  });
});
