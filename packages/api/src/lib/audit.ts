import { auditLog } from "@hisaabo/db";
import type { AuditSource } from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";

export interface AuditParams {
  businessId: string;
  userId: string;
  action: string;       // e.g., "invoice.create", "payment.delete"
  entityType: string;   // e.g., "invoice", "payment"
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  /** Where the call came from — see lib/audit-source.ts. Pass `ctx.source`. */
  source?: AuditSource | null;
}

/** A TenantDatabase or a transaction from `.transaction()`: all an audit insert needs. */
type DbOrTx = Pick<TenantDatabase, "insert">;

async function insertAudit(db: DbOrTx, params: AuditParams) {
  await db.insert(auditLog).values({
    businessId: params.businessId,
    userId: params.userId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId || null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ipAddress: params.ipAddress || null,
    source: params.source || null,
  });
}

/**
 * Best-effort audit entry: a failure is logged and swallowed so it can never
 * break the main operation. Use it after the operation has committed.
 */
export async function logAudit(db: TenantDatabase, params: AuditParams) {
  try {
    await insertAudit(db, params);
  } catch (err) {
    // Never let audit logging break the main operation
    console.error("[audit] Failed to write audit log:", err);
  }
}

/**
 * Audit entry written INSIDE the caller's transaction: it commits or rolls back
 * together with the change it records, so the change can never exist without its
 * audit row. Unlike `logAudit` it does not swallow errors (a failed insert would
 * leave the Postgres transaction aborted anyway); the transaction rolls back.
 * Use it for changes whose record must not be missing, e.g. voiding a journal entry.
 */
export async function logAuditInTransaction(tx: DbOrTx, params: AuditParams) {
  await insertAudit(tx, params);
}
