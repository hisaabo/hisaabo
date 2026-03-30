/**
 * Tests for the business Zustand store (`src/stores/business.ts`)
 *
 * WHY these tests matter for contributors:
 * Hisaabo is a multi-tenant, multi-business app. A single user (e.g. a CA
 * firm owner) can manage Sharma Textiles, Gupta Electricals, and their own
 * personal accounts — all from one login. The business store persists the
 * "active business" selection to SecureStore so switching apps or rebooting
 * does not force users to re-select their business every time.
 *
 * The `x-business-id` header injected by the tRPC client reads from this
 * store. A silent bug here causes EVERY API call to hit the wrong business's
 * data — a catastrophic privacy violation in a financial application.
 *
 * Coverage checklist:
 *   - Initial state before hydration
 *   - setBusiness() updates memory AND persists both id+name to SecureStore
 *   - hydrate() restores id+name from SecureStore on app restart
 *   - hydrate() gracefully handles corrupted/missing SecureStore data
 *   - clearBusiness() wipes both in-memory state and SecureStore entry
 *   - SecureStore write failures in setBusiness() do not crash the app
 *     (in-memory state is still updated so the current session works)
 */

import * as SecureStore from "expo-secure-store";
import { useBusinessStore } from "../business";

// ---------------------------------------------------------------------------
// Mock expo-secure-store — we test the Zustand logic, not device storage APIs
// ---------------------------------------------------------------------------
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;
const mockDelete = SecureStore.deleteItemAsync as jest.Mock;

// Reset everything before each test — Zustand stores are singletons
beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset();
  mockDelete.mockReset();

  useBusinessStore.setState({
    businessId: null,
    businessName: null,
    isHydrated: false,
  });
});

