import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, businesses } from "@billbook/db";
import { createBusinessSchema, updateBusinessSchema } from "@billbook/shared";
import { router, protectedProcedure } from "../trpc.js";

export const businessRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.select().from(businesses).where(eq(businesses.ownerId, ctx.user.id));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [biz] = await db
        .select()
        .from(businesses)
        .where(and(eq(businesses.id, input.id), eq(businesses.ownerId, ctx.user.id)))
        .limit(1);
      return biz ?? null;
    }),

  create: protectedProcedure.input(createBusinessSchema).mutation(async ({ input, ctx }) => {
    const [biz] = await db.insert(businesses).values({
      ...input,
      ownerId: ctx.user.id,
    }).returning();
    return biz;
  }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), data: updateBusinessSchema }))
    .mutation(async ({ input, ctx }) => {
      const [biz] = await db
        .update(businesses)
        .set({ ...input.data, updatedAt: new Date() })
        .where(and(eq(businesses.id, input.id), eq(businesses.ownerId, ctx.user.id)))
        .returning();
      return biz;
    }),
});
