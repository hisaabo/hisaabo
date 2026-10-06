/**
 * Tests for the biometric Zustand store (`src/stores/biometric.ts`)
 *
 * WHY these tests matter for contributors:
 * Hisaabo stores confidential GST data, bank account details, and party
 * (customer/supplier) financials. The biometric/PIN lock is the user-facing
 * security layer that prevents anyone who picks up an unlocked phone from
 * instantly accessing sensitive business data.
 *
 * Important architectural note from the source file:
 *   "Simple hash for PIN (local UX lock only, not a security boundary).
 *    The real auth is the session token in SecureStore."
 * This means the PIN is a convenience feature, NOT cryptographic security.
 * The hash used is a simple djb2 variant — never upgrade it to bcrypt here
 * without updating the stored hashes migration path. These tests pin the
 * current behaviour so that upgrade is a conscious, deliberate change.
 *
 * Coverage checklist:
 *   - Initial state defaults
 *   - hydrate() reads biometric + PIN + setupPrompted flags from SecureStore
 *   - hydrate() sets isLocked when either biometric or PIN is enabled
 *   - hydrate() leaves isLocked false when neither is enabled
 *   - enableBiometric() writes "1" to SecureStore and updates state
 *   - disableBiometric() deletes from SecureStore and updates state
 *   - setPin() hashes the PIN (never stores plaintext) and sets pinEnabled
 *   - verifyPin() returns true for the correct PIN
 *   - verifyPin() returns false for the wrong PIN
 *   - verifyPin() returns false when no PIN is stored yet
 *   - lock() only locks when biometric or PIN is active (no-op otherwise)
 *   - unlock() always unlocks regardless of biometric/PIN state
 *   - markSetupPrompted() stores the flag and prevents repeated prompting
 *   - checkHardware() returns { available: false } when hardware is absent
 *   - authenticate() returns false when LocalAuthentication fails
 */

import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { useBiometricStore } from "../biometric";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock("../auth", () => ({
  useAuthStore: { getState: () => ({ logout: mockLogout }) },
}));

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;
const mockDelete = SecureStore.deleteItemAsync as jest.Mock;
const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const mockSupportedTypes =
  LocalAuthentication.supportedAuthenticationTypesAsync as jest.Mock;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers: reproduce the same hash function used in biometric.ts so we can
// generate expected stored values in tests without importing a private symbol.
// If the hash algorithm changes in production, this test helper MUST be
// updated in the same PR — CI will catch the discrepancy automatically.
// ---------------------------------------------------------------------------
function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // to 32-bit integer
  }
  return String(hash);
}

// Key-addressed in-memory SecureStore for the PIN hashing / lockout tests.
function useFakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  mockGet.mockImplementation(async (k: string) => data.get(k) ?? null);
  mockSet.mockImplementation(async (k: string, v: string) => { data.set(k, v); });
  mockDelete.mockImplementation(async (k: string) => { data.delete(k); });
  return data;
}

const BIOMETRIC_ENABLED_KEY = "hisaabo_biometric_enabled";
const PIN_HASH_KEY = "hisaabo_pin_hash";
const SETUP_PROMPTED_KEY = "hisaabo_setup_prompted";

// Reset store + mocks before every test
beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset();
  mockDelete.mockReset();
  mockHasHardware.mockReset();
  mockIsEnrolled.mockReset();
  mockSupportedTypes.mockReset();
  mockAuthenticate.mockReset();

  useBiometricStore.setState({
    biometricEnabled: false,
    pinEnabled: false,
    isLocked: false,
    isHydrated: false,
    setupPrompted: false,
    pinLockedUntil: 0,
  });
  mockLogout.mockClear();
});

