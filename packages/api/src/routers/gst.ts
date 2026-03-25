import { z } from "zod";
import { eq } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { generateGSTR1, generateGSTR3B, gstr1ToCSV } from "../lib/gst-reports.js";

export const gstRouter = router({
  // Reports are available for ALL businesses — GST-registered get GST terminology,
  // non-GST get generic financial report terminology. The data engine is identical.
  gstr1: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      return generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
    }),

  gstr3b: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      return generateGSTR3B(ctx.businessId, input.year, input.month, ctx.db);
    }),

  gstr1CSV: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const report = await generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
      return { csv: gstr1ToCSV(report), filename: `GSTR1_${report.period.replace(" ", "_")}.csv` };
    }),
});
