/**
 * Read models and actions behind /ops/api (docs/architecture/queue.md §9).
 *
 * pg-boss APIs are used where they exist (queues, stats, instances,
 * schedules, retry/redrive/delete). Job listing needs filters and keyset
 * pagination pg-boss does not offer, so it is a bounded, read-only query on
 * pgboss.job through pg-boss's own connection. Nothing returned here carries a
 * raw tenant id, raw payload, decrypted field or stack trace; reveal is a
 * separate, audited call.
 */
import type { PgBoss } from "pg-boss";
import { inArray } from "drizzle-orm";
import { controlDb, queueControls, QUEUE_SCHEMA } from "@hisaabo/db";
import { getSenderBoss } from "../queue/boss.js";
import { JOBS, getJob } from "../queue/registry.js";
import { DEAD_SUFFIX, type AnyJobDefinition } from "../queue/define.js";
import { maskFreeText, tenantHandle } from "../lib/admin/privacy.js";

export const MAX_BULK_IDS = 500;
const MAX_PAGE = 100;
const MAX_ERROR_CHARS = 500;
const HOUR_MS = 3_600_000;

export type JobTab = "pending" | "active" | "completed" | "failed";
export const JOB_TABS: readonly JobTab[] = ["pending", "active", "completed", "failed"];

let bossOverride: Promise<PgBoss> | null = null;

/** pg-boss used for reads and actions: the API's sender, or the CLI's own. */
export function boss(): Promise<PgBoss> {
  return bossOverride ?? getSenderBoss();
}

/** The ops CLI runs its own (unregistered) pg-boss instance. */
export function useOpsBoss(b: PgBoss): void {
  bossOverride = Promise.resolve(b);
}

/** Only registered queues (and their dead-letter queues) are addressable. */
export function resolveQueue(name: string): { def: AnyJobDefinition; dead: boolean } | null {
  const dead = name.endsWith(DEAD_SUFFIX);
  const def = getJob(dead ? name.slice(0, -DEAD_SUFFIX.length) : name);
  return def ? { def, dead } : null;
}

async function pausedQueues(): Promise<Set<string>> {
  const rows = await controlDb.select({ queue: queueControls.queue, paused: queueControls.paused }).from(queueControls);
  return new Set(rows.filter((r) => r.paused).map((r) => r.queue));
}

function perMinute(delta: number | null | undefined, seconds: number | null | undefined): number | null {
  if (delta == null || !seconds) return null;
  return Math.round((delta / seconds) * 60 * 10) / 10;
}

// ── Queues ───────────────────────────────────────────────────

export interface QueueSummary {
  name: string;
  pool: string;
  scope: string;
  policy: string;
  paused: boolean;
  queued: number;
  deferred: number;
  active: number;
  failed: number; // jobs in the dead-letter queue
  completedPerMin: number | null;
  failedPerMin: number | null;
  oldestReadySeconds: number | null;
}

export async function listQueues(): Promise<QueueSummary[]> {
  const b = await boss();
  const names = JOBS.flatMap((j) => [j.name, j.deadLetter]);
  const [rows, paused] = await Promise.all([b.getQueues(names), pausedQueues()]);
  const byName = new Map(rows.map((r) => [r.name, r]));
  return JOBS.map((def) => {
    const q = byName.get(def.name);
    const dead = byName.get(def.deadLetter);
    return {
      name: def.name,
      pool: def.pool,
      scope: def.scope,
      policy: q?.policy ?? def.policy,
      paused: paused.has(def.name),
      queued: q?.queuedCount ?? 0,
      deferred: q?.deferredCount ?? 0,
      active: q?.activeCount ?? 0,
      failed: dead?.totalCount ?? 0,
      completedPerMin: perMinute(q?.completedDelta, q?.deltaSeconds),
      failedPerMin: perMinute(q?.failedDelta, q?.deltaSeconds),
      oldestReadySeconds: q?.readyOldestSeconds ?? null,
    };
  });
}

export interface StatPoint {
  at: string;
  queued: number;
  active: number;
  completed: number;
  failed: number;
  waitP50: number | null;
  waitP95: number | null;
  runP50: number | null;
  runP95: number | null;
}

