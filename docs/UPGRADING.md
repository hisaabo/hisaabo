# Upgrading Hisaabo

## From v0.10.0 to v0.10.1 (Docker Compose and ONCE)

A patch release. It is a drop-in image bump (no new environment variables, no schema migration, nothing to change in `docker-compose.prod.yml`): pull the new image, restart, and the API's migration step does the rest. Self-hosted single-organisation installs are only affected by the business-visibility fix below. **Multi-tenant (`MULTI_TENANT=true`) operators should read the whole section**, because the migration step changes who may connect to each tenant database.

### What changes

- **Multi-tenant: new tenant databases get random names.** Until now a tenant's database and role were named from its slug (`tenant_<slug, lowercased, cut to 40 characters>`). When two sign-ups had the same long name (a slug base of 34 characters or more loses its random suffix after the cut) they were assigned the same database name, and the second sign-up failed on `CREATE DATABASE`. Tenants created from 0.10.1 on get `t_<32 random hex characters>` for the database and `t_<same hex>_u` for the role (34 and 36 characters, inside Postgres' 63-byte identifier limit). The slug shown in URLs and the UI is unchanged. **Existing tenants keep their `tenant_<slug>` names**: the API, the migration step, the admin dashboard and `rotate-key` always read the names from `tenants.db_name` and `tenants.db_user`, never derive them from a slug, and nothing is renamed. Anything of yours that guesses a tenant database from its slug (a script, a dashboard) must read `tenants.db_name` instead; with the new names it cannot work.
- **Multi-tenant: tenant databases are closed to other roles.** `CREATE DATABASE` grants `CONNECT` and `TEMPORARY` on the new database to `PUBLIC`, i.e. to every role in the cluster, so any tenant's database role could open a session on every other tenant's database (row data was still protected by table privileges, but the door should not be open). From 0.10.1 provisioning grants `CONNECT` and `TEMPORARY` to the tenant's own role and revokes them from `PUBLIC`.
- **Multi-tenant: the migration step applies this to every existing tenant database.** After the control and tenant migrations, every API start (and so every deploy) runs one idempotent pass over each database listed in `tenants`: `GRANT CONNECT, TEMPORARY` to the tenant's own role, then `REVOKE CONNECT, TEMPORARY ... FROM PUBLIC`, in one statement per database. The first pass after the upgrade closes the databases you already have; later passes change nothing (and also close a database that an older replica provisioned during a rolling deploy). It never fails startup: per-database errors are logged and counted. Look for this line in the API log:

  ```
  Tenant database access: closed to PUBLIC  {"total":228,"restricted":228,"missing":0,"skipped":0,"failed":0}
  ```

  `missing` counts tenants whose database no longer exists, `skipped` counts rows without a `db_user`, and `failed` counts databases that could not be changed (the log has one `could not restrict database` error per tenant with the reason, usually the control role not owning that database). To run the pass on its own, without migrations, and get exit code 1 if any database failed:

  ```bash
  docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \
    node packages/db/dist/migrate.mjs --restrict-tenant-db-access
  ```

- **Multi-tenant and self-hosted: a business created by a since-removed admin is visible again.** Hisaabo hid a business from its organisation when the member who created it was removed from the organisation (an owner can remove an admin who created a business). The business disappeared from the list for everyone, requests for it were refused with "Business not found", and its background jobs failed. That check only exists to separate organisations that share one database, so it now applies only to a **self-hosted install with more than one organisation**. On the multi-tenant cloud (a database per tenant) and on a normal single-organisation self-hosted install, businesses created by a removed member reappear after the upgrade and stay accessible to the remaining members. A self-hosted database that holds more than one organisation (rare: an install that was converted by hand) keeps the old behaviour until 0.11.0 adds `businesses.tenant_id`, and logs a warning at start.
- **A free or pro plan can no longer be pushed past its business limit by concurrent requests.** Creating several businesses at the same moment on a plan that allows one could create all of them. The limit check and the insert now run in one transaction under a lock. No action needed.

### If you connect to tenant databases with a role other than the control role

Who keeps access after the pass: the **tenant's own role** (explicitly), the **role that owns the database** (the role in `CONTROL_DATABASE_URL`, which ran `CREATE DATABASE`: `POSTGRES_USER` in the bundled compose file) and **superusers**. The API, the migration step, the admin dashboard (`admin`), `ops`, `rotate-key`, `scripts/backup.sh` (it connects as `DB_USER`, which defaults to `POSTGRES_USER`) and the restore sidecar all use one of those, so nothing in the stock deployment needs a change.

If you added **another role** that connects to tenant databases (a read-only BI role, a monitoring or backup role, a pooler's auth role, an engineer's personal login), that role loses access to every tenant database on the first pass, until it is granted explicitly. Typical symptom: `FATAL: permission denied for database "tenant_acme"` / `User does not have CONNECT privilege`. Grant it per database, run on the control database:

```sql
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', db_name, 'bi_reader')
FROM tenants WHERE db_name IS NOT NULL \gexec
```

Explicit grants to a role survive every later pass (only `PUBLIC` is revoked). Postgres has no default privileges for databases, so a tenant created later needs the same grant: re-run the statement after new sign-ups, or from a periodic job. Do not work around this by granting `CONNECT` to `PUBLIC` again; the next pass would revoke it. Table privileges inside a tenant database are unchanged.

To check a database by hand: `SELECT datname, datacl FROM pg_database WHERE datname LIKE 'tenant\_%' OR datname LIKE 't\_%';`. A closed database lists only its owner and its own role (for example `{hisaabo=CTc/hisaabo,tenant_acme_user=CTc/hisaabo}`), with no `=Tc/...` entry (the empty grantee is `PUBLIC`). The control database and the `postgres` maintenance database are not touched by this release and remain connectable by `PUBLIC`.

After you restore a single tenant database from a backup (see [ROLLBACK.md](ROLLBACK.md)), the restored database has the default privileges again: restart the `api` container, or run the command above, to close it.

### Before you start

1. **Back up the control database and every tenant database** (`backup.sh`, see the 0.10.0 section below).
2. **Multi-tenant only:** list the roles other than the control role that connect to tenant databases (`SELECT usename, datname FROM pg_stat_activity WHERE datname IS NOT NULL GROUP BY 1, 2;` while they are connected, and your own scripts and dashboards) and decide which need a `GRANT CONNECT` after the upgrade.

### Upgrade

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull api worker
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api
```

ONCE: pull the new image and restart it as usual; it runs the same migration step.

Verify:

- `curl http://127.0.0.1:3000/health` returns `ok`.
- Multi-tenant: the log shows `Tenant database access: closed to PUBLIC` with `failed: 0`. Spot-check from the host: connect as one tenant's role to another tenant's database and expect `permission denied for database`.
- Multi-tenant: sign in as a user whose organisation has a business, and open an invoice (it proves the tenant role still connects to its own database).
- Create an organisation with a long name in a multi-tenant deployment; its row in `tenants` has a `t_...` `db_name`.

### Rolling back

Rolling back to the 0.10.0 image needs no reverse SQL and no data change. Tenant roles keep `CONNECT` on their own database, so 0.10.0 works with the closed databases, and it reads the new `t_...` names from `tenants.db_name`. The one thing 0.10.0 lacks is the protection itself: it provisions new tenants with `CONNECT` open to `PUBLIC` again, and its migration step does not close them (upgrade again, or run `migrate.mjs --restrict-tenant-db-access` from a 0.10.1 image). The sign-up collision for long names also returns on 0.10.0.

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
