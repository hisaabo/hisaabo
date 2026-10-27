/**
 * queues.ts — Background-job queue statistics for the admin dashboard
 * (docs/architecture/queue.md §10).
 *
 * Reads pg-boss's own tables in the control database (the single database
 * self-hosted) with the same one-row/one-json-column contract as stats.ts,
 * so both runners work unchanged. Strictly read-only.
 *
 * Two round trips: a probe first, because a query that names pgboss.* fails
 * to plan on deployments that predate the queue — those get "not installed"
 * instead of a broken dashboard.
 */

import type { SqlRunner } from "./stats.js";

const DEAD = ".dead";

/** A worker counts as live when its pg-boss heartbeat is younger than this. */
export const LIVE_WORKER_SECONDS = 90;

export interface QueueRow {
  name: string;
  policy: string;
  queued: number;
  active: number;
  retry: number;
  /** Jobs parked in the queue's dead-letter queue (`<name>.dead`): failed_jobs. */
  failed: number;
  done15m: number;
  failed15m: number;
  /** Seconds the oldest job ready to run has waited; null when nothing waits. */
  oldestWaitSeconds: number | null;
  paused: boolean;
}

export interface QueueWorker {
  name: string;
  host: string;
  pid: number;
  version: string;
  startedAt: string | null;
  heartbeatAgeSeconds: number | null;
  stopped: boolean;
  live: boolean;
}

export interface QueueFailure {
  queue: string;
  jobId: string;
  failedAt: string;
  createdAt: string | null;
  attempts: number;
  type: string;
  error: string;
  tenantId: string | null;
  /** Tenant name (revealed), "Tenant 3f9a2c" (masked), or null for system jobs. */
  tenantName: string | null;
}

export interface QueueStats {
  installed: boolean;
  /** Set when the queue tables could not be read; the rest of the dashboard still renders. */
  error: string | null;
  queues: QueueRow[];
  workers: QueueWorker[];
  recentFailures: QueueFailure[];
  totals: { queued: number; active: number; retry: number; failed: number; done15m: number; failed15m: number; dead15m: number; oldestWaitSeconds: number | null };
  liveWorkers: number;
}

export function emptyQueueStats(installed = false, error: string | null = null): QueueStats {
  return {
    installed,
    error,
    queues: [],
    workers: [],
    recentFailures: [],
    totals: { queued: 0, active: 0, retry: 0, failed: 0, done15m: 0, failed15m: 0, dead15m: 0, oldestWaitSeconds: null },
    liveWorkers: 0,
  };
}

// ── SQL ─────────────────────────────────────────────────────────

export const QUEUE_PROBE_SQL = `
select json_build_object(
  'installed', to_regclass('pgboss.job') is not null and to_regclass('pgboss.queue') is not null,
  'instances', to_regclass('pgboss.instance') is not null,
  'controls', to_regclass('public.queue_controls') is not null
) as data
`;

/**
 * The statistics query. `controls` / `instances` toggle the parts that read
 * tables newer deployments have and older ones may not.
 */
export function queueSql(opts: { controls: boolean; instances: boolean }): string {
  const paused = opts.controls
    ? `coalesce((select c.paused from public.queue_controls c where c.queue = q.name), false)`
    : `false`;
  const workers = opts.instances
    ? `(select coalesce(json_agg(w order by w.started_on desc), '[]'::json) from (
          select name, host, pid, version, started_on, stopped_on,
                 extract(epoch from now() - heartbeat_on)::bigint as heartbeat_age_seconds
          from pgboss.instance
          where stopped_on is null or stopped_on > now() - interval '1 hour'
        ) w)`
    : `'[]'::json`;
  return `
select json_build_object(
  'queues', (
    select coalesce(json_agg(x order by x.name), '[]'::json) from (
      select q.name, q.policy,
             coalesce(s.queued, 0) as queued,
             coalesce(s.active, 0) as active,
             coalesce(s.retry, 0) as retry,
             coalesce(d.parked, 0) as failed,
             coalesce(s.done_15m, 0) as done_15m,
             coalesce(s.failed_15m, 0) as failed_15m,
             s.oldest_wait_seconds,
             ${paused} as paused
      from pgboss.queue q
      left join (
        select name,
               count(*) filter (where state = 'created') as queued,
               count(*) filter (where state = 'active') as active,
               count(*) filter (where state = 'retry') as retry,
               count(*) filter (where state = 'completed' and completed_on >= now() - interval '15 minutes') as done_15m,
               count(*) filter (where state = 'failed' and completed_on >= now() - interval '15 minutes') as failed_15m,
               extract(epoch from now() - min(created_on) filter (where state in ('created', 'retry') and start_after <= now()))::bigint as oldest_wait_seconds
        from pgboss.job
        where name not like '%${DEAD}'
        group by name
      ) s on s.name = q.name
      left join (
        select name, count(*) filter (where state in ('created', 'retry')) as parked
        from pgboss.job
        where name like '%${DEAD}'
        group by name
      ) d on d.name = q.name || '${DEAD}'
      where q.name not like '%${DEAD}'
    ) x
  ),
  'dead_15m', (select count(*) from pgboss.job where name like '%${DEAD}' and created_on >= now() - interval '15 minutes'),
  'workers', ${workers},
  'recent_failures', (
    select coalesce(json_agg(f order by f.failed_at desc), '[]'::json) from (
      select coalesce(source_name, left(name, length(name) - ${DEAD.length})) as queue,
             id as job_id,
             created_on as failed_at,
             source_created_on as created_at,
             coalesce(source_retry_count, 0) as attempts,
             source_output->>'type' as type,
             source_output->>'error' as error,
             data->>'tenantId' as tenant_id
      from pgboss.job
      where name like '%${DEAD}' and state in ('created', 'retry')
      order by created_on desc
      limit 10
    ) f
  )
) as data
`;
}

