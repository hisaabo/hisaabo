/**
 * Background job worker process (docs/architecture/queue.md §6).
 *
 *   node packages/api/dist/worker.js      (docker: `command: worker`)
 *
 * Runs the queues of the pools in QUEUE_POOLS (default: all). Never migrates:
 * it waits for the migration step (run by the API container) to install the
 * pgboss schema, then starts. Writes /tmp/worker-heartbeat every 10 s for the
 * container healthcheck.
 */
import { writeFile } from "node:fs/promises";
import { logger } from "./lib/logger.js";
import { validateEnv } from "./lib/env.js";
import { workerPools } from "./queue/config.js";
import { startWorkerRuntime, type WorkerRuntime } from "./queue/runtime.js";
import { JOBS, SCHEDULES } from "./queue/registry.js";

const HEARTBEAT_FILE = process.env.QUEUE_HEARTBEAT_FILE || "/tmp/worker-heartbeat";
const HEARTBEAT_MS = 10_000;

async function startWithRetry(): Promise<WorkerRuntime> {
  const pools = workerPools();
  let delayMs = 1000;
  for (;;) {
    try {
      return await startWorkerRuntime({ jobs: JOBS, schedules: SCHEDULES, pools });
    } catch (err) {
      // Usually the pgboss schema is not installed yet (the API container runs
      // migrations) or the DB is still starting.
      logger.warn({ err, retryInMs: delayMs }, "worker could not start yet; retrying");
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 30_000);
    }
  }
}

async function main(): Promise<void> {
  validateEnv({ role: "worker" });
  const runtime = await startWithRetry();

  const beat = () => writeFile(HEARTBEAT_FILE, String(Date.now())).catch((err) => logger.warn({ err }, "heartbeat write failed"));
  await beat();
  const heartbeat = setInterval(beat, HEARTBEAT_MS);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "worker shutting down");
    clearInterval(heartbeat);
    runtime.stop().then(
      () => process.exit(0),
      (err) => {
        logger.error({ err }, "worker stop failed");
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled rejection"));

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
