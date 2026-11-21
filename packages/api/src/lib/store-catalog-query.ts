/**
 * store-catalog-query.ts — query parsing and row filters for the public
 * `GET /store/:slug/catalog.json` route in server.ts, extracted so they can be
 * tested without booting the server (which starts listening on import).
 */
import { eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { items } from "@hisaabo/db";
import { escapeLike } from "./escape-like.js";

/** Most item ids one `?ids=` request may name (a cart link carries at most 50 lines). */
export const MAX_CATALOG_IDS = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedCatalogIds = { ok: true; ids: string[] | null } | { ok: false; error: string };

/**
 * Parse the `ids` query parameter: a comma-separated list of item UUIDs.
 *
 * Absent -> `ids: null` (no id filter). Present but empty, containing a blank
 * entry, a non-UUID, or more than {@link MAX_CATALOG_IDS} distinct ids -> an
 * error for a 400. An empty list is rejected rather than treated as "no filter"
 * so a caller whose cart is empty never gets the whole catalog back by mistake.
 * Ids are lower-cased and de-duplicated, keeping first-seen order.
 */
export function parseCatalogIds(raw: string | undefined): ParsedCatalogIds {
  if (raw === undefined) return { ok: true, ids: null };
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => !UUID_RE.test(p))) {
    return { ok: false, error: "ids must be a comma-separated list of item ids (UUIDs)" };
  }
  const ids = [...new Set(parts.map((p) => p.toLowerCase()))];
  if (ids.length > MAX_CATALOG_IDS) {
    return { ok: false, error: `ids may contain at most ${MAX_CATALOG_IDS} item ids` };
  }
  return { ok: true, ids };
}

/**
 * WHERE conditions for a catalog read.
 *
 * `baseConditions` is the store-wide set (the business' store-enabled,
 * non-deleted items) that the category chips are built from; `conditions`
 * additionally applies the caller's category / search / ids filters. An `ids`
 * filter only narrows: it can never reveal an item the store does not publish.
 */
export function storeCatalogConditions(
  businessId: string,
  filters: { category?: string; search?: string; ids?: string[] | null },
): { baseConditions: SQL[]; conditions: SQL[] } {
  const baseConditions: SQL[] = [
    eq(items.businessId, businessId),
    eq(items.storeEnabled, true),
    // Active catalog read — soft-deleted items must never appear in the
    // public store, even if `store_enabled` was not cleared before deletion.
    isNull(items.deletedAt),
  ];
  const conditions = [...baseConditions];
  if (filters.category) conditions.push(eq(sql`COALESCE(${items.storeCategory}, ${items.category})`, filters.category));
  if (filters.search) conditions.push(sql`${items.name} ILIKE ${"%" + escapeLike(filters.search) + "%"}`);
  if (filters.ids) conditions.push(inArray(items.id, filters.ids));
  return { baseConditions, conditions };
}
