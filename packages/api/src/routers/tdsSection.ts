import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { tdsSectionConfigs } from "@hisaabo/db";
import { classifyTdsTaxCode, createTdsSectionConfigSchema } from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { seedTdsSections } from "../lib/tds-seed.js";

export const tdsSectionRouter = router({
  list: viewerProcedure.input(z.object({ includeInactive: z.boolean().default(false) }).optional()).query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Payment");
    const conditions = [eq(tdsSectionConfigs.businessId, ctx.businessId)];
    if (!input?.includeInactive) conditions.push(eq(tdsSectionConfigs.status, "active"));
    let results = await ctx.db
      .select()
      .from(tdsSectionConfigs)
      .where(and(...conditions))
      .orderBy(tdsSectionConfigs.sectionCode, desc(tdsSectionConfigs.version));
    if (results.length === 0 && !input?.includeInactive) {
      await seedTdsSections(ctx.db, ctx.businessId);
      results = await ctx.db
        .select()
        .from(tdsSectionConfigs)
        .where(and(...conditions))
        .orderBy(tdsSectionConfigs.sectionCode, desc(tdsSectionConfigs.version));
    }
    if (!input?.includeInactive) {
      const latestByCode = new Map<string, (typeof results)[number]>();
      for (const row of results) {
        if (!latestByCode.has(row.sectionCode)) {
          latestByCode.set(row.sectionCode, row);
        }
      }
      return Array.from(latestByCode.values());
    }
    return results;
  }),
  create: adminProcedure.input(createTdsSectionConfigSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Payment");
    const classification = classifyTdsTaxCode(input.sectionCode);
    if (classification.kind !== "current") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: classification.kind === "legacy-review"
          ? "Legacy TDS codes require review before configuration"
          : "Unknown TDS section code",
      });
    }
    const [config] = await ctx.db.insert(tdsSectionConfigs).values({
      ...input,
      sectionLabel: classification.entry.label,
      businessId: ctx.businessId,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
    }).returning();
    await logAudit(ctx.db, {
      businessId: ctx.businessId, userId: ctx.user!.id, action: "tds_section.create",
      entityType: "tds_section_config", entityId: config.id,
      metadata: { sectionCode: config.sectionCode, version: config.version }, ipAddress: ctx.ipAddress,
    });
    return config;
  }),
});
