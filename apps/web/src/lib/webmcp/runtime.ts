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

import { defineAbilityFor, stripControlChars } from "@hisaabo/shared";
import {
  describeSummary,
  isConfirmHostMounted,
  requestConfirmation,
  requestToPlainText,
  summarizeInput,
  type ConfirmRequest,
} from "./confirm";
import { consumeWrite, isWriteBudgetExhausted, writeBudgetExhaustedMessage, writesRemaining } from "./budget";
import { fenceValue } from "./fence";
import type {
  WebMcpConfirmSummary,
  WebMcpToolContext,
  WebMcpToolDefinition,
  WebMcpToolResult,
} from "./types";

/** Browser agents paste tool output into a prompt; a runaway list must not eat the context window. */
const MAX_TEXT_CHARS = 50_000;
const TRUNCATION_NOTE = "\n… [truncated]";

// ── Write throttling ───────────────────────────────────────────

/** Approved writes the agent may START per minute (refilled continuously, burst of the same size). */
export const WRITE_LIMIT_PER_MINUTE = 10;

/** Continuous refill accumulates floating-point error; a token that is 1e-9 short is a token. */
const EPSILON = 1e-9;

/**
 * A token bucket: `capacity` tokens, refilled at `capacity` per minute. Pure and
 * clock-injectable so the rate rule can be tested without waiting a minute.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 60_000) * this.capacity);
    this.last = t;
  }

  /** Milliseconds until a token is available (0 when one is). Takes nothing. */
  retryAfterMs(): number {
    this.refill();
    return this.tokens >= 1 - EPSILON ? 0 : Math.ceil(((1 - this.tokens) / this.capacity) * 60_000);
  }

  /** Take one token; false (and nothing taken) when the bucket is empty. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens < 1 - EPSILON) return false;
    this.tokens = Math.max(0, this.tokens - 1);
    return true;
  }
}

let writeBucket = new TokenBucket(WRITE_LIMIT_PER_MINUTE);

/** Writes run one at a time: a second call waits for the first to finish (see runExclusive). */
let writeChain: Promise<unknown> = Promise.resolve();

/** Test hook: start from a full bucket and an idle queue. */
export function resetWriteThrottle(now?: () => number): void {
  writeBucket = new TokenBucket(WRITE_LIMIT_PER_MINUTE, now);
  writeChain = Promise.resolve();
}

/**
 * Run `task` after every earlier write has settled. Serialising writes is what
 * makes a duplicated tool call safe: the second one reaches the server only after
 * the first has committed, so the idempotency key sees it and returns the first
 * record. Confirmation prompts are NOT inside this queue (they queue in the host,
 * where the user can see and deny them all at once); only the execution is.
 */
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

function rateLimitedResult(retryAfterMs: number): WebMcpToolResult {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return {
    content: [
      {
        type: "text",
        text: `Too many writes: the limit is ${WRITE_LIMIT_PER_MINUTE} per minute. Nothing was changed. Wait about ${seconds} second${seconds === 1 ? "" : "s"}, then retry, and only if the user still wants it.`,
      },
    ],
    isError: true,
  };
}

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

/**
 * Wrap a tool's return value in the spec's `{ content: [{ type: "text", … }] }`
 * envelope. The value is fenced as untrusted data first: strings are
 * truncated and stripped of control characters, and the envelope tells the
 * agent the fields are data, never instructions.
 */
export function toToolResult(value: unknown): WebMcpToolResult {
  return { content: [{ type: "text", text: capText(stringifyValue(fenceValue(value))) }] };
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
  /** Set by the HTTP link: the raw response, which is all we get when the API's rate limiter answers outside tRPC. */
  meta?: { response?: { status?: number } } | null;
}

function asTrpcError(err: unknown): TrpcLikeError | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as Record<string, unknown>;
  if (typeof candidate.message !== "string") return null;
  const named = candidate.name === "TRPCClientError";
  const data = candidate.data;
  const hasCode = !!data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string";
  const rateLimited = (candidate.meta as TrpcLikeError["meta"])?.response?.status === 429;
  return named || hasCode || rateLimited ? (err as unknown as TrpcLikeError) : null;
}

