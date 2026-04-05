import { describe, it, expect } from "vitest";
import { wrapTool } from "../lib/errors.js";
import { HisaaboApiError } from "../client.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describe("wrapTool", () => {
  it("passes through a successful result unchanged", async () => {
    const expected: CallToolResult = {
      content: [{ type: "text", text: '{"ok":true}' }],
    };
    const handler = wrapTool(async () => expected);

    const result = await handler({});

    expect(result).toEqual(expected);
  });

  it("converts HisaaboApiError (not_found) to isError with formatted message", async () => {
    const handler = wrapTool(async () => {
      throw new HisaaboApiError({ code: "not_found", resource: "Invoice #42" });
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Not found");
    expect(text).toContain("Invoice #42");
  });

  it("converts HisaaboApiError (validation_failed) to isError with field details", async () => {
    const handler = wrapTool(async () => {
      throw new HisaaboApiError({
        code: "validation_failed",
        fields: {
          amount: ["must be a positive number"],
          party_id: ["is required"],
        },
      });
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Validation failed");
    expect(text).toContain("amount");
    expect(text).toContain("must be a positive number");
    expect(text).toContain("party_id");
  });

  it("converts HisaaboApiError (unauthorized) to isError with auth guidance", async () => {
    const handler = wrapTool(async () => {
      throw new HisaaboApiError({ code: "unauthorized", message: "Session expired" });
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Authentication required");
    expect(text).toContain("HISAABO_API_KEY");
  });

  it("sanitizes network errors — ECONNREFUSED does not leak host/port", async () => {
    const handler = wrapTool(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:3000");
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Unable to connect");
    // Must NOT leak the raw IP/port from the error
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain(":3000");
    // Must not leak stack traces (check for typical stack frame pattern)
    expect(text).not.toMatch(/\bat \w+\.\w+ \(/);
    expect(text).not.toContain(".ts:");
  });

  it("converts non-Error thrown values to generic api_error", async () => {
    const handler = wrapTool(async () => {
      throw "string error"; // eslint-disable-line no-throw-literal
    });

    const result = await handler({});

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("API error");
    expect(text).toContain("unexpected error");
  });
});
