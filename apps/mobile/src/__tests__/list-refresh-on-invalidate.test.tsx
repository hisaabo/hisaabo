/**
 * list-refresh-on-invalidate.test.tsx — regression for the mobile bug
 * where newly-created invoices / payments did not appear in the list
 * until the user force-refreshed.
 *
 * WHY THIS FILE EXISTS:
 * The bug report described the table failing to update "immediately
 * after a new invoice / payment etc is aligned [saved]". Every paginated
 * list screen on mobile (`(payments)/index.tsx`, `(invoices)/index.tsx`,
 * `(more)/expenses/index.tsx`, …) combines two moving parts:
 *
 *   1. A `trpc.xxx.list.useQuery` hook keyed by the current page.
 *   2. A local `allItems` state populated via `useEffect` from the
 *      query result, using `accumulatePages` to merge pages.
 *
 * The mutation path calls `utils.xxx.list.invalidate()` in `onSuccess`;
 * React Query then refetches the active query (current page) in the
 * background and updates the cached data. Unit tests over
 * `accumulatePages` are necessary but not sufficient — they don't cover
 * the end-to-end path where an invalidation triggers a refetch that
 * returns new data and the component state reflects the new row.
 *
 * This test drives that full path in isolation:
 *   - Wire a TanStack Query `QueryClient` with a single paginated
 *     query, prime page 1 with four items, render a minimal list
 *     that accumulates pages exactly as the real list screens do.
 *   - Assert the initial four rows render.
 *   - Simulate a create: update the mock fetcher so the next refetch
 *     returns a list with the new row at the top, then call
 *     `queryClient.invalidateQueries` — this mirrors the behaviour of
 *     `utils.xxx.list.invalidate()` in the real create flow.
 *   - Assert the new row renders AND the existing rows remain.
 *
 * If this test ever fails, `(payments)/index.tsx`,
 * `(invoices)/index.tsx`, or the underlying `accumulatePages` helper
 * has regressed, and the bug the user reported on Android is back in
 * production.
 */

import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

import { accumulatePages } from "../lib/accumulate-pages";

type ListItem = { id: string; label: string };
type ListPayload = { data: ListItem[]; total: number };

/**
 * Module-level fetcher handle so each test can swap the "server" payload
 * for a given page between the initial fetch and the post-invalidation
 * refetch. Mirrors how a real `trpc.xxx.list.useQuery` hook would see
 * different data across refetches after a mutation lands on the backend.
 */
const serverState = new Map<number, ListPayload>();

function fetchPage(page: number): Promise<ListPayload> {
  // Resolve asynchronously so `useQuery`'s fetch lifecycle matches the
  // real network-driven path (initial state → fetching → success).
  return Promise.resolve(
    serverState.get(page) ?? { data: [], total: 0 },
  );
}

/**
 * A minimal component that mirrors the page-accumulation pattern used
 * by `(payments)/index.tsx` and `(invoices)/index.tsx`. Kept in the
 * test file rather than as an exported hook so the regression target is
 * unambiguous: if this component's behaviour is what the real screens
 * implement, and this test passes, the screens work.
 */
function AccumulatingList({ page }: { page: number }) {
  const { data } = useQuery<ListPayload>({
    queryKey: ["list", page],
    queryFn: () => fetchPage(page),
  });

  const [allItems, setAllItems] = useState<ListItem[]>([]);

  useEffect(() => {
    if (data?.data) {
      setAllItems((prev) => accumulatePages(prev, data.data, page));
    }
  }, [data?.data, page]);

  // Plain View/Text rather than FlatList: FlatList's windowing layer is
  // asynchronous in the react-test-renderer environment (layout events
  // never fire, so many rows never enter the render tree), which
  // obscures the refetch observable we're testing here. The real
  // screens under test use FlatList, but the bug is in the
  // accumulation hook — not in how the list virtualises — so the
  // unwindowed render is a faithful stand-in for the assertion we care
  // about: "the rendered rows reflect the latest query data".
  return (
    <View testID="list">
      {allItems.map((item) => (
        <Text key={item.id} testID={`row-${item.id}`}>
          {item.label}
        </Text>
      ))}
    </View>
  );
}

