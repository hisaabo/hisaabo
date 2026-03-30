/**
 * Tests for the auth Zustand store (`src/stores/auth.ts`)
 *
 * WHY these tests matter for contributors:
 * The auth store is the first thing executed on every app launch. It holds the
 * session token that gates every tRPC call and every protected screen. A bug
 * here means users are silently logged out, or — far worse — a stale token
 * from a previous user leaks into a new session.
 *
 * The store deliberately keeps an in-memory cache (`cachedToken` in lib/auth)
 * so the tRPC link can read the token synchronously without hitting
 * SecureStore on every request. These tests verify that the cache and the
 * persistent store always stay in sync.
 *
 * Coverage checklist:
 *   - Initial state before hydration
 *   - hydrate() reads from SecureStore and updates both flag and token
 *   - login() writes to SecureStore and caches in memory
 *   - logout() removes from SecureStore and clears memory cache
 *   - getTokenSync() returns the in-memory value (no async I/O)
 *   - Resilience: SecureStore failures do not crash the app
 */

import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// Mock the entire expo-secure-store module.
// All exported functions become jest.fn() so we can control return values and
// assert call counts without touching any real device storage.
// ---------------------------------------------------------------------------
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;
const mockDelete = SecureStore.deleteItemAsync as jest.Mock;

// ---------------------------------------------------------------------------
// lib/auth.ts has a module-level `cachedToken` variable. Because Jest caches
// modules, this persists between tests. We reset it by re-importing the
// module fresh in beforeEach using jest.resetModules().
//
// We re-import everything inside beforeEach so each test starts with a clean
// module state. The variables below are reassigned each time.
// ---------------------------------------------------------------------------
let useAuthStore: typeof import("../auth").useAuthStore;
let getTokenSync: typeof import("../../lib/auth").getTokenSync;

// Reset store state AND SecureStore mocks before each test so tests are
// isolated — crucial because Zustand stores are module-level singletons and
// lib/auth.ts has a module-level cachedToken cache.
beforeEach(() => {
  jest.resetModules();
  // Re-apply the mock after resetModules clears the module registry
  jest.mock("expo-secure-store", () => ({
    getItemAsync: mockGet,
    setItemAsync: mockSet,
    deleteItemAsync: mockDelete,
  }));
  mockGet.mockReset();
  mockSet.mockReset();
  mockDelete.mockReset();

  // Fresh imports — module-level cachedToken is reset to null
  useAuthStore = require("../auth").useAuthStore;
  getTokenSync = require("../../lib/auth").getTokenSync;

  // Reset the store to its pristine initial state
  useAuthStore.setState({ token: null, isHydrated: false });
});

