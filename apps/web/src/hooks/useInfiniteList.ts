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
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const storageKey = `hisaabo-scroll-${key}`;

  // Reset on filter change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAllItems([]);
    restoredRef.current = false;
    sessionStorage.removeItem(storageKey);
  }, resetDeps);

  // Accumulate pages
  useEffect(() => {
    if (!data) return;
    setAllItems((prev) => {
      if (page === 1) return data;
      const existingIds = new Set(prev.map((item) => item.id));
      const newItems = data.filter((item) => !existingIds.has(item.id));
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
        // Need to load more pages to reach the saved position
        onLoadMore();
      }
    } else {
      restoredRef.current = true;
    }
  // onLoadMore is intentionally excluded — it's a stable callback from the parent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems.length, isFetching, storageKey]);

  const hasMore = allItems.length < total;

  // Save scroll position on scroll and trigger infinite load near bottom
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Persist scroll position to sessionStorage (survives navigation within tab)
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ scrollTop: el.scrollTop, itemCount: allItems.length })
    );

    // Load more when within 150px of the bottom
    if (!isFetching && hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      onLoadMore();
    }
  }, [isFetching, hasMore, allItems.length, onLoadMore, storageKey]);

  // Remove an item optimistically (e.g., after delete)
  const removeItem = useCallback((id: string) => {
    setAllItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return {
    items: allItems,
    total,
    hasMore,
    loadingMore: isFetching && allItems.length > 0,
    scrollRef: scrollRef as React.RefObject<HTMLDivElement>,
    onScroll,
    removeItem,
  };
}
