# Upgrading Hisaabo

## From v0.10.0 to v0.10.1

An ordinary image bump: set `HISAABO_API_IMAGE` to `v0.10.1`, then `pull api` and `up -d api` as in [Upgrading a pinned install](DEPLOYMENT.md#upgrading-a-pinned-install). This note covers only what the release process added; read the release notes for the rest.

- **New: `GET /api/version`.** It returns `{"version":"0.10.1"}`: the running version only, public, uncacheable, no database access. Use it to confirm which release a server runs (`curl https://<your-api-host>/api/version`); an API older than 0.10.1 answers 404. Set `EXPOSE_VERSION=false` if you do not want the exact version readable by the public (the endpoint then answers 404; it is on by default). The bundled `nginx/nginx.conf` already forwards it (`location /api/`). If you front the API with your own proxy rules, keep `/api/version` reachable. `/health` still does not report a version.
- **Release order is now enforced for the maintainers' deployment.** The release workflow no longer deploys the web app and the store before the API: it waits until the production API reports the new version, then a required reviewer approves the frontend deploys. If you run your own copy of `release.yml`, add required reviewers to the `production` environment and set the `PRODUCTION_API_URL` repository variable (and optionally `API_WAIT_TIMEOUT_MINUTES`). Upgrade the API first, then the frontends, as in the [Release runbook](DEPLOYMENT.md#release-runbook).

## From v0.9.0 to v0.10.0 (Docker Compose and ONCE)

The database upgrades in place: the API's migration step applies everything on first boot, and re-running it is a no-op. This was rehearsed on copies of self-hosted and multi-tenant v0.9.0 databases with all row counts preserved.

It is **not** a drop-in image bump, though. Required environment variables, `docker-compose.prod.yml` and `nginx/nginx.conf` changed. Read the whole section before you start.

### What changes for users

- **Password sign-in still works, but is deprecated in 0.10.0 and will be removed in 0.11.0.** `auth.login` and `auth.register` stay in this release, stored password hashes are **not** erased, and v0.9.0 clients (web, mobile, CLI) keep working. Whenever either procedure is called the API logs a warning, `password sign-in is deprecated and will be removed in 0.11.0 (auth.login)` (or `auth.register`), at most once an hour per procedure per process, with no email or IP in it, so you can see whether anything still uses it. Plan to move your users to email magic-link sign-in (and desktop, mobile and the CLI to browser sign-in, see [Native app sign-in](DEPLOYMENT.md#native-app-sign-in)) before 0.11.0.
- **Installed v0.9.x mobile and desktop apps keep working (deprecated, removed in 0.11.0).** `LEGACY_V09_CLIENT_COMPAT` is on by default. It lets those apps keep requesting magic links when `TURNSTILE_SECRET_KEY` is set (they cannot solve a Turnstile challenge), keeps their bearer-token sign-in and email-link hand-back working, and is bounded: only for existing or invited addresses, at most 10 links per address per 24 hours. Creating a new account from a v0.9.x app on a Turnstile-enabled server no longer works; the user must update the app or sign up in the browser. Set `LEGACY_V09_CLIENT_COMPAT=false` once your users have updated. Details are in [DEPLOYMENT.md](DEPLOYMENT.md#upgrading-from-v09x).
- **Self-hosted sign-up is invite-only** once the first owner exists. Set `ALLOW_OPEN_SIGNUP=true` to keep open sign-up.
- **Document totals are validated.** Creating an invoice, quotation, credit/debit note, delivery challan, proforma or return now rejects inconsistent totals (discount above 100% or above subtotal + tax, an oversized round-off, a negative grand total). Integrations that send such totals will get a validation error.
- **Multi-tenant only: duplicate store slugs.** Storefront slugs move to a global registry. When two tenants used the same slug, the older tenant keeps it and the other storefront URL stops resolving. Tenant data is not touched.
- **New: notifications (backend).** Payments received or made, store orders, failed e-invoices, team changes, API key creation and due or overdue invoices are written to a `notification_outbox` table and delivered to a per-user inbox by an in-process dispatcher in the API. The inbox and preferences are available through the API, the CLI (`hisaabo notifications`) and the MCP server; there is no web or mobile inbox screen yet. Email copies of critical alerts need `RESEND_API_KEY`, and mobile push is off unless `PUSH_PROVIDER=gorush`. **Multi-tenant operators:** the dispatcher is off by default on a multi-tenant deployment; see `NOTIFICATIONS_WORKER` in the table below.
- **New: TDS on payment receipts** (web, CLI, MCP and the browser agent). Recording a customer payment can carry the TDS the customer withheld, which posts to a system **1600 TDS Receivable** account. The migration adds that account to every existing business that does not already have an account coded `1600`; if you created your own `1600`, receipts that carry TDS are rejected until you recode it (see [TDS architecture](architecture/tds.md)). Nothing else to configure.
- **New: background job worker and operator dashboard.** A `worker` service runs the job queue, and an optional operator dashboard at `/ops` (off unless `QUEUE_DASHBOARD_ENABLED=true`, protected by sign-in plus TOTP) shows it. Nothing in this release depends on the queue yet, so the API works without the worker. See [DEPLOYMENT.md](DEPLOYMENT.md) for enabling the dashboard.

### Before you start

1. **Back up every database** and copy the backups off the host:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec backup backup.sh
   ```

   Multi-tenant: make sure the control database and every tenant database are included. Backups are now encrypted with openssl (`.enc`). `restore-db.sh` still reads older `.age` files.

2. **Keep `ENCRYPTION_KEY` unchanged.** It must be the **same key** v0.9.0 used. It encrypts e-invoice IRP credentials, shipping-carrier credentials and, in multi-tenant mode, every tenant database password. Decryption fails closed, so a different key makes those fields unreadable (and, multi-tenant, locks the API out of every tenant database). Never generate a new key if one is already set; rotate only with `ENCRYPTION_KEY_PREVIOUS`. The expected format is 64 hex characters (32 bytes), and your existing key almost certainly already is, because v0.9.0 could not encrypt anything with any other format. If yours is not, do not replace it:
   - **Single-tenant:** this release still boots (it logs a warning) and nothing can have been encrypted under a malformed key, so you can set a valid one later without losing data.
   - **Multi-tenant (`MULTI_TENANT=true`):** this release refuses to start until the key is 64 hex characters.

   The legacy name `DB_ENCRYPTION_KEY` is still read by the encryption code when `ENCRYPTION_KEY` is unset, but startup validation in production and multi-tenant mode requires `ENCRYPTION_KEY` itself, so if you used the old name, set `ENCRYPTION_KEY` to the same value. If no key was set before, generate one:

   ```bash
   grep -E '^ENCRYPTION_KEY=[0-9a-fA-F]{64}$' .env.prod || echo "ENCRYPTION_KEY missing or not 64 hex"
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # only if none was set
   ```

3. **Check email delivery** (`RESEND_API_KEY`, `EMAIL_FROM`) if you use or plan to move to magic-link sign-in. Send yourself a magic link on the current install if you are not sure it works.

4. **Multi-tenant only: preview the store-slug registry.** Pull the new image and run the read-only dry run with it. It works before the `store_slugs` table exists:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml pull api
   docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm --no-deps \
     --entrypoint node api packages/db/dist/migrate.mjs --reconcile-store-slugs --dry-run
   ```

   The report lists duplicate slugs (winner and losers), invalid slugs and tenants that could not be read. Fix unreadable tenants first: the command exits with code 1 if any failed. Contact the losing accounts if their storefront matters. More detail is in [caching.md](architecture/caching.md#pre-upgrade-runbook-production).

5. **Multi-tenant only: check the control database connection.** `CONTROL_DATABASE_URL` must be a direct (or session-mode pooler) connection, because cache invalidation uses `LISTEN/NOTIFY`. Its role must be able to connect to and `ALTER` every tenant database, and should have `CREATE` on the control database: the migration step installs the `pgboss` job-queue schema there (if it cannot, it logs a warning and continues without the queue). On a self-hosted install, the `DATABASE_URL` role needs the same `CREATE` privilege. The bundled compose role already has it.

### Docker Compose upgrade

1. **Update `.env.prod`** (compare with `.env.prod.example`):

   | Variable | Why |
   |---|---|
   | `API_PUBLIC_URL` | **Recommended** in production, not required. Public `https://` origin of the API, used for absolute links (UPI pay links in PDFs, store share metadata and the og:image). If unset the API still starts and logs a warning: PDF payment links then use the request origin (as v0.9.0 did) and everything else falls back to `APP_URL`, then the first `CORS_ORIGINS` entry, which is wrong when the API and the web app are on different hosts. A value that is set but not a valid `http(s)` URL fails startup in production. |
   | `ENCRYPTION_KEY` | Unchanged from v0.9.0 (see above). Production refuses to start without it. |
   | `POSTGRES_PASSWORD` | Now mandatory; compose refuses to start without it. Keep the existing value. |
   | `ALLOW_OPEN_SIGNUP` | Set `true` to keep open sign-up on a self-hosted install. |
   | `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the API (default `1`). Use `0` if the API port is exposed directly. |
   | `API_BIND` | The API now publishes on `127.0.0.1` only. Set `0.0.0.0` if a proxy on another host reaches it, and firewall the port. |
   | `NOTIFICATIONS_WORKER` | Controls the in-process notification dispatcher. `true` = on, `false` = off (case-insensitive; any other value is ignored with a warning and the default applies). **Unset: on for single-tenant (self-hosted) installs, off when `MULTI_TENANT=true`.** A multi-tenant operator who wants notifications dispatched sets `NOTIFICATIONS_WORKER=true`; until then nothing is dispatched and events queue in `notification_outbox`. Once the dispatcher is enabled they are delivered, except events older than 72 hours, which are expired instead of delivered, so enable it before you need the notifications rather than after a long pause. With it on, a multi-tenant deployment scans **every** tenant database each `NOTIFICATIONS_FULL_SWEEP_SECONDS` (default 60, minimum 5), which can churn the tenant connection pool (`TENANT_POOL_MAX`, default 50) when there are many tenants: raise the interval for large installs. Self-hosted installs need nothing. |

2. **Replace `docker-compose.prod.yml`** with the new file and re-apply your local edits (image path, extra services). The new file:
   - adds a `worker` service (same image, `command: worker`);
   - adds an `api_storage` volume mounted at `/storage`;
   - runs the API read-only with all capabilities dropped. The image runs as the `node` user, so a bind mount you add must be writable by uid 1000;
   - logs to journald. On a host without systemd, switch each `logging:` block to `json-file` as described at the top of the file.

3. **Replace `nginx/nginx.conf`** if you use it. It was rewritten: new rate-limit zones, `X-Forwarded-For` set from `$remote_addr`, and routes for `/ops`, `/up`, `/webhooks` and `/pay/upi`. If another TLS proxy sits in front of nginx, add `set_real_ip_from` for it.

4. **Deploy:**

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml pull api worker
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api
   ```

   The API applies migrations before it starts listening. Look for `migrations applied successfully` and `job queue schema ready`. The worker starts once the API is healthy and logs `queue worker started`. The API works without the worker: nothing in this release depends on it yet.

   If the log instead shows a warning `job queue schema NOT installed`, the migration role could not create the `pgboss` schema (it needs `CREATE` on the database and a direct, non-pooled connection). The API starts normally; the worker keeps retrying and the `/ops` dashboard and `ops queue` commands report the queue as unavailable. Grant the privilege (`GRANT CREATE ON DATABASE <db> TO <role>;`) and restart the `api` container to install it.

   Migration `0016` (tenant `0006`) rebuilds indexes on `items` and the `bank_*` tables without `CONCURRENTLY`. Writes to those tables wait until the indexes are built, so upgrade at a quiet time.

5. **Multi-tenant only: reconcile again** after the deploy. Old replicas may have saved slugs after the boot backfill read them:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \
     node packages/db/dist/migrate.mjs --reconcile-store-slugs
   ```

6. **Verify:**
   - `curl http://127.0.0.1:3000/health` returns `ok`.
   - Sign in (magic link; password sign-in still works but is deprecated).
   - `docker compose ... logs api` shows `job queue schema ready`. If it shows a warning `job queue schema NOT installed`, the API still works; see step 4.
   - Open an existing invoice, and the e-invoice or shipping-carrier settings if you use them. Loading those settings proves `ENCRYPTION_KEY` still decrypts.

The image no longer ships npm or pnpm. Run maintenance commands with `node packages/...` as shown above.

### ONCE all-in-one image

ONCE runs the same migrations on boot. In addition, the first boot of the new image switches PostgreSQL from `trust` to `scram-sha-256`. It generates `/storage/secrets/pg_app_password` and saves the previous `pg_hba.conf` as `/storage/pgdata/pg_hba.conf.bak.<timestamp>` (see [ONCE all-in-one image](DEPLOYMENT.md#once-all-in-one-image)).

- Stop the old container before the new one starts. A v0.9.0 container still running against the same `/storage` loses database access as soon as the new one rewrites `pg_hba.conf`.
- The checks above still apply: same `ENCRYPTION_KEY`, `API_PUBLIC_URL` (recommended), and working email if you use magic-link sign-in.

### Rolling back

Rolling back to the v0.9.0 image does **not** need reverse SQL. The v0.9.0 migration step is a no-op on an upgraded database, and v0.9.0 code ignores the new tables, columns, triggers and the `pgboss` schema. This was rehearsed for self-hosted and multi-tenant installs. Only these do not come back by themselves:

- **ONCE PostgreSQL auth.** The v0.9.0 image connects without a password. Restore `/storage/pgdata/pg_hba.conf.bak.<timestamp>` over `pg_hba.conf` before starting it.
- **Compose and nginx files.** Restore your v0.9.0 copies. The v0.9.0 image does not have the `worker` command.

See [ROLLBACK.md](ROLLBACK.md) for backup restores and per-migration notes.
