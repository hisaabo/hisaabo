import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { tdsSectionConfigs } from "@hisaabo/db";
import { classifyTdsTaxCode, createTdsSectionConfigSchema } from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { defaultTdsSectionConfigs, seedTdsSections } from "../lib/tds-seed.js";
import { isUniqueViolation } from "../lib/store-slug-registry.js";

export const tdsSectionRouter = router({
  /**
   * List the business's TDS sections.
   *
   * This is a query (GET): it must not write. A business that has no section
   * rows yet (created before TDS support, or restored from an older backup)
   * gets the registry defaults computed in memory in the same shape; the rows
   * are persisted by `business.create`, by `create` below, or by the first
   * payment mutation that needs them.
   */
  list: viewerProcedure.input(z.object({ includeInactive: z.boolean().default(false) }).optional()).query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Payment");
    const conditions = [eq(tdsSectionConfigs.businessId, ctx.businessId)];
    if (!input?.includeInactive) conditions.push(eq(tdsSectionConfigs.status, "active"));
    const results = await ctx.db
      .select()
      .from(tdsSectionConfigs)
      .where(and(...conditions))
      .orderBy(tdsSectionConfigs.sectionCode, desc(tdsSectionConfigs.version));

    if (results.length === 0) {
      const [anyRow] = await ctx.db
        .select({ id: tdsSectionConfigs.id })
        .from(tdsSectionConfigs)
        .where(eq(tdsSectionConfigs.businessId, ctx.businessId))
        .limit(1);
      // Rows exist but none are active: the admin switched everything off —
      // honour that. No rows at all: present the defaults.
      if (!anyRow) return defaultTdsSectionConfigs(ctx.businessId);
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

  /**
   * Add a (possibly back-dated) section configuration. This changes which TDS
   * sections receipts may use and from when, so it is a business-settings
   * action (admins), not a payment-entry one.
   */
  create: adminProcedure.input(createTdsSectionConfigSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "manage", "Business");
    const classification = classifyTdsTaxCode(input.sectionCode);
    if (classification.kind !== "current") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: classification.kind === "legacy-review"
          ? "Legacy TDS codes require review before configuration"
          : "Unknown TDS section code",
      });
    }
    const conflict = () => new TRPCError({
      code: "CONFLICT",
      message: `TDS section ${classification.normalizedCode} already has a configuration with version ${input.version}; use a higher version`,
    });

    let config: typeof tdsSectionConfigs.$inferSelect;
    try {
      config = await ctx.db.transaction(async (tx) => {
        // A business that was never seeded would otherwise end up with this one
        // row only (list shows defaults solely while the table is empty).
        const [anyRow] = await tx
          .select({ id: tdsSectionConfigs.id })
          .from(tdsSectionConfigs)
          .where(eq(tdsSectionConfigs.businessId, ctx.businessId))
          .limit(1);
        if (!anyRow) await seedTdsSections(tx, ctx.businessId);

        const [existing] = await tx
          .select({ id: tdsSectionConfigs.id })
          .from(tdsSectionConfigs)
          .where(and(
            eq(tdsSectionConfigs.businessId, ctx.businessId),
            eq(tdsSectionConfigs.sectionCode, classification.normalizedCode),
            eq(tdsSectionConfigs.version, input.version),
          ))
          .limit(1);
        if (existing) throw conflict();

        const [row] = await tx.insert(tdsSectionConfigs).values({
          ...input,
          sectionLabel: classification.entry.label,
          businessId: ctx.businessId,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        }).returning();
        return row!;
      });
    } catch (err) {
      // Lost a race with a concurrent create of the same (business, code, version).
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }

    await logAudit(ctx.db, {
      businessId: ctx.businessId, userId: ctx.user!.id, action: "tds_section.create",
      entityType: "tds_section_config", entityId: config.id,
      metadata: { sectionCode: config.sectionCode, version: config.version }, ipAddress: ctx.ipAddress,
      source: ctx.source,
    });
    return config;
  }),
});
