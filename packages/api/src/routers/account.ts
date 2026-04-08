import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { chartOfAccounts } from "@hisaabo/db";
import { createAccountSchema, updateAccountSchema } from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";

export const accountRouter = router({
  list: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Account");
    return ctx.db
      .select()
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.businessId, ctx.businessId))
      .orderBy(asc(chartOfAccounts.code));
  }),

  create: adminProcedure
    .input(createAccountSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Account");
      const [account] = await ctx.db
        .insert(chartOfAccounts)
        .values({
          businessId: ctx.businessId,
          code: input.code,
          name: input.name,
          accountType: input.accountType,
          parentId: input.parentId ?? null,
          isSystem: false,
          isActive: true,
        })
        .returning();

      return account!;
    }),

  update: adminProcedure
    .input(z.object({ id: z.string().uuid() }).merge(updateAccountSchema))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Account");

      // Verify the account belongs to this business
      const [existing] = await ctx.db
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.id, input.id),
            eq(chartOfAccounts.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      const updateFields: { name?: string; isActive?: boolean; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updateFields.name = input.name;
      if (input.isActive !== undefined) updateFields.isActive = input.isActive;

      const [updated] = await ctx.db
        .update(chartOfAccounts)
        .set(updateFields)
        .where(
          and(
            eq(chartOfAccounts.id, input.id),
            eq(chartOfAccounts.businessId, ctx.businessId),
          ),
        )
        .returning();

      return updated!;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Account");

      const [existing] = await ctx.db
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.id, input.id),
            eq(chartOfAccounts.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete a system account",
        });
      }

      await ctx.db
        .delete(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.id, input.id),
            eq(chartOfAccounts.businessId, ctx.businessId),
          ),
        );

      return { success: true };
    }),
});
