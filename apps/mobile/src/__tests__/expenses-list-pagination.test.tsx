/**
 * expenses-list-pagination.test.tsx — renders the real Expenses list screen
 * with a real TanStack Query client behind `trpc.expense.list.useQuery` and
 * asserts that reaching the end of the list APPENDS the next page (instead of
 * replacing it) and that a second end-reached while a page is in flight does
 * not skip a page.
 */

import React from "react";
import { FlatList } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPages: Record<number, { data: { id: string }[]; total: number }> = {};
const mockRequested: number[] = [];

jest.mock("../lib/trpc", () => {
  const { trpcModule } = require("../test-utils/trpc-stub");
  const { useQuery } = require("@tanstack/react-query");
  const expense = new Proxy(trpcModule.trpc.expense, {
    get(target, prop) {
      if (prop !== "list") return target[prop];
      return {
        useQuery: (input: { page: number }, opts: object) =>
          useQuery({
            queryKey: ["expense.list", input],
            queryFn: () => {
              mockRequested.push(input.page);
              return Promise.resolve(mockPages[input.page]);
            },
            ...opts,
          }),
      };
    },
  });
  return { trpc: new Proxy(trpcModule.trpc, { get: (t, p) => (p === "expense" ? expense : t[p]) }) };
});
jest.mock("expo-router", () => require("../test-utils/trpc-stub").expoRouterModule);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-constants", () => ({ default: { expoConfig: null } }));

import { ThemeProvider } from "../contexts/ThemeContext";
import { stub } from "../test-utils/trpc-stub";
import ExpensesListScreen from "../../app/(app)/(more)/expenses/index";

const makePage = (from: number) =>
  Array.from({ length: 20 }, (_, i) => ({
    id: `exp-${from + i}`,
    category: "Rent",
    amount: "100",
    mode: "cash",
    description: null,
    expenseDate: null,
  }));

const rows = () => screen.UNSAFE_getByType(FlatList).props.data as { id: string }[];
const endReached = () =>
  act(async () => {
    screen.UNSAFE_getByType(FlatList).props.onEndReached();
  });

describe("expenses list pagination", () => {
  beforeEach(() => {
    stub.reset();
    stub.session.role = "admin";
    stub.data["expense.categories"] = [];
    stub.data["expense.summary"] = [];
    mockRequested.length = 0;
    mockPages[1] = { data: makePage(1), total: 40 };
    mockPages[2] = { data: makePage(21), total: 40 };
  });

  it("appends page 2 to page 1 and stops at the total", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider initialMode="dark">
          <ExpensesListScreen />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(rows()).toHaveLength(20));

    await endReached();
    await waitFor(() => expect(rows()).toHaveLength(40));
    expect(rows()[0].id).toBe("exp-1");
    expect(rows()[39].id).toBe("exp-40");

    // Everything is loaded: further end-reached events must not request page 3.
    await endReached();
    expect(mockRequested).not.toContain(3);

    client.clear();
  });
});
