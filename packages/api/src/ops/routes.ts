/**
 * /ops — the operator dashboard (static app) and its JSON API
 * (docs/architecture/queue.md §7.2 and §9).
 *
 * Every /ops path goes through one gate:
 *   1. QUEUE_DASHBOARD_ENABLED !== "true"      → the API's normal 404
 *   2. OPS_IP_ALLOWLIST set and client IP not in it → the API's normal 404
 * then the API adds, per request:
 *   - a Hisaabo COOKIE session (bearer, API key and access tokens rejected)
 *   - an active, TOTP-enrolled row in ops_operators for that user's email
 *   - an ops session (cookie hisaabo_ops) minted by a second factor, bound to
 *     that Hisaabo session and revoked when it ends
 *   - a fresh step-up for destructive actions and payload reveal; admin role
 *     for any action
 *   - X-Requested-With + same Origin on every POST; no CORS; no-store; per-IP
 *     rate limits; an audit row for every sign-in attempt, step-up and action.
 */
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono, Next } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { controlDb, users } from "@hisaabo/db";
import { createContext } from "../context.js";
import { logger, logSecurityEvent } from "../lib/logger.js";
import { normalizeEmail } from "../lib/normalize-email.js";
import { opsConfig, type OpsConfig } from "./config.js";
import { ipAllowed } from "./cidr.js";
import { findOperatorByEmail, isActiveEnrolled, verifySecondFactor, type Operator } from "./operators.js";
import {
  OPS_COOKIE,
  createOpsSession,
  hasFreshStepUp,
  loadOpsSession,
  markStepUp,
  revokeOpsSession,
  stepUpValidUntil,
  type OpsSession,
} from "./sessions.js";
import { writeOpsAudit, listOpsAudit } from "./audit.js";
import {
  JOB_TABS,
  MAX_BULK_IDS,
  deleteJobs,
  jobDetail,
  listJobs,
  listQueues,
  listSchedules,
  listWorkers,
  overview,
  queueSeries,
  resolveQueue,
  retryJobs,
  revealPayload,
  setPaused,
} from "./data.js";

export const OPS_APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const OPS_API_CSP = "default-src 'none'; frame-ancestors 'none'";

const API_LIMIT_PER_MIN = 60;
const AUTH_LIMIT_PER_MIN = 10;
const STATIC_LIMIT_PER_MIN = 300;

export interface OpsRouteDeps {
  /** The API's own not-found response, so a disabled /ops is indistinguishable. */
  notFound: (c: Context) => Response | Promise<Response>;
  /** Client IP resolved with the API's trusted-proxy rules. */
  clientIp: (c: Context) => string;
  /** Built dashboard (apps/ops dist); auto-detected when omitted. */
  staticDir?: string | null;
}

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; status: 401 | 403; error: string; message: string };

interface OpsAuth {
  session: OpsSession;
  operator: Operator;
}

// ── Helpers ──────────────────────────────────────────────────