// ---------------------------------------------------------------------------
describe("business store — active business selection", () => {
  // -------------------------------------------------------------------------
  it("starts with null businessId, null businessName, and isHydrated: false", () => {
    // WHAT: Verify the pristine initial state before any store interaction.
    // WHY: If businessId has a non-null default, the tRPC client immediately
    //      sends `x-business-id` header with a garbage value, causing the API
    //      to reject all requests or return another user's data on first load.
    const { businessId, businessName, isHydrated } =
      useBusinessStore.getState();

    expect(businessId).toBeNull();
    expect(businessName).toBeNull();
    expect(isHydrated).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("setBusiness() updates in-memory state immediately with both id and name", async () => {
    // WHAT: Simulate the user selecting "Sharma Textiles" from the business
    //       picker after login.
    // WHY: The tRPC link reads businessId synchronously from the store before
    //      building headers. If the in-memory update is deferred or partial,
    //      the first API call after business selection goes to the wrong tenant.
    mockSet.mockResolvedValue(undefined);

    await useBusinessStore
      .getState()
      .setBusiness("biz_sharma_01", "Sharma Textiles");

    const { businessId, businessName } = useBusinessStore.getState();
    expect(businessId).toBe("biz_sharma_01");
    expect(businessName).toBe("Sharma Textiles");
  });

  // -------------------------------------------------------------------------
  it("setBusiness() persists id and name to SecureStore under the correct key", async () => {
    // WHAT: Verify the serialised JSON that goes into SecureStore contains
    //       both `id` and `name` fields and uses the expected storage key.
    // WHY: If only the id is stored (not the name), the header is still
    //      correct for API calls, but the UI shows "Unknown Business" in the
    //      business switcher after a restart — a confusing UX for a Vyaapaar-
    //      replacement that markets itself on clarity.
    mockSet.mockResolvedValue(undefined);

    await useBusinessStore
      .getState()
      .setBusiness("biz_gupta_02", "Gupta Electricals");

    expect(mockSet).toHaveBeenCalledWith(
      "hisaabo_business",
      JSON.stringify({ id: "biz_gupta_02", name: "Gupta Electricals" })
    );
  });

  // -------------------------------------------------------------------------
  it("hydrate() restores businessId and businessName from SecureStore on app restart", async () => {
    // WHAT: Simulate a full app kill + relaunch for a user who had previously
    //       selected "Patel Pharma Distributors" as their active business.
    // WHY: Without persistence, every cold start drops users on the business
    //      selection screen even though they already chose their business.
    //      This is the single most common complaint in Khatabook reviews —
    //      losing context after switching apps. We must not repeat that.
    mockGet.mockResolvedValue(
      JSON.stringify({ id: "biz_patel_03", name: "Patel Pharma Distributors" })
    );

    await useBusinessStore.getState().hydrate();

    const { businessId, businessName, isHydrated } =
      useBusinessStore.getState();
    expect(businessId).toBe("biz_patel_03");
    expect(businessName).toBe("Patel Pharma Distributors");
    expect(isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() sets isHydrated: true even when SecureStore is empty (no business selected yet)", async () => {
    // WHAT: First launch or user who hasn't selected a business yet.
    // WHY: isHydrated gates the business-selection redirect in the app layout.
    //      If it stays false when the store is empty, the redirect never fires
    //      and the user is stuck on a blank screen with no route rendered.
    mockGet.mockResolvedValue(null);

    await useBusinessStore.getState().hydrate();

    const { businessId, isHydrated } = useBusinessStore.getState();
    expect(businessId).toBeNull();
    expect(isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() handles corrupted SecureStore data gracefully — does not throw", async () => {
    // WHAT: SecureStore contains garbled bytes (can happen if the app was
    //       force-killed mid-write, or if someone manually tampered with the
    //       keychain on a rooted device).
    // WHY: JSON.parse() of corrupted data throws a SyntaxError. If that
    //      propagates out of hydrate(), the root layout's `prepare()` effect
    //      crashes, leaving the user stuck on the splash screen forever.
    //      The store comment says "Corrupted entry — ignore and let the app
    //      re-select" — this test validates that promise.
    mockGet.mockResolvedValue("this_is_not_json{{{");

    await expect(useBusinessStore.getState().hydrate()).resolves.not.toThrow();

    // State must still be consistent (nulls are safe)
    const { businessId, businessName, isHydrated } =
      useBusinessStore.getState();
    expect(businessId).toBeNull();
    expect(businessName).toBeNull();
    expect(isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("hydrate() handles a SecureStore.getItemAsync rejection gracefully", async () => {
    // WHAT: The underlying keystore service throws (e.g. Android KeyStore
    //       service is unavailable after a system update).
    // WHY: Same as above — hydrate() must always complete so the app can route
    //      the user somewhere useful instead of hanging on the splash screen.
    mockGet.mockRejectedValue(new Error("Android KeyStore service down"));

    await expect(useBusinessStore.getState().hydrate()).resolves.not.toThrow();

    expect(useBusinessStore.getState().isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("clearBusiness() resets in-memory state to null and deletes from SecureStore", async () => {
    // WHAT: When a user explicitly signs out of a business (or deletes their
    //       account), both the in-memory selection and the persisted key must
    //       be wiped.
    // WHY: Leaving a stale businessId in SecureStore means the next login
    //      auto-selects a potentially deleted or inaccessible business, causing
    //      cryptic 403 errors on every API call until the user manually switches.
    useBusinessStore.setState({
      businessId: "biz_to_remove",
      businessName: "Old Business Name",
      isHydrated: true,
    });
    mockDelete.mockResolvedValue(undefined);

    await useBusinessStore.getState().clearBusiness();

    const { businessId, businessName } = useBusinessStore.getState();
    expect(businessId).toBeNull();
    expect(businessName).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith("hisaabo_business");
  });

  // -------------------------------------------------------------------------
  it("setBusiness() keeps in-memory state updated even when SecureStore.setItemAsync fails", async () => {
    // WHAT: SecureStore write fails (device low on storage, hardware fault).
    //       The in-memory businessId and businessName must still be updated so
    //       the current session works correctly.
    // WHY: The store code comment says "SecureStore failures are non-fatal —
    //      in-memory state is still set." This test enforces that contract so
    //      a future refactor cannot accidentally make the write fatal.
    mockSet.mockRejectedValue(new Error("Disk full"));

    // Should not throw
    await expect(
      useBusinessStore
        .getState()
        .setBusiness("biz_resilient_99", "Resilient Trading Co.")
    ).resolves.not.toThrow();

    // In-memory state is still correct for the current session
    const { businessId, businessName } = useBusinessStore.getState();
    expect(businessId).toBe("biz_resilient_99");
    expect(businessName).toBe("Resilient Trading Co.");
  });
});
