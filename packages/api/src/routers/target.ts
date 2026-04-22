import { eq, and, sql, desc, gte, lte, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { salesTargets, invoices, invoiceItems } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { buildBusinessDateFilter } from "../lib/business-date.js";

// ── Zod schemas ────────────────────────────────────────────────

const targetTypeSchema = z.enum(["order_count", "order_value", "item_quantity"]);
const periodTypeSchema = z.enum(["daily", "weekly", "monthly", "quarterly", "custom"]);

const createTargetSchema = z.object({
  userId: z.string().uuid(),
  targetType: targetTypeSchema,
  targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal number"),
  itemId: z.string().uuid().nullish(),
  periodType: periodTypeSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().max(500).nullish(),
});

const updateTargetSchema = z.object({
  id: z.string().uuid(),
  targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal number").optional(),
  itemId: z.string().uuid().nullish(),
  periodType: periodTypeSchema.optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  notes: z.string().max(500).nullish(),
});

// ── Progress computation ───────────────────────────────────────

interface TargetRow {
  userId: string;
  targetType: string;
  targetValue: string;
  itemId: string | null;
  periodStart: Date;
  periodEnd: Date;
}

export interface ProgressResult {
  current: number;
  target: number;
  percentage: number;
  remaining: number;
  unit: string;
  onTrack: boolean;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

async function computeTargetProgress(
  db: TenantDatabase,
  target: TargetRow,
  businessId: string,
): Promise<ProgressResult> {
  const baseConditions = [
    eq(invoices.businessId, businessId),
    eq(invoices.type, "sale"),
    eq(invoices.documentType, "invoice"),
    isNull(invoices.deletedAt),
    sql`${invoices.createdByUserId} = ${target.userId}`,
    ...buildBusinessDateFilter(invoices, { from: target.periodStart, to: target.periodEnd }),
    sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
  ];

  const targetValue = parseFloat(target.targetValue);
  const now = new Date();

  // Period timing calculations
  const daysTotal = Math.max(
    1,
    Math.round((target.periodEnd.getTime() - target.periodStart.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const daysElapsed = Math.min(
    daysTotal,
    Math.max(0, Math.round((now.getTime() - target.periodStart.getTime()) / (1000 * 60 * 60 * 24))),
  );
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  let current = 0;
  let unit = "";

  if (target.targetType === "order_count") {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(...baseConditions));
    current = result?.count ?? 0;
    unit = "orders";
  } else if (target.targetType === "order_value") {
    const [result] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
      })
      .from(invoices)
      .where(and(...baseConditions));
    current = parseFloat(result?.total ?? "0");
    unit = "₹";
  } else if (target.targetType === "item_quantity" && target.itemId) {
    const [result] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${invoiceItems.quantity}::numeric), 0)::text`,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(...baseConditions, eq(invoiceItems.itemId, target.itemId)));
    current = parseFloat(result?.total ?? "0");
    unit = "units";
  }

  const percentage = targetValue > 0 ? Math.min(100, Math.round((current / targetValue) * 100)) : 0;
  const remaining = Math.max(0, targetValue - current);

  // On-track: current >= expected based on time elapsed so far
  const expectedProgress = daysTotal > 0 ? (daysElapsed / daysTotal) * targetValue : 0;
  const onTrack = current >= expectedProgress || daysRemaining === 0;

  return {
    current,
    target: targetValue,
    percentage,
    remaining,
    unit,
    onTrack,
    daysTotal,
    daysElapsed,
    daysRemaining,
  };
}

// ── Router ─────────────────────────────────────────────────────

export const targetRouter = router({
  // Admin: create a target for a seller
  create: adminProcedure.input(createTargetSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "SalesTarget");

    if (input.targetType === "item_quantity" && !input.itemId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "itemId is required for item_quantity target type",
      });
    }

    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    if (periodEnd <= periodStart) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "periodEnd must be after periodStart",
      });
    }

    const [target] = await ctx.db
      .insert(salesTargets)
      .values({
        businessId: ctx.businessId,
        userId: input.userId,
        targetType: input.targetType,
        targetValue: input.targetValue,
        itemId: input.itemId ?? null,
        periodType: input.periodType,
        periodStart,
        periodEnd,
        notes: input.notes ?? null,
        createdByUserId: ctx.user.id,
      })
      .returning();

    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "salesTarget.create",
      entityType: "salesTarget",
      entityId: target.id,
      metadata: { period: input.periodType },
      ipAddress: ctx.ipAddress,
    });

    return target;
  }),

  // Admin/viewer: list targets for this business
  list: viewerProcedure
    .input(
      z.object({
        userId: z.string().uuid().optional(),
        periodType: periodTypeSchema.optional(),
        active: z.boolean().optional(), // filter for current-period targets only
        withProgress: z.boolean().default(false),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "SalesTarget");

      const conditions = [eq(salesTargets.businessId, ctx.businessId)];

      if (input.userId) {
        conditions.push(eq(salesTargets.userId, input.userId));
      }
      if (input.periodType) {
        conditions.push(eq(salesTargets.periodType, input.periodType));
      }
      if (input.active) {
        const now = new Date();
        conditions.push(gte(salesTargets.periodEnd, now));
        conditions.push(lte(salesTargets.periodStart, now));
      }

      const rows = await ctx.db
        .select()
        .from(salesTargets)
        .where(and(...conditions))
        .orderBy(desc(salesTargets.createdAt));

      if (!input.withProgress) {
        return rows;
      }

      // Attach progress to each target
      const withProgress = await Promise.all(
        rows.map(async (t) => ({
          ...t,
          progress: await computeTargetProgress(ctx.db, t, ctx.businessId),
        })),
      );

      return withProgress;
    }),

  // Get progress for a single target
  getProgress: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "SalesTarget");

      const [target] = await ctx.db
        .select()
        .from(salesTargets)
        .where(
          and(
            eq(salesTargets.id, input.id),
            eq(salesTargets.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target not found" });
      }

      const progress = await computeTargetProgress(ctx.db, target, ctx.businessId);

      return { ...target, progress };
    }),

  // Admin: update a target
  update: adminProcedure.input(updateTargetSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "SalesTarget");

    const { id, ...fields } = input;

    const [existing] = await ctx.db
      .select({ id: salesTargets.id })
      .from(salesTargets)
      .where(
        and(
          eq(salesTargets.id, id),
          eq(salesTargets.businessId, ctx.businessId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Target not found" });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (fields.targetValue !== undefined) updateData.targetValue = fields.targetValue;
    if (fields.periodType !== undefined) updateData.periodType = fields.periodType;
    if (fields.periodStart !== undefined) updateData.periodStart = new Date(fields.periodStart);
    if (fields.periodEnd !== undefined) updateData.periodEnd = new Date(fields.periodEnd);
    if ("itemId" in fields) updateData.itemId = fields.itemId ?? null;
    if ("notes" in fields) updateData.notes = fields.notes ?? null;

    const [updated] = await ctx.db
      .update(salesTargets)
      .set(updateData)
      .where(eq(salesTargets.id, id))
      .returning();

    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "salesTarget.update",
      entityType: "salesTarget",
      entityId: id,
      metadata: { targetId: id },
      ipAddress: ctx.ipAddress,
    });

    return updated;
  }),

  // Admin: delete a target
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "SalesTarget");

      const [existing] = await ctx.db
        .select({ id: salesTargets.id })
        .from(salesTargets)
        .where(
          and(
            eq(salesTargets.id, input.id),
            eq(salesTargets.businessId, ctx.businessId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target not found" });
      }

      await ctx.db.delete(salesTargets).where(eq(salesTargets.id, input.id));

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "salesTarget.delete",
        entityType: "salesTarget",
        entityId: input.id,
        metadata: { targetId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),

  // Seller: see own active targets with progress
  myTargets: viewerProcedure.query(async ({ ctx }) => {
    const now = new Date();

    const rows = await ctx.db
      .select()
      .from(salesTargets)
      .where(
        and(
          eq(salesTargets.businessId, ctx.businessId),
          sql`${salesTargets.userId} = ${ctx.user.id}`,
          gte(salesTargets.periodEnd, now),
        ),
      )
      .orderBy(salesTargets.periodEnd);

    const withProgress = await Promise.all(
      rows.map(async (t) => ({
        ...t,
        progress: await computeTargetProgress(ctx.db, t, ctx.businessId),
      })),
    );

    return withProgress;
  }),
});
