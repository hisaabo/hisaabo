import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure } from "../../../trpc.js";
import { requireCan } from "../../../lib/permissions.js";
import { getAdapter } from "../adapters/registry.js";
import { canonicalTransferSchema } from "../types.js";
import { runTransfersImport } from "../engine/transfers.js";

export const importTransfers = adminProcedure
  .input(z.object({
    transfers: z.array(z.object({
      date: z.string(),
      amount: z.string(),
      fromMode: z.string(),
      toMode: z.string(),
      notes: z.string().optional(),
      txnNo: z.string().optional(),
    })),
  }))
  .mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Import");

    // Transfers don't have a source param (they have no source-specific format differences),
    // but we still use the mybillbook adapter as default for the transform.
    // The hisaabo adapter's transfer transform is identical in shape anyway.
    const adapter = getAdapter("mybillbook");

    const canonicalErrors: string[] = [];
    const canonicalTransfers = input.transfers
      .map((raw, idx) => {
        const transformed = adapter.transformTransfer(raw as Record<string, unknown>);
        if (!transformed) return null;
        const result = canonicalTransferSchema.safeParse(transformed);
        if (!result.success) {
          canonicalErrors.push(`Row ${idx + 1}: ${result.error.issues.map(i => i.message).join("; ")}`);
          return null;
        }
        return result.data;
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof canonicalTransferSchema.parse>>[];

    if (canonicalErrors.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Validation errors:\n${canonicalErrors.join("\n")}`,
      });
    }

    return runTransfersImport(ctx.db, ctx.businessId, ctx.user!.id, "mybillbook", canonicalTransfers);
  });
