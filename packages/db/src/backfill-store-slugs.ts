/**
 * Store-slug registry backfill / reconcile (multi-tenant only).
 *
 * Copies every `businesses.store_slug` found in tenant databases into the
 * control-DB `store_slugs` registry. Cross-database reads mean this cannot be
 * a SQL migration; it runs from migrateMultiTenant() AFTER tenant migrations,
 * guarded by a marker row in system_config, and is also exposed as
 * `--reconcile-store-slugs [--dry-run] [--prune]` on the migrate CLI.
 *
 * Rules (see slug-registry design):
 *  - Raw `postgres` clients only. Must NOT import control-client.ts (pool +
 *    env reads at import time).
 *  - Marker is written in the same transaction as the inserts and ONLY when
 *    every tenant was read and nothing was deferred.
 *  - Existing registry rows are authoritative and never evicted.
 *  - Duplicate winner ranking: active tenant, business created_at, tenant
 *    created_at, business_id. Contested slugs are deferred while any tenant
 *    failed to read (no winner is chosen on partial information).
 *  - Duplicate losers are NOT dropped: each gets a new unique slug
 *    (`fallbackSlug`: random prefix + original), claimed in the registry and
 *    written to that business in its tenant DB (store_slug_auto_assigned=true)
 *    inside ONE control transaction per loser. A failed/0-row tenant update
 *    (e.g. the user changed the slug concurrently) rolls the registry insert
 *    back and leaves the loser "unresolved": no marker, retried next run.
 *    This is the ONLY tenant-DB write the backfill makes, and it is guarded by
 *    `WHERE store_slug = <original>`.
 *  - tenant_id always comes from the control `tenants` row being scanned,
 *    never from tenant-DB content.
 *  - dryRun is strictly read-only (read-only sessions, no lock, no marker) and
 *    works when the store_slugs table does not exist yet.
 */
import postgres from "postgres";
import { fallbackSlug, FALLBACK_SLUG_MAX_ATTEMPTS, STORE_SLUG_REGEX, storeSlugBusinessLockStatement } from "./store-slug.js";

export { STORE_SLUG_REGEX };
export const STORE_SLUG_MARKER_KEY = "migration:store_slug_registry_v1";
export const STORE_SLUG_BACKFILL_LOCK_ID = 72919284;

// Server-side read-only sessions: dry-run cannot write even by mistake.
// (postgres.js types only model boolean params; the server parses "on".)
const READ_ONLY_CONN = { default_transaction_read_only: "on" } as unknown as Record<string, boolean>;

const READ_CONCURRENCY = 5;
const INSERT_CHUNK = 1000;
const MARKER_LIST_CAP = 200;

export interface TenantRow {
  id: string;
  slug: string;
  db_name: string | null;
  db_host: string | null;
  db_port: string | null;
  db_user: string | null;
  db_password: string | null;
  status: string;
  created_at: Date;
}

export interface BusinessSlugRow {
  id: string;
  store_slug: string | null;
  store_enabled: boolean;
  created_at: Date;
}

export type TenantReader = (tenant: TenantRow) => Promise<BusinessSlugRow[]>;
/**
 * Tenant-DB write used for renames. Must run
 *   UPDATE businesses SET store_slug = to, store_slug_auto_assigned = true, updated_at = now()
 *   WHERE id = businessId AND store_slug = from
 * and return the affected row count (0 = the slug changed concurrently).
 * Throw on any failure (a unique violation must carry `code: "23505"`).
 */