/** A queue's persisted stats over the last `hours`, bucketed for a chart. */
export async function queueSeries(name: string, hours = 24): Promise<StatPoint[]> {
  const b = await boss();
  const snapshots = await b.getQueueStats(name, {
    from: new Date(Date.now() - hours * HOUR_MS),
    maxDataPoints: 120,
    percentiles: [50, 95],
  }).catch(() => []);
  return snapshots.map((s) => {
    const p = (pct: number) => s.percentiles?.find((x) => x.p === pct);
    return {
      at: (s.deltaOn ?? s.capturedOn).toISOString(),
      queued: s.queuedCount,
      active: s.activeCount,
      completed: s.completedDelta ?? 0,
      failed: s.failedDelta ?? 0,
      waitP50: p(50)?.waitSeconds ?? null,
      waitP95: p(95)?.waitSeconds ?? null,
      runP50: p(50)?.runSeconds ?? null,
      runP95: p(95)?.runSeconds ?? null,
    };
  });
}

// ── Overview ─────────────────────────────────────────────────

export async function overview() {
  const [queues, workers, recentFailures] = await Promise.all([
    listQueues(),
    listWorkers(),
    listJobs({ tab: "failed", limit: 10 }),
  ]);
  const series = await Promise.all(JOBS.map((j) => queueSeries(j.name, 1)));
  const last = series.map((s) => s[s.length - 1]).filter(Boolean);
  const maxOf = (xs: (number | null)[]) => xs.reduce<number | null>((m, x) => (x == null ? m : m == null ? x : Math.max(m, x)), null);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
  return {
    totals: {
      queued: sum(queues.map((q) => q.queued)),
      deferred: sum(queues.map((q) => q.deferred)),
      active: sum(queues.map((q) => q.active)),
      failed: sum(queues.map((q) => q.failed)),
      completedPerMin: sum(queues.map((q) => q.completedPerMin)),
      failedPerMin: sum(queues.map((q) => q.failedPerMin)),
      oldestReadySeconds: maxOf(queues.map((q) => q.oldestReadySeconds)),
      waitP95Seconds: maxOf(last.map((p) => p.waitP95)),
      runP95Seconds: maxOf(last.map((p) => p.runP95)),
      liveWorkers: workers.filter((w) => w.live && w.role === "worker").length,
      pausedQueues: queues.filter((q) => q.paused).length,
    },
    throughput: mergeSeries(series),
    recentFailures: recentFailures.jobs,
  };
}

function mergeSeries(series: StatPoint[][]): { at: string; completed: number; failed: number }[] {
  const byMinute = new Map<string, { completed: number; failed: number }>();
  for (const s of series) {
    for (const p of s) {
      const key = p.at.slice(0, 16); // minute bucket
      const cur = byMinute.get(key) ?? { completed: 0, failed: 0 };
      cur.completed += p.completed;
      cur.failed += p.failed;
      byMinute.set(key, cur);
    }
  }
  return [...byMinute.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, v]) => ({ at: `${at}:00.000Z`, ...v }));
}

// ── Jobs ─────────────────────────────────────────────────────

export interface JobSummary {
  id: string;
  queue: string;
  state: string;
  attempt: number;
  retryLimit: number;
  tenant: string | null; // hashed handle, never the id
  tags: string[];
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  error: string | null;
}

interface JobRow {
  id: string;
  name: string;
  state: string;
  retry_count: number;
  retry_limit: number;
  tenant_id: string | null;
  tags: unknown;
  created_on: Date;
  started_on: Date | null;
  completed_on: Date | null;
  err: string | null;
}

function maskError(e: string | null): string | null {
  return e ? maskFreeText(e).slice(0, MAX_ERROR_CHARS) : null;
}

function toSummary(r: JobRow): JobSummary {
  return {
    id: r.id,
    queue: r.name,
    state: r.state,
    attempt: r.retry_count + 1,
    retryLimit: r.retry_limit,
    tenant: r.tenant_id ? tenantHandle(r.tenant_id) : null,
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 20) : [],
    createdOn: r.created_on.toISOString(),
    startedOn: r.started_on?.toISOString() ?? null,
    completedOn: r.completed_on?.toISOString() ?? null,
    error: maskError(r.err),
  };
}

