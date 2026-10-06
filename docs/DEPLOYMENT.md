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
| `APP_URL` | Yes | Frontend URL (for magic links) | `https://app.hisaabo.in` |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for field-level encryption (64-char hex). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `a1b2c3...` |
| `ENCRYPTION_KEY_PREVIOUS` | No | Previous encryption key — set only during key rotation | |
| `RESEND_API_KEY` | Yes | Email service API key (magic links, invites) | `re_xxx` |
| `EMAIL_FROM` | No | From address for emails | `Hisaabo <noreply@hisaabo.in>` |
| `MULTI_TENANT` | No | Enable multi-tenancy | `true` |
| `CONTROL_DATABASE_URL` | No | Separate control DB (multi-tenant only) | `postgresql://...` |
| `TRUST_PROXY_HOPS` | No | Number of trusted reverse proxies in front of the API (default `1`; `0` = API exposed directly, forwarding headers ignored). Drives client-IP detection for rate limiting and audit logs | `1` |
| `TRUST_CLOUDFLARE` | No | `true` to honour `cf-connecting-ip`; only when the API is reachable exclusively via Cloudflare | `false` |
| `EXPORT_SECRET` | No | Optional dedicated secret for signing import tokens (falls back to `SESSION_SECRET`) | |
| `TURNSTILE_SECRET_KEY` | Yes (store) | Cloudflare Turnstile secret for the public store | `0x4AAA...` |
| `BACKUP_ENCRYPTION_KEY` | With offsite backup | Passphrase for backup encryption; offsite upload is refused without it | |

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
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d api
```

The entrypoint script runs pending migrations automatically before starting the server.

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
