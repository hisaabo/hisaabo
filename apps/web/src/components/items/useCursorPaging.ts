import { useCallback, useRef, useState } from "react";

/**
 * Offset-cursor state for `useInfiniteList`. The cursor snaps back to 0 as
 * soon as `filterKey` changes (period / unit / type), without a render where a
 * stale cursor is paired with the new filters.
 */
export function useCursorPaging(filterKey: string, limit: number) {
  const [state, setState] = useState({ key: filterKey, cursor: 0 });
  const cursor = state.key === filterKey ? state.cursor : 0;
  const nextRef = useRef<number | null>(null);

  const setNextCursor = (next: number | null | undefined) => {
    nextRef.current = next ?? null;
  };
  const loadMore = useCallback(() => {
    if (nextRef.current !== null) setState({ key: filterKey, cursor: nextRef.current });
  }, [filterKey]);

  return { cursor, page: Math.floor(cursor / limit) + 1, loadMore, setNextCursor };
}
