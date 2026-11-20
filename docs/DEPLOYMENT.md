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
   - Set `API_PUBLIC_URL` (recommended) and the Turnstile keys
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
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d api
```

The entrypoint script runs pending migrations automatically before starting the server.

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
- **Accounts that registered with a password and never verified their email.** They keep signing in with the password until the first time they sign in with a magic link. That first magic-link sign-in proves the mailbox, so it signs out every other session of the account, deletes its API keys, clears its password and deletes the pending invitations it issued (this closes an account-takeover hole where someone else could pre-register your address); the user continues with magic links. Members who already have access to an organisation the account owns are not removed; the owner gets an email listing them (with roles) to review in Settings → Team. On the multi-tenant cloud an unverified account additionally cannot invite members or change roles until it has signed in once by email link. Already-verified accounts are unaffected. On a server without working email, such accounts can only use the password, and an operator `login-link` does not trigger this (it neither verifies the email nor revokes anything).
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

Each issued link leaves a row in `magic_link_tokens` with `ip_address = 'admin-cli'` (issue time in `created_at`, redemption time in `used_at`) and a line on stderr. There is no platform-level audit table; the per-business audit log is not used. After signing in, fix `RESEND_API_KEY` / `EMAIL_FROM` so normal sign-in works.

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

`Dockerfile.once` bundles PostgreSQL 16 and the API under s6-overlay. Persistent state lives in `/storage` (`pgdata`, `run`, `backups`, `wal_archive`, `secrets`).

- **Database password:** PostgreSQL uses `scram-sha-256` for the local socket, `127.0.0.1` and `::1`; `trust` is never used. A random password is generated on first boot and kept at `/storage/secrets/pg_app_password` (mode `0600`). The API, migrations and the `/hooks/pre-backup` and `/hooks/post-restore` hooks read it automatically, so no configuration is needed.
- **Upgrading an existing install:** on the first boot of the new image the password is created and applied and `pg_hba.conf` is rewritten; the previous file is kept as `/storage/pgdata/pg_hba.conf.bak.<timestamp>`. Later boots change nothing.
- **Connecting by hand:** `docker exec -it <container> sh -c 'PGPASSWORD=$(cat /storage/secrets/pg_app_password) psql -h /storage/run -U postgres hisaabo'`.
- **Backups:** ONCE backs up all of `/storage`, which includes the password file and the database. Treat backups as sensitive.
- **Rotation:** delete `/storage/secrets/pg_app_password` and restart the container; a new password is generated and applied.
