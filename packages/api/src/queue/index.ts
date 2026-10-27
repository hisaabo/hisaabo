// Public surface of the job queue (docs/architecture/queue.md).
export { defineJob, type JobContext, type JobDefinition, type JobOptions, type PoolName } from "./define.js";
export { dispatch, type DispatchOptions } from "./dispatch.js";
export { defineSchedule, type ScheduleDefinition } from "./schedule.js";
export { RetryableError, PermanentError } from "./errors.js";
export { runInThread, ThreadTimeoutError } from "./run-in-thread.js";
export { stopSenderBoss } from "./boss.js";
