/**
 * Store-slug helpers shared by the registry backfill (packages/db) and the
 * API (self-import). Pure: no DB access, safe to import anywhere.
 */
import { randomInt } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

export const STORE_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX_LEN = 4;
const MAX_SLUG_LEN = 50;
/** Longest part of the original that fits after "<prefix>-". */
const MAX_ORIGINAL_LEN = MAX_SLUG_LEN - PREFIX_LEN - 1;

/** How many fresh prefixes callers should try before giving up. */
export const FALLBACK_SLUG_MAX_ATTEMPTS = 10;

/**
 * Candidate replacement for a slug that is already used by another store:
 * `<4 random [a-z0-9]>-<original>`, with the original truncated so the total
 * is at most 50 chars and no trailing '-' is left behind. A fresh random
 * prefix is drawn on every call; callers must retry on a registry conflict
 * (up to FALLBACK_SLUG_MAX_ATTEMPTS) and report failure afterwards.
 * `original` must itself be a valid slug.
 */
export function fallbackSlug(original: string): string {
  if (!STORE_SLUG_REGEX.test(original)) throw new Error("fallbackSlug: invalid original slug");
  let prefix = "";
  for (let i = 0; i < PREFIX_LEN; i++) prefix += PREFIX_ALPHABET[randomInt(PREFIX_ALPHABET.length)];
  const base = original.slice(0, MAX_ORIGINAL_LEN).replace(/-+$/, "");
  const slug = `${prefix}-${base}`;
  if (!STORE_SLUG_REGEX.test(slug)) throw new Error("fallbackSlug: generated slug is invalid");
  return slug;
}

// ── Per-business advisory lock (single source of truth) ───────────────
//
// Serialises every slug write for one (tenant, business): store.updateSettings
// (applyStoreChange), self-import, and the backfill rename. Anything that
// changes a business's slug must take this lock first, inside its control
// transaction. Both callers build the statement from these three pieces.
export const STORE_SLUG_LOCK_HEAD = "SELECT pg_advisory_xact_lock(hashtextextended(";
export const STORE_SLUG_LOCK_TAIL = ", 0))";

/** The text hashed into the advisory lock key. */
export function storeSlugBusinessLockKey(tenantId: string, businessId: string): string {
  return `${tenantId}:${businessId}`;
}

/** Statement text + params for raw postgres.js callers: `tx.unsafe(text, params)`. */
export function storeSlugBusinessLockStatement(tenantId: string, businessId: string): { text: string; params: [string] } {
  return {
    text: `${STORE_SLUG_LOCK_HEAD}$1${STORE_SLUG_LOCK_TAIL}`,
    params: [storeSlugBusinessLockKey(tenantId, businessId)],
  };
}

/** Same statement as a drizzle fragment (the key is a bound parameter). */
export function storeSlugBusinessLockSql(tenantId: string, businessId: string): SQL {
  return sql.raw(STORE_SLUG_LOCK_HEAD)
    .append(sql`${storeSlugBusinessLockKey(tenantId, businessId)}`)
    .append(sql.raw(STORE_SLUG_LOCK_TAIL));
}
