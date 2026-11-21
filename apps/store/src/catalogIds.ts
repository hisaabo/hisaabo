/**
 * Helpers for looking items up with `catalog.json?ids=`. Pure, so they can be
 * unit tested; the network call itself is `fetchItemsByIds` in api.ts.
 */
import type { StoreItem } from "./types";

/** Most ids the API accepts in one `?ids=` request. */
export const MAX_IDS_PER_REQUEST = 50;

/**
 * Split ids into requests of at most MAX_IDS_PER_REQUEST, lower-cased,
 * de-duplicated and sorted so the same set of ids always produces the same
 * requests (and so the same CDN cache keys).
 */
export function chunkIds(ids: string[], size = MAX_IDS_PER_REQUEST): string[][] {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
  return chunks;
}

/**
 * Keep only the items that were asked for. An API that predates `?ids=`
 * ignores it and returns the first catalog page, so what comes back must never
 * be trusted to be the requested set.
 */
export function onlyRequestedItems(items: StoreItem[], requestedIds: string[]): StoreItem[] {
  const wanted = new Set(requestedIds.map((id) => id.toLowerCase()));
  return items.filter((item) => wanted.has(item.id.toLowerCase()));
}
