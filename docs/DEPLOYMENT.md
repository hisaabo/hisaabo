# Hisaabo Deployment Guide

## Architecture Overview

```
                  Cloudflare Pages           Cloudflare Pages
                  +--------------+           +--------------+
   Users -------> | apps/web     |           | apps/store   |
                  | (React SPA)  |           | (Store SPA)  |
                  +------+-------+           +------+-------+
                         |                          |
                         |   HTTPS (tRPC / REST)    |
                         +----------+---------------+
                                    |
                                    v
                  +-------------------------------+
                  | api.hisaabo.in (nginx)        |
                  | - /api/*   -> tRPC            |
                  | - /store/* -> public catalog  |
                  | - /health  -> health check    |
                  +------+------------------------+
                         |
                         v
                  +-------------------------------+
                  | hisaabo-api (Docker / GHCR)   |
                  | packages/api + db + shared    |
                  | Runs migrations on startup    |
                  +------+------------------------+
                         |
                         v
                  +-------------------------------+
                  | PostgreSQL 16                  |
                  | (managed or self-hosted)       |
                  +-------------------------------+
```

## CI/CD Pipeline

### On every PR and push to `main`

**`ci.yml`** runs typecheck, lint, and build for the entire monorepo. On PRs it also does a Docker build dry-run (no push) to catch Dockerfile issues early.

### On push to `main` (path-filtered)

| Workflow | Trigger paths | Action |
|---|---|---|
| `deploy-web.yml` | `apps/web/**`, `packages/shared/**`, `packages/api/src/index.ts` | Build web SPA, deploy to Cloudflare Pages |
| `deploy-store.yml` | `apps/store/**` | Build store SPA, deploy to Cloudflare Pages |
| `deploy-api.yml` | `packages/api/**`, `packages/db/**`, `packages/shared/**`, `Dockerfile` | Build Docker image, push to GHCR |

## Environment Variables

### Cloudflare Pages (Web App)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | API server URL (build-time) | `https://api.hisaabo.in` |
| `VITE_ANDROID_APP_CERT_SHA256` | Comma-separated SHA-256 fingerprints of your Android signing certificate(s); written into `/.well-known/assetlinks.json` so mobile sign-in app links verify | `AB:CD:...` |
| `VITE_APPLE_TEAM_ID` | Apple developer team ID; written into `/.well-known/apple-app-site-association` | `ABCDE12345` |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key used by the sign-in page | `0x4AAA...` |

### Cloudflare Pages (Store)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | API server URL (build-time) | `https://api.hisaabo.in` |

