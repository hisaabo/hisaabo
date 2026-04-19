/**
 * Pure reducer for paginated list screens on mobile.
 *
 * Mirrors the intent of `apps/web/src/hooks/useInfiniteList.ts`:
 *   - page 1: show the fresh server payload (so newly created records
 *     surface immediately after a cache invalidation)
 *   - page > 1: append new items, dedup by id
 *
 * Extracted so the invariant is unit-testable without a full
 * react-native render. Keep this function pure.
 */
export function accumulatePages<T extends { id: string }>(
  prev: T[],
  fresh: T[],
  page: number
): T[] {
  if (page === 1) return fresh;
  const existingIds = new Set(prev.map((item) => item.id));
  const newItems = fresh.filter((item) => !existingIds.has(item.id));
  return [...prev, ...newItems];
}
