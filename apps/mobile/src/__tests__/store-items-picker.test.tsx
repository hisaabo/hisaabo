/**
 * "Manage" store items picker (mobile): items already on the store are listed
 * together at the TOP, each group in the usual order.
 *
 * The list comes from the API already in that order (`selectedFirst`) and follows
 * what is SAVED. The picker's unsaved ticks live in `pendingChanges`, so ticking
 * an item must never move it (the old client-side sort did, on every tap); the
 * order only changes when the picker opens, the search changes or the tab changes.
 * A tiny fake server below sorts the way the API does, so what is rendered proves
 * the picker neither re-sorts nor drops the flag.
 */

import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

jest.mock("../lib/trpc", () => require("../test-utils/trpc-stub").trpcModule);
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

import { stub, renderScreen } from "../test-utils/trpc-stub";
import { useBusinessStore } from "../stores/business";
import StoreSettingsScreen from "../../app/(app)/(more)/settings/store";

interface Row {
  id: string;
  name: string;
  storeEnabled: boolean;
  storeSortOrder: number;
}

// Basmati Rice, Dal and Elaichi are on the store
const ROWS: Row[] = [
  { id: "i1", name: "Almond", storeEnabled: false, storeSortOrder: 0 },
  { id: "i2", name: "Basmati Rice", storeEnabled: true, storeSortOrder: 0 },
  { id: "i3", name: "Cashew", storeEnabled: false, storeSortOrder: 0 },
  { id: "i4", name: "Dal", storeEnabled: true, storeSortOrder: 5 },
  { id: "i5", name: "Elaichi", storeEnabled: true, storeSortOrder: 0 },
  { id: "i6", name: "Fenugreek", storeEnabled: false, storeSortOrder: 3 },
  { id: "i7", name: "Ghee", storeEnabled: false, storeSortOrder: 0 },
];
const NAMES = ROWS.map((r) => r.name);

interface Input {
  search?: string;
  storeEnabled?: boolean;
  selectedFirst?: boolean;
  limit?: number;
}

/** What store.listStoreItems answers: filter, then order (selected first only when asked). */
function fakeServer(input: Input | undefined) {
  let rows = [...ROWS];
  if (input?.search) rows = rows.filter((r) => r.name.toLowerCase().includes(input.search!.toLowerCase()));
  if (input?.storeEnabled !== undefined) rows = rows.filter((r) => r.storeEnabled === input.storeEnabled);
  rows.sort(
    (a, b) =>
      (input?.selectedFirst ? Number(b.storeEnabled) - Number(a.storeEnabled) : 0) ||
      a.storeSortOrder - b.storeSortOrder ||
      a.name.localeCompare(b.name),
  );
  const limit = input?.limit ?? 100;
  return {
    data: rows.slice(0, limit).map((r) => ({ ...r, unit: "kg", salePrice: "10", category: "Grains", itemType: "product", itemMode: "simple" })),
    total: rows.length,
    page: 1,
    limit,
  };
}

const pickerInputs = () =>
  (stub.queries["store.listStoreItems"] ?? []).filter((i) => (i as Input | undefined)?.limit === 100) as Input[];

/** Item names in the order the picker renders them. */
function order(): string[] {
  const seen: string[] = [];
  for (const el of screen.UNSAFE_getAllByType(require("react-native").Text)) {
    const text = (el.props.children as unknown);
    if (typeof text === "string" && NAMES.includes(text)) seen.push(text);
  }
  return seen;
}

function openPicker() {
  renderScreen("admin", StoreSettingsScreen);
  fireEvent.press(screen.getByText("Manage"));
}

beforeEach(() => {
  jest.clearAllMocks();
  stub.reset();
  useBusinessStore.setState({ businessId: "biz-1", businessName: "Test Biz" } as never);
  stub.data["store.getSettings"] = {
    storeEnabled: true, storeSlug: "acme", storeTagline: "", storeWhatsappNumber: "", storeMinOrderAmount: "",
    storeDeliveryNote: "", storeAllowNegativeStock: false,
  };
  stub.data["store.listStoreItems"] = fakeServer;
});

describe("Manage store items (mobile) — selected items first", () => {
  it("asks the API for selected-first and lists the items on the store together at the top", () => {
    openPicker();
    expect(pickerInputs().length).toBeGreaterThan(0);
    expect(pickerInputs().every((i) => i.selectedFirst === true)).toBe(true);
    expect(order()).toEqual(["Basmati Rice", "Elaichi", "Dal", "Almond", "Cashew", "Ghee", "Fenugreek"]);
  });

  it("ticking an item does not move it, unselected or selected (the old unsaved-tick sort made rows jump)", () => {
    openPicker();
    const before = order();

    fireEvent.press(screen.getByText("Ghee")); // add: last in the list
    expect(order()).toEqual(before);
    fireEvent.press(screen.getByText("Basmati Rice")); // remove: first in the list
    expect(order()).toEqual(before);
    fireEvent.press(screen.getByText("Ghee")); // undo
    expect(order()).toEqual(before);

    // none of it changed what the picker asks for: one distinct request, so nothing re-sorted
    expect(new Set(pickerInputs().map((i) => JSON.stringify(i))).size).toBe(1);
  });

  it("search re-sorts: the matches keep the selected ones first, ticks made earlier do not reorder them", async () => {
    openPicker();
    fireEvent.press(screen.getByText("Cashew")); // pending add
    fireEvent.changeText(screen.getByPlaceholderText(/search/i), "a");

    await waitFor(() => expect(pickerInputs().some((i) => i.search === "a")).toBe(true));
    expect(pickerInputs().filter((i) => i.search === "a").every((i) => i.selectedFirst === true)).toBe(true);
    // matches for "a": Almond, Basmati Rice, Cashew, Dal, Elaichi (no Fenugreek, no Ghee); Cashew has NOT jumped up
    expect(order()).toEqual(["Basmati Rice", "Elaichi", "Dal", "Almond", "Cashew"]);
  });

  it("Apply saves the ticks", async () => {
    openPicker();
    fireEvent.press(screen.getByText("Cashew"));
    fireEvent.press(screen.getByText(/Apply 1 Change/));
    await waitFor(() => expect(stub.mutations["store.bulkToggleItems"]).toEqual([{ itemIds: ["i3"], storeEnabled: true }]));
  });
});
