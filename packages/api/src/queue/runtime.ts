/**
 * Worker runtime: one pg-boss instance with maintenance and cron on, every
 * registered queue synced, schedules applied and workers started for the
 * selected pools. worker.ts wraps it with env validation, the heartbeat file
 * and signal handling; tests drive it directly.
 */
import type { PgBoss, ConstructorOptions } from "pg-boss";
import { logger } from "../lib/logger.js";
import { createBoss, syncQueue } from "./boss.js";
import { retentionConfig, shutdownGraceSeconds } from "./config.js";
import type { AnyJobDefinition, PoolName } from "./define.js";
import { applySchedules, type ScheduleDefinition } from "./schedule.js";
import { startQueueWorkers, type QueueWorkers } from "./workers.js";

export interface WorkerRuntime {
  boss: PgBoss;
  workers: QueueWorkers;
  /** Stop fetching, give in-flight jobs `graceSeconds`, then abort and stop. */
  stop(graceSeconds?: number): Promise<void>;
}

export interface StartWorkerOptions {
  jobs: readonly AnyJobDefinition[];
  schedules?: readonly ScheduleDefinition<unknown>[];
  pools: readonly PoolName[];
  boss?: Partial<ConstructorOptions>;
  pausePollMs?: number;
  pollingIntervalSeconds?: number;
}

export async function startWorkerRuntime(opts: StartWorkerOptions): Promise<WorkerRuntime> {
  const retention = retentionConfig();
  const boss = createBoss({
    instanceName: `worker:${opts.pools.join(",")}`,
    application_name: "hisaabo-worker",
    supervise: true,
    schedule: true,
    persistQueueStats: true,
    queueStatRetentionDays: Math.max(1, Math.round(retention.failedSeconds / 86400)),
    max: 10,
    ...opts.boss,
  });
  const shutdown = new AbortController();
  let workers: QueueWorkers;
  try {
    await boss.start();
    for (const def of opts.jobs) await syncQueue(boss, def);
    await applySchedules(boss, opts.schedules ?? []);
    workers = await startQueueWorkers(boss, opts.jobs, opts.pools, shutdown.signal, {
      ...(opts.pausePollMs ? { pausePollMs: opts.pausePollMs } : {}),
      ...(opts.pollingIntervalSeconds ? { pollingIntervalSeconds: opts.pollingIntervalSeconds } : {}),
    });
  } catch (err) {
    await boss.stop({ graceful: false, close: true }).catch(() => {});
    throw err;
  }
  logger.info({ pools: opts.pools, queues: workers.queues }, "queue worker started");

  let stopping: Promise<void> | null = null;
  return {
    boss,
    workers,
    stop(graceSeconds = shutdownGraceSeconds()) {
      stopping ??= (async () => {
        workers.close();
        // Jobs still running after the grace period see ctx.signal abort; pg-boss
        // retries any that don't settle once they expire.
        const abortTimer = setTimeout(() => shutdown.abort(), graceSeconds * 1000);
        abortTimer.unref();
        try {
          await boss.stop({ graceful: true, close: true, timeout: (graceSeconds + 5) * 1000 });
        } finally {
          clearTimeout(abortTimer);
          shutdown.abort();
        }
        logger.info("queue worker stopped");
      })();
      return stopping;
    },
  };
}