export type TenantRenamer = (
  tenant: TenantRow,
  p: { businessId: string; from: string; to: string },
) => Promise<number>;
type LogFn = (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;

export interface BackfillOptions {
  controlUrl: string;
  /** Ignore the marker (reconcile mode); also heals store_enabled drift and reports orphans. */
  force?: boolean;
  /** Read and report only: no writes, no lock, no marker. Works without the store_slugs table. */
  dryRun?: boolean;
  /** Reconcile only: delete live registry rows whose tenant business no longer has that slug. */
  prune?: boolean;
  /** Injectable reader (tests). Default connects with buildTenantUrl. */
  readTenant?: TenantReader;
  /** Test seam: candidate generator (default `fallbackSlug`). Only the slug choice is replaced; all SQL stays real. */
  generateSlug?: (original: string) => string;
  /** Injectable tenant renamer (tests). Default connects with buildTenantUrl. */
  renameTenant?: TenantRenamer;
  /** Required when readTenant is not given (migrate.ts passes its admin-credential builder). */
  buildTenantUrl?: (t: TenantRow) => Promise<string>;
  logger?: LogFn;
}

export interface Candidate {
  slug: string;
  tenantId: string;
  businessId: string;
  storeEnabled: boolean;
  tenantActive: boolean;
  tenantCreatedAt: Date;
  businessCreatedAt: Date;
}

export interface Loser {
  slug: string;
  winnerTenantId: string;
  winnerBusinessId: string;
  loserTenantId: string;
  loserBusinessId: string;
  /** "tenant" = lost to another tenant candidate, "registry" = slug already registered to someone else */
  reason: "tenant" | "registry";
}

export interface SlugRename {
  tenantId: string;
  businessId: string;
  from: string;
  to: string;
}

export interface UnresolvedLoser {
  slug: string;
  tenantId: string;
  businessId: string;
  reason: string;
}

export interface DuplicateGroup {
  slug: string;
  winner: { tenantId: string; tenantSlug: string; businessId: string };
  losers: { tenantId: string; tenantSlug: string; businessId: string }[];
}

export interface BackfillReport {
  status: "skipped" | "complete" | "incomplete" | "dry-run";
  tenants: number;
  /** rows actually inserted (always 0 for dry-run) */
  inserted: number;
  /** rows that would be inserted (dry-run) or were attempted */
  wouldInsert: number;
  losers: Loser[];
  duplicates: DuplicateGroup[];
  invalid: { slug: string; tenantId: string; businessId: string }[];
  /** losers given a new slug (applied; always empty for dry-run) */
  renames: SlugRename[];
  /** dry-run only: losers that would be renamed (the new slug is random, so only `from` is known) */
  plannedRenames: { slug: string; tenantId: string; tenantSlug: string; businessId: string }[];
  /** losers that could not be renamed this run (marker withheld, retried next run) */
  unresolved: UnresolvedLoser[];
  failures: { tenantId: string; tenantSlug: string; error: string }[];
  deferred: number;
  /** reconcile (force) only */
  enabledDriftFixed: number;
  orphans: { slug: string; tenantId: string; businessId: string }[];
  pruned: number;
  tableExists: boolean;
}

const defaultLogger: LogFn = (level, msg, data) => {
  const entry = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data });
  if (level === "error") console.error(entry);
  else console.log(entry);
};

function emptyReport(): BackfillReport {
  return {
    status: "incomplete", tenants: 0, inserted: 0, wouldInsert: 0, losers: [], duplicates: [], invalid: [],
    renames: [], plannedRenames: [], unresolved: [],
    failures: [], deferred: 0, enabledDriftFixed: 0, orphans: [], pruned: 0, tableExists: true,
  };
}

