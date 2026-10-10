/**
 * store-slug-cache.ts — public /store/:slug resolution with bounded caches.
 *
 * Multi-tenant: control-DB registry lookup (lib/store-slug-registry.ts). The
 * legacy "scan every tenant DB" lookup is kept ONLY while the registry
 * backfill marker is absent (partial/failed backfill must not cause outages).
 * Self-hosted: direct query on the single tenant DB (unchanged).
 *
 * Caches (TtlCache, bounded): positive 5 min / 2000, negative 30 s / 5000.
 * Invalidated by cacheBus "storeSlug" events (old AND new slug) which are
 * emitted synchronously by the write paths and by the DB NOTIFY listener.
 */
import { and, eq } from "drizzle-orm";
import { businesses, controlDb, getTenantDb, tenants } from "@hisaabo/db";
import { TtlCache } from "./cache/ttl-cache.js";
import { cacheBus } from "./cache/bus.js";
import { isRegistryEnabled, isBackfillMarkerPresent, resolveSlug, SLUG_RE } from "./store-slug-registry.js";

export interface ResolvedStore {
  tenantId: string;
  businessId: string;
}

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 30_000;
const MARKER_RECHECK_MS = 60_000;

const positive = new TtlCache<ResolvedStore>({ name: "storeSlug", max: 2000, ttlMs: POSITIVE_TTL_MS });
const negative = new TtlCache<true>({ name: "storeSlugMiss", max: 5000, ttlMs: NEGATIVE_TTL_MS });

// Bumped on every invalidation. A miss is only remembered if no invalidation
// happened while it was being computed (otherwise a just-claimed slug could be
// negatively cached for 30 s).
let epoch = 0;

export function invalidateStoreSlugs(slugs?: readonly string[]): void {
  epoch++;
  if (!slugs || slugs.length === 0) {
    positive.clear();
    negative.clear();
    return;
  }
  for (const s of slugs) {
    positive.delete(s);
    negative.delete(s);
  }
}

cacheBus.on("storeSlug", (e) => invalidateStoreSlugs(e.slugs));

// ── Backfill marker (cached) ───────────────────────────────────

let markerTrue = false;
let markerCheckedAt = 0;
let markerLoad: Promise<boolean> | null = null;

async function backfillComplete(): Promise<boolean> {
  if (markerTrue) return true;
  const now = Date.now();
  if (markerCheckedAt && now - markerCheckedAt < MARKER_RECHECK_MS) return false;
  if (!markerLoad) {
    markerLoad = isBackfillMarkerPresent()
      .then((present) => {
        markerCheckedAt = Date.now();
        if (present) markerTrue = true;
        return present;
      })
      .finally(() => { markerLoad = null; });
  }
  return markerLoad;
}

/** Test hook. */
export function _resetStoreSlugCacheState(): void {
  markerTrue = false;
  markerCheckedAt = 0;
  markerLoad = null;
  positive.reset();
  negative.reset();
}

// ── Lookup ─────────────────────────────────────────────────────

type Loaded = { value: ResolvedStore | undefined; cacheMiss: boolean };

async function loadSelfHosted(slug: string): Promise<Loaded> {
  const db = await getTenantDb("single");
  const [biz] = await db.select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.storeSlug, slug), eq(businesses.storeEnabled, true)))
    .limit(1);
  return biz
    ? { value: { tenantId: "single", businessId: biz.id }, cacheMiss: false }
    : { value: undefined, cacheMiss: true };
}

// TODO: delete one release after every deployment has the backfill marker.
async function legacyScanLookup(slug: string): Promise<Loaded> {
  const activeTenants = await controlDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, "active"));

  let scanComplete = true;
  for (const tenant of activeTenants) {
    try {
      const db = await getTenantDb(tenant.id);
      const [biz] = await db.select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.storeSlug, slug), eq(businesses.storeEnabled, true)))
        .limit(1);
      if (biz) return { value: { tenantId: tenant.id, businessId: biz.id }, cacheMiss: false };
    } catch {
      scanComplete = false;
    }
  }
  return { value: undefined, cacheMiss: scanComplete };
}

async function loadMultiTenant(slug: string): Promise<Loaded> {
  const hit = await resolveSlug(slug);
  if (hit) {
    // A registered-but-disabled store is a definitive miss (no legacy scan:
    // the registry row is authoritative and mirrors store_enabled).
    return hit.storeEnabled
      ? { value: { tenantId: hit.tenantId, businessId: hit.businessId }, cacheMiss: false }
      : { value: undefined, cacheMiss: true };
  }
  if (await backfillComplete()) return { value: undefined, cacheMiss: true };
  return legacyScanLookup(slug);
}

/** slug → { tenantId, businessId } of an ENABLED store, or null. */
export async function resolveStoreSlug(slug: string): Promise<ResolvedStore | null> {
  if (!slug || !SLUG_RE.test(slug)) return null;

  const cached = positive.get(slug);
  if (cached) return cached;
  if (negative.get(slug)) return null;

  const startEpoch = epoch;
  let cacheMiss = false;
  // getOrLoad coalesces concurrent lookups and refuses to store a value whose
  // load overlapped an invalidation of this slug. Errors propagate and are
  // never cached.
  const value = await positive.getOrLoad(slug, async () => {
    const loaded = await (isRegistryEnabled() ? loadMultiTenant(slug) : loadSelfHosted(slug));
    cacheMiss = loaded.cacheMiss;
    return loaded.value;
  });
  if (value) return value;
  if (cacheMiss && epoch === startEpoch) negative.set(slug, true);
  return null;
}
