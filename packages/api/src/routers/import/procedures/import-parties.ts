import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure } from "../../../trpc.js";
import { requireCan } from "../../../lib/permissions.js";
import { getAdapter } from "../adapters/registry.js";
import { canonicalPartySchema } from "../types.js";
import { runPartiesImport } from "../engine/parties.js";

export const importParties = adminProcedure
  .input(z.object({
    source: z.string().default("mybillbook"),
    parties: z.array(z.object({
      name: z.string().min(1),
      type: z.enum(["customer", "supplier"]).default("customer"),
      phone: z.string().optional(),
      email: z.string().optional(),
      gstin: z.string().optional(),
      pan: z.string().optional(),
      openingBalance: z.string().default("0"),
      billingAddress: z.string().optional(),
      shippingAddress: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
    })).max(5000),
  }))
  .mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Import");

    const adapter = getAdapter(input.source);

    // Transform raw input rows through adapter, filter nulls
    const canonicalErrors: string[] = [];
    const canonicalParties = input.parties
      .map((raw, idx) => {
        const transformed = adapter.transformParty(raw as Record<string, unknown>);
        if (!transformed) return null;
        const result = canonicalPartySchema.safeParse(transformed);
        if (!result.success) {
          canonicalErrors.push(`Row ${idx + 1}: ${result.error.issues.map(i => i.message).join("; ")}`);
          return null;
        }
        return result.data;
      })
      .filter(Boolean) as NonNullable<ReturnType<typeof canonicalPartySchema.parse>>[];

    if (canonicalErrors.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Validation errors:\n${canonicalErrors.join("\n")}`,
      });
    }

    return runPartiesImport(ctx.db, ctx.businessId, ctx.user!.id, input.source, canonicalParties);
  });
