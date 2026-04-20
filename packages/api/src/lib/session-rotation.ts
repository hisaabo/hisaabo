import { and, eq, ne } from "drizzle-orm";
import { controlDb, sessions } from "@hisaabo/db";
import { revokeAllUserSessions, invalidateSessionCache } from "../context.js";

/**
 * Force-rotate every session for a user, optionally keeping one alive.
 *
 * WHEN TO CALL:
 * Any mutation that changes a user's long-lived credentials or security
 * posture must call this — password change, email change, 2FA enable /
 * disable, recovery-key reset. If an attacker has already exfiltrated a
 * session token via XSS, this is the one kill switch that stops the
 * replay. Lazy re-use of existing sessions after a credential change
 * defeats the entire point of changing the credential.
 *
 * The `keepSessionId` parameter preserves the caller's own session so
 * the UX is "change password → stay logged in" rather than "change
 * password → forced logout". Passing `undefined` revokes every session
 * including the current one (useful for "I think my account was
 * compromised, sign me out everywhere"); the caller should then clear
 * its own cookie / Bearer token so the next request doesn't 401.
 *
 * WHAT THIS DOES:
 *   1. Deletes all matching rows in the `sessions` table (authoritative).
 *   2. Marks the user as revoked in the in-memory cache so any cached
 *      session entries get invalidated within the 65-second cache TTL.
 *      (The DB delete is the truth; the cache hint just closes the
 *      window during which a pre-rotation request could have been
 *      served from cache.)
 *   3. Explicitly evicts the cache entry for each deleted session so
 *      the very next request on an old session cannot find a cached hit.
 *
 * WHY NOT REUSE logoutAll:
 * `auth.logoutAll` is a tRPC mutation wired to a specific HTTP handler.
 * It also clears the caller's cookie. Privilege-event rotations are
 * invoked server-internally; they don't own the response headers and
 * need to keep the current session alive. Different operation, same
 * underlying primitives.
 *
 * SAFE CONCURRENCY:
 * The DELETE runs in one SQL statement; there's no read-then-write race
 * between "list sessions" and "delete them". If two privilege events
 * fire simultaneously, both execute the same DELETE; the second one
 * simply affects zero rows.
 */
export async function rotateSessionsOnPrivilegeEvent(
  userId: string,
  keepSessionId?: string,
): Promise<{ deletedIds: string[] }> {
  // Collect the ids we're about to delete so we can precisely evict the
  // cache afterwards. Using `.returning({ id })` on the DELETE keeps
  // this to a single round-trip.
  const whereClauses = keepSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
    : eq(sessions.userId, userId);

  const deleted = await controlDb
    .delete(sessions)
    .where(whereClauses)
    .returning({ id: sessions.id });

  // Purge cache: `revokeAllUserSessions` both adds a short-TTL revoked
  // marker (so any concurrent cache-hit read gets dropped) and clears
  // existing cache entries for this user. That's load-bearing — without
  // it, a request already in flight could be served from cache using
  // the now-deleted session for up to 60s.
  revokeAllUserSessions(userId);

  // Belt-and-braces: explicitly drop each deleted session's cache entry
  // by id, in case a future refactor adds per-session cache entries
  // that revokeAllUserSessions misses.
  for (const row of deleted) {
    invalidateSessionCache(row.id);
  }

  return { deletedIds: deleted.map((r) => r.id) };
}
