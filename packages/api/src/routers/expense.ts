import { eq, and, sql, desc, gte, lte, ilike, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { expenses } from "@hisaabo/db";
import { createExpenseSchema, paginationSchema } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";

export const expenseRouter = router({
  list: viewerProcedure
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(expenses.businessId, ctx.businessId), isNull(expenses.deletedAt)];
      if (input.category) conditions.push(eq(expenses.category, input.category));
      if (input.fromDate) conditions.push(gte(expenses.expenseDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(expenses.expenseDate, new Date(input.toDate)));
      if (input.search) {
        conditions.push(
          or(
            ilike(expenses.description, `%${input.search}%`),
            ilike(expenses.category, `%${input.search}%`)
          )!
        );
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select().from(expenses)
          .where(and(...conditions))
          .orderBy(desc(expenses.expenseDate))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(expenses)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  create: memberProcedure.input(createExpenseSchema).mutation(async ({ input, ctx }) => {
    const [expense] = await ctx.db.insert(expenses).values({
      ...input,
      businessId: ctx.businessId,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
      createdByUserId: ctx.user!.id,
      createdByName: ctx.user!.name,
    }).returning();
    return expense;
  }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: createExpenseSchema.partial() }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await ctx.db.select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });

      const [updated] = await ctx.db.update(expenses)
        .set({
          ...input.data,
          expenseDate: input.data.expenseDate ? new Date(input.data.expenseDate) : undefined,
        })
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)))
        .returning();
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await ctx.db.select({ id: expenses.id, deletedAt: expenses.deletedAt })
        .from(expenses)
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)))
        .limit(1);

      if (!existing) return { success: true };
      if (existing.deletedAt) return { success: true }; // already soft-deleted

      await ctx.db.update(expenses)
        .set({ deletedAt: new Date() })
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)));
      return { success: true };
    }),

  categories: viewerProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.selectDistinct({ category: expenses.category })
      .from(expenses)
      .where(and(eq(expenses.businessId, ctx.businessId), isNull(expenses.deletedAt)))
      .orderBy(expenses.category);
    return result.map((r) => r.category);
  }),

  summary: viewerProcedure
    .input(z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(expenses.businessId, ctx.businessId), isNull(expenses.deletedAt)];
      if (input.from) conditions.push(sql`${expenses.expenseDate} >= ${input.from}`);
      if (input.to) conditions.push(sql`${expenses.expenseDate} <= ${input.to}`);

      const result = await ctx.db.select({
        category: expenses.category,
        total: sql<string>`coalesce(sum(${expenses.amount}::numeric), 0)::text`,
        count: sql<number>`count(*)::int`,
      }).from(expenses)
        .where(and(...conditions))
        .groupBy(expenses.category)
        .orderBy(sql`sum(${expenses.amount}::numeric) desc`);

      return result;
    }),
});