/** Deterministic winner ordering. Exported for tests. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.tenantActive !== b.tenantActive) return a.tenantActive ? -1 : 1;
  const bc = a.businessCreatedAt.getTime() - b.businessCreatedAt.getTime();
  if (bc !== 0) return bc;
  const tc = a.tenantCreatedAt.getTime() - b.tenantCreatedAt.getTime();
  if (tc !== 0) return tc;
  return a.businessId < b.businessId ? -1 : a.businessId > b.businessId ? 1 : 0;
}

function defaultReader(buildTenantUrl: (t: TenantRow) => Promise<string>, readOnly: boolean): TenantReader {
  return async (tenant) => {
    const url = await buildTenantUrl(tenant);
    const client = postgres(url, {
      max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {},
      connection: { statement_timeout: 30000, ...(readOnly ? READ_ONLY_CONN : {}) },
    });
    try {
      return await client<BusinessSlugRow[]>`
        SELECT id, store_slug, store_enabled, created_at FROM businesses WHERE store_slug IS NOT NULL
      `;
    } finally {
      await client.end({ timeout: 5 });
    }
  };
}

function defaultRenamer(buildTenantUrl: (t: TenantRow) => Promise<string>): TenantRenamer {
  return async (tenant, p) => {
    const url = await buildTenantUrl(tenant);
    const client = postgres(url, {
      max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {},
      connection: { statement_timeout: 30000 },
    });
    try {
      const rows = await client`
        UPDATE businesses
           SET store_slug = ${p.to}, store_slug_auto_assigned = true, updated_at = now()
         WHERE id = ${p.businessId} AND store_slug = ${p.from}
        RETURNING id`;
      return rows.length;
    } finally {
      await client.end({ timeout: 5 });
    }
  };
}

const isUnique = (err: unknown) => (err as { code?: string } | null)?.code === "23505";

export async function backfillStoreSlugRegistry(opts: BackfillOptions): Promise<BackfillReport> {
  const log = opts.logger ?? defaultLogger;
  const dryRun = !!opts.dryRun;
  const force = !!opts.force || dryRun;
  const report = emptyReport();

  const control = postgres(opts.controlUrl, {
    max: 1, idle_timeout: 0, connect_timeout: 15, onnotice: () => {},
    ...(dryRun ? { connection: READ_ONLY_CONN } : {}),
  });

  let locked = false;
  try {
    const [{ exists }] = await control<{ exists: boolean }[]>`SELECT to_regclass('store_slugs') IS NOT NULL AS exists`;
    report.tableExists = exists;
    if (!exists && !dryRun) {
      throw new Error("store_slugs table does not exist; run control migrations first");
    }

    const markerPresent = async (): Promise<boolean> => {
      const rows = await control`SELECT 1 FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`;
      return rows.length > 0;
    };

    if (!force) {
      // Fast path: one PK read, no lock, no tenant I/O.
      if (await markerPresent()) {
        log("info", "store slug backfill already complete");
        report.status = "skipped";
        return report;
      }
    }

    if (!dryRun) {
      await control`SELECT pg_advisory_lock(${STORE_SLUG_BACKFILL_LOCK_ID})`;
      locked = true;
      if (!force && (await markerPresent())) {
        log("info", "store slug backfill already complete (completed by another instance)");
        report.status = "skipped";
        return report;
      }
    }

    const reader: TenantReader = opts.readTenant ?? (() => {
      if (!opts.buildTenantUrl) throw new Error("buildTenantUrl or readTenant is required");
      return defaultReader(opts.buildTenantUrl, dryRun);
    })();

    // ── READ PHASE ──────────────────────────────────────────
    const tenants = await control<TenantRow[]>`
      SELECT id, slug, db_name, db_host, db_port, db_user, db_password, status, created_at
      FROM tenants WHERE status <> 'deleted' AND db_name IS NOT NULL
      ORDER BY created_at, id
    `;
    report.tenants = tenants.length;
    const tenantSlugById = new Map(tenants.map((t) => [t.id, t.slug]));

    const candidates: Candidate[] = [];
    const readOk = new Set<string>();
    const tenantBusinesses = new Map<string, Map<string, BusinessSlugRow>>(); // tenantId -> businessId -> row

    for (let i = 0; i < tenants.length; i += READ_CONCURRENCY) {
      const batch = tenants.slice(i, i + READ_CONCURRENCY);
      await Promise.all(batch.map(async (t) => {
        try {
          const rows = await reader(t);
          readOk.add(t.id);
          const byBiz = new Map<string, BusinessSlugRow>();
          for (const r of rows) {
            if (r.store_slug == null) continue;
            byBiz.set(r.id, r);
            if (!STORE_SLUG_REGEX.test(r.store_slug)) {
              report.invalid.push({ slug: r.store_slug, tenantId: t.id, businessId: r.id });
              continue;
            }
            candidates.push({
              slug: r.store_slug, tenantId: t.id, businessId: r.id, storeEnabled: !!r.store_enabled,
              tenantActive: t.status === "active", tenantCreatedAt: new Date(t.created_at),
              businessCreatedAt: new Date(r.created_at),
            });
          }
          tenantBusinesses.set(t.id, byBiz);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          report.failures.push({ tenantId: t.id, tenantSlug: t.slug, error });
          log("error", "store slug backfill: failed to read tenant", { tenantId: t.id, tenantSlug: t.slug, error });
        }
      }));
    }

    // ── CLASSIFY / RESOLVE ──────────────────────────────────
    interface Existing { slug: string; tenant_id: string; business_id: string; store_enabled: boolean; released_at: Date | null }
    const existing = report.tableExists
      ? await control<Existing[]>`SELECT slug, tenant_id, business_id, store_enabled, released_at FROM store_slugs`
      : [];
    const existingBySlug = new Map(existing.map((e) => [e.slug, e]));
    const liveKey = (tenantId: string, businessId: string) => `${tenantId}:${businessId}`;
    const liveBusinessKeys = new Set(existing.filter((e) => e.released_at == null).map((e) => liveKey(e.tenant_id, e.business_id)));

    const bySlug = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const list = bySlug.get(c.slug);
      if (list) list.push(c); else bySlug.set(c.slug, [c]);
    }

    const toInsert: Candidate[] = [];
    const partial = report.failures.length > 0;
    const who = (c: Candidate) => ({ tenantId: c.tenantId, tenantSlug: tenantSlugById.get(c.tenantId) ?? "", businessId: c.businessId });

    for (const [slug, list] of [...bySlug.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const reg = existingBySlug.get(slug);
      if (reg) {
        // Registry wins; never evict. Anyone else holding the same slug in a tenant DB is a loser.
        for (const c of list) {
          if (c.businessId === reg.business_id && c.tenantId === reg.tenant_id) continue;
          report.losers.push({
            slug, winnerTenantId: reg.tenant_id, winnerBusinessId: reg.business_id,
            loserTenantId: c.tenantId, loserBusinessId: c.businessId, reason: "registry",
          });
        }
        continue;
      }
      const sorted = [...list].sort(compareCandidates);
      if (sorted.length > 1) {
        if (partial) { report.deferred++; continue; }
        const [winner, ...rest] = sorted;
        report.duplicates.push({ slug, winner: who(winner), losers: rest.map(who) });
        for (const l of rest) {
          report.losers.push({
            slug, winnerTenantId: winner.tenantId, winnerBusinessId: winner.businessId,
            loserTenantId: l.tenantId, loserBusinessId: l.businessId, reason: "tenant",
          });
        }
        if (!liveBusinessKeys.has(liveKey(winner.tenantId, winner.businessId))) toInsert.push(winner);
      } else if (!liveBusinessKeys.has(liveKey(sorted[0].tenantId, sorted[0].businessId))) {
        toInsert.push(sorted[0]);
      }
    }
    report.wouldInsert = toInsert.length;

    for (const l of report.losers) {
      log("warn", "store slug conflict", {
        slug: l.slug, winnerTenantId: l.winnerTenantId, winnerBusinessId: l.winnerBusinessId,
        loserTenantId: l.loserTenantId, loserBusinessId: l.loserBusinessId, reason: l.reason,
      });
    }
    for (const inv of report.invalid) {
      log("warn", "store slug backfill: skipping invalid slug", inv);
    }

    // Reconcile extras: drift + orphans, only for tenants whose read succeeded.
    const drift: { slug: string; enabled: boolean }[] = [];
    if (force) {
      for (const e of existing) {
        if (e.released_at != null || !readOk.has(e.tenant_id)) continue;
        const biz = tenantBusinesses.get(e.tenant_id)?.get(e.business_id);
        if (!biz || biz.store_slug !== e.slug) {
          report.orphans.push({ slug: e.slug, tenantId: e.tenant_id, businessId: e.business_id });
        } else if (!!biz.store_enabled !== e.store_enabled) {
          drift.push({ slug: e.slug, enabled: !!biz.store_enabled });
        }
      }
    }

    if (dryRun) {
      for (const l of report.losers) {
        report.plannedRenames.push({
          slug: l.slug, tenantId: l.loserTenantId, tenantSlug: tenantSlugById.get(l.loserTenantId) ?? "",
          businessId: l.loserBusinessId,
        });
      }
      report.status = "dry-run";
      report.enabledDriftFixed = drift.length; // would-fix count
      return report;
    }

    // ── WRITE PHASE (one control transaction) ───────────────
    await control.begin(async (tx) => {
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        // tenant_id is taken from the scanned control `tenants` row (Candidate.tenantId).
        const payload = chunk.map((c) => ({
          slug: c.slug, tenant_id: c.tenantId, business_id: c.businessId, store_enabled: c.storeEnabled,
        })) as unknown as Parameters<typeof tx.json>[0];
        const res = await tx`
          INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled)
          SELECT v.slug, v.tenant_id, v.business_id, v.store_enabled
          FROM jsonb_to_recordset(${tx.json(payload)}) AS v(slug text, tenant_id uuid, business_id uuid, store_enabled boolean)
          JOIN tenants t ON t.id = v.tenant_id
          ON CONFLICT DO NOTHING
        `;
        report.inserted += res.count;
      }
      if (opts.force) {
        for (const d of drift) {
          const r = await tx`
            UPDATE store_slugs SET store_enabled = ${d.enabled}, updated_at = now()
            WHERE slug = ${d.slug} AND released_at IS NULL AND store_enabled <> ${d.enabled}`;
          report.enabledDriftFixed += r.count;
        }
        if (opts.prune) {
          for (const o of report.orphans) {
            const r = await tx`DELETE FROM store_slugs WHERE slug = ${o.slug} AND business_id = ${o.businessId} AND released_at IS NULL`;
            report.pruned += r.count;
          }
        }
      }
    });

    // ── RENAME PHASE (one control transaction per loser) ────
    // After the winners are registered, so a loser's random candidate can
    // never pre-empt a winner's slug.
    if (report.losers.length > 0) {
      const renameTenant = opts.renameTenant ?? (() => {
        if (!opts.buildTenantUrl) throw new Error("buildTenantUrl or renameTenant is required");
        return defaultRenamer(opts.buildTenantUrl);
      })();
      const tenantById = new Map(tenants.map((t) => [t.id, t]));
      for (const l of report.losers) {
        const tenant = tenantById.get(l.loserTenantId);
        const biz = tenantBusinesses.get(l.loserTenantId)?.get(l.loserBusinessId);
        const unresolved = (reason: string) => {
          report.unresolved.push({ slug: l.slug, tenantId: l.loserTenantId, businessId: l.loserBusinessId, reason });
          log("warn", "store slug backfill: loser could not be renamed (retried next run)", {
            slug: l.slug, tenantId: l.loserTenantId, businessId: l.loserBusinessId, reason,
          });
        };
        if (!tenant || !biz) { unresolved("tenant business not found"); continue; }
        if (liveBusinessKeys.has(liveKey(l.loserTenantId, l.loserBusinessId))) {
          // Registry already maps this business to another slug (drift). Needs an operator (--prune).
          unresolved("business already has a different live registry slug; run --reconcile-store-slugs --prune");
          continue;
        }
        try {
          const to = await renameLoser(control, renameTenant, tenant, biz, l.slug, bySlug, log, opts.generateSlug ?? fallbackSlug);
          if (to) {
            report.renames.push({ tenantId: l.loserTenantId, businessId: l.loserBusinessId, from: l.slug, to });
            log("warn", "store slug backfill: renamed duplicate slug", {
              tenantId: l.loserTenantId, businessId: l.loserBusinessId, from: l.slug, to,
            });
          } else {
            unresolved("no unique replacement slug could be claimed");
          }
        } catch (err) {
          unresolved(err instanceof Error ? err.message : String(err));
        }
      }
    }

    const clean = report.failures.length === 0 && report.deferred === 0 && report.unresolved.length === 0;
    if (clean) {
      const value = {
        version: 1,
        completedAt: new Date().toISOString(),
        tenants: report.tenants,
        inserted: report.inserted,
        losers: report.losers.slice(0, MARKER_LIST_CAP),
        renames: report.renames.slice(0, MARKER_LIST_CAP),
        renamed: report.renames.length,
        invalid: report.invalid.slice(0, MARKER_LIST_CAP),
      };
      await control`
        INSERT INTO system_config (key, value, updated_at)
        VALUES (${STORE_SLUG_MARKER_KEY}, ${control.json(value as unknown as Parameters<typeof control.json>[0])}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    }

    report.status = clean ? "complete" : "incomplete";
    log(clean ? "info" : "warn", "store slug backfill finished", {
      status: report.status, tenants: report.tenants, inserted: report.inserted,
      losers: report.losers.length, renamed: report.renames.length, unresolved: report.unresolved.length,
      invalid: report.invalid.length, failures: report.failures.length, deferred: report.deferred,
    });
    return report;
  } finally {
    if (locked) {
      try { await control`SELECT pg_advisory_unlock(${STORE_SLUG_BACKFILL_LOCK_ID})`; } catch { /* connection may be gone */ }
    }
    await control.end({ timeout: 5 });
  }
}

