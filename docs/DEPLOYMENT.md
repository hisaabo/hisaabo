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

**`ci.yml`** runs typecheck, lint, and build for the entire monorepo. On PRs it also builds both release images (`Dockerfile` and `Dockerfile.once`, no push) to catch Dockerfile issues early, and checks that the version and commit are baked into them.

### On push to `main` (path-filtered): previews only

Nothing reaches production from `main`. Frontend changes deploy a **preview** to each Cloudflare Pages project's `preview` branch alias (for example `preview.hisaabo-web.pages.dev`):

| Workflow | Trigger paths | Preview |
|---|---|---|
| `deploy-web.yml` | `apps/web/**`, `packages/shared/**`, `packages/api/src/{index,router}.ts`, `packages/api/src/routers/**` | Web SPA, only when the `PREVIEW_API_URL` repository variable is set |
| `deploy-store.yml` | `apps/store/**` | Store SPA, only when `PREVIEW_API_URL` is set |
| `deploy-api-docs.yml` | `apps/api-docs/**`, the API router files | API reference site |
| `deploy-docs.yml` | `apps/docs/**` | Documentation site: deploys to production on `main` (it documents, it doesn't run against the API) |

Web and store previews are built against `PREVIEW_API_URL` (a staging API) rather than production, so unreleased frontend code never talks to the production API with real sessions. Without a staging API, set nothing and no preview is built. The staging API's `CORS_ORIGINS` must include the preview origins, and the Turnstile widget must allow the preview hostnames.

Container images are not published from `main` either: `release.yml` builds and pushes both of them for every release tag, whichever paths changed (see [Container images](#container-images-ghcr)).

### On a release tag (`v*`): production

**`release.yml`** checks that the tag matches every version manifest, builds and signs the Docker images, then calls `deploy-web.yml`, `deploy-store.yml` and `deploy-api-docs.yml` to deploy the tagged commit to production (only the apps that changed since the previous tag). The frontend deploys wait for the API image job, so a new frontend never ships ahead of its API image. The release notes report each deploy's result.

- **Hold until the API is live (recommended):** the production deploy jobs run in the `production` GitHub environment. Add required reviewers to it (Settings → Environments → production) to approve the frontend deploy once the API containers of the same tag are running.
- **Rollback / redeploy:** run the workflow manually (Actions → Deploy Web / Deploy Store / Deploy API Docs → Run workflow) with a release tag such as `v0.9.1`. Only tags are accepted.
- **Cloudflare settings:** the projects use direct uploads from these workflows. If a Pages project is also connected to the GitHub repository in the Cloudflare dashboard, disconnect it (or disable automatic production deployments), otherwise Cloudflare keeps deploying `main` itself. The production branch name defaults to `main`; set the `CF_PAGES_PRODUCTION_BRANCH` repository variable if a project uses another.

## Environment Variables

### Cloudflare Pages (Web App)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | API server URL (build-time) | `https://api.hisaabo.in` |
| `VITE_ANDROID_APP_CERT_SHA256` | Comma-separated SHA-256 fingerprints of your Android signing certificate(s); written into `/.well-known/assetlinks.json` so mobile sign-in app links verify | `AB:CD:...` |
| `VITE_APPLE_TEAM_ID` | Apple developer team ID; written into `/.well-known/apple-app-site-association` | `ABCDE12345` |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key used by the sign-in page. The published Docker images contain only the API; you build the web app yourself. Leave it unset in a self-hosted web build that does not use Turnstile: the sign-in form then skips the challenge, and the API must not have `TURNSTILE_SECRET_KEY` set (it would answer "Turnstile verification required") | `0x4AAA...` |

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
| `API_PUBLIC_URL` | Recommended (production) | Public base URL of the API, used for absolute links (UPI pay links in PDFs) and store share metadata. Optional: if unset the API starts with a warning and falls back (see [Upgrading from v0.9.x](#upgrading-from-v09x)). A set value must be a valid `http(s)` URL or startup fails | `https://api.hisaabo.in` |
| `LEGACY_V09_CLIENT_COMPAT` | No | Default on; set to `false` to disable every v0.9.x client compatibility path at once: the Turnstile exemption for installed v0.9.x mobile/desktop apps on `sendMagicLink`, the bearer-token sign-in signature, and the `source=` app handoff. Deprecated, removed in 0.11.0 | `false` |
| `ALLOW_OPEN_SIGNUP` | No | Self-hosted only. By default signup is invite-only after the first owner; `true` restores open signup | `false` |
| `ENCRYPTION_KEY` | Yes (production and `MULTI_TENANT=true`) | AES-256-GCM key for field-level encryption: exactly **64 hex characters** (32 bytes); startup rejects anything else in multi-tenant mode. In single-tenant production a malformed key only logs a warning and saving/reading encrypted credentials (e-invoice, carrier API keys) fails until it is fixed. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | `a1b2c3...` |
| `ENCRYPTION_KEY_PREVIOUS` | No | Previous encryption key — set only during key rotation | |
| `RESEND_API_KEY` | Yes | Email service API key (magic links, invites) | `re_xxx` |
| `EMAIL_FROM` | No | From address for emails | `Hisaabo <noreply@hisaabo.in>` |
| `MULTI_TENANT` | No | Enable multi-tenancy | `true` |
| `CONTROL_DATABASE_URL` | No | Separate control DB (multi-tenant only). Also used for the cache invalidation `LISTEN` connection, so it must be a direct (non-PgBouncer-transaction-mode) URL; see [caching](architecture/caching.md) | `postgresql://...` |
| `TRUST_PROXY_HOPS` | No | Number of trusted reverse proxies in front of the API (default `1`; `0` = API exposed directly, forwarding headers ignored). Drives client-IP detection for rate limiting and audit logs | `1` |
| `TRUST_CLOUDFLARE` | No | `true` to honour `cf-connecting-ip`; only when the API is reachable exclusively via Cloudflare | `false` |
| `EXPORT_SECRET` | No | Optional dedicated secret for signing import tokens (falls back to `SESSION_SECRET`) | |
| `TURNSTILE_SECRET_KEY` | Yes (production) | Cloudflare Turnstile secret. Required for every sign-in request and for the public store. The only exception is the deprecated v0.9.x native-app exemption below (`LEGACY_V09_CLIENT_COMPAT`); account creation always requires a token | `0x4AAA...` |
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
| `CLOUDFLARE_API_TOKEN` | deploy-web, deploy-store, deploy-api-docs, deploy-docs | Cloudflare API token with Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-web, deploy-store, deploy-api-docs, deploy-docs | Cloudflare account ID |
| `VITE_API_URL` | deploy-web, deploy-store | Production API URL injected into production builds |

### GitHub Actions Variables

| Variable | Used by | Description |
|---|---|---|
| `PREVIEW_API_URL` | deploy-web, deploy-store | Staging API URL for `main` previews. Unset = no web/store previews |
| `CF_PAGES_PRODUCTION_BRANCH` | deploy-web, deploy-store, deploy-api-docs | Production branch of the Pages projects (default `main`) |

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
   - Set `API_PUBLIC_URL` (recommended) and the Turnstile keys
   - Signup is invite-only after the first owner; invite teammates from Settings → Team, or set `ALLOW_OPEN_SIGNUP=true`

3. Choose the API image. `docker-compose.prod.yml` reads it from `HISAABO_API_IMAGE` and defaults to `ghcr.io/hisaabo/hisaabo-api:latest`. For production, pin a release in `.env.prod` so an upgrade is always a deliberate edit:
   ```bash
   HISAABO_API_IMAGE=ghcr.io/hisaabo/hisaabo-api:v0.10.0
   ```
   Use your own `ghcr.io/<owner>/hisaabo-api` path if you build from a fork. To pin the exact bytes, append the digest from the release notes (see [Container images](#container-images-ghcr)).

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

Read [UPGRADING.md](UPGRADING.md) first. Some releases need env, compose or client changes; upgrading from v0.9.0 does.

```bash
# 1. Back up every database (copy the files off the host)
docker compose --env-file .env.prod -f docker-compose.prod.yml exec backup backup.sh
# 2. Pull and restart
docker compose --env-file .env.prod -f docker-compose.prod.yml pull api worker
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api worker
```

The entrypoint script runs pending migrations automatically before starting the server (the `api` container only). Migrations are forward-only; see [ROLLBACK.md](ROLLBACK.md) before downgrading.

### Background job worker

Long-running and scheduled work runs in a separate `worker` container built from the same image (`command: worker`); see [the queue design](architecture/queue.md). Jobs live in Postgres (the `pgboss` schema, installed by the API's migration step), so the worker needs no extra services.

- The worker never runs migrations. It starts after the API is healthy and, if the queue schema is not there yet, retries with backoff until it is.
- The queue schema install is best-effort in this release. If the migration role cannot create the `pgboss` schema, the API logs `job queue schema NOT installed` with the remediation (grant `CREATE` on the database, use a direct non-pooled connection, restart the `api` container) and starts normally; nothing depends on the queue yet.
- It writes `/tmp/worker-heartbeat` every 10 seconds; the compose healthcheck fails when that file is older than 60 seconds.
- On `SIGTERM` it stops taking jobs and gives running ones `QUEUE_SHUTDOWN_GRACE_SECONDS` to finish. Jobs that still don't finish are retried by another worker once they time out.
- Scale out by running more worker containers (`docker compose up -d --scale worker=2`), or dedicate containers to a pool with `QUEUE_POOLS=heavy`.
- Check it is consuming jobs: `docker compose -f docker-compose.prod.yml logs worker` shows `queue worker started`; set `QUEUE_PING_SCHEDULE=true` to get an hourly `pong` line.

### Operator dashboard (`/ops`)

A Horizon-style dashboard for the job queue (throughput, queues, pending/active/completed/failed jobs, workers, schedules, audit log) is served by the API at `/ops`. It is **off** unless `QUEUE_DASHBOARD_ENABLED=true`; the full threat model is in [the queue design](architecture/queue.md) §7.2.

Getting in takes three things, all required: a normal Hisaabo sign-in in the same browser (a browser cookie session; API keys and bearer tokens are refused), an operator record for that email, and a code from an authenticator app (TOTP). Operators can only be created and enrolled from the server shell — there is no web or API path — so access to the shell is the root of trust:

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

### Upgrading from v0.9.x

You can upgrade by only pulling the new image (`docker compose pull && docker compose up -d`) with your existing `docker-compose.prod.yml` and `.env.prod`; no edits are required to boot. What to know:

- **`API_PUBLIC_URL` (new, optional).** If it is missing the API starts and logs `API_PUBLIC_URL is not set. Falling back to ...` at startup. Fallbacks: invoice and ledger PDF payment links use the request origin (exactly what v0.9.0 did); everything else (store share metadata, the og:image URL) uses `APP_URL`, then the first `CORS_ORIGINS` entry. Only share-preview metadata (the og:image and canonical store URL) uses the `APP_URL` fallback. The Docker images, including the ONCE image, contain only the API and the web app is hosted separately, so `APP_URL` is normally a different host than the API (`app.example.com` vs `api.example.com`) and those links point at it: set `API_PUBLIC_URL=https://api.example.com` to fix them and silence the warning. PDF payment links are unaffected.
- **`ENCRYPTION_KEY` format.** The key must be 64 hex characters. A malformed key no longer prevents boot in single-tenant mode (it only logs a warning, as v0.9.0 only failed when a credential was actually encrypted); it still prevents boot when `MULTI_TENANT=true`. Nothing can have been encrypted under a malformed key, so fixing it later loses no data: generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **Sign-up is invite-only by default (self-hosted).** After the first owner exists, new accounts need an invitation (Settings → Team). If your server relied on open registration, set `ALLOW_OPEN_SIGNUP=true`. Existing accounts are unaffected.
- **Round-off on existing documents.** New and changed round-off values are limited to +/-1.00. Documents saved earlier with a larger round-off remain editable as long as the round-off is left unchanged. Converting such a document (quotation -> invoice, etc.) asks you to bring its round-off within +/-1.00 first.
- **v0.9.x mobile and desktop apps keep working (deprecated; removed in 0.11.0).** Controlled by `LEGACY_V09_CLIENT_COMPAT` (on by default; `false` turns all of the following off):
  - *Sign-in token.* The v0.9.0 mobile app (no `X-Hisaabo-Client`, no `Origin`) still receives its session token at sign-in; browsers never do. New v0.9.0 mobile sign-ins get bearer sessions (7-day sliding window, 30-day cap), as current apps do.
  - *Turnstile.* v0.9.0 never required Turnstile for magic links and those apps cannot solve a challenge, so when `TURNSTILE_SECRET_KEY` is set, a token-less `sendMagicLink` from the exact v0.9.0 mobile header shape, or from the Tauri desktop webview (`X-Hisaabo-Client: desktop` plus a `tauri.localhost` origin), is accepted. It is bounded: only for emails that already have an account or a pending invitation (anything else gets the same response and no mail), at most 10 links per address per 24 hours on top of the existing limits, and each use logs a `turnstile_legacy_exempt` event. A request that sends a token is always verified, and a browser can never match the exemption.
  - *App handoff.* The emailed link carries `source=mobile|desktop` and the web `/auth/verify` page offers a button to open the app (`hisaabo://verify?token=...`) instead of signing the browser in.
  - *Account creation is not exempt.* `auth.register` always requires a Turnstile token, so creating a new account from a v0.9.x app on a Turnstile-enabled server no longer works: update the app or sign up in the browser. The desktop app is told so.
  - *Session idle timeout.* Sessions that v0.9.0 mobile apps created before the upgrade are cookie-type sessions used as Bearer tokens; they now get the 14-day idle timeout of cookie sessions (v0.9.0 skipped it on the Bearer path), so a v0.9.0 app unused for 14 days asks the user to sign in again.
  - Ask users to update their apps; there is no code change to remove these paths other than the 0.11.0 release.
- **Accounts that registered with a password and never verified their email.** They keep signing in with the password until the first time they sign in with a magic link. That first magic-link sign-in proves the mailbox, so it signs out every other session of the account, deletes its API keys, clears its password and deletes the pending invitations it issued (this closes an account-takeover hole where someone else could pre-register your address); the user continues with magic links. Members who already have access to an organisation the account owns are not removed; the owner gets an email listing them (with roles) to review in Settings → Team.
  - **Multi-tenant cloud:** this applies to every such account, and an unverified account additionally cannot invite members or change roles until it has signed in once by email link.
  - **Self-hosted:** under v0.9.0 every password account counts as "never verified", the owner included, so the wipe applies only to accounts with no membership or only the legacy `member` role (a stranger's sign-up or self-join). Owners, admins and members with an invited role (`seller_manager`, `seller`, `accountant`) are simply marked verified by their first magic-link sign-in and keep their password, sessions, API keys and invitations; no notice is sent.
  - Already-verified accounts are unaffected. On a server without working email, such accounts can only use the password, and an operator `login-link` does not trigger any of this (it neither verifies the email nor revokes anything).
- **Inviting people on a server without email.** Invitations can still be accepted: an invited person registers with a password and opens the invitation link; on a self-hosted server the invitation token counts as proof of the address, so no email-link sign-in is needed (this is not the case on the cloud). The in-app "accept" button for invitations (no link) still requires a verified email.
- **No working email?** Accounts that have a password can use "Sign in with password instead" on the web login page, and operators can print a one-time link with the [break-glass command](#break-glass-sign-in-when-email-is-not-working).

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

### Break-glass sign-in (when email is not working)

Sign-in is by emailed magic link. In production the API refuses to send mail without `RESEND_API_KEY`, so a misconfigured install can lock everyone out, including the owner who needs to fix it. With shell access to the API container, print a one-time sign-in link for an existing user:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \
  node packages/api/dist/bin/admin.js login-link owner@example.com
# or, with plain docker
docker exec -it hisaabo-api node packages/api/dist/bin/admin.js login-link owner@example.com
```

It prints `${APP_URL}/auth/verify?token=...`; open it in a browser. Unlike an emailed link, it does not mark the account's email as verified and does not revoke the account's existing sessions, API keys or password (an operator link proves nothing about the mailbox). The link is the same kind of token an emailed link carries: it is valid for 15 minutes (`--ttl-minutes 1..60` to change), usable once, and signs in as that user, so treat it like a password. The command only works for emails that already have an account (it never creates users). Pass `--base-url https://app.example.com` if `APP_URL` is not set in the container. In multi-tenant mode it uses the control database (`CONTROL_DATABASE_URL`, else `DATABASE_URL`), where users live.

On the ONCE all-in-one image the same command works inside the container (`docker exec -it <container> node packages/api/dist/bin/admin.js login-link <email>`); it reads the database password from `/storage/secrets/pg_app_password` automatically because `docker exec` shells do not inherit the API's `DATABASE_URL`.

If you issue a login-link to an invited user on an install without email, first check the account was created by them. If in doubt, delete the user and re-invite them, since a pre-registered account's password stays valid.

Each issued link leaves a row in `magic_link_tokens` with `ip_address = 'admin-cli'` (issue time in `created_at`, redemption time in `used_at`) and a line on stderr. There is no platform-level audit table; the per-business audit log is not used. After signing in, fix `RESEND_API_KEY` / `EMAIL_FROM` so normal sign-in works.

## Kamal / Once.com Compatibility

The `docker-compose.prod.yml` is compatible with Kamal's deploy model:

- Health check endpoint: `GET /health` on port 3000
- The container runs migrations on startup (idempotent)
- Graceful shutdown: entrypoint uses `exec` so Node receives SIGTERM directly
- Images are tagged with the immutable `vX.Y.Z` and with `sha-<commit>` (see [Container images](#container-images-ghcr)); deploy a pinned `vX.Y.Z` and roll back by deploying the previous one

## Container images (GHCR)

`release.yml` (on a `v*` tag) first checks that the tag matches every version manifest (`pnpm release <version>` bumps them together), then builds and pushes both images for **every** release tag, whichever paths changed, so a released version always has images. Each image is signed with cosign (keyless) and carries SLSA provenance and an SBOM.

Two images are published, both multi-arch (`linux/amd64`, `linux/arm64`):

| Image | Dockerfile | Use |
|---|---|---|
| `ghcr.io/hisaabo/hisaabo-api` | `Dockerfile` | API only; bring your own PostgreSQL (`docker-compose.prod.yml`) |
| `ghcr.io/hisaabo/hisaabo` | `Dockerfile.once` | All-in-one (PostgreSQL + API) for ONCE |

### Tags

Each release publishes the following tags for both images (shown for `v0.10.0`):

| Tag | Example | Moves? |
|---|---|---|
| `vX.Y.Z` | `v0.10.0` | No. Published once; the release workflow refuses to overwrite it. |
| `X.Y.Z` | `0.10.0` | No (same image as `vX.Y.Z`) |
| `sha-<12 hex>` | `sha-26c61bb0f3a1` | No. The first 12 characters of the commit the image was built from. |
| `X.Y` | `0.10` | Yes: follows the latest patch release of that minor version |
| `latest` | `latest` | Yes: follows every stable release |

A pre-release such as `v0.10.0-rc.1` is published as `v0.10.0-rc.1`, `0.10.0-rc.1` and `sha-<12 hex>` only; it never moves `latest` or `X.Y`.

For production, pin `vX.Y.Z` (or a digest), not `latest` or `X.Y`, so a restart or a `pull` can never change the running version unexpectedly.

### Upgrading a pinned install

Set `HISAABO_API_IMAGE` in `.env.prod` to the new version, then pull and restart. `--env-file` is required: Compose reads the image name from it, not from the container's `env_file`.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull api
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api
```

To roll back, restore the previous `HISAABO_API_IMAGE` value and run the same commands (if the newer version already applied database migrations, restore a backup taken before the upgrade). If you left the default `:latest`, the same commands upgrade to the newest stable release.

### Pinning by digest

The release notes list the digest of each image. A digest pins the exact bytes, even in the unlikely event a tag is ever re-pointed:

```bash
docker pull ghcr.io/hisaabo/hisaabo-api@sha256:<digest>
# in .env.prod (keep the tag for readability; Docker resolves by the digest)
HISAABO_API_IMAGE=ghcr.io/hisaabo/hisaabo-api:v0.10.0@sha256:<digest>
```

### Verifying an image

Images are signed with cosign (keyless, via GitHub's OIDC identity). Verify the digest from the release notes:

```bash
cosign verify ghcr.io/hisaabo/hisaabo-api@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/hisaabo/hisaabo/.github/workflows/release.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Provenance and the SBOM are attached to the image (`docker buildx imagetools inspect <image> --format '{{ json .Provenance }}'`).

### Which build is this?

Every release image records the source revision, so any running instance can be matched to a commit:

- **Image labels** (`org.opencontainers.image.revision`, `.version`, `.created`, `.source`): `docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' <image>`
- **Container environment**: `HISAABO_VERSION` (`0.10.0`, no leading `v`) and `HISAABO_COMMIT` (full SHA), set by the image. Do not override them in `.env.prod`.
- **Startup log**: `Hisaabo API v0.10.0 (commit 26c61bb0f3a1)`
- **Admin dashboard** header (`node packages/api/dist/bin/admin.js`): `v0.10.0 · 26c61bb0f3a1`
- **Signed-in API clients**: `auth.me` returns `server: { version, commit }`. The unauthenticated `/health` deliberately does not.
- **Web app**: the sidebar footer shows `v0.10.0 · 26c61bb` for the CI-built web deploy and the desktop release builds.

An image built locally without the build args reports version `dev` (resolved from `package.json`) and commit `unknown`.

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
