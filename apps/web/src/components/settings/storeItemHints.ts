/**
 * The public catalog shows COALESCE(store_description, description): an item
 * with no store-specific description falls back to its internal description
 * (packages/api/src/server.ts, catalog.json). This is the predicate for the
 * "also shown on your online store" helper text in Manage Store Items. The copy
 * does not tell the owner to set a store description: no client can set one.
 *
 * `storeDescription` is checked against null, not emptiness: COALESCE only
 * skips NULL, so an explicitly empty store description hides the fallback.
 */
export const STORE_DESCRIPTION_FALLBACK_NOTE = "This item's description is also shown on your online store.";

export function showsItemDescriptionOnStore(item: {
  description?: string | null;
  storeDescription?: string | null;
}): boolean {
  return !!item.description?.trim() && item.storeDescription == null;
}