### Backend (Docker / GHCR)

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@host:5432/hisaabo` |
| `PORT` | No | API port (default 3000) | `3000` |
| `NODE_ENV` | Yes | Environment | `production` |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins | `https://app.hisaabo.in,https://store.hisaabo.in` |
| `APP_URL` | Yes | Frontend URL (for magic links and the native sign-in page) | `https://app.hisaabo.in` |
| `API_PUBLIC_URL` | Yes (production) | Public base URL of the API. Startup fails in production without a valid `http(s)` URL | `https://api.hisaabo.in` |
| `ALLOW_OPEN_SIGNUP` | No | Self-hosted only. By default signup is invite-only after the first owner; `true` restores open signup | `false` |
| `ENCRYPTION_KEY` | Yes (production and `MULTI_TENANT=true`) | AES-256-GCM key for field-level encryption: exactly **64 hex characters** (32 bytes); startup rejects anything else in multi-tenant mode. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `a1b2c3...` |
| `ENCRYPTION_KEY_PREVIOUS` | No | Previous encryption key — set only during key rotation | |
| `RESEND_API_KEY` | Yes | Email service API key (magic links, invites) | `re_xxx` |
| `EMAIL_FROM` | No | From address for emails | `Hisaabo <noreply@hisaabo.in>` |
| `MULTI_TENANT` | No | Enable multi-tenancy | `true` |
| `CONTROL_DATABASE_URL` | No | Separate control DB (multi-tenant only). Also used for the cache invalidation `LISTEN` connection, so it must be a direct (non-PgBouncer-transaction-mode) URL; see [caching](architecture/caching.md) | `postgresql://...` |
| `TRUST_PROXY_HOPS` | No | Number of trusted reverse proxies in front of the API (default `1`; `0` = API exposed directly, forwarding headers ignored). Drives client-IP detection for rate limiting and audit logs | `1` |
| `TRUST_CLOUDFLARE` | No | `true` to honour `cf-connecting-ip`; only when the API is reachable exclusively via Cloudflare | `false` |
| `EXPORT_SECRET` | No | Optional dedicated secret for signing import tokens (falls back to `SESSION_SECRET`) | |
| `TURNSTILE_SECRET_KEY` | Yes (production) | Cloudflare Turnstile secret. Required for every sign-in request (web, desktop, mobile, CLI) and for the public store; there is no client-header bypass | `0x4AAA...` |
| `SMS_PROVIDER` | No | Store phone OTP provider: `console` (dev only) or `webhook`. Needed before a store can enable phone OTP | `webhook` |
| `SMS_WEBHOOK_URL` | With `SMS_PROVIDER=webhook` | Endpoint that receives `{ "to": "+91...", "message": "..." }` | `https://sms.example.com/send` |
| `SMS_WEBHOOK_SECRET` | With `SMS_PROVIDER=webhook` | HMAC-SHA256 key; each request carries `X-Hisaabo-Signature` (hex of the body HMAC) | |
| `SHIPPING_WEBHOOK_REQUIRE_TIMESTAMP` | No | `true` rejects carrier webhooks that lack a valid timestamp (optional by default) | `false` |
| `BACKUP_ENCRYPTION_KEY` | With offsite backup | Passphrase for backup encryption; offsite upload is refused without it | |
| `QUEUE_DATABASE_URL` | No | Database holding the job queue (`pgboss` schema). Defaults to `CONTROL_DATABASE_URL`, then `DATABASE_URL`; only set it to point at the same database through a different (e.g. direct) URL | `postgresql://...` |
| `QUEUE_POOLS` | No | Worker only. Comma-separated pools this worker runs: `default`, `heavy`, `system` (default: all) | `heavy` |
| `QUEUE_CONCURRENCY_DEFAULT` / `_HEAVY` / `_SYSTEM` | No | Worker only. Jobs worked at once per queue in that pool, per worker process (defaults 8 / 2 / 2) | `4` |
| `QUEUE_COMPLETED_RETENTION_HOURS` | No | How long completed jobs are kept (default 24) | `24` |
| `QUEUE_FAILED_RETENTION_DAYS` | No | How long failed (dead-lettered) jobs are kept for retry (default 14) | `14` |
| `QUEUE_SHUTDOWN_GRACE_SECONDS` | No | Worker only. Time in-flight jobs get to finish on SIGTERM before they are aborted (default 25) | `25` |
| `QUEUE_POLLING_INTERVAL_SECONDS` | No | Worker only. Idle poll interval in seconds (default 2, minimum 0.5) | `2` |
| `QUEUE_PING_SCHEDULE` | No | Worker only. `true` schedules the hourly `system.ping` diagnostic job | `false` |
| `QUEUE_DASHBOARD_ENABLED` | No | `true` serves the operator dashboard at `/ops` (off by default; every `/ops` path is a plain 404 otherwise). Requires `ENCRYPTION_KEY` | `false` |
| `OPS_IP_ALLOWLIST` | No (recommended with `/ops`) | Comma-separated CIDRs (IPv4/IPv6) allowed to reach `/ops`; others get a plain 404. Uses the same client-IP rules as rate limiting (`TRUST_PROXY_HOPS`) | `203.0.113.0/24` |
| `OPS_SESSION_IDLE_MINUTES` / `OPS_SESSION_MAX_HOURS` / `OPS_STEP_UP_MINUTES` | No | `/ops` session idle timeout, absolute lifetime, and how long a TOTP step-up covers destructive actions (defaults 15 / 8 / 5) | `15` |

### GitHub Actions Secrets

