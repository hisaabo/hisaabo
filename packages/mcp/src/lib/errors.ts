/**
 * MCP tool error normalization.
 *
 * All tool handlers are wrapped with wrapTool() so errors are returned as
 * structured MCP content rather than thrown exceptions. The model only sees
 * errors we recognise (API envelope errors, connectivity failures); anything
 * else collapses to a generic message and the detail goes to stderr only.
 * Mirrors sanitize() in apps/web/src/lib/webmcp/runtime.ts.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { stripControlChars } from "@hisaabo/shared";
import { HisaaboApiError, formatHisaaboError, type HisaaboError } from "../client.js";

type ToolHandler<T> = (input: T) => Promise<CallToolResult>;

/** Strip anything that identifies infrastructure before the model sees it. */
export function sanitize(message: string): string {
  return stripControlChars(message.replace(/\b(?:https?|wss?):\/\/\S+/gi, "the Hisaabo API")).trim();
}

/**
 * Wrap a tool handler in error normalization.
 *
 * - Successful calls pass through unchanged.
 * - HisaaboApiError is translated to a structured, agent-readable error message.
 * - Any other thrown error is collapsed to a generic message (no stack traces,
 *   hostnames or internals) and logged to stderr.
 */
export function wrapTool<T>(handler: ToolHandler<T>): ToolHandler<T> {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (err) {
      if (!(err instanceof HisaaboApiError)) {
        process.stderr.write(`[hisaabo-mcp] tool error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      }
      return {
        isError: true,
        content: [{ type: "text" as const, text: sanitize(formatHisaaboError(toHisaaboError(err))) }],
      };
    }
  };
}

function toHisaaboError(err: unknown): HisaaboError {
  if (err instanceof HisaaboApiError) {
    return err.hisaaboError;
  }
  if (err instanceof Error) {
    const causeCode = (err.cause as { code?: unknown } | undefined)?.code;
    const text = `${err.message} ${typeof causeCode === "string" ? causeCode : ""}`;
    if (text.includes("ECONNREFUSED") || text.includes("ETIMEDOUT")) {
      return { code: "api_error", message: "Unable to connect to the Hisaabo API. Check that the server is running and HISAABO_API_URL is correct." };
    }
    if (text.includes("ENOTFOUND")) {
      return { code: "api_error", message: "Cannot resolve the Hisaabo API hostname. Check HISAABO_API_URL." };
    }
    if (err.name === "AbortError" || err.name === "TimeoutError" || err.message.includes("timeout")) {
      return { code: "api_error", message: "Request to the Hisaabo API timed out (30s). The server may be overloaded." };
    }
  }
  return { code: "api_error", message: "An unexpected error occurred. Details were written to the MCP server's stderr log." };
}
