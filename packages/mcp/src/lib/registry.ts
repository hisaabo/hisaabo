/**
 * Tool registry — the only way tools reach the MCP server.
 *
 * `registry.tool()` replaces `server.tool()` in every tool module and:
 *   - refuses (throws) to register a tool that has no entry in TOOL_META;
 *   - skips tools above the active tier (see policy.ts);
 *   - attaches MCP annotations derived from the metadata;
 *   - adds and enforces a `confirm: true` input on destructive tools;
 *   - fences every successful result as untrusted data.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_META, type ToolMeta } from "./toolMeta.js";
import { resolvePolicy, type ToolPolicy } from "./policy.js";
import { fenceText } from "./fence.js";

export interface RegisteredToolInfo {
  name: string;
  meta: ToolMeta;
  annotations: ToolAnnotations;
}

export interface ToolServer {
  tool<Args extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Args,
    handler: (input: z.objectOutputType<Args, z.ZodTypeAny>) => Promise<CallToolResult>,
  ): void;
}

export interface ToolRegistry extends ToolServer {
  readonly registered: RegisteredToolInfo[];
  readonly skipped: string[];
}

export function annotationsFor(meta: ToolMeta): ToolAnnotations {
  const readOnly = meta.tier === "read" || meta.readOnly === true;
  return {
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : meta.destructive,
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}

export function isTierEnabled(meta: ToolMeta, policy: ToolPolicy): boolean {
  switch (meta.tier) {
    case "read":
      return true;
    case "write":
      return policy.mode === "write" || policy.mode === "admin";
    case "admin":
      return policy.mode === "admin" && policy.adminEnabled;
  }
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : text).trim();
}

export function createToolRegistry(
  server: McpServer,
  policy: ToolPolicy = resolvePolicy(),
): ToolRegistry {
  const registered: RegisteredToolInfo[] = [];
  const skipped: string[] = [];

  return {
    registered,
    skipped,
    tool(name, description, shape, handler) {
      const meta = TOOL_META[name];
      if (!meta) {
        throw new Error(`Tool "${name}" has no entry in TOOL_META (lib/toolMeta.ts); declare its tier and destructiveness.`);
      }
      if (!isTierEnabled(meta, policy)) {
        skipped.push(name);
        return;
      }

      const annotations = annotationsFor(meta);
      const fullShape: z.ZodRawShape = meta.destructive
        ? {
            ...shape,
            confirm: z.literal(true).optional().describe(
              "Must be true. This action changes or removes data and cannot be assumed safe; ask the user to approve it first.",
            ),
          }
        : shape;

      const guarded = async (input: Record<string, unknown>): Promise<CallToolResult> => {
        if (meta.destructive && input?.confirm !== true) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text:
                `Confirmation required. "${name}" is a destructive or irreversible action: ${firstSentence(description)} ` +
                `Nothing was changed. Explain to the user exactly what will happen, and only if they explicitly agree call "${name}" again with confirm=true.`,
            }],
          };
        }
        const { confirm: _confirm, ...rest } = input;
        const result = await handler(rest as z.objectOutputType<typeof shape, z.ZodTypeAny>);
        if (result.isError) return result;
        return {
          ...result,
          content: result.content.map((c) =>
            c.type === "text" ? { ...c, text: fenceText(c.text) } : c,
          ),
        };
      };

      // The SDK's overloads are generic over the shape; erase them here.
      (server.tool as (...args: unknown[]) => unknown).call(server, name, description, fullShape, annotations, guarded);
      registered.push({ name, meta, annotations });
    },
  };
}
