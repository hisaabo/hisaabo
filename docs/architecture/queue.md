# Background jobs: queue, workers and the operator dashboard

Status: **Phase 1 (foundations) in progress.** Steps 1–3 (queue core, worker,
deployment wiring) and 4–5 (operator auth, `/ops` API and dashboard, `ops`
CLI) are implemented; step 6 (admin TUI Queues view) follows. Phase 2 moves
existing in-request and in-process work onto the queue, one PR per process.

## 1. Why

Today every piece of work runs inside the single API process:

- Heavy work runs inside HTTP requests: self-import (up to 200 MB),
  self-export, bank statement matching with user-written regexes, data
  imports, GSTR-2B reconciliation, the party ledger PDF, GSTR-9 and
  full-history reports. CPU-bound parts block the event loop for every
  tenant.
- Background work is ad hoc and in memory:
  - a 60 s `setInterval` scheduler for recurring invoices, whose row lock is
    released before generation, so two replicas can double-generate;
  - fire-and-forget `setTimeout` e-invoice submission that is lost on restart
    and never retried automatically;
  - a per-request PDF worker thread with no timeout.
- None of it has durable state, retries with backoff, attempt caps,
  per-tenant fairness, timeouts or visibility.

The goal is a Laravel-quality queue: durable jobs, retries, timeouts,
uniqueness, scheduling and failed-job handling. On top of it sits a
Horizon-style operations dashboard, protected well enough to be enabled
in production.

## 2. Decisions

