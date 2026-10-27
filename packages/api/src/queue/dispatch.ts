/**
 * dispatch() — enqueue a job (Laravel `dispatch()`).
 *
 * Pass `tx` to enqueue inside a Drizzle transaction: the job then exists only
 * if the transaction commits (pg-boss Drizzle adapter).
 */
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { fromDrizzle, type PgBoss, type DrizzleTransactionLike, type SendOptions } from "pg-boss";
import { QUEUE_SCHEMA } from "@hisaabo/db";
import { getSenderBoss, ensureQueue } from "./boss.js";
import { envelopeSchema, type Envelope } from "./envelope.js";
import { sealPayload } from "./payload.js";
import type { JobDefinition, AnyJobDefinition } from "./define.js";

export interface DispatchOptions {
  tenantId?: string;
  businessId?: string;
  actorUserId?: string;
  requestId?: string;
  tags?: string[];
  delaySeconds?: number;
  priority?: number;
  /** Enqueue inside this transaction (the job exists only if it commits). */
  tx?: DrizzleTransactionLike;
  /** Defaults to the API's sender instance. */
  boss?: PgBoss;
}

/** Returns the job id, or null when a `unique` job with the same key is already pending. */
export async function dispatch<P>(def: JobDefinition<P>, payload: P, opts: DispatchOptions = {}): Promise<string | null> {
  const sealed = sealPayload(def, payload);
  const envelope: Envelope = envelopeSchema.parse({
    v: 1,
    scope: def.scope,
    ...(def.scope === "tenant"
      ? { tenantId: opts.tenantId, businessId: opts.businessId, actorUserId: opts.actorUserId }
      : {}),
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
    tags: opts.tags ?? [],
    payload: sealed,
  });

  const boss = opts.boss ?? (await getSenderBoss());
  await ensureQueue(boss, def);

  if (envelope.tenantId) await assertTenantQuota(boss, def, envelope.tenantId);

  const send: SendOptions = {
    ...(def.priority !== undefined || opts.priority !== undefined ? { priority: opts.priority ?? def.priority } : {}),
    ...(opts.delaySeconds ? { startAfter: opts.delaySeconds } : {}),
    ...(envelope.tenantId ? { group: { id: envelope.tenantId } } : {}),
    ...(def.unique
      ? {
          singletonKey: `${envelope.tenantId ?? "system"}:${def.unique.key(payload)}`,
          singletonSeconds: def.unique.forSeconds,
        }
      : def.tenantKeyed && envelope.tenantId
        ? { singletonKey: envelope.tenantId }
        : {}),
    ...(opts.tx ? { db: fromDrizzle(opts.tx, sql) } : {}),
  };
  return boss.send(def.name, envelope, send);
}

/**
 * One tenant must not flood a queue: reject once it has `maxQueuedPerTenant`
 * jobs waiting or running there.
 */
async function assertTenantQuota(boss: PgBoss, def: AnyJobDefinition, tenantId: string): Promise<void> {
  const { rows } = await boss.getDb().executeSql(
    `SELECT count(*)::int AS n FROM ${QUEUE_SCHEMA}.job
      WHERE name = $1 AND group_id = $2 AND state IN ('created', 'retry', 'active')`,
    [def.name, tenantId],
  );
  const n = (rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n >= def.maxQueuedPerTenant) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many pending background tasks. Please try again later." });
  }
}