// ---------------------------------------------------------------------------
describe("biometric store — fingerprint/PIN lock management", () => {
  // -------------------------------------------------------------------------
  it("starts fully unlocked and unenrolled before hydrate() is called", () => {
    // WHAT: Verify that the store's zero state does not accidentally lock new
    //       installs before any lock has been configured by the user.
    // WHY: If isLocked defaults to true, a first-time user is immediately
    //      presented with a lock screen they cannot pass through because no
    //      biometric or PIN has been configured yet — an unrecoverable state
    //      unless they uninstall the app.
    const { biometricEnabled, pinEnabled, isLocked, isHydrated, setupPrompted } =
      useBiometricStore.getState();

    expect(biometricEnabled).toBe(false);
    expect(pinEnabled).toBe(false);
    expect(isLocked).toBe(false);
    expect(isHydrated).toBe(false);
    expect(setupPrompted).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("hydrate() reads all three flags from SecureStore in a single parallel batch", async () => {
    // WHAT: hydrate() calls Promise.all([biometric, pin, prompted]) — verify
    //       that all three SecureStore keys are read during one hydration.
    // WHY: If one of the three reads is missing, the store may decide the user
    //      has no PIN when they do, unlocking the app incorrectly. This is a
    //      security regression test.
    mockGet
      .mockResolvedValueOnce("1")    // BIOMETRIC_ENABLED_KEY
      .mockResolvedValueOnce(null)   // PIN_HASH_KEY (no pin)
      .mockResolvedValueOnce(null);  // SETUP_PROMPTED_KEY

    await useBiometricStore.getState().hydrate();

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(mockGet).toHaveBeenCalledWith(BIOMETRIC_ENABLED_KEY);
    expect(mockGet).toHaveBeenCalledWith(PIN_HASH_KEY);
    expect(mockGet).toHaveBeenCalledWith(SETUP_PROMPTED_KEY);
  });

  // -------------------------------------------------------------------------
  it("hydrate() sets isLocked: true and biometricEnabled: true when biometric was enabled", async () => {
    // WHAT: Simulate a returning user who enabled Face ID on their iPhone.
    //       After restarting the app, they should see the lock screen.
    // WHY: The lock screen is the first security gate. If isLocked stays false
    //      after hydration for a user with biometric enabled, anyone who has
    //      the phone can access all invoices and party financials without
    //      authenticating.
    mockGet
      .mockResolvedValueOnce("1")   // biometric = on
      .mockResolvedValueOnce(null)  // no PIN
      .mockResolvedValueOnce(null); // not prompted

    await useBiometricStore.getState().hydrate();

    const { biometricEnabled, pinEnabled, isLocked, isHydrated } =
      useBiometricStore.getState();

    expect(biometricEnabled).toBe(true);
    expect(pinEnabled).toBe(false);
    expect(isLocked).toBe(true);
    expect(isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() sets isLocked: true and pinEnabled: true when a PIN hash is stored", async () => {
    // WHAT: User enabled a 4-digit PIN instead of biometrics (older Android
    //       devices without a fingerprint sensor, or users who don't trust
    //       biometrics for privacy reasons).
    // WHY: Same security rationale as above — PIN lock must engage on restart.
    mockGet
      .mockResolvedValueOnce(null)              // biometric = off
      .mockResolvedValueOnce(hashPin("1234"))   // PIN is set
      .mockResolvedValueOnce(null);             // not prompted

    await useBiometricStore.getState().hydrate();

    const { pinEnabled, biometricEnabled, isLocked } =
      useBiometricStore.getState();

    expect(biometricEnabled).toBe(false);
    expect(pinEnabled).toBe(true);
    expect(isLocked).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() leaves isLocked: false when neither biometric nor PIN is enabled", async () => {
    // WHAT: User has never configured any lock — or has disabled them all.
    //       The app should open straight to the home screen after restart.
    // WHY: Unnecessarily locking a user who chose not to use the feature
    //      damages retention and makes Hisaabo feel broken compared to
    //      alternatives like Khatabook that don't force lock screens.
    mockGet
      .mockResolvedValueOnce(null)  // biometric = off
      .mockResolvedValueOnce(null)  // no PIN
      .mockResolvedValueOnce("1");  // setup was already prompted

    await useBiometricStore.getState().hydrate();

    expect(useBiometricStore.getState().isLocked).toBe(false);
    expect(useBiometricStore.getState().setupPrompted).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() sets isHydrated: true and does not throw when SecureStore fails", async () => {
    // WHAT: SecureStore is unavailable at the time of hydration (hardware
    //       fault, Android keystore service down after update, etc.).
    // WHY: This is the catch block inside hydrate() — it must always set
    //      isHydrated so the root layout can proceed. Failing silently is
    //      safer than hanging on the splash screen indefinitely.
    mockGet.mockRejectedValue(new Error("SecureStore unavailable"));

    await expect(useBiometricStore.getState().hydrate()).resolves.not.toThrow();

    expect(useBiometricStore.getState().isHydrated).toBe(true);
    // On failure, lock should be false (safe default — do not lock a user out
    // due to a hardware error they cannot resolve without reinstalling the app)
    expect(useBiometricStore.getState().isLocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("enableBiometric() writes '1' to SecureStore and sets biometricEnabled: true", async () => {
    // WHAT: User opens Settings > Security and turns on biometric lock.
    // WHY: If '1' is not written to SecureStore, biometric is lost on restart.
    //      If the state is not updated in memory, the toggle UI shows the wrong
    //      value and the re-lock logic in the root layout never fires.
    mockSet.mockResolvedValue(undefined);

    await useBiometricStore.getState().enableBiometric();

    expect(useBiometricStore.getState().biometricEnabled).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(BIOMETRIC_ENABLED_KEY, "1");
  });

  // -------------------------------------------------------------------------
  it("disableBiometric() removes the key from SecureStore and sets biometricEnabled: false", async () => {
    // WHAT: User turns off biometric lock in Settings.
    // WHY: If deleteItemAsync is not called, the key persists in SecureStore
    //      and hydrate() re-enables biometric on the next restart, confusing
    //      users who explicitly turned it off.
    useBiometricStore.setState({ biometricEnabled: true });
    mockDelete.mockResolvedValue(undefined);

    await useBiometricStore.getState().disableBiometric();

    expect(useBiometricStore.getState().biometricEnabled).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith(BIOMETRIC_ENABLED_KEY);
  });

  // -------------------------------------------------------------------------
  it("setPin() stores a salted v2 hash of the PIN — never the plaintext digits", async () => {
    // WHY: A 4-digit PIN with an unsalted 32-bit hash is trivially reversible
    //      if the keychain is extracted; a per-install salt + SHA-256 is not.
    const data = useFakeStore();
    const PIN = "9876";

    await useBiometricStore.getState().setPin(PIN);

    const stored = data.get(PIN_HASH_KEY)!;
    expect(stored.startsWith("v2$")).toBe(true);
    expect(stored).not.toContain(PIN);
    expect(stored).not.toBe(hashPin(PIN));
    expect(data.get("hisaabo_pin_salt")).toMatch(/^[0-9a-f]{32}$/);
    expect(useBiometricStore.getState().pinEnabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("verifyPin() accepts the PIN set via setPin() and rejects others", async () => {
    useFakeStore();
    await useBiometricStore.getState().setPin("4321");

    expect(await useBiometricStore.getState().verifyPin("0000")).toBe(false);
    expect(await useBiometricStore.getState().verifyPin("4321")).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("verifyPin() accepts a legacy 32-bit hash once and migrates it to v2", async () => {
    const data = useFakeStore({ [PIN_HASH_KEY]: hashPin("4321") });

    expect(await useBiometricStore.getState().verifyPin("4321")).toBe(true);

    expect(data.get(PIN_HASH_KEY)!.startsWith("v2$")).toBe(true);
    expect(data.has("hisaabo_pin_salt")).toBe(true);
    expect(await useBiometricStore.getState().verifyPin("4321")).toBe(true);
    expect(await useBiometricStore.getState().verifyPin("1111")).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("verifyPin() locks out for 30s after 5 failures and refuses even the right PIN", async () => {
    useFakeStore();
    await useBiometricStore.getState().setPin("4321");

    for (let i = 0; i < 5; i++) {
      expect(await useBiometricStore.getState().verifyPin("0000")).toBe(false);
    }
    const until = useBiometricStore.getState().pinLockedUntil;
    expect(until).toBeGreaterThan(Date.now() + 25_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 30_000);

    expect(await useBiometricStore.getState().verifyPin("4321")).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("failure counter persists across launches and resets after a successful unlock", async () => {
    const data = useFakeStore();
    await useBiometricStore.getState().setPin("4321");

    await useBiometricStore.getState().verifyPin("0000");
    await useBiometricStore.getState().verifyPin("0000");
    expect(data.get("hisaabo_pin_fails")).toBe("2");

    expect(await useBiometricStore.getState().verifyPin("4321")).toBe(true);
    expect(data.has("hisaabo_pin_fails")).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("wipes the PIN, biometric flag and session after 10 failures", async () => {
    const data = useFakeStore({ hisaabo_biometric_enabled: "1" });
    await useBiometricStore.getState().setPin("4321");
    useBiometricStore.setState({ biometricEnabled: true, isLocked: true });

    for (let i = 0; i < 10; i++) {
      // Skip lockout windows between attempts.
      data.delete("hisaabo_pin_lock_until");
      await useBiometricStore.getState().verifyPin("0000");
    }

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(data.has(PIN_HASH_KEY)).toBe(false);
    expect(data.has("hisaabo_biometric_enabled")).toBe(false);
    const state = useBiometricStore.getState();
    expect(state.pinEnabled).toBe(false);
    expect(state.biometricEnabled).toBe(false);
    expect(state.isLocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("verifyPin() returns false when no PIN hash is stored yet (store is empty)", async () => {
    // WHAT: verifyPin() is called before the user has ever set a PIN.
    // WHY: If verifyPin() returns true on an empty store, the app could be
    //      unlocked by submitting any PIN before one has been configured —
    //      a logic vulnerability in the setup flow.
    mockGet.mockResolvedValue(null);

    const result = await useBiometricStore.getState().verifyPin("1234");

    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("verifyPin() returns false when SecureStore.getItemAsync throws", async () => {
    // WHAT: SecureStore fails while trying to read the stored hash.
    // WHY: The function must return false (deny access) on error, never true.
    //      Fail-open for a lock screen is a security regression.
    mockGet.mockRejectedValue(new Error("SecureStore read error"));

    const result = await useBiometricStore.getState().verifyPin("1234");

    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("lock() sets isLocked: true when biometric is enabled", () => {
    // WHAT: The root layout calls lock() when the app transitions to
    //       background for more than RELOCK_THRESHOLD (30s). With biometric
    //       enabled, isLocked must become true.
    // WHY: If lock() is a no-op, returning from background never shows the
    //      lock screen and the user's financial data is exposed to anyone
    //      who picks up the phone.
    useBiometricStore.setState({ biometricEnabled: true, isLocked: false });

    useBiometricStore.getState().lock();

    expect(useBiometricStore.getState().isLocked).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("lock() sets isLocked: true when PIN is enabled (even without biometric)", () => {
    // WHAT: PIN-only lock mode — no biometric hardware or user chose PIN.
    // WHY: Same security rationale as above; both lock modes must engage.
    useBiometricStore.setState({
      pinEnabled: true,
      biometricEnabled: false,
      isLocked: false,
    });

    useBiometricStore.getState().lock();

    expect(useBiometricStore.getState().isLocked).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("lock() is a no-op when neither biometric nor PIN is enabled", () => {
    // WHAT: A user with no lock configured goes to background. lock() should
    //       not change isLocked to true because there is no lock mechanism.
    // WHY: If lock() always sets isLocked regardless of configuration, users
    //      without any lock enabled would see the lock screen on every
    //      app-switch — even though they deliberately chose not to use it.
    useBiometricStore.setState({
      biometricEnabled: false,
      pinEnabled: false,
      isLocked: false,
    });

    useBiometricStore.getState().lock();

    // isLocked must remain false
    expect(useBiometricStore.getState().isLocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("unlock() sets isLocked: false unconditionally", () => {
    // WHAT: Called by the root layout after successful biometric auth.
    //       unlock() must always set isLocked to false.
    // WHY: If unlock() checks biometricEnabled/pinEnabled before unlocking,
    //      a race condition where those flags are still loading could leave
    //      the user stuck on the lock screen after a successful fingerprint scan.
    useBiometricStore.setState({ biometricEnabled: true, isLocked: true });

    useBiometricStore.getState().unlock();

    expect(useBiometricStore.getState().isLocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("markSetupPrompted() writes '1' to SecureStore and sets setupPrompted: true", async () => {
    // WHAT: After showing the biometric setup prompt once (on first launch with
    //       a token), the app records that it was shown so it never nags again.
    // WHY: If the flag is not persisted, the setup prompt appears on every
    //      cold start after login. Repeated prompts were the #1 annoyance
    //      cited in user research for Khatabook-style apps. The store code
    //      comment says this flag "prevents showing the prompt again."
    mockSet.mockResolvedValue(undefined);

    await useBiometricStore.getState().markSetupPrompted();

    expect(useBiometricStore.getState().setupPrompted).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(SETUP_PROMPTED_KEY, "1");
  });

  // -------------------------------------------------------------------------
  it("checkHardware() returns { available: false } when the device has no biometric hardware", async () => {
    // WHAT: Low-cost Android phone (common in India's ₹5,000–₹8,000 tier)
    //       with no fingerprint sensor.
    // WHY: If available is incorrectly reported as true, the biometric toggle
    //      appears in Settings and users can enable it — then are stuck on the
    //      lock screen with no way to authenticate (biometric fails, and they
    //      may not have set a PIN).
    mockHasHardware.mockResolvedValue(false);
    mockIsEnrolled.mockResolvedValue(false);
    mockSupportedTypes.mockResolvedValue([]);

    const result = await useBiometricStore.getState().checkHardware();

    expect(result.available).toBe(false);
    expect(result.types).toEqual([]);
  });

  // -------------------------------------------------------------------------
  it("checkHardware() returns { available: true } when hardware is present and enrolled", async () => {
    // WHAT: Modern Android phone with enrolled fingerprint(s).
    // WHY: If available is false despite enrolled hardware, the biometric
    //      toggle is hidden and users lose the security feature on devices
    //      that fully support it.
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockSupportedTypes.mockResolvedValue([
      LocalAuthentication.AuthenticationType.FINGERPRINT,
    ]);

    const result = await useBiometricStore.getState().checkHardware();

    expect(result.available).toBe(true);
    expect(result.types).toContain(
      LocalAuthentication.AuthenticationType.FINGERPRINT
    );
  });

  // -------------------------------------------------------------------------
  it("checkHardware() returns { available: false } when hardware exists but no biometric is enrolled", async () => {
    // WHAT: Device has a fingerprint reader but the user has never enrolled
    //       a fingerprint (e.g. they set up the phone without biometrics).
    // WHY: hardware alone is not sufficient — enrollment is required for
    //      LocalAuthentication to work. Reporting available: true here would
    //      show the biometric toggle, which always fails on authentication.
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);
    mockSupportedTypes.mockResolvedValue([]);

    const result = await useBiometricStore.getState().checkHardware();

    expect(result.available).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("checkHardware() returns { available: false } when LocalAuthentication throws", async () => {
    // WHAT: LocalAuthentication API throws unexpectedly (permissions issue,
    //       hardware fault, unrecognised device).
    // WHY: The method must not propagate the error — it should fail safely by
    //      reporting the feature as unavailable.
    mockHasHardware.mockRejectedValue(new Error("Biometric API error"));

    const result = await useBiometricStore.getState().checkHardware();

    expect(result.available).toBe(false);
    expect(result.types).toEqual([]);
  });

  // -------------------------------------------------------------------------
  it("authenticate() returns { success: true, cancelled: false } when LocalAuthentication.authenticateAsync succeeds", async () => {
    // WHAT: Happy path — user successfully scans their fingerprint or face.
    // WHY: If this returns success=false despite a successful scan, the lock screen
    //      never dismisses and the user is locked out of their own app.
    mockAuthenticate.mockResolvedValue({ success: true });

    const result = await useBiometricStore.getState().authenticate();

    expect(result).toEqual({ success: true, cancelled: false });
    expect(mockAuthenticate).toHaveBeenCalledWith({
      promptMessage: "Unlock Hisaabo",
      cancelLabel: "Use PIN",
      disableDeviceFallback: true,
      fallbackLabel: "Use PIN",
    });
  });

  // -------------------------------------------------------------------------
  it("authenticate() returns { success: false, cancelled: true } when the user cancels", async () => {
    // WHAT: User presses "Use PIN" (cancel) on the system biometric dialog.
    // WHY: Must return cancelled=true so the lock screen can auto-switch to
    //      PIN mode instead of showing a generic error.
    mockAuthenticate.mockResolvedValue({ success: false, error: "user_cancel" });

    const result = await useBiometricStore.getState().authenticate();

    expect(result).toEqual({ success: false, cancelled: true });
  });

  // -------------------------------------------------------------------------
  it("authenticate() returns { success: false, cancelled: false } when the scan fails", async () => {
    // WHAT: User's fingerprint doesn't match or face is not recognized.
    // WHY: Must return success=false so the lock screen stays visible and the
    //      user is prompted to try again or use their PIN.
    mockAuthenticate.mockResolvedValue({ success: false });

    const result = await useBiometricStore.getState().authenticate();

    expect(result).toEqual({ success: false, cancelled: false });
  });

  // -------------------------------------------------------------------------
  it("authenticate() returns { success: false, cancelled: false } when LocalAuthentication.authenticateAsync throws", async () => {
    // WHAT: The biometric API throws (hardware locked after too many failures,
    //       requires device credential re-entry, etc.).
    // WHY: Must fail closed (return false) — never grant access on an error.
    mockAuthenticate.mockRejectedValue(new Error("Too many attempts"));

    const result = await useBiometricStore.getState().authenticate();

    expect(result).toEqual({ success: false, cancelled: false });
  });
});
