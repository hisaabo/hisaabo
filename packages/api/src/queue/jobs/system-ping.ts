/**
 * system.ping — diagnostic job with no tenant data. Proves a worker is
 * consuming the queue end to end; optionally scheduled hourly
 * (QUEUE_PING_SCHEDULE=true).
 */
import { z } from "zod";
import { defineJob } from "../define.js";
import { defineSchedule } from "../schedule.js";

export const systemPing = defineJob({
  name: "system.ping",
  scope: "system",
  pool: "system",
  payload: z.object({ note: z.string().max(200) }),
  retries: 2,
  backoff: { delaySeconds: 5, exponential: true, maxDelaySeconds: 300 },
  timeoutSeconds: 30,
  async handle(payload, ctx) {
    ctx.logger.info({ note: payload.note }, "pong");
    return { pong: true, at: new Date().toISOString() };
  },
});

export const systemPingSchedule = defineSchedule({
  name: "system.ping.hourly",
  cron: "0 * * * *",
  job: systemPing,
  payload: { note: "hourly" },
  enabled: () => process.env.QUEUE_PING_SCHEDULE === "true",
});
