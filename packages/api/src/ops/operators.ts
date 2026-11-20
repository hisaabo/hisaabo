/**
 * /ops operators: CLI-only management plus second-factor verification
 * (docs/architecture/queue.md §7.2). Shell access is the root of trust, so
 * nothing in the HTTP API ever creates, enrolls or re-roles an operator.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { controlDb, opsOperators, opsSessions, encryptField, decryptField, hasEncryptionKey } from "@hisaabo/db";
import { normalizeEmail } from "../lib/normalize-email.js";
import {
  base32Decode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp.js";

export type OpsRole = "admin" | "viewer";
export type Operator = typeof opsOperators.$inferSelect;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60_000;

function requireEncryptionKey(): void {
  if (!hasEncryptionKey()) throw new Error("ENCRYPTION_KEY must be set to manage /ops operators (TOTP secrets are encrypted with it)");
}

export async function findOperatorByEmail(email: string): Promise<Operator | null> {
  const [row] = await controlDb.select().from(opsOperators).where(eq(opsOperators.email, normalizeEmail(email))).limit(1);
  return row ?? null;
}

export async function listOperators(): Promise<Operator[]> {
  return controlDb.select().from(opsOperators).orderBy(opsOperators.email);
}

/** Revoke every live ops session of an operator. Returns how many were revoked. */
export async function revokeOperatorSessions(operatorId: string): Promise<number> {
  const rows = await controlDb
    .update(opsSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(opsSessions.operatorId, operatorId), isNull(opsSessions.revokedAt)))
    .returning({ id: opsSessions.id });
  return rows.length;
}

/**
 * Add an operator, or change an existing operator's role (re-enabling a
 * disabled one). A role change revokes their sessions so the new role applies
 * on next sign-in.
 */
export async function addOperator(email: string, role: OpsRole, createdBy: string): Promise<{ operator: Operator; created: boolean }> {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error(`Invalid email: ${email}`);
  const existing = await findOperatorByEmail(normalized);
  if (existing) {
    const [operator] = await controlDb
      .update(opsOperators)
      .set({ role, disabledAt: null })
      .where(eq(opsOperators.id, existing.id))
      .returning();
    if (existing.role !== role || existing.disabledAt) await revokeOperatorSessions(existing.id);
    return { operator, created: false };
  }
  const [operator] = await controlDb.insert(opsOperators).values({ email: normalized, role, createdBy }).returning();
  return { operator, created: true };
}

/** Delete an operator; ops sessions go with it (FK cascade). */
export async function removeOperator(email: string): Promise<Operator | null> {
  const [row] = await controlDb.delete(opsOperators).where(eq(opsOperators.email, normalizeEmail(email))).returning();
  return row ?? null;
}

export interface Enrollment {
  secret: string;
  uri: string;
  recoveryCodes: string[];
}

/**
 * (Re-)generate the TOTP secret and recovery codes. The plaintext is returned
 * exactly once for the CLI to print; only ciphertext and hashes are stored.
 * Re-enrolment invalidates the old authenticator and codes and signs the
 * operator out everywhere.
 */
export async function enrollOperator(email: string): Promise<{ operator: Operator; enrollment: Enrollment }> {
  requireEncryptionKey();
  const existing = await findOperatorByEmail(email);
  if (!existing) throw new Error(`No operator with email ${normalizeEmail(email)}. Add it first: ops operator add <email> --role admin|viewer`);
  const secret = generateTotpSecret();
  const { codes, hashes } = generateRecoveryCodes();
  const [operator] = await controlDb
    .update(opsOperators)
    .set({
      totpSecret: encryptField(secret),
      totpEnrolledAt: new Date(),
      totpLastStep: null,
      recoveryCodeHashes: hashes,
      failedAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(opsOperators.id, existing.id))
    .returning();
  await revokeOperatorSessions(existing.id);
  return { operator, enrollment: { secret, uri: otpauthUri(secret, operator.email), recoveryCodes: codes } };
}

export function isActiveEnrolled(op: Operator | null): op is Operator & { totpSecret: string } {
  return !!op && !op.disabledAt && !!op.totpSecret && !!op.totpEnrolledAt;
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery" }
  | { ok: false; reason: "locked" | "invalid" | "not_enrolled" };

async function recordFailure(op: Operator, now: Date): Promise<void> {
  // Atomic increment; the row that crosses the threshold sets the lock and
  // resets the counter.
  await controlDb.execute(sql`
    UPDATE ops_operators SET
      locked_until = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
        THEN ${new Date(now.getTime() + LOCKOUT_MS).toISOString()}::timestamptz ELSE locked_until END,
      failed_attempts = CASE WHEN failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS} THEN 0 ELSE failed_attempts + 1 END
    WHERE id = ${op.id}`);
}

/**
 * Verify a TOTP code or a recovery code for an operator. TOTP steps are
 * single-use (an UPDATE guarded on totp_last_step < step, so two concurrent
 * requests with the same code cannot both pass); recovery codes are removed
 * atomically on use. Five failures lock the operator out for 15 minutes.
 */
export async function verifySecondFactor(operatorId: string, rawCode: string, now = new Date()): Promise<SecondFactorResult> {
  const [op] = await controlDb.select().from(opsOperators).where(eq(opsOperators.id, operatorId)).limit(1);
  if (!isActiveEnrolled(op ?? null)) return { ok: false, reason: "not_enrolled" };
  const operator = op as Operator & { totpSecret: string };
  if (operator.lockedUntil && operator.lockedUntil > now) return { ok: false, reason: "locked" };

  const code = rawCode.trim().replace(/\s/g, "");

  if (/^\d{6}$/.test(code)) {
    const key = base32Decode(decryptField(operator.totpSecret));
    const step = verifyTotp(key, code, now.getTime(), operator.totpLastStep);
    if (step !== null) {
      const claimed = await controlDb
        .update(opsOperators)
        .set({ totpLastStep: step, failedAttempts: 0, lockedUntil: null })
        .where(and(
          eq(opsOperators.id, operator.id),
          sql`(${opsOperators.totpLastStep} IS NULL OR ${opsOperators.totpLastStep} < ${step})`,
        ))
        .returning({ id: opsOperators.id });
      if (claimed.length === 1) return { ok: true, method: "totp" };
    }
  } else if (looksLikeRecoveryCode(code)) {
    const hash = hashRecoveryCode(code);
    const claimed = await controlDb
      .update(opsOperators)
      .set({
        recoveryCodeHashes: sql`${opsOperators.recoveryCodeHashes} - ${hash}::text`,
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(and(eq(opsOperators.id, operator.id), sql`${opsOperators.recoveryCodeHashes} ? ${hash}::text`))
      .returning({ id: opsOperators.id });
    if (claimed.length === 1) return { ok: true, method: "recovery" };
  }

  await recordFailure(operator, now);
  return { ok: false, reason: "invalid" };
}
