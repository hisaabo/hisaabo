/**
 * WebMCP runtime — contract tests.
 *
 * These lock down what a browser agent actually experiences: where we look for
 * the model context, the exact envelope a tool result takes, the plain-English
 * wording of every error class, the role gate, and the promise that one broken
 * tool cannot take the whole catalog down.
 *
 * Run with: pnpm --filter @hisaabo/web test -- --run src/lib/webmcp
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { TRPCClientError } from "@trpc/client";
import {
  buildBrowserTool,
  getModelContext,
  isWebMcpAvailable,
  registerHisaaboTools,
  selectToolsForRole,
  toErrorResult,
  toToolResult,
} from "../runtime";
import type { WebMcpToolContext, WebMcpToolDefinition, WebMcpTrpcClient } from "../types";

// ── Helpers ────────────────────────────────────────────────────

function installModelContext(target: Document | Navigator, value: unknown): void {
  Object.defineProperty(target, "modelContext", { value, configurable: true, writable: true });
}

function removeModelContext(): void {
  Reflect.deleteProperty(document, "modelContext");
  Reflect.deleteProperty(navigator, "modelContext");
}

/** A two-argument registerTool (spec arity) backed by a spy. */
function fakeModelContext(impl?: (tool: WebMCP.ModelContextTool) => Promise<void>) {
  const registerTool = vi.fn(
    async (tool: WebMCP.ModelContextTool, _options?: WebMCP.ModelContextRegisterToolOptions) => {
      if (impl) await impl(tool);
    },
  );
  const unregisterTool = vi.fn();
  const modelContext = {
    registerTool: (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) =>
      registerTool(tool, options),
    unregisterTool,
  };
  return { modelContext, registerTool, unregisterTool };
}

