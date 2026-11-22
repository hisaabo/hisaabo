import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { invoices, businesses } from "@hisaabo/db";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { generateGSTR1, generateGSTR3B, gstr1ToCSV, gstr1ToPortalJson } from "../lib/gst-reports.js";
import { generateGSTR9, gstr9ToPortalJson } from "../lib/gstr9-generator.js";
import { buildBusinessDateFilter } from "../lib/business-date.js";
import { gstFinancialYearLabel, gstFilingPeriod, gstQuarterWindow } from "../lib/gst-period.js";
import { money } from "@hisaabo/shared";

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

  // GSTR-1 portal JSON — produces the exact JSON schema accepted by the GST portal's
  // offline tool. Users can download this JSON and upload it directly to gstn.gov.in
  // instead of manually entering invoice data.
  gstr1Json: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      month: z.number().int().min(1).max(12),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      const report = await generateGSTR1(ctx.businessId, input.year, input.month, ctx.db);

      const [biz] = await ctx.db
        .select({ gstin: businesses.gstin })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .limit(1);

      // The GST return year is always April-March, whatever financial year the business
      // keeps its books on (`financialYearStart` is for the accounting reports only).
      const fp = gstFilingPeriod(input.year, input.month);
      const fy = gstFinancialYearLabel(input.year, input.month);

      const portalJson = gstr1ToPortalJson(report, biz?.gstin ?? "", fy, fp);
      return {
        json: portalJson,
        filename: `GSTR1_${report.period.replace(" ", "_")}_portal.json`,
        // GST financial year of the period (April-March), e.g. "2025-26" for January 2026
        financialYear: fy,
      };
    }),

  // GSTR-9: Annual return consolidating 12 months of GSTR-1 + GSTR-3B data.
  // Filed once per financial year (April–March). Tables 4-9 are generated from
  // the monthly report data — no separate data entry required.
  gstr9: viewerProcedure
    .input(z.object({
      financialYear: z.number().int().min(2020).max(2099), // Start year, e.g. 2025 for FY 2025-26
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");
      return generateGSTR9(ctx.businessId, input.financialYear, ctx.db);
    }),

  // GSTR-9 portal JSON — produces the JSON schema accepted by the GST portal's
  // offline tool. Users can download this and upload directly to gstn.gov.in.
  gstr9Json: viewerProcedure
    .input(z.object({
      financialYear: z.number().int().min(2020).max(2099),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");
      const report = await generateGSTR9(ctx.businessId, input.financialYear, ctx.db);
      const portalJson = gstr9ToPortalJson(report);
      const fyLabel = report.financialYear.replace("-", "_");
      return {
        json: portalJson,
        filename: `GSTR9_FY${fyLabel}_portal.json`,
      };
    }),

  // CMP-08: Quarterly return for composition scheme dealers.
  // Composition dealers pay a flat tax on total outward supplies instead of
  // collecting GST from customers. The rate varies by category:
  //   1% for traders (manufacturers), 5% for restaurants, 6% for service providers.
  // This endpoint calculates total outward supplies for a GST quarter and the tax payable.
  // The quarters are those of the GST financial year, which starts on 1 April whatever the
  // business's own accounting year: `year` is the START year of the financial year
  // (2025 = FY 2025-26) and Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar of year + 1.
  cmp08: viewerProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2099),
      quarter: z.number().int().min(1).max(4),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");

      // Half-open window on the IST business calendar (see gst-period.ts)
      const { from: quarterStart, before: quarterBefore } = gstQuarterWindow(input.year, input.quarter);

      const rows = await ctx.db.select({
        totalAmount: invoices.totalAmount,
        subtotal: invoices.subtotal,
      }).from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.type, "sale"),
          sql`${invoices.status} != 'cancelled'`,
          ...buildBusinessDateFilter(invoices, { from: quarterStart, before: quarterBefore }),
        ));

      // Exact paise arithmetic; never JS floats for money.
      const taxableValue = money.sum(rows.map((row) => row.subtotal));

      // Default composition rate for traders: 1%.
      // Businesses can override this; we default to the lowest rate.
      // 1% for traders/manufacturers, 5% for restaurants, 6% for services.
      const taxPayable = money.percent(taxableValue, "1");

      return {
        taxableValue,
        taxPayable,
        quarterStart: quarterStart.toISOString(),
        // the last millisecond of the quarter (the window itself is half-open)
        quarterEnd: new Date(quarterBefore.getTime() - 1).toISOString(),
      };
    }),
});
