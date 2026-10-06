import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolRegistry } from "../lib/registry.js";
import { TOOL_META } from "../lib/toolMeta.js";
import { resolvePolicy } from "../lib/policy.js";
import { registerTools } from "../server.js";
import { fakeServer, registerWith, writeAdmin, callTool, throwingClient } from "./helpers.js";
import { z } from "zod";

const ADMIN_TOOLS = Object.entries(TOOL_META).filter(([, m]) => m.tier === "admin").map(([n]) => n);

describe("tool tiers", () => {
  it("registers every declared tool (and nothing undeclared) with annotations and a tier", () => {
    const { tools, registry } = registerWith(writeAdmin);
    expect([...tools.keys()].sort()).toEqual(Object.keys(TOOL_META).sort());
    expect(registry.registered.length).toBe(tools.size);
    for (const info of registry.registered) {
      expect(["read", "write", "admin"]).toContain(info.meta.tier);
      expect(typeof info.meta.destructive).toBe("boolean");
      const a = tools.get(info.name)!.annotations;
      expect(a).toMatchObject({ openWorldHint: false });
      for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint"]) {
        expect(typeof a[k]).toBe("boolean");
      }
    }
  });

  it("default mode is readonly: only read tools, no admin or write tools", () => {
    expect(resolvePolicy({})).toEqual({ mode: "readonly", adminEnabled: false });
    const { tools } = registerWith(resolvePolicy({}));
    for (const t of tools.values()) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(TOOL_META[t.name].tier).toBe("read");
    }
    for (const name of ["api_key_create", "api_key_list", "api_key_revoke", "session_revoke", "tenant_invite_member", "invoice_create", "invoice_delete"]) {
      expect(tools.has(name)).toBe(false);
    }
    expect(tools.has("invoice_list")).toBe(true);
  });

  it("write mode exposes mutations but never admin tools", () => {
    const { tools } = registerWith(resolvePolicy({ HISAABO_MCP_MODE: "write", HISAABO_MCP_ENABLE_ADMIN: "1" }));
    expect(tools.has("invoice_create")).toBe(true);
    expect(tools.has("invoice_delete")).toBe(true);
    for (const n of ADMIN_TOOLS) expect(tools.has(n)).toBe(false);
  });

  it("admin mode needs HISAABO_MCP_ENABLE_ADMIN=1 as well", () => {
    const without = registerWith(resolvePolicy({ HISAABO_MCP_MODE: "admin" })).tools;
    for (const n of ADMIN_TOOLS) expect(without.has(n)).toBe(false);
    expect(without.has("invoice_create")).toBe(true);
    const withFlag = registerWith(resolvePolicy({ HISAABO_MCP_MODE: "admin", HISAABO_MCP_ENABLE_ADMIN: "1" })).tools;
    for (const n of ADMIN_TOOLS) expect(withFlag.has(n)).toBe(true);
  });

  it("rejects an invalid mode", () => {
    expect(() => resolvePolicy({ HISAABO_MCP_MODE: "root" })).toThrow(/HISAABO_MCP_MODE/);
  });

  it("refuses to register a tool without metadata", () => {
    const { server } = fakeServer();
    const registry = createToolRegistry(server, writeAdmin);
    expect(() => registry.tool("brand_new_tool", "desc", {}, async () => ({ content: [] }))).toThrow(/TOOL_META/);
  });

  it("the real SDK accepts every registration (annotations included)", () => {
    const server = new McpServer({ name: "t", version: "0" });
    expect(() => registerTools(server, throwingClient(), writeAdmin)).not.toThrow();
    const internal = server as unknown as { _registeredTools: Record<string, { annotations?: unknown }> };
    expect(Object.keys(internal._registeredTools).length).toBe(Object.keys(TOOL_META).length);
    expect(Object.values(internal._registeredTools).every((t) => t.annotations)).toBe(true);
  });
});

describe("destructive tools require confirm", () => {
  const destructive = Object.entries(TOOL_META).filter(([, m]) => m.destructive).map(([n]) => n);

  it("declares destructiveHint and a confirm input on each", () => {
    const { tools } = registerWith(writeAdmin);
    expect(destructive.length).toBeGreaterThan(20);
    for (const n of destructive) {
      const t = tools.get(n)!;
      expect(t.annotations.destructiveHint).toBe(true);
      expect(Object.keys(t.shape)).toContain("confirm");
    }
  });

  it("returns an explanatory error and never calls the API without confirm=true", async () => {
    const { tools } = registerWith(writeAdmin);
    const id = "11111111-1111-4111-8111-111111111111";
    const result = await callTool(tools.get("invoice_delete")!, { invoice_id: id });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/Confirmation required/);
    expect(text).toMatch(/confirm=true/);
    // confirm literal must be exactly true
    expect(() => z.object(tools.get("invoice_delete")!.shape).parse({ invoice_id: id, confirm: "yes" })).toThrow();
  });
});