/**
 * Give one loser a new unique slug. One control transaction:
 *   advisory lock (same key as the API's per-business lock) →
 *   per attempt (savepoint): INSERT registry row ON CONFLICT DO NOTHING →
 *   tenant UPDATE guarded by `store_slug = original`.
 * No insert ⇒ fresh prefix. Tenant unique violation ⇒ savepoint rolled back,
 * fresh prefix. Tenant failure or 0 rows (slug changed concurrently) ⇒ the
 * whole transaction rolls back (throws). Returns the new slug, or null when
 * every attempt was a registry conflict.
 */
async function renameLoser(
  control: postgres.Sql,
  renameTenant: TenantRenamer,
  tenant: TenantRow,
  biz: BusinessSlugRow,
  original: string,
  knownSlugs: Map<string, unknown>,
  log: LogFn,
  generate: (original: string) => string,
): Promise<string | null> {
  let committedTenantSlug: string | null = null;
  try {
    return await control.begin(async (tx) => {
      // Serialise with store.updateSettings (applyStoreChange) for this business.
      const lock = storeSlugBusinessLockStatement(tenant.id, biz.id);
      await tx.unsafe(lock.text, lock.params);
      for (let attempt = 0; attempt < FALLBACK_SLUG_MAX_ATTEMPTS; attempt++) {
        const candidate = generate(original);
        if (knownSlugs.has(candidate)) continue; // someone's unregistered slug; don't pre-empt it
        const outcome = await tx.savepoint(async (sp) => {
          // tenant_id comes from the scanned control `tenants` row.
          const ins = await sp`
            INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled)
            SELECT ${candidate}, t.id, ${biz.id}, ${!!biz.store_enabled} FROM tenants t WHERE t.id = ${tenant.id}
            ON CONFLICT DO NOTHING`;
          if (ins.count === 0) return "conflict" as const;
          let affected: number;
          try {
            affected = await renameTenant(tenant, { businessId: biz.id, from: original, to: candidate });
          } catch (err) {
            if (isUnique(err)) throw new RetryAttempt();
            throw err;
          }
          if (affected === 0) throw new Error("tenant business slug changed concurrently (0 rows updated)");
          committedTenantSlug = candidate;
          return "ok" as const;
        }).catch((err) => {
          if (err instanceof RetryAttempt) return "conflict" as const;
          throw err;
        });
        if (outcome === "ok") return candidate;
        log("info", "store slug backfill: replacement slug conflicted, retrying", { attempt });
      }
      return null;
    });
  } catch (err) {
    // Control COMMIT failed after the tenant write: best-effort undo so the
    // tenant does not keep an unregistered auto-assigned slug.
    if (committedTenantSlug) {
      try {
        await renameTenant(tenant, { businessId: biz.id, from: committedTenantSlug, to: original });
      } catch (revertErr) {
        log("error", "store slug backfill: tenant revert failed after control rollback", {
          tenantId: tenant.id, businessId: biz.id, error: revertErr instanceof Error ? revertErr.message : String(revertErr),
        });
      }
    }
    throw err;
  }
}

