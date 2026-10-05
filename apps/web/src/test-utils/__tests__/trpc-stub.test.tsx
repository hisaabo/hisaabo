/**
 * Contract tests for the shared tRPC/router stub used by the page-level
 * permission suites (src/__tests__/role-gating-*.test.tsx). If the stub
 * misbehaves, those suites could pass vacuously — so its behaviour is pinned.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, render, screen } from "@testing-library/react";
import { stub, trpcModule, routerOverrides } from "@/test-utils/trpc-stub";

// The stub is a proxy; type it loosely for these contract checks.
const trpc = trpcModule.trpc as any;

beforeEach(() => stub.reset());

describe("trpc-stub (web)", () => {
  it("returns canned query data keyed by router.procedure", () => {
    stub.data["party.list"] = { data: [{ id: "p1" }], total: 1 };
    const { result } = renderHook(() => trpc.party.list.useQuery({ page: 1 }));
    expect(result.current.data).toEqual({ data: [{ id: "p1" }], total: 1 });
    expect(result.current.isLoading).toBe(false);
  });

  it("auth.me: no session data when role is undefined", () => {
    stub.session.role = undefined;
    const { result } = renderHook(() => trpc.auth.me.useQuery());
    expect(result.current.data).toBeUndefined();
  });

  it("auth.me: session with the configured role (including null = no role)", () => {
    stub.session.role = "seller";
    expect(renderHook(() => trpc.auth.me.useQuery()).result.current.data.role).toBe("seller");
    stub.session.role = null;
    expect(renderHook(() => trpc.auth.me.useQuery()).result.current.data.role).toBeNull();
  });

  it("records mutate and mutateAsync calls per procedure", async () => {
    const { result } = renderHook(() => trpc.invoice.updateStatus.useMutation());
    result.current.mutate({ id: "a" });
    await result.current.mutateAsync({ id: "b" });
    expect(stub.mutations["invoice.updateStatus"]).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("useUtils returns callable, chainable invalidators that resolve", async () => {
    const { result } = renderHook(() => trpc.useUtils());
    await expect(result.current.party.list.invalidate()).resolves.toBeUndefined();
    expect(result.current.then).toBeUndefined(); // not mistaken for a promise
  });

  it("reset clears data, mutations, session and navigation state", () => {
    stub.data["x.y"] = 1;
    stub.mutations["x.y"] = [1];
    stub.session.role = "admin";
    stub.pathname = "/elsewhere";
    stub.search = { id: "1" };
    stub.reset();
    expect(stub.data).toEqual({});
    expect(stub.mutations).toEqual({});
    expect(stub.session).toEqual({ role: null, isLoading: false });
    expect(stub.pathname).toBe("/");
    expect(stub.search).toEqual({});
  });

  it("router overrides route navigation through stub state", () => {
    stub.pathname = "/parties";
    stub.search = { id: "p1" };
    expect(routerOverrides.useLocation()).toEqual({ pathname: "/parties" });
    expect(routerOverrides.useSearch()).toEqual({ id: "p1" });
    routerOverrides.useNavigate()({ to: "/x" });
    expect(stub.navigate).toHaveBeenCalledWith({ to: "/x" });
    expect(routerOverrides.Outlet()).toBeNull();
    render(<routerOverrides.Link to="/items">Items</routerOverrides.Link>);
    expect(screen.getByText("Items").closest("a")).toHaveAttribute("href", "/items");
  });

  it("exposes the business id helpers the app imports", () => {
    expect(trpcModule.getBusinessId()).toBe("biz-1");
  });
});
