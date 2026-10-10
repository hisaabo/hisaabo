/**
 * store-gates.test.ts — disabled-store / disabled-item refusal on the public
 * storefront item-image route and the identify route's store gate.
 *
 * The routes in server.ts delegate to lib/store-gates.ts (server.ts starts
 * listening on import, so it cannot be imported in tests). The slug cache may
 * say "this slug exists"; these gates are what refuse a store that has since
 * been disabled.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, items, itemImages, type TenantDatabase } from "@hisaabo/db";
import { createTestWorld, createItem, type TestWorld } from "./helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";

const storageGet = vi.hoisted(() => vi.fn());
vi.mock("../lib/storage/index.js", () => ({ getStorage: () => ({ get: storageGet }) }));

import { isStoreEnabled, serveStoreItemImage } from "../lib/store-gates.js";

let world: TestWorld;
let itemId: string;
let imageId: string;
let updatedAt: Date;

// The shared test helper types the tenant schema without some newer tables.
const db = () => getTenantTestDb() as unknown as TenantDatabase;
const args = () => ({ businessId: world.business1.id, itemId, imageId });

beforeAll(async () => {
  world = await createTestWorld();
  const item = await createItem(getTenantTestDb(), world.business1.id, { storeEnabled: true });
  itemId = item.id;
  const [img] = await db()
    .insert(itemImages)
    .values({
      businessId: world.business1.id,
      itemId,
      storageKey: `items/${itemId}/img1`,
      mimeType: "image/png",
    })
    .returning();
  imageId = img!.id;
  updatedAt = img!.updatedAt;
  await db().update(businesses).set({ storeEnabled: true }).where(eq(businesses.id, world.business1.id));
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("isStoreEnabled (identify gate)", () => {
  it("true for an enabled store, false once disabled, false for unknown id", async () => {
    expect(await isStoreEnabled(db(), world.business1.id)).toBe(true);
    await db().update(businesses).set({ storeEnabled: false }).where(eq(businesses.id, world.business1.id));
    expect(await isStoreEnabled(db(), world.business1.id)).toBe(false);
    expect(await isStoreEnabled(db(), "00000000-0000-4000-8000-000000000000")).toBe(false);
    await db().update(businesses).set({ storeEnabled: true }).where(eq(businesses.id, world.business1.id));
  });
});

describe("serveStoreItemImage", () => {
  it("serves bytes with safe headers when store and item are enabled", async () => {
    storageGet.mockResolvedValue(Buffer.from([1, 2, 3]));
    const res = await serveStoreItemImage(db(), args(), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBe(`"${updatedAt.getTime()}"`);
  });

  it("304 on matching ETag without reading storage", async () => {
    storageGet.mockClear();
    const res = await serveStoreItemImage(db(), args(), `"${updatedAt.getTime()}"`);
    expect(res.status).toBe(304);
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("404 and no storage read when the business store is disabled", async () => {
    storageGet.mockClear();
    await db().update(businesses).set({ storeEnabled: false }).where(eq(businesses.id, world.business1.id));
    const res = await serveStoreItemImage(db(), args(), undefined);
    expect(res.status).toBe(404);
    expect(storageGet).not.toHaveBeenCalled();
    await db().update(businesses).set({ storeEnabled: true }).where(eq(businesses.id, world.business1.id));
  });

  it("404 when the item is not store-enabled or is deleted", async () => {
    await db().update(items).set({ storeEnabled: false }).where(eq(items.id, itemId));
    expect((await serveStoreItemImage(db(), args(), undefined)).status).toBe(404);
    await db().update(items).set({ storeEnabled: true, deletedAt: new Date() }).where(eq(items.id, itemId));
    expect((await serveStoreItemImage(db(), args(), undefined)).status).toBe(404);
    await db().update(items).set({ deletedAt: null }).where(eq(items.id, itemId));
  });

  it("404 when the image belongs to another business or is soft-deleted", async () => {
    const other = { ...args(), businessId: world.business2.id };
    expect((await serveStoreItemImage(db(), other, undefined)).status).toBe(404);
    await db().update(itemImages).set({ deletedAt: new Date() }).where(eq(itemImages.id, imageId));
    expect((await serveStoreItemImage(db(), args(), undefined)).status).toBe(404);
    await db().update(itemImages).set({ deletedAt: null }).where(eq(itemImages.id, imageId));
  });

  it("404 when storage has no bytes", async () => {
    storageGet.mockResolvedValue(null);
    expect((await serveStoreItemImage(db(), args(), undefined)).status).toBe(404);
  });
});
