import { eq, and, isNull, asc, sql, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { items, itemVariants, itemImages, type TenantDatabase } from "@hisaabo/db";
import {
  uploadItemImageSchema,
  updateItemImageSchema,
  reorderItemImagesSchema,
  setPrimaryItemImageSchema,
  MAX_IMAGES_PER_ITEM,
} from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { validateItemImageDataUrl } from "../lib/validate-image.js";
import { getStorage } from "../lib/storage/index.js";

// Shape returned to the admin UI — metadata only, never bytes. The client
// builds the actual <img> src from id + updatedAt against the serving route.
const imageColumns = {
  id: itemImages.id,
  itemId: itemImages.itemId,
  variantId: itemImages.variantId,
  mimeType: itemImages.mimeType,
  width: itemImages.width,
  height: itemImages.height,
  sizeBytes: itemImages.sizeBytes,
  alt: itemImages.alt,
  sortOrder: itemImages.sortOrder,
  isPrimary: itemImages.isPrimary,
  updatedAt: itemImages.updatedAt,
};

/** Verify an item exists, is active, and belongs to the caller's business. */
async function requireOwnedItem(db: TenantDatabase, businessId: string, itemId: string) {
  const [item] = await db.select({ id: items.id }).from(items)
    .where(and(eq(items.id, itemId), eq(items.businessId, businessId), isNull(items.deletedAt)))
    .limit(1);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  return item;
}

export const itemImageRouter = router({
  // List an item's gallery (admin view), ordered for display.
  list: viewerProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      await requireOwnedItem(ctx.db, ctx.businessId, input.itemId);
      return ctx.db.select(imageColumns).from(itemImages)
        .where(and(eq(itemImages.itemId, input.itemId), isNull(itemImages.deletedAt)))
        .orderBy(asc(itemImages.sortOrder), asc(itemImages.createdAt));
    }),

  // Upload one image. Bytes go to object storage; metadata to the DB.
  upload: memberProcedure
    .input(uploadItemImageSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      await requireOwnedItem(ctx.db, ctx.businessId, input.itemId);

      // A variant tag must point at a live variant of THIS item.
      if (input.variantId) {
        const [variant] = await ctx.db.select({ id: itemVariants.id }).from(itemVariants)
          .where(and(
            eq(itemVariants.id, input.variantId),
            eq(itemVariants.itemId, input.itemId),
            isNull(itemVariants.deletedAt),
          ))
          .limit(1);
        if (!variant) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Variant does not belong to this item" });
        }
      }

      // Enforce the per-item cap on the active gallery.
      const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` })
        .from(itemImages)
        .where(and(eq(itemImages.itemId, input.itemId), isNull(itemImages.deletedAt)));
      if (count >= MAX_IMAGES_PER_ITEM) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `An item can have at most ${MAX_IMAGES_PER_ITEM} images`,
        });
      }

      // Authoritative validation: magic bytes + decoded-size cap.
      const { bytes, mime } = validateItemImageDataUrl(input.dataUrl);

      // Next sort position = current max + 1 (0 when gallery is empty).
      const [{ maxSort }] = await ctx.db.select({
        maxSort: sql<number>`COALESCE(MAX(${itemImages.sortOrder}), -1)::int`,
      }).from(itemImages)
        .where(and(eq(itemImages.itemId, input.itemId), isNull(itemImages.deletedAt)));

      const storageKey = `items/${input.itemId}/${nanoid()}`;
      const storage = getStorage();
      await storage.put(storageKey, bytes, { contentType: mime });

      let row;
      try {
        [row] = await ctx.db.insert(itemImages).values({
          businessId: ctx.businessId,
          itemId: input.itemId,
          variantId: input.variantId ?? null,
          storageKey,
          mimeType: mime,
          width: input.width ?? null,
          height: input.height ?? null,
          sizeBytes: bytes.length,
          alt: input.alt ?? null,
          sortOrder: maxSort + 1,
          // First image in an empty gallery becomes the primary automatically.
          isPrimary: count === 0,
        }).returning(imageColumns);
      } catch (err) {
        // Don't leak an orphaned object if the metadata insert fails.
        await storage.delete(storageKey).catch(() => {});
        throw err;
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.uploadImage",
        entityType: "itemImage",
        entityId: row.id,
        metadata: { itemId: input.itemId, variantId: input.variantId ?? null },
        ipAddress: ctx.ipAddress,
      });

      return row;
    }),

  // Re-tag an image to a variant (or clear the tag) and/or edit alt text.
  update: memberProcedure
    .input(updateItemImageSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");

      const [existing] = await ctx.db.select({
        id: itemImages.id,
        itemId: itemImages.itemId,
      }).from(itemImages)
        .where(and(
          eq(itemImages.id, input.imageId),
          eq(itemImages.businessId, ctx.businessId),
          isNull(itemImages.deletedAt),
        ))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });

      if (input.variantId) {
        const [variant] = await ctx.db.select({ id: itemVariants.id }).from(itemVariants)
          .where(and(
            eq(itemVariants.id, input.variantId),
            eq(itemVariants.itemId, existing.itemId),
            isNull(itemVariants.deletedAt),
          ))
          .limit(1);
        if (!variant) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Variant does not belong to this item" });
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.variantId !== undefined) updates.variantId = input.variantId; // null clears the tag
      if (input.alt !== undefined) updates.alt = input.alt;

      const [row] = await ctx.db.update(itemImages)
        .set(updates)
        .where(and(eq(itemImages.id, input.imageId), isNull(itemImages.deletedAt)))
        .returning(imageColumns);

      return row;
    }),

  // Reorder the gallery. The submitted list defines sortOrder by index.
  reorder: memberProcedure
    .input(reorderItemImagesSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      await requireOwnedItem(ctx.db, ctx.businessId, input.itemId);

      // Every id must be a live image of this item — reject partial/foreign sets.
      const owned = await ctx.db.select({ id: itemImages.id }).from(itemImages)
        .where(and(
          eq(itemImages.itemId, input.itemId),
          isNull(itemImages.deletedAt),
          inArray(itemImages.id, input.orderedImageIds),
        ));
      if (owned.length !== input.orderedImageIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image list does not match this item's gallery" });
      }

      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < input.orderedImageIds.length; i++) {
          await tx.update(itemImages)
            .set({ sortOrder: i, updatedAt: new Date() })
            .where(eq(itemImages.id, input.orderedImageIds[i]!));
        }
      });

      return { success: true };
    }),

  // Make an image the primary (thumbnail / share image), clearing siblings.
  setPrimary: memberProcedure
    .input(setPrimaryItemImageSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");

      const [existing] = await ctx.db.select({
        id: itemImages.id,
        itemId: itemImages.itemId,
      }).from(itemImages)
        .where(and(
          eq(itemImages.id, input.imageId),
          eq(itemImages.businessId, ctx.businessId),
          isNull(itemImages.deletedAt),
        ))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });

      await ctx.db.transaction(async (tx) => {
        await tx.update(itemImages)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(
            eq(itemImages.itemId, existing.itemId),
            ne(itemImages.id, input.imageId),
            isNull(itemImages.deletedAt),
          ));
        await tx.update(itemImages)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(itemImages.id, input.imageId));
      });

      return { success: true };
    }),

  // Remove an image: soft-delete the row (audit trail) and drop the bytes.
  delete: memberProcedure
    .input(z.object({ imageId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");

      const [existing] = await ctx.db.select({
        id: itemImages.id,
        itemId: itemImages.itemId,
        storageKey: itemImages.storageKey,
        isPrimary: itemImages.isPrimary,
      }).from(itemImages)
        .where(and(
          eq(itemImages.id, input.imageId),
          eq(itemImages.businessId, ctx.businessId),
          isNull(itemImages.deletedAt),
        ))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });

      await ctx.db.transaction(async (tx) => {
        const now = new Date();
        await tx.update(itemImages)
          .set({ deletedAt: now, updatedAt: now, isPrimary: false })
          .where(eq(itemImages.id, input.imageId));

        // Promote the next image (lowest sortOrder) to primary so the gallery
        // always has a thumbnail if any images remain.
        if (existing.isPrimary) {
          const [next] = await tx.select({ id: itemImages.id }).from(itemImages)
            .where(and(eq(itemImages.itemId, existing.itemId), isNull(itemImages.deletedAt)))
            .orderBy(asc(itemImages.sortOrder), asc(itemImages.createdAt))
            .limit(1);
          if (next) {
            await tx.update(itemImages)
              .set({ isPrimary: true, updatedAt: now })
              .where(eq(itemImages.id, next.id));
          }
        }
      });

      // Bytes aren't referenced by history (unlike items/variants), so reclaim
      // the storage object. A failure here is non-fatal — the row is gone.
      await getStorage().delete(existing.storageKey).catch(() => {});

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "item.deleteImage",
        entityType: "itemImage",
        entityId: input.imageId,
        metadata: { itemId: existing.itemId },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),
});
