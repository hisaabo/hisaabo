/**
 * Every job and schedule the system knows. Job names come only from here —
 * no API input ever chooses a queue (docs/architecture/queue.md §5.2).
 */
import type { AnyJobDefinition } from "./define.js";
import type { ScheduleDefinition } from "./schedule.js";
import { systemPing, systemPingSchedule } from "./jobs/system-ping.js";

export const JOBS: readonly AnyJobDefinition[] = [
  systemPing,
];

export const SCHEDULES: readonly ScheduleDefinition<unknown>[] = [
  systemPingSchedule as ScheduleDefinition<unknown>,
];

export function getJob(name: string): AnyJobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}
