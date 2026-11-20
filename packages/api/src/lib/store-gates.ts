/**
 * store-gates.ts — storefront "is this store/item still public?" gates used by
 * the /store/* HTTP routes in server.ts, extracted so they can be tested
 * without booting the server (which starts listening on import).
 *
 * The slug registry / slug cache only says "this slug maps to a business"; the
 * business' `storeEnabled` flag is always re-checked against the tenant DB so a
 * disabled store is refused immediately, whatever a cache holds.
 */
import { and, eq, isNull } from "drizzle-orm";
import { businesses, items, itemImages } from "@hisaabo/db";
import type { getTenantDb } from "@hisaabo/db";
import { getStorage } from "./storage/index.js";
import { LOGO_SAFE_HEADERS } from "./logo-response.js";

type Db = Awaited<ReturnType<typeof getTenantDb>>;

/** True when the business exists and has its online store enabled. */
export async function isStoreEnabled(db: Db, businessId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.storeEnabled, true)))
    .limit(1);
  return !!row;
}

/**
 * Public item-image response. Only images of store-enabled, non-deleted items
 * on a store-enabled business are served (404 otherwise); ETag is checked
 * before the storage read.
 */
export async function serveStoreItemImage(
  db: Db,
  args: { businessId: string; itemId: string; imageId: string },
  ifNoneMatch: string | undefined,
): Promise<Response> {
  const notFound = () =>
    new Response(JSON.stringify({ error: "Image not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });

  const [row] = await db
    .select({
      storageKey: itemImages.storageKey,
      mimeType: itemImages.mimeType,
      updatedAt: itemImages.updatedAt,
    })
    .from(itemImages)
    .innerJoin(items, eq(items.id, itemImages.itemId))
    .innerJoin(businesses, eq(businesses.id, items.businessId))
    .where(
      and(
        eq(itemImages.id, args.imageId),
        eq(itemImages.itemId, args.itemId),
        eq(items.businessId, args.businessId),
        eq(businesses.storeEnabled, true),
        eq(items.storeEnabled, true),
        isNull(items.deletedAt),
        isNull(itemImages.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return notFound();

  const etag = `"${row.updatedAt?.getTime() ?? 0}"`;
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...LOGO_SAFE_HEADERS } });
  }

  const bytes = await getStorage().get(row.storageKey);
  if (!bytes) return notFound();

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...LOGO_SAFE_HEADERS,
      "Content-Type": row.mimeType,
      "Cache-Control": "public, max-age=3600",
      ETag: etag,
    },
  });
}
