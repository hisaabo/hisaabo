/**
 * Mobile-side permission gating tests.
 *
 * The mobile app's useCan/useAbility/useCanModify hooks (apps/mobile/src/hooks/useCan.ts)
 * are thin wrappers over @hisaabo/shared. These tests assert:
 *   1. The hooks return the correct decision for each canonical role.
 *   2. While the session is loading we open buttons by default so the UI
 *      doesn't flash hidden affordances (the API still enforces the rule).
 *   3. The 2-hour edit window for sellers on Invoice/Payment is reflected in
 *      useCanModify and surfaces a "window-expired" reason after the window.
 *
 * We exercise the hooks via a tiny harness component rather than rendering
 * real screens (which would pull in expo-router + native modules).
 */

import { renderHook } from "@testing-library/react-native";

// Mock the trpc module so we can drive auth.me responses per test.
const mockUseQuery = jest.fn();
jest.mock("../lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

import { useCan, useAbility, useCanModify } from "../hooks/useCan";
import { EDIT_WINDOW_MS } from "@hisaabo/shared";

function withSession(role: string | null | undefined, opts: { isLoading?: boolean } = {}) {
  mockUseQuery.mockReturnValue({
    data: role == null ? undefined : { role, user: { id: "u1" } },
    isLoading: opts.isLoading ?? false,
  });
}

describe("mobile useCan", () => {
  beforeEach(() => mockUseQuery.mockReset());

  it("returns true for every action while session is still loading", () => {
    withSession(null, { isLoading: true });
    const { result } = renderHook(() => useCan("delete", "Invoice"));
    expect(result.current).toBe(true);
  });

  it("returns true for every action when role is missing (graceful degradation)", () => {
    withSession(undefined);
    const { result } = renderHook(() => useCan("delete", "Invoice"));
    expect(result.current).toBe(true);
  });

  it.each([
    ["superadmin", "create", "Invoice", true],
    ["superadmin", "delete", "Invoice", true],
    ["admin",      "delete", "Party",   true],
    ["seller",     "create", "Invoice", true],
    ["seller",     "delete", "Invoice", false],
    ["seller",     "create", "Item",    false],
    ["seller",     "update", "Party",   false],
    ["accountant", "create", "Expense", true],
    ["accountant", "create", "Invoice", false],
    ["seller_manager", "delete", "Invoice", true],
    ["seller_manager", "delete", "Party",   false],
  ] as const)("role=%s %s:%s -> %s", (role, action, resource, expected) => {
    withSession(role);
    const { result } = renderHook(() => useCan(action, resource));
    expect(result.current).toBe(expected);
  });

  it("normalises legacy DB role names via mapDbRole", () => {
    withSession("owner");
    const { result } = renderHook(() => useCan("delete", "Business"));
    expect(result.current).toBe(true);
  });
});

describe("mobile useAbility", () => {
  beforeEach(() => mockUseQuery.mockReset());

  it("returns an ability whose role matches the canonical mapping", () => {
    withSession("member");
    const { result } = renderHook(() => useAbility());
    expect(result.current.role).toBe("seller");
    expect(result.current.can("create", "Invoice")).toBe(true);
    expect(result.current.can("delete", "Invoice")).toBe(false);
  });
});

describe("mobile useCanModify — 2-hour edit window", () => {
  beforeEach(() => mockUseQuery.mockReset());

  it("admin can always edit, regardless of age", () => {
    withSession("admin");
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const { result } = renderHook(() => useCanModify("update", "Invoice", { createdAt: old }));
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBeUndefined();
  });

  it("seller cannot delete an invoice (no permission)", () => {
    withSession("seller");
    const { result } = renderHook(() =>
      useCanModify("delete", "Invoice", { createdAt: new Date() })
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe("no-permission");
  });

  it("seller can update a fresh invoice within the window", () => {
    withSession("seller");
    const fresh = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    const { result } = renderHook(() => useCanModify("update", "Invoice", { createdAt: fresh }));
    expect(result.current.allowed).toBe(true);
    expect(result.current.remainingMs).toBeGreaterThan(0);
  });

  it("seller is locked out after the 2-hour window elapses", () => {
    withSession("seller");
    const stale = new Date(Date.now() - EDIT_WINDOW_MS - 1);
    const { result } = renderHook(() => useCanModify("update", "Invoice", { createdAt: stale }));
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe("window-expired");
  });
});
