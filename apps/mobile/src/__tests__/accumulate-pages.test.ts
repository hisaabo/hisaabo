/**
 * accumulate-pages.test.ts — mobile list accumulation contract.
 *
 * Parallel to `apps/web/src/hooks/__tests__/useInfiniteList.test.ts`.
 * Pins the invariant that when a mobile list screen (invoices,
 * payments, expenses, etc.) refetches page 1 after a cache
 * invalidation following a create, the new record appears in the
 * visible list without requiring pull-to-refresh. This is the mobile
 * mirror of the web fix in `useInfiniteList` that prepends new items
 * on page-1 refetch.
 */

import { accumulatePages } from "../lib/accumulate-pages";

type Item = { id: string; name: string };

function makeItems(start: number, count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${start + i}`,
    name: `Item ${start + i}`,
  }));
}

describe("accumulatePages — mobile list accumulation contract", () => {
  it("shows fresh page-1 data on initial load", () => {
    const page1 = makeItems(1, 5);
    expect(accumulatePages<Item>([], page1, 1)).toEqual(page1);
  });

  it("appends page 2 items without duplicating page 1", () => {
    const prev = makeItems(1, 5);
    const page2 = makeItems(6, 5);
    const result = accumulatePages(prev, page2, 2);
    expect(result).toHaveLength(10);
    expect(result[0].id).toBe("item-1");
    expect(result[5].id).toBe("item-6");
  });

  it("deduplicates by id when page 2 overlaps with page 1", () => {
    const prev = makeItems(1, 5);
    const overlapping: Item[] = [{ id: "item-5", name: "Item 5" }, ...makeItems(6, 4)];
    const result = accumulatePages(prev, overlapping, 2);
    expect(result).toHaveLength(9);
  });

  it("shows newly created record when page 1 is refetched after invalidation — the bug this fix addresses", () => {
    // Scenario: user is on the invoice list (page 1, 5 items visible).
    // They tap FAB, create a new invoice, and return to the list.
    // Mobile's create.tsx invalidates invoice.list, refetching page 1
    // with the new record at the top (lists are sorted newest-first).
    //
    // EXPECTED: the new invoice appears at the top AND the previously-
    // visible rows stay in place (so FlatList scroll position is not
    // reset). On a 20-item page boundary the oldest row that would have
    // slid off-page-1 will temporarily remain — this mirrors web's
    // `useInfiniteList` and is strictly preferable to the new record
    // being invisible.
    const beforeCreate = makeItems(1, 5);
    const newInvoice: Item = { id: "inv-new", name: "Freshly Created" };
    const refreshedPage1: Item[] = [newInvoice, ...beforeCreate.slice(0, 4)];

    const result = accumulatePages(beforeCreate, refreshedPage1, 1);

    expect(result[0].id).toBe("inv-new");
    // New item prepended; all original items preserved (merged in place).
    expect(result.map((item) => item.id)).toEqual([
      "inv-new",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
      "item-5",
    ]);
  });

  it("merges updates from a page-1 refetch so status changes become visible", () => {
    // Scenario: status change (Mark as Sent) on an invoice — the refetch
    // returns the same ids but with a mutated field. The list must show
    // the updated row without losing scroll position.
    const prev = makeItems(1, 5);
    const updated: Item[] = prev.map((item) =>
      item.id === "item-1" ? { ...item, name: "Updated Item 1" } : item
    );

    const result = accumulatePages(prev, updated, 1);

    expect(result[0].name).toBe("Updated Item 1");
    expect(result).toHaveLength(5);
  });

  it("merges updates from a page > 1 refetch so status changes stay in sync", () => {
    // Scenario: user scrolled to page 2 (40 items loaded), a status
    // change occurs on a row that lives in page 2's range. Mobile's
    // invalidation refetches the currently-active page (2) — the fresh
    // payload must overwrite the stale row without duplicating or
    // reordering items.
    const page1 = makeItems(1, 20);
    const page2 = makeItems(21, 20);
    const accumulated = [...page1, ...page2];
    const updatedPage2: Item[] = page2.map((item) =>
      item.id === "item-21" ? { ...item, name: "Status Changed" } : item
    );

    const result = accumulatePages(accumulated, updatedPage2, 2);

    expect(result).toHaveLength(40);
    const updatedRow = result.find((r) => r.id === "item-21");
    expect(updatedRow?.name).toBe("Status Changed");
  });
});
