/**
 * worker-db-config.ts — pure (no DB driver) helpers for the per-worker test
 * database scheme. Imported by vitest.config.ts, env-setup.ts (inside every
 * worker, so it stays dependency-light) and worker-db.ts.
 *
 * THE SCHEME
 * Integration files share one set of tables, so they used to run one at a time
 * (maxWorkers: 1). The real fixed cost of a database is its schema; the data a
 * file needs is a handful of inserts. So `global-setup.ts` clones the
 * `db:push`-ed test database (`TEST_DATABASE_URL`, the "template") once per
 * vitest worker slot, and `env-setup.ts` points each worker at its own clone
 * via VITEST_POOL_ID. Workers can then run files in parallel without ever
 * sharing a row, a LISTEN channel, an advisory lock or a pgboss schema.
 *
 * API_TEST_WORKERS=1 keeps the previous behaviour exactly: no clones, every
 * file runs against TEST_DATABASE_URL itself.
 */

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://test:test@localhost:5433/hisaabo_test";

/** Memory budget per API test worker (fork RSS + its share of Postgres backends). */
export const MB_PER_API_WORKER = 1500;
/** Never default to more than this; more workers stop paying for themselves. */
export const MAX_DEFAULT_API_WORKERS = 4;

export interface WorkerCountInputs {
  /** Value of API_TEST_WORKERS, if set. */
  override?: string;
  freeMb: number;
  cpus: number;
}

/**
 * How many vitest workers the API suite may use. An explicit override wins
 * (clamped to >= 1); otherwise size by free memory and leave one core for
 * Postgres and the vitest main process.
 */
export function resolveWorkerCount({ override, freeMb, cpus }: WorkerCountInputs): number {
  if (override !== undefined && override.trim() !== "") {
    const n = Number.parseInt(override, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`API_TEST_WORKERS must be a positive integer, got "${override}"`);
    }
    return n;
  }
  const byMemory = Math.floor(freeMb / MB_PER_API_WORKER);
  const byCpu = cpus - 1;
  return Math.max(1, Math.min(MAX_DEFAULT_API_WORKERS, byMemory, byCpu));
}

/** Template database URL (the one `pnpm db:push` populated). */
export function templateDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export function databaseNameOf(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name) throw new Error(`No database name in connection URL`);
  return name;
}

/** Same server/credentials, different database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

/** Value `global-setup.ts` hands to every worker through vitest's provide/inject. */
export interface WorkerDbPlan {
  /** Database the clones were made from. */
  template: string;
  /** Worker database for pool slot k is `${prefix}${k}`. */
  prefix: string;
}

export function workerDbName(plan: WorkerDbPlan, poolId: string | number): string {
  return `${plan.prefix}${poolId}`;
}

/** Marker stored as the database comment so a later run can tell leaked clones from anyone else's databases. */
export const WORKER_DB_COMMENT_PREFIX = "hisaabo-unit-test-worker";

declare module "vitest" {
  export interface ProvidedContext {
    hisaaboWorkerDbs?: WorkerDbPlan;
  }
}
