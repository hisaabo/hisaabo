/**
 * Worker side: runs one job and reports its outcome to pg-boss.
 *
 * Workers use pg-boss `perJobResults`, so each attempt settles as:
 *   completed  — handler resolved
 *   failed     — error; pg-boss retries until retryLimit, then copies the job
 *                to its dead-letter queue (<name>.dead)
 *   deadletter — PermanentError or an unreadable envelope/payload: straight
 *                to the dead-letter queue, no retries
 * The stored error is masked (GSTINs, emails, phone numbers); stacks go to the
 * worker log only.
 */
import { controlDb } from "@hisaabo/db";
import type { PgBoss, Job, JobResult } from "pg-boss";
import { logger } from "../lib/logger.js";
import { maskFreeText, tenantHandle } from "../lib/admin/privacy.js";
import type { JobContext, AnyJobDefinition } from "./define.js";
import { parseEnvelope, type Envelope } from "./envelope.js";
import { openPayload } from "./payload.js";
import { establishTenantContext } from "./context.js";
import { PermanentError, isPermanent } from "./errors.js";

const MAX_ERROR_CHARS = 500;

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function toOutput(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "object" && !Array.isArray(value) ? value : { value };
}

export async function runJob(
  boss: PgBoss,
  def: AnyJobDefinition,
  job: Job<unknown>,
  shutdown: AbortSignal,
): Promise<JobResult> {
  const attempt = job.retryCount + 1;
  let log = logger.child({ jobId: job.id, queue: def.name, attempt });
  const signal = AbortSignal.any([job.signal, shutdown]);
  let payload: unknown;
  let ctx: JobContext | undefined;

  try {
    let envelope: Envelope;
    try {
      envelope = parseEnvelope(job.data);
    } catch {
      throw new PermanentError("Invalid job envelope");
    }
    if (envelope.scope !== def.scope) throw new PermanentError("Job scope does not match its definition");
    if (envelope.tenantId) log = log.child({ tenant: tenantHandle(envelope.tenantId) });

    payload = openPayload(def, envelope.payload);
    ctx = {
      jobId: job.id,
      queue: def.name,
      attempt,
      ...(envelope.tenantId ? { tenantId: envelope.tenantId } : {}),
      ...(envelope.businessId ? { businessId: envelope.businessId } : {}),
      ...(envelope.actorUserId ? { actorUserId: envelope.actorUserId } : {}),
      controlDb,
      logger: log,
      signal,
      heartbeat: async () => { await boss.touch(def.name, job.id); },
      progress: async (pct, note) => {
        log.info({ progress: Math.max(0, Math.min(100, pct)), note }, "job progress");
        if (def.heartbeatSeconds) await boss.touch(def.name, job.id);
      },
    };
    if (def.scope === "tenant") ctx.db = (await establishTenantContext(envelope)).db;

    const output = await def.handle(payload, ctx);
    log.debug("job completed");
    return { id: job.id, status: "completed", ...(toOutput(output) ? { output: toOutput(output) } : {}) };
  } catch (err) {
    const error = toError(err);
    const permanent = isPermanent(err);
    const final = permanent || job.retryCount >= def.retries;
    log.warn({ err: error, permanent, final }, "job attempt failed");

    if (final && def.onFailed && ctx) {
      await def.onFailed(payload, error, ctx).catch((hookErr) => log.error({ err: hookErr }, "onFailed hook threw"));
    }
    return {
      id: job.id,
      status: permanent ? "deadletter" : "failed",
      output: { error: maskFreeText(error.message).slice(0, MAX_ERROR_CHARS), type: error.name },
    };
  }
}
