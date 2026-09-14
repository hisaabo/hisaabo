/**
 * WebMCP runtime — the framework-free half of browser-agent support.
 *
 * Everything that is *not* React lives here: feature detection, the result
 * envelope, error wording, the role gate and registration. Keeping it out of
 * the hook means the rules an agent actually experiences can be unit-tested
 * without a renderer, and there is exactly one place where a tool's return
 * value becomes agent-visible text.
 *
 * Error wording deliberately mirrors `formatHisaaboError` in
 * `packages/mcp/src/client.ts` so that a user who reads the desktop MCP docs
 * meets the same sentences in the browser. The agent is an untrusted reader:
 * it never sees stack traces, URLs or hostnames — only what a support person
 * could safely say out loud.
 */

import { canAccess } from "@/lib/roles";
import type {
  WebMcpToolContext,
  WebMcpToolDefinition,
  WebMcpToolResult,
} from "./types";

/** Browser agents paste tool output into a prompt; a runaway list must not eat the context window. */
const MAX_TEXT_CHARS = 50_000;
const TRUNCATION_NOTE = "\n… [truncated]";

// ── Feature detection ──────────────────────────────────────────

/**
 * The page's model context, if the browser (or a polyfill) exposes one.
 *
 * `document.modelContext` is the spec location; `navigator.modelContext` is
 * the Chrome 146 preview surface and what @mcp-b/global installs. Guarded for
 * SSR / worker contexts where neither global exists.
 */
export function getModelContext(): WebMCP.ModelContext | undefined {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
  return undefined;
}

export function isWebMcpAvailable(): boolean {
  return getModelContext() !== undefined;
}

// ── Result envelopes ───────────────────────────────────────────

/** Wrap a tool's return value in the spec's `{ content: [{ type: "text", … }] }` envelope. */
export function toToolResult(value: unknown): WebMcpToolResult {
  return { content: [{ type: "text", text: capText(stringifyValue(value)) }] };
}

/** Wrap a thrown value as an agent-readable failure. Never leaks internals. */
export function toErrorResult(err: unknown): WebMcpToolResult {
  return {
    content: [{ type: "text", text: capText(formatAgentError(err)) }],
    isError: true,
  };
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  // A void mutation resolving to undefined has nothing to say; "undefined" would
  // read as a bug to the agent.
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, jsonReplacer, 2) ?? "";
  } catch {
    // Circular structure or an exotic value — better a rough string than a throw.
    return String(value);
  }
}

/** Dates serialise via their own toJSON (ISO); BigInt would otherwise throw. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function capText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + TRUNCATION_NOTE;
}

// ── Error normalisation ────────────────────────────────────────

/** The parts of a `TRPCClientError` we rely on, duck-typed so a duplicated @trpc/client copy still matches. */
interface TrpcLikeError {
  message: string;
  data?: { code?: string; zodError?: { fieldErrors?: Record<string, string[]> } | null } | null;
}

function asTrpcError(err: unknown): TrpcLikeError | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as Record<string, unknown>;
  if (typeof candidate.message !== "string") return null;
  const named = candidate.name === "TRPCClientError";
  const data = candidate.data;
  const hasCode = !!data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string";
  return named || hasCode ? (err as unknown as TrpcLikeError) : null;
}

/** Strip anything that identifies our infrastructure before the agent sees it. */
function sanitize(message: string): string {
  return message.replace(/\b(?:https?|wss?):\/\/\S+/gi, "the Hisaabo API").trim();
}

function formatValidation(fields: Record<string, string[] | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
    .map(([field, msgs]) => `  ${field}: ${(msgs as string[]).join(", ")}`);
  return lines.length > 0 ? `Validation failed:\n${lines.join("\n")}` : "Validation failed: the input was rejected.";
}

