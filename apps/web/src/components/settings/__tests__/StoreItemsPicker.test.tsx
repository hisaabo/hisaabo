/**
 * "Manage Store Items" picker: items already on the store are listed together at
 * the TOP, each group in the usual order.
 *
 * The list comes from the API already in that order (`selectedFirst`) and follows
 * what is SAVED. The picker's own unsaved ticks live in `pendingChanges`, so
 * ticking an item must never move it; the order only changes when the picker is
 * opened or the search changes. A tiny fake server below sorts the way the API
 * does, so the DOM order proves the picker neither re-sorts nor drops the flag.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
}));

import { stub } from "@/test-utils/trpc-stub";
import { StoreTab } from "../StoreTab";

interface Row {
  id: string;
  name: string;
  storeEnabled: boolean;
  storeSortOrder: number;
}

// Almond .. Ghee as stored; Basmati Rice, Elaichi and Dal are on the store
const ROWS: Row[] = [
  { id: "i1", name: "Almond", storeEnabled: false, storeSortOrder: 0 },
  { id: "i2", name: "Basmati Rice", storeEnabled: true, storeSortOrder: 0 },
  { id: "i3", name: "Cashew", storeEnabled: false, storeSortOrder: 0 },
  { id: "i4", name: "Dal", storeEnabled: true, storeSortOrder: 5 },
  { id: "i5", name: "Elaichi", storeEnabled: true, storeSortOrder: 0 },
  { id: "i6", name: "Fenugreek", storeEnabled: false, storeSortOrder: 3 },
  { id: "i7", name: "Ghee", storeEnabled: false, storeSortOrder: 0 },
];

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
    data: rows.slice(0, limit).map((r) => ({ ...r, unit: "kg", salePrice: "10", category: "Grains", itemType: "product", description: "x" })),
    total: rows.length,
    page: 1,
    limit,
  };
}

const modalInputs = () =>
  (stub.queries["store.listStoreItems"] ?? []).filter((i) => (i as Input | undefined)?.limit === 100 && (i as Input).selectedFirst !== undefined) as Input[];

function openPicker() {
  stub.session.role = "admin";
  render(<StoreTab />);
  fireEvent.click(screen.getByRole("button", { name: "Manage Items" }));
  return screen.getByRole("dialog", { name: "Manage Store Items" });
}

/** Item names in the order the picker shows them. */
function order(dialog: HTMLElement): string[] {
  const names = ROWS.map((r) => r.name);
  return within(dialog)
    .getAllByText((text, el) => !!el && el.tagName === "P" && names.includes(text))
    .map((el) => el.textContent!);
}

beforeEach(() => {
  stub.reset();
  stub.data["store.getSettings"] = { storeEnabled: true, storeSlug: "acme", storeTagline: "", storeWhatsappNumber: "", storeMinOrderAmount: "", storeDeliveryNote: "", storeAllowNegativeStock: false };
  stub.data["store.listStoreItems"] = fakeServer;
});

describe("Manage Store Items — selected items first", () => {
  it("asks the API for selected-first and shows the items on the store together at the top", () => {
    const dialog = openPicker();
    expect(modalInputs().length).toBeGreaterThan(0);
    expect(modalInputs().every((i) => i.selectedFirst === true)).toBe(true);
    // selected, each group in the usual order (sort order, then name) ...
    expect(order(dialog)).toEqual(["Basmati Rice", "Elaichi", "Dal", "Almond", "Cashew", "Ghee", "Fenugreek"]);
  });

  it("ticking an item does not move it: not an unselected one, not a selected one", () => {
    const dialog = openPicker();
    const before = order(dialog);

    fireEvent.click(within(dialog).getByText("Ghee")); // add (an unselected item, last in the list)
    expect(order(dialog)).toEqual(before);
    expect(within(dialog).getByText("Adding")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Basmati Rice")); // remove (a selected item, first in the list)
    expect(order(dialog)).toEqual(before);
    expect(within(dialog).getByText("Removing")).toBeInTheDocument();
    expect(within(dialog).getByText("2 changes pending")).toBeInTheDocument();

    // undoing a tick still does not move anything
    fireEvent.click(within(dialog).getByText("Ghee"));
    expect(order(dialog)).toEqual(before);
    // none of the ticks changed what the picker asks for: one distinct request, so nothing re-sorted
    fireEvent.click(within(dialog).getByText("Cashew"));
    expect(new Set(modalInputs().map((i) => JSON.stringify(i))).size).toBe(1);
  });

  it("search re-sorts: the matches keep the selected ones first", async () => {
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByPlaceholderText("Search items..."), { target: { value: "a" } });

    await waitFor(() => expect(modalInputs().some((i) => i.search === "a")).toBe(true));
    expect(modalInputs().filter((i) => i.search === "a").every((i) => i.selectedFirst === true)).toBe(true);
    // matches for "a": Almond, Basmati Rice, Cashew, Dal, Elaichi (no Fenugreek, no Ghee)
    expect(order(dialog)).toEqual(["Basmati Rice", "Elaichi", "Dal", "Almond", "Cashew"]);
  });

  it("ticks made before a search survive it, and the matches are not reordered by them", async () => {
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByText("Cashew")); // pending add
    fireEvent.change(within(dialog).getByPlaceholderText("Search items..."), { target: { value: "a" } });
    await waitFor(() => expect(modalInputs().some((i) => i.search === "a")).toBe(true));

    expect(order(dialog)).toEqual(["Basmati Rice", "Elaichi", "Dal", "Almond", "Cashew"]); // Cashew has NOT jumped up
    expect(within(dialog).getByText("1 change pending")).toBeInTheDocument();
    expect(within(dialog).getByText("Adding")).toBeInTheDocument();
  });

  it("Apply saves the ticks (the next open then lists the new selection first)", async () => {
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByText("Cashew"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Apply 1 Change/ }));
    await waitFor(() => expect(stub.mutations["store.bulkToggleItems"]).toEqual([{ itemIds: ["i3"], storeEnabled: true }]));
  });
});
