/**
 * Append-only operator audit log (ops_audit_log). Every /ops sign-in attempt,
 * step-up, action and payload reveal, and every write by the `ops` CLI, adds a
 * row. Nothing in the application updates or deletes rows.
 */
import { userInfo } from "node:os";
import { and, desc, eq, lt } from "drizzle-orm";
import { controlDb, opsAuditLog } from "@hisaabo/db";

export interface OpsAuditEntry {
  operatorId?: string | null;
  actor: string;
  action: string;
  queue?: string | null;
  jobIds?: string[] | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  result: "ok" | "denied" | "failed" | string;
}

export async function writeOpsAudit(entry: OpsAuditEntry): Promise<void> {
  await controlDb.insert(opsAuditLog).values({
    operatorId: entry.operatorId ?? null,
    actor: entry.actor,
    action: entry.action,
    queue: entry.queue ?? null,
    jobIds: entry.jobIds ?? null,
    details: entry.details ?? null,
    ip: entry.ip ?? null,
    result: entry.result,
  });
}

/** Actor label for CLI writes: cli:<os user>. */
export function cliActor(): string {
  let name = "unknown";
  try {
    name = userInfo().username || name;
  } catch {
    // no passwd entry (some containers)
  }
  return `cli:${process.env.SUDO_USER || name}`;
}

export interface AuditQuery {
  action?: string;
  actor?: string;
  /** Keyset cursor: only rows with id < before. */
  before?: number;
  limit?: number;
}

/** Newest-first audit rows for the dashboard's read-only Audit page. */
export async function listOpsAudit(q: AuditQuery) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
  const conds = [
    q.action ? eq(opsAuditLog.action, q.action) : undefined,
    q.actor ? eq(opsAuditLog.actor, q.actor) : undefined,
    q.before ? lt(opsAuditLog.id, q.before) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await controlDb
    .select()
    .from(opsAuditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(opsAuditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    entries: page.map((r) => ({ ...r, at: r.at.toISOString() })),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}