function formatAgentError(err: unknown): string {
  const trpcErr = asTrpcError(err);
  if (trpcErr) {
    const message = sanitize(trpcErr.message || "Unknown error");
    switch (trpcErr.data?.code) {
      case "UNAUTHORIZED":
        return `Authentication required: ${message}. Ask the user to sign in again.`;
      case "FORBIDDEN":
        return `Permission denied: ${message}`;
      case "NOT_FOUND":
        return `Not found: ${message}`;
      case "BAD_REQUEST":
      case "PARSE_ERROR":
        return formatValidation(trpcErr.data?.zodError?.fieldErrors ?? { _: [message] });
      case "CONFLICT":
        return `Conflict: ${message}`;
      case "TOO_MANY_REQUESTS":
        return "Too many requests: slow down and try again in a moment.";
      case "TIMEOUT":
        return "API error: the request timed out. Try again.";
      default:
        return `API error: ${message}`;
    }
  }

  if (err instanceof Error) {
    if (err.name === "AbortError") return "API error: the request was cancelled.";
    if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
      return "API error: unable to reach the Hisaabo API. Check the network connection.";
    }
    return `API error: ${sanitize(err.message)}`;
  }

  if (typeof err === "string" && err.trim()) return `API error: ${sanitize(err)}`;
  return "API error: an unexpected error occurred.";
}

// ── Tool wrapping ──────────────────────────────────────────────

/** Refresh react-query after a write so the open UI matches what the agent just did. */
function fireInvalidate(ctx: WebMcpToolContext): void {
  try {
    void Promise.resolve(ctx.invalidate()).catch(() => {});
  } catch {
    // A stale cache is never worth failing the agent's call over.
  }
}

/** Adapt one Hisaabo definition into the shape `registerTool` expects. */
export function buildBrowserTool(
  def: WebMcpToolDefinition,
  ctx: WebMcpToolContext,
): WebMCP.ModelContextTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    execute: async (input) => {
      try {
        const value = await def.execute(input ?? {}, ctx);
        if (!def.annotations?.readOnlyHint) fireInvalidate(ctx);
        return toToolResult(value);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  };
}

// ── Registration ───────────────────────────────────────────────

/** Drop tools the signed-in role cannot use, so the agent never offers a guaranteed 403. */
export function selectToolsForRole(
  defs: readonly WebMcpToolDefinition[],
  role: string | null | undefined,
): WebMcpToolDefinition[] {
  return defs.filter((def) => !def.requires || canAccess(role, def.requires.resource, def.requires.action));
}

export interface RegisterToolsResult {
  registered: string[];
  skipped: string[];
}

/**
 * Register every permitted tool with the browser.
 *
 * Sequential on purpose: implementations validate schemas during registration
 * and a rejected tool must not take the rest down with it, so each one is
 * awaited and caught individually.
 */
export async function registerHisaaboTools(
  defs: readonly WebMcpToolDefinition[],
  ctx: WebMcpToolContext,
  options: { signal: AbortSignal },
): Promise<RegisterToolsResult> {
  const registered: string[] = [];
  const skipped: string[] = [];

  const modelContext = getModelContext();
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    return { registered, skipped: defs.map((def) => def.name) };
  }

  const allowed = selectToolsForRole(defs, ctx.role);
  const allowedNames = new Set(allowed.map((def) => def.name));
  for (const def of defs) {
    if (!allowedNames.has(def.name)) skipped.push(def.name);
  }

  // Older preview surfaces take only the tool argument and unregister by name;
  // the arity tells us which contract we are talking to.
  const manualUnregister =
    modelContext.registerTool.length < 2 && typeof modelContext.unregisterTool === "function";

  for (const def of allowed) {
    if (options.signal.aborted) {
      skipped.push(def.name);
      continue;
    }
    try {
      await modelContext.registerTool(buildBrowserTool(def, ctx), { signal: options.signal });
      registered.push(def.name);
      if (manualUnregister) {
        options.signal.addEventListener(
          "abort",
          () => {
            try {
              modelContext.unregisterTool?.(def.name);
            } catch {
              // Already gone (navigation, polyfill teardown) — nothing to do.
            }
          },
          { once: true },
        );
      }
    } catch (err) {
      skipped.push(def.name);
      console.warn(`[webmcp] could not register tool "${def.name}"`, err);
    }
  }

  if (import.meta.env.DEV && registered.length > 0) {
    console.info(`[webmcp] registered ${registered.length} tools`);
  }

  return { registered, skipped };
}