/** Strip anything that identifies our infrastructure before the agent sees it. */
function sanitize(message: string): string {
  return stripControlChars(message.replace(/\b(?:https?|wss?):\/\/\S+/gi, "the Hisaabo API")).trim();
}

function formatValidation(fields: Record<string, string[] | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
    .map(([field, msgs]) => `  ${field}: ${(msgs as string[]).join(", ")}`);
  return lines.length > 0 ? `Validation failed:\n${lines.join("\n")}` : "Validation failed: the input was rejected.";
}

function formatAgentError(err: unknown): string {
  const trpcErr = asTrpcError(err);
  // The API's rate limiter answers 429 before tRPC, so the client sees a parse
  // error with the response attached rather than a TOO_MANY_REQUESTS code.
  if (trpcErr?.meta?.response?.status === 429) {
    return "Too many requests: slow down and try again in a moment.";
  }
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

/**
 * Ask the user before a non-read-only tool runs. Uses the agent's
 * `requestUserInteraction` when the browser provides it (so the prompt is
 * attributed correctly), otherwise a native confirm. Anything other than an
 * explicit yes — including no dialog being available — denies the write.
 */
export async function confirmWrite(
  def: WebMcpToolDefinition,
  input: Record<string, unknown>,
  options?: WebMCP.ToolExecuteCallbackOptions,
  ctx?: WebMcpToolContext,
): Promise<boolean> {
  const request = await buildConfirmRequest(def, input, ctx);
  const ask = async (): Promise<boolean> => {
    if (isConfirmHostMounted()) return requestConfirmation(request);
    return typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(requestToPlainText(request)) === true
      : false;
  };
  try {
    if (typeof options?.requestUserInteraction === "function") {
      return (await options.requestUserInteraction(ask)) === true;
    }
    return await ask();
  } catch {
    return false;
  }
}

/** Longest a tool may take to resolve names for its summary before the dialog falls back to the plain one. */
const SUMMARIZE_TIMEOUT_MS = 4_000;

/**
 * What the dialog will say. The tool's own `summarize` resolves UUIDs into names,
 * totals and before → after diffs; if it is absent, slow, fails or returns
 * nothing, the generic one-line summary of the raw input is used instead. The
 * business name is in the title so the person sees WHERE the write will land.
 */
async function buildConfirmRequest(
  def: WebMcpToolDefinition,
  input: Record<string, unknown>,
  ctx?: WebMcpToolContext,
): Promise<ConfirmRequest> {
  const businessName = ctx?.businessName ? stripControlChars(ctx.businessName).trim() : "";
  const action = stripControlChars(def.title ?? def.name);
  const title = `Allow AI agent: ${action}${businessName ? ` in ${businessName}` : ""}?`;

  let summary: WebMcpConfirmSummary | null = null;
  if (def.summarize && ctx) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      summary = await Promise.race([
        def.summarize(input, ctx),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SUMMARIZE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      summary = null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const writesLeft = writesRemaining();
  const described = summary ? describeSummary(summary) : null;
  if (described && described.description) {
    return { title, ...described, writesLeft, signal: ctx?.signal };
  }
  return {
    title,
    description: `A browser AI agent wants to change your Hisaabo data. ${summarizeInput(input)}`,
    writesLeft,
    signal: ctx?.signal,
  };
}

/**
 * Why a call must not run any more, or null when its registration is still the
 * live one.
 *
 * A registration is bound to one user, role and business. It ends — and its
 * `signal` aborts — on a business switch, sign-out, the preference being turned
 * off or the role changing. The browser also unregisters the tools then, but a
 * call that was already in flight (or parked in a confirmation dialog) still
 * holds this context, so the runtime checks again at the two moments that
 * matter: before asking, and after the user answered. The business comparison is
 * a second, independent check against what the app is showing right now.
 */
function staleReason(ctx: WebMcpToolContext, options?: WebMCP.ToolExecuteCallbackOptions): string | null {
  if (options?.signal?.aborted) return "The agent cancelled this call.";
  if (ctx.signal?.aborted) {
    return "Hisaabo's agent session was reset while this call was waiting (the business was switched, the user signed out, or agent access was turned off).";
  }
  const active = ctx.activeBusinessId?.();
  if (ctx.businessId && active !== undefined && active !== ctx.businessId) {
    return `The user switched business while this call was waiting, so it no longer matches the business it was prepared for${ctx.businessName ? ` (${stripControlChars(ctx.businessName)})` : ""}.`;
  }
  return null;
}

function staleResult(reason: string): WebMcpToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${reason} Nothing was changed. Call hisaabo_context to see the current business, and only retry if the user still wants it.`,
      },
    ],
    isError: true,
  };
}

/**
 * Anything that is not explicitly marked read-only is treated as a write: it
 * asks the user for confirmation, refreshes the UI afterwards, and is withheld
 * until the signed-in role is known (see selectToolsForRole).
 */
export function isWriteTool(def: WebMcpToolDefinition): boolean {
  return !def.annotations?.readOnlyHint;
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
    execute: async (input, options) => {
      try {
        const staleBefore = staleReason(ctx, options);
        if (staleBefore) return staleResult(staleBefore);

        const isWrite = isWriteTool(def);
        // Do not even ask the user for something the session has no budget left to do.
        if (isWrite && isWriteBudgetExhausted()) {
          return { content: [{ type: "text", text: writeBudgetExhaustedMessage() }], isError: true };
        }
        // Likewise for the per-minute rate: refuse before bothering the user.
        if (isWrite && writeBucket.retryAfterMs() > 0) return rateLimitedResult(writeBucket.retryAfterMs());
        if (isWrite) {
          const allowed = await confirmWrite(def, input ?? {}, options, ctx);
          // Re-check after the (possibly long) wait: the user may have switched
          // business or signed out while the dialog was open. Checked before the
          // answer so a prompt denied by a reset reads as a reset, not a refusal.
          const staleAfter = staleReason(ctx, options);
          if (staleAfter) return staleResult(staleAfter);
          if (!allowed) {
            return {
              content: [{ type: "text", text: "The user declined this action. Nothing was changed. Do not retry unless the user asks." }],
              isError: true,
            };
          }
          // Executing is serialised and metered. The token and the budget are spent
          // on approval, not on success: a loop of writes the API keeps rejecting
          // must not be free.
          return await runExclusive(async () => {
            const again = staleReason(ctx, options);
            if (again) return staleResult(again);
            if (!writeBucket.tryTake()) return rateLimitedResult(writeBucket.retryAfterMs());
            if (!consumeWrite()) {
              return { content: [{ type: "text", text: writeBudgetExhaustedMessage() }], isError: true } as WebMcpToolResult;
            }
            const written = await def.execute(input ?? {}, ctx);
            fireInvalidate(ctx);
            return toToolResult(written);
          });
        }
        const value = await def.execute(input ?? {}, ctx);
        return toToolResult(value);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  };
}

// ── Registration ───────────────────────────────────────────────

/**
 * Drop tools the signed-in role cannot use, so the agent never offers a guaranteed 403.
 *
 * Fails closed while the role is unknown (session still loading, or a user
 * with no membership): only read-only tools are offered, because `requires`
 * cannot be checked without a role and a write tool must never be exposed on
 * a guess. useWebMcp re-registers when the role resolves, which adds the
 * write tools that role is allowed. The API enforces permissions either way.
 */
export function selectToolsForRole(
  defs: readonly WebMcpToolDefinition[],
  role: string | null | undefined,
): WebMcpToolDefinition[] {
  if (!role) return defs.filter((def) => !isWriteTool(def));
  const ability = defineAbilityFor(role);
  return defs.filter((def) => !def.requires || ability.can(def.requires.action, def.requires.resource));
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
