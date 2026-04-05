import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "../prompts/index.js";

describe("registerPrompts", () => {
  it("registers without throwing", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });

    expect(() => registerPrompts(server)).not.toThrow();
  });

  it("registers all six prompt templates", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerPrompts(server);

    // The McpServer stores registered prompts in an internal _registeredPrompts
    // object (keyed by name). Since this is an internal detail, we use a type
    // assertion to access it for verification.
    const internal = server as unknown as {
      _registeredPrompts: Record<string, unknown>;
    };
    const prompts = internal._registeredPrompts;

    expect(prompts).toBeDefined();

    const names = Object.keys(prompts);
    expect(names).toHaveLength(6);
    expect(names).toContain("morning_briefing");
    expect(names).toContain("party_deep_dive");
    expect(names).toContain("gst_filing_prep");
    expect(names).toContain("collection_follow_up");
    expect(names).toContain("inventory_health");
    expect(names).toContain("month_close");
  });
});
