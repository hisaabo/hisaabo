import { eq } from "drizzle-orm";
import { z } from "zod";
import { businesses } from "@hisaabo/db";
import { createBusinessSchema, updateBusinessSchema } from "@hisaabo/shared";
import { router, tenantProcedure } from "../trpc.js";

export const businessRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(businesses);
  }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [biz] = await ctx.db
        .select()
        .from(businesses)
        .where(eq(businesses.id, input.id))
        .limit(1);
      return biz ?? null;
    }),

  create: tenantProcedure.input(createBusinessSchema).mutation(async ({ input, ctx }) => {
    const [biz] = await ctx.db.insert(businesses).values({
      ...input,
      createdByUserId: ctx.user.id,
    }).returning();
    return biz;
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBusinessSchema }))
    .mutation(async ({ input, ctx }) => {
      const [biz] = await ctx.db
        .update(businesses)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(businesses.id, input.id))
        .returning();
      return biz;
    }),
});
