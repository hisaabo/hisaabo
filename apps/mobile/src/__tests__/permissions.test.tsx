/**
 * Mobile-side permission gating tests.
 *
 * The mobile app's useCan/useAbility/useCanModify hooks (apps/mobile/src/hooks/useCan.ts)
 * are thin wrappers over @hisaabo/shared. These tests assert:
 *   1. The hooks return the correct decision for each canonical role.
 *   2. While the session is loading we open buttons by default so the UI
 *      doesn't flash hidden affordances (the API still enforces the rule).
 *   3. useCanModify applies the API's one record-level rule: a seller_manager
 *      may delete only unpaid invoices up to 2 hours old. Edits are never
 *      time-limited.
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
import { INVOICE_DELETE_WINDOW_MS } from "@hisaabo/shared";

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

  it("returns a no-permission ability before the session has loaded", () => {
    withSession(undefined);
    const { result } = renderHook(() => useAbility());
    expect(result.current.role).toBe("");
    expect(result.current.can("read", "Invoice")).toBe(false);
  });

  it("returns an ability whose role matches the canonical mapping", () => {
    withSession("member");
    const { result } = renderHook(() => useAbility());
    expect(result.current.role).toBe("seller");
    expect(result.current.can("create", "Invoice")).toBe(true);
    expect(result.current.can("delete", "Invoice")).toBe(false);
  });
});

describe("mobile useCanModify — record-level rule", () => {
  beforeEach(() => mockUseQuery.mockReset());

  const stale = () => new Date(Date.now() - INVOICE_DELETE_WINDOW_MS - 60_000);

  it("seller_manager can delete a fresh unpaid invoice", () => {
    withSession("seller_manager");
    const { result } = renderHook(() =>
      useCanModify("delete", "Invoice", { createdAt: new Date(), status: "draft" }),
    );
    expect(result.current).toEqual({ allowed: true });
  });

  it("seller_manager cannot delete an invoice older than 2 hours", () => {
    withSession("seller_manager");
    const { result } = renderHook(() => useCanModify("delete", "Invoice", { createdAt: stale(), status: "draft" }));
    expect(result.current).toEqual({ allowed: false, reason: "window-expired" });
  });

  it("seller_manager cannot delete a paid invoice", () => {
    withSession("seller_manager");
    const { result } = renderHook(() => useCanModify("delete", "Invoice", { createdAt: new Date(), status: "paid" }));
    expect(result.current).toEqual({ allowed: false, reason: "invoice-paid" });
  });

  it("admin can delete an old invoice", () => {
    withSession("admin");
    const { result } = renderHook(() => useCanModify("delete", "Invoice", { createdAt: stale(), status: "draft" }));
    expect(result.current).toEqual({ allowed: true });
  });

  it("seller cannot delete at all (no permission)", () => {
    withSession("seller");
    const { result } = renderHook(() => useCanModify("delete", "Invoice", { createdAt: new Date() }));
    expect(result.current).toEqual({ allowed: false, reason: "no-permission" });
  });

  it("seller can update an old invoice — edits are never time-limited", () => {
    withSession("seller");
    const { result } = renderHook(() => useCanModify("update", "Invoice", { createdAt: stale() }));
    expect(result.current).toEqual({ allowed: true });
  });

  it("does not block when the record is not loaded yet", () => {
    withSession("seller_manager");
    const { result } = renderHook(() => useCanModify("delete", "Invoice", undefined));
    expect(result.current).toEqual({ allowed: true });
  });

  it("recomputes when the record changes", () => {
    withSession("seller_manager");
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) => useCanModify("delete", "Invoice", { createdAt: new Date(), status }),
      { initialProps: { status: "draft" } },
    );
    expect(result.current.allowed).toBe(true);
    rerender({ status: "paid" });
    expect(result.current).toEqual({ allowed: false, reason: "invoice-paid" });
  });
});
