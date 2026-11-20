# Caching and cache invalidation

Hisaabo caches a small set of **control-plane facts** (sessions, API keys,
membership/role, tenant plan, maintenance flag, storefront slugs) in
process memory, because every request would otherwise pay 2-4 control-DB
queries before doing real work. Nothing else is cached. This page is the
contract for adding to that set.

Code: `packages/api/src/lib/cache/` (primitive, bus, listener),
`lib/auth-caches.ts`, `lib/authz.ts`, `lib/store-slug-cache.ts`,
triggers in `packages/db/src/cache-triggers.ts`.

## Principles

1. **Same-request invalidation (layer A).** Every code path that writes a
   cached table calls the in-process bus *after* the write settled:
   `await cacheBus.afterWrite([event], () => write)` or
   `cacheBus.invalidate(event)` (in `finally` for transactions, so a rollback
   also invalidates, which is harmless). The next call in the same process sees
   fresh data. A load that overlaps an invalidation is not stored (generation
   check in `TtlCache.getOrLoad`), so a slow read cannot resurrect a stale
   value.
2. **Cross-process invalidation (layer B).** `AFTER` triggers on the control
   tables call `pg_notify('cache_invalidate', ...)`; each API process runs
   `startCacheListener` (LISTEN) and feeds notifications into the same bus.
   This covers other replicas, CLIs (`maintenance`, `rotate-key`) and manual
   SQL. NOTIFY is delivered on COMMIT only, so rollbacks never notify. It is
   eventual (milliseconds), not same-request; layer A provides the same-request
   guarantee inside the writing process. Payloads carry identifiers only, never
   credentials, key hashes or session tokens.
3. **TTL safety net (layer C).** Every entry expires (60 s for auth facts,
   30 s maintenance, 5 min slugs). Hot-path bookkeeping writes
   (`last_used_at`, sliding expiry) deliberately do **not** invalidate or
   notify.
4. **Degraded mode.** If the triggers are missing or the listener is unhealthy
   (LISTEN lost, pings not observed), the process clamps every cache TTL to
   5 s and drops all entries, so cross-process staleness is bounded by 5 s
   instead of 60 s - 5 min. It recovers automatically.
5. **Positive-only authz.** A denial (no membership, inactive tenant, unknown
   business) is never cached; the next call re-queries. Only the storefront
   slug-miss keeps a 30 s negative cache, with explicit invalidation.

## What is cached

| Cache (module) | Key | Value | Tags | TTL / max | Invalidated by (bus event) |
|---|---|---|---|---|---|
| `sessions` (`auth-caches.ts`) | session id | user, tenant, expiry, auth method | `session:S`, `user:U` | 60 s / 5000 | `session`, `user`; trigger on sessions delete / security-relevant update, users |
| `accessTokens` (`auth-caches.ts`) | access token id | user, tenant, token expiry, session id | `session:S`, `user:U` | 60 s / 5000 | `session`, `user`; sessions trigger (cascade) |
| `apiKeys` (`auth-caches.ts`) | sha256(raw key) | user, tenant, expiry, key id | `apikey:ID`, `user:U`, `tenant:T` | 60 s / 2000 | `apiKey`, `user`, `tenant`; api_keys trigger |
| `authz.membership` (`authz.ts`) | `tenantId:userId` | role + active status | `tenant:T`, `user:U` | 60 s / 10000 | `membership`, `tenant`, `user`; tenant_members and tenants triggers |
| `authz.business` (`authz.ts`) | `tenantId:businessId` | creator user id (immutable) | `tenant:T`, `business:B` | 5 min / 5000 | `business` (create), `tenant` |
| `tenantPlan` (`plan-limits.ts`) | tenant id | plan | `tenant:T` | 60 s / 2000 | `tenant`; tenants trigger (status, plan) |
| `maintenance` (`maintenance-cache.ts`) | constant | maintenance status | - | 30 s / 1 | `maintenance`; system_config trigger |
| `storeSlug` (`store-slug-cache.ts`) | slug | tenant id + business id | - | 5 min / 2000 | `storeSlug`; store_slugs trigger |
| `storeSlugMiss` | slug | (negative marker) | - | 30 s / 5000 | `storeSlug`; store_slugs trigger |

"Is this caller allowed" is evaluated from these on **every** request in every
entry point (tRPC middlewares, REST handlers in `server.ts`) through
`lib/authz.ts` (`getAuthz`, `getActiveMembership`, `getBusinessAccess`) so there
is one source of truth and one set of denial messages (`authzDenialError`).
The business entry only holds immutable facts; "creator is still a member" is
re-checked against the membership cache on each call, so removing the creator
denies the very next request.

