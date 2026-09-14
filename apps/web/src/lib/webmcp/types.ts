/**
 * WebMCP — shared contract for the in-browser tool layer.
 *
 * WebMCP (W3C Web Machine Learning CG draft, https://github.com/webmachinelearning/webmcp)
 * lets a web page register typed tools with the *browser's* AI agent
 * (Gemini in Chrome, Copilot in Edge, ChatGPT Desktop, …) via
 * `document.modelContext.registerTool(...)`. The agent runs on the user's own
 * subscription; the page only exposes tools. Every tool here executes with the
 * user's existing cookie session and `x-business-id`, so the API applies the
 * same auth, role checks, validation and audit logging as a button click.
 *
 * Naming mirrors `packages/mcp` (`invoice_list`, `party_create`, …) so a user
 * who reads the MCP docs sees the same vocabulary in the browser. Parameter
 * names are camelCase and pass straight through to the tRPC input schemas in
 * `@hisaabo/shared` — the server is the validator of record.
 */

import type { trpc } from "@/lib/trpc";

/** The vanilla (non-React) tRPC client exposed by `trpc.useUtils().client`. */
export type WebMcpTrpcClient = ReturnType<typeof trpc.useUtils>["client"];

/** Minimal JSON Schema subset we hand-write for tool inputs. */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  additionalProperties?: boolean;
}

/** Subset of the spec's ToolAnnotations (see webmcp.d.ts). */
export interface WebMcpAnnotations {
  /** Tool only reads data; never mutates. */
  readOnlyHint?: boolean;
  /** Tool performs a consequential, real-world or hard-to-reverse action (creating an invoice, recording money). */
  consequentialHint?: boolean;
  /** Tool returns content that originated from third parties (party names, invoice notes) and may contain prompt injection. */
  untrustedContentHint?: boolean;
}

/** Role gate — mirrors `canAccess()` in `@/lib/roles`. */
export interface WebMcpPermission {
  resource: string;
  action: "read" | "create" | "update" | "delete" | "manage";
}

/** Everything a tool's execute() may touch. Built once per registration by the hook. */
export interface WebMcpToolContext {
  client: WebMcpTrpcClient;
  /** Tenant role of the signed-in user (owner, admin, seller_manager, seller, accountant). */
  role: string | null;
  businessId: string | null;
  businessName: string | null;
  userName: string | null;
  /** Current SPA path, e.g. "/invoices". */
  pathname: string;
  /** Navigate the SPA (TanStack Router). `search` maps to URL search params. */
  navigate: (to: string, search?: Record<string, string>) => void;
  /** Invalidate every react-query cache entry so the UI reflects agent writes. */
  invalidate: () => Promise<void> | void;
}

/**
 * A Hisaabo tool definition. `execute` returns plain JSON-serialisable data
 * (or a string); the runtime wraps it in the WebMCP `{ content: [{ type: "text", text }] }`
 * envelope and normalises thrown tRPC errors into an `isError` result.
 */
export interface WebMcpToolDefinition {
  /** 1–128 chars, `[A-Za-z0-9_.-]`. Use snake_case matching packages/mcp. */
  name: string;
  /** Short human title shown by the browser agent UI. */
  title?: string;
  /** Agent-facing description: when to use it, units (decimal strings), examples. */
  description: string;
  inputSchema: JsonSchema;
  annotations: WebMcpAnnotations;
  /** Omit to allow every signed-in member. */
  requires?: WebMcpPermission;
  execute: (input: Record<string, unknown>, ctx: WebMcpToolContext) => Promise<unknown>;
}

/** Wire shape the browser expects back from execute(). */
export interface WebMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
