/**
 * queue.test.ts — job queue building blocks that need no database:
 * envelope validation, payload sealing, the secret-field guard, option
 * mapping, configuration parsing, error classes and runInThread.
 */
import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { defineJob, unencryptedSecretFields, DEAD_SUFFIX } from "../queue/define.js";
import { envelopeSchema } from "../queue/envelope.js";
import { sealPayload, openPayload } from "../queue/payload.js";
import { queueOptions, deadLetterOptions } from "../queue/boss.js";
import { workerPools, poolConcurrency, retentionConfig } from "../queue/config.js";
import { PermanentError, RetryableError, isPermanent } from "../queue/errors.js";
import { runInThread, ThreadTimeoutError } from "../queue/run-in-thread.js";
import { JOBS, SCHEDULES } from "../queue/registry.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const KEY = "a".repeat(64);

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/queue/${name}`, import.meta.url));

const noop = async () => undefined;

describe("defineJob", () => {
  it("applies defaults and derives the dead-letter queue", () => {
    const job = defineJob({ name: "test.thing", payload: z.object({}), handle: noop });
    expect(job).toMatchObject({
      scope: "tenant", pool: "default", retries: 3, timeoutSeconds: 300,
      tenantConcurrency: 2, policy: "standard", maxQueuedPerTenant: 50,
      deadLetter: "test.thing" + DEAD_SUFFIX,
    });
  });

  it("keys tenantConcurrency 1 jobs by tenant with the singleton policy", () => {
    const one = defineJob({ name: "test.one", payload: z.object({}), tenantConcurrency: 1, handle: noop });
    expect(one).toMatchObject({ policy: "singleton", tenantKeyed: true });
    const two = defineJob({ name: "test.two", payload: z.object({}), handle: noop });
    expect(two).toMatchObject({ policy: "standard", tenantKeyed: false });
    const sys = defineJob({ name: "test.sys", scope: "system", payload: z.object({}), tenantConcurrency: 1, handle: noop });
    expect(sys.tenantKeyed).toBe(false);
  });

  it.each(["", "Bad", "a b", "x.dead", "-x", "a..b"])("rejects the name %j", (name) => {
    expect(() => defineJob({ name, payload: z.object({}), handle: noop })).toThrow();
  });
});

describe("envelope", () => {
  const base = { v: 1, tags: [], payload: {} };

  it("requires a tenantId for tenant jobs", () => {
    expect(envelopeSchema.safeParse({ ...base, scope: "tenant" }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...base, scope: "tenant", tenantId: TENANT }).success).toBe(true);
  });

  it("forbids tenant context on system jobs", () => {
    expect(envelopeSchema.safeParse({ ...base, scope: "system", tenantId: TENANT }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...base, scope: "system" }).success).toBe(true);
  });

  it("rejects unknown keys and versions", () => {
    expect(envelopeSchema.safeParse({ ...base, scope: "system", extra: 1 }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...base, v: 2, scope: "system" }).success).toBe(false);
  });
});

describe("payload sealing", () => {
  const job = defineJob({
    name: "test.sealed",
    payload: z.object({ invoiceId: z.string(), apiToken: z.string() }),
    encrypt: ["apiToken"],
    handle: noop,
  });
  const prevKey = process.env.ENCRYPTION_KEY;
  afterEach(() => {
    if (prevKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prevKey;
  });

  it("encrypts listed fields and round-trips", () => {
    process.env.ENCRYPTION_KEY = KEY;
    const sealed = sealPayload(job, { invoiceId: "inv-1", apiToken: "s3cret" });
    expect(sealed.invoiceId).toBe("inv-1");
    expect(sealed.apiToken).not.toContain("s3cret");
    expect(openPayload(job, sealed)).toEqual({ invoiceId: "inv-1", apiToken: "s3cret" });
  });

  it("rejects an invalid payload at dispatch", () => {
    expect(() => sealPayload(job, { invoiceId: 1 } as never)).toThrow();
  });

  it("treats an unreadable stored payload as permanent", () => {
    process.env.ENCRYPTION_KEY = KEY;
    const sealed = sealPayload(job, { invoiceId: "inv-1", apiToken: "s3cret" });
    expect(() => openPayload(job, { ...sealed, invoiceId: 7 })).toThrow(PermanentError);
    const tampered = { ...sealed, apiToken: String(sealed.apiToken).slice(0, -4) + "AAAA" };
    expect(() => openPayload(job, tampered)).toThrow(PermanentError);
  });
});

describe("secret-field guard", () => {
  it("flags secret-looking fields that are not encrypted", () => {
    const job = defineJob({
      name: "test.leaky",
      payload: z.object({ password: z.string(), apiKey: z.string(), clientSecret: z.string(), invoiceId: z.string() }),
      encrypt: ["clientSecret"],
      handle: noop,
    });
    expect(unencryptedSecretFields(job).sort()).toEqual(["apiKey", "password"]);
  });

  it("passes for every registered job", () => {
    for (const job of JOBS) expect(unencryptedSecretFields(job), job.name).toEqual([]);
  });

  it("registry job names are unique and schedules run system jobs", () => {
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
    for (const s of SCHEDULES) expect(s.job.scope).toBe("system");
  });
});

describe("queue options", () => {
  const retention = { completedSeconds: 3600, failedSeconds: 86400 };

  it("maps a job definition to pg-boss queue options", () => {
    const job = defineJob({
      name: "test.opts",
      payload: z.object({}),
      retries: 5,
      backoff: { delaySeconds: 7, exponential: true, maxDelaySeconds: 600 },
      timeoutSeconds: 90,
      heartbeatSeconds: 30,
      policy: "singleton",
      handle: noop,
    });
    expect(queueOptions(job, retention)).toEqual({
      policy: "singleton",
      retryLimit: 5,
      retryDelay: 7,
      retryBackoff: true,
      retryDelayMax: 600,
      expireInSeconds: 90,
      heartbeatSeconds: 30,
      retentionSeconds: 86400,
      deleteAfterSeconds: 3600,
      deadLetter: "test.opts.dead",
    });
  });

  it("keeps dead-letter jobs for the failed retention and never retries them", () => {
    expect(deadLetterOptions(retention)).toEqual({
      policy: "standard", retryLimit: 0, retentionSeconds: 86400, deleteAfterSeconds: 86400,
    });
  });
});

describe("config", () => {
  it("parses QUEUE_POOLS", () => {
    expect(workerPools({})).toEqual(["default", "heavy", "system"]);
    expect(workerPools({ QUEUE_POOLS: "heavy, system,heavy" })).toEqual(["heavy", "system"]);
    expect(() => workerPools({ QUEUE_POOLS: "default,bogus" })).toThrow(/bogus/);
  });

  it("reads per-pool concurrency and retention", () => {
    expect(poolConcurrency("heavy", {})).toBe(2);
    expect(poolConcurrency("default", { QUEUE_CONCURRENCY_DEFAULT: "3" })).toBe(3);
    expect(() => poolConcurrency("default", { QUEUE_CONCURRENCY_DEFAULT: "0" })).toThrow();
    expect(retentionConfig({ QUEUE_COMPLETED_RETENTION_HOURS: "2", QUEUE_FAILED_RETENTION_DAYS: "1" }))
      .toEqual({ completedSeconds: 7200, failedSeconds: 86400 });
  });
});

describe("errors", () => {
  it("only PermanentError (and subclasses) skip retries", () => {
    expect(isPermanent(new PermanentError("x"))).toBe(true);
    expect(isPermanent(new ThreadTimeoutError("x"))).toBe(true);
    expect(isPermanent(new RetryableError("x"))).toBe(false);
    expect(isPermanent(new Error("x"))).toBe(false);
  });
});

describe("runInThread", () => {
  it("returns the module's result", async () => {
    await expect(runInThread(fixture("double.mjs"), 21, { timeoutMs: 5000 })).resolves.toBe(42);
  });

  it("propagates errors with their name", async () => {
    await expect(runInThread(fixture("fail.mjs"), "nope", { timeoutMs: 5000 }))
      .rejects.toMatchObject({ name: "RangeError", message: "nope" });
  });

  it("terminates a runaway synchronous task at the timeout", async () => {
    const started = Date.now();
    await expect(runInThread(fixture("spin.mjs"), null, { timeoutMs: 300 })).rejects.toBeInstanceOf(ThreadTimeoutError);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stops when the signal aborts", async () => {
    const ac = new AbortController();
    const run = runInThread(fixture("spin.mjs"), null, { timeoutMs: 10_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await expect(run).rejects.toThrow(/Aborted/);
  });
});