// ── Normalisation ───────────────────────────────────────────────

type Row = Record<string, unknown>;

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function arr(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

export function parseQueueStats(raw: unknown): QueueStats {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Row) : {};
  const queues: QueueRow[] = arr(d.queues).map((q) => ({
    name: String(q.name ?? ""),
    policy: String(q.policy ?? "standard"),
    queued: num(q.queued),
    active: num(q.active),
    retry: num(q.retry),
    failed: num(q.failed),
    done15m: num(q.done_15m),
    failed15m: num(q.failed_15m),
    oldestWaitSeconds: numOrNull(q.oldest_wait_seconds),
    paused: Boolean(q.paused),
  }));
  const workers: QueueWorker[] = arr(d.workers).map((w) => {
    const age = numOrNull(w.heartbeat_age_seconds);
    const stopped = w.stopped_on !== null && w.stopped_on !== undefined;
    const name = String(w.name ?? "");
    return {
      name,
      host: String(w.host ?? ""),
      pid: num(w.pid),
      version: String(w.version ?? ""),
      startedAt: str(w.started_on),
      heartbeatAgeSeconds: age,
      stopped,
      live: name.startsWith("worker") && !stopped && age !== null && age <= LIVE_WORKER_SECONDS,
    };
  });
  const recentFailures: QueueFailure[] = arr(d.recent_failures).map((f) => ({
    queue: String(f.queue ?? ""),
    jobId: String(f.job_id ?? ""),
    failedAt: str(f.failed_at) ?? "",
    createdAt: str(f.created_at),
    attempts: num(f.attempts),
    type: String(f.type ?? "Error"),
    error: String(f.error ?? ""),
    tenantId: str(f.tenant_id),
    tenantName: null,
  }));
  const waits = queues.map((q) => q.oldestWaitSeconds).filter((w): w is number => w !== null);
  const sum = (k: "queued" | "active" | "retry" | "failed" | "done15m" | "failed15m") => queues.reduce((a, q) => a + q[k], 0);
  return {
    installed: true,
    error: null,
    queues,
    workers,
    recentFailures,
    totals: {
      queued: sum("queued"),
      active: sum("active"),
      retry: sum("retry"),
      failed: sum("failed"),
      done15m: sum("done15m"),
      failed15m: sum("failed15m"),
      dead15m: num(d.dead_15m),
      oldestWaitSeconds: waits.length ? Math.max(...waits) : null,
    },
    liveWorkers: workers.filter((w) => w.live).length,
  };
}

// ── Collection ──────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0].slice(0, 200);
}

/**
 * Collect queue statistics from the control database. Never throws: a failure
 * is reported on the result so the rest of the dashboard still renders.
 * `tenantNames` resolves envelope tenant ids to names for the revealed view.
 */
export async function collectQueueStats(runner: SqlRunner, tenantNames: Map<string, string> = new Map()): Promise<QueueStats> {
  try {
    const probe = (await runner.queryJson({ name: null }, QUEUE_PROBE_SQL)) as Row | null;
    if (!probe || probe.installed !== true) return emptyQueueStats(false);
    const stats = parseQueueStats(await runner.queryJson({ name: null }, queueSql({
      controls: probe.controls === true,
      instances: probe.instances === true,
    })));
    for (const f of stats.recentFailures) {
      f.tenantName = f.tenantId ? tenantNames.get(f.tenantId) ?? f.tenantId : null;
    }
    return stats;
  } catch (e) {
    return emptyQueueStats(true, errorMessage(e));
  }
}