## Never cache

- Document / invoice number counters, `FOR UPDATE` reads, anything inside a
  mutating transaction (stock, ledger, payments, allocations).
- Reports and derived-ledger output, party balances, stock quantities, the
  audit log, any per-request-mutable business data. Their inputs change on
  every write with no central choke point. If a report is too slow, use
  `ETag`/`updatedAt` conditional responses, not value caches.
- Negative authz results.
- Secrets: raw API keys, decrypted credentials, session ids in NOTIFY payloads
  or logs. (Cache keys for API keys are the sha256 of the key.)
- Tenant DB handles are connection pools, not data.
- Logo / image bytes. Serve them ETag-before-bytes (`lib/logo-response.ts`,
  `lib/store-gates.ts`): validators come from a metadata query that never reads
  the bytea column; the OG image route loads the logo only on an OG-cache miss.
- The storefront catalog has **no** in-process cache. It relies on
  `Cache-Control: s-maxage` at the CDN/browser only (see
  [online-store.md](online-store.md) section 12.1).

## Adding a new cached entity (checklist)

1. Justify it: it is read on a hot path, is a control-plane fact, and is not on
   the NEVER list above. Prefer positive-only entries.
2. Create the cache with `new TtlCache({ name, max, ttlMs })` (it registers
   itself for degraded-mode clamping and `resetAllCaches`). Load through
   `getOrLoad` and attach tags so you can invalidate by tenant/user/etc.
3. Subscribe with `cacheBus.on(kind, handler)`. Add a new event kind to
   `lib/cache/bus.ts` (`CacheEvent`) only if none fits, and map its NOTIFY
   payload in `parseNotification`.
4. In **every** writer of the underlying table, emit the event after the write
   settles (`cacheBus.afterWrite` / `invalidate`).
5. Cross-process: if the table lives in the control DB and is not already
   covered, add a trigger spec to `expectedCacheTriggers` in
   `packages/db/src/cache-triggers.ts` (identifiers only in the payload;
   exclude hot-path columns via `UPDATE OF` / `WHEN`), regenerate the custom
   migrations (`gen-cache-trigger-migration.ts` in the db package scripts; a drift test checks
   them) and make sure `verifyCacheTriggers` covers it.
6. Register the table and its writer files in the static guard
   `packages/api/src/__tests__/cache-write-guard.test.ts` (`GUARDED` and
   `ALLOWED_WRITERS`). The test fails for any file that writes a guarded table
   without being listed, and for listed files that neither emit a `cacheBus`
   event nor carry a `// cache-guard: <reason>` comment next to the write.
7. Tests: invalidation on each writer, race (invalidate during load is not
   stored), TTL expiry, degraded-mode clamp.

## PgBouncer / LISTEN caveat

`LISTEN` needs a session-level connection. Through PgBouncer in
*transaction* pooling mode, notifications are never delivered (and the
subscription can silently disappear). The listener therefore connects with
`CONTROL_DATABASE_URL`, falling back to `DATABASE_URL`: **point
`CONTROL_DATABASE_URL` (or `DATABASE_URL`) at a direct Postgres connection**,
or at a PgBouncer pool in *session* mode, for the control database. The app's
normal pools may still go through a transaction pooler.

If you cannot provide a direct URL, the server still boots and works: the
watchdog (a ping through a second connection) never sees its own ping, flips to
degraded mode and logs a warning. You then get 5 s worst-case cross-process
staleness for revoked sessions / removed members on other replicas. Single
replica deployments are unaffected (layer A covers them).

## Operations

Boot messages (pino logs, `packages/api/src/server.ts`):

| Log line | Meaning |
|---|---|
| `Cache listener started (cross-process invalidation active)` | healthy |
| `Cache listener started DEGRADED: ...` | LISTEN not established or triggers missing |
| `cache triggers missing: cross-process invalidation is unreliable, cache TTL clamped (degraded mode)` (warn, with `missing` list) | the DB triggers are absent or altered |
| `cache listener unhealthy: pings not observed; recreating (degraded mode)` (warn) | LISTEN lost or going through a transaction pooler; the listener is recreated every watchdog cycle until it works |
| `cache listener recovered` | back to normal; triggers are re-verified |
| `Cache listener failed to start: ...` (warn) | startup error; process runs degraded |

