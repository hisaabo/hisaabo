/**
 * defineJob — the Laravel-style job definition (docs/architecture/queue.md §5).
 *
 * One pg-boss queue per job name. A job's terminal failures (retries spent, or
 * a PermanentError) land in its dead-letter queue `<name>.dead`, which no
 * worker consumes: that is our `failed_jobs`, kept for
 * QUEUE_FAILED_RETENTION_DAYS and re-queued with pg-boss `redrive()`.
 */
import type { z } from "zod";
import type { ControlDatabase, TenantDatabase } from "@hisaabo/db";
import type { Logger } from "../lib/logger.js";

export type PoolName = "default" | "heavy" | "system";
export type JobScope = "tenant" | "system";

/** pg-boss queue policies we allow (see pg-boss QueuePolicy). */
export type JobPolicy = "standard" | "singleton" | "stately";

export interface JobContext {
  jobId: string;
  queue: string;
  /** 1 for the first attempt. */
  attempt: number;
  tenantId?: string;
  businessId?: string;
  actorUserId?: string;
  /** Tenant DB, re-resolved for every attempt (scope = "tenant"). */
  db?: TenantDatabase;
  controlDb: ControlDatabase;
  logger: Logger;
  /** Aborts on job expiry and on worker shutdown. Pass it on to I/O. */
  signal: AbortSignal;
  /** Refresh the job's heartbeat (jobs with heartbeatSeconds). */
  heartbeat(): Promise<void>;
  /** Report progress; logged (shown in the dashboard from Phase 3). */
  progress(pct: number, note?: string): Promise<void>;
}

export interface JobOptions<P> {
  /** Queue / job name: lower-case words separated by dots, e.g. "bank.statement.process". */
  name: string;
  scope?: JobScope;
  pool?: PoolName;
  payload: z.ZodType<P, z.ZodTypeDef, unknown>;
  /** Retries after the first attempt (pg-boss retryLimit). */
  retries?: number;
  backoff?: { delaySeconds: number; exponential?: boolean; maxDelaySeconds?: number };
  /** Max active time per attempt (pg-boss expireInSeconds). */
  timeoutSeconds?: number;
  /** Long-running jobs: heartbeat interval; the job fails when heartbeats stop. */
  heartbeatSeconds?: number;
  /** De-duplication (Laravel ShouldBeUnique): one job per key within the window. */
  unique?: { key: (payload: P) => string; forSeconds: number };
  /** Max concurrently active jobs of this queue per tenant, across all workers. */
  tenantConcurrency?: number;
  priority?: number;
  policy?: JobPolicy;
  /** Top-level string payload fields stored encrypted (Laravel ShouldBeEncrypted). */
  encrypt?: readonly (keyof P & string)[];
  /** Max queued + active jobs of this queue per tenant; dispatch beyond it is rejected. */
  maxQueuedPerTenant?: number;
  handle(payload: P, ctx: JobContext): Promise<unknown>;
  /** Runs once, after the job failed for good (retries spent or PermanentError). */
  onFailed?(payload: P, error: Error, ctx: JobContext): Promise<void>;
}

export interface JobDefinition<P = unknown> extends Required<Pick<JobOptions<P>,
  "name" | "scope" | "pool" | "retries" | "timeoutSeconds" | "tenantConcurrency" | "policy" | "maxQueuedPerTenant">>,
  Omit<JobOptions<P>, "name" | "scope" | "pool" | "retries" | "timeoutSeconds" | "tenantConcurrency" | "policy" | "maxQueuedPerTenant" | "encrypt"> {
  readonly deadLetter: string;
  readonly encrypt: readonly string[];
  /**
   * One active job per tenant, enforced strictly by pg-boss's `singleton`
   * policy keyed by tenant id (a unique index). Used for tenantConcurrency 1;
   * higher caps use pg-boss groupConcurrency, which is approximate (see
   * docs/architecture/queue.md §6).
   */
  readonly tenantKeyed: boolean;
}

/** A job of any payload type, for registries and runtime plumbing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJobDefinition = JobDefinition<any>;

const NAME_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export const DEAD_SUFFIX = ".dead";

export function defineJob<P>(opts: JobOptions<P>): JobDefinition<P> {
  if (!NAME_RE.test(opts.name) || opts.name.endsWith(DEAD_SUFFIX) || opts.name.length > 100) {
    throw new Error(`Invalid job name "${opts.name}"`);
  }
  const def = {
    scope: "tenant" as const,
    pool: "default" as const,
    retries: 3,
    timeoutSeconds: 300,
    tenantConcurrency: 2,
    policy: "standard" as const,
    maxQueuedPerTenant: 50,
    encrypt: [],
    ...opts,
    deadLetter: opts.name + DEAD_SUFFIX,
  };
  const tenantKeyed = def.scope === "tenant" && def.tenantConcurrency === 1 && !def.unique && def.policy === "standard";
  return { ...def, ...(tenantKeyed ? { policy: "singleton" as const } : {}), tenantKeyed };
}

// Payload field names that must never be stored in clear text.
const SECRET_FIELD_RE = /pass(word)?|secret|token|api_?key|credential|private_?key/i;

/**
 * Payload fields whose names look secret but are not listed in `encrypt`.
 * Inspects the top level of a zod object schema; a test runs this over the
 * whole registry so a careless payload fails CI.
 */
export function unencryptedSecretFields(def: AnyJobDefinition): string[] {
  const shape = (def.payload as unknown as { shape?: Record<string, unknown> }).shape;
  if (!shape) return [];
  return Object.keys(shape).filter((k) => SECRET_FIELD_RE.test(k) && !def.encrypt.includes(k));
}
