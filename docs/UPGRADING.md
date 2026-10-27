# Upgrading Hisaabo

## From v0.9.0 to the next release (Docker Compose and ONCE)

The database upgrades in place: the API's migration step applies everything on first boot, and re-running it is a no-op. This was rehearsed on copies of self-hosted and multi-tenant v0.9.0 databases with all row counts preserved.

It is **not** a drop-in image bump, though. Sign-in, required environment variables, `docker-compose.prod.yml` and `nginx/nginx.conf` all changed. Read the whole section before you start.

### What changes for users

- **Password sign-in is gone.** `auth.login` and `auth.register` were removed from the API. Everyone signs in with an email magic link, and desktop, mobile and the CLI sign in through the browser (see [Native app sign-in](DEPLOYMENT.md#native-app-sign-in)).
- **Stored password hashes are erased** (migration `0019`, control `0007`). Restoring a backup is the only way to get them back.
- **Sign-in now depends on email.** Without a working `RESEND_API_KEY` nobody can start a new session. Existing sessions and `hisaabo_key_…` API keys keep working.
- **v0.9.0 clients break on password screens.** The v0.9.0 web app, mobile app and CLI (`hisaabo login`) call the removed procedures and get an error. Magic link in those clients still works. Ship the new web build and new app/CLI releases together with the API.
- **Self-hosted sign-up is invite-only** once the first owner exists. Set `ALLOW_OPEN_SIGNUP=true` to keep open sign-up.
- **Document totals are validated.** Creating an invoice, quotation, credit/debit note, delivery challan, proforma or return now rejects inconsistent totals (discount above 100% or above subtotal + tax, an oversized round-off, a negative grand total). Integrations that send such totals will get a validation error.
- **Multi-tenant only: duplicate store slugs.** Storefront slugs move to a global registry. When two tenants used the same slug, the older tenant keeps it and the other storefront URL stops resolving. Tenant data is not touched.

### Before you start

1. **Back up every database** and copy the backups off the host:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec backup backup.sh
   ```

   Multi-tenant: make sure the control database and every tenant database are included. Backups are now encrypted with openssl (`.enc`). `restore-db.sh` still reads older `.age` files.

2. **Check `ENCRYPTION_KEY`.** It must be exactly 64 hex characters, and it must be the **same key** v0.9.0 used. Decryption now fails closed, so a different key makes encrypted fields (e-invoice IRP credentials, shipping-carrier credentials) unreadable. Do not generate a new key if one is already set. If the current value is not hex, stop and open an issue before upgrading: data encrypted under it would be lost with a new key. If no key was set before, generate one:

   ```bash
   grep -E '^ENCRYPTION_KEY=[0-9a-fA-F]{64}$' .env.prod || echo "ENCRYPTION_KEY missing or not 64 hex"
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # only if none was set
   ```

3. **Check email delivery** (`RESEND_API_KEY`, `EMAIL_FROM`). Send yourself a magic link on the current install if you are not sure it works.

4. **Multi-tenant only: preview the store-slug registry.** Pull the new image and run the read-only dry run with it. It works before the `store_slugs` table exists:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml pull api
   docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm --no-deps \
     --entrypoint node api packages/db/dist/migrate.mjs --reconcile-store-slugs --dry-run
   ```

   The report lists duplicate slugs (winner and losers), invalid slugs and tenants that could not be read. Fix unreadable tenants first: the command exits with code 1 if any failed. Contact the losing accounts if their storefront matters. More detail is in [caching.md](architecture/caching.md#pre-upgrade-runbook-production).

5. **Multi-tenant only: check the control database connection.** `CONTROL_DATABASE_URL` must be a direct (or session-mode pooler) connection, because cache invalidation uses `LISTEN/NOTIFY`. Its role must be able to connect to and `ALTER` every tenant database, and must have `CREATE` on the control database: the migration step installs the `pgboss` job-queue schema there. On a self-hosted install, the `DATABASE_URL` role needs the same `CREATE` privilege. The bundled compose role already has it.

### Docker Compose upgrade

1. **Update `.env.prod`** (compare with `.env.prod.example`):

   | Variable | Why |
   |---|---|
   | `API_PUBLIC_URL` | Now required in production; the API refuses to start without it. Public `https://` origin of the API. |
   | `ENCRYPTION_KEY` | 64 hex characters, unchanged from v0.9.0 (see above). Production also refuses to start with no signing secret at all. |
   | `POSTGRES_PASSWORD` | Now mandatory; compose refuses to start without it. Keep the existing value. |
   | `ALLOW_OPEN_SIGNUP` | Set `true` to keep open sign-up on a self-hosted install. |
   | `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the API (default `1`). Use `0` if the API port is exposed directly. |
   | `API_BIND` | The API now publishes on `127.0.0.1` only. Set `0.0.0.0` if a proxy on another host reaches it, and firewall the port. |

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

   Migration `0016` (tenant `0006`) rebuilds indexes on `items` and the `bank_*` tables without `CONCURRENTLY`. Writes to those tables wait until the indexes are built, so upgrade at a quiet time.

5. **Multi-tenant only: reconcile again** after the deploy. Old replicas may have saved slugs after the boot backfill read them:

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \
     node packages/db/dist/migrate.mjs --reconcile-store-slugs
   ```

6. **Verify:**
   - `curl http://127.0.0.1:3000/health` returns `ok`.
   - Request a magic link and sign in.
   - Open an existing invoice, and the e-invoice or shipping-carrier settings if you use them. Loading those settings proves `ENCRYPTION_KEY` still decrypts.

The image no longer ships npm or pnpm. Run maintenance commands with `node packages/...` as shown above.

### ONCE all-in-one image

ONCE runs the same migrations on boot. In addition, the first boot of the new image switches PostgreSQL from `trust` to `scram-sha-256`. It generates `/storage/secrets/pg_app_password` and saves the previous `pg_hba.conf` as `/storage/pgdata/pg_hba.conf.bak.<timestamp>` (see [ONCE all-in-one image](DEPLOYMENT.md#once-all-in-one-image)).

- Stop the old container before the new one starts. A v0.9.0 container still running against the same `/storage` loses database access as soon as the new one rewrites `pg_hba.conf`.
- The checks above still apply: same `ENCRYPTION_KEY`, working email, and `API_PUBLIC_URL`.

### Rolling back

Rolling back to the v0.9.0 image does **not** need reverse SQL. The v0.9.0 migration step is a no-op on an upgraded database, and v0.9.0 code ignores the new tables, columns, triggers and the `pgboss` schema. This was rehearsed for self-hosted and multi-tenant installs. Only these do not come back by themselves:

- **Password hashes.** Restore the pre-upgrade backup if users need password sign-in again. Restoring loses everything written since the upgrade.
- **ONCE PostgreSQL auth.** The v0.9.0 image connects without a password. Restore `/storage/pgdata/pg_hba.conf.bak.<timestamp>` over `pg_hba.conf` before starting it.
- **Compose and nginx files.** Restore your v0.9.0 copies. The v0.9.0 image does not have the `worker` command.

See [ROLLBACK.md](ROLLBACK.md) for backup restores and per-migration notes.
