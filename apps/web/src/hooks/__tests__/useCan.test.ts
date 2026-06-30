/**
 * Tests for useCan / useAbility / useCanModify hooks (apps/web/src/hooks/useCan.ts).
 *
 * These hooks gate every Create/Edit/Delete button in the web UI. The same
 * matrix is enforced server-side by packages/api CASL — the parity test in
 * packages/api/src/__tests__/permissions-parity.test.ts guarantees the two
 * cannot drift. These tests cover the hook-level behaviour:
 *   • role mapping (legacy DB names)
 *   • graceful degradation while session is loading or missing
 *   • the 2-hour edit window for seller / seller_manager on Invoice / Payment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock the trpc module — must be hoisted before importing the hook.
const mockUseQuery = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

import { useCan, useAbility, useCanModify } from "@/hooks/useCan";
import { EDIT_WINDOW_MS } from "@hisaabo/shared";

function withSession(role: string | null | undefined, opts: { isLoading?: boolean } = {}) {
  mockUseQuery.mockReturnValue({
    data: role == null ? undefined : { role, user: { id: "u1" } },
    isLoading: opts.isLoading ?? false,
  });
}

describe("web useCan", () => {
  beforeEach(() => mockUseQuery.mockReset());

  it("returns true while session is still loading (no UI flash)", () => {
    withSession(null, { isLoading: true });
    const { result } = renderHook(() => useCan("delete", "Invoice"));
    expect(result.current).toBe(true);
  });

  it("returns true when session has no role (graceful degradation)", () => {
    withSession(undefined);
    const { result } = renderHook(() => useCan("delete", "Invoice"));
    expect(result.current).toBe(true);
  });

  it.each([
    ["superadmin",     "create", "Invoice", true],
    ["superadmin",     "delete", "Invoice", true],
    ["admin",          "delete", "Party",   true],
    ["seller",         "create", "Invoice", true],
    ["seller",         "delete", "Invoice", false],
    ["seller",         "create", "Item",    false],
    ["seller",         "update", "Party",   false],
    ["accountant",     "create", "Expense", true],
    ["accountant",     "create", "Invoice", false],
    ["seller_manager", "delete", "Invoice", true],
    ["seller_manager", "delete", "Party",   false],
  ] as const)("role=%s %s:%s -> %s", (role, action, resource, expected) => {
    withSession(role);
    const { result } = renderHook(() => useCan(action, resource));
    expect(result.current).toBe(expected);
  });

  it("normalises legacy DB role names via mapDbRole", () => {
    withSession("owner");
    expect(renderHook(() => useCan("delete", "Business")).result.current).toBe(true);

    withSession("member");
    expect(renderHook(() => useCan("create", "Invoice")).result.current).toBe(true);

    withSession("viewer");
    expect(renderHook(() => useCan("delete", "Expense")).result.current).toBe(true);
  });

  it("returns false for unknown roles (security boundary)", () => {
    withSession("garbage_role_unknown");
    expect(renderHook(() => useCan("read", "Invoice")).result.current).toBe(false);
  });
});

describe("web useAbility", () => {
  beforeEach(() => mockUseQuery.mockReset());

  it("returns an ability whose role matches the canonical mapping", () => {
    withSession("member");
    const { result } = renderHook(() => useAbility());
    expect(result.current.role).toBe("seller");
    expect(result.current.can("create", "Invoice")).toBe(true);
    expect(result.current.can("delete", "Invoice")).toBe(false);
  });

  it("returns the seller_manager ability with full SalesTarget management", () => {
    withSession("seller_manager");
    const { result } = renderHook(() => useAbility());
    expect(result.current.can("manage", "SalesTarget")).toBe(true);
    expect(result.current.can("delete", "RecurringInvoice")).toBe(true);
  });

  it("returns an empty ability for unknown roles", () => {
    withSession("garbage_role_unknown");
    const { result } = renderHook(() => useAbility());
    expect(result.current.can("read", "Invoice")).toBe(false);
    expect(result.current.can("read", "Party")).toBe(false);
  });
});

describe("web useCanModify — 2-hour edit window", () => {
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
    expect(result.current.reason).toBeUndefined();
    expect(result.current.remainingMs).toBeGreaterThan(0);
  });

  it("seller is locked out after the 2-hour window elapses", () => {
    withSession("seller");
    const stale = new Date(Date.now() - EDIT_WINDOW_MS - 1);
    const { result } = renderHook(() => useCanModify("update", "Invoice", { createdAt: stale }));
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe("window-expired");
  });

  it("seller_manager Payment edit also respects the window", () => {
    withSession("seller_manager");
    const stale = new Date(Date.now() - EDIT_WINDOW_MS - 1);
    const { result } = renderHook(() => useCanModify("update", "Payment", { createdAt: stale }));
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe("window-expired");
  });

  it("admin is never time-restricted on Payment", () => {
    withSession("admin");
    const stale = new Date(Date.now() - 10 * EDIT_WINDOW_MS);
    const { result } = renderHook(() => useCanModify("update", "Payment", { createdAt: stale }));
    expect(result.current.allowed).toBe(true);
  });

  it("does not block when record is missing (e.g. still loading)", () => {
    withSession("seller");
    const { result } = renderHook(() => useCanModify("update", "Invoice", undefined));
    expect(result.current.allowed).toBe(true);
  });
});
