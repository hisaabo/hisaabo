/**
 * ops.test.ts — /ops operator dashboard API and the `ops` CLI against real
 * Postgres (docs/architecture/queue.md §7.2, §9, §10).
 *
 * The heart of this file is the authorization matrix: every /ops/api route is
 * exercised against a disabled dashboard, a non-allowlisted IP, no session,
 * bearer / API-key credentials, non-operators, disabled and unenrolled
 * operators, viewers, admins without and with a fresh step-up, missing CSRF
 * header / Origin, idle and expired ops sessions, and a Hisaabo logout.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, desc } from "drizzle-orm";
import { controlDb, opsOperators, opsSessions, opsAuditLog, sessions, queueControls } from "@hisaabo/db";
import { truncateAllTables, closeTestDb, ensureQueueSchema, resetQueue } from "../helpers/test-db.js";
import { createUser, createSession } from "../helpers/fixtures.js";
import { registerOpsRoutes, resetOpsRateLimits, OPS_APP_CSP } from "../../ops/routes.js";
import { addOperator, enrollOperator, MAX_FAILED_ATTEMPTS } from "../../ops/operators.js";
import { base32Decode, totpCode } from "../../ops/totp.js";
import { dispatch } from "../../queue/dispatch.js";
import { getSenderBoss, stopSenderBoss } from "../../queue/boss.js";
import { systemPing } from "../../queue/jobs/system-ping.js";
import { resetAllCaches } from "../../lib/cache/index.js";
import { main as opsCli } from "../../bin/ops.js";

const ORIGIN = "http://api.test";
const ENC_KEY = "a".repeat(64);
let staticDir: string;
let app: Hono;

const ENV_KEYS = ["QUEUE_DASHBOARD_ENABLED", "OPS_IP_ALLOWLIST", "API_PUBLIC_URL", "ENCRYPTION_KEY", "OPS_STEP_UP_MINUTES"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.ENCRYPTION_KEY = ENC_KEY;
  process.env.API_PUBLIC_URL = ORIGIN;
  await ensureQueueSchema();
  await resetQueue();
  await truncateAllTables();

  staticDir = mkdtempSync(path.join(tmpdir(), "ops-public-"));
  writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>ops</title>");
  mkdirSync(path.join(staticDir, "assets"));
  writeFileSync(path.join(staticDir, "assets", "index-abc123.js"), "console.log(1)");

  app = new Hono();
  registerOpsRoutes(app, {
    notFound: (c) => c.text("not found", 404),
    clientIp: (c) => c.req.header("x-test-ip") ?? "198.51.100.10",
    staticDir,
  });
});

beforeEach(() => {
  process.env.QUEUE_DASHBOARD_ENABLED = "true";
  delete process.env.OPS_IP_ALLOWLIST;
  resetOpsRateLimits();
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(staticDir, { recursive: true, force: true });
  await stopSenderBoss();
  await resetQueue();
  await truncateAllTables();
  await closeTestDb();
});

// ── Helpers ──────────────────────────────────────────────────

interface Actor {
  email: string;
  userId: string;
  sessionId: string;
  secret: string | null;
}

async function makeActor(role: "admin" | "viewer" | null, opts: { enroll?: boolean } = {}): Promise<Actor> {
  const user = await createUser();
  const session = await createSession(user.id);
  let secret: string | null = null;
  if (role) {
    await addOperator(user.email, role, "test");
    if (opts.enroll !== false) secret = (await enrollOperator(user.email)).enrollment.secret;
  }
  return { email: user.email, userId: user.id, sessionId: session.id, secret };
}

/** A code for the operator's next unused step (clears the replay guard). */
async function code(a: Actor): Promise<string> {
  await controlDb.update(opsOperators).set({ totpLastStep: null }).where(eq(opsOperators.email, a.email));
  return totpCode(base32Decode(a.secret!), Date.now());
}

function headers(cookie: string | null, extra: Record<string, string> = {}): Record<string, string> {
  return { ...(cookie ? { cookie } : {}), ...extra };
}

function post(url: string, cookie: string | null, body: unknown = {}, extra: Record<string, string> = {}) {
  return app.request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: headers(cookie, { "content-type": "application/json", "x-requested-with": "hisaabo", origin: ORIGIN, ...extra }),
    body: JSON.stringify(body),
  });
}