const JOB_COLUMNS = `id, name, state::text AS state, retry_count, retry_limit,
  data->>'tenantId' AS tenant_id, data->'tags' AS tags, created_on, started_on, completed_on,
  COALESCE(output->>'error', source_output->>'error') AS err`;

function encodeCursor(r: JobRow): string {
  return Buffer.from(JSON.stringify([r.created_on.toISOString(), r.id])).toString("base64url");
}

function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string" && !Number.isNaN(Date.parse(v[0])) && /^[0-9a-f-]{36}$/i.test(v[1])) {
      return [v[0], v[1]];
    }
  } catch {
    // fall through
  }
  throw new Error("Invalid cursor");
}

/** Map a 6-hex tenant handle back to tenant ids seen in these queues (bounded). */
async function tenantIdsForHandle(b: PgBoss, queues: string[], handle: string): Promise<string[]> {
  const { rows } = await b.getDb().executeSql(
    `SELECT DISTINCT data->>'tenantId' AS t FROM ${QUEUE_SCHEMA}.job
      WHERE name = ANY($1) AND data->>'tenantId' IS NOT NULL LIMIT 5000`,
    [queues],
  );
  return rows.map((r: { t: string }) => r.t).filter((t: string) => tenantHandle(t) === handle);
}

export interface ListJobsInput {
  tab: JobTab;
  queue?: string;
  tenant?: string;
  tag?: string;
  cursor?: string;
  limit?: number;
}

