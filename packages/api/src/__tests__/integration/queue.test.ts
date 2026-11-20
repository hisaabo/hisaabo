/**
 * queue.test.ts — the job queue against a real Postgres: transactional
 * dispatch, retries and dead-lettering, PermanentError, uniqueness, per-tenant
 * concurrency across two worker instances, pause/resume, tenant
 * re-validation, the per-tenant dispatch quota and graceful shutdown.
 *
 * Each test defines its own queue name so suites never see each other's jobs.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { controlDb, queueControls, tenants, tenantMembers, businesses } from "@hisaabo/db";
import type { PgBoss } from "pg-boss";
import {
  getTenantTestDb, truncateAllTables, closeTestDb, ensureQueueSchema, resetQueue,
} from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness } from "../helpers/fixtures.js";
import { defineJob, type AnyJobDefinition, type JobContext, type PoolName } from "../../queue/define.js";
import { dispatch } from "../../queue/dispatch.js";
import { createBoss } from "../../queue/boss.js";
import { startWorkerRuntime, type WorkerRuntime } from "../../queue/runtime.js";
import { PermanentError, RetryableError } from "../../queue/errors.js";
import { systemPing } from "../../queue/jobs/system-ping.js";

let seq = 0;
const qname = (label: string) => `test.${label}.${Date.now().toString(36)}${seq++}`;

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sender: PgBoss;
const runtimes: WorkerRuntime[] = [];

async function startRuntime(jobs: AnyJobDefinition[], pools: PoolName[] = ["default", "system"]) {
  const rt = await startWorkerRuntime({
    jobs, pools, pollingIntervalSeconds: 0.5, pausePollMs: 60_000,
    boss: { supervise: false, schedule: false, persistQueueStats: false, max: 4 },
  });
  runtimes.push(rt);
  return rt;
}

async function jobState(boss: PgBoss, queue: string, id: string) {
  return (await boss.getJobById(queue, id))?.state;
}

let tenantId: string;
let ownerId: string;
let businessId: string;

beforeAll(async () => {
  await ensureQueueSchema();
  await resetQueue();
  const owner = await createUser();
  ownerId = owner.id;
  const tenant = await createTenant();
  tenantId = tenant.id;
  await addMember(tenantId, ownerId, "owner");
  businessId = (await createBusiness(getTenantTestDb(), ownerId)).id;
  sender = createBoss({ max: 2 });
  await sender.start();
});

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((rt) => rt.stop(0)));
  delete process.env.QUEUE_CONCURRENCY_DEFAULT;
});

afterAll(async () => {
  await sender.stop({ graceful: false, close: true });
  await truncateAllTables();
  await closeTestDb();
});

describe("dispatch", () => {
  it("enqueues inside a transaction only when it commits", async () => {
    const seen: string[] = [];
    const job = defineJob({
      name: qname("tx"), scope: "system", payload: z.object({ n: z.string() }),
      async handle(p) { seen.push(p.n); },
    });

    await expect(controlDb.transaction(async (tx) => {
      await dispatch(job, { n: "rolled-back" }, { boss: sender, tx });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    const committed = await controlDb.transaction((tx) => dispatch(job, { n: "committed" }, { boss: sender, tx }));

    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, committed!)) === "completed");
    await sleep(700);
    expect(seen).toEqual(["committed"]);
  });

  it("runs the registry's system.ping end to end", async () => {
    const id = await dispatch(systemPing, { note: "test" }, { boss: sender });
    await startRuntime([systemPing], ["system"]);
    const done = await waitFor(async () => {
      const j = await sender.getJobById(systemPing.name, id!);
      return j?.state === "completed" ? j : null;
    });
    expect(done.output).toMatchObject({ pong: true });
  });

  it("de-duplicates unique jobs within the window", async () => {
    const job = defineJob({
      name: qname("unique"), scope: "system", payload: z.object({ k: z.string() }),
      unique: { key: (p) => p.k, forSeconds: 60 },
      handle: async () => undefined,
    });
    expect(await dispatch(job, { k: "a" }, { boss: sender })).toBeTruthy();
    expect(await dispatch(job, { k: "a" }, { boss: sender })).toBeNull();
    expect(await dispatch(job, { k: "b" }, { boss: sender })).toBeTruthy();
  });

  it("rejects dispatch beyond the per-tenant quota", async () => {
    const job = defineJob({
      name: qname("quota"), payload: z.object({}), maxQueuedPerTenant: 2,
      handle: async () => undefined,
    });
    await dispatch(job, {}, { boss: sender, tenantId });
    await dispatch(job, {}, { boss: sender, tenantId });
    const err = await dispatch(job, {}, { boss: sender, tenantId }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("failures", () => {
  it("retries, then dead-letters and calls onFailed once", async () => {
    let attempts = 0;
    const failed: string[] = [];
    const job = defineJob({
      name: qname("retry"), scope: "system", payload: z.object({}),
      retries: 2, backoff: { delaySeconds: 0 },
      async handle() { attempts++; throw new RetryableError("flaky upstream for ops@example.com"); },
      async onFailed(_p, err) { failed.push(err.message); },
    });
    const id = await dispatch(job, {}, { boss: sender });
    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "failed");
    expect(attempts).toBe(3);
    expect(failed).toHaveLength(1);

    const dead = await waitFor(async () => (await sender.findJobs(job.deadLetter))[0]);
    expect(dead.sourceId ?? dead.data).toBeTruthy();
    const original = await sender.getJobById(job.name, id!);
    // Stored error is masked.
    expect(JSON.stringify(original?.output)).not.toContain("ops@example.com");
  });

  it("does not retry a PermanentError", async () => {
    let attempts = 0;
    let failedCalls = 0;
    const job = defineJob({
      name: qname("permanent"), scope: "system", payload: z.object({}),
      retries: 5, backoff: { delaySeconds: 0 },
      async handle() { attempts++; throw new PermanentError("bad input"); },
      async onFailed() { failedCalls++; },
    });
    const id = await dispatch(job, {}, { boss: sender });
    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "failed");
    await sleep(700);
    expect(attempts).toBe(1);
    expect(failedCalls).toBe(1);
    await waitFor(async () => (await sender.findJobs(job.deadLetter)).length > 0);
  });

  it("fails a malformed envelope permanently without running the handler", async () => {
    let ran = false;
    const job = defineJob({
      name: qname("malformed"), scope: "system", payload: z.object({}), retries: 3,
      async handle() { ran = true; },
    });
    await dispatch(job, {}, { boss: sender }); // creates the queue
    const id = await sender.send(job.name, { v: 1, scope: "system", tags: [], payload: {}, sneaky: true });
    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "failed");
    const j = await sender.getJobById(job.name, id!);
    expect(j?.retryCount).toBe(0);
    await sleep(300);
    expect(ran).toBe(true); // the well-formed one ran; the malformed one did not retry
  });
});

describe("tenant context", () => {
  function tenantJob(onHandle: (ctx: JobContext) => void) {
    return defineJob({
      name: qname("tenant"), payload: z.object({}), retries: 3, backoff: { delaySeconds: 0 },
      async handle(_p, ctx) { onHandle(ctx); },
    });
  }

  it("provides the tenant DB for a valid tenant and business", async () => {
    let got: JobContext | undefined;
    const job = tenantJob((ctx) => { got = ctx; });
    const id = await dispatch(job, {}, { boss: sender, tenantId, businessId, actorUserId: ownerId });
    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "completed");
    expect(got?.tenantId).toBe(tenantId);
    expect(got?.businessId).toBe(businessId);
    expect(got?.db).toBeTruthy();
  });

  it("permanently fails when the business is gone", async () => {
    const ran: string[] = [];
    const job = tenantJob(() => ran.push("x"));
    const doomed = await createBusiness(getTenantTestDb(), ownerId);
    const id = await dispatch(job, {}, { boss: sender, tenantId, businessId: doomed.id });
    await getTenantTestDb().delete(businesses).where(eq(businesses.id, doomed.id));
    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "failed");
    expect(ran).toEqual([]);
    expect((await sender.getJobById(job.name, id!))?.retryCount).toBe(0);
  });

  it("permanently fails when the actor left or the tenant was suspended", async () => {
    const ran: string[] = [];
    const job = tenantJob(() => ran.push("x"));
    const leaver = await createUser();
    await addMember(tenantId, leaver.id, "seller");
    const byLeaver = await dispatch(job, {}, { boss: sender, tenantId, actorUserId: leaver.id });
    await controlDb.delete(tenantMembers).where(eq(tenantMembers.userId, leaver.id));

    const other = await createTenant();
    const inSuspended = await dispatch(job, {}, { boss: sender, tenantId: other.id });
    await controlDb.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, other.id));

    await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, byLeaver!)) === "failed");
    await waitFor(async () => (await jobState(sender, job.name, inSuspended!)) === "failed");
    expect(ran).toEqual([]);
  });
});

describe("workers", () => {
  it("strictly caps tenantConcurrency 1 across two worker instances", async () => {
    process.env.QUEUE_CONCURRENCY_DEFAULT = "3";
    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    const job = defineJob({
      name: qname("fair"), payload: z.object({}), tenantConcurrency: 1,
      async handle(_p, ctx) {
        const t = ctx.tenantId!;
        active.set(t, (active.get(t) ?? 0) + 1);
        peak.set(t, Math.max(peak.get(t) ?? 0, active.get(t)!));
        await sleep(300);
        active.set(t, active.get(t)! - 1);
      },
    });
    const other = await createTenant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await dispatch(job, {}, { boss: sender, tenantId }))!);
      ids.push((await dispatch(job, {}, { boss: sender, tenantId: other.id }))!);
    }
    await startRuntime([job]);
    await startRuntime([job]);
    await waitFor(async () => {
      for (const id of ids) if ((await jobState(sender, job.name, id)) !== "completed") return false;
      return true;
    }, 30_000);
    expect(peak.get(tenantId)).toBe(1);
    expect(peak.get(other.id)).toBe(1);
  });

  it("pauses and resumes a queue from queue_controls", async () => {
    let ran = 0;
    const job = defineJob({
      name: qname("pause"), scope: "system", payload: z.object({}),
      async handle() { ran++; },
    });
    await controlDb.insert(queueControls).values({ queue: job.name, paused: true, pausedAt: new Date(), pausedBy: "test" });
    const id = await dispatch(job, {}, { boss: sender });
    const rt = await startRuntime([job]);
    await sleep(1500);
    expect(ran).toBe(0);
    expect(await jobState(sender, job.name, id!)).toBe("created");

    await controlDb.update(queueControls).set({ paused: false }).where(eq(queueControls.queue, job.name));
    await rt.workers.applyPauses();
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "completed");
    expect(ran).toBe(1);
  });

  it("lets an in-flight job finish on graceful stop", async () => {
    let finished = false;
    const job = defineJob({
      name: qname("graceful"), scope: "system", payload: z.object({}),
      async handle() { await sleep(800); finished = true; },
    });
    const id = await dispatch(job, {}, { boss: sender });
    const rt = await startRuntime([job]);
    await waitFor(async () => (await jobState(sender, job.name, id!)) === "active");
    runtimes.splice(runtimes.indexOf(rt), 1);
    await rt.stop(5);
    expect(finished).toBe(true);
    expect(await jobState(sender, job.name, id!)).toBe("completed");
  });
});
