/**
 * defineSchedule — cron jobs (Laravel `$schedule->job(...)->cron(...)`).
 *
 * Backed by pg-boss schedules, which fire once per tick across every worker.
 * Scheduled jobs are system-scoped; per-tenant work fans out from inside the
 * scheduled job by dispatching tenant jobs.
 */
import type { PgBoss } from "pg-boss";
import { logger } from "../lib/logger.js";
import { ensureQueue } from "./boss.js";
import type { JobDefinition } from "./define.js";
import { envelopeSchema } from "./envelope.js";
import { sealPayload } from "./payload.js";

export interface ScheduleDefinition<P = unknown> {
  /** Unique schedule key, e.g. "system.ping.hourly". */
  name: string;
  cron: string;
  tz?: string;
  job: JobDefinition<P>;
  payload: P;
  /** Evaluated at worker start; disabled schedules are removed. */
  enabled?: () => boolean;
}

export function defineSchedule<P>(def: ScheduleDefinition<P>): ScheduleDefinition<P> {
  if (def.job.scope !== "system") throw new Error(`Schedule "${def.name}" must run a system-scoped job`);
  return def;
}

export async function applySchedules(boss: PgBoss, schedules: readonly ScheduleDefinition<unknown>[]): Promise<void> {
  for (const s of schedules) {
    await ensureQueue(boss, s.job);
    if (s.enabled && !s.enabled()) {
      await boss.unschedule(s.job.name, s.name);
      continue;
    }
    const data = envelopeSchema.parse({ v: 1, scope: "system", tags: ["schedule"], payload: sealPayload(s.job, s.payload) });
    await boss.schedule(s.job.name, s.cron, data, { key: s.name, ...(s.tz ? { tz: s.tz } : {}) });
    logger.info({ schedule: s.name, cron: s.cron }, "schedule registered");
  }
}
