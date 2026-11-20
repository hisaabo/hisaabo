/**
 * store-slug-registry.ts — the ONLY module that reads or writes the control-DB
 * `store_slugs` table (multi-tenant storefront slug registry).
 *
 * Semantics: see the comment above `storeSlugs` in packages/db/src/control-schema.ts.
 *
 * SECURITY (tenants share this table, so no tenant may affect another):
 *   - `tenantId` is ALWAYS a parameter the caller takes from the authenticated
 *     server context (ctx.tenantId / the import token's tenant), never from
 *     request input or a value read out of a tenant database.
 *   - Live rows are only updated/released with `WHERE tenant_id = <caller>`;
 *     the claim upsert's ON CONFLICT ... WHERE refuses to touch a live row that
 *     belongs to another tenant (and a released row of another tenant until the
 *     30-day hold has elapsed). No statement here ever DELETEs a row.
 *   - Parameterised SQL only (drizzle `sql` template); no sql.raw.
 *   - Slug format is re-validated here (and by the table CHECK).
 */
import { sql } from "drizzle-orm";
import { controlDb, STORE_SLUG_MARKER_KEY } from "@hisaabo/db";
import { cacheBus } from "./cache/bus.js";
import { logger } from "./logger.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Evaluated at CALL time so tests (and late env setup) can toggle it. */
export function isRegistryEnabled(): boolean {
  return process.env.MULTI_TENANT === "true";
}

export class SlugConflictError extends Error {
  constructor(public readonly slug: string) {
    super("This store URL is already taken. Please choose a different one.");
    this.name = "SlugConflictError";
  }
}

export interface ResolvedSlug {
  tenantId: string;
  businessId: string;
  storeEnabled: boolean;
}

// Drizzle's transaction handle and controlDb share `execute`.
type Exec = Pick<typeof controlDb, "execute">;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** True when the error is a PG unique violation (tenant-DB or control-DB). */
export { isUniqueViolation };

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error("Invalid store slug");
}

/** Local + (via NOTIFY trigger) cross-replica cache invalidation. */
export function notifySlugsChanged(slugs: Array<string | null | undefined>): void {
  const uniq = [...new Set(slugs.filter((s): s is string => !!s))];
  if (uniq.length) cacheBus.invalidate({ kind: "storeSlug", slugs: uniq });
}

// ── Reads ──────────────────────────────────────────────────────

/** Public lookup: one PK hit joined to an ACTIVE tenant, live rows only. */
export async function resolveSlug(slug: string): Promise<ResolvedSlug | null> {
  if (!SLUG_RE.test(slug)) return null;
  const rows = await controlDb.execute<{ tenant_id: string; business_id: string; store_enabled: boolean }>(sql`
    SELECT s.tenant_id, s.business_id, s.store_enabled
      FROM store_slugs s
      JOIN tenants t ON t.id = s.tenant_id
     WHERE s.slug = ${slug} AND s.released_at IS NULL AND t.status = 'active'
     LIMIT 1`);
  const r = rows[0];
  return r ? { tenantId: r.tenant_id, businessId: r.business_id, storeEnabled: r.store_enabled } : null;
}

/** Has the run-once backfill completed (marker row present)? */
export async function isBackfillMarkerPresent(): Promise<boolean> {
  const rows = await controlDb.execute(sql`SELECT 1 FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY} LIMIT 1`);
  return rows.length > 0;
}

/**
 * Availability for store.checkSlug (global). A slug is available to
 * (tenant, business) when there is no row, when the caller's own business
 * holds it, when it is a released slug of the caller's tenant, or when it was
 * released by another tenant more than 30 days ago.
 */
export async function checkAvailability(slug: string, tenantId: string, businessId: string): Promise<boolean> {
  if (!SLUG_RE.test(slug)) return false;
  const rows = await controlDb.execute<{ available: boolean }>(sql`
    SELECT (
      (s.released_at IS NULL AND s.tenant_id = ${tenantId} AND s.business_id = ${businessId})
      OR (s.released_at IS NOT NULL AND s.tenant_id = ${tenantId})
      OR (s.released_at IS NOT NULL AND s.released_at < now() - interval '30 days')
    ) AS available
    FROM store_slugs s WHERE s.slug = ${slug}`);
  const r = rows[0];
  return r ? r.available === true : true;
}

// ── Writes (all take an Exec so they can run inside a transaction) ──

/**
 * Claim `slug` for (tenant, business). Throws SlugConflictError when the slug
 * is live for anyone else, or released by another tenant < 30 days ago.
 * The caller must have released the business's previous live slug first
 * (partial unique index on (tenant_id, business_id) WHERE released_at IS NULL).
 */
export async function claimSlug(
  tx: Exec,
  p: { tenantId: string; businessId: string; slug: string; storeEnabled: boolean },
): Promise<void> {
  assertSlug(p.slug);
  const rows = await tx.execute(sql`
    INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled, released_at, created_at, updated_at)
    VALUES (${p.slug}, ${p.tenantId}, ${p.businessId}, ${p.storeEnabled}, NULL, now(), now())
    ON CONFLICT (slug) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      business_id = EXCLUDED.business_id,
      store_enabled = EXCLUDED.store_enabled,
      released_at = NULL,
      updated_at = now()
    WHERE (store_slugs.tenant_id = EXCLUDED.tenant_id
           AND (store_slugs.business_id = EXCLUDED.business_id OR store_slugs.released_at IS NOT NULL))
       OR (store_slugs.released_at IS NOT NULL AND store_slugs.released_at < now() - interval '30 days')
    RETURNING slug`);
  if (rows.length === 0) throw new SlugConflictError(p.slug);
}

