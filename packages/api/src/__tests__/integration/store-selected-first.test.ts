/**
 * store-selected-first.test.ts — store.listStoreItems `selectedFirst`.
 *
 * The "Manage Store Items" picker shows items already on the store together at
 * the top. The ordering is done by the API (the list is paged, so selected items
 * past the first page must still come first) and reflects the SAVED state:
 * selected first, then the rest, each group in the usual order
 * (storeSortOrder, name, id). Without the flag nothing changes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createItem, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;
let caller: ReturnType<typeof createTestCaller>;

// name, storeEnabled, storeSortOrder
const fixtures: Array<[string, boolean, number]> = [
  ["Almond", false, 0],
  ["Basmati Rice", true, 0],
  ["Cashew", false, 0],
  ["Dal", true, 5], // later sort order inside the selected group
  ["Elaichi", true, 0],
  ["Fenugreek", false, 3],
  ["Ghee", false, 0],
];

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  for (const [name, storeEnabled, storeSortOrder] of fixtures) {
    await createItem(db, world.business1.id, { name, storeEnabled, storeSortOrder });
  }
  // an item of another business must never leak in
  await createItem(db, world.business2.id, { name: "Aaa Foreign", storeEnabled: true });
  caller = createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const names = (r: { data: Array<{ name: string }> }) => r.data.map((i) => i.name);

// the fixture world also has one item per business ("Cotton Fabric (White 40s)", storeEnabled false, order 0)
const OTHER = "Cotton Fabric (White 40s)";

describe("store.listStoreItems selectedFirst", () => {
  it("without the flag the order is unchanged: storeSortOrder, then name", async () => {
    const r = await caller.store.listStoreItems({ limit: 100, page: 1 });
    // sortOrder 0: Almond, Basmati Rice, Cashew, Cotton Fabric, Elaichi, Ghee; then 3: Fenugreek; then 5: Dal
    expect(names(r)).toEqual(["Almond", "Basmati Rice", "Cashew", OTHER, "Elaichi", "Ghee", "Fenugreek", "Dal"]);
  });

  it("puts the selected items first, each group keeping the usual order", async () => {
    const r = await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true });
    expect(names(r)).toEqual([
      // selected: sortOrder 0 by name, then sortOrder 5
      "Basmati Rice", "Elaichi", "Dal",
      // the rest: sortOrder 0 by name, then sortOrder 3
      "Almond", "Cashew", OTHER, "Ghee", "Fenugreek",
    ]);
    expect(r.data.slice(0, 3).every((i) => i.storeEnabled)).toBe(true);
    expect(r.data.slice(3).every((i) => !i.storeEnabled)).toBe(true);
  });

  it("is stable: the same request twice gives the same order", async () => {
    const a = await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true });
    const b = await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true });
    expect(names(b)).toEqual(names(a));
  });

  it("search narrows the list and keeps selected first within the results", async () => {
    // 'a' matches Almond, Basmati Rice, Cashew, Cotton Fabric, Dal, Elaichi (not Fenugreek, not Ghee)
    const r = await caller.store.listStoreItems({ limit: 100, page: 1, search: "a", selectedFirst: true });
    const got = names(r);
    expect(got).not.toContain("Ghee");
    const firstUnselected = r.data.findIndex((i) => !i.storeEnabled);
    expect(firstUnselected).toBeGreaterThan(0);
    expect(r.data.slice(0, firstUnselected).every((i) => i.storeEnabled)).toBe(true);
    expect(r.data.slice(firstUnselected).every((i) => !i.storeEnabled)).toBe(true);
    expect(got.slice(0, firstUnselected)).toEqual(["Basmati Rice", "Elaichi", "Dal"]);
  });

  it("is applied before paging: a selected item that would be on page 2 still comes first", async () => {
    // Fenugreek/Dal sort last by storeSortOrder, so page 1 of 3 without the flag lacks Dal; with it, Dal is on page 1.
    const plain = await caller.store.listStoreItems({ limit: 3, page: 1 });
    expect(names(plain)).not.toContain("Dal");
    const sorted = await caller.store.listStoreItems({ limit: 3, page: 1, selectedFirst: true });
    expect(names(sorted)).toEqual(["Basmati Rice", "Elaichi", "Dal"]);
    const page2 = await caller.store.listStoreItems({ limit: 3, page: 2, selectedFirst: true });
    expect(names(page2)).toEqual(["Almond", "Cashew", OTHER]);
  });

  it("combines with the storeEnabled filter and never leaks another business's items", async () => {
    const onlySelected = await caller.store.listStoreItems({ limit: 100, page: 1, storeEnabled: true, selectedFirst: true });
    expect(names(onlySelected)).toEqual(["Basmati Rice", "Elaichi", "Dal"]);
    const all = await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true });
    expect(names(all)).not.toContain("Aaa Foreign");
    expect(all.total).toBe(8);
  });

  it("an unsaved change does not reorder: the order follows what is saved", async () => {
    const before = names(await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true }));
    // (the picker keeps ticks locally until Apply; nothing is written here)
    const after = names(await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true }));
    expect(after).toEqual(before);
    // once saved, the next open puts the item with the selected ones
    const cashew = (await caller.store.listStoreItems({ limit: 100, page: 1 })).data.find((i) => i.name === "Cashew")!;
    await caller.store.bulkToggleItems({ itemIds: [cashew.id], storeEnabled: true });
    const saved = names(await caller.store.listStoreItems({ limit: 100, page: 1, selectedFirst: true }));
    expect(saved.slice(0, 4)).toEqual(["Basmati Rice", "Cashew", "Elaichi", "Dal"]);
  });
});