function makeCtx(overrides: Partial<WebMcpToolContext> = {}): WebMcpToolContext {
  return {
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

function makeDef(overrides: Partial<WebMcpToolDefinition> = {}): WebMcpToolDefinition {
  return {
    name: "invoice_list",
    description: "List invoices.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

/** Build a real TRPCClientError the way the httpLink does, from an error response. */
function trpcError(code: string, message: string, data: Record<string, unknown> = {}) {
  const response = { error: { code: -32600, message, data: { code, httpStatus: 400, ...data } } };
  return TRPCClientError.from(response as unknown as Error);
}

afterEach(() => {
  removeModelContext();
  vi.restoreAllMocks();
});

// ── Feature detection ──────────────────────────────────────────

describe("getModelContext", () => {
  it("prefers document.modelContext (the spec location)", () => {
    const doc = { registerTool: vi.fn() };
    const nav = { registerTool: vi.fn() };
    installModelContext(document, doc);
    installModelContext(navigator, nav);
    expect(getModelContext()).toBe(doc);
    expect(isWebMcpAvailable()).toBe(true);
  });

  it("falls back to navigator.modelContext (preview/polyfill surface)", () => {
    const nav = { registerTool: vi.fn() };
    installModelContext(navigator, nav);
    expect(getModelContext()).toBe(nav);
  });

  it("returns undefined when neither exists", () => {
    expect(getModelContext()).toBeUndefined();
    expect(isWebMcpAvailable()).toBe(false);
  });
});

// ── Result envelope ────────────────────────────────────────────

describe("toToolResult", () => {
  it("passes strings through untouched", () => {
    expect(toToolResult("Invoice INV-001 created")).toEqual({
      content: [{ type: "text", text: "Invoice INV-001 created" }],
    });
  });

  it("pretty-prints objects and serialises Dates as ISO", () => {
    const text = toToolResult({ at: new Date("2026-01-02T03:04:05.000Z") }).content[0].text;
    expect(text).toContain('"at": "2026-01-02T03:04:05.000Z"');
  });

  it("stringifies BigInt instead of throwing", () => {
    expect(toToolResult({ paise: 12345n }).content[0].text).toContain('"paise": "12345"');
  });

  it("truncates runaway output", () => {
    const text = toToolResult("x".repeat(60_000)).content[0].text;
    expect(text.length).toBeLessThan(60_000);
    expect(text.endsWith("… [truncated]")).toBe(true);
  });
});

// ── Error normalisation ────────────────────────────────────────

describe("toErrorResult", () => {
  it("marks every failure with isError", () => {
    expect(toErrorResult(new Error("boom")).isError).toBe(true);
  });

  it("phrases FORBIDDEN as a permission problem", () => {
    expect(toErrorResult(trpcError("FORBIDDEN", "Sellers cannot record expenses")).content[0].text).toBe(
      "Permission denied: Sellers cannot record expenses",
    );
  });

  it("phrases UNAUTHORIZED as a sign-in problem", () => {
    expect(toErrorResult(trpcError("UNAUTHORIZED", "Session expired")).content[0].text).toBe(
      "Authentication required: Session expired. Ask the user to sign in again.",
    );
  });

  it("phrases NOT_FOUND with the resource", () => {
    expect(toErrorResult(trpcError("NOT_FOUND", "Invoice INV-999")).content[0].text).toBe(
      "Not found: Invoice INV-999",
    );
  });

  it("expands BAD_REQUEST zod field errors", () => {
    const err = trpcError("BAD_REQUEST", "Input validation failed", {
      zodError: { fieldErrors: { amount: ["Must be positive"], partyId: ["Required"] } },
    });
    expect(toErrorResult(err).content[0].text).toBe(
      "Validation failed:\n  amount: Must be positive\n  partyId: Required",
    );
  });

  it("falls back to the message when BAD_REQUEST carries no zod detail", () => {
    expect(toErrorResult(trpcError("BAD_REQUEST", "Bad input")).content[0].text).toBe(
      "Validation failed:\n  _: Bad input",
    );
  });

  it("wraps a generic Error without leaking internals", () => {
    const err = new Error("Failed to fetch https://api.hisaabo.in/api/trpc/invoice.list");
    err.stack = "Error: secret stack\n  at internal";
    const text = toErrorResult(err).content[0].text;
    expect(text).toBe("API error: unable to reach the Hisaabo API. Check the network connection.");
    expect(text).not.toContain("api.hisaabo.in");
    expect(text).not.toContain("stack");
  });

  it("redacts URLs from arbitrary Error messages", () => {
    expect(toErrorResult(new Error("CORS blocked https://internal.host:3000/x")).content[0].text).toBe(
      "API error: CORS blocked the Hisaabo API",
    );
  });

  it("handles a non-Error throw", () => {
    expect(toErrorResult({ weird: true }).content[0].text).toBe("API error: an unexpected error occurred.");
  });
});

// ── Tool wrapping ──────────────────────────────────────────────

describe("buildBrowserTool", () => {
  it("wraps a successful call in the text envelope", async () => {
    const tool = buildBrowserTool(makeDef(), makeCtx());
    await expect(tool.execute({}, { signal: new AbortController().signal })).resolves.toEqual({
      content: [{ type: "text", text: '{\n  "ok": true\n}' }],
    });
  });

  it("copies name, title, description, schema and annotations", () => {
    const def = makeDef({ title: "List invoices", annotations: { readOnlyHint: true, untrustedContentHint: true } });
    const tool = buildBrowserTool(def, makeCtx());
    expect(tool.name).toBe(def.name);
    expect(tool.title).toBe("List invoices");
    expect(tool.description).toBe(def.description);
    expect(tool.inputSchema).toBe(def.inputSchema);
    expect(tool.annotations).toEqual(def.annotations);
  });

  it("does not invalidate after a read-only tool", async () => {
    const ctx = makeCtx();
    const tool = buildBrowserTool(makeDef({ annotations: { readOnlyHint: true } }), ctx);
    await tool.execute({}, { signal: new AbortController().signal });
    expect(ctx.invalidate).not.toHaveBeenCalled();
  });

  it("invalidates after a write tool", async () => {
    const ctx = makeCtx();
    const tool = buildBrowserTool(makeDef({ annotations: { consequentialHint: true } }), ctx);
    await tool.execute({}, { signal: new AbortController().signal });
    expect(ctx.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate when the write failed", async () => {
    const ctx = makeCtx();
    const tool = buildBrowserTool(
      makeDef({ annotations: {}, execute: async () => { throw trpcError("FORBIDDEN", "nope"); } }),
      ctx,
    );
    const result = await tool.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({ isError: true });
    expect(ctx.invalidate).not.toHaveBeenCalled();
  });

  it("swallows invalidate failures", async () => {
    const ctx = makeCtx({ invalidate: () => Promise.reject(new Error("cache blew up")) });
    const tool = buildBrowserTool(makeDef({ annotations: {} }), ctx);
    const result = (await tool.execute({}, { signal: new AbortController().signal })) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
  });

  it("defaults a missing input object to {}", async () => {
    const execute = vi.fn(async () => "ok");
    const tool = buildBrowserTool(makeDef({ execute }), makeCtx());
    await tool.execute(undefined as unknown as Record<string, unknown>, { signal: new AbortController().signal });
    expect(execute).toHaveBeenCalledWith({}, expect.anything());
  });
});

// ── Role gate ──────────────────────────────────────────────────

describe("selectToolsForRole", () => {
  const defs = [
    makeDef({ name: "invoice_list", requires: { resource: "Invoice", action: "read" } }),
    makeDef({ name: "expense_create", requires: { resource: "Expense", action: "create" } }),
    makeDef({ name: "whoami" }), // no gate
  ];

  it("hides tools a seller cannot use", () => {
    expect(selectToolsForRole(defs, "seller").map((d) => d.name)).toEqual(["invoice_list", "whoami"]);
  });

  it("gives an owner everything", () => {
    expect(selectToolsForRole(defs, "owner")).toHaveLength(3);
  });

  it("passes everything through while the role is still loading", () => {
    expect(selectToolsForRole(defs, null)).toHaveLength(3);
  });
});

// ── Registration ───────────────────────────────────────────────

describe("registerHisaaboTools", () => {
  it("registers every permitted tool with the abort signal", async () => {
    const { modelContext, registerTool } = fakeModelContext();
    installModelContext(document, modelContext);
    const controller = new AbortController();

    const result = await registerHisaaboTools(
      [makeDef({ name: "a" }), makeDef({ name: "b" })],
      makeCtx(),
      { signal: controller.signal },
    );

    expect(result.registered).toEqual(["a", "b"]);
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(registerTool.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("keeps going when one tool is rejected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { modelContext } = fakeModelContext(async (tool) => {
      if (tool.name === "bad") throw new Error("invalid schema");
    });
    installModelContext(document, modelContext);

    const result = await registerHisaaboTools(
      [makeDef({ name: "good" }), makeDef({ name: "bad" }), makeDef({ name: "alsoGood" })],
      makeCtx(),
      { signal: new AbortController().signal },
    );

    expect(result.registered).toEqual(["good", "alsoGood"]);
    expect(result.skipped).toEqual(["bad"]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("skips role-gated tools", async () => {
    const { modelContext, registerTool } = fakeModelContext();
    installModelContext(document, modelContext);

    const result = await registerHisaaboTools(
      [makeDef({ name: "expense_create", requires: { resource: "Expense", action: "create" } })],
      makeCtx({ role: "seller" }),
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ registered: [], skipped: ["expense_create"] });
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("reports everything skipped when the browser has no model context", async () => {
    const result = await registerHisaaboTools([makeDef({ name: "a" })], makeCtx(), {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ registered: [], skipped: ["a"] });
  });

  it("unregisters by name on abort when the surface has no signal support", async () => {
    const unregisterTool = vi.fn();
    // Single-argument registerTool = the pre-spec surface.
    installModelContext(document, {
      registerTool: async (_tool: WebMCP.ModelContextTool) => {},
      unregisterTool,
    });
    const controller = new AbortController();

    await registerHisaaboTools([makeDef({ name: "a" })], makeCtx(), { signal: controller.signal });
    expect(unregisterTool).not.toHaveBeenCalled();

    controller.abort();
    expect(unregisterTool).toHaveBeenCalledWith("a");
  });
});
