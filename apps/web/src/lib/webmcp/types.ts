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

import type { Action, Resource } from "@hisaabo/shared";
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
  /**
   * Tool returns content that originated from third parties (party names, invoice notes) and may contain prompt injection.
   * Set on every read that returns records AND on every write that echoes the saved record back: the text of the record
   * (a party's name, a payment's note) comes straight back in the result.
   */
  untrustedContentHint?: boolean;
}

/** Role gate — checked with `defineAbilityFor` from `@hisaabo/shared`, the same matrix the API enforces. */
export interface WebMcpPermission {
  resource: Resource;
  action: Action;
}

/**
 * Everything a tool's execute() may touch. Built once per registration by the hook.
 *
 * A registration belongs to one signed-in user, one role and ONE business.
 * `client` is pinned to that business (see client.ts), and `signal` aborts the
 * moment the registration is torn down, so the runtime can refuse to run a call
 * that outlived the business, session or preference it was offered under.
 */
export interface WebMcpToolContext {
  /** Pinned to `businessId`: every request it makes carries that business, whatever the app shows now. */
  client: WebMcpTrpcClient;
  /** Aborts when this registration is torn down: business switch, sign-out, preference off, role change. */
  signal: AbortSignal;
  /** The business the app is showing right now; compared with `businessId` after a confirmation. */
  activeBusinessId: () => string | null;
  /** Tenant role of the signed-in user (owner, admin, seller_manager, seller, accountant). */
  role: string | null;
  /** The business this registration is bound to. */
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

/** One field of an update, as the person reads it: "Status: draft → sent". */
export interface WebMcpConfirmChange {
  field: string;
  before: string;
  after: string;
}

/**
 * What the confirmation dialog says about a write, in the person's terms: the
 * party's name instead of its UUID, the invoice total, the fields an update
 * changes. Built by a tool's optional `summarize`.
 */
export interface WebMcpConfirmSummary {
  /** One sentence: "Create a sale invoice for Acme Traders". */
  headline: string;
  /** Supporting facts, one per line: "Total: ₹17,700.00 (2 lines)". */
  details?: string[];
  /** Field-level before → after, for updates. */
  changes?: WebMcpConfirmChange[];
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
  /**
   * Write tools only. Reject input the tool can already tell is unusable (a missing id,
   * an enum value it refuses) by throwing an agent-readable Error. It runs BEFORE the
   * user is asked: a prompt for something certain to fail teaches people to click
   * Allow without reading. `execute` runs the same checks, so calling it directly is
   * still safe.
   */
  validate?: (input: Record<string, unknown>, ctx: WebMcpToolContext) => void;
  /**
   * Write tools only. Resolve the input into what a person needs to approve it
   * (names, totals, before → after). Return null to fall back to the plain input
   * summary. It may read (that is how names are resolved) but must never write.
   */
  summarize?: (input: Record<string, unknown>, ctx: WebMcpToolContext) => Promise<WebMcpConfirmSummary | null>;
  execute: (input: Record<string, unknown>, ctx: WebMcpToolContext) => Promise<unknown>;
}

/** Wire shape the browser expects back from execute(). */
export interface WebMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
