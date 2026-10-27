/**
 * pg-boss instances and queue sync.
 *
 * - The API holds one lazily started, send-only instance (no maintenance, no
 *   cron, no migrations) — see getSenderBoss().
 * - Workers create their own instance with maintenance + cron on (worker.ts).
 * - Queue options always come from the job registry: syncQueue() creates the
 *   job's dead-letter queue and the queue itself, then updates the stored
 *   options so code and database cannot drift.
 */
import { PgBoss, type ConstructorOptions, type Queue } from "pg-boss";
import { QUEUE_SCHEMA } from "@hisaabo/db";
import { logger } from "../lib/logger.js";
import { queueDatabaseUrl, retentionConfig, type RetentionConfig } from "./config.js";
import type { AnyJobDefinition } from "./define.js";

export function createBoss(options: Partial<ConstructorOptions> = {}): PgBoss {
  const boss = new PgBoss({
    connectionString: queueDatabaseUrl(),
    schema: QUEUE_SCHEMA,
    migrate: false,
    supervise: false,
    schedule: false,
    max: 3,
    ...options,
  });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  return boss;
}

// ── Queue options ────────────────────────────────────────────

type QueueOptions = Omit<Queue, "name">;

export function queueOptions(def: AnyJobDefinition, retention: RetentionConfig = retentionConfig()): QueueOptions {
  const backoff = def.backoff ?? { delaySeconds: 10, exponential: true, maxDelaySeconds: 3600 };
  return {
    policy: def.policy,
    retryLimit: def.retries,
    retryDelay: backoff.delaySeconds,
    retryBackoff: backoff.exponential ?? false,
    ...(backoff.maxDelaySeconds ? { retryDelayMax: backoff.maxDelaySeconds } : {}),
    expireInSeconds: def.timeoutSeconds,
    ...(def.heartbeatSeconds ? { heartbeatSeconds: def.heartbeatSeconds } : {}),
    // Waiting jobs, and the dead-letter copies (pg-boss copies retention onto
    // them), live as long as failed jobs are kept.
    retentionSeconds: retention.failedSeconds,
    deleteAfterSeconds: retention.completedSeconds,
    deadLetter: def.deadLetter,
  };
}

/** The dead-letter queue: never worked; its jobs are kept until retention expires. */
export function deadLetterOptions(retention: RetentionConfig = retentionConfig()): QueueOptions {
  return {
    policy: "standard",
    retryLimit: 0,
    retentionSeconds: retention.failedSeconds,
    deleteAfterSeconds: retention.failedSeconds,
  };
}

export async function syncQueue(boss: PgBoss, def: AnyJobDefinition): Promise<void> {
  const dead = deadLetterOptions();
  await boss.createQueue(def.deadLetter, dead);
  await boss.updateQueue(def.deadLetter, withoutPolicy(dead));

  const opts = queueOptions(def);
  await boss.createQueue(def.name, opts);
  const existing = await boss.getQueue(def.name);
  if (existing?.policy && existing.policy !== def.policy) {
    // pg-boss cannot change a queue's policy in place; changing it needs a
    // deliberate migration (drain, deleteQueue, recreate).
    logger.warn({ queue: def.name, stored: existing.policy, wanted: def.policy }, "Queue policy differs from code; keeping stored policy");
  }
  await boss.updateQueue(def.name, withoutPolicy(opts));
}

function withoutPolicy(opts: QueueOptions): QueueOptions {
  const { policy: _policy, ...rest } = opts;
  return rest;
}

// ── API-side sender ──────────────────────────────────────────

let sender: Promise<PgBoss> | null = null;
const ensured = new Map<PgBoss, Set<string>>();

/** Send-only pg-boss for the API process, started on first use. */
export function getSenderBoss(): Promise<PgBoss> {
  sender ??= (async () => {
    const boss = createBoss({ instanceName: "api", application_name: "hisaabo-api-queue" });
    await boss.start();
    return boss;
  })().catch((err) => {
    sender = null;
    throw err;
  });
  return sender;
}

/** Create the queue once per process before the first send to it. */
export async function ensureQueue(boss: PgBoss, def: AnyJobDefinition): Promise<void> {
  let seen = ensured.get(boss);
  if (!seen) ensured.set(boss, (seen = new Set()));
  if (seen.has(def.name)) return;
  await syncQueue(boss, def);
  seen.add(def.name);
}

/** Stop the API's sender instance (graceful shutdown). */
export async function stopSenderBoss(): Promise<void> {
  if (!sender) return;
  const pending = sender;
  sender = null;
  const boss = await pending.catch(() => null);
  if (boss) {
    ensured.delete(boss);
    await boss.stop({ graceful: false, close: true }).catch(() => {});
  }
}
