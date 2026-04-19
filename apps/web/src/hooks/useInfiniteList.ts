import { useState, useEffect, useRef, useCallback } from "react";

interface UseInfiniteListOptions<T> {
  /** Unique key for this list — used for sessionStorage scroll position */
  key: string;
  /** Current page's data */
  data: T[] | undefined;
  /** Total count from server */
  total: number;
  /** Current page number (managed by the caller) */
  page: number;
  /** Whether the query is currently fetching */
  isFetching: boolean;
  /** Called when more items need to be loaded */
  onLoadMore: () => void;
  /** Dependencies that should reset the list (filter changes) */
  resetDeps: unknown[];
}

interface UseInfiniteListReturn<T> {
  /** All accumulated items across pages */
  items: T[];
  /** Total count from server */
  total: number;
  /** Whether more pages exist */
  hasMore: boolean;
  /** Whether currently loading more (not the initial load) */
  loadingMore: boolean;
  /** Ref to attach to the scrollable container */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Scroll event handler to attach to the container */
  onScroll: () => void;
  /** Optimistically remove an item by ID (e.g., after delete) */
  removeItem: (id: string) => void;
  /** Manually trigger loading the next page (keyboard/button fallback) */
  loadMore: () => void;
  /** Number of new items loaded in the last batch (for aria-live) */
  lastBatchSize: number;
}

export function useInfiniteList<T extends { id: string }>({
  key,
  data,
  total,
  page,
  isFetching,
  onLoadMore,
  resetDeps,
}: UseInfiniteListOptions<T>): UseInfiniteListReturn<T> {
  const [allItems, setAllItems] = useState<T[]>([]);
  const [lastBatchSize, setLastBatchSize] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const pageRef = useRef(page);
  const storageKey = `hisaabo-scroll-${key}`;

  pageRef.current = page;

  // Reset on filter change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAllItems([]);
    setLastBatchSize(0);
    restoredRef.current = false;
    sessionStorage.removeItem(storageKey);
  }, resetDeps);

  // Accumulate pages — NEVER replace accumulated items when page > 1.
  // When page === 1 and we already have accumulated items from pages > 1,
  // this is a cache invalidation refetch — merge updates into existing items
  // (preserves scroll) and prepend any genuinely new items (so newly created
  // records appear at the top immediately without a page refresh).
  useEffect(() => {
    if (!data) return;

    setAllItems((prev) => {
      if (page === 1 && prev.length === 0) {
        // Initial load — just set the data
        setLastBatchSize(data.length);
        return data;
      }

      if (page === 1 && prev.length > 0) {
        // Cache invalidation refetch of page 1 while we have accumulated items.
        // 1. Update existing items in place (preserves scroll position for status changes).
        // 2. Prepend genuinely new items so freshly created records appear immediately.
        // Assumes lists sort newest-first by date/createdAt (true for invoices, payments,
        // expenses, shipments, accounts in this app). If a list is ascending, a new item
        // may briefly appear out of order at the top — transient and strictly better than
        // the record being invisible until a page refresh.
        const freshById = new Map(data.map((item) => [item.id, item]));
        const updated = prev.map((p) => freshById.get(p.id) ?? p);
        const prevIds = new Set(prev.map((p) => p.id));
        const newItems = data.filter((d) => !prevIds.has(d.id));
        if (newItems.length > 0) setLastBatchSize(newItems.length);
        return [...newItems, ...updated];
      }

      // page > 1: append new items, dedup by id
      const existingIds = new Set(prev.map((item) => item.id));
      const newItems = data.filter((item) => !existingIds.has(item.id));
      setLastBatchSize(newItems.length);
      return [...prev, ...newItems];
    });
  }, [data, page]);

  // Restore scroll position after data loads
  useEffect(() => {
    if (restoredRef.current || !scrollRef.current || allItems.length === 0) return;
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const { scrollTop, itemCount } = JSON.parse(saved) as {
        scrollTop: number;
        itemCount: number;
      };
      if (allItems.length >= itemCount) {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollTop;
          }
        });
        restoredRef.current = true;
      } else if (!isFetching) {
        onLoadMore();
      }
    } else {
      restoredRef.current = true;
    }
  // onLoadMore is intentionally excluded — it's a stable callback from the parent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems.length, isFetching, storageKey]);

  const hasMore = allItems.length < total;

  // Use refs for values that onScroll needs but shouldn't cause re-creation
  const isFetchingRef = useRef(isFetching);
  const hasMoreRef = useRef(hasMore);
  const itemCountRef = useRef(allItems.length);
  isFetchingRef.current = isFetching;
  hasMoreRef.current = hasMore;
  itemCountRef.current = allItems.length;

  // Stable scroll handler — does not change identity when data changes
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Persist scroll position to sessionStorage (survives navigation within tab)
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ scrollTop: el.scrollTop, itemCount: itemCountRef.current })
    );

    // Load more when within 150px of the bottom
    if (!isFetchingRef.current && hasMoreRef.current && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      onLoadMore();
    }
  }, [onLoadMore, storageKey]);

  // Remove an item optimistically (e.g., after delete)
  const removeItem = useCallback((id: string) => {
    setAllItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Manual load-more (keyboard/button accessible fallback)
  const loadMore = useCallback(() => {
    if (!isFetchingRef.current && hasMoreRef.current) {
      onLoadMore();
    }
  }, [onLoadMore]);

  return {
    items: allItems,
    total,
    hasMore,
    loadingMore: isFetching && allItems.length > 0,
    scrollRef: scrollRef as React.RefObject<HTMLDivElement>,
    onScroll,
    removeItem,
    loadMore,
    lastBatchSize,
  };
}
