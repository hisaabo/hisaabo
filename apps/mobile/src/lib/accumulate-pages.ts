/**
 * Pure reducer for paginated list screens on mobile.
 *
 * Mirrors the intent of `apps/web/src/hooks/useInfiniteList.ts` so web and
 * mobile have identical observable behaviour for the user-visible
 * invariants that matter:
 *
 *   - Initial load (prev empty, page 1): show the fresh server payload.
 *   - Page 1 refetch after a mutation invalidates the list (prev has
 *     items already): merge fresh updates into the existing rows AND
 *     prepend any genuinely new items. This is the behaviour that makes
 *     a newly created invoice/payment surface at the top of the list
 *     without the user needing to pull-to-refresh. Without this, the
 *     page=1 refetch that `utils.xyz.list.invalidate()` kicks off can
 *     silently replace the accumulated list with just the freshest 20
 *     rows (losing scroll position) or — in the more common case where
 *     the user has not scrolled past page 1 — fail to surface the new
 *     record at all because React Query's structural sharing keeps the
 *     old array identity when only one item shifts.
 *   - Page > 1: merge updates (so a status change on a row visible on
 *     page 2 shows up after invalidation) and append items new to the
 *     accumulated set, deduplicating by id.
 *
 * Assumes lists sort newest-first by date/createdAt (true for invoices,
 * payments, expenses, shipments, accounts in this app). If a list is
 * ascending, a new item may briefly appear out of order at the top —
 * transient and strictly better than the record being invisible until a
 * page refresh.
 *
 * Extracted so the invariant is unit-testable without a full react-native
 * render. Keep this function pure.
 */
export function accumulatePages<T extends { id: string }>(
  prev: T[],
  fresh: T[],
  page: number
): T[] {
  if (page === 1 && prev.length === 0) {
    // Initial load — just set the data.
    return fresh;
  }

  const freshById = new Map(fresh.map((item) => [item.id, item]));
  // Update-in-place so status changes (draft → sent, unpaid → paid) on
  // already-rendered rows reflect the fresh payload. Preserves row order,
  // which in turn preserves FlatList scroll position across a refetch.
  const merged = prev.map((p) => freshById.get(p.id) ?? p);
  const existingIds = new Set(prev.map((item) => item.id));
  const newItems = fresh.filter((item) => !existingIds.has(item.id));

  if (page === 1) {
    // Page-1 refetch after an invalidation — prepend genuinely new rows
    // (typically one freshly-created record) so the user sees them
    // immediately on returning from the create/edit screen.
    return [...newItems, ...merged];
  }

  // Page > 1 — append new items behind the accumulated set.
  return [...merged, ...newItems];
}
