/**
 * Registers pg-boss workers for the queues of the selected pools and applies
 * per-queue pause switches from `queue_controls` (Horizon pause/continue).
 */
import { controlDb, queueControls } from "@hisaabo/db";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { logger } from "../lib/logger.js";
import { pollingIntervalSeconds, poolConcurrency } from "./config.js";
import type { AnyJobDefinition, PoolName } from "./define.js";
import { runJob } from "./runner.js";

export const PAUSE_POLL_MS = 10_000;

export interface QueueWorkers {
  /** Queues this process works (paused or not). */
  readonly queues: readonly string[];
  /** Re-read queue_controls and start/stop workers to match. */
  applyPauses(): Promise<void>;
  /** Stop the pause poller. Workers stop with boss.stop(). */
  close(): void;
}

export async function startQueueWorkers(
  boss: PgBoss,
  defs: readonly AnyJobDefinition[],
  pools: readonly PoolName[],
  shutdown: AbortSignal,
  opts: { pausePollMs?: number; pollingIntervalSeconds?: number } = {},
): Promise<QueueWorkers> {
  const selected = defs.filter((d) => pools.includes(d.pool));
  const workerIds = new Map<string, string>(); // queue → pg-boss worker id while running
  const polling = opts.pollingIntervalSeconds ?? pollingIntervalSeconds();

  async function start(def: AnyJobDefinition): Promise<void> {
    const id = await boss.work(
      def.name,
      {
        batchSize: 1,
        perJobResults: true,
        localConcurrency: poolConcurrency(def.pool),
        pollingIntervalSeconds: polling,
        // tenantKeyed queues are capped strictly by their singleton policy.
        ...(def.scope === "tenant" && !def.tenantKeyed ? { groupConcurrency: def.tenantConcurrency } : {}),
      },
      async ([job]) => [await runJob(boss, def, job, shutdown)],
    );
    workerIds.set(def.name, id);
  }

  async function applyPauses(): Promise<void> {
    const rows = await controlDb.select({ queue: queueControls.queue }).from(queueControls).where(eq(queueControls.paused, true));
    const paused = new Set(rows.map((r) => r.queue));
    for (const def of selected) {
      const running = workerIds.has(def.name);
      if (paused.has(def.name) && running) {
        await boss.offWork(def.name, { wait: false });
        workerIds.delete(def.name);
        logger.info({ queue: def.name }, "queue paused");
      } else if (!paused.has(def.name) && !running && !shutdown.aborted) {
        await start(def);
        logger.info({ queue: def.name }, "queue working");
      }
    }
  }

  await applyPauses();
  const timer = setInterval(() => {
    applyPauses().catch((err) => logger.error({ err }, "queue pause poll failed"));
  }, opts.pausePollMs ?? PAUSE_POLL_MS);
  timer.unref();

  return {
    queues: selected.map((d) => d.name),
    applyPauses,
    close: () => clearInterval(timer),
  };
}
