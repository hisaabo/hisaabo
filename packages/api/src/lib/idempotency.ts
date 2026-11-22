/**
 * Idempotency for create mutations (invoice.create, payment.create).
 *
 * An agent that times out and retries, or fires the same call twice, must not
 * book the same invoice or payment twice. The caller passes an optional
 * `idempotencyKey`; this module makes "same key, same input" return the record
 * the first call created, and "same key, different input" a CONFLICT.
 *
 * HOW IT STAYS CORRECT
 *
 *   claimIdempotencyKey()     runs as the FIRST statement of the creating
 *                             transaction. It inserts a claim row; the unique
 *                             index (business, user, procedure, key) is the lock.
 *   completeIdempotencyKey()  runs as the LAST statement, storing the response on
 *                             the claim row, in the same transaction.
 *
 * Because claim and record commit or roll back together there is no "in
 * progress" state to get stuck in: if the create fails, the claim vanishes and a
 * retry runs normally; if two requests race, the second INSERT blocks on the
 * unique index until the first commits, then sees the committed row and replays
 * it. A replay returns BEFORE any side effect (audit log, notifications,
 * background jobs), so a duplicate is invisible to the books.
 *
 * Keys are scoped per business AND user (one user can never read another's
 * stored response) and live for IDEMPOTENCY_WINDOW_MINUTES; expired rows are
 * purged by the next keyed write in the business.
 */

import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, lt, sql } from "drizzle-orm";
import superjson from "superjson";
import { idempotencyKeys } from "@hisaabo/db";
import { IDEMPOTENCY_WINDOW_MINUTES } from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";

/** The tenant database or a transaction handle: both satisfy this structural pick (same pattern as lib/gateway.ts). */
type Executor = Pick<TenantDatabase, "select" | "insert" | "update" | "delete">;

export interface IdempotencyRequest {
  businessId: string;
  userId: string;
  /** The procedure, e.g. "invoice.create". */
  scope: string;
  /** The client-supplied key, or undefined for a normal (non-idempotent) call. */
  key: string | undefined;
  /** The full input, key included or not: the hash ignores `idempotencyKey`. */
  input: unknown;
}

export type IdempotencyClaim<T> =
  /** No key was given: do the work as usual, store nothing. */
  | { kind: "none" }
  /** First time this key is seen: do the work, then call completeIdempotencyKey. */
  | { kind: "claimed"; id: string }
  /** The key was already used with the same input: return `value`, do nothing else. */
  | { kind: "replay"; value: T };

/** JSON with sorted keys and no `idempotencyKey`, so equal requests hash equally however the client ordered fields. */
export function canonicalize(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k, val]) => k !== "idempotencyKey" && val !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, walk(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export function hashRequest(input: unknown): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

/**
 * Claim `key` for this request. Call inside the creating transaction, before
 * doing any work. See the file header for the guarantees.
 */
export async function claimIdempotencyKey<T = unknown>(
  tx: Executor,
  req: IdempotencyRequest,
): Promise<IdempotencyClaim<T>> {
  if (!req.key) return { kind: "none" };

  const requestHash = hashRequest(req.input);
  const now = new Date();

  // Housekeeping: drop this business's expired claims so the table stays small.
  await tx
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.businessId, req.businessId), lt(idempotencyKeys.expiresAt, now)));

  const claimed = await tx
    .insert(idempotencyKeys)
    .values({
      businessId: req.businessId,
      userId: req.userId,
      scope: req.scope,
      key: req.key,
      requestHash,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_WINDOW_MINUTES * 60_000),
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (claimed.length > 0) return { kind: "claimed", id: claimed[0].id };

  // Someone holds the key. The INSERT above waited for any concurrent claimant to
  // commit or roll back, so a row we can see is committed (and a rolled-back
  // claimant would have let us claim it instead).
  const [existing] = await tx
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.businessId, req.businessId),
        eq(idempotencyKeys.userId, req.userId),
        eq(idempotencyKeys.scope, req.scope),
        eq(idempotencyKeys.key, req.key),
      ),
    )
    .limit(1);

  if (!existing || existing.response === null) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This idempotency key is being used by another request right now. Retry in a moment.",
    });
  }
  if (existing.requestHash !== requestHash) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This idempotencyKey was already used for a different request. Send a new key for a new request, or repeat the original request exactly to get its result back.",
    });
  }
  return { kind: "replay", value: superjson.parse<T>(existing.response) };
}

/** Store the response on the claim row. Call as the last statement of the creating transaction. */
export async function completeIdempotencyKey(
  tx: Executor,
  claim: IdempotencyClaim<unknown>,
  response: unknown,
): Promise<void> {
  if (claim.kind !== "claimed") return;
  await tx
    .update(idempotencyKeys)
    .set({ response: superjson.stringify(response) })
    .where(eq(idempotencyKeys.id, claim.id));
}

/** Rows currently held for a business (used by tests and diagnostics). */
export async function countIdempotencyKeys(executor: Executor, businessId: string): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.businessId, businessId));
  return row?.n ?? 0;
}
