import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure } from "../../../trpc.js";
import { requireCan } from "../../../lib/permissions.js";
import { getAdapter } from "../adapters/registry.js";
import { canonicalItemSchema } from "../types.js";
import { runItemsImport } from "../engine/items.js";

export const importItems = adminProcedure
  .input(z.object({
    source: z.string().default("mybillbook"),
    items: z.array(z.object({
      name: z.string().min(1),
      itemType: z.enum(["product", "service"]).default("product"),
      salePrice: z.string().optional(),
      purchasePrice: z.string().optional(),
      taxPercent: z.string().default("0"),
      hsn: z.string().optional(),
      unit: z.string().default("pcs"),
      stockQuantity: z.string().default("0"),
      sku: z.string().optional(),
      category: z.string().optional(),
    })).max(5000),
  }))
  .mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Import");

    const adapter = getAdapter(input.source);

    const canonicalErrors: string[] = [];
    const canonicalItems = input.items
      .map((raw, idx) => {
        const transformed = adapter.transformItem(raw as Record<string, unknown>);
        if (!transformed) return null;
        const result = canonicalItemSchema.safeParse(transformed);
        if (!result.success) {
          canonicalErrors.push(`Row ${idx + 1}: ${result.error.issues.map(i => i.message).join("; ")}`);
          return null;
        }
        return result.data;
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof canonicalItemSchema.parse>>[];

    if (canonicalErrors.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Validation errors:\n${canonicalErrors.join("\n")}`,
      });
    }

    return runItemsImport(ctx.db, ctx.businessId, ctx.user!.id, input.source, canonicalItems);
  });