/** Release the business's live slug(s) (keeps the row, 30-day hold). Own tenant only. */
export async function releaseSlug(
  tx: Exec,
  p: { tenantId: string; businessId: string; exceptSlug?: string },
): Promise<string[]> {
  const rows = await tx.execute<{ slug: string }>(sql`
    UPDATE store_slugs SET released_at = now(), updated_at = now()
     WHERE tenant_id = ${p.tenantId} AND business_id = ${p.businessId}
       AND released_at IS NULL
       AND slug IS DISTINCT FROM ${p.exceptSlug ?? null}
    RETURNING slug`);
  return rows.map((r) => r.slug);
}

/** Mirror store_enabled onto the business's live row. Own tenant only. */
export async function setEnabled(
  tx: Exec,
  p: { tenantId: string; businessId: string; storeEnabled: boolean },
): Promise<string[]> {
  const rows = await tx.execute<{ slug: string }>(sql`
    UPDATE store_slugs SET store_enabled = ${p.storeEnabled}, updated_at = now()
     WHERE tenant_id = ${p.tenantId} AND business_id = ${p.businessId} AND released_at IS NULL
    RETURNING slug`);
  return rows.map((r) => r.slug);
}

async function lockBusiness(tx: Exec, tenantId: string, businessId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":" + businessId}, 0))`);
}

export interface StoreChange<T> {
  tenantId: string;
  businessId: string;
  /** Desired live slug after the change (null = no slug). */
  newSlug: string | null;
  newEnabled: boolean;
  /** Slug currently in the tenant DB (for cache invalidation only). */
  oldSlug: string | null;
  /** The tenant-DB write. Runs inside the control transaction. */
  runTenantUpdate: () => Promise<T>;
  /** Best-effort undo of the tenant write if the control COMMIT fails. */
  revertTenant?: () => Promise<void>;
}

/**
 * One control transaction around the tenant write:
 *   lock → release old → claim new (or release all) → mirror enabled →
 *   tenant UPDATE → COMMIT.
 * A tenant failure rolls the control change back. A control COMMIT failure
 * after the tenant write triggers a best-effort tenant revert + error log.
 * The slug caches are invalidated in `finally` (success or failure).
 */
export async function applyStoreChange<T>(c: StoreChange<T>): Promise<T> {
  let tenantDone = false;
  try {
    return await controlDb.transaction(async (tx) => {
      await lockBusiness(tx, c.tenantId, c.businessId);
      if (c.newSlug === null) {
        await releaseSlug(tx, { tenantId: c.tenantId, businessId: c.businessId });
      } else {
        await releaseSlug(tx, { tenantId: c.tenantId, businessId: c.businessId, exceptSlug: c.newSlug });
        await claimSlug(tx, {
          tenantId: c.tenantId, businessId: c.businessId, slug: c.newSlug, storeEnabled: c.newEnabled,
        });
      }
      const out = await c.runTenantUpdate();
      tenantDone = true;
      return out;
    });
  } catch (err) {
    if (tenantDone) {
      logger.error(
        { err, event: "store_slug_registry_drift", tenantId: c.tenantId, businessId: c.businessId, slug: c.newSlug },
        "control commit failed after tenant write; reverting tenant row",
      );
      try {
        await c.revertTenant?.();
      } catch (revertErr) {
        logger.error({ err: revertErr, event: "store_slug_registry_drift", tenantId: c.tenantId, businessId: c.businessId }, "tenant revert failed; run --reconcile-store-slugs");
      }
    }
    throw err;
  } finally {
    notifySlugsChanged([c.oldSlug, c.newSlug]);
  }
}

// ── Self-import ────────────────────────────────────────────────

export interface ImportedBusinessSlug {
  id: string;
  storeSlug: string | null;
  storeEnabled: boolean;
}

export type ImportRegistration =
  | { businessId: string; slug: string; status: "registered" }
  | { businessId: string; slug: string; status: "conflict" }
  | { businessId: string; slug: string; status: "error" };

/**
 * Register imported businesses' slugs under the AUTHENTICATED tenant. The
 * business ids/slugs come from an untrusted backup file, but they can only
 * ever create/refresh rows owned by `tenantId`; a slug owned by anyone else
 * (or held <30 days by another tenant) yields "conflict" and nothing changes.
 * Each business gets its own control transaction.
 */
export async function registerImportedSlugs(
  tenantId: string,
  rows: ImportedBusinessSlug[],
): Promise<ImportRegistration[]> {
  const out: ImportRegistration[] = [];
  const touched: string[] = [];
  try {
    for (const r of rows) {
      if (!r.storeSlug) continue;
      const slug = r.storeSlug;
      if (!SLUG_RE.test(slug)) {
        out.push({ businessId: r.id, slug, status: "conflict" });
        continue;
      }
      try {
        await controlDb.transaction(async (tx) => {
          await lockBusiness(tx, tenantId, r.id);
          await releaseSlug(tx, { tenantId, businessId: r.id, exceptSlug: slug });
          await claimSlug(tx, { tenantId, businessId: r.id, slug, storeEnabled: r.storeEnabled });
        });
        touched.push(slug);
        out.push({ businessId: r.id, slug, status: "registered" });
      } catch (err) {
        if (err instanceof SlugConflictError || isUniqueViolation(err)) {
          out.push({ businessId: r.id, slug, status: "conflict" });
        } else {
          logger.error({ err, tenantId, businessId: r.id }, "self-import: slug registration failed");
          out.push({ businessId: r.id, slug, status: "error" });
        }
      }
    }
  } finally {
    notifySlugsChanged(touched);
  }
  return out;
}
