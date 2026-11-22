# Upgrading Hisaabo

## From v0.10.0 to v0.10.1 (Docker Compose and ONCE)

A bug-fix release. Take the usual backup, then **upgrade the API first**: set `HISAABO_API_IMAGE` to `v0.10.1`, then `pull api` and `up -d api` as in [Upgrading a pinned install](DEPLOYMENT.md#upgrading-a-pinned-install). The migration step applies the small additive migrations listed below on first boot. Then upgrade the web app and the store. There are **no breaking API changes**: every procedure keeps its name and its success response shape, and 0.10.0 web, desktop, mobile, CLI and MCP clients keep working against a 0.10.1 API. Multi-tenant operators should read the connection-pool sizing below.

**Action needed** (each item says who it concerns; nothing else has to be done):

1. **If you use e-invoicing: configure the NIC public key** (`IRP_PUBLIC_KEY_PATH` / `IRP_PUBLIC_KEY_PEM`, and the `IRP_SANDBOX_*` pair for sandbox mode). Until you do, generating, retrying and cancelling an e-invoice are refused. See [E-invoicing never signed in to the IRP](#e-invoicing-never-signed-in-to-the-irp).
2. **Review the GST returns you have already filed.** Past periods are recomputed with corrected rules; run the per-month query to find the months that change. See [What to do after upgrading](#what-to-do-after-upgrading), step 1.
3. **Review supplier and customer opening balances** with the review query: the meaning of a positive supplier balance changed. Run it again after your users' mobile and desktop apps update. See step 5 of the same list.
4. **Multi-tenant: size the tenant connection pools** (`TENANT_POOL_MAX`, `TENANT_POOL_PER_DB_MAX`, `TENANT_POOL_DRAINING_MAX`) for your `max_connections`. See [Multi-tenant: size the tenant connection pools](#multi-tenant-size-the-tenant-connection-pools).

### For operators

- **Postgres `max_connections` is now 200 in `docker-compose.prod.yml`** (it was the Postgres default, 100). Override it with `POSTGRES_MAX_CONNECTIONS` in `.env.prod`. It takes effect when the `postgres` container restarts, a few seconds of downtime, so do it in the same window as the API upgrade: `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres`. Check it with `docker compose exec postgres psql -U hisaabo -Atc 'show max_connections'`. Postgres reserves about 10 MB of RAM per 100 extra connections.
- **New: `GET /api/version`.** It returns `{"version":"0.10.1"}`: the running version only, public, uncacheable, no database access. Use it to confirm which release a server runs (`curl https://<your-api-host>/api/version`); an API older than 0.10.1 answers 404. Set `EXPOSE_VERSION=false` if you do not want the exact version readable by the public (the endpoint then answers 404; it is on by default). The bundled `nginx/nginx.conf` already forwards it (`location /api/`). If you front the API with your own proxy rules, keep `/api/version` reachable. `/health` still does not report a version.
- **Release order is now enforced for the maintainers' deployment.** The release workflow no longer deploys the web app and the store before the API: it waits until the production API reports the new version, then a required reviewer approves the frontend deploys. If you run your own copy of `release.yml`, add required reviewers to the `production` environment and set the `PRODUCTION_API_URL` repository variable (and optionally `API_WAIT_TIMEOUT_MINUTES`). Upgrade the API first, then the frontends, as in the [Release runbook](DEPLOYMENT.md#release-runbook).
- **Multi-tenant: new tenant databases get random names.** Until now a tenant's database and role were named from its slug (`tenant_<slug, lowercased, cut to 40 characters>`). When two sign-ups had the same long name (a slug base of 34 characters or more loses its random suffix after the cut) they were assigned the same database name, and the second sign-up failed on `CREATE DATABASE`. Tenants created from 0.10.1 on get `t_<32 random hex characters>` for the database and `t_<same hex>_u` for the role (34 and 36 characters, inside Postgres' 63-byte identifier limit). The slug shown in URLs and the UI is unchanged. **Existing tenants keep their `tenant_<slug>` names**: the API, the migration step, the admin dashboard and `rotate-key` always read the names from `tenants.db_name` and `tenants.db_user`, never derive them from a slug, and nothing is renamed. Anything of yours that guesses a tenant database from its slug (a script, a dashboard) must read `tenants.db_name` instead; with the new names it cannot work.
- **Multi-tenant: tenant databases are closed to other roles.** `CREATE DATABASE` grants `CONNECT` and `TEMPORARY` on the new database to `PUBLIC`, i.e. to every role in the cluster, so any tenant's database role could open a session on every other tenant's database (row data was still protected by table privileges, but the door should not be open). From 0.10.1 provisioning grants `CONNECT` and `TEMPORARY` to the tenant's own role and revokes them from `PUBLIC`.
- **Multi-tenant: the migration step applies this to every existing tenant database.** After the control and tenant migrations, every API start (and so every deploy) runs one idempotent pass over each database listed in `tenants`: `GRANT CONNECT, TEMPORARY` to the tenant's own role, then `REVOKE CONNECT, TEMPORARY ... FROM PUBLIC`, in one statement per database. The first pass after the upgrade closes the databases you already have; later passes change nothing (and also close a database that an older replica provisioned during a rolling deploy). It never fails startup: per-database errors are logged and counted. Look for this line in the API log:

  ```
  Tenant database access: closed to PUBLIC  {"total":228,"restricted":228,"missing":0,"skipped":0,"failed":0}
  ```

  `restricted` counts only databases **verified in the catalog** afterwards: the tenant role can connect and `PUBLIC` holds nothing. `missing` counts tenants whose database no longer exists, `skipped` counts rows without a `db_user`, and `failed` counts databases that could not be changed or where the change had no effect (the log has one `could not restrict database` error per tenant with the reason). The usual cause is a control role that neither owns the database nor is a superuser: Postgres then only prints a warning ("no privileges could be revoked") and reports success while leaving the database open, which the pass detects and reports as `failed` ("PUBLIC can still connect ..."). Run the preflight query below before upgrading to find those databases. When several API instances start together, one runs the pass and the others log `Tenant database access: skipped, another instance is running the same pass` instead of waiting for it, so the pass never delays startup. To run the pass on its own, without migrations, and get exit code 1 if any database failed (or if another instance held the lock):

  ```bash
  docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \
    node packages/db/dist/migrate.mjs --restrict-tenant-db-access
  ```

- **New: `WEBMCP_DISABLED`, a kill switch for browser AI agents (WebMCP, experimental, web only).** `true` stops the web app offering Hisaabo to anyone's browser agent on this server, and the API then refuses requests marked `X-Hisaabo-Agent: webmcp` with 403. It does not affect the MCP server or the CLI. It is also reported by `system.config` (`webmcpDisabled`). See [DEPLOYMENT.md](DEPLOYMENT.md#backend-docker--ghcr). Browser agent calls are capped at 120 per minute per address on top of the ordinary per-address limit (they are charged against both, so the marker never raises the total) and send `X-Hisaabo-Agent: webmcp`, which is in the credentialed CORS allow-list; if a reverse proxy in front of the API restricts custom request headers, allow `X-Hisaabo-Agent`.

### Migrations

Three additive schema migrations for the browser agent (WebMCP) hardening, plus a re-install of the cache-invalidation triggers, applied by the same migration step (the ledger and recurring-invoice fixes ship their own, listed below). All are expand-only, and old code ignores them, so rolling back needs no reverse SQL.

| Mode | Directory | Migration | What it adds |
|---|---|---|---|
| Self-hosted (unified) | `packages/db/drizzle` | `0025_webmcp_audit_source`, `0026_idempotency_keys`, `0027_tenant_webmcp_disabled`, `0028_webmcp_cache_invalidation_triggers` | the three below, plus the trigger re-install |
| Multi-tenant, each tenant database | `packages/db/drizzle-tenant` | `0012_webmcp_audit_source`, `0013_idempotency_keys` | the audit column and the idempotency table |
| Multi-tenant, control database | `packages/db/drizzle-control` | `0009_tenant_webmcp_disabled`, `0010_webmcp_cache_invalidation_triggers` | the organization switch, plus the trigger re-install |

- `audit_log.source` (nullable text): where a change came from when it was not a person at the UI. `webmcp` for a browser AI agent, `mcp` for the MCP server (it already sent `x-client-type: mcp`), null for everything else, including every existing row. The web Activity Log labels these entries. It is attribution, not authorisation. Mobile and the CLI are unaffected (the extra field is ignored; the CLI's `--json` output now includes it), and self-export files written before the column existed still validate.
- `idempotency_keys`: a small table behind a new optional `idempotencyKey` input on `invoice.create` and `payment.create`. Idempotency is strictly opt-in: clients that do not send a key behave exactly as before, and nothing derives a key. Repeating the identical request with the same key within 15 minutes creates nothing and answers with the live record flagged `idempotentReplay: true` (a keyed call that did create the record is flagged `false`; a deleted record is a `CONFLICT`). The table keeps only the record id and a hash of the request, never a copy of the response, and expired rows are purged by the next keyed write and by an hourly sweep.
- `tenants.webmcp_disabled` (boolean, default false): the organization owner's switch for browser AI agents, read through `auth.me` and enforced by the API for agent-marked calls (FORBIDDEN). It rides in the cached membership entry, so the `hisaabo_cache_tenants` cache-invalidation trigger now also fires on changes to this column: the `*_webmcp_cache_invalidation_triggers` migrations re-install the (idempotent) cache triggers with the new column list; nothing else about them changes.

The recurring-invoice and ledger fixes add two more additive migrations of their own, applied automatically by the same migration step: `recurring_run_occurrence` (`drizzle-tenant/0010`; `drizzle/0023` on self-hosted) and `ledger_adjustment_accounts` (`drizzle-tenant/0011`; `drizzle/0024`), which is data-only and described under [Corrected accounting and GST figures](#corrected-accounting-and-gst-figures). `recurring_run_occurrence` adds a nullable column `recurring_invoice_runs.scheduled_for` and a **partial** unique index `recurring_run_occurrence_uniq` on `(template_id, scheduled_for)` for successful and plan-limit-skipped runs that have a `scheduled_for`.

- **Existing rows are not touched, and existing duplicates cannot make it fail.** The old scheduler could, rarely, leave two `success` runs for one occurrence. Those rows keep `scheduled_for = NULL`, the index ignores rows without it, and nothing is deleted or rewritten; only runs created from now on are constrained. (The release was checked against a database with duplicate runs already in it.)
- It is quick and safe on a live system: adding a nullable column is a catalog change, and the index is built over a small table. Multi-tenant: it runs once per tenant database during the migration step, like any tenant migration.
- Old code ignores the column and the index, so rolling the image back to 0.10.0 needs no reverse SQL (see [ROLLBACK.md](ROLLBACK.md)).

To look for double-generated invoices from before the fix, run this read-only query in each database (each tenant database when multi-tenant). A template that was behind by several periods also shows up, because catch-up legitimately creates one invoice per missed period in a single tick, so compare the invoices and the template's frequency before acting. Nothing needs doing unless one period was billed twice; if it was, cancel the extra invoice the normal way.

```sql
SELECT r.template_id, t.name, r.business_id, count(*) AS runs,
       min(r.executed_at) AS first_at, array_agg(r.invoice_id) AS invoices
FROM recurring_invoice_runs r
JOIN recurring_invoice_templates t ON t.id = r.template_id
WHERE r.status = 'success'
GROUP BY r.template_id, t.name, r.business_id, date_trunc('minute', r.executed_at)
HAVING count(*) > 1
ORDER BY first_at DESC;
```

### Multi-tenant: size the tenant connection pools

The defaults (`TENANT_POOL_MAX=50`, `TENANT_POOL_PER_DB_MAX=5`, and the new `TENANT_POOL_DRAINING_MAX`, which defaults to `TENANT_POOL_MAX`) allow one API process up to `(50 + 50) x 5 = 500` tenant connections, far above Postgres' default `max_connections` of 100. Idle pools hold no connections, so a quiet system never gets near that, but a busy period can. **Never raise `TENANT_POOL_MAX` alone**: the bound is `(TENANT_POOL_MAX + TENANT_POOL_DRAINING_MAX) x TENANT_POOL_PER_DB_MAX`.

For about 230 tenants on `max_connections = 100` (one API process and one worker), set:

```
TENANT_POOL_MAX=10
TENANT_POOL_PER_DB_MAX=2
```

That bounds tenant connections at `(10 + 10) x 2 = 40`. Add about 15 for the API's control, queue and cache connections, about 25 for the worker (conservative: today the worker only runs the system ping job), about 5 for background tenant visits, about 10 for operators and 3 reserved by Postgres, and you are at about 98. It is tight: a second API replica does not fit until `max_connections` is raised. On a server with `max_connections = 300`, `TENANT_POOL_MAX=50` with `TENANT_POOL_PER_DB_MAX=2` (bound 200) keeps most active tenants cached. Keep `TENANT_POOL_PER_DB_MAX` at 2 or more, and add every replica and worker when you add things up. The full budget, and what to do when the API logs `[tenant-pool] ... ended the oldest`, is in [DEPLOYMENT.md](DEPLOYMENT.md#tenant-connection-budget-multi-tenant).

How eviction behaves: an evicted pool is not closed, so a request still using it is not affected, and its connections close by themselves after 20 idle seconds. At most `TENANT_POOL_DRAINING_MAX` evicted pools are allowed to drain at once; beyond that the oldest is closed after its running queries finish (up to 30 seconds). Only in such a storm, where more pools are evicted inside 20 seconds than the cap allows, can a request that holds the closed pool fail with `CONNECTION_ENDED`, and only if it starts a new query or transaction after that. To check connections during a busy period, run `SELECT datname, application_name, count(*) FROM pg_stat_activity GROUP BY 1, 2 ORDER BY 3 DESC;`.

### Before you start (multi-tenant)

1. **Back up the control database and every tenant database** (`backup.sh`, see the 0.10.0 section below).
2. **Multi-tenant only: preflight the control role.** The pass can only change databases that the `CONTROL_DATABASE_URL` role owns (or acts as the owner of through role membership), or that it can change as a superuser. Connected as that role to the **control database**, this catalog-only query must return no rows:

   ```sql
   SELECT t.slug, t.db_name, pg_get_userbyid(d.datdba) AS owner
   FROM tenants t
   JOIN pg_database d ON d.datname = t.db_name
   WHERE NOT pg_has_role(current_user, d.datdba, 'USAGE');
   ```

   Every row is a tenant database the pass will report as `failed`. Fix it with `ALTER DATABASE "<db_name>" OWNER TO <control role>;` (as the current owner or a superuser) or run the control role as a superuser. It only sees databases on the control database's server; tenants with another `db_host` need the same check there.
3. **Multi-tenant only: check that no two tenants share a database.** Each row of `tenants` must point at its own database. Two rows with the same host, port and database name would share data, and the access pass would treat them as one. On the control database this query must return no rows:

   ```sql
   SELECT coalesce(db_host, 'localhost') AS db_host, coalesce(db_port, '5432') AS db_port, db_name,
          count(*) AS tenants, array_agg(slug ORDER BY slug) AS slugs
   FROM tenants
   WHERE db_name IS NOT NULL
   GROUP BY 1, 2, 3
   HAVING count(*) > 1;
   ```

   Provisioning always gives a tenant a database of its own, so a row here means a hand-edited or restored `tenants` table: fix it before upgrading (point each row at its own database, or remove the duplicate). A unique index on `(db_host, db_port, db_name)` is planned for 0.11.0; until then nothing in the database prevents it.
4. **Multi-tenant only:** list the roles other than the control role that connect to tenant databases (`SELECT usename, datname FROM pg_stat_activity WHERE datname IS NOT NULL GROUP BY 1, 2;` while they are connected, and your own scripts and dashboards) and decide which need a `GRANT CONNECT` after the upgrade.

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

### Upgrade

Take the usual backup first (the `backup.sh` command is under "Before you start" in the 0.10.0 section below), then pull and restart as described in [DEPLOYMENT.md](DEPLOYMENT.md#updating). No existing environment variable changes meaning. 0.10.1 adds these, all documented in [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables) and `.env.prod.example`:

- `EXPOSE_VERSION` (optional): `false` hides `GET /api/version`. Default on.
- `WEBMCP_DISABLED` (optional): `true` switches browser AI agents (WebMCP) off for everyone on this server. Default off.
- `TENANT_POOL_MAX`, `TENANT_POOL_PER_DB_MAX` and `TENANT_POOL_DRAINING_MAX` (**recommended for multi-tenant**; ignored otherwise): the defaults allow up to 500 tenant connections per API process, so size them for your `max_connections` (see [Multi-tenant: size the tenant connection pools](#multi-tenant-size-the-tenant-connection-pools)). `TENANT_POOL_DRAINING_MAX` is new in 0.10.1.
- `IRP_PUBLIC_KEY_PEM` / `IRP_PUBLIC_KEY_PATH` and `IRP_SANDBOX_PUBLIC_KEY_PEM` / `IRP_SANDBOX_PUBLIC_KEY_PATH` (**required for e-invoicing**, not otherwise): the NIC public key for each mode you use. 0.10.1 no longer bundles one.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull api worker
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api
```

ONCE: pull the new image and restart it as usual; it runs the same migration step.

Verify:

- `curl http://127.0.0.1:3000/health` returns `ok`.
- `curl https://<your-api-host>/api/version` returns `{"version":"0.10.1"}` (404 means the API is still older than 0.10.1, or you set `EXPOSE_VERSION=false`).
- E-invoicing only: in the app, **E-Invoicing, Settings, Test Connection** succeeds. It names the step that failed (the public key, the network or the sign-in).
- Multi-tenant: the log shows `Tenant database access: closed to PUBLIC` with `failed: 0`. Spot-check from the host: connect as one tenant's role to another tenant's database and expect `permission denied for database`.
- Multi-tenant: sign in as a user whose organisation has a business, and open an invoice (it proves the tenant role still connects to its own database).
- Create an organisation with a long name in a multi-tenant deployment; its row in `tenants` has a `t_...` `db_name`.

### Rolling back

Rolling back to the 0.10.0 image needs no reverse SQL and no data change. Tenant roles keep `CONNECT` on their own database, so 0.10.0 works with the closed databases, and it reads the new `t_...` names from `tenants.db_name`. The one thing 0.10.0 lacks is the protection itself: it provisions new tenants with `CONNECT` open to `PUBLIC` again, and its migration step does not close them (upgrade again, or run `migrate.mjs --restrict-tenant-db-access` from a 0.10.1 image). The sign-up collision for long names also returns on 0.10.0.

### What is fixed (reliability)

- **Multi-tenant: intermittent `CONNECTION_ENDED` errors.** The API keeps a cache of tenant database pools (`TENANT_POOL_MAX`, default 50). When the cache was full, serving another tenant evicted the least recently used pool and **closed** it, even while a request that had already taken that pool was still working. That request's next query, or its next transaction, failed with `write CONNECTION_ENDED`. With more tenants than pool slots (for example 229 tenants), and the recurring-invoice scheduler walking every tenant each minute, this was easy to hit. An evicted pool is now just dropped from the cache: requests holding it finish normally, and its connections close by themselves after 20 idle seconds.
- **Multi-tenant: background loops over every tenant no longer use the shared pool cache.** The recurring-invoice scheduler, the notification dispatcher and collections sweep, the legacy store-slug scan, the shipping-webhook owner lookup and the `rotate-key` / `encrypt-sensitive-fields` tools visit each tenant with their own single-connection client and close it afterwards, so a sweep no longer evicts the pools live requests are using. Self-hosted (single-tenant) installs behave as before.
- **A recurring template that cannot generate no longer writes a `failed` run every minute.** The failure is recorded once per distinct error for that occurrence; the template stays due and is retried quietly.
- **Recurring invoices could be generated twice when more than one API replica was running.** The row lock that was meant to prevent it was released before the invoice was generated. Each occurrence is now claimed and generated in one transaction under the template's row lock, and a unique index on the occurrence rejects a second run as a backstop. "Run now" clicked twice quickly now creates two successive invoices (two occurrences) instead of racing for the same one.
- **E-invoice submission after invoice creation** takes its own tenant database handle when it runs, instead of reusing the request's, which could already be gone.

### What changes for users

- **Browser AI agents (WebMCP, experimental, web only) are off for everyone after the upgrade.** The setting used to be one flag per browser; it is now per person and organization, and the old flag is deleted, never honoured. Anyone who had turned it on must turn it on again in Settings → Account. The organization owner can turn it off for the whole organization (Settings → Account), and the desktop app never registers browser-agent tools. Writes now show the business, the people and amounts involved and what will change; several queued prompts show **N pending** and **Deny all**; and an agent is limited to 20 approved writes per session and 10 per minute. `invoice_update_status` in the browser no longer accepts `cancelled`, so an agent cannot void an invoice (the MCP tool is unchanged). `system.config` and `auth.me` gain a `webmcpDisabled` field; both are additive. Details: [Browser AI Agents](https://docs.hisaabo.in/ai/webmcp/).
- **Import wizard: Tally and Generic CSV are gone.** The wizard listed them, but the server only has `mybillbook` and `hisaabo` import adapters, so every import from the other two failed on its first batch with "Unknown import source". The wizard now offers myBillBook only. Nothing that worked is removed; there was never a Tally importer. To bring in Tally, Busy or spreadsheet data, convert it to the Hisaabo CSV layout and use `hisaabo import` (see [Import Data](https://docs.hisaabo.in/getting-started/import-data/)). An unregistered `source` sent to the API now returns `BAD_REQUEST` listing the supported sources (it used to be a 500).
- **MCP import tools default to `source: "hisaabo"`** (they defaulted to `"excel"`, which the server rejected, so calls that did not set `source` failed). Agents that pass `source` explicitly are unaffected.
- **Bank reconciliation can skip duplicate statement lines (web: on by default; API: opt-in).** When asked to, confirming a column mapping leaves out any line that is already on file in another import of the same bank account (same day, debit, credit and reference number, or the same narration when there is no reference). Overlapping statements and re-uploaded files no longer double up. The 0.10.1 web app has a **Skip lines already imported from an earlier statement** checkbox on the mapping step, ticked by default, and always sends the choice. The API input `skipDuplicates` defaults to **`false`**, so a 0.10.0 web or desktop client talking to a 0.10.1 API (which never sends the flag) imports every line exactly as before; nothing is dropped unless the client asks. The result carries `duplicatesSkipped` and a `duplicates` list (up to 500 lines: file position, date, amounts, narration, and the earlier import that holds each one), and the review screen shows the count with an expandable list of what was skipped, so nothing disappears unseen. `totalLines` in the result and on the import counts the lines actually imported. Imports made before this release are not changed, and they count as "already on file" for later statements. If two statements legitimately contain identical lines with no reference, untick the checkbox (or send `skipDuplicates: false`) for that upload.
- **Journal entries are never deleted.** `journal.delete` used to remove an entry and its lines with no trace. It now voids the entry, exactly like `journal.void`: a reversing entry is posted, the original is flagged voided, and both stay in the books, reports and Tally export (netting to zero). The response is still `{ success: true }` with extra fields (`voided`, `alreadyVoided`, `reversingEntryNumber`, ...). Calling it on an already voided entry is a no-op. **Both `journal.delete` and `journal.void` now refuse a reversal entry** (the entry a previous void posted) with `BAD_REQUEST`: before, `journal.void` would reverse it, which reinstated the original's effect in the ledger while the original stayed flagged voided. To correct a wrong void, post a new journal entry. **`journal.update` also refuses a reversal entry** (`BAD_REQUEST`, "post a new journal entry to correct it"), because editing it would break the pair's netting to zero. `journal.update` now checks that the entry is not voided under a row lock inside its transaction, so an edit racing a void can no longer rewrite the lines of an entry that was just reversed (the edit is refused instead). Every void, from `journal.void` or `journal.delete`, is now recorded in the audit log as `journal.void`, written in the same transaction as the void itself: the record cannot be missing, and if it cannot be written the void is rolled back with an error. The web app and the CLI only ever offered Void; there is no delete command. Scripts that called `journal.delete` expecting the entry to disappear from `journal.list` will now see it (and its reversal) listed as voided.
- **Tally export is XML.** The web **Reports > Tally Export** tab now downloads Tally Prime XML (`reports.tallyExport`: ledger masters plus every invoice, payment, expense and journal entry in the period, no row limit; the **All** preset is unbounded, future-dated entries included), which is what Tally imports. It used to download a CSV from `party.tallyExport` that Tally cannot import. The tab no longer shows a voucher preview table. `party.tallyExport` still works unchanged but is **deprecated**: the API logs `party.tallyExport is deprecated and will be removed in a future release; ... use reports.tallyExport` at most once an hour per process, with no request data, so you can find scripts that still call it. No removal version is set.
- **Multi-tenant and self-hosted: a business created by a since-removed admin is visible again.** Hisaabo hid a business from its organisation when the member who created it was removed from the organisation (an owner can remove an admin who created a business). The business disappeared from the list for everyone, requests for it were refused with "Business not found", and its background jobs failed. That check only exists to separate organisations that share one database, so it now applies only to a **self-hosted install with more than one organisation**. On the multi-tenant cloud (a database per tenant) and on a normal single-organisation self-hosted install, businesses created by a removed member reappear after the upgrade and stay accessible to the remaining members. A self-hosted database that holds more than one organisation (rare: an install that was converted by hand) keeps the old behaviour until 0.11.0 adds `businesses.tenant_id`, and logs a warning at start. That state is **latched**: the first time the API sees more than one row in `tenants` it writes a `system_config` row (`self_host_multi_org_seen`) and keeps the rule on even if the extra organisations are deleted later, because a hard-deleted organisation leaves its businesses in the shared database and they would otherwise appear in the surviving organisation. If you really did remove the extra organisations and their businesses, switch the rule off again with `DELETE FROM system_config WHERE key = 'self_host_multi_org_seen';` (it takes effect within about 15 seconds). Cloud and single-organisation installs never write the row.
- **A free or pro plan can no longer be pushed past its business limit by concurrent requests.** Creating several businesses at the same moment on a plan that allows one could create all of them. The limit check and the insert now run in one transaction under a lock. No action needed.

### Corrected accounting and GST figures

> **Warning: figures for past periods will change. Review previously filed returns.**
> Hisaabo does not store GSTR-1, GSTR-3B, party balances or the trial balance. It recomputes them from your invoices, notes and payments every time you open them. After this upgrade the **past periods** are recomputed with the corrected rules below, so a GSTR-3B or GSTR-1 you have already filed can now show different numbers from the ones you filed, and party balances, party statements, the P&L, the trial balance and the balance sheet can differ from what you saw before. Before you file the next return or an amendment, re-open the months you have already filed, compare them with what was filed, and take any difference to your CA.

What was wrong, and what you see now:

| Where | Before | Now |
|---|---|---|
| **Round-off, invoice discount, additional charges (books)** | An invoice, credit note, debit note or return that carried a round-off, an invoice-level discount or additional charges was posted to the ledger without them, so the trial balance and balance sheet were out of balance by exactly that amount. | They post to accounts of their own, mirrored for notes and returns: round-off to **Round Off** (5030, either sign), the discount to **Discount Allowed** (5020) on sales and **Discount Received** (4200) on purchases, additional charges to **Other Charges** (4020) on sales and **Direct Expenses** (5100) on purchases. Every document balances, and net profit now includes them. The GST on the document is unchanged (it is computed before the invoice-level discount, as the invoice shows). |
| **Gross profit** | Sales returns were never deducted and purchase returns were ignored. | Gross profit is (Sales + Sales Returns) - (Purchases + Purchase Returns + Direct Expenses). |
| **GSTR-3B, input tax credit (Table 4)** | Purchase returns, purchase-side debit notes and credit notes / sales returns raised from a purchase invoice were **added** to the credit, overstating it, and so was **every other purchase-type document**: the query had no document-type filter, so purchase quotations, proformas and delivery challans counted as if they were bills. | They **reduce** it, by head (CGST, SGST, IGST), as in your books, and **purchase-type documents that are not invoices or reversals no longer count toward input credit at all**. |
| **GSTR-3B, output tax (Table 3.1(a), Tax Payable, Net Tax)** | Credit notes, sales returns and sale-side debit notes were ignored, overstating the tax when you issued credit notes. | Taxable value and tax are **net of credit notes and sales returns and include sale-side debit notes**, per head. GSTR-1 still lists the invoices gross and the notes in their own section. In a month where credit notes exceed sales, the net 3.1(a) figures (and Tax Payable) are **negative**: that is a credit to carry forward, not an error. |
| **Which side a credit note belongs to** | The web and mobile apps create a credit note or sales return from a **purchase** invoice with the type of that invoice, but the books, GSTR-1 and GSTR-3B treated every credit note / sales return as a sale-side document: they were posted against a receivable and output GST, listed in GSTR-1 and netted from output tax. | One classifier everywhere, by the document's **type**: a credit note or sales return raised from a purchase invoice reverses the purchase (Dr Payable / Cr Purchase Returns / Cr Input GST), reduces input credit, is **not** in GSTR-1, and reduces what you owe the supplier; sale-side ones are unchanged. |
| **CGST / SGST on an odd paisa** | GSTR-1 and GSTR-3B rounded the odd paisa up for both heads (an invoice with GST of 102.59 reported 51.30 + 51.30 = 102.60), while the books, the invoice's ITC entry and the PDF each split it differently again (the PDF printed tax / 2 for each head). | One rule everywhere, the **e-invoice (IRP) one**, because the IRP-signed e-invoice is what the government holds: each **line's** tax is halved with CGST rounded half-up and SGST the remainder (the odd paisa goes to CGST), and a document's CGST / SGST is the sum of its lines. The ledger, GSTR-1 (invoice rows, B2CS, HSN and totals now tie), GSTR-3B, GSTR-9, the PDF and the e-way bill all follow it. Limits to know: **PDFs you downloaded earlier** printed tax / 2 per head, so on an odd-paisa invoice an old PDF can differ by one paisa per head from the reports (a re-downloaded PDF uses the new split); **e-invoices already submitted are not touched**; and the IRP payload computed the half in floating point, which rounded a few odd paise (about 1 in 22) down, so for those lines the CGST / SGST in a payload sent earlier can differ by one paisa from the exact rule now used. |
| **GSTR-1, debit notes** | Purchase-side debit notes and purchase returns, which you issue to a supplier, were listed as outward debit notes. | Only sale-side debit notes are listed. |
| **Party balance (party page, party list, "Outstanding" filter)** | Quotations, proformas and delivery challans were counted, a purchase-side debit note was added to what you owe a supplier instead of reducing it, and a **supplier's balance was shown as a positive number** (the web and mobile apps then labelled it "Receivable" / "You will receive", although the API, CLI and MCP documentation say negative = you owe them). | The balance is **signed, debit minus credit, for customers and suppliers alike**: positive = they owe you, negative = you owe them. A supplier you owe 14,000 now shows **-14,000** (Payable). Only invoices, credit notes, sales returns, purchase returns and debit notes count, and credit notes, returns and purchase-side debit notes move the balance the right way. The "Outstanding" filter lists every party whose balance is not zero, in either direction. The dashboard "Payable" card, which stays a positive amount, now includes suppliers' opening balances and the same reversals. |
| **Party ledger tab, statement and PDF** | On the party's **Ledger tab**, payments to a supplier were shown as credits, purchase-side debit notes were on the wrong side and deleted payments were listed. | Fixed; the tab, the party statement report, the CSV and the PDF all start from the opening balance exactly as stored and agree with the party's balance (they add payments as their own rows, so they match whenever every payment is allocated to an invoice). |
| **ITC utilisation** | Recording a period's utilisation a second time posted the credit a second time, and Input GST went negative. | Recording a period again **replaces** its journal: the earlier one is reversed (marked void, with a mirror entry; nothing is deleted) and the new one posted. Recording zero amounts clears the period. |
| **ITC ledger and the utilisation limit** | The ITC ledger was written only when a purchase invoice was created, so a purchase return reduced GSTR-3B but not the ITC dashboard, and a utilisation could exceed the credit GSTR-3B reports. | A purchase-side reversal created from now on writes a **negative** ITC entry (and cancelling or deleting it removes the entry), so the ITC dashboard, Table 4 and the utilisation limit are net and equal GSTR-3B. **Reversals created before this release have no entry**: for those months the ITC dashboard stays gross while GSTR-3B Table 4, which is computed from the documents, is net. |
| **A document that does not add up** | A document whose stored total is not explained by its subtotal, tax, discount, charges and round-off (a legacy import, hand-edited data) had the whole difference posted as round-off, however large. | Up to ₹1.00 it is still a round-off. A larger difference is parked in a new **Suspense / Unreconciled** account (2900, a balance-sheet account, so it never looks like profit) and the API logs a warning with the document id: find it in the log, fix the document, and the account clears. |

#### What the accounting migration does

`0024_ledger_adjustment_accounts` (`0011_ledger_adjustment_accounts` for tenant databases) only adds four system accounts to every existing business: **4020 Other Charges**, **5020 Discount Allowed**, **5030 Round Off** and **2900 Suspense / Unreconciled**. It is idempotent and rewrites no document. If a business already has an account of its own coded 4020, 5020, 5030 or 2900 it is left untouched, and the adjustment then posts to Other Income (4100), Miscellaneous Expenses (5990) or Other Current Liabilities (2300) instead of failing.

#### What to do after upgrading

1. **Find the months that change.** Save the query below as `gstr3b-diff.sql` and run it once in each database (single-tenant: your one database; multi-tenant: every tenant database, see [Running it on every tenant](#running-the-queries-on-every-tenant) below). It lists, per business and month, the GSTR-3B output tax and input credit the old rules produced and the corrected ones, and only months where the net tax payable differs. Figures are totals over CGST + SGST + IGST (the head split follows the same rules); months are calendar months in UTC, which is what the reports use on the Docker image.

   <!-- gstr3b-diff-query -->
   ```sql
   WITH docs AS (
     SELECT i.business_id,
            date_trunc('month', i.invoice_date AT TIME ZONE 'UTC')::date AS month,
            i.type::text AS type,
            i.document_type::text AS document_type,
            i.tax_amount::numeric AS tax,
            -- the side a document belongs to, by its type (the ledger's rule); a purchase
            -- return is purchase-side whatever type it was stored with
            CASE
              WHEN i.document_type = 'purchase_return' THEN 'purchase'
              WHEN i.document_type IN ('invoice', 'credit_note', 'sales_return', 'debit_note') THEN i.type::text
            END AS side,
            -- credit notes / returns, and a debit note raised against a supplier, take tax back
            (i.document_type IN ('credit_note', 'sales_return', 'purchase_return')
             OR (i.document_type = 'debit_note' AND i.type = 'purchase')) AS reverses
     FROM invoices i
     WHERE i.status <> 'cancelled' AND i.deleted_at IS NULL
   ), m AS (
     SELECT business_id, month,
            -- before: only sale invoices; after: net of credit notes / returns, plus sale debit notes
            COALESCE(SUM(tax) FILTER (WHERE type = 'sale' AND document_type = 'invoice'), 0) AS old_output,
            COALESCE(SUM(tax) FILTER (WHERE side = 'sale' AND NOT reverses), 0)
              - COALESCE(SUM(tax) FILTER (WHERE side = 'sale' AND reverses), 0) AS new_output,
            -- before: EVERY purchase-type document; after: invoices less reversals
            COALESCE(SUM(tax) FILTER (WHERE type = 'purchase'), 0) AS old_itc,
            COALESCE(SUM(tax) FILTER (WHERE side = 'purchase' AND NOT reverses), 0)
              - COALESCE(SUM(tax) FILTER (WHERE side = 'purchase' AND reverses), 0) AS new_itc
     FROM docs
     GROUP BY business_id, month
   )
   SELECT b.name AS business, m.business_id, to_char(m.month, 'YYYY-MM') AS month,
          m.old_output, m.new_output, m.old_itc, m.new_itc,
          m.old_output - m.old_itc AS old_net_tax, m.new_output - m.new_itc AS new_net_tax,
          (m.new_output - m.new_itc) - (m.old_output - m.old_itc) AS change
   FROM m JOIN businesses b ON b.id = m.business_id
   WHERE (m.old_output - m.old_itc) <> (m.new_output - m.new_itc)
   ORDER BY b.name, m.month
   ```

   A positive `change` means more tax payable than before, a negative one less. It does not show the odd-paisa CGST / SGST difference (a paisa per affected invoice).

   <a id="running-the-queries-on-every-tenant"></a>
   **Running it on every tenant (multi-tenant).** Connected with `psql` to the **control database** as the control role, in the directory that holds `gstr3b-diff.sql`, this generates one `\c` + `\i` pair per tenant database and runs them (a `psql` `\gexec` cannot be used here: it runs generated SQL in the *same* database and cannot switch databases):

   ```
   \t on
   \a
   \o each-tenant.psql
   SELECT format(E'\\echo == %s\n\\c %I %I %s %s\n\\i gstr3b-diff.sql',
                 slug, db_name, current_user, coalesce(db_host, 'localhost'), coalesce(db_port, '5432'))
   FROM tenants WHERE db_name IS NOT NULL ORDER BY slug;
   \o
   \t off
   \a
   \i each-tenant.psql
   ```

   It reconnects as the same role to each tenant's host, port and database (set `PGPASSWORD` or use a `.pgpass` entry so it does not prompt per tenant) and prints one `== <slug>` heading per tenant followed by that tenant's rows. The same loop runs the opening-balance review query in step 5: replace `gstr3b-diff.sql` with its file name.
2. **Re-open every GSTR-3B and GSTR-1 you have already filed** for the months it lists (GST, pick the month) and compare with what was filed. Differences come from credit notes, returns, debit notes, purchase-type documents that are not bills, and odd-paisa GST; if one is material, your CA decides whether to amend.
3. Open the **trial balance** and **balance sheet**: they now balance for invoices with a round-off, discount or charges. New rows (Round Off, Discount Allowed, Other Charges) appear in the P&L when you used those fields. If **Suspense / Unreconciled** shows a balance, a document does not add up: the API log names it.
4. **ITC utilisation recorded twice before this release** is not rewritten automatically. Open ITC, **Utilization**, pick the period, and save it again: the doubled journal is reversed and one correct journal is posted.
5. **Review supplier and customer opening balances. Their meaning may have changed for you.** The documented convention (docs, API, CLI, MCP) is one signed number for everyone: **positive = they owe you, negative = you owe them**. Hisaabo 0.10.0 showed a bare "Opening Balance" box with no direction, and its party page added a supplier's purchases to whatever you typed, so a supplier's opening balance entered as a **positive** number (for example `14000`, meant as "we owe them 14,000") behaved as an amount you owe. Under the convention it now means **they owe you 14,000**: the supplier's balance and statement start from the other side. Customers are the mirror image (a negative opening balance means you owe the customer). Nothing is changed automatically, because only you know what each number meant. Run this read-only query (same way as step 1) to list the candidates, the rows whose sign differs from the usual direction:

   <!-- opening-balance-review-query -->
   ```sql
   SELECT b.name AS business, p.id AS party_id, p.business_id, p.type, p.name AS party,
          p.opening_balance,
          CASE WHEN p.type = 'supplier' THEN 'positive: the supplier now OWES YOU this' ELSE 'negative: YOU now owe the customer this' END AS meaning_now
   FROM parties p JOIN businesses b ON b.id = p.business_id
   WHERE (p.type = 'supplier' AND p.opening_balance::numeric > 0)
      OR (p.type = 'customer' AND p.opening_balance::numeric < 0)
   ORDER BY b.name, p.type, p.name
   ```

   For each row, decide what the number was meant to be. If it is right as it stands (an advance you paid a supplier is a positive supplier balance; an advance a customer paid you is a negative customer balance), leave it. If it was typed as "the amount I owe the supplier" (or "the amount the customer owes me" typed negative), flip its sign **after confirming**, either by editing the party in the mobile app (its edit screen has **To receive** / **To pay**) or with this optional per-party statement, run in the right database:

   <!-- opening-balance-flip -->
   ```sql
   UPDATE parties
   SET opening_balance = -opening_balance, updated_at = now()
   WHERE id = '<party_id from the query>' AND business_id = '<business_id from the query>';
   ```

   There is deliberately no bulk migration. The statement is safe to run once per party; running it twice flips it back.

   **Run the review query again after your users' mobile and desktop apps have updated.** The 0.10.0 mobile and desktop apps keep showing the bare "Opening Balance" box, where a positive number on a supplier now means "they owe you". A supplier created or edited from such an app after you did this review can therefore introduce a new row with the sign you did not intend, and the query will list it. The web app and the 0.10.1 mobile app label the direction ("To receive" / "To pay").

#### Points to confirm with your CA

- A **purchase-side debit note** (a debit note you raise against a supplier) is treated like a purchase return: it reduces input credit in GSTR-3B Table 4, matching the books. Under the GST law a *debit note issued by the supplier* increases credit; Hisaabo's purchase-side debit note is the one you issue.
- An **invoice-level discount** is booked after GST (as a Discount Allowed expense); it does not reduce the taxable value or the GST on the invoice.
- **Round Off** is an expense account that can carry either sign; a net credit shows as a negative expense.

### E-invoicing never signed in to the IRP

**Action needed if you use e-invoicing:** configure the NIC public key. Through v0.10.0 the NIC public key bundled in the API image was not a valid key, so the sign-in request to the IRP failed before anything was sent, and **e-invoicing has never worked against the IRP** in any release (so no IRN was ever generated by a real IRP call). v0.10.1 no longer bundles a key: you supply it.

1. Download the NIC e-invoice public key for each environment you use (the sandbox and production keys differ) from the NIC e-invoice portal, as described in [DEPLOYMENT.md](DEPLOYMENT.md#e-invoicing-irp).
2. Set `IRP_SANDBOX_PUBLIC_KEY_PATH` / `IRP_SANDBOX_PUBLIC_KEY_PEM` (businesses with sandbox mode on) and/or `IRP_PUBLIC_KEY_PATH` / `IRP_PUBLIC_KEY_PEM` (sandbox mode off). A file mounted as a Compose secret is the easiest. Restart the API.
3. In the app, **E-Invoicing, Settings, Test Connection**. It says whether the key (server setup), the network or the sign-in (credentials) failed.

Until a key is configured, generating, retrying or cancelling an e-invoice is refused with "E-invoicing is not configured: the NIC public key is missing or invalid" and nothing is changed (invoices are not marked `failed`). Installs that do not use e-invoicing need to do nothing; the API logs a warning at startup only if a key variable is set but invalid.

The same release corrects how the sign-in request is built and how the IRP's `Status` is read, to match NIC's published documentation. That was checked against the documentation only, not against NIC's live sandbox, so run Test Connection in sandbox mode first. The request and key handling are recorded in [compliance-audit.md](compliance-audit.md).

### E-invoice supply type: every domestic B2B invoice is "B2B"

The IRP takes a supply type (`TranDtls.SupTyp`: `B2B`, `SEZWP`, `SEZWOP`, `EXPWP`, `EXPWOP` or `DEXP`). Hisaabo sent **`EXPWP` (export with payment) for every inter-state sale** and `B2B` only for intra-state ones. Inter- versus intra-state is not a supply type: it shows in IGST versus CGST + SGST and in the place of supply, which the payload already carried. From 0.10.1 the supply type is `B2B` for every e-invoice, intra- or inter-state.

**Nothing to correct.** No e-invoice could be generated by a real IRP call before 0.10.1 (see above: the bundled NIC key was invalid), so no wrongly typed e-invoice exists. Nothing in your data changes.

Related rules, also new in 0.10.1:

- **Exports are refused, not mis-filed.** Hisaabo has no export, SEZ or deemed-export fields until 0.11.0, so it cannot build those supply types. A customer whose GSTIN is `URP` or whose state code is `96` (other country), set on the customer or read from the start of its GSTIN, is refused with "Exports aren't supported in e-invoicing yet; available in 0.11". Nothing is sent to the IRP and the invoice is left as it was; the automatic submission after invoice creation skips such an invoice the same way. Issue the export invoice on the GST portal until 0.11.0.
- **A customer with no state code takes its state from its GSTIN.** The first two digits of a GSTIN are the state code. Until now a customer with a GSTIN but no state code was treated as being in the seller's state, so the e-invoice carried CGST + SGST and the seller's state as the place of supply even for an inter-state customer. The state now comes from the customer's state code, else from its GSTIN. If neither exists, or the business has no state code and no GSTIN, generation is refused with a message saying which state is missing.
- `IgstOnIntra` stays `N`: Hisaabo never charges IGST on an intra-state supply. (`Y` is for SEZ and deemed exports, which arrive in 0.11.0.)

### GST return periods are always April to March

The GST financial year is 1 April to 31 March for every taxpayer. A business's own accounting year (`financialYearStart`, which can be January or July, for example) decides only the accounting reports: trial balance, profit and loss, balance sheet and the dashboard. It must never move a GST return period. Hisaabo mixed the two in two places; both now follow the statute:

- **GSTR-1 portal JSON: the financial-year label.** `gst.gstr1Json` worked the financial year out from the business's `financialYearStart`, so a January-books business labelled January-March 2026 as FY 2026-27 and a July-books business labelled April-June as the previous year. The label was computed but never written into the downloaded JSON (the portal schema has no such key), so **no filing was wrong**. The filing period `fp` (MMYYYY) was always right. The label is now computed from April, and returned as the new `financialYear` field of the response (additive: `json` and `filename` are unchanged).
- **CMP-08 (composition dealers): the quarters.** `gst.cmp08` treated quarters as calendar quarters (Q1 = January-March of `year`). Under GST the quarters of the financial year are Q1 April-June, Q2 July-September, Q3 October-December, Q4 January-March. `quarter` is now the GST quarter and `year` is the **start year of the financial year** (`year: 2025, quarter: 1` is April-June 2025; `year: 2025, quarter: 4` is January-March 2026). **A caller that passed `quarter: 1` for January-March now gets April-June: update any script that calls `gst.cmp08`** (the web app and the CLI do not). The taxable value and the 1% tax are now summed in exact paise, with 1.005 rounding half up to 1.01; the last second of the quarter is no longer left out.
- **Unchanged and already correct:** GSTR-1 and GSTR-3B (calendar month), GSTR-9 (April of the start year to March of the next), the ITC ledger, GSTR-2B reconciliation. The trial balance, profit and loss, balance sheet and dashboard still start the year on the business's `financialYearStart`.

Nothing in your data changes. If you use CMP-08 and a quarter you looked at before 0.10.1 was January-March, look at it again under the new numbering.

### E-invoice lines need a real HSN code

A line whose item had no HSN code was sent to the IRP as HSN `9999`, a code that does not exist. From 0.10.1 generating an e-invoice (from the E-Invoicing page, a retry, or the automatic submission after you create an invoice) is **refused before anything is sent to the IRP**, naming each offending line: `line 2 'Copper Wire' has no HSN code; add it on the item`. The invoice is left exactly as it was; add the HSN on the item (Items, edit) and generate again. After the automatic submission refuses an invoice, the invoice shows the e-invoice as failed with that message (no notification is sent for an automatic submission); fix the item and use Retry.

The code must be 4 to 8 digits (spaces, dots and hyphens are ignored: `7306.90` is sent as `730690`), and the minimum follows the business's annual turnover: **4 digits up to and including ₹5,00,00,000, 6 digits above** (compared in exact paise: ₹50,000,000.00 is still the 4-digit band, ₹50,000,000.01 is not). The turnover is the business's `annual_turnover`, which the app has no field for yet (it is empty for almost every business), so until 0.11.0 captures it only the 4-digit minimum is enforced; a business above ₹5 Cr must keep 6-digit codes on its items itself. HSN is read from the live item, because invoice lines carry no HSN snapshot until 0.11.0: changing an item's HSN changes the code on every e-invoice generated afterwards, and a line without an item (typed in free) has no HSN and cannot be e-invoiced.

No action is needed if every item you e-invoice already has an HSN. Nothing was ever sent to the IRP with a made-up code, since no e-invoice could be generated before 0.10.1 (see above).

### E-invoice cancellation now cancels the invoice

Cancelling an e-invoice (IRN) used to cancel the IRN at the NIC portal and nothing else: the invoice itself stayed live (`sent`, `partial`, `paid`, ...), so it kept counting in GSTR-1 and GSTR-3B, the ledger, party balances and stock. Under GST an e-invoice whose IRN is cancelled is cancelled: it cannot be amended, and a fresh invoice with a new number is issued if the customer still needs billing.

From v0.10.1, **Cancel** on the E-Invoicing page (also `hisaabo einvoice cancel`, the `einvoice_cancel` MCP tool and `eInvoice.cancel`) cancels the IRN and the invoice together, through the same path as a normal invoice cancel (stock and returns adjusted, out of GSTR-1/3B, the ledger and party balances). The 24-hour window is unchanged, and it is refused **before** anything is sent to the portal while payments are allocated to the invoice (remove or reallocate them first). This fix needs no migration of its own.

**Invoices already cancelled by v0.10.0 or earlier are not fixed automatically.** Nothing is migrated, because cancelling an invoice reverses stock and changes returns, and that is a decision for the business. List them with this read-only query, one database at a time (self-hosted: the one database; multi-tenant: every tenant database):

```sql
-- Invoices whose IRN was cancelled but which are still live.
SELECT i.business_id,
       i.invoice_number,
       i.document_type,
       p.name AS party,
       i.invoice_date::date AS invoice_date,
       i.total_amount,
       i.status AS invoice_status,
       i.e_invoice_status,
       i.e_invoice_cancel_reason,
       i.irn
FROM invoices i
JOIN parties p ON p.id = i.party_id
WHERE i.e_invoice_status = 'cancelled'
  AND i.status <> 'cancelled'
  AND i.deleted_at IS NULL
ORDER BY i.business_id, i.invoice_date, i.invoice_number;
```

Save it as `stuck-einvoices.sql` and run it against a self-hosted Docker Compose install:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < stuck-einvoices.sql
```

Multi-tenant (loops over every tenant database). Tenant databases are listed from the control database's `tenants` table, not found by name, because their names are not all alike. The control database is `$POSTGRES_DB` unless you set `CONTROL_DATABASE_URL` to another one (then use that name). It reads with the same `POSTGRES_USER` the admin dashboard uses, so that role must be able to connect to every tenant database:

```bash
COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"
for db in $(echo "SELECT db_name FROM tenants WHERE db_name IS NOT NULL ORDER BY db_name" \
    | $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'); do
  echo "== $db"
  $COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $db" < stuck-einvoices.sql
done
```

A tenant whose `db_host` is not this Postgres server has to be queried with `psql` on that host instead.

On the ONCE image, connect as shown in [DEPLOYMENT.md](DEPLOYMENT.md#once-all-in-one-image) and run the same file.

For each row returned, whoever owns the business decides whether the invoice should really be cancelled (it normally should: its IRN is gone). Cancel it with the **normal invoice cancel**, which never contacts the IRP again because the IRN is already cancelled:

- **Web:** open E-Invoicing, **Cancelled** tab, press **Cancel invoice** on the row.
- **CLI:** `hisaabo invoice status <invoice-id> cancelled`.
- **MCP / API:** `invoice_update_status` / `invoice.updateStatus` with `status: "cancelled"`. (`eInvoice.cancel` on such an invoice also works and only finishes the local cancel.)

The invoice status rules are unchanged in 0.10.1, so some rows cannot be cancelled directly:

- **`paid`, or any invoice with payments allocated:** remove the payment allocations first (removing the payments moves the invoice back to `sent` or `partial`), then cancel it.
- **`adjusted` (fully offset by credit notes or sales/purchase returns):** the status rules do not allow cancelling it, and cancelling or deleting those credit notes or returns does not move the invoice out of `adjusted`, so there is no in-app route yet. Leave these rows for a later release and decide with your accountant how the offsetting credit note or return is reported until then.

If the customer still needs billing, issue a new invoice (new number, new IRN). An invoice that is still listed after you cancel it was in a different state than expected: check its `status`. The E-Invoicing page also shows a banner with the count of such invoices, and the invoice's own panel says it is still active.

### Other changes in 0.10.1 that touch e-invoice cancellation

- **A cancel whose answer was lost is now recoverable.** Requests to the IRP time out after 30 seconds. If the IRP cancelled the IRN but the answer never arrived (timeout, crash, double click), cancelling again asks the IRP for the IRN's status; when it reports the IRN as cancelled, Hisaabo completes the local cancel instead of showing the IRP's refusal. This also works after the 24-hour window. If the IRN is still active, the original error is shown and nothing changes.
- **Known issue (not fixed in 0.10.1, planned for 0.11): cancelling an invoice that was converted from a delivery challan restores stock the invoice did not deduct.** The challan already deducted the stock, the invoice created from it deducts nothing, but cancelling or deleting that invoice (including by cancelling its e-invoice) adds its quantities back. Adjust stock manually after cancelling such an invoice. Listed in [compliance-audit.md](compliance-audit.md).


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
