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

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LEGACY_WEBMCP_PREF_KEY, agentPreferenceKey } from "../preferences";
import type { WebMcpToolContext, WebMcpTrpcClient } from "../types";

// The catalog is the sibling module under test elsewhere; two stubs are enough here.
// Contexts the hook built, newest last, so tests can inspect what a tool would see.
const seenContexts = vi.hoisted(() => [] as WebMcpToolContext[]);

vi.mock("../tools", () => ({
  webMcpTools: [
    {
      name: "fake_list",
      description: "List things.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (_input: unknown, ctx: WebMcpToolContext) => {
        seenContexts.push(ctx);
        return [];
      },
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

const SCOPE = { userId: "user-1", tenantId: "tenant-1" };
const PREF_KEY = agentPreferenceKey(SCOPE);

let registerTool: Mock<
  (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => Promise<void>
>;

function makeInput(overrides: Partial<UseWebMcpInput> = {}): UseWebMcpInput {
  return {
    enabled: true,
    userId: SCOPE.userId,
    tenantId: SCOPE.tenantId,
    createClient: () => ({}) as unknown as WebMcpTrpcClient,
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
  seenContexts.length = 0;
  localStorage.setItem(PREF_KEY, "on");
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

    const signal = registerTool.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("re-registers when the business changes", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ businessId: "biz-1" }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const firstSignal = registerTool.mock.calls[0][1]?.signal as AbortSignal;

    rerender(makeInput({ businessId: "biz-2" }));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4));
    expect(firstSignal.aborted).toBe(true);
  });

  it("registers only read-only tools while the role is unknown, then adds the writes once it resolves", async () => {
    const { rerender, result } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ role: null }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.registeredCount).toBe(1));
    expect(registerTool.mock.calls.map((c) => c[0].name)).toEqual(["fake_list"]);
    const readOnlySignal = registerTool.mock.calls[0][1]?.signal as AbortSignal;
    expect(readOnlySignal.aborted).toBe(false);

    // The session resolves: the role changes null -> "owner", which tears the read-only
    // registration down and registers the full permitted set.
    rerender(makeInput({ role: "owner" }));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.registeredCount).toBe(2));
    expect(readOnlySignal.aborted).toBe(true);
    expect(registerTool.mock.calls.slice(1).map((c) => c[0].name)).toEqual(["fake_list", "fake_create"]);
  });

  it("never registers a write tool for a signed-in user whose role stays unknown", async () => {
    const { result } = renderHook(() => useWebMcp(makeInput({ role: null })));
    await waitFor(() => expect(result.current.registeredCount).toBe(1));
    expect(registerTool.mock.calls.map((c) => c[0].name)).not.toContain("fake_create");
  });

  it("builds one client per registration, pinned to that registration's business", async () => {
    const created: string[] = [];
    const createClient = (businessId: string) => {
      created.push(businessId);
      return { pinnedTo: businessId } as unknown as WebMcpTrpcClient;
    };
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ businessId: "biz-1", createClient }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const oldTool = registerTool.mock.calls[0][0];
    await oldTool.execute({}, { signal: new AbortController().signal });

    rerender(makeInput({ businessId: "biz-2", createClient }));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4));
    const newTool = registerTool.mock.calls[2][0];
    await newTool.execute({}, { signal: new AbortController().signal });

    expect(created).toEqual(["biz-1", "biz-2"]);
    const pinned = (i: number) => (seenContexts[i].client as unknown as { pinnedTo: string }).pinnedTo;
    expect(pinned(0)).toBe("biz-1");
    expect(pinned(1)).toBe("biz-2");
    // The first registration's context is untouched by the switch.
    expect(pinned(0)).toBe("biz-1");
  });

  it("refuses a call made on the old registration after the business switched", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ businessId: "biz-1" }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const oldTool = registerTool.mock.calls[0][0];

    rerender(makeInput({ businessId: "biz-2" }));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4));

    const result = (await oldTool.execute({}, { signal: new AbortController().signal })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/reset|switched business/i);
    expect(seenContexts).toHaveLength(0);
  });

  it("gives the context an abort signal that fires when the business changes", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ businessId: "biz-1" }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    await registerTool.mock.calls[0][0].execute({}, { signal: new AbortController().signal });
    const ctx = seenContexts[0];
    expect(ctx.signal.aborted).toBe(false);

    rerender(makeInput({ businessId: "biz-2" }));
    await waitFor(() => expect(ctx.signal.aborted).toBe(true));
  });

  it("reports the business the app shows now, read at call time (injectable, defaulting to the latest prop)", async () => {
    let active: string | null = "biz-1";
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput({ businessId: "biz-1", getActiveBusinessId: () => active }),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    await registerTool.mock.calls[0][0].execute({}, { signal: new AbortController().signal });
    const ctx = seenContexts[0];
    expect(ctx.businessId).toBe("biz-1");
    expect(ctx.activeBusinessId()).toBe("biz-1");
    active = "biz-2";
    expect(ctx.activeBusinessId()).toBe("biz-2");

    // Without an injected reader it follows the latest businessId prop.
    rerender(makeInput({ businessId: "biz-1" }));
    await waitFor(() => expect(ctx.activeBusinessId()).toBe("biz-1"));
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

  it("stays silent by default (opt-in) and for legacy stored values", async () => {
    localStorage.removeItem(PREF_KEY);
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("stays silent when the user turned agent access off", async () => {
    localStorage.setItem(PREF_KEY, "off");
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it("does not inherit the previous person's 'on' when someone else signs in on the same browser", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput(),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    const firstSignal = registerTool.mock.calls[0][1]?.signal as AbortSignal;

    // Ravi signs in on the same browser profile (same organization, same business).
    rerender(makeInput({ userId: "user-ravi" }));

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await Promise.resolve();
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("does not carry the preference to another organization of the same person", async () => {
    const { rerender } = renderHook((props: UseWebMcpInput) => useWebMcp(props), {
      initialProps: makeInput(),
    });
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));

    rerender(makeInput({ tenantId: "tenant-2" }));
    await Promise.resolve();
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("stays off when nobody is signed in, whatever is stored", async () => {
    renderHook(() => useWebMcp(makeInput({ userId: null, tenantId: null })));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("ignores the old browser-wide 'on'", async () => {
    localStorage.clear();
    localStorage.setItem(LEGACY_WEBMCP_PREF_KEY, "on");
    renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("registers when the person turns it on after the page loaded", async () => {
    localStorage.clear();
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(registerTool).not.toHaveBeenCalled();

    const { setAgentAccessEnabled } = await import("../preferences");
    act(() => setAgentAccessEnabled(SCOPE, true));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    expect(result.current.enabled).toBe(true);
  });

  it("reports unavailable when the browser exposes no model context", async () => {
    Reflect.deleteProperty(document, "modelContext");
    const { result } = renderHook(() => useWebMcp(makeInput()));
    await Promise.resolve();
    expect(result.current.available).toBe(false);
    expect(registerTool).not.toHaveBeenCalled();
  });
});