Fixes: missing triggers - run the migrations (`drizzle-control/` includes the
trigger migration) or call `installCacheTriggers(sql)` from `@hisaabo/db`
(idempotent; needed for `db:push` databases, which never run SQL migrations).
Listener unhealthy - check that the URL is direct, that the role may `LISTEN`,
and database connectivity. The listener connections are named
`hisaabo-cache-listener` / `hisaabo-cache-watchdog` in `pg_stat_activity`.

Tests do not start the listener (`NODE_ENV=test` / `VITEST`).

## Storefront slug registry (multi-tenant)

In multi-tenant mode `/store/<slug>` is resolved by one primary-key lookup on
the control-DB table `store_slugs` (module `lib/store-slug-registry.ts`, the
only code that reads or writes it) instead of scanning every tenant database.
Self-hosted mode keeps querying `businesses.store_slug` directly. The
registry only says *which* business a slug points to; every storefront route
re-checks `businesses.storeEnabled` in the tenant DB (`lib/store-gates.ts`
for the item-image and identify routes).

### Semantics

- A **live** row (`released_at IS NULL`) means the slug belongs to `business_id`.
- Renaming or clearing a slug never deletes the row: it sets `released_at`.
  The slug stays reserved (primary key) so old links cannot be hijacked.
- The **same tenant** may reclaim a released slug at any time. **Another
  tenant** may claim it only after a **30-day hold** (`released_at < now() -
  30 days`).
- A business has at most one live slug (partial unique index on
  `(tenant_id, business_id) WHERE released_at IS NULL`).
- `tenant_id` always comes from the authenticated server context (or, in the
  backfill, from the control `tenants` row being scanned), never from request
  input or tenant-DB content.
- Lookups only serve slugs of **active** tenants with `store_enabled`.

### Backfill and the marker

Existing slugs live in tenant databases, so filling the registry cannot be a
SQL migration. `migrateMultiTenant()` runs the backfill after the tenant
migrations (`packages/db/src/backfill-store-slugs.ts`):

- A marker row `migration:store_slug_registry_v1` in `system_config` makes it
  run once: later boots do a single primary-key read and skip. The marker is
  written in the same transaction as the inserts and **only when every tenant
  was readable and nothing was deferred**; otherwise the next boot retries.
- Advisory lock `72919284` stops replicas from running it concurrently.
- Existing registry rows are authoritative and never evicted. Duplicate slugs
  across tenants are won by: active tenant, then oldest business, then oldest
  tenant, then business id. Losers are logged and listed in the marker; tenant
  data is never modified. Contested slugs are deferred while any tenant failed
  to read.
- Until the marker exists, a registry miss falls back to the legacy tenant scan
  so a partial backfill cannot cause an outage.
- A backfill error never fails boot.

### Pre-upgrade runbook (production)

Run this **before** deploying the version that introduces the registry. The
dry run is strictly read-only (read-only DB sessions, no lock, no marker) and
works while the `store_slugs` table does not exist yet.

```bash
# from a host/container that can reach the control DB and tenant DBs
MULTI_TENANT=true CONTROL_DATABASE_URL=postgresql://... \
  node packages/db/dist/migrate.mjs --reconcile-store-slugs --dry-run
# dev checkout: pnpm --filter @hisaabo/db db:reconcile-store-slugs -- --dry-run
```

Read the report: tenants scanned, rows it would insert, **duplicate slugs**
(winner and losers per slug - contact the losing accounts if their storefront
matters), invalid slugs (skipped; they never resolved before either) and
tenant read failures (fix those tenants first; exit code 1 when any tenant
failed). Then deploy; the boot backfill does the real run.

### Reconcile and prune (after deploy)

```bash
node packages/db/dist/migrate.mjs --reconcile-store-slugs            # force re-run, ignores the marker
node packages/db/dist/migrate.mjs --reconcile-store-slugs --prune    # also delete orphan live rows
```

Multi-tenant only; runs no schema migrations. It inserts missing rows, repairs
`store_enabled` drift and reports **orphans** (live registry rows whose tenant
business no longer has that slug); `--prune` deletes only those. `--prune`
cannot be combined with `--dry-run`. Run it once after a rolling deploy
completes, because old-version replicas that saved a slug after the backfill
read are not in the registry.

## Index policy

Indexes speed reads but tax **every** write (and every cache-trigger-adjacent
hot update). Add an index only with a concrete query that needs it, and prefer
widening an existing index over adding a new one. See the "Indexes" section in
[CONTRIBUTING.md](../../CONTRIBUTING.md).