function getCookie(c: Context, name: string): string | null {
  const header = c.req.header("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isSecure(): boolean {
  const base = process.env.API_PUBLIC_URL || process.env.APP_URL || "";
  return base.startsWith("https://");
}

function opsCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${OPS_COOKIE}=${value}`,
    "Path=/ops",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(isSecure() ? ["Secure"] : []),
  ].join("; ");
}

/** The API's own origin: API_PUBLIC_URL when set (required in production). */
function apiOrigin(c: Context): string {
  const env = process.env.API_PUBLIC_URL;
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // fall through
    }
  }
  return new URL(c.req.url).origin;
}

function json(c: Context, body: unknown, status: 200 | 400 | 401 | 403 | 404 | 429 | 500 = 200) {
  return c.json(body as object, status);
}

function fail(c: Context, f: Fail) {
  return json(c, { error: f.error, message: f.message }, f.status);
}

// ── Rate limiting (in-memory, per IP and bucket) ─────────────

const hits = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
}, 60_000).unref();

function overLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset <= now) {
    hits.set(key, { count: 1, reset: now + 60_000 });
    return false;
  }
  cur.count += 1;
  return cur.count > limit;
}

/** Test hook: clear rate-limit state. */
export function resetOpsRateLimits(): void {
  hits.clear();
}

// ── Static app ───────────────────────────────────────────────

function detectStaticDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.OPS_PUBLIC_DIR,
    path.join(here, "ops-public"), // dist/ (tsup bundles routes into dist/server.js)
    path.join(here, "../ops-public"),
    path.join(here, "../../dist/ops-public"), // tsx dev: src/ops → dist/ops-public
    path.join(here, "../../../../apps/ops/dist"), // monorepo dev fallback
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function staticFile(dir: string, rel: string): { body: Buffer; type: string } | null {
  if (!/^[A-Za-z0-9._\-/]+$/.test(rel) || rel.includes("..")) return null;
  const full = path.resolve(dir, rel);
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
  const type = CONTENT_TYPES[path.extname(full)];
  if (!type) return null;
  // Stat and read through one descriptor (no check-then-read race); never
  // follow a symlink out of the build output.
  let fd: number;
  try {
    fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? { body: readFileSync(fd), type } : null;
  } finally {
    closeSync(fd);
  }
}

// ── Registration ─────────────────────────────────────────────

export function registerOpsRoutes(app: Hono, deps: OpsRouteDeps): void {
  const staticDir = deps.staticDir === undefined ? detectStaticDir() : deps.staticDir;

  // The gate: everything under /ops, before any route.
  const gate = async (c: Context, next: Next) => {
    let cfg: OpsConfig;
    try {
      cfg = opsConfig();
    } catch (err) {
      logger.error({ err }, "Invalid /ops configuration; dashboard disabled");
      return deps.notFound(c);
    }
    if (!cfg.enabled) return deps.notFound(c);
    const ip = deps.clientIp(c);
    if (cfg.allowlist && !ipAllowed(ip, cfg.allowlist)) {
      logSecurityEvent("origin_block", { ip, path: c.req.path, reason: "ops_ip_allowlist" });
      return deps.notFound(c);
    }

    const isApi = c.req.path.startsWith("/ops/api/");
    const isAuth = isApi && /^\/ops\/api\/(session|step-up)$/.test(c.req.path);
    const bucket = isAuth ? "auth" : isApi ? "api" : "static";
    const limit = isAuth ? AUTH_LIMIT_PER_MIN : isApi ? API_LIMIT_PER_MIN : STATIC_LIMIT_PER_MIN;
    if (overLimit(`${bucket}:${ip}`, limit)) {
      logSecurityEvent("rate_limit", { ip, path: c.req.path, reason: `ops_${bucket}` });
      c.header("Retry-After", "60");
      c.header("Cache-Control", "no-store");
      return c.json({ error: "rate_limited", message: "Too many requests" }, 429);
    }

    c.set("opsConfig", cfg);
    await next();

    // Headers on every /ops response, whatever the handler set.
    const corsHeaders = Array.from(c.res.headers.keys()).filter((h) => h.toLowerCase().startsWith("access-control-"));
    for (const h of corsHeaders) c.res.headers.delete(h);
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    c.res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (isApi) {
      c.res.headers.set("Cache-Control", "no-store");
      c.res.headers.set("Content-Security-Policy", OPS_API_CSP);
    } else if (!c.res.headers.has("Content-Security-Policy") || c.res.status !== 404) {
      c.res.headers.set("Content-Security-Policy", OPS_APP_CSP);
    }
  };
  app.use("/ops", gate);
  app.use("/ops/*", gate);

  const cfgOf = (c: Context) => c.get("opsConfig") as OpsConfig;

  // ── Auth building blocks ───────────────────────────────────

  /** CSRF: custom header AND same Origin on every state-changing request. */
  const csrfOk = (c: Context): boolean =>
    c.req.header("x-requested-with") === "hisaabo" && c.req.header("origin") === apiOrigin(c);

  /** The Hisaabo session behind the request — cookie sessions only. */
  async function hisaaboSession(c: Context): Promise<Ok<{ user: { id: string; email: string }; sessionId: string }> | Fail> {
    if (c.req.header("authorization")) {
      return { ok: false, status: 401, error: "cookie_session_required", message: "Sign in to Hisaabo in this browser" };
    }
    const sessionId = getCookie(c, "session_id");
    if (!sessionId) return { ok: false, status: 401, error: "no_session", message: "Sign in to Hisaabo first" };
    const ctx = await createContext({ req: c.req.raw, resHeaders: new Headers() } as FetchCreateContextFnOptions);
    if (!ctx.user || ctx.authTokenKind !== "cookie") {
      return { ok: false, status: 401, error: "no_session", message: "Sign in to Hisaabo first" };
    }
    const [row] = await controlDb.select({ emailVerified: users.emailVerified }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!row?.emailVerified) return { ok: false, status: 403, error: "forbidden", message: "Not authorized for /ops" };
    return { ok: true, user: { id: ctx.user.id, email: ctx.user.email }, sessionId };
  }

  /**
   * Resolve the ops session and re-check everything it depends on: the
   * Hisaabo session it was minted from must still be the one in this browser
   * and still valid, for the same user, whose email still maps to the same
   * active operator. Any mismatch revokes the ops session.
   */
  async function requireOps(c: Context, need: { admin?: boolean; stepUp?: boolean } = {}): Promise<Ok<OpsAuth> | Fail> {
    const cfg = cfgOf(c);
    const loaded = await loadOpsSession(getCookie(c, OPS_COOKIE), cfg);
    if (!loaded.ok) return { ok: false, status: 401, error: "ops_session_required", message: "Sign in to /ops" };
    const { session, operator } = loaded;

    const hs = await hisaaboSession(c);
    if (!hs.ok || hs.sessionId !== session.sessionId || hs.user.id !== session.userId || normalizeEmail(hs.user.email) !== operator.email) {
      await revokeOpsSession(session.id);
      return { ok: false, status: 401, error: "ops_session_required", message: "Sign in to /ops" };
    }
    if (need.admin && operator.role !== "admin") {
      return { ok: false, status: 403, error: "admin_required", message: "This action needs an admin operator" };
    }
    if (need.stepUp && !hasFreshStepUp(session, cfg)) {
      return { ok: false, status: 403, error: "step_up_required", message: "Confirm with your authenticator code" };
    }
    return { ok: true, session, operator };
  }

  /** For every action: CSRF + admin + step-up, with a denied audit row on failure. */
  async function requireAction(c: Context, action: string, queue: string | null): Promise<Ok<OpsAuth> | Fail> {
    const ip = deps.clientIp(c);
    if (!csrfOk(c)) {
      logSecurityEvent("csrf_fail", { ip, path: c.req.path });
      return { ok: false, status: 403, error: "csrf", message: "Request rejected" };
    }
    const auth = await requireOps(c, { admin: true, stepUp: true });
    if (!auth.ok && auth.error !== "ops_session_required") {
      const operator = (await loadOpsSession(getCookie(c, OPS_COOKIE), cfgOf(c)));
      await writeOpsAudit({
        operatorId: operator.ok ? operator.operator.id : null,
        actor: operator.ok ? operator.operator.email : "unknown",
        action, queue, ip, result: "denied", details: { reason: auth.error },
      });
    }
    return auth;
  }

  const audit = (c: Context, auth: OpsAuth, action: string, extra: { queue?: string | null; jobIds?: string[]; details?: Record<string, unknown>; result?: string } = {}) =>
    writeOpsAudit({
      operatorId: auth.operator.id,
      actor: auth.operator.email,
      action,
      queue: extra.queue ?? null,
      jobIds: extra.jobIds ?? null,
      details: extra.details ?? null,
      ip: deps.clientIp(c),
      result: extra.result ?? "ok",
    });

  const readBody = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
    const ct = c.req.header("content-type") ?? "";
    if (!ct.startsWith("application/json")) return null;
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  };

  // ── Session endpoints ──────────────────────────────────────

  app.get("/ops/api/me", async (c) => {
    const cfg = cfgOf(c);
    const hs = await hisaaboSession(c);
    const appUrl = /^https?:\/\//.test(process.env.APP_URL ?? "") ? process.env.APP_URL : null;
    if (!hs.ok) return json(c, { appUrl, hisaabo: null, operator: null, ops: null });
    const op = await findOperatorByEmail(hs.user.email);
    const loaded = await loadOpsSession(getCookie(c, OPS_COOKIE), cfg);
    const opsLive = loaded.ok && loaded.session.sessionId === hs.sessionId && loaded.session.userId === hs.user.id;
    return json(c, {
      appUrl,
      hisaabo: { email: hs.user.email },
      operator: op && !op.disabledAt ? { email: op.email, role: op.role, enrolled: isActiveEnrolled(op) } : null,
      ops: opsLive
        ? {
            expiresAt: loaded.session.expiresAt.toISOString(),
            stepUpValidUntil: stepUpValidUntil(loaded.session, cfg)?.toISOString() ?? null,
            idleMinutes: cfg.idleMs / 60_000,
          }
        : null,
    });
  });

  const codeSchema = z.object({ code: z.string().min(6).max(32) }).strict();

  app.post("/ops/api/session", async (c) => {
    const ip = deps.clientIp(c);
    if (!csrfOk(c)) {
      logSecurityEvent("csrf_fail", { ip, path: c.req.path });
      return json(c, { error: "csrf", message: "Request rejected" }, 403);
    }
    const hs = await hisaaboSession(c);
    if (!hs.ok) {
      await writeOpsAudit({ actor: "anonymous", action: "sign_in", ip, result: "denied", details: { reason: hs.error } });
      return fail(c, hs);
    }
    const body = await readBody(c, codeSchema);
    const op = await findOperatorByEmail(hs.user.email);
    if (!isActiveEnrolled(op)) {
      await writeOpsAudit({ operatorId: op?.id ?? null, actor: normalizeEmail(hs.user.email), action: "sign_in", ip, result: "denied", details: { reason: op ? "not_enrolled_or_disabled" : "not_operator" } });
      return json(c, { error: "forbidden", message: "Not authorized for /ops" }, 403);
    }
    if (!body) {
      await writeOpsAudit({ operatorId: op.id, actor: op.email, action: "sign_in", ip, result: "denied", details: { reason: "bad_request" } });
      return json(c, { error: "bad_request", message: "Enter your authenticator or recovery code" }, 400);
    }
    const result = await verifySecondFactor(op.id, body.code);
    if (!result.ok) {
      await writeOpsAudit({ operatorId: op.id, actor: op.email, action: "sign_in", ip, result: "denied", details: { reason: result.reason } });
      logSecurityEvent("ops_auth_fail", { ip, path: c.req.path, reason: `ops_${result.reason}` });
      if (result.reason === "locked") return json(c, { error: "locked", message: "Too many attempts. Try again later." }, 429);
      return json(c, { error: "invalid_code", message: "That code is not valid" }, 401);
    }
    const cfg = cfgOf(c);
    const { token, session } = await createOpsSession({
      operatorId: op.id,
      userId: hs.user.id,
      sessionId: hs.sessionId,
      ip,
      userAgent: c.req.header("user-agent") ?? null,
      config: cfg,
    });
    await writeOpsAudit({ operatorId: op.id, actor: op.email, action: "sign_in", ip, result: "ok", details: { method: result.method } });
    c.header("Set-Cookie", opsCookie(token, Math.floor(cfg.maxMs / 1000)));
    return json(c, { ok: true, role: op.role, expiresAt: session.expiresAt.toISOString() });
  });

  app.post("/ops/api/step-up", async (c) => {
    const ip = deps.clientIp(c);
    if (!csrfOk(c)) {
      logSecurityEvent("csrf_fail", { ip, path: c.req.path });
      return json(c, { error: "csrf", message: "Request rejected" }, 403);
    }
    const auth = await requireOps(c);
    if (!auth.ok) return fail(c, auth);
    const body = await readBody(c, codeSchema);
    if (!body) return json(c, { error: "bad_request", message: "Enter your authenticator or recovery code" }, 400);
    const result = await verifySecondFactor(auth.operator.id, body.code);
    if (!result.ok) {
      await audit(c, auth, "step_up", { result: "denied", details: { reason: result.reason } });
      if (result.reason === "locked") return json(c, { error: "locked", message: "Too many attempts. Try again later." }, 429);
      return json(c, { error: "invalid_code", message: "That code is not valid" }, 401);
    }
    const now = new Date();
    await markStepUp(auth.session.id, now);
    await audit(c, auth, "step_up", { details: { method: result.method } });
    return json(c, { ok: true, stepUpValidUntil: new Date(now.getTime() + cfgOf(c).stepUpMs).toISOString() });
  });

  app.post("/ops/api/logout", async (c) => {
    if (!csrfOk(c)) {
      logSecurityEvent("csrf_fail", { ip: deps.clientIp(c), path: c.req.path });
      return json(c, { error: "csrf", message: "Request rejected" }, 403);
    }
    const loaded = await loadOpsSession(getCookie(c, OPS_COOKIE), cfgOf(c));
    if (loaded.ok) {
      await revokeOpsSession(loaded.session.id);
      await audit(c, loaded, "sign_out");
    }
    c.header("Set-Cookie", opsCookie("", 0));
    return json(c, { ok: true });
  });

  // ── Read endpoints (viewer or admin) ───────────────────────

  const read = (handler: (c: Context, auth: OpsAuth) => Promise<Response>) => async (c: Context) => {
    const auth = await requireOps(c);
    if (!auth.ok) return fail(c, auth);
    return handler(c, auth);
  };

  app.get("/ops/api/overview", read(async (c) => json(c, await overview())));
  app.get("/ops/api/queues", read(async (c) => json(c, { queues: await listQueues() })));

  app.get("/ops/api/queues/:name", read(async (c) => {
    const name = c.req.param("name") ?? "";
    const resolved = resolveQueue(name);
    if (!resolved || resolved.dead) return json(c, { error: "not_found", message: "Unknown queue" }, 404);
    const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 24) || 24, 1), 168);
    const queue = (await listQueues()).find((q) => q.name === name);
    return json(c, { queue, series: await queueSeries(name, hours) });
  }));

  const listQuery = z.object({
    tab: z.enum(JOB_TABS as unknown as [string, ...string[]]).default("pending"),
    queue: z.string().max(120).optional(),
    tenant: z.string().max(16).optional(),
    tag: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  app.get("/ops/api/jobs", read(async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) return json(c, { error: "bad_request", message: "Invalid filters" }, 400);
    if (q.data.queue && !resolveQueue(q.data.queue)) return json(c, { error: "not_found", message: "Unknown queue" }, 404);
    try {
      return json(c, await listJobs({ ...q.data, tab: q.data.tab as (typeof JOB_TABS)[number] }));
    } catch (err) {
      if (err instanceof Error && err.message === "Invalid cursor") return json(c, { error: "bad_request", message: "Invalid cursor" }, 400);
      throw err;
    }
  }));

  const jobParams = (c: Context) => {
    const queue = c.req.param("queue") ?? "";
    const id = c.req.param("id") ?? "";
    return resolveQueue(queue) && /^[0-9a-f-]{36}$/i.test(id) ? { queue, id } : null;
  };

  app.get("/ops/api/jobs/:queue/:id", read(async (c) => {
    const p = jobParams(c);
    if (!p) return json(c, { error: "not_found", message: "Job not found" }, 404);
    const job = await jobDetail(p.queue, p.id);
    return job ? json(c, { job }) : json(c, { error: "not_found", message: "Job not found" }, 404);
  }));

  app.get("/ops/api/workers", read(async (c) => json(c, { workers: await listWorkers() })));
  app.get("/ops/api/schedules", read(async (c) => json(c, { schedules: await listSchedules() })));

  const auditQuery = z.object({
    action: z.string().max(64).optional(),
    actor: z.string().max(320).optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });
  app.get("/ops/api/audit", read(async (c) => {
    const q = auditQuery.safeParse(c.req.query());
    if (!q.success) return json(c, { error: "bad_request", message: "Invalid filters" }, 400);
    return json(c, await listOpsAudit(q.data));
  }));

  // ── Actions (admin + step-up + CSRF, audited) ──────────────

  app.post("/ops/api/jobs/:queue/:id/reveal", async (c) => {
    const p = jobParams(c);
    const auth = await requireAction(c, "job_reveal", p?.queue ?? null);
    if (!auth.ok) return fail(c, auth);
    if (!p) return json(c, { error: "not_found", message: "Job not found" }, 404);
    const payload = await revealPayload(p.queue, p.id);
    if (!payload) return json(c, { error: "not_found", message: "Job not found" }, 404);
    await audit(c, auth, "job_reveal", { queue: p.queue, jobIds: [p.id] });
    return json(c, { payload });
  });

  const bulkSchema = z.object({
    queue: z.string().max(120),
    ids: z.array(z.string().uuid()).min(1).max(MAX_BULK_IDS),
  }).strict();

  for (const [route, action, run] of [
    ["/ops/api/jobs/retry", "jobs_retry", retryJobs],
    ["/ops/api/jobs/delete", "jobs_delete", deleteJobs],
  ] as const) {
    app.post(route, async (c) => {
      const auth = await requireAction(c, action, null);
      if (!auth.ok) return fail(c, auth);
      const body = await readBody(c, bulkSchema);
      if (!body || !resolveQueue(body.queue)) return json(c, { error: "bad_request", message: "Invalid request" }, 400);
      const ids = [...new Set(body.ids)];
      const count = await run(body.queue, ids);
      await audit(c, auth, action, { queue: body.queue, jobIds: ids, details: { count } });
      return json(c, { ok: true, count });
    });
  }

  for (const [suffix, paused] of [["pause", true], ["resume", false]] as const) {
    app.post(`/ops/api/queues/:name/${suffix}`, async (c) => {
      const name = c.req.param("name") ?? "";
      const auth = await requireAction(c, `queue_${suffix}`, name);
      if (!auth.ok) return fail(c, auth);
      const resolved = resolveQueue(name);
      if (!resolved || resolved.dead) return json(c, { error: "not_found", message: "Unknown queue" }, 404);
      await setPaused(name, paused, auth.operator.email);
      await audit(c, auth, `queue_${suffix}`, { queue: name });
      return json(c, { ok: true, paused });
    });
  }

  app.all("/ops/api/*", (c) => json(c, { error: "not_found", message: "Not found" }, 404));

  // ── Static dashboard ───────────────────────────────────────

  app.get("/ops", (c) => c.redirect("/ops/", 302));
  app.get("/ops/*", (c) => {
    if (!staticDir) return deps.notFound(c);
    const rel = c.req.path.slice("/ops/".length);
    if (rel.startsWith("assets/")) {
      const file = staticFile(staticDir, rel);
      if (!file) return deps.notFound(c);
      return c.body(new Uint8Array(file.body), 200, {
        "Content-Type": file.type,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    }
    const asset = rel && rel.includes(".") ? staticFile(staticDir, rel) : null;
    const file = asset ?? staticFile(staticDir, "index.html");
    if (!file) return deps.notFound(c);
    return c.body(new Uint8Array(file.body), 200, { "Content-Type": file.type, "Cache-Control": "no-store" });
  });
}
