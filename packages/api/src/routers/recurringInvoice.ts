import { eq, and, sql, desc, gte } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  recurringInvoiceTemplates, recurringInvoiceRuns, parties, invoices,
} from "@hisaabo/db";
import {
  createRecurringInvoiceSchema, updateRecurringInvoiceSchema, paginationSchema,
} from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { generateInvoiceFromTemplate, computeNextRunDate } from "../lib/recurring-invoice-generator.js";

export const recurringInvoiceRouter = router({
  list: viewerProcedure
    .input(z.object({
      status: z.enum(["active", "paused", "completed", "expired"]).optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "RecurringInvoice");
      const conditions = [eq(recurringInvoiceTemplates.businessId, ctx.businessId)];
      if (input.status) conditions.push(eq(recurringInvoiceTemplates.status, input.status));

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: recurringInvoiceTemplates.id,
          name: recurringInvoiceTemplates.name,
          partyId: recurringInvoiceTemplates.partyId,
          partyName: parties.name,
          type: recurringInvoiceTemplates.type,
          frequency: recurringInvoiceTemplates.frequency,
          status: recurringInvoiceTemplates.status,
          nextRunDate: recurringInvoiceTemplates.nextRunDate,
          lastRunDate: recurringInvoiceTemplates.lastRunDate,
          totalRuns: recurringInvoiceTemplates.totalRuns,
          maxRuns: recurringInvoiceTemplates.maxRuns,
          startDate: recurringInvoiceTemplates.startDate,
          endDate: recurringInvoiceTemplates.endDate,
          createdAt: recurringInvoiceTemplates.createdAt,
        })
          .from(recurringInvoiceTemplates)
          .leftJoin(parties, eq(recurringInvoiceTemplates.partyId, parties.id))
          .where(and(...conditions))
          .orderBy(desc(recurringInvoiceTemplates.createdAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` })
          .from(recurringInvoiceTemplates)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "RecurringInvoice");
      const [template] = await ctx.db.select({
        id: recurringInvoiceTemplates.id,
        businessId: recurringInvoiceTemplates.businessId,
        partyId: recurringInvoiceTemplates.partyId,
        partyName: parties.name,
        name: recurringInvoiceTemplates.name,
        type: recurringInvoiceTemplates.type,
        frequency: recurringInvoiceTemplates.frequency,
        customIntervalDays: recurringInvoiceTemplates.customIntervalDays,
        lineItems: recurringInvoiceTemplates.lineItems,
        notes: recurringInvoiceTemplates.notes,
        termsAndConditions: recurringInvoiceTemplates.termsAndConditions,
        additionalCharges: recurringInvoiceTemplates.additionalCharges,
        charges: recurringInvoiceTemplates.charges,
        status: recurringInvoiceTemplates.status,
        startDate: recurringInvoiceTemplates.startDate,
        endDate: recurringInvoiceTemplates.endDate,
        nextRunDate: recurringInvoiceTemplates.nextRunDate,
        lastRunDate: recurringInvoiceTemplates.lastRunDate,
        totalRuns: recurringInvoiceTemplates.totalRuns,
        maxRuns: recurringInvoiceTemplates.maxRuns,
        createdAt: recurringInvoiceTemplates.createdAt,
        updatedAt: recurringInvoiceTemplates.updatedAt,
      })
        .from(recurringInvoiceTemplates)
        .leftJoin(parties, eq(recurringInvoiceTemplates.partyId, parties.id))
        .where(and(
          eq(recurringInvoiceTemplates.id, input.id),
          eq(recurringInvoiceTemplates.businessId, ctx.businessId),
        ))
        .limit(1);

      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Recurring invoice template not found" });
      return template;
    }),

  create: memberProcedure.input(createRecurringInvoiceSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "RecurringInvoice");

    // Validate party belongs to business
    const [partyCheck] = await ctx.db.select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
      .limit(1);
    if (!partyCheck) throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });

    const startDate = new Date(input.startDate);
    const nextRunDate = startDate > new Date() ? startDate : computeNextRunDate(new Date(), input.frequency, input.customIntervalDays);

    const [template] = await ctx.db.insert(recurringInvoiceTemplates).values({
      businessId: ctx.businessId,
      partyId: input.partyId,
      name: input.name,
      type: input.type,
      frequency: input.frequency,
      customIntervalDays: input.customIntervalDays || null,
      lineItems: input.lineItems,
      notes: input.notes,
      termsAndConditions: input.termsAndConditions,
      additionalCharges: input.additionalCharges || "0",
      charges: input.charges || null,
      startDate,
      endDate: input.endDate ? new Date(input.endDate) : null,
      nextRunDate,
      maxRuns: input.maxRuns || null,
      createdByUserId: ctx.user!.id,
    }).returning();

    logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: "recurringInvoice.create",
      entityType: "recurringInvoice",
      entityId: template.id,
      metadata: { templateName: input.name },
      ipAddress: ctx.ipAddress,
    });

    return template;
  }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: updateRecurringInvoiceSchema }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "RecurringInvoice");
      const [existing] = await ctx.db.select({ id: recurringInvoiceTemplates.id, status: recurringInvoiceTemplates.status })
        .from(recurringInvoiceTemplates)
        .where(and(eq(recurringInvoiceTemplates.id, input.id), eq(recurringInvoiceTemplates.businessId, ctx.businessId)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      if (input.data.partyId) {
        const [partyCheck] = await ctx.db.select({ id: parties.id })
          .from(parties)
          .where(and(eq(parties.id, input.data.partyId), eq(parties.businessId, ctx.businessId)))
          .limit(1);
        if (!partyCheck) throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found" });
      }

      const [updated] = await ctx.db.update(recurringInvoiceTemplates)
        .set({
          ...input.data,
          endDate: input.data.endDate ? new Date(input.data.endDate) : undefined,
          maxRuns: input.data.maxRuns === null ? null : (input.data.maxRuns || undefined),
          updatedAt: new Date(),
        })
        .where(and(eq(recurringInvoiceTemplates.id, input.id), eq(recurringInvoiceTemplates.businessId, ctx.businessId)))
        .returning();

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "recurringInvoice.update",
        entityType: "recurringInvoice",
        entityId: input.id,
        metadata: { templateId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "RecurringInvoice");
      await ctx.db.delete(recurringInvoiceTemplates)
        .where(and(eq(recurringInvoiceTemplates.id, input.id), eq(recurringInvoiceTemplates.businessId, ctx.businessId)));

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "recurringInvoice.delete",
        entityType: "recurringInvoice",
        entityId: input.id,
        metadata: { templateId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),

  pause: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "RecurringInvoice");
      const [updated] = await ctx.db.update(recurringInvoiceTemplates)
        .set({ status: "paused", updatedAt: new Date() })
        .where(and(
          eq(recurringInvoiceTemplates.id, input.id),
          eq(recurringInvoiceTemplates.businessId, ctx.businessId),
          eq(recurringInvoiceTemplates.status, "active"),
        ))
        .returning();
      if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "Template is not active" });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "recurringInvoice.pause",
        entityType: "recurringInvoice",
        entityId: input.id,
        metadata: { templateId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return updated;
    }),

  resume: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "RecurringInvoice");

      // Recalculate next run date from now
      const [tpl] = await ctx.db.select({
        id: recurringInvoiceTemplates.id,
        frequency: recurringInvoiceTemplates.frequency,
        customIntervalDays: recurringInvoiceTemplates.customIntervalDays,
        status: recurringInvoiceTemplates.status,
      }).from(recurringInvoiceTemplates)
        .where(and(
          eq(recurringInvoiceTemplates.id, input.id),
          eq(recurringInvoiceTemplates.businessId, ctx.businessId),
        ))
        .limit(1);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND" });
      if (tpl.status !== "paused") throw new TRPCError({ code: "BAD_REQUEST", message: "Template is not paused" });

      const nextRunDate = computeNextRunDate(new Date(), tpl.frequency, tpl.customIntervalDays);
      const [updated] = await ctx.db.update(recurringInvoiceTemplates)
        .set({ status: "active", nextRunDate, updatedAt: new Date() })
        .where(eq(recurringInvoiceTemplates.id, input.id))
        .returning();

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "recurringInvoice.resume",
        entityType: "recurringInvoice",
        entityId: input.id,
        metadata: { templateId: input.id },
        ipAddress: ctx.ipAddress,
      });

      return updated;
    }),

  runNow: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "RecurringInvoice");
      const [tpl] = await ctx.db.select()
        .from(recurringInvoiceTemplates)
        .where(and(
          eq(recurringInvoiceTemplates.id, input.id),
          eq(recurringInvoiceTemplates.businessId, ctx.businessId),
        ))
        .limit(1);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND" });
      if (tpl.status !== "active" && tpl.status !== "paused") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Template must be active or paused" });
      }

      const result = await generateInvoiceFromTemplate(ctx.db, {
        ...tpl,
        lineItems: tpl.lineItems as TemplateRow["lineItems"],
        charges: tpl.charges as TemplateRow["charges"],
      });
      return result;
    }),

  executionHistory: viewerProcedure
    .input(z.object({
      templateId: z.string().uuid(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "RecurringInvoice");
      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: recurringInvoiceRuns.id,
          templateId: recurringInvoiceRuns.templateId,
          invoiceId: recurringInvoiceRuns.invoiceId,
          invoiceNumber: invoices.invoiceNumber,
          status: recurringInvoiceRuns.status,
          errorMessage: recurringInvoiceRuns.errorMessage,
          executedAt: recurringInvoiceRuns.executedAt,
        })
          .from(recurringInvoiceRuns)
          .leftJoin(invoices, eq(recurringInvoiceRuns.invoiceId, invoices.id))
          .where(and(
            eq(recurringInvoiceRuns.templateId, input.templateId),
            eq(recurringInvoiceRuns.businessId, ctx.businessId),
          ))
          .orderBy(desc(recurringInvoiceRuns.executedAt))
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` })
          .from(recurringInvoiceRuns)
          .where(and(
            eq(recurringInvoiceRuns.templateId, input.templateId),
            eq(recurringInvoiceRuns.businessId, ctx.businessId),
          )),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  planUsage: viewerProcedure
    .query(async ({ ctx }) => {
      requireCan(ctx.ability, "read", "RecurringInvoice");
      // Count successful runs this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` })
        .from(recurringInvoiceRuns)
        .where(and(
          eq(recurringInvoiceRuns.businessId, ctx.businessId),
          eq(recurringInvoiceRuns.status, "success"),
          gte(recurringInvoiceRuns.executedAt, monthStart),
        ));

      const [{ templates }] = await ctx.db.select({ templates: sql<number>`count(*)::int` })
        .from(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.businessId, ctx.businessId));

      return { runsThisMonth: count, totalTemplates: templates };
    }),

  suggestions: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "RecurringInvoice");

    // Analyze last 2 months of invoices — short lookback keeps suggestions
    // relevant. If a party wasn't invoiced recently, no point suggesting automation.
    const lookbackDate = new Date();
    lookbackDate.setMonth(lookbackDate.getMonth() - 2);

    const partyInvoices = await ctx.db.select({
      partyId: invoices.partyId,
      partyName: parties.name,
      invoiceDate: invoices.invoiceDate,
      totalAmount: invoices.totalAmount,
      type: invoices.type,
    })
      .from(invoices)
      .innerJoin(parties, eq(invoices.partyId, parties.id))
      .where(and(
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, "invoice"),
        gte(invoices.invoiceDate, lookbackDate),
      ))
      .orderBy(invoices.partyId, invoices.invoiceDate);

    // Group by party and analyze patterns
    const partyGroups = new Map<string, {
      partyName: string;
      type: string;
      dates: Date[];
      amounts: string[];
    }>();

    for (const row of partyInvoices) {
      const key = row.partyId;
      if (!partyGroups.has(key)) {
        partyGroups.set(key, {
          partyName: row.partyName!,
          type: row.type,
          dates: [],
          amounts: [],
        });
      }
      const group = partyGroups.get(key)!;
      group.dates.push(row.invoiceDate);
      group.amounts.push(row.totalAmount);
    }

    const suggestions: Array<{
      partyId: string;
      partyName: string;
      type: string;
      suggestedFrequency: string;
      invoiceCount: number;
      medianAmount: string;
      medianIntervalDays: number;
    }> = [];

    for (const [partyId, group] of partyGroups) {
      if (group.dates.length < 3) continue;

      // Calculate intervals between consecutive invoices
      const intervals: number[] = [];
      for (let i = 1; i < group.dates.length; i++) {
        const diffMs = group.dates[i].getTime() - group.dates[i - 1].getTime();
        intervals.push(Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }

      // Median interval
      const sorted = [...intervals].sort((a, b) => a - b);
      const medianInterval = sorted[Math.floor(sorted.length / 2)];

      // Detect frequency from median interval
      let suggestedFrequency = "monthly";
      if (medianInterval <= 9) suggestedFrequency = "weekly";
      else if (medianInterval <= 18) suggestedFrequency = "biweekly";
      else if (medianInterval <= 45) suggestedFrequency = "monthly";
      else if (medianInterval <= 120) suggestedFrequency = "quarterly";
      else if (medianInterval <= 240) suggestedFrequency = "half_yearly";
      else suggestedFrequency = "yearly";

      // Median amount
      const amountsSorted = group.amounts.map(Number).sort((a, b) => a - b);
      const medianAmount = amountsSorted[Math.floor(amountsSorted.length / 2)].toFixed(2);

      // Check regularity: coefficient of variation of intervals < 0.5
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
      const cv = Math.sqrt(variance) / mean;
      if (cv > 0.5) continue; // Too irregular

      suggestions.push({
        partyId,
        partyName: group.partyName,
        type: group.type,
        suggestedFrequency,
        invoiceCount: group.dates.length,
        medianAmount,
        medianIntervalDays: medianInterval,
      });
    }

    // Sort by invoice count (most frequent first), limit to 20
    suggestions.sort((a, b) => b.invoiceCount - a.invoiceCount);
    return suggestions.slice(0, 20);
  }),
});

// Type helper for runNow
type TemplateRow = Parameters<typeof generateInvoiceFromTemplate>[1];