| Secret | Used by | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy-web, deploy-store | Cloudflare API token with Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-web, deploy-store | Cloudflare account ID |
| `VITE_API_URL` | deploy-web, deploy-store | API URL injected at build time |

Note: `GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR pushes.

## Self-Hosting with Docker Compose

### Quick start

1. Clone the repo and create your prod env file:

```bash
cp .env.prod.example .env.prod
```

2. Edit `.env.prod` with your production values:
   - Set a strong `POSTGRES_PASSWORD`
   - Generate an `ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Set `CORS_ORIGINS` and `APP_URL` to your domain
   - Set `RESEND_API_KEY` for email delivery
   - Set `API_PUBLIC_URL` (required in production) and the Turnstile keys
   - Signup is invite-only after the first owner; invite teammates from Settings → Team, or set `ALLOW_OPEN_SIGNUP=true`

3. Update `docker-compose.prod.yml`:
   - Replace `ghcr.io/OWNER/hisaabo-api:latest` with your actual GHCR image path

4. Start the stack:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

5. Put a TLS reverse proxy in front. `docker-compose.prod.yml` publishes the API on
   the host loopback only (`127.0.0.1:3000`); expose 80/443 through Caddy, nginx
   (`nginx/nginx.conf`) or a Cloudflare Tunnel running on the same host. Keep
   `TRUST_PROXY_HOPS=1` for exactly one proxy, or `0` if you deliberately expose
   the API port directly (set `API_BIND=0.0.0.0`).

6. Verify health (from the host):

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-25T..."}
```

### Updating

```bash
docker compose -f docker-compose.prod.yml pull api worker
docker compose -f docker-compose.prod.yml up -d api worker
```

The entrypoint script runs pending migrations automatically before starting the server (the `api` container only).

### Background job worker

Long-running and scheduled work runs in a separate `worker` container built from the same image (`command: worker`); see [the queue design](architecture/queue.md). Jobs live in Postgres (the `pgboss` schema, installed by the API's migration step), so the worker needs no extra services.

- The worker never runs migrations. It starts after the API is healthy and, if the queue schema is not there yet, retries with backoff until it is.
- It writes `/tmp/worker-heartbeat` every 10 seconds; the compose healthcheck fails when that file is older than 60 seconds.
- On `SIGTERM` it stops taking jobs and gives running ones `QUEUE_SHUTDOWN_GRACE_SECONDS` to finish. Jobs that still don't finish are retried by another worker once they time out.
- Scale out by running more worker containers (`docker compose up -d --scale worker=2`), or dedicate containers to a pool with `QUEUE_POOLS=heavy`.
- Check it is consuming jobs: `docker compose -f docker-compose.prod.yml logs worker` shows `queue worker started`; set `QUEUE_PING_SCHEDULE=true` to get an hourly `pong` line.

### Operator dashboard (`/ops`)

A Horizon-style dashboard for the job queue (throughput, queues, pending/active/completed/failed jobs, workers, schedules, audit log) is served by the API at `/ops`. It is **off** unless `QUEUE_DASHBOARD_ENABLED=true`; the full threat model is in [the queue design](architecture/queue.md) §7.2.

Getting in takes three things, all required: a normal Hisaabo sign-in (magic link) in the same browser, an operator record for that email, and a code from an authenticator app (TOTP). Operators can only be created and enrolled from the server shell — there is no web or API path — so access to the shell is the root of trust:

```bash
# 1. Make sure ENCRYPTION_KEY is set (TOTP secrets are encrypted with it), then enable the dashboard
#    in .env.prod: QUEUE_DASHBOARD_ENABLED=true and, strongly recommended, OPS_IP_ALLOWLIST=<your VPN/office CIDRs>
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api

# 2. Add an operator (admin can act; viewer is read-only)
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api node packages/api/dist/bin/ops.js operator add you@example.com --role admin

# 3. Enroll their authenticator. The secret, otpauth:// URI and 10 recovery codes are printed ONCE:
#    add the secret to an authenticator app and store the recovery codes offline.
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api node packages/api/dist/bin/ops.js operator enroll you@example.com
```

Then sign in to the web app as that email and open `https://<API_PUBLIC_URL host>/ops/`. Destructive actions (retry, delete, pause/resume) and revealing a job's payload ask for a fresh code. Every sign-in attempt, step-up and action is written to the audit log (Audit page, or the `ops_audit_log` table).

