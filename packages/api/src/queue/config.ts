/** Queue configuration from the environment (docs/architecture/queue.md §11). */
import type { PoolName } from "./define.js";

export const POOL_NAMES: readonly PoolName[] = ["default", "heavy", "system"];

/** Default jobs worked concurrently per queue in each pool, per worker process. */
const DEFAULT_CONCURRENCY: Record<PoolName, number> = { default: 8, heavy: 2, system: 2 };

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) throw new Error(`${key} must be an integer >= ${min}`);
  return n;
}

/** The DB the `pgboss` schema lives in: the control DB (the single DB self-hosted). */
export function queueDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.QUEUE_DATABASE_URL || env.CONTROL_DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error("QUEUE_DATABASE_URL, CONTROL_DATABASE_URL or DATABASE_URL must be set");
  return url;
}

export function workerPools(env: NodeJS.ProcessEnv = process.env): PoolName[] {
  const raw = (env.QUEUE_POOLS ?? "").trim();
  if (!raw) return [...POOL_NAMES];
  const pools = raw.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of pools) {
    if (!POOL_NAMES.includes(p as PoolName)) throw new Error(`QUEUE_POOLS: unknown pool "${p}"`);
  }
  return [...new Set(pools)] as PoolName[];
}

export function poolConcurrency(pool: PoolName, env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, `QUEUE_CONCURRENCY_${pool.toUpperCase()}`, DEFAULT_CONCURRENCY[pool], 1);
}

export interface RetentionConfig {
  completedSeconds: number;
  failedSeconds: number;
}

export function retentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    completedSeconds: intEnv(env, "QUEUE_COMPLETED_RETENTION_HOURS", 24, 1) * 3600,
    failedSeconds: intEnv(env, "QUEUE_FAILED_RETENTION_DAYS", 14, 1) * 86400,
  };
}

export function shutdownGraceSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv(env, "QUEUE_SHUTDOWN_GRACE_SECONDS", 25, 0);
}

export function pollingIntervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.QUEUE_POLLING_INTERVAL_SECONDS;
  const n = raw ? Number(raw) : 2;
  if (!Number.isFinite(n) || n < 0.5) throw new Error("QUEUE_POLLING_INTERVAL_SECONDS must be >= 0.5");
  return n;
}
