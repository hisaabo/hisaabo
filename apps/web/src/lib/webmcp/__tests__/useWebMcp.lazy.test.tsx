/**
 * The tool catalog is a lazy chunk.
 *
 * It is loaded with a dynamic import() only when the browser exposes a model
 * context AND this person turned agent access on. This file keeps ONE module
 * registry for all its tests on purpose: the mocked catalog counts how many times
 * it is evaluated, so the order of the tests below is the evidence — it stays at
 * zero through every "should not load" case and goes to one only when the guard
 * passes.
 *
 * A source-level guard at the bottom fails if anything in the app statically imports
 * the catalog, which would pull it back into the main bundle.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { agentPreferenceKey, setAgentAccessEnabled } from "../preferences";
import type { WebMcpTrpcClient } from "../types";

const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock("../tools", () => {
  loads.count += 1;
  return {
    webMcpTools: [
      {
        name: "fake_list",
        description: "List things.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => [],
      },
    ],
  };
});

const { useWebMcp } = await import("../useWebMcp");
type UseWebMcpInput = Parameters<typeof useWebMcp>[0];

const SCOPE = { userId: "user-1", tenantId: "tenant-1" };

function makeInput(overrides: Partial<UseWebMcpInput> = {}): UseWebMcpInput {
  return {
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
    ...overrides,
  };
}

function installModelContext() {
  const registerTool = vi.fn(async () => {});
  Object.defineProperty(document, "modelContext", {
    value: { registerTool, unregisterTool: vi.fn() },
    configurable: true,
    writable: true,
  });
  return registerTool;
}

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
  localStorage.clear();
});

async function settle() {
  // Give a (wrongly) started dynamic import every chance to run before asserting that none did.
  await new Promise((r) => setTimeout(r, 20));
}

describe("tool catalog loading", () => {
  it("is not loaded when the browser exposes no model context, even with the preference on", async () => {
    localStorage.setItem(agentPreferenceKey(SCOPE), "on");
    renderHook(() => useWebMcp(makeInput()));
    await settle();
    expect(loads.count).toBe(0);
  });

  it("is not loaded when the person has not turned agent access on", async () => {
    installModelContext();
    renderHook(() => useWebMcp(makeInput()));
    await settle();
    expect(loads.count).toBe(0);
  });

  it("is not loaded when the caller's gate is closed (signed out, policy off, onboarding)", async () => {
    installModelContext();
    localStorage.setItem(agentPreferenceKey(SCOPE), "on");
    renderHook(() => useWebMcp(makeInput({ enabled: false })));
    renderHook(() => useWebMcp(makeInput({ businessId: null })));
    await settle();
    expect(loads.count).toBe(0);
  });

  it("is not loaded for someone else's preference on the same browser", async () => {
    installModelContext();
    localStorage.setItem(agentPreferenceKey(SCOPE), "on");
    renderHook(() => useWebMcp(makeInput({ userId: "user-ravi" })));
    await settle();
    expect(loads.count).toBe(0);
  });

  it("is loaded, once, when the browser has a model context and the person turned it on", async () => {
    const registerTool = installModelContext();
    localStorage.setItem(agentPreferenceKey(SCOPE), "on");

    const { result } = renderHook(() => useWebMcp(makeInput()));

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.registeredCount).toBe(1));
    expect(loads.count).toBe(1);
  });

  it("is loaded when the person turns the switch on after the page loaded, not before", async () => {
    // The chunk is already cached by the previous test, so assert on registration instead:
    // nothing registers until the switch is flipped.
    const registerTool = installModelContext();
    renderHook(() => useWebMcp(makeInput()));
    await settle();
    expect(registerTool).not.toHaveBeenCalled();

    act(() => setAgentAccessEnabled(SCOPE, true));
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(1));
  });

  it("registers nothing if the registration is torn down while the chunk is loading", async () => {
    const registerTool = installModelContext();
    localStorage.setItem(agentPreferenceKey(SCOPE), "on");
    const { unmount } = renderHook(() => useWebMcp(makeInput()));
    unmount();
    await settle();
    expect(registerTool).not.toHaveBeenCalled();
  });
});

describe("nothing imports the catalog statically", () => {
  const srcRoot = path.resolve(import.meta.dirname, "../../..");

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("has no static import of webmcp/tools outside the tools folder itself", () => {
    const toolsDir = path.join(srcRoot, "lib/webmcp/tools");
    const offenders: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      if (file.startsWith(toolsDir + path.sep)) continue;
      const text = fs.readFileSync(file, "utf8");
      // `import ... from "…/tools"` or `export ... from "…/tools"` (a dynamic import() is the point).
      const staticImport =
        /^\s*(?:import|export)\b[^;]*?from\s+["'](?:@\/lib\/webmcp\/tools|\.{1,2}\/(?:[\w-]+\/)*webmcp\/tools|\.\/tools)(?:\/index)?["']/m;
      if (staticImport.test(text)) offenders.push(path.relative(srcRoot, file));
    }
    expect(offenders).toEqual([]);
  });

  it("loads the catalog through a dynamic import in the hook", () => {
    const hook = fs.readFileSync(path.join(srcRoot, "lib/webmcp/useWebMcp.ts"), "utf8");
    expect(hook).toMatch(/import\("\.\/tools"\)/);
  });
});