function get(url: string, cookie: string | null, extra: Record<string, string> = {}) {
  return app.request(`${ORIGIN}${url}`, { headers: headers(cookie, extra) });
}

/** Sign in to /ops; returns the combined cookie header. */
async function signIn(a: Actor): Promise<string> {
  const base = `session_id=${a.sessionId}`;
  const res = await post("/ops/api/session", base, { code: await code(a) });
  expect(res.status).toBe(200);
  const set = res.headers.get("set-cookie") ?? "";
  const token = set.match(/hisaabo_ops=([^;]+)/)?.[1];
  expect(token).toBeTruthy();
  expect(set).toMatch(/HttpOnly/);
  expect(set).toMatch(/SameSite=Strict/);
  expect(set).toMatch(/Path=\/ops/);
  return `${base}; hisaabo_ops=${token}`;
}

async function lastAudit() {
  const [row] = await controlDb.select().from(opsAuditLog).orderBy(desc(opsAuditLog.id)).limit(1);
  return row;
}

async function expireStepUp(cookie: string) {
  const token = cookie.match(/hisaabo_ops=([^;]+)/)![1];
  const { hashOpsToken } = await import("../../ops/sessions.js");
  await controlDb.update(opsSessions).set({ stepUpAt: new Date(Date.now() - 60 * 60_000) }).where(eq(opsSessions.tokenHash, hashOpsToken(token)));
}

/** Empty the queue; the sender caches which queues exist, so restart it too. */
async function freshQueue(): Promise<void> {
  await resetQueue();
  await stopSenderBoss();
}

async function deadLetterJob(note = "boom"): Promise<string> {
  await dispatch(systemPing, { note: "seed" });
  const boss = await getSenderBoss();
  const id = await boss.send(systemPing.deadLetter, { v: 1, scope: "system", tags: ["t1"], payload: { note } }, { retryLimit: 0 });
  return id!;
}

const READ_ROUTES = ["/ops/api/overview", "/ops/api/queues", "/ops/api/queues/system.ping", "/ops/api/jobs?tab=pending", "/ops/api/workers", "/ops/api/schedules", "/ops/api/audit"];

// ── Gate ─────────────────────────────────────────────────────

describe("/ops gate", () => {
  it("is a plain 404 everywhere when the dashboard is disabled", async () => {
    process.env.QUEUE_DASHBOARD_ENABLED = "false";
    for (const p of ["/ops", "/ops/", "/ops/api/me", ...READ_ROUTES]) {
      const res = await get(p, null);
      expect(res.status, p).toBe(404);
      expect(await res.text()).toBe("not found");
    }
    expect((await post("/ops/api/session", null, { code: "123456" })).status).toBe(404);
  });

  it("is a plain 404 for clients outside OPS_IP_ALLOWLIST", async () => {
    process.env.OPS_IP_ALLOWLIST = "10.0.0.0/8";
    expect((await get("/ops/api/me", null, { "x-test-ip": "198.51.100.10" })).status).toBe(404);
    expect((await get("/ops/api/me", null, { "x-test-ip": "10.2.3.4" })).status).toBe(200);
  });

  it("serves the app with the strict CSP and no CORS headers", async () => {
    const res = await get("/ops/", null, { origin: "https://evil.example" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(OPS_APP_CSP);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...res.headers.keys()].some((h) => h.startsWith("access-control-"))).toBe(false);

    const asset = await get("/ops/assets/index-abc123.js", null);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await get("/ops/jobs/some/route", null)).status).toBe(200); // SPA fallback
    expect((await get("/ops/assets/..%2f..%2fetc%2fpasswd", null)).status).toBe(404);
    expect((await get("/ops/assets/missing.js", null)).status).toBe(404);
    expect((await get("/ops", null)).status).toBe(302);
  });

  it("API responses are no-store with a deny-all CSP", async () => {
    const res = await get("/ops/api/me", null);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("rate-limits sign-in attempts per IP", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post("/ops/api/session", null, { code: "123456" }, { "x-test-ip": "203.0.113.99" })).status;
    expect(last).toBe(429);
  });
});

// ── Sign-in ──────────────────────────────────────────────────

