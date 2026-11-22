/**
 * The owner switched browser agents off while this tab still had tools registered.
 *
 * The API answers agent-marked calls with FORBIDDEN + WEBMCP_ORG_DISABLED_MESSAGE.
 * The runtime turns that into a plain instruction for the agent and tells the hook,
 * which withdraws the registration at once and refreshes the session policy.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { WEBMCP_ORG_DISABLED_MESSAGE } from "@hisaabo/shared";
import { agentPreferenceKey } from "../preferences";
import { buildBrowserTool, isOrgDisabledError } from "../runtime";
import type { WebMcpToolContext, WebMcpToolDefinition, WebMcpTrpcClient } from "../types";

function forbidden(message: string) {
  const response = { error: { code: -32003, message, data: { code: "FORBIDDEN", httpStatus: 403 } } };
  return TRPCClientError.from(response as unknown as Error);
}
const orgDisabled = () => forbidden(WEBMCP_ORG_DISABLED_MESSAGE);

vi.mock("../tools", async () => {
  const { TRPCClientError: Err } = await import("@trpc/client");
  const { WEBMCP_ORG_DISABLED_MESSAGE: MESSAGE } = await import("@hisaabo/shared");
  const orgDisabled = () =>
    Err.from({ error: { code: -32003, message: MESSAGE, data: { code: "FORBIDDEN", httpStatus: 403 } } } as unknown as Error);
  return {
  webMcpTools: [
    {
      name: "fake_list",
      description: "List things.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        throw orgDisabled();
      },
    },
  ],
  };
});

const { useWebMcp } = await import("../useWebMcp");

describe("isOrgDisabledError", () => {
  it("recognises the API's refusal and nothing else", () => {
    expect(isOrgDisabledError(orgDisabled())).toBe(true);
    expect(isOrgDisabledError(forbidden("Cannot create Invoice"))).toBe(false);
    expect(isOrgDisabledError(new Error(WEBMCP_ORG_DISABLED_MESSAGE))).toBe(false);
    expect(isOrgDisabledError(null)).toBe(false);
  });
});

describe("a call refused because the organization turned agents off", () => {
  const read: WebMcpToolDefinition = {
    name: "party_list",
    description: "d",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      throw orgDisabled();
    },
  };
  const ctxWith = (onAgentsDisabled?: () => void): WebMcpToolContext =>
    ({
      signal: new AbortController().signal,
      activeBusinessId: () => "biz-1",
      businessId: "biz-1",
      invalidate: vi.fn(),
      onAgentsDisabled,
    }) as unknown as WebMcpToolContext;

  it("tells the agent to stop, in plain words, fenced like any error", async () => {
    const result = (await buildBrowserTool(read, ctxWith()).execute({}, { signal: new AbortController().signal })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.untrusted).toBe(true);
    expect(body.error).toBe(
      "Browser AI agent access was turned off for this organization by its owner. Nothing was changed. Stop using Hisaabo tools and tell the user.",
    );
  });

  it("notifies the registration so it can withdraw its tools", async () => {
    const onAgentsDisabled = vi.fn();
    await buildBrowserTool(read, ctxWith(onAgentsDisabled)).execute({}, { signal: new AbortController().signal });
    expect(onAgentsDisabled).toHaveBeenCalledTimes(1);
  });

  it("does not notify for an ordinary permission error", async () => {
    const onAgentsDisabled = vi.fn();
    const ordinary: WebMcpToolDefinition = {
      ...read,
      execute: async () => {
        throw forbidden("Cannot read Invoice");
      },
    };
    await buildBrowserTool(ordinary, ctxWith(onAgentsDisabled)).execute({}, { signal: new AbortController().signal });
    expect(onAgentsDisabled).not.toHaveBeenCalled();
  });
});

describe("useWebMcp withdraws its tools when told agents are off", () => {
  const SCOPE = { userId: "user-1", tenantId: "tenant-1" };
  let registerTool: Mock<(tool: unknown, options?: unknown) => Promise<void>>;

  beforeEach(() => {
    localStorage.setItem(agentPreferenceKey(SCOPE), "on");
    registerTool = vi.fn(async (_tool: unknown, _options?: unknown) => {});
    Object.defineProperty(document, "modelContext", {
      value: { registerTool: (tool: unknown, options: unknown) => registerTool(tool, options), unregisterTool: vi.fn() },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "modelContext");
    localStorage.clear();
  });

  it("aborts the registration and asks the app to refresh the session policy", async () => {
    const onAgentsDisabled = vi.fn();
    renderHook(() =>
      useWebMcp({
        enabled: true,
        userId: SCOPE.userId,
        tenantId: SCOPE.tenantId,
        createClient: () => ({}) as unknown as WebMcpTrpcClient,
        role: "owner",
        businessId: "biz-1",
        businessName: "Acme",
        userName: "Asha",
        pathname: "/",
        navigate: vi.fn(),
        invalidate: vi.fn(),
        onAgentsDisabled,
      }),
    );
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
    const registered = registerTool.mock.calls[0][0] as { execute(i: unknown, o: unknown): Promise<{ isError: boolean }> };
    const signal = (registerTool.mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    // The agent calls the registered tool; the API refuses because the owner turned agents off.
    const result = await registered.execute({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(signal.aborted).toBe(true); // tools withdrawn at once
    expect(onAgentsDisabled).toHaveBeenCalledTimes(1); // the app refreshes auth.me
  });

  it("a later call on the withdrawn registration is refused without reaching the API", async () => {
    renderHook(() =>
      useWebMcp({
        enabled: true,
        userId: SCOPE.userId,
        tenantId: SCOPE.tenantId,
        createClient: () => ({}) as unknown as WebMcpTrpcClient,
        role: "owner",
        businessId: "biz-1",
        businessName: "Acme",
        userName: "Asha",
        pathname: "/",
        navigate: vi.fn(),
        invalidate: vi.fn(),
      }),
    );
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
    const registered = registerTool.mock.calls[0][0] as { execute(i: unknown, o: unknown): Promise<{ isError: boolean; content: Array<{ text: string }> }> };
    await registered.execute({}, { signal: new AbortController().signal });
    const again = await registered.execute({}, { signal: new AbortController().signal });
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toMatch(/session was reset/i);
  });
});
