import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db, expenses } from "@billbook/db";
import { createExpenseSchema, paginationSchema } from "@billbook/shared";
import { router, businessProcedure } from "../trpc.js";

export const expenseRouter = router({
  list: businessProcedure
    .input(z.object({
      category: z.string().optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(expenses.businessId, ctx.businessId)];
      if (input.category) conditions.push(eq(expenses.category, input.category));

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        db.select().from(expenses)
          .where(and(...conditions))
          .orderBy(desc(expenses.expenseDate))
          .limit(input.limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` }).from(expenses)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  create: businessProcedure.input(createExpenseSchema).mutation(async ({ input, ctx }) => {
    const [expense] = await db.insert(expenses).values({
      ...input,
      businessId: ctx.businessId,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
    }).returning();
    return expense;
  }),

  delete: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(expenses)
        .where(and(eq(expenses.id, input.id), eq(expenses.businessId, ctx.businessId)));
      return { success: true };
    }),

  categories: businessProcedure.query(async ({ ctx }) => {
    const result = await db.selectDistinct({ category: expenses.category })
      .from(expenses)
      .where(eq(expenses.businessId, ctx.businessId))
      .orderBy(expenses.category);
    return result.map((r) => r.category);
  }),

  summary: businessProcedure
    .input(z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(expenses.businessId, ctx.businessId)];
      if (input.from) conditions.push(sql`${expenses.expenseDate} >= ${input.from}`);
      if (input.to) conditions.push(sql`${expenses.expenseDate} <= ${input.to}`);

      const result = await db.select({
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
