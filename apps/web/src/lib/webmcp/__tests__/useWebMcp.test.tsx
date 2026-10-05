/**
 * useWebMcp — lifecycle tests.
 *
 * The properties that matter are all about *when* tools exist: they must appear
 * once the user has a business, disappear on unmount, follow a business switch
 * (so the agent can never write into the previous business's books), and stay
 * away entirely when the user has turned agent access off.
 *
 * Run with: pnpm --filter @hisaabo/web test -- --run src/lib/webmcp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { WEBMCP_PREF_KEY } from "../preferences";
import type { WebMcpTrpcClient } from "../types";

// The catalog is the sibling module under test elsewhere; two stubs are enough here.
vi.mock("../tools", () => ({
  webMcpTools: [
    {
      name: "fake_list",
      description: "List things.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => [],
    },
    {
      name: "fake_create",
      description: "Create a thing.",
      inputSchema: { type: "object", properties: {} },
      annotations: { consequentialHint: true },
      execute: async () => ({ id: "1" }),
    },
  ],
}));

const { useWebMcp } = await import("../useWebMcp");
type UseWebMcpInput = Parameters<typeof useWebMcp>[0];

let registerTool: ReturnType<typeof vi.fn>;

function makeInput(overrides: Partial<UseWebMcpInput> = {}): UseWebMcpInput {
  return {
    enabled: true,
    client: {} as unknown as WebMcpTrpcClient,
    role: "owner",
    businessId: "biz-1",
    businessName: "Acme Traders",
    userName: "Asha",
    pathname: "/invoices",
    navigate: vi.fn(),
    invalidate: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  registerTool = vi.fn(async () => {});
  Object.defineProperty(document, "modelContext", {
    value: {
      registerTool: (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) =>
        registerTool(tool, options),
      unregisterTool: vi.fn(),
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useWebMcp", () => {
  it("registers the catalog on mount when enabled and a business is selected", async () => {
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.registeredCount).toBe(2));
    expect(result.current).toMatchObject({ available: true, enabled: true });
    expect(registerTool.mock.calls.map((c) => c[0].name)).toEqual(["fake_list", "fake_create"]);
  });

  it("does nothing until a business is selected", async () => {
    renderHook(() => useWebMcp(makeInput({ businessId: null })));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("does nothing when the caller's gate is closed", async () => {
    renderHook(() => useWebMcp(makeInput({ enabled: false })));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("aborts the registration signal on unmount", async () => {
    const { unmount } = renderHook(() => useWebMcp(makeInput()));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));

    const signal = registerTool.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("re-registers when the business changes", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ businessId: "biz-1" }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const firstSignal = registerTool.mock.calls[0][1].signal as AbortSignal;

    rerender(makeInput({ businessId: "biz-2" }));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4));
    expect(firstSignal.aborted).toBe(true);
  });

  it("does not re-register when only the route changes", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ pathname: "/invoices" }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));

    rerender(makeInput({ pathname: "/parties" }));
    await Promise.resolve();
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the user turned agent access off", async () => {
    localStorage.setItem(WEBMCP_PREF_KEY, "off");
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("reports unavailable when the browser exposes no model context", async () => {
    Reflect.deleteProperty(document, "modelContext");
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(result.current.available).toBe(false);
    expect(registerTool).not.toHaveBeenCalled();
  });
});