Other operator commands: `ops operator list`, `ops operator remove <email>`, `ops operator revoke-sessions <email>`, and re-running `enroll` to replace a lost authenticator (signs them out everywhere). Queue commands mirror Laravel's: `ops queue list | failed | retry <id…> | retry --queue q --all-failed | forget <id…> | flush | clear <queue> | pause <queue> | resume <queue>` (`ops help` for details). In the ONCE image run the same tool with `docker exec -it <container> su-exec node node /app/packages/api/dist/bin/ops.js …`.

The bundled `nginx/nginx.conf` proxies `/ops/` with its own small rate limit and shows how to add an `allow`/`deny` list there as well.

### Admin dashboard

The API image ships a read-only terminal dashboard with platform statistics (tenants, users, businesses, invoices, amount managed, collections, receivables, a 12-month sales chart, per-tenant table, Postgres health) and an Ops Health screen (e-invoicing, recurring invoice runs, bank and GSTR-2B reconciliation, e-way bills, store orders, shipments, recent failures) with an alerts strip that flags failed e-invoices, failed recurring runs, stalled imports, unreachable tenant databases and similar problems. It runs with the plain `node` binary in the image and needs nothing else:

```bash
# Live dashboard inside the API container
docker exec -it hisaabo-api node packages/api/dist/bin/admin.js
# or, with compose
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api node packages/api/dist/bin/admin.js

# One static snapshot (no TTY needed — handy for logs, cron, or pasting into chat)
docker exec hisaabo-api node packages/api/dist/bin/admin.js --once --width 140

# Raw numbers as JSON
docker exec hisaabo-api node packages/api/dist/bin/admin.js --json
```

If you would rather not enter the API container, the same tool can run on the host and query Postgres through `docker compose exec postgres psql`, the way you would by hand:

```bash
node packages/api/dist/bin/admin.js --via docker --env-file .env.prod -f docker-compose.yml
```

The Infra screen compares each database's migration tracking table (`drizzle.__drizzle_tenant_migrations`, `__drizzle_control_migrations`, or `__drizzle_migrations` for self-hosted) against the journals shipped in the image under `packages/db/drizzle*`, so a tenant that was skipped during a deploy, restored from an older backup, or created with `db:push` and never tracked shows up as behind, ahead or untracked, with the exact pending migration tags. When running from the host, the journals are read from the checkout; pass `--migrations-dir` (or set `HISAABO_MIGRATIONS_DIR`) if they live elsewhere.

All personally identifiable data (tenant names and slugs, database names, user emails and names, connection hosts) is masked by default so output can be shared freely; add `--reveal` or press `p` in the live view to see real values.

In multi-tenant deployments it queries each tenant database once (four in parallel by default, `--concurrency` to change) using the control-plane credentials, so the `POSTGRES_USER` must be able to read the `tenant_*` databases. A tenant database that cannot be reached is shown as unreachable and excluded from the totals; nothing else is affected.

## Kamal / Once.com Compatibility

The `docker-compose.prod.yml` is compatible with Kamal's deploy model:

- Health check endpoint: `GET /health` on port 3000
- The container runs migrations on startup (idempotent)
- Graceful shutdown: entrypoint uses `exec` so Node receives SIGTERM directly
- Image is tagged with both `latest` and the commit SHA for rollback

## Nginx Reverse Proxy

The `nginx/nginx.conf` provides:

- Upstream keepalive connections to the API container
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy; HSTS only when the edge proxy reports `X-Forwarded-Proto: https`), `server_tokens off`
- Gzip compression for JSON responses
- Path-based routing (`/api/trpc/*`, `/api/*`, `/store/*`, `/webhooks/*`, `/health`)
- Per-IP `limit_req` zones (stricter for auth procedures) and a per-IP `limit_conn` cap; header/body timeouts against slow clients
- Per-location body limits: 10MB for tRPC/API (bulk imports), 64KB for auth, 256KB for the public store, 1MB for webhooks and as the default
- Overwrites `X-Forwarded-For` with the connecting address and strips `CF-Connecting-IP` (no client-supplied forwarding headers reach the API). nginx does not cache store responses.
- Documented `real_ip` blocks (top of the file) for when a TLS proxy or Cloudflare sits in front of nginx

