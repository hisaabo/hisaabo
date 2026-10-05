/**
 * Tests for the useCan / useAbility hooks (apps/web/src/hooks/useCan.ts).
 *
 * These hooks gate every Create/Edit/Delete button in the web UI. The same
 * matrix is enforced server-side by packages/api CASL — the parity test in
 * packages/api/src/__tests__/permissions-parity.test.ts guarantees the two
 * cannot drift. These tests cover the hook-level behaviour:
 *   • role mapping (legacy DB names)
 *   • graceful degradation while session is loading or missing
 * Per-record rules (canModify) are covered in packages/shared and, as used
 * by the invoice list, in src/__tests__/role-gating-pages.test.tsx.
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

import { useCan, useAbility } from "@/hooks/useCan";

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
