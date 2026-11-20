/**
 * Ops sessions: minted only after a Hisaabo cookie session + active, enrolled
 * operator + a valid second factor. The cookie holds a random token; the DB
 * holds its SHA-256. Each session is bound to the Hisaabo session it came
 * from and dies with it (checked on every request in routes.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { controlDb, opsOperators, opsSessions } from "@hisaabo/db";
import type { OpsConfig } from "./config.js";
import type { Operator } from "./operators.js";

export const OPS_COOKIE = "hisaabo_ops";

export type OpsSession = typeof opsSessions.$inferSelect;

export function hashOpsToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createOpsSession(opts: {
  operatorId: string;
  userId: string;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
  config: OpsConfig;
  now?: Date;
}): Promise<{ token: string; session: OpsSession }> {
  const now = opts.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const [session] = await controlDb.insert(opsSessions).values({
    tokenHash: hashOpsToken(token),
    operatorId: opts.operatorId,
    userId: opts.userId,
    sessionId: opts.sessionId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + opts.config.maxMs),
    // The second factor was just entered: sign-in counts as a step-up.
    stepUpAt: now,
    ip: opts.ip,
    userAgent: opts.userAgent?.slice(0, 512) ?? null,
  }).returning();
  return { token, session };
}

export type LoadedOpsSession =
  | { ok: true; session: OpsSession; operator: Operator }
  | { ok: false; reason: "missing" | "revoked" | "expired" | "idle" | "operator" };

/**
 * Resolve an ops session token. Idle, expired, revoked sessions and sessions
 * whose operator is gone, disabled or no longer enrolled are rejected (and
 * revoked, so they cannot come back). A valid session's last_seen_at slides.
 */
export async function loadOpsSession(token: string | null, config: OpsConfig, now = new Date()): Promise<LoadedOpsSession> {
  if (!token || token.length > 256) return { ok: false, reason: "missing" };
  const [row] = await controlDb
    .select({ session: opsSessions, operator: opsOperators })
    .from(opsSessions)
    .innerJoin(opsOperators, eq(opsOperators.id, opsSessions.operatorId))
    .where(eq(opsSessions.tokenHash, hashOpsToken(token)))
    .limit(1);
  if (!row) return { ok: false, reason: "missing" };
  const { session, operator } = row;
  if (session.revokedAt) return { ok: false, reason: "revoked" };

  let reason: "expired" | "idle" | "operator" | null = null;
  if (now >= session.expiresAt) reason = "expired";
  else if (now.getTime() - session.lastSeenAt.getTime() > config.idleMs) reason = "idle";
  else if (operator.disabledAt || !operator.totpSecret || !operator.totpEnrolledAt) reason = "operator";
  else if (operator.totpEnrolledAt > session.createdAt) reason = "operator"; // re-enrolled since
  if (reason) {
    await revokeOpsSession(session.id);
    return { ok: false, reason };
  }

  await controlDb.update(opsSessions).set({ lastSeenAt: now }).where(eq(opsSessions.id, session.id));
  return { ok: true, session: { ...session, lastSeenAt: now }, operator };
}

export async function revokeOpsSession(id: string): Promise<void> {
  await controlDb
    .update(opsSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(opsSessions.id, id), isNull(opsSessions.revokedAt)));
}

export async function markStepUp(id: string, now = new Date()): Promise<void> {
  await controlDb.update(opsSessions).set({ stepUpAt: now }).where(eq(opsSessions.id, id));
}

export function stepUpValidUntil(session: OpsSession, config: OpsConfig): Date | null {
  return session.stepUpAt ? new Date(session.stepUpAt.getTime() + config.stepUpMs) : null;
}

export function hasFreshStepUp(session: OpsSession, config: OpsConfig, now = new Date()): boolean {
  const until = stepUpValidUntil(session, config);
  return !!until && now < until;
}
