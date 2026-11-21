/**
 * The public catalog shows COALESCE(store_description, description): an item
 * with no store-specific description falls back to its internal description
 * (packages/api/src/server.ts, catalog.json). This is the predicate for the
 * "also shown on your online store" helper text in Manage Store Items.
 *
 * `storeDescription` is checked against null, not emptiness: COALESCE only
 * skips NULL, so an explicitly empty store description hides the fallback.
 */
export const STORE_DESCRIPTION_FALLBACK_NOTE =
  "Its item description is also shown on your online store unless you set a store description.";

export function showsItemDescriptionOnStore(item: {
  description?: string | null;
  storeDescription?: string | null;
}): boolean {
  return !!item.description?.trim() && item.storeDescription == null;
}
