/**
 * queue-unavailable.test.ts — the API must degrade, not crash, when the job
 * queue cannot be used (pgboss schema not installed because the migration
 * step's install was skipped, or the queue database is unreachable). Needs no
 * database: the queue URL points at a closed port.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { z } from "zod";
import { getSenderBoss, stopSenderBoss } from "../queue/boss.js";
import { dispatch } from "../queue/dispatch.js";
import { defineJob } from "../queue/define.js";
import { QueueUnavailableError } from "../queue/errors.js";

afterEach(async () => {
  vi.unstubAllEnvs();
  await stopSenderBoss();
});

describe("API sender instance without a usable queue", () => {
  it("rejects with QueueUnavailableError and can be retried on the next call", async () => {
    vi.stubEnv("QUEUE_DATABASE_URL", "postgres://hisaabo:hisaabo@127.0.0.1:1/none");
    await expect(getSenderBoss()).rejects.toBeInstanceOf(QueueUnavailableError);
    // A failed start must not be cached: the next call tries again.
    await expect(getSenderBoss()).rejects.toBeInstanceOf(QueueUnavailableError);
  });

  it("dispatch() surfaces QueueUnavailableError instead of dropping the job or crashing", async () => {
    vi.stubEnv("QUEUE_DATABASE_URL", "postgres://hisaabo:hisaabo@127.0.0.1:1/none");
    const job = defineJob({ name: "test.unavailable", scope: "system", pool: "system", payload: z.object({}), handle: async () => undefined });
    await expect(dispatch(job, {})).rejects.toBeInstanceOf(QueueUnavailableError);
  });
});
