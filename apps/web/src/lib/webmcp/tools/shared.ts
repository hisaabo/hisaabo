/**
 * Shared building blocks for the WebMCP tool catalog.
 *
 * Two jobs:
 *
 * 1. **Schema primitives** — the JSON Schema fragments (`MONEY`, `QTY`, `UUID`,
 *    …) that mirror the Zod validators in `@hisaabo/shared`. The server is the
 *    validator of record; these exist so the browser agent knows the shape
 *    *before* it spends a round trip on a 400.
 * 2. **Input readers** — `str()`, `enumOf()`, `page()` … narrow the untyped
 *    `Record<string, unknown>` the browser hands `execute()` into the exact
 *    types the tRPC client expects, dropping anything malformed rather than
 *    forwarding it.
 */

import type { JsonSchema } from "../types";

/**
 * Hard cap on rows returned by any list tool, mirroring
 * `packages/mcp/src/lib/pagination.ts`. Agents consume whole responses, so an
 * unbounded page would burn the model's context window (ADR-005).
 */
export const MAX_PAGE_SIZE = 25;

/** Money / rate: up to 13 integer digits and 2 decimals — `"1500.00"`. */
export const MONEY_PATTERN = "^\\d{1,13}(\\.\\d{1,2})?$";
/** Money that may be negative (opening balances, round-off) — `"-250.50"`. */
export const SIGNED_MONEY_PATTERN = "^-?\\d{1,13}(\\.\\d{1,2})?$";
/** Quantity: up to 3 decimals — `"7.500"`. */
export const QTY_PATTERN = "^\\d+(\\.\\d{1,3})?$";
/** Quantity that may be negative (opening stock corrections). */
export const SIGNED_QTY_PATTERN = "^-?\\d+(\\.\\d{1,3})?$";
/** RFC 4122 UUID as produced by every Hisaabo id. */
export const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
/** GSTIN, e.g. `22AAAAA0000A1Z5`. */
export const GSTIN_PATTERN = "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$";

/** ISO 8601 date-time string property (what every `*Date` tRPC input wants). */
export function isoDate(description: string): JsonSchema {
  return { type: "string", description: `${description} ISO 8601, e.g. '2026-04-01T00:00:00.000Z'.` };
}

/** UUID string property. */
export function uuid(description: string): JsonSchema {
  return { type: "string", pattern: UUID_PATTERN, description };
}

/** Decimal-string money property. */
export function money(description: string, signed = false): JsonSchema {
  return {
    type: "string",
    pattern: signed ? SIGNED_MONEY_PATTERN : MONEY_PATTERN,
    description,
  };
}

/** Enum string property. */
export function oneOf(values: readonly string[], description: string, dflt?: string): JsonSchema {
  return dflt === undefined
    ? { type: "string", enum: values, description }
    : { type: "string", enum: values, default: dflt, description };
}

/** 1-indexed page property shared by every list tool. */
export function pageProp(): JsonSchema {
  return {
    type: "integer",
    minimum: 1,
    default: 1,
    description: `Page number, 1-indexed. Each page returns at most ${MAX_PAGE_SIZE} rows; call again with page+1 while 'hasMore' is true.`,
  };
}

/** Free-text search property. */
export function searchProp(description: string): JsonSchema {
  return { type: "string", maxLength: 200, description };
}

/** What the server accepts as an idempotency key (mirrors `idempotencyKeySchema` in @hisaabo/shared). */
export const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9_.:-]{8,100}$";

/** Optional idempotency key property for create tools (invoice_create, payment_create). */
export function idempotencyKeyProp(): JsonSchema {
  return {
    type: "string",
    pattern: IDEMPOTENCY_KEY_PATTERN,
    description:
      "Optional, and strictly opt-in: without it every call creates a record. Pass a FRESH key (for example a new UUID) for every record you intend to create, and reuse that same key only to retry the same request after a timeout or an error you could not read. A retry with the same key and the same input returns the record the first call created, flagged idempotentReplay, instead of a duplicate. The same key with different input is an error. Never reuse a key for a different record: it will be treated as a repeat and nothing new will be created. 8-100 characters: letters, digits and _ . : -",
  };
}

/**
 * The key the agent asked for, or undefined. There is deliberately no derived or
 * default key: guessing one would silently swallow a legitimate second record
 * (two identical cash sales are two sales).
 */
export function idempotencyKeyOf(input: Record<string, unknown>): string | undefined {
  return str(input.idempotencyKey);
}

/** Throws if the agent sent a key the server would reject: better to say so before asking the user than to fail after. */
export function assertIdempotencyKey(input: Record<string, unknown>): void {
  if (input.idempotencyKey === undefined) return;
  const key = str(input.idempotencyKey);
  if (!key || !new RegExp(IDEMPOTENCY_KEY_PATTERN).test(key)) {
    throw new Error("idempotencyKey must be 8-100 characters: letters, digits and _ . : - (or leave it out).");
  }
}

/** What the agent is told when a call turned out to repeat an earlier one. */
export const REPLAY_NOTICE =
  "No new record was created; this matches an earlier request with the same idempotencyKey. Pass a new key to create another.";

/**
 * Wrap a create result for the agent. When the server says this call was a replay of
 * an earlier one (`idempotentReplay: true`), the result says so in plain words and
 * carries the existing record; otherwise it is returned unchanged.
 */
export function describeCreateResult(result: unknown): unknown {
  if (result && typeof result === "object" && (result as { idempotentReplay?: unknown }).idempotentReplay === true) {
    const { idempotentReplay: _flag, ...record } = result as Record<string, unknown>;
    return { idempotentReplay: true, notice: REPLAY_NOTICE, record };
  }
  return result;
}

/**
 * Build an input schema, guaranteeing the three invariants the catalog test
 * enforces: object type, explicit `required`, no extra keys.
 */
export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

/** The empty input schema, for tools that take no arguments. */
export function noInput(): JsonSchema {
  return objectSchema({}, []);
}

// ── Input readers ──────────────────────────────────────────────

/** Non-empty string, or undefined. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** One of `allowed`, or undefined — narrows to the literal union for tRPC. */
export function enumOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Array of `allowed` members (empty → undefined), for multi-select filters. */
export function enumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const picked = value.filter(
    (v): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v),
  );
  return picked.length > 0 ? picked : undefined;
}

/** Finite integer, or undefined. */
export function int(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/** Boolean, or undefined (a missing flag must not become `false`). */
export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Page number: at least 1, defaulting to 1. */
export function page(value: unknown): number {
  const n = int(value);
  return n !== undefined && n >= 1 ? n : 1;
}

/** Array of plain objects (line items, allocations), or undefined. */
export function objectArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (v): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v),
  );
}

// ── Response shaping ───────────────────────────────────────────

interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Add `hasMore` so the agent knows whether another page exists instead of
 * guessing from `data.length`.
 */
export function withPaginationMeta<T>(
  result: PagedResult<T>,
): PagedResult<T> & { hasMore: boolean } {
  return { ...result, hasMore: result.total > result.page * result.limit };
}

/** Local calendar date as `YYYY-MM-DD` (never UTC-shifted). */
export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