describe("sign-in", () => {
  it("/me reports the Hisaabo session and operator state", async () => {
    const admin = await makeActor("admin");
    expect(await (await get("/ops/api/me", null)).json()).toMatchObject({ hisaabo: null, operator: null, ops: null });
    const me = await (await get("/ops/api/me", `session_id=${admin.sessionId}`)).json();
    expect(me.hisaabo.email).toBe(admin.email);
    expect(me.operator).toMatchObject({ role: "admin", enrolled: true });
    expect(me.ops).toBeNull();
  });

  it("requires CSRF header and same Origin", async () => {
    const admin = await makeActor("admin");
    const c = `session_id=${admin.sessionId}`;
    expect((await post("/ops/api/session", c, { code: await code(admin) }, { "x-requested-with": "" })).status).toBe(403);
    expect((await post("/ops/api/session", c, { code: await code(admin) }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("rejects bearer sessions and API keys", async () => {
    const admin = await makeActor("admin");
    for (const auth of [`Bearer ${admin.sessionId}`, "Bearer hisaabo_key_abc", "Bearer at_abc"]) {
      const res = await post("/ops/api/session", null, { code: "123456" }, { authorization: auth });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("cookie_session_required");
    }
  });

  it("refuses non-operators, disabled and unenrolled operators — and audits it", async () => {
    const plain = await makeActor(null);
    let res = await post("/ops/api/session", `session_id=${plain.sessionId}`, { code: "123456" });
    expect(res.status).toBe(403);
    expect(await lastAudit()).toMatchObject({ action: "sign_in", result: "denied", details: { reason: "not_operator" } });

    const unenrolled = await makeActor("admin", { enroll: false });
    res = await post("/ops/api/session", `session_id=${unenrolled.sessionId}`, { code: "123456" });
    expect(res.status).toBe(403);

    const disabled = await makeActor("admin");
    await controlDb.update(opsOperators).set({ disabledAt: new Date() }).where(eq(opsOperators.email, disabled.email));
    res = await post("/ops/api/session", `session_id=${disabled.sessionId}`, { code: await code(disabled) });
    expect(res.status).toBe(403);
  });

  it("refuses unverified Hisaabo accounts", async () => {
    const admin = await makeActor("admin");
    const { users } = await import("@hisaabo/db");
    await controlDb.update(users).set({ emailVerified: false }).where(eq(users.id, admin.userId));
    const res = await post("/ops/api/session", `session_id=${admin.sessionId}`, { code: await code(admin) });
    expect(res.status).toBe(403);
  });

  it("signs in with TOTP, audits it, and a code cannot be replayed", async () => {
    const admin = await makeActor("admin");
    const c = `session_id=${admin.sessionId}`;
    const first = await code(admin);
    expect((await post("/ops/api/session", c, { code: first })).status).toBe(200);
    expect(await lastAudit()).toMatchObject({ action: "sign_in", result: "ok", actor: admin.email, details: { method: "totp" } });
    const replay = await post("/ops/api/session", c, { code: first });
    expect(replay.status).toBe(401);
  });

  it("recovery codes work once", async () => {
    const user = await createUser();
    const session = await createSession(user.id);
    await addOperator(user.email, "admin", "test");
    const { enrollment } = await enrollOperator(user.email);
    const c = `session_id=${session.id}`;
    const rc = enrollment.recoveryCodes[0];
    expect((await post("/ops/api/session", c, { code: rc })).status).toBe(200);
    expect((await post("/ops/api/session", c, { code: rc })).status).toBe(401);
    const [op] = await controlDb.select().from(opsOperators).where(eq(opsOperators.email, user.email));
    expect(op.recoveryCodeHashes).toHaveLength(9);
  });

  it("locks the operator out after repeated bad codes", async () => {
    const admin = await makeActor("admin");
    const c = `session_id=${admin.sessionId}`;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      resetOpsRateLimits();
      expect((await post("/ops/api/session", c, { code: "000000" })).status).toBe(401);
    }
    resetOpsRateLimits();
    const res = await post("/ops/api/session", c, { code: await code(admin) });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("locked");
  });
});

// ── Authorization matrix ─────────────────────────────────────

describe("authorization matrix", () => {
  it("every read route needs an ops session; viewers and admins may read", async () => {
    const viewer = await makeActor("viewer");
    const admin = await makeActor("admin");
    const vCookie = await signIn(viewer);
    const aCookie = await signIn(admin);
    for (const route of READ_ROUTES) {
      expect((await get(route, null)).status, `${route} anon`).toBe(401);
      expect((await get(route, `session_id=${admin.sessionId}`)).status, `${route} no ops session`).toBe(401);
      expect((await get(route, vCookie)).status, `${route} viewer`).toBe(200);
      expect((await get(route, aCookie)).status, `${route} admin`).toBe(200);
    }
  });

  it("actions: CSRF → session → admin → step-up, each denial audited", async () => {
    const jobId = await deadLetterJob();
    const viewer = await makeActor("viewer");
    const admin = await makeActor("admin");
    const vCookie = await signIn(viewer);
    const aCookie = await signIn(admin);

    const actions: [string, unknown][] = [
      ["/ops/api/queues/system.ping/pause", {}],
      ["/ops/api/queues/system.ping/resume", {}],
      [`/ops/api/jobs/${systemPing.deadLetter}/${jobId}/reveal`, {}],
      ["/ops/api/jobs/retry", { queue: systemPing.deadLetter, ids: [jobId] }],
      ["/ops/api/jobs/delete", { queue: systemPing.deadLetter, ids: [jobId] }],
    ];

    for (const [route, body] of actions) {
      expect((await post(route, aCookie, body, { "x-requested-with": "" })).status, `${route} no csrf header`).toBe(403);
      expect((await post(route, aCookie, body, { origin: "" })).status, `${route} no origin`).toBe(403);
      expect((await post(route, null, body)).status, `${route} anon`).toBe(401);
      expect((await post(route, `session_id=${admin.sessionId}`, body)).status, `${route} no ops session`).toBe(401);
      const asViewer = await post(route, vCookie, body);
      expect(asViewer.status, `${route} viewer`).toBe(403);
      expect((await asViewer.json()).error).toBe("admin_required");
      expect(await lastAudit()).toMatchObject({ result: "denied", actor: viewer.email });
    }

    await expireStepUp(aCookie);
    const stale = await post("/ops/api/queues/system.ping/pause", aCookie);
    expect(stale.status).toBe(403);
    expect((await stale.json()).error).toBe("step_up_required");

    const stepUp = await post("/ops/api/step-up", aCookie, { code: await code(admin) });
    expect(stepUp.status).toBe(200);
    expect(await lastAudit()).toMatchObject({ action: "step_up", result: "ok" });

    // Fresh step-up: every action succeeds and is audited.
    expect((await post("/ops/api/queues/system.ping/pause", aCookie)).status).toBe(200);
    expect(await lastAudit()).toMatchObject({ action: "queue_pause", queue: "system.ping", result: "ok" });
    const [ctl] = await controlDb.select().from(queueControls).where(eq(queueControls.queue, "system.ping"));
    expect(ctl).toMatchObject({ paused: true, pausedBy: admin.email });

    expect((await post("/ops/api/queues/system.ping/resume", aCookie)).status).toBe(200);
    expect(await lastAudit()).toMatchObject({ action: "queue_resume" });

    const reveal = await post(`/ops/api/jobs/${systemPing.deadLetter}/${jobId}/reveal`, aCookie);
    expect(reveal.status).toBe(200);
    expect((await reveal.json()).payload).toEqual({ note: "boom" });
    expect(await lastAudit()).toMatchObject({ action: "job_reveal", jobIds: [jobId] });

    const retry = await post("/ops/api/jobs/retry", aCookie, { queue: systemPing.deadLetter, ids: [jobId] });
    expect(retry.status).toBe(200);
    expect(await lastAudit()).toMatchObject({ action: "jobs_retry", jobIds: [jobId] });

    const dead2 = await deadLetterJob("again");
    const del = await post("/ops/api/jobs/delete", aCookie, { queue: systemPing.deadLetter, ids: [dead2] });
    expect(del.status).toBe(200);
    expect(await lastAudit()).toMatchObject({ action: "jobs_delete", jobIds: [dead2] });
  });

  it("rejects unknown queues, malformed ids and oversized bulks", async () => {
    const admin = await makeActor("admin");
    const c = await signIn(admin);
    expect((await get("/ops/api/queues/nope", c)).status).toBe(404);
    expect((await get("/ops/api/jobs?queue=nope", c)).status).toBe(404);
    expect((await get("/ops/api/jobs/system.ping/not-a-uuid", c)).status).toBe(404);
    expect((await post("/ops/api/jobs/retry", c, { queue: "pgboss.anything", ids: [crypto.randomUUID()] })).status).toBe(400);
    const ids = Array.from({ length: 501 }, () => crypto.randomUUID());
    expect((await post("/ops/api/jobs/delete", c, { queue: systemPing.deadLetter, ids })).status).toBe(400);
    expect((await post("/ops/api/queues/system.ping.dead/pause", c)).status).toBe(404);
  });

  it("idle and expired ops sessions are refused and revoked", async () => {
    const admin = await makeActor("admin");
    let c = await signIn(admin);
    const token = () => c.match(/hisaabo_ops=([^;]+)/)![1];
    const { hashOpsToken } = await import("../../ops/sessions.js");

    await controlDb.update(opsSessions).set({ lastSeenAt: new Date(Date.now() - 16 * 60_000) }).where(eq(opsSessions.tokenHash, hashOpsToken(token())));
    expect((await get("/ops/api/queues", c)).status).toBe(401);
    const [idle] = await controlDb.select().from(opsSessions).where(eq(opsSessions.tokenHash, hashOpsToken(token())));
    expect(idle.revokedAt).not.toBeNull();

    c = await signIn(admin);
    await controlDb.update(opsSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(opsSessions.tokenHash, hashOpsToken(token())));
    expect((await get("/ops/api/queues", c)).status).toBe(401);
  });

  it("signing out of Hisaabo ends /ops access", async () => {
    const admin = await makeActor("admin");
    const c = await signIn(admin);
    expect((await get("/ops/api/queues", c)).status).toBe(200);
    await controlDb.delete(sessions).where(eq(sessions.id, admin.sessionId));
    resetAllCaches();
    expect((await get("/ops/api/queues", c)).status).toBe(401);
    const rows = await controlDb.select().from(opsSessions).where(eq(opsSessions.sessionId, admin.sessionId));
    expect(rows.every((r) => r.revokedAt)).toBe(true);
  });

  it("a different Hisaabo session in the browser does not inherit the ops session", async () => {
    const admin = await makeActor("admin");
    const c = await signIn(admin);
    const other = await createSession(admin.userId);
    const swapped = c.replace(/session_id=[^;]+/, `session_id=${other.id}`);
    expect((await get("/ops/api/queues", swapped)).status).toBe(401);
  });

  it("re-enrolment and a role change revoke existing ops sessions", async () => {
    const admin = await makeActor("admin");
    let c = await signIn(admin);
    admin.secret = (await enrollOperator(admin.email)).enrollment.secret;
    expect((await get("/ops/api/queues", c)).status).toBe(401);

    c = await signIn(admin);
    await addOperator(admin.email, "viewer", "test");
    expect((await get("/ops/api/queues", c)).status).toBe(401);
  });

  it("logout revokes the ops session", async () => {
    const admin = await makeActor("admin");
    const c = await signIn(admin);
    expect((await post("/ops/api/logout", c)).status).toBe(200);
    expect((await get("/ops/api/queues", c)).status).toBe(401);
    expect(await lastAudit()).toMatchObject({ action: "sign_out" });
  });
});

// ── Data ─────────────────────────────────────────────────────

describe("data views", () => {
  it("lists jobs with a tenant handle, masked detail and no payload values", async () => {
    await freshQueue();
    const admin = await makeActor("admin");
    const c = await signIn(admin);
    const id = await dispatch(systemPing, { note: "secret note" }, { tags: ["diag"] });

    const list = await (await get("/ops/api/jobs?tab=pending&queue=system.ping", c)).json();
    expect(list.jobs.map((j: { id: string }) => j.id)).toContain(id);
    const tagged = await (await get("/ops/api/jobs?tab=pending&tag=diag", c)).json();
    expect(tagged.jobs).toHaveLength(1);

    const detail = await (await get(`/ops/api/jobs/system.ping/${id}`, c)).json();
    expect(detail.job.payloadFields).toEqual(["note"]);
    expect(JSON.stringify(detail)).not.toContain("secret note");

    const queues = await (await get("/ops/api/queues", c)).json();
    expect(queues.queues.find((q: { name: string }) => q.name === "system.ping")).toMatchObject({ queued: expect.any(Number) });
  });

  it("paginates with an opaque keyset cursor", async () => {
    await freshQueue();
    const admin = await makeActor("admin");
    const c = await signIn(admin);
    for (let i = 0; i < 5; i++) await dispatch(systemPing, { note: `n${i}` });
    const page1 = await (await get("/ops/api/jobs?tab=pending&limit=2", c)).json();
    expect(page1.jobs).toHaveLength(2);
    const page2 = await (await get(`/ops/api/jobs?tab=pending&limit=2&cursor=${page1.nextCursor}`, c)).json();
    expect(page2.jobs).toHaveLength(2);
    expect(page2.jobs[0].id).not.toBe(page1.jobs[0].id);
    expect((await get("/ops/api/jobs?tab=pending&cursor=garbage", c)).status).toBe(400);
  });
});

// ── CLI ──────────────────────────────────────────────────────

describe("ops CLI", () => {
  function captured() {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
    const err = vi.spyOn(console, "error").mockImplementation((...a) => { lines.push(a.join(" ")); });
    return { lines, restore: () => { log.mockRestore(); err.mockRestore(); } };
  }

  it("adds, enrolls, lists and removes an operator, auditing each write", async () => {
    const out = captured();
    try {
      expect(await opsCli(["operator", "add", "CLI.Op@Example.in", "--role", "viewer"])).toBe(0);
      expect(await lastAudit()).toMatchObject({ action: "operator_add", actor: expect.stringMatching(/^cli:/) });
      expect(await opsCli(["operator", "enroll", "cli.op@example.in"])).toBe(0);
      const joined = out.lines.join("\n");
      expect(joined).toMatch(/otpauth:\/\/totp\//);
      expect(joined.match(/[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}/g)?.length).toBe(10);
      const [op] = await controlDb.select().from(opsOperators).where(eq(opsOperators.email, "cli.op@example.in"));
      expect(op.totpSecret).toMatch(/^v\d+:/); // stored encrypted
      expect(await opsCli(["operator", "list"])).toBe(0);
      expect(await opsCli(["operator", "remove", "cli.op@example.in"])).toBe(0);
      expect(await lastAudit()).toMatchObject({ action: "operator_remove" });
      expect(await opsCli(["operator", "add", "x@example.in", "--role", "root"])).toBe(2);
      expect(await opsCli(["nope"])).toBe(2);
    } finally {
      out.restore();
    }
  });

  it("enroll refuses without ENCRYPTION_KEY", async () => {
    const out = captured();
    const saved = process.env.ENCRYPTION_KEY;
    try {
      await opsCli(["operator", "add", "nokey@example.in", "--role", "admin"]);
      delete process.env.ENCRYPTION_KEY;
      expect(await opsCli(["operator", "enroll", "nokey@example.in"])).toBe(1);
      expect(out.lines.join("\n")).toMatch(/ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
      out.restore();
    }
  });

  it("pauses/resumes a queue and redrives a failed job by id", async () => {
    const out = captured();
    try {
      expect(await opsCli(["queue", "pause", "system.ping"])).toBe(0);
      const [ctl] = await controlDb.select().from(queueControls).where(eq(queueControls.queue, "system.ping"));
      expect(ctl.paused).toBe(true);
      expect(await opsCli(["queue", "resume", "system.ping"])).toBe(0);
      expect(await opsCli(["queue", "pause", "unknown.queue"])).toBe(1);

      const jobId = await deadLetterJob("cli");
      expect(await opsCli(["queue", "failed"])).toBe(0);
      expect(out.lines.join("\n")).toContain(jobId);
      expect(await opsCli(["queue", "retry", jobId])).toBe(0);
      expect(await lastAudit()).toMatchObject({ action: "jobs_retry", jobIds: [jobId] });
      expect(await opsCli(["queue", "list"])).toBe(0);
      expect(await opsCli(["queue", "retry", "not-an-id"])).toBe(2);
    } finally {
      out.restore();
    }
  });
});
