import { and, eq, ne } from "drizzle-orm";
import { controlDb, sessions } from "@hisaabo/db";
import { cacheBus } from "./cache/bus.js";

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
 *   2. AFTER the delete settled, emits `session{userId}` on the cache bus:
 *      every cached session / access-token entry of the user is dropped and
 *      any session load still in flight is discarded (no-resurrection), so the
 *      very next request on a rotated session is rejected. The kept session
 *      simply reloads once.
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
  const whereClauses = keepSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
    : eq(sessions.userId, userId);

  // `.returning({ id })` keeps this to a single round-trip. The bus event is
  // emitted in `finally` after the DELETE settles — also when it throws, and
  // also with zero deleted rows: a concurrent request that cached a row just
  // before our DELETE must still see it purged.
  const deleted = await cacheBus.afterWrite([{ kind: "session", userId }], () =>
    controlDb.delete(sessions).where(whereClauses).returning({ id: sessions.id }),
  );

  return { deletedIds: deleted.map((r) => r.id) };
}