export async function listJobs(input: ListJobsInput): Promise<{ jobs: JobSummary[]; nextCursor: string | null }> {
  const b = await boss();
  const defs = input.queue ? [getJob(input.queue)].filter((d): d is AnyJobDefinition => !!d) : [...JOBS];
  if (defs.length === 0) return { jobs: [], nextCursor: null };
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE);

  const names = input.tab === "failed" ? defs.map((d) => d.deadLetter) : defs.map((d) => d.name);
  const states: Record<JobTab, string[]> = {
    pending: ["created", "retry"],
    active: ["active"],
    completed: ["completed", "cancelled"],
    failed: ["created", "retry", "active", "completed", "failed", "cancelled"],
  };

  const where: string[] = ["name = ANY($1)", "state::text = ANY($2)"];
  const values: unknown[] = [names, states[input.tab]];
  if (input.tenant) {
    if (!/^[0-9a-f]{6}$/.test(input.tenant)) return { jobs: [], nextCursor: null };
    const ids = await tenantIdsForHandle(b, names, input.tenant);
    if (ids.length === 0) return { jobs: [], nextCursor: null };
    values.push(ids);
    where.push(`data->>'tenantId' = ANY($${values.length})`);
  }
  if (input.tag) {
    values.push(input.tag.slice(0, 64));
    where.push(`data->'tags' ? $${values.length}`);
  }
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    values.push(cursor[0], cursor[1]);
    where.push(`(created_on, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }
  values.push(limit + 1);
  const { rows } = await b.getDb().executeSql(
    `SELECT ${JOB_COLUMNS} FROM ${QUEUE_SCHEMA}.job WHERE ${where.join(" AND ")}
      ORDER BY created_on DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  const page = (rows as JobRow[]).slice(0, limit);
  return {
    jobs: page.map(toSummary),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

async function loadJobRow(b: PgBoss, queue: string, id: string): Promise<(JobRow & { data: unknown; source_name: string | null; retry_delay: number; singleton_key: string | null }) | null> {
  const { rows } = await b.getDb().executeSql(
    `SELECT ${JOB_COLUMNS}, data, source_name, retry_delay, singleton_key
       FROM ${QUEUE_SCHEMA}.job WHERE name = $1 AND id = $2`,
    [queue, id],
  );
  return rows[0] ?? null;
}

/** Job detail with the payload masked: field names only, never values. */
export async function jobDetail(queue: string, id: string) {
  const b = await boss();
  const row = await loadJobRow(b, queue, id);
  if (!row) return null;
  const env = (row.data ?? {}) as { scope?: string; businessId?: string; payload?: Record<string, unknown>; requestId?: string };
  return {
    ...toSummary(row),
    sourceQueue: row.source_name,
    scope: env.scope ?? null,
    business: env.businessId ? tenantHandle(env.businessId) : null,
    requestId: typeof env.requestId === "string" ? env.requestId.slice(0, 128) : null,
    payloadFields: env.payload && typeof env.payload === "object" ? Object.keys(env.payload).slice(0, 50) : [],
    timeline: [
      { event: "created", at: row.created_on.toISOString() },
      ...(row.started_on ? [{ event: "started", at: row.started_on.toISOString() }] : []),
      ...(row.completed_on ? [{ event: row.state, at: row.completed_on.toISOString() }] : []),
    ],
  };
}

/**
 * The payload for an audited reveal. Fields the job lists in `encrypt` stay
 * ciphertext and are shown only as a marker — they are never decrypted here.
 */
export async function revealPayload(queue: string, id: string): Promise<Record<string, unknown> | null> {
  const resolved = resolveQueue(queue);
  if (!resolved) return null;
  const b = await boss();
  const row = await loadJobRow(b, queue, id);
  if (!row) return null;
  const payload: Record<string, unknown> = { ...((row.data as { payload?: Record<string, unknown> } | null)?.payload) };
  for (const field of resolved.def.encrypt) {
    if (field in payload) payload[field] = "[encrypted]";
  }
  return payload;
}

/**
 * Retry jobs. Dead-letter jobs are redriven back to their source queue
 * (pg-boss redrive); jobs still in a working queue are retried in place.
 */
export async function retryJobs(queue: string, ids: string[]): Promise<number> {
  const resolved = resolveQueue(queue);
  if (!resolved) throw new Error("Unknown queue");
  const b = await boss();
  if (resolved.dead) return b.redrive(queue, { ids, limit: ids.length });
  await b.retry(queue, ids);
  return ids.length;
}

export async function deleteJobs(queue: string, ids: string[]): Promise<number> {
  if (!resolveQueue(queue)) throw new Error("Unknown queue");
  const b = await boss();
  await b.deleteJob(queue, ids);
  return ids.length;
}

export async function setPaused(queue: string, paused: boolean, by: string): Promise<void> {
  const resolved = resolveQueue(queue);
  if (!resolved || resolved.dead) throw new Error("Unknown queue");
  await controlDb
    .insert(queueControls)
    .values({ queue, paused, pausedAt: paused ? new Date() : null, pausedBy: paused ? by : null })
    .onConflictDoUpdate({
      target: queueControls.queue,
      set: { paused, pausedAt: paused ? new Date() : null, pausedBy: paused ? by : null },
    });
}

export async function queuePausedState(names: string[]): Promise<Map<string, boolean>> {
  if (names.length === 0) return new Map();
  const rows = await controlDb.select().from(queueControls).where(inArray(queueControls.queue, names));
  return new Map(rows.map((r) => [r.queue, r.paused]));
}

// ── Workers & schedules ──────────────────────────────────────

export async function listWorkers() {
  const b = await boss();
  const instances = await b.getInstances().catch(() => []);
  return instances
    .filter((i) => !i.stoppedOn)
    .map((i) => ({
      id: i.id,
      name: i.name,
      role: i.name?.startsWith("worker") ? "worker" : "api",
      host: i.host,
      pid: i.pid,
      version: i.version,
      nodeVersion: i.nodeVersion,
      supervise: i.supervise,
      schedule: i.schedule,
      workers: i.workers.length,
      startedOn: i.startedOn.toISOString(),
      lastHeartbeat: i.heartbeatOn.toISOString(),
      live: i.live,
    }));
}

export async function listSchedules() {
  const b = await boss();
  const schedules = await b.getSchedules().catch(() => []);
  return schedules.map((s) => {
    let nextRun: string | null = null;
    try {
      nextRun = b.previewSchedule(s.cron, { tz: s.timezone, count: 1 })[0]?.toISOString() ?? null;
    } catch {
      nextRun = null;
    }
    return { name: s.name, key: s.key, cron: s.cron, timezone: s.timezone, updatedOn: s.updatedOn.toISOString(), nextRun };
  });
}