class RetryAttempt extends Error {}

/** Human-readable report for the CLI. */
export function formatBackfillReport(r: BackfillReport, opts: { dryRun?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(opts.dryRun ? "Store slug registry: DRY RUN (nothing was written)" : `Store slug registry: ${r.status}`);
  lines.push(`  tenants scanned:        ${r.tenants}`);
  if (!r.tableExists) lines.push("  store_slugs table:      does not exist yet (pre-upgrade check)");
  lines.push(`  ${opts.dryRun ? "would insert:          " : "inserted:              "} ${opts.dryRun ? r.wouldInsert : r.inserted}`);
  lines.push(`  ${opts.dryRun ? "would rename:          " : "renamed:               "} ${opts.dryRun ? r.plannedRenames.length : r.renames.length}`);
  lines.push(`  unresolved losers:      ${r.unresolved.length}`);
  lines.push(`  invalid slugs skipped:  ${r.invalid.length}`);
  lines.push(`  tenant read failures:   ${r.failures.length}`);
  lines.push(`  deferred (contested):   ${r.deferred}`);
  if (r.enabledDriftFixed) lines.push(`  store_enabled drift ${opts.dryRun ? "to fix" : "fixed"}: ${r.enabledDriftFixed}`);
  if (r.orphans.length) lines.push(`  orphan registry rows:   ${r.orphans.length}${r.pruned ? ` (pruned ${r.pruned})` : " (use --prune to delete)"}`);
  lines.push("");
  if (r.duplicates.length === 0 && r.losers.length === 0) {
    lines.push("No duplicate slugs across tenants.");
  } else {
    lines.push(`Duplicate slugs (${r.duplicates.length} contested across tenants, ${r.losers.length} losing storefront(s)):`);
    for (const d of r.duplicates) {
      lines.push(`  /store/${d.slug}`);
      lines.push(`    WINNER  tenant ${d.winner.tenantSlug} (${d.winner.tenantId}) business ${d.winner.businessId}`);
      for (const l of d.losers) lines.push(`    loser   tenant ${l.tenantSlug} (${l.tenantId}) business ${l.businessId}`);
    }
    for (const l of r.losers.filter((x) => x.reason === "registry")) {
      lines.push(`  /store/${l.slug}: already registered to business ${l.winnerBusinessId}; tenant ${l.loserTenantId} business ${l.loserBusinessId} loses`);
    }
  }
  if (opts.dryRun && r.plannedRenames.length) {
    lines.push("");
    lines.push(`Planned renames (${r.plannedRenames.length}); each loser gets a random 4-char prefix:`);
    for (const p of r.plannedRenames) {
      lines.push(`  would rename ${p.slug} \u2192 <prefix>-${p.slug}   tenant ${p.tenantSlug} (${p.tenantId}) business ${p.businessId}`);
    }
  }
  if (r.renames.length) {
    lines.push("");
    lines.push(`Renamed (${r.renames.length}):`);
    for (const x of r.renames) lines.push(`  ${x.from} \u2192 ${x.to}   tenant ${x.tenantId} business ${x.businessId}`);
  }
  if (r.unresolved.length) {
    lines.push("");
    lines.push(`Unresolved losers (${r.unresolved.length}; marker withheld, retried next run):`);
    for (const u of r.unresolved) lines.push(`  ${u.slug} tenant ${u.tenantId} business ${u.businessId}: ${u.reason}`);
  }
  if (r.invalid.length) {
    lines.push("");
    lines.push("Invalid slugs (skipped):");
    for (const i of r.invalid) lines.push(`  "${i.slug}" tenant ${i.tenantId} business ${i.businessId}`);
  }
  if (r.failures.length) {
    lines.push("");
    lines.push("Tenant read failures:");
    for (const f of r.failures) lines.push(`  ${f.tenantSlug} (${f.tenantId}): ${f.error}`);
  }
  return lines.join("\n");
}