### TLS Termination

TLS is expected to be terminated upstream (Cloudflare Tunnel, Caddy, or a cloud load balancer). The nginx config listens on port 80 only. If you need nginx to handle TLS directly, add an `ssl` server block with your certificate paths.

## Logging and fail2ban

`docker-compose.prod.yml` ships container logs to **systemd-journald** via the `journald` Docker driver, with stable `CONTAINER_TAG` labels (`hisaabo-api`, `hisaabo-postgres`, `hisaabo-backup`). This gives you:

- **Bounded disk use.** journald's own rotation (configure `SystemMaxUse=`/`MaxRetentionSec=` in `/etc/systemd/journald.conf`) caps log volume — no need for `logrotate` or Docker's `max-size`/`max-file` json-file options.
- **Historical logs.** Retention is set on the host, not per-container, so logs survive container restarts and image upgrades.
- **fail2ban integration.** The API emits a structured **security event log** (`{"sec":true,"event":"...","ip":"..."}`) at every rate-limit hit, CSRF/origin rejection, and failed login. fail2ban's `systemd` backend tails journald directly and bans repeat offenders at the host firewall.

Install the host-side fail2ban filter and jails from `docs/fail2ban/` — see `docs/fail2ban/README.md` for step-by-step instructions and tuning notes.

If your host does not run systemd, switch each service's `logging:` block to:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"
    compress: "true"
```

This caps each container at ~50 MB and gives fail2ban a JSON file under `/var/lib/docker/containers/<id>/` to tail (use `backend = polling` instead of `systemd` in the jail).

## Native app sign-in

Desktop, mobile and the CLI do not show a password or magic-link form. They open `${APP_URL}/auth/native` in the system browser (PKCE), and the browser returns a one-time code to the app: a loopback `http://127.0.0.1:<port>/callback` for desktop and CLI, and the verified app link `${APP_URL}/auth/native/callback` for mobile. Requirements:

- `APP_URL` must be the public web origin, served over HTTPS.
- The web build must publish the well-known files. Set `VITE_ANDROID_APP_CERT_SHA256` and `VITE_APPLE_TEAM_ID` when building the web app; without them the build emits placeholders and logs a warning, and mobile app links will not verify.
- `/.well-known/apple-app-site-association` must be served as `application/json` (the generated `_headers` does this on Cloudflare Pages; do the same on other hosts).
- The nginx config rate-limits `auth.nativeStart` and `auth.nativeExchange` with the other credential procedures.

## ONCE all-in-one image

`Dockerfile.once` bundles PostgreSQL 16, the API and the background job worker under s6-overlay (the worker is its own s6 service and waits for the API's migrations). Persistent state lives in `/storage` (`pgdata`, `run`, `backups`, `wal_archive`, `secrets`).

- **Database password:** PostgreSQL uses `scram-sha-256` for the local socket, `127.0.0.1` and `::1`; `trust` is never used. A random password is generated on first boot and kept at `/storage/secrets/pg_app_password` (mode `0600`). The API, migrations and the `/hooks/pre-backup` and `/hooks/post-restore` hooks read it automatically, so no configuration is needed.
- **Upgrading an existing install:** on the first boot of the new image the password is created and applied and `pg_hba.conf` is rewritten; the previous file is kept as `/storage/pgdata/pg_hba.conf.bak.<timestamp>`. Later boots change nothing.
- **Connecting by hand:** `docker exec -it <container> sh -c 'PGPASSWORD=$(cat /storage/secrets/pg_app_password) psql -h /storage/run -U postgres hisaabo'`.
- **Backups:** ONCE backs up all of `/storage`, which includes the password file and the database. Treat backups as sensitive.
- **Rotation:** delete `/storage/secrets/pg_app_password` and restart the container; a new password is generated and applied.