describe("paginated list screens refresh on tRPC invalidation — mobile BUG 1 regression", () => {
  function makeClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: {
          // Match production mobile config (`src/lib/query-client.ts`)
          // so the test exercises the same staleness semantics users
          // experience.
          staleTime: 1000 * 30,
          retry: false,
          refetchOnWindowFocus: false,
        },
      },
    });
  }

  const openClients: QueryClient[] = [];

  beforeEach(() => {
    serverState.clear();
  });

  afterEach(() => {
    // Drain any pending queries so Jest can exit cleanly — without
    // this cleanup the QueryClient keeps observers alive and Jest
    // prints "did not exit one second after the test run".
    while (openClients.length > 0) {
      const client = openClients.pop();
      client?.cancelQueries();
      client?.clear();
      client?.unmount();
      client?.getQueryCache().clear();
      client?.getMutationCache().clear();
    }
  });

  function trackedClient(): QueryClient {
    const client = makeClient();
    openClients.push(client);
    return client;
  }

  it("shows a newly-created row after `queryClient.invalidateQueries` refetches page 1 — the bug this test pins", async () => {
    const queryClient = trackedClient();

    // Seed page 1 with four existing items (newest first — matches
    // real API ordering for invoice/payment lists).
    const initialItems: ListItem[] = [
      { id: "inv-4", label: "Invoice 4" },
      { id: "inv-3", label: "Invoice 3" },
      { id: "inv-2", label: "Invoice 2" },
      { id: "inv-1", label: "Invoice 1" },
    ];
    serverState.set(1, { data: initialItems, total: 4 });

    const { queryByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <AccumulatingList page={1} />
      </QueryClientProvider>,
    );

    // Initial render — four rows.
    await waitFor(() => {
      expect(queryByTestId("row-inv-1")).toBeTruthy();
      expect(queryByTestId("row-inv-4")).toBeTruthy();
    });
    expect(queryByTestId("row-inv-new")).toBeNull();

    // Simulate a create: user taps the FAB, submits the form, the
    // mutation's onSuccess calls `utils.invoice.list.invalidate()`
    // AND the server now has a fresh row at the top. We mirror that
    // by updating what the mocked fetcher will return, then
    // invalidate to trigger a real refetch through the query's
    // `queryFn` — same observer-update cycle the real component
    // exercises after a mutation lands.
    serverState.set(1, {
      data: [
        { id: "inv-new", label: "Freshly Created" },
        ...initialItems,
      ],
      total: 5,
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["list", 1] });
    });

    await waitFor(() => {
      // The core assertion: the new row is visible without a manual
      // pull-to-refresh.
      expect(queryByTestId("row-inv-new")).toBeTruthy();
    });

    // And the existing rows are still there — the list did not
    // collapse to just the new item (which would break scroll).
    expect(queryByTestId("row-inv-1")).toBeTruthy();
    expect(queryByTestId("row-inv-4")).toBeTruthy();
  });

  it("reflects a status change on a page-2 row after invalidation — page > 1 refetch must merge updates", async () => {
    // WHY this scenario matters: a user who has scrolled past page 1
    // and then edits an invoice's status (Mark as Sent) expects the
    // change to show up on the row they were looking at. If the
    // accumulator replaced rather than merged, the row would either
    // disappear or keep the stale status until a full pull-to-refresh.
    const queryClient = trackedClient();

    const page1: ListItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `row-${i + 1}`,
      label: `Row ${i + 1}`,
    }));
    const page2: ListItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `row-${i + 21}`,
      label: `Row ${i + 21}`,
    }));

    serverState.set(1, { data: page1, total: 40 });
    serverState.set(2, { data: page2, total: 40 });

    // Render the component at page=1 first, then move to page=2 so
    // the accumulator builds up the way it does in production.
    const { rerender, queryByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <AccumulatingList page={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryByTestId("row-row-1")).toBeTruthy());

    rerender(
      <QueryClientProvider client={queryClient}>
        <AccumulatingList page={2} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryByTestId("row-row-21")).toBeTruthy());

    // Simulate editing row-21's label (stand-in for a status change)
    // and invalidating page 2 — the refetch will return the updated
    // payload.
    serverState.set(2, {
      data: page2.map((r) =>
        r.id === "row-21" ? { ...r, label: "Updated 21" } : r,
      ),
      total: 40,
    });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["list", 2] });
    });

    await waitFor(() => {
      const node = queryByTestId("row-row-21");
      expect(node).toBeTruthy();
      // children[0] is the text; assert the label updated.
      expect(node?.props.children).toBe("Updated 21");
    });
  });
});