// ---------------------------------------------------------------------------
describe("auth store — session token management", () => {
  // -------------------------------------------------------------------------
  it("starts with null token and isHydrated: false before hydrate() is called", () => {
    // WHAT: Verify the literal initial state values that ship in the store.
    // WHY: If these defaults change, screens that check `isHydrated` before
    //      rendering will flash incorrectly, causing layout jank on every
    //      cold start. Any PR touching default state must update this test.
    const { token, isHydrated } = useAuthStore.getState();

    expect(token).toBeNull();
    expect(isHydrated).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("hydrate() reads the token from SecureStore and sets isHydrated: true", async () => {
    // WHAT: Simulate a returning user whose token was persisted from a previous
    //       session. hydrate() should surface that token and flip isHydrated.
    // WHY: The root layout calls hydrate() once on startup (inside the
    //      `prepare` effect). If hydrate() silently returns without setting
    //      the token, every user lands on the login screen on every restart —
    //      a critical regression that would tank the app's store rating.
    const STORED_TOKEN = "sess_abc123_india_merchant";
    mockGet.mockResolvedValue(STORED_TOKEN);

    await useAuthStore.getState().hydrate();

    const { token, isHydrated } = useAuthStore.getState();
    expect(token).toBe(STORED_TOKEN);
    expect(isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() sets token to null and isHydrated: true when SecureStore is empty (first install)", async () => {
    // WHAT: First-time install — SecureStore has no token yet.
    // WHY: hydrate() must still flip isHydrated to true so the root layout can
    //      transition to the login gate. If it waits forever for a token that
    //      will never arrive, the splash screen hangs permanently.
    mockGet.mockResolvedValue(null);

    await useAuthStore.getState().hydrate();

    const { token, isHydrated } = useAuthStore.getState();
    expect(token).toBeNull();
    expect(isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() uses the in-memory cache on the second call (does not hit SecureStore again)", async () => {
    // WHAT: getToken() in lib/auth caches the token so repeat reads are free.
    //       After the first hydrate(), subsequent calls should not cause
    //       additional SecureStore I/O.
    // WHY: In React strict-mode / dev, effects fire twice. If hydrate() fired
    //      two SecureStore reads per app launch, that would double the I/O
    //      budget and cause subtle timing races on slower devices.
    const STORED_TOKEN = "sess_cached_token";
    mockGet.mockResolvedValue(STORED_TOKEN);

    await useAuthStore.getState().hydrate(); // first call — hits SecureStore
    await useAuthStore.getState().hydrate(); // second call — should use cache

    // getItemAsync should only be called once because the second call returns
    // the cached value without going to SecureStore.
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  it("login() saves the token to SecureStore and updates in-memory state", async () => {
    // WHAT: When the user submits their credentials and the API returns a token,
    //       login() must persist that token so it survives an app restart AND
    //       make it immediately available in memory for the same session.
    // WHY: If SecureStore.setItemAsync is not called, the token is lost on next
    //      cold start. If the in-memory state is not updated, the tRPC link
    //      sends unauthenticated requests for the rest of the current session.
    const NEW_TOKEN = "sess_new_session_razorpay_merchant";
    mockSet.mockResolvedValue(undefined);

    await useAuthStore.getState().login(NEW_TOKEN);

    // In-memory state must be updated immediately
    expect(useAuthStore.getState().token).toBe(NEW_TOKEN);

    // The token must be persisted to SecureStore with the correct key
    expect(mockSet).toHaveBeenCalledWith("hisaabo_session_token", NEW_TOKEN);
  });

  // -------------------------------------------------------------------------
  it("login() makes the token available via getTokenSync() for synchronous tRPC reads", async () => {
    // WHAT: The tRPC HTTP link reads the token synchronously (via getTokenSync)
    //       inside its `headers` callback. After login(), that synchronous read
    //       must return the new token without awaiting any SecureStore call.
    // WHY: If getTokenSync() returns null after login(), every API call for the
    //      rest of the session will be unauthorised, silently breaking all data
    //      fetching on the home screen immediately after sign-in.
    const TOKEN = "sess_sync_read_test";
    mockSet.mockResolvedValue(undefined);

    await useAuthStore.getState().login(TOKEN);

    expect(getTokenSync()).toBe(TOKEN);
  });

  // -------------------------------------------------------------------------
  it("logout() clears the token from SecureStore and sets state to null", async () => {
    // WHAT: Full sign-out flow — token must be removed from both the in-memory
    //       store and persistent SecureStore so the next launch sends the user
    //       to the login screen.
    // WHY: If only one of the two is cleared, users either see a blank login
    //      screen that auto-logs them back in, or they are stuck with a stale
    //      token that causes 401 errors on every API call.
    useAuthStore.setState({ token: "sess_to_clear", isHydrated: true });
    mockDelete.mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith("hisaabo_session_token");
  });

  // -------------------------------------------------------------------------
  it("getTokenSync() returns the cached in-memory token without async I/O", async () => {
    // WHAT: Validate that lib/auth's module-level `cachedToken` variable is
    //       populated when a token exists and returned synchronously.
    // WHY: The tRPC headers callback is synchronous — it cannot await. If
    //      getTokenSync() always returns null, the API is permanently broken.
    const TOKEN = "sess_synchronous_check";
    mockSet.mockResolvedValue(undefined);
    await useAuthStore.getState().login(TOKEN);

    // No async operations here — must return inline
    const result = getTokenSync();
    expect(result).toBe(TOKEN);
    // Confirm SecureStore was not called again (no additional async reads)
    expect(mockGet).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("hydrate() is resilient when SecureStore.getItemAsync throws (e.g. device locked)", async () => {
    // WHAT: On some Android devices, SecureStore can throw if the keystore is
    //       unavailable (e.g. after a failed biometric enrollment or factory
    //       reset protection). hydrate() must not crash the app in that case.
    // WHY: An unhandled promise rejection from hydrate() would leave
    //      isHydrated as false permanently, locking the user out of their own
    //      data with no visible error message.
    mockGet.mockRejectedValue(new Error("KeyStore unavailable"));

    // Should not throw
    await expect(useAuthStore.getState().hydrate()).resolves.not.toThrow();

    // isHydrated must still be set to true so the app can proceed to login
    expect(useAuthStore.getState().isHydrated).toBe(true);
  });
});
