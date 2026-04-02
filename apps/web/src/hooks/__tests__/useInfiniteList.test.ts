/**
 * useInfiniteList — infinite scroll hook tests.
 *
 * Core contract:
 *   1. Accumulates pages without duplicates.
 *   2. Cache invalidation (page 1 refetch) merges updates in-place —
 *      does NOT reset accumulated items (which would cause scroll-to-top).
 *   3. Filter changes reset the list.
 *   4. Correctly reports hasMore, loadingMore, lastBatchSize.
 *   5. Provides a manual loadMore fallback for keyboard/accessibility.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInfiniteList } from "../useInfiniteList";

// ── Test data ────────────────────────────────────────────────────────────────

function makeItems(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${start + i}`,
    name: `Item ${start + i}`,
  }));
}

const page1 = makeItems(1, 5);
const page2 = makeItems(6, 5);
const page3 = makeItems(11, 3);

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderInfiniteList(overrides: Partial<Parameters<typeof useInfiniteList>[0]> = {}) {
  const onLoadMore = vi.fn();
  return renderHook(
    (props) => useInfiniteList(props),
    {
      initialProps: {
        key: "test",
        data: page1,
        total: 13,
        page: 1,
        isFetching: false,
        onLoadMore,
        resetDeps: [],
        ...overrides,
      },
    }
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useInfiniteList — page accumulation", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("loads page 1 data on initial render", () => {
    const { result } = renderInfiniteList();
    expect(result.current.items).toHaveLength(5);
    expect(result.current.items[0].id).toBe("item-1");
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(13);
  });

  it("accumulates page 2 without duplicating page 1", () => {
    const { result, rerender } = renderInfiniteList();
    expect(result.current.items).toHaveLength(5);

    // Simulate page 2 load
    rerender({
      key: "test",
      data: page2,
      total: 13,
      page: 2,
      isFetching: false,
      onLoadMore: vi.fn(),
      resetDeps: [],
    });

    expect(result.current.items).toHaveLength(10);
    expect(result.current.items[0].id).toBe("item-1");
    expect(result.current.items[5].id).toBe("item-6");
    expect(result.current.hasMore).toBe(true);
  });

  it("reports hasMore=false when all items loaded", () => {
    const { result, rerender } = renderInfiniteList();

    rerender({
      key: "test", data: page2, total: 13, page: 2,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });
    rerender({
      key: "test", data: page3, total: 13, page: 3,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });

    expect(result.current.items).toHaveLength(13);
    expect(result.current.hasMore).toBe(false);
  });

  it("deduplicates items by ID when page data overlaps", () => {
    const { result, rerender } = renderInfiniteList();

    // Page 2 has one overlapping item
    const overlapping = [{ id: "item-5", name: "Item 5" }, ...makeItems(6, 4)];
    rerender({
      key: "test", data: overlapping, total: 13, page: 2,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });

    expect(result.current.items).toHaveLength(9); // 5 + 4 new (not 5 + 5)
  });
});

describe("useInfiniteList — cache invalidation (scroll stability)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("does NOT reset accumulated items when page 1 is refetched after invalidation", () => {
    const { result, rerender } = renderInfiniteList();

    // Load page 2
    rerender({
      key: "test", data: page2, total: 13, page: 2,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });
    expect(result.current.items).toHaveLength(10);

    // Simulate cache invalidation: page 1 refetched
    const updatedPage1 = page1.map((item) =>
      item.id === "item-1" ? { ...item, name: "Updated Item 1" } : item
    );
    rerender({
      key: "test", data: updatedPage1, total: 13, page: 1,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });

    // Should still have 10 items (NOT reset to 5)
    expect(result.current.items).toHaveLength(10);
    // The updated item should be merged in-place
    expect(result.current.items[0].name).toBe("Updated Item 1");
    // Page 2 items still present
    expect(result.current.items[5].id).toBe("item-6");
  });

  it("preserves item order during cache invalidation merge", () => {
    const { result, rerender } = renderInfiniteList();

    rerender({
      key: "test", data: page2, total: 13, page: 2,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });

    // Refetch page 1 with no changes
    rerender({
      key: "test", data: page1, total: 13, page: 1,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });

    // Order preserved: items 1-5 then 6-10
    const ids = result.current.items.map((i) => i.id);
    expect(ids).toEqual([
      "item-1", "item-2", "item-3", "item-4", "item-5",
      "item-6", "item-7", "item-8", "item-9", "item-10",
    ]);
  });
});

describe("useInfiniteList — filter reset", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("resets accumulated items when resetDeps change", () => {
    const { result, rerender } = renderInfiniteList({ resetDeps: ["filter-a"] });

    // Accumulate some data
    rerender({
      key: "test", data: page2, total: 13, page: 2,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: ["filter-a"],
    });
    expect(result.current.items).toHaveLength(10);

    // Change filter — should reset
    rerender({
      key: "test", data: makeItems(100, 3), total: 3, page: 1,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: ["filter-b"],
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[0].id).toBe("item-100");
  });
});

describe("useInfiniteList — loading states", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("reports loadingMore=true when fetching with existing items", () => {
    const { result, rerender } = renderInfiniteList();

    rerender({
      key: "test", data: page1, total: 13, page: 1,
      isFetching: true, onLoadMore: vi.fn(), resetDeps: [],
    });

    expect(result.current.loadingMore).toBe(true);
  });

  it("reports loadingMore=false on initial load (no items yet)", () => {
    const { result } = renderInfiniteList({ data: undefined, isFetching: true });
    expect(result.current.loadingMore).toBe(false);
  });

  it("tracks lastBatchSize for aria-live announcements", () => {
    const { result, rerender } = renderInfiniteList();
    expect(result.current.lastBatchSize).toBe(5);

    rerender({
      key: "test", data: page3, total: 13, page: 3,
      isFetching: false, onLoadMore: vi.fn(), resetDeps: [],
    });
    expect(result.current.lastBatchSize).toBe(3);
  });
});

describe("useInfiniteList — removeItem", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("removes an item optimistically by ID", () => {
    const { result } = renderInfiniteList();
    expect(result.current.items).toHaveLength(5);

    act(() => {
      result.current.removeItem("item-3");
    });

    expect(result.current.items).toHaveLength(4);
    expect(result.current.items.find((i) => i.id === "item-3")).toBeUndefined();
  });
});

describe("useInfiniteList — loadMore (accessibility fallback)", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("calls onLoadMore when loadMore is invoked and hasMore is true", () => {
    const onLoadMore = vi.fn();
    const { result } = renderInfiniteList({ onLoadMore });

    act(() => {
      result.current.loadMore();
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore when all items are loaded", () => {
    const onLoadMore = vi.fn();
    const { result } = renderInfiniteList({
      onLoadMore,
      data: makeItems(1, 3),
      total: 3,
    });

    act(() => {
      result.current.loadMore();
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
