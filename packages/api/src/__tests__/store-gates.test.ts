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
import { serveBusinessLogo, PUBLIC_IMAGE_SAFE_HEADERS } from "../lib/logo-response.js";

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
    // Public storefront bytes are embeddable from other sites.
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("304 on matching ETag without reading storage", async () => {
    storageGet.mockClear();
    const res = await serveStoreItemImage(db(), args(), `"${updatedAt.getTime()}"`);
    expect(res.status).toBe(304);
    expect(storageGet).not.toHaveBeenCalled();
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
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

describe("serveBusinessLogo Cross-Origin-Resource-Policy", () => {
  const where = () => eq(businesses.id, world.business1.id);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const corp = (r: Response) => r.headers.get("cross-origin-resource-policy");

  it("the helper's default stays same-site; only the public store call opts into cross-origin", async () => {
    const logoUpdatedAt = new Date();
    await db()
      .update(businesses)
      .set({ logoData: PNG, logoMimeType: "image/png", logoUpdatedAt })
      .where(where());
    const etag = `"${logoUpdatedAt.getTime()}"`;

    // Handler-level values only. On the wire CORP is decided by the
    // secureHeaders middleware (createApiSecureHeaders), which overwrites it;
    // store-public-cors.test.ts covers that. This pins that the shared default
    // used by the authenticated /api/businesses/:id/logo route was not flipped.
    expect(corp(await serveBusinessLogo(db(), where(), undefined, "private"))).toBe("same-site");
    expect(corp(await serveBusinessLogo(db(), where(), etag, "private"))).toBe("same-site");

    // Public /store/:slug/logo: 200, 304 and the empty-PNG fallback.
    const pub = (inm: string | undefined) =>
      serveBusinessLogo(db(), where(), inm, "public", PUBLIC_IMAGE_SAFE_HEADERS);
    const ok = await pub(undefined);
    expect(ok.status).toBe(200);
    expect(corp(ok)).toBe("cross-origin");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    const notModified = await pub(etag);
    expect(notModified.status).toBe(304);
    expect(corp(notModified)).toBe("cross-origin");

    await db().update(businesses).set({ logoData: null, logoMimeType: null }).where(where());
    expect(corp(await pub(undefined))).toBe("cross-origin");
    expect(corp(await serveBusinessLogo(db(), where(), undefined, "private"))).toBe("same-site");
  });
});