| Topic | Decision |
|---|---|
| Backend | **Postgres only, no Redis.** [pg-boss](https://github.com/timgit/pg-boss) 12.x (MIT). Jobs are rows in the same database, so they are covered by existing backups and auth and can be enqueued in the same transaction as the business write. |
| Where the queue lives | `pgboss` schema in the **control database**: `CONTROL_DATABASE_URL \|\| DATABASE_URL`. In self-hosted mode that is the single database; in cloud it is the control DB, never a tenant DB. |
| Workers | **Separate process everywhere**, using the same image with a new entrypoint `node packages/api/dist/worker.js`. It is a `worker` service in `docker-compose.prod.yml` and an extra s6 longrun in the ONCE image. The API only dispatches and never runs jobs. |
| Dashboard | **Operator-only web UI** at `/ops`, served by the API. It is a small React app (`apps/ops`). It is off unless `QUEUE_DASHBOARD_ENABLED=true`. |
| Operators | **Managed from the shell only**: control table `ops_operators`, edited with the `ops` CLI (`docker compose exec api node packages/api/dist/bin/ops.js …`). Shell access is the root of trust, like maintenance mode today. |
| Second factor | **TOTP** (RFC 6238, works with any authenticator app). It is required to open the dashboard and asked again before destructive actions or payload reveal. Enrolment is CLI-only. |
| Payload visibility | **Masked by default.** Operators see metadata, errors and a hashed tenant handle. Showing the raw payload needs an admin operator, a fresh TOTP step-up, and is audit-logged. Fields marked sensitive stay encrypted and are never decrypted for display. |
| CLI dashboard | The existing admin TUI gains a read-only **Queues** view. |

## 3. Architecture

```
            ┌────────────── API process ──────────────┐
 HTTP ───►  │ tRPC / REST handlers ── dispatch(job) ──┼──► pgboss.job (control DB)
            │ /ops  (static React app)                │          ▲   │
            │ /ops/api/*  (operator JSON API) ────────┼── reads ─┘   │ SKIP LOCKED fetch
            └─────────────────────────────────────────┘              ▼
                                                    ┌──── worker process(es) ────┐
                                                    │ pools → handlers           │
                                                    │ ctx: tenant DB, logger,    │
                                                    │ AbortSignal, heartbeat     │
                                                    │ CPU jobs → worker_threads  │
                                                    │ with hard timeout          │
                                                    └────────────────────────────┘
 Shell ──► bin/ops.js (operators, TOTP, queue commands)   bin/admin.js TUI (read-only Queues view)
```

- **Schema install.** The pg-boss schema is installed and upgraded by the
  existing migration step (`packages/db/src/migrate.ts` →
  `installQueueSchema` in `packages/db/src/queue-schema.ts`). That step runs
  before the API starts, under the existing migrations advisory lock. API and
  worker start pg-boss with `migrate: false`, so neither process ever
  changes the schema at runtime. pg-boss is therefore a dependency of both
  `@hisaabo/db` (migrations) and `@hisaabo/api`.
- **Maintenance.** pg-boss maintenance (expiry, retention, monitoring, cron)
  runs only in worker processes (`supervise: true`, `schedule: true`). The
  API's pg-boss instance has both off and only sends.
- **Instance registry.** pg-boss's `instanceName` (`api`, `worker:<pools>`)
  powers the Workers page.

## 4. Laravel → Hisaabo mapping

| Laravel / Horizon | Hisaabo |
|---|---|
| Job class with `handle()` | `defineJob({ name, payload, handle })` |
| `dispatch()`, `->delay()`, `->onQueue()` | `dispatch(job, payload, { tenantId, businessId?, delaySeconds?, priority?, tx? })` |
| `afterCommit` / dispatch in a transaction | `dispatch(…, { tx })` uses pg-boss's Drizzle adapter, so the job exists only if the transaction commits |
| `$tries`, `$backoff`, `$maxExceptions` | `retries`, `backoff: { delaySeconds, exponential, maxDelaySeconds }`; maps to pg-boss `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax` |
| `$timeout` | `timeoutSeconds` (pg-boss `expireInSeconds`), an `AbortSignal` in the handler, and a hard thread kill for CPU jobs |
| Long jobs | `heartbeatSeconds`; the job is failed when the heartbeat stops |
| `ShouldBeUnique`, `uniqueFor`, `uniqueId` | `unique: { key: (p) => string, forSeconds }`; maps to `singletonKey` and `singletonSeconds` |
| `WithoutOverlapping`, `RateLimited` middleware | `tenantConcurrency` (see §5.2 rule 7) and `policy: "singleton" \| "stately"` |
| `ShouldBeEncrypted` | `encrypt: ["field", …]`: the listed payload fields are AES-256-GCM encrypted with `ENCRYPTION_KEY` (existing `encryptField`) |
| `failed()` method | `onFailed(payload, error, ctx)` runs once when retries are exhausted (or on a `PermanentError`) |
| `failed_jobs` table | The job's dead-letter queue `<name>.dead`: pg-boss copies a job there when it fails for good. No worker consumes it; its jobs are kept `QUEUE_FAILED_RETENTION_DAYS` (default 14) and re-queued with pg-boss `redrive()`. (pg-boss has one retention for finished jobs, so failed jobs cannot outlive completed ones in the original queue.) |
| `queue:failed`, `queue:retry`, `queue:forget`, `queue:flush`, `queue:clear` | `ops queue failed`, `ops queue retry`, `ops queue forget`, `ops queue flush`, `ops queue clear`, plus dashboard actions (admin + step-up) |
| Scheduler (`$schedule->job(...)->cron(...)`) | `defineSchedule({ name, cron, job, payload })`; maps to pg-boss `schedule()`, which runs once per tick across all workers |
| Horizon supervisors / processes | Worker pools (`queue/pools.ts`); `QUEUE_POOLS` chooses which pools a process runs |
| Horizon metrics (throughput, runtime, wait) | pg-boss `persistQueueStats` snapshots (counts, deltas, wait/run histograms) |
| Horizon tags | Every job carries a tenant handle and `tags: string[]`; the dashboard filters by them |
| `horizon:pause` / `continue` | Per-queue pause in `queue_controls`; workers stop fetching from paused queues within 10 s |
| Batches and chains | Not in Phase 1. pg-boss `flow()` (dependencies) is the planned basis (Phase 3) |

## 5. Job API

Code lives in `packages/api/src/queue/`.

```ts
// jobs/system-ping.ts: a Phase 1 diagnostic job with no tenant data
export const systemPing = defineJob({
  name: "system.ping",
  scope: "system",                  // "tenant" (default) | "system"
  payload: z.object({ note: z.string().max(200) }),
  retries: 2,
  backoff: { delaySeconds: 5, exponential: true, maxDelaySeconds: 300 },
  timeoutSeconds: 30,
  async handle(payload, ctx) {
    ctx.logger.info({ note: payload.note }, "pong");
    return { ok: true };
  },
});

await dispatch(systemPing, { note: "hello" });
```

### 5.1 Envelope

Every job's pg-boss `data` is an envelope, not the raw payload:

```ts
{
  v: 1,
  scope: "tenant" | "system",
  tenantId?: string,          // required when scope = "tenant"
  businessId?: string,
  actorUserId?: string,       // who caused it, for audit
  requestId?: string,         // correlates with API logs
  tags: string[],
  payload: { … },             // zod-validated; `encrypt` fields are "v2:…" ciphertext
}
```

### 5.2 Rules (enforced by code or tests)

1. **Validation on both ends.** `dispatch()` validates the payload with the
   job's zod schema. The worker parses the envelope and payload again before
   `handle()`, so a malformed row fails instead of running. A failed parse is
   not retried.
2. **Job names come from code.** Job names come only from the registry. No
   API input ever chooses a job name or builds a payload field by field from
   untrusted input without the schema.
3. **IDs and references, not data.** Payloads carry ids and storage keys,
   never business data or secrets. Large inputs such as CSVs and import
   archives go to object storage (the existing storage driver), and the job
   carries the key. A test fails the build if a payload schema declares a
   field named like `password`, `secret`, `token` or `apiKey` without listing
   it in `encrypt`.
4. **Tenant context is re-established, never trusted.** For `scope: "tenant"`
   the worker:
   - resolves the tenant with `getTenantDb(tenantId)` (control lookup;
     tenant must be `active`);
   - checks the business still exists in that tenant DB, using the same
     predicate as `getBusinessAccess`;
   - checks `actorUserId`, if present, is still an active member before any
     action taken on that user's behalf.

   If any check fails, the job ends as `failed` with a non-retryable error.
5. **At-least-once delivery.** Handlers must be idempotent. Use
   `unique.key` for de-duplication, and make writes upserts or guard them with
   state checks.
6. **Timeouts.** `ctx.signal` aborts on timeout and on worker shutdown. I/O
   must pass it on (fetch, DB statement timeouts). CPU-bound work uses
   `runInThread(modulePath, input, { timeoutMs, resourceLimits })`, which runs
   it in a `worker_threads` Worker and terminates it on timeout. This is the
   only safe way to bound synchronous code such as regex evaluation.
7. **Per-tenant fairness.** Default `tenantConcurrency: 2` per queue. Heavy
   queues use 1.
   - `tenantConcurrency: 1` is **strict**: the queue uses pg-boss's
     `singleton` policy with `singletonKey` = tenant id, which a unique index
     enforces across all workers (`defineJob` sets `tenantKeyed`). Not
     available together with `unique` (both need the singleton key).
   - Higher caps use pg-boss `groupConcurrency` (group = tenant). It is
     **approximate**: each worker's fetch is one statement under READ
     COMMITTED, so workers polling at the same instant can each claim a job
     for the same tenant. The overshoot is bounded by the number of workers
     polling that queue at once, which is enough to keep one tenant from
     occupying every slot.
8. **Errors.**
   - The error class decides retry: `RetryableError` vs `PermanentError`;
     unknown errors are retried. Workers use pg-boss `perJobResults`: a
     `PermanentError`, an invalid envelope or payload, or a failed tenant
     re-validation settles the job as `deadletter` (no retries); other errors
     settle as `failed` and pg-boss retries them.
   - `runInThread` timeouts throw `ThreadTimeoutError`, a `PermanentError`:
     CPU blow-ups are deterministic, so retrying would only burn the same
     time again.
   - Error messages are stored but run through the same masking as logs
     (emails, phone numbers, GSTINs).
   - Stack traces go to worker logs only, never to the dashboard.

### 5.3 Handler context

```ts
interface JobContext {
  jobId: string; queue: string; attempt: number;
  tenantId?: string; businessId?: string;
  db?: TenantDatabase;            // tenant DB for scope = "tenant"
  controlDb: ControlDatabase;
  logger: Logger;                 // pino child: jobId, queue, tenant handle
  signal: AbortSignal;
  heartbeat(): Promise<void>;     // for heartbeatSeconds jobs
  progress(pct: number, note?: string): Promise<void>;  // logged; shown in the dashboard from Phase 3
}
```

## 6. Queues and worker pools

- One pg-boss queue per job name.
- Queues (and their `<name>.dead` dead-letter queues) are created or updated
  idempotently from the registry (`queue/registry.ts`):
  - at worker start (`createQueue` / `updateQueue`), so code and database
    options cannot drift;
  - lazily, once per process, by `dispatch()` when the queue does not exist
    yet.

  The migration step installs only the pgboss schema: `@hisaabo/db` cannot
  import the API's job registry. A queue's policy cannot be changed in place;
  a mismatch is logged and the stored policy kept.
- Pools group queues for a worker process (`queue/config.ts`). The
  concurrency applies to each queue in the pool (pg-boss `localConcurrency`):

| Pool | Queues | Per-queue concurrency per process | Notes |
|---|---|---|---|
| `default` | short I/O jobs (emails, e-invoice submit, notifications) | 8 | |
| `heavy` | imports, exports, statement processing, report builds | 2 | CPU parts via `runInThread`; `tenantConcurrency: 1` |
| `system` | schedules, housekeeping, `system.ping` | 2 | |

- Configuration:
  - `QUEUE_POOLS=default,heavy,system` (the default) runs all pools, so heavy
    workers can be scaled out separately.
  - `QUEUE_CONCURRENCY_<POOL>` overrides a pool's concurrency.
- Polling: every `QUEUE_POLLING_INTERVAL_SECONDS` (default 2, minimum 0.5).
  pg-boss's LISTEN/NOTIFY wake-up is not enabled in Phase 1; it needs a
  direct, non-PgBouncer connection and can be added per queue later.
- Retention:

| Data | Setting | Default |
|---|---|---|
| Completed (and failed originals) | `QUEUE_COMPLETED_RETENTION_HOURS` → pg-boss `deleteAfterSeconds` | 24 |
| Failed jobs (dead-letter copies) and jobs still waiting | `QUEUE_FAILED_RETENTION_DAYS` → `retentionSeconds` | 14 |
| Stats snapshots | `queueStatRetentionDays` | 14 |

- **Pause.** A worker reads `queue_controls` every 10 s and calls
  `offWork` / `work` for paused and resumed queues. In-flight jobs finish.
- **Implementation.** `queue/runtime.ts` (`startWorkerRuntime`) is the worker;
  `src/worker.ts` adds env validation (`validateEnv({ role: "worker" })` skips
  API-only vars such as `CORS_ORIGINS`), start-up retry with backoff, the
  heartbeat file and signal handling.
- **Shutdown.** On SIGTERM:
  - stop fetching;
  - abort `ctx.signal` after a grace period (`QUEUE_SHUTDOWN_GRACE_SECONDS`,
    default 25);
  - `boss.stop({ graceful: true, timeout })`, then exit.

  Jobs that do not finish are retried by another worker after `expireIn`.
- **Health.** The worker writes `/tmp/worker-heartbeat` every 10 s. The
  container healthcheck fails when it is older than 60 s. pg-boss's instance
  registry also shows each worker's last heartbeat on the dashboard.

## 7. Security model

### 7.1 Threats and controls

| Threat | Control |
|---|---|
| Tenant A's job acts on tenant B's data | Envelope tenant is set by server code from `ctx.tenantId`; worker re-resolves tenant and business (rule 4). No API accepts a job id or queue name from tenants in Phase 1. |
| Forged or tampered job rows | Only someone with database write access can forge one, and that is already full compromise. Still, the worker never trusts the envelope beyond ids and re-checks them. |
| Secrets or PII at rest in job rows | Ids only (rule 3); `encrypt` fields use AES-256-GCM; failed-job errors are masked; retention limits apply. |
| Job flooding by one tenant (queue DoS) | Per-tenant concurrency (§5.2 rule 7), `unique` de-duplication, dispatch-side per-tenant quotas (max queued jobs per tenant per queue, default 50, rejected with TOO_MANY_REQUESTS), and API rate limits. |
| Poison jobs | Capped retries with backoff, then `failed`; `PermanentError` skips retries. |
| Runaway CPU (e.g. ReDoS) | `runInThread` with timeout and `resourceLimits`; plus RE2 for user regexes (Phase 2). |
| Lost work on restart or deploy | Durable rows; expired active jobs are retried. |
| Duplicate execution across replicas | SKIP LOCKED fetch; schedules fire once per tick across all instances. |

### 7.2 The `/ops` surface

The design assumes the operator dashboard is the most valuable target.

1. **Off by default.** Unless `QUEUE_DASHBOARD_ENABLED=true`, every `/ops`
   path returns the API's normal 404, so it cannot be fingerprinted.
2. **Network allowlist.** If `OPS_IP_ALLOWLIST` (comma-separated CIDRs) is set,
   requests from other client IPs get 404. The client IP is resolved with the
   existing trusted-proxy logic. Strongly recommended for production; the
   startup log warns when it is unset.
3. **Three gates, all required:**
   1. A normal Hisaabo **cookie** session (magic-link sign-in) on the API
      origin. Bearer, API-key and access-token sessions are rejected.
   2. The session user's email is an **active row in `ops_operators`** with
      TOTP enrolled.
   3. A valid **TOTP** code, or a single-use recovery code.

   Passing all three mints a separate ops session:
   - stored as a hashed random token in `ops_sessions`;
   - cookie `hisaabo_ops`: `HttpOnly`, `Secure` when https, `SameSite=Strict`,
     `Path=/ops`;
   - idle timeout `OPS_SESSION_IDLE_MINUTES` (15), absolute
     `OPS_SESSION_MAX_HOURS` (8).

   Logging out of Hisaabo, removing the operator, or a role change revokes
   ops sessions.
4. **Step-up.** Retry, delete, flush, clear, pause/resume and payload reveal
   require a TOTP re-entry within the last `OPS_STEP_UP_MINUTES` (5).
5. **Roles.** `viewer` can read only. `admin` can read and act. A viewer can
   never reveal payloads.
6. **TOTP details:**
   - SHA-1, 6 digits, 30 s, ±1 step;
   - replay protection: a code's time step can be used only once
     (`totp_last_step`);
   - after 5 failures, locked out for 15 minutes;
   - secret encrypted with `ENCRYPTION_KEY`;
   - 10 recovery codes, each 10 random bytes, stored as SHA-256 hashes,
     single-use;
   - enrolment and re-enrolment only via CLI, which prints the `otpauth://`
     URI and the recovery codes once.
7. **Request hardening on `/ops/api/*`:**
   - JSON only;
   - state-changing requests need `X-Requested-With: hisaabo` and an `Origin`
     equal to the API's own origin;
   - no CORS headers are ever sent for `/ops`;
   - per-IP rate limit 60/min, 10/min for auth endpoints;
   - every response `Cache-Control: no-store`.
8. **Static app hardening:**

   ```
   default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
   connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
   ```

   Plus `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. No
   third-party assets.
9. **Audit.** Every ops sign-in (success or failure), step-up, action and
   payload reveal appends a row to `ops_audit_log`, as do CLI operator and
   queue commands (actor `cli:<os user>`). Application code only inserts into
   this table. The dashboard has a read-only Audit page.
10. **Data exposure.**
    - Tenant ids are shown as hashed handles, the same FNV handle as the admin
      TUI.
    - Payloads are hidden unless revealed (admin + step-up + audit).
    - Encrypted fields stay ciphertext.
    - Errors are masked.
11. **Supply chain.** pg-boss is pinned to an exact version at least two
    weeks old. The ops app has no runtime CDN dependencies.

## 8. Data model

All tables live in the control database. Migrations go in **both**
`packages/db/drizzle` (self-hosted, unified) and `packages/db/drizzle-control`
(cloud).

- `pgboss.*`: owned by pg-boss and installed by the migration step.
- `ops_operators`:

  | Column | Notes |
  |---|---|
  | `id` | uuid |
  | `email` | normalised, unique |
  | `role` | `admin` \| `viewer` |
  | `totp_secret` | encrypted |
  | `totp_enrolled_at` | |
  | `totp_last_step` | bigint |
  | `recovery_code_hashes` | jsonb |
  | `failed_attempts`, `locked_until` | lockout |
  | `disabled_at` | |
  | `created_at`, `created_by` | |

- `ops_sessions`: `id`, `token_hash` (unique), `operator_id`, `user_id`,
  `session_id` (the Hisaabo session it was derived from; revoked with it),
  `created_at`, `last_seen_at`, `expires_at`, `step_up_at`, `ip`,
  `user_agent`, `revoked_at`.
- `ops_audit_log`: `id` (bigserial), `at`, `operator_id`, `actor` (text),
  `action`, `queue`, `job_ids` (jsonb), `details` (jsonb, masked), `ip`,
  `result`.
- `queue_controls`: `queue` (pk), `paused` (bool), `paused_at`, `paused_by`.
- `dispatch` quota counts are read from `pgboss.job` (queued and active per
  tenant group), so no extra table is needed.

## 9. Operator dashboard (`apps/ops`)

The app is React + Vite and reuses the web app's design tokens. It refreshes
every 5 s while the tab is visible.

- **Sign-in**: confirms the Hisaabo session, then asks for TOTP.
- **Dashboard**: jobs/min, failed/min, p50/p95 wait and runtime, queued
  backlog, oldest waiting job, active workers, recent failures.
- **Queues**: per-queue counts by state, rate and oldest waiting job,
  pause/resume (admin).
- **Jobs**: Pending, Active, Completed and Failed tabs, filterable by queue,
  tenant handle and tag, keyset-paginated; bulk retry/delete (admin). The
  Failed tab is the dead-letter queues (§6): that is where failed jobs live.
- **Job detail**: timeline (created → started → finished), attempts, masked
  error, tags, tenant and business handles, payload field names, and
  "Reveal payload" (admin + step-up). Progress is Phase 3.
- **Workers**: pg-boss instances (API and workers) with last heartbeat.
- **Schedules**: cron, time zone, next run.
- **Audit**: filterable log, newest first.

Implementation (steps 4–5): `packages/api/src/ops/` (`routes.ts` gate and
API, `data.ts` read models and actions, `operators.ts`, `sessions.ts`,
`totp.ts`, `cidr.ts`, `audit.ts`, `config.ts`), `packages/api/src/bin/ops.ts`
and `apps/ops`. The built app is copied to `packages/api/dist/ops-public` by
both Dockerfiles (`pnpm --filter @hisaabo/api build:ops` locally). Notes:

- Job listing reads `pgboss.job` directly (pg-boss has no filtered,
  paginated listing): bounded, read-only, keyset on `(created_on, id)`,
  through pg-boss's own connection. Everything else uses pg-boss APIs.
- "Retry" of a failed job is pg-boss `redrive()` from the dead-letter queue
  back to its source queue; "Delete" is `deleteJob()`.
- Tenant filtering takes the 6-hex handle and maps it back to tenant ids
  seen in the queue (bounded scan), so raw ids never leave the server.
- A disabled dashboard, or a client outside `OPS_IP_ALLOWLIST`, gets the
  API's ordinary 404 page. Failed second-factor attempts also emit the
  `ops_auth_fail` security event (matched by the fail2ban filter).

The operator API lives under `/ops/api/` (all JSON; Hono routes, not tRPC,
to keep it out of the tenant API surface):

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | |
| POST | `/session` | TOTP sign-in |
| POST | `/step-up` | |
| POST | `/logout` | |
| GET | `/overview` | |
| GET | `/queues` | |
| GET | `/queues/:name` | |
| POST | `/queues/:name/pause`, `/queues/:name/resume` | admin + step-up |
| GET | `/jobs?tab&queue&tenant&tag&cursor&limit` | `tab` = pending, active, completed, failed |
| GET | `/jobs/:queue/:id` | |
| POST | `/jobs/:queue/:id/reveal` | admin + step-up |
| POST | `/jobs/retry`, `/jobs/delete` | admin + step-up; bulk, max 500 ids |
| GET | `/workers`, `/schedules`, `/audit` | |

## 10. CLI

There are two tools.

**`ops`** (new, `packages/api/src/bin/ops.ts`) writes, and is audit-logged:

```
ops operator add <email> --role admin|viewer
ops operator remove <email>
ops operator list
ops operator enroll <email>           # (re)generate TOTP secret + recovery codes, printed once
ops operator revoke-sessions <email>
ops queue list | stats [queue]
ops queue failed [--queue q] [--limit n]
ops queue retry <id…> | --queue q --all-failed   # redrive failed jobs
ops queue forget <id…>               # delete failed jobs by id
ops queue flush [--queue q]          # delete all failed jobs
ops queue clear <queue>              # delete queued jobs (asks for confirmation)
ops queue pause <queue> | resume <queue>
```

**Admin TUI** (existing, read-only) gains a **Queues** view:

- reached with key `5` and in the Tab cycle;
- per-queue counts (queued, active, retry, failed), throughput and oldest
  wait;
- worker instances and recent failures, masked by default, `p` to reveal;
- alerts: "no live workers", "backlog growing", "failure spike";
- covered by `--json`, `--once` and `--demo`.

It stays strictly read-only; actions belong to `ops`.

## 11. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `QUEUE_DATABASE_URL` | `CONTROL_DATABASE_URL \|\| DATABASE_URL` | Where `pgboss` lives |
| `QUEUE_POOLS` | `default,heavy,system` | Pools this worker runs |
| `QUEUE_CONCURRENCY_<POOL>` | see §6 | Per-process concurrency |
| `QUEUE_COMPLETED_RETENTION_HOURS` | 24 | |
| `QUEUE_FAILED_RETENTION_DAYS` | 14 | |
| `QUEUE_SHUTDOWN_GRACE_SECONDS` | 25 | |
| `QUEUE_POLLING_INTERVAL_SECONDS` | 2 | How often idle workers poll for jobs |
| `QUEUE_HEARTBEAT_FILE` | `/tmp/worker-heartbeat` | Worker liveness file for the healthcheck |
| `QUEUE_PING_SCHEDULE` | `false` | Schedule the hourly `system.ping` job |
| `QUEUE_DASHBOARD_ENABLED` | `false` | Enables `/ops` |
| `OPS_IP_ALLOWLIST` | (unset) | CIDRs allowed to reach `/ops` |
| `OPS_SESSION_IDLE_MINUTES` / `OPS_SESSION_MAX_HOURS` / `OPS_STEP_UP_MINUTES` | 15 / 8 / 5 | |

When the dashboard is enabled, `ENCRYPTION_KEY` is required in every mode,
because TOTP secrets are encrypted with it.

## 12. Deployment changes

- **`tsup.config.ts`**: add entries `src/worker.ts` and `src/bin/ops.ts`.
- **Image build.** The `Dockerfile` and `Dockerfile.once` builder stages
  build `apps/ops` and copy its `dist` to `packages/api/dist/ops-public`.
- **Entrypoint.** `docker-entrypoint.sh`: `worker` as the first argument
  skips migrations and execs the worker. The worker waits until the
  `pgboss` schema reports the expected version, retrying with backoff, so it
  never races the API's migration step.
- **`docker-compose.prod.yml`**: a `worker` service with:
  - the same image, `command: worker`;
  - the same `read_only`, `cap_drop`, `no-new-privileges`, tmpfs and
    `env_file` as `api`;
  - no ports;
  - a heartbeat-file healthcheck;
  - `depends_on: api (healthy)`.
- **`Dockerfile.once`**: an s6 longrun `worker` (depends on `postgres-ready`;
  waits for the schema as above).
- **`nginx/nginx.conf`**: an explicit `location /ops/` with its own small
  rate-limit zone and no caching, plus a commented `allow`/`deny` example.
- **CI**:
  - `apps/ops` joins lint, typecheck and build;
  - the test setup installs the pg-boss schema, because CI uses `db:push`,
    which skips SQL migrations;
  - the Docker dry-run builds both images.
- **Docs**: `DEPLOYMENT.md` (worker service, scaling, enabling `/ops`,
  operator enrolment), `SECURITY.md` (`/ops` threat model) and `.env*.example`.

## 13. Testing

- **Unit**:
  - TOTP against RFC 6238 test vectors, plus replay and lockout;
  - envelope validation and the encrypt/decrypt round-trip;
  - masking;
  - the secret-field naming guard;
  - pool and option mapping;
  - `runInThread` timeout and termination.
- **Integration** (real Postgres):
  - dispatch inside a transaction (rollback ⇒ no job);
  - retries and backoff, then failed and `onFailed`;
  - `PermanentError`;
  - uniqueness;
  - per-tenant concurrency across two worker instances;
  - pause/resume;
  - graceful shutdown;
  - tenant re-validation (deleted business ⇒ permanent failure).
- **Ops authorization matrix**: every `/ops/api` route against:
  - no session, bearer session, non-operator, viewer, admin without
    step-up, admin with step-up;
  - dashboard disabled (404);
  - IP not allowlisted (404);
  - CSRF header and Origin missing.

  Also: the audit row is written for every action.
- **Admin TUI**: the Queues view rendered from FakeRunner and demo data.

## 14. Rollout

**Phase 1: foundations (this work).** Nothing user-facing moves yet.

1. pg-boss dependency, schema install in migrations, control tables (both
   folders), test helpers.
2. Job framework: `defineJob`, `dispatch`, registry, envelope, encryption,
   errors, tenant context, `runInThread`, `defineSchedule`, plus the
   `system.ping` diagnostic job and a `system.ping` schedule (hourly,
   disabled unless `QUEUE_PING_SCHEDULE=true`).
3. Worker process, pools, pause, shutdown, health; Docker, compose, ONCE,
   nginx and CI wiring.
4. Operator auth: `ops_operators`, `ops` CLI, TOTP, ops sessions, step-up,
   audit log, IP allowlist.
5. `/ops/api` and the `apps/ops` dashboard.
6. Admin TUI Queues view.

**Phase 2: move existing processes onto the queue.** One PR each, in this
order:

1. Recurring invoices: cron schedule plus per-tenant fan-out jobs. This
   removes the `setInterval` and fixes the double generation.
2. E-invoice submission and retry: durable, with automatic retry and
   backoff. Also fix the IRP rate limiter hang and add fetch timeouts.
3. Self-export and self-import as jobs, with progress and a download link
   when done.
4. Bank statement processing: **RE2** for user regexes, pattern length and
   count caps, write-time validation, and CPU work in `runInThread`.
5. Data imports, GSTR-2B upload and reconciliation.
6. Party ledger PDF, GSTR-9, Tally export and full-history reports become
   async exports.
7. Move in-memory rate limits and single-use nonces to Postgres so they hold
   across replicas.

**Phase 3:**

- batches and chains (pg-boss `flow`);
- a tenant-facing "Background tasks" panel showing a tenant's own job
  progress (tenant-scoped, read-only).
