import { z } from "zod";
import { eq } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import { router, viewerProcedure } from "../trpc.js";
import { generateGSTR1, generateGSTR3B, gstr1ToCSV } from "../lib/gst-reports.js";

export const gstRouter = router({
  gstr1: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      // Fix 4: Do not generate GST reports for unregistered businesses
      const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
      if (!biz || biz.gstRegistrationType === "unregistered") {
        return null; // Frontend shows "GST reports not available for unregistered businesses"
      }
      return generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
    }),

  gstr3b: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      // Fix 4: Do not generate GST reports for unregistered businesses
      const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
      if (!biz || biz.gstRegistrationType === "unregistered") {
        return null; // Frontend shows "GST reports not available for unregistered businesses"
      }
      return generateGSTR3B(ctx.businessId, input.year, input.month, ctx.db);
    }),

  gstr1CSV: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      // Fix 4: Do not generate GST reports for unregistered businesses
      const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
      if (!biz || biz.gstRegistrationType === "unregistered") {
        return null; // Frontend shows "GST reports not available for unregistered businesses"
      }
      const report = await generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);
      return { csv: gstr1ToCSV(report), filename: `GSTR1_${report.period.replace(" ", "_")}.csv` };
    }),
});
