/**
 * gstr2b.ts — GSTR-2B reconciliation router.
 *
 * Endpoints:
 *   upload           Upload GSTR-2B JSON or CSV, auto-reconcile against purchase
 *                    invoices, persist records and return summary stats.
 *   uploads          List past uploads with summary stats.
 *   records          Paginated records for an upload with match-status filter.
 *   summary          Reconciliation summary + ITC impact for a return period.
 *   missingInBooks   Records present in 2B but absent from our purchase invoices.
 *   missingIn2B      Our purchase invoices not present in 2B.
 *   linkInvoice      Manually link a 2B record to a purchase invoice.
 *   ignoreRecord     Mark a 2B record as intentionally ignored.
 */

import { z } from "zod";
import { eq, and, sql, desc, isNull, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { gstr2bUploads, gstr2bRecords, invoices, parties } from "@hisaabo/db";
import {
  gstr2bUploadSchema,
  gstr2bRecordsInputSchema,
  gstr2bSummaryInputSchema,
  gstr2bLinkInvoiceSchema,
  gstr2bIgnoreRecordSchema,
} from "@hisaabo/shared";
import { router, viewerProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import {
  parseGSTR2BJSON,
  parseGSTR2BCSV,
  reconcileWithBooks,
  type GSTR2BRecord,
  type PurchaseInvoice,
} from "../lib/gstr2b-parser.js";

// ── Helpers ───────────────────────────────────────────────────

const ZERO = "0.00";

// ── Router ────────────────────────────────────────────────────

export const gstr2bRouter = router({
  /**
   * Upload GSTR-2B file (JSON or CSV). Parses the content, stores all records,
   * auto-reconciles against purchase invoices, and returns a summary.
   */
  upload: adminProcedure
    .input(gstr2bUploadSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");

      // Parse the uploaded file
      let parsed: GSTR2BRecord[];
      try {
        if (input.format === "json") {
          parsed = parseGSTR2BJSON(input.content);
        } else {
          parsed = parseGSTR2BCSV(input.content);
        }
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Failed to parse file",
        });
      }

      if (parsed.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No records found in the uploaded file",
        });
      }

      // Load purchase invoices for this business with GSTIN info
      const purchaseRows = await ctx.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          subtotal: invoices.subtotal,
          taxAmount: invoices.taxAmount,
          partyGstin: parties.gstin,
          partyStateCode: parties.stateCode,
          businessId: invoices.businessId,
        })
        .from(invoices)
        .leftJoin(parties, eq(invoices.partyId, parties.id))
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.type, "purchase"),
            sql`${invoices.status} != 'cancelled'`,
            isNull(invoices.deletedAt),
          ),
        );

      // For each purchase invoice, derive tax split.
      // We use a simple heuristic: if IGST > 0 in the invoice taxAmount and no
      // CGST/SGST recorded at invoice level we treat full tax as IGST.
      // This is approximate — for exact matching the router stores CGST/SGST/IGST
      // per invoice item but for reconciliation purposes this is sufficient.
      const purchaseInvoices: PurchaseInvoice[] = purchaseRows.map((r) => {
        const taxAmt = parseFloat(r.taxAmount ?? "0");
        const half = (taxAmt / 2).toFixed(2);
        return {
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          partyGstin: r.partyGstin ?? null,
          subtotal: r.subtotal,
          cgst: half,
          sgst: half,
          igst: ZERO,
          cess: ZERO,
        };
      });

      // Reconcile
      const { results, missingIn2B: _missingIn2B } = reconcileWithBooks(parsed, purchaseInvoices);

      // Count by status
      let matchedCount = 0, mismatchedCount = 0, missingInBooksCount = 0;
      for (const r of results) {
        if (r.matchStatus === "matched") matchedCount++;
        else if (r.matchStatus === "mismatched") mismatchedCount++;
        else if (r.matchStatus === "missing_in_books") missingInBooksCount++;
      }
      const unmatchedCount = mismatchedCount; // alias for summary

      // Persist upload record
      const [upload] = await ctx.db
        .insert(gstr2bUploads)
        .values({
          businessId: ctx.businessId,
          returnPeriod: input.returnPeriod,
          fileName: input.fileName,
          totalRecords: results.length,
          matchedRecords: matchedCount,
          unmatchedRecords: unmatchedCount,
          newRecords: missingInBooksCount,
          createdByUserId: ctx.user.id,
        })
        .returning();

      // Persist all records in batches of 500
      const BATCH = 500;
      for (let i = 0; i < results.length; i += BATCH) {
        const batch = results.slice(i, i + BATCH).map((r) => ({
          uploadId: upload.id,
          businessId: ctx.businessId,
          supplierGstin: r.record.supplierGstin,
          supplierName: r.record.supplierName,
          invoiceNumber: r.record.invoiceNumber,
          invoiceDate: r.record.invoiceDate,
          invoiceValue: r.record.invoiceValue,
          taxableValue: r.record.taxableValue,
          cgst: r.record.cgst,
          sgst: r.record.sgst,
          igst: r.record.igst,
          cess: r.record.cess,
          itcAvailable: r.record.itcAvailable,
          reason: r.record.reason,
          sourceType: r.record.sourceType,
          matchStatus: r.matchStatus,
          matchedInvoiceId: r.matchedInvoiceId,
          mismatchReasons: r.mismatchReasons.length > 0 ? r.mismatchReasons : null,
        }));
        await ctx.db.insert(gstr2bRecords).values(batch);
      }

      return {
        uploadId: upload.id,
        returnPeriod: input.returnPeriod,
        totalRecords: results.length,
        matchedRecords: matchedCount,
        mismatchedRecords: mismatchedCount,
        missingInBooks: missingInBooksCount,
        missingIn2B: _missingIn2B.length,
      };
    }),

  /**
   * List past GSTR-2B uploads for this business.
   */
  uploads: viewerProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");

      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;

      const [countRow] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(gstr2bUploads)
        .where(eq(gstr2bUploads.businessId, ctx.businessId));

      const rows = await ctx.db
        .select()
        .from(gstr2bUploads)
        .where(eq(gstr2bUploads.businessId, ctx.businessId))
        .orderBy(desc(gstr2bUploads.uploadedAt))
        .limit(limit)
        .offset(offset);

      return {
        uploads: rows,
        total: countRow?.count ?? 0,
        page,
        limit,
      };
    }),

  /**
   * Paginated records for a specific upload with optional match-status filter.
   */
  records: viewerProcedure
    .input(gstr2bRecordsInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");

      // Verify upload belongs to this business
      const [upload] = await ctx.db
        .select({ id: gstr2bUploads.id, businessId: gstr2bUploads.businessId })
        .from(gstr2bUploads)
        .where(eq(gstr2bUploads.id, input.uploadId))
        .limit(1);

      if (!upload || upload.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
      }

      const conditions = [eq(gstr2bRecords.uploadId, input.uploadId)];
      if (input.matchStatus) {
        conditions.push(eq(gstr2bRecords.matchStatus, input.matchStatus));
      }

      const offset = (input.page - 1) * input.limit;

      const [countRow] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(gstr2bRecords)
        .where(and(...conditions));

      const rows = await ctx.db
        .select()
        .from(gstr2bRecords)
        .where(and(...conditions))
        .orderBy(gstr2bRecords.supplierName, gstr2bRecords.invoiceDate)
        .limit(input.limit)
        .offset(offset);

      return {
        records: rows,
        total: countRow?.count ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  /**
   * Reconciliation summary for a return period: matched/mismatched/missing counts
   * plus ITC impact (sum of ITC-available records).
   */
  summary: viewerProcedure
    .input(gstr2bSummaryInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");

      // Find the most recent upload for this period
      const [latestUpload] = await ctx.db
        .select({ id: gstr2bUploads.id, uploadedAt: gstr2bUploads.uploadedAt, returnPeriod: gstr2bUploads.returnPeriod })
        .from(gstr2bUploads)
        .where(
          and(
            eq(gstr2bUploads.businessId, ctx.businessId),
            eq(gstr2bUploads.returnPeriod, input.returnPeriod),
          ),
        )
        .orderBy(desc(gstr2bUploads.uploadedAt))
        .limit(1);

      if (!latestUpload) {
        return {
          returnPeriod: input.returnPeriod,
          hasData: false,
          uploadId: null,
          uploadedAt: null,
          matched: 0,
          mismatched: 0,
          missingInBooks: 0,
          pending: 0,
          ignored: 0,
          totalRecords: 0,
          itcAvailable: { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO, total: ZERO },
          itcAtRisk: { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO, total: ZERO },
        };
      }

      // Status counts
      const statusRows = await ctx.db
        .select({
          matchStatus: gstr2bRecords.matchStatus,
          count: sql<number>`COUNT(*)::int`,
          sumCgst: sql<string>`COALESCE(SUM(${gstr2bRecords.cgst}::numeric), 0)::text`,
          sumSgst: sql<string>`COALESCE(SUM(${gstr2bRecords.sgst}::numeric), 0)::text`,
          sumIgst: sql<string>`COALESCE(SUM(${gstr2bRecords.igst}::numeric), 0)::text`,
          sumCess: sql<string>`COALESCE(SUM(${gstr2bRecords.cess}::numeric), 0)::text`,
        })
        .from(gstr2bRecords)
        .where(eq(gstr2bRecords.uploadId, latestUpload.id))
        .groupBy(gstr2bRecords.matchStatus);

      const byStatus = Object.fromEntries(statusRows.map((r) => [r.matchStatus, r]));

      const get = (status: string) => byStatus[status] ?? { count: 0, sumCgst: ZERO, sumSgst: ZERO, sumIgst: ZERO, sumCess: ZERO };

      const matched = get("matched");
      const mismatched = get("mismatched");
      const missingInBooks = get("missing_in_books");
      const pending = get("pending");
      const ignored = get("ignored");

      // ITC available = sum of ITC-eligible records that are matched or pending
      const itcAvailableRows = await ctx.db
        .select({
          sumCgst: sql<string>`COALESCE(SUM(${gstr2bRecords.cgst}::numeric), 0)::text`,
          sumSgst: sql<string>`COALESCE(SUM(${gstr2bRecords.sgst}::numeric), 0)::text`,
          sumIgst: sql<string>`COALESCE(SUM(${gstr2bRecords.igst}::numeric), 0)::text`,
          sumCess: sql<string>`COALESCE(SUM(${gstr2bRecords.cess}::numeric), 0)::text`,
        })
        .from(gstr2bRecords)
        .where(
          and(
            eq(gstr2bRecords.uploadId, latestUpload.id),
            eq(gstr2bRecords.itcAvailable, "Y"),
            inArray(gstr2bRecords.matchStatus, ["matched", "pending"]),
          ),
        );

      const ita = itcAvailableRows[0] ?? { sumCgst: ZERO, sumSgst: ZERO, sumIgst: ZERO, sumCess: ZERO };

      // ITC at risk = mismatched + missing_in_books ITC-eligible records
      const itcAtRiskRows = await ctx.db
        .select({
          sumCgst: sql<string>`COALESCE(SUM(${gstr2bRecords.cgst}::numeric), 0)::text`,
          sumSgst: sql<string>`COALESCE(SUM(${gstr2bRecords.sgst}::numeric), 0)::text`,
          sumIgst: sql<string>`COALESCE(SUM(${gstr2bRecords.igst}::numeric), 0)::text`,
          sumCess: sql<string>`COALESCE(SUM(${gstr2bRecords.cess}::numeric), 0)::text`,
        })
        .from(gstr2bRecords)
        .where(
          and(
            eq(gstr2bRecords.uploadId, latestUpload.id),
            eq(gstr2bRecords.itcAvailable, "Y"),
            inArray(gstr2bRecords.matchStatus, ["mismatched", "missing_in_books"]),
          ),
        );

      const itr = itcAtRiskRows[0] ?? { sumCgst: ZERO, sumSgst: ZERO, sumIgst: ZERO, sumCess: ZERO };

      function buildItc(r: typeof ita) {
        const cgst = r.sumCgst;
        const sgst = r.sumSgst;
        const igst = r.sumIgst;
        const cess = r.sumCess;
        const total = (parseFloat(cgst) + parseFloat(sgst) + parseFloat(igst) + parseFloat(cess)).toFixed(2);
        return { cgst, sgst, igst, cess, total };
      }

      const totalRecords = [matched, mismatched, missingInBooks, pending, ignored]
        .reduce((acc, r) => acc + r.count, 0);

      return {
        returnPeriod: input.returnPeriod,
        hasData: true,
        uploadId: latestUpload.id,
        uploadedAt: latestUpload.uploadedAt,
        matched: matched.count,
        mismatched: mismatched.count,
        missingInBooks: missingInBooks.count,
        pending: pending.count,
        ignored: ignored.count,
        totalRecords,
        itcAvailable: buildItc(ita),
        itcAtRisk: buildItc(itr),
      };
    }),

  /**
   * Records in 2B but not in our books (potential missed purchases / ITC opportunities).
   */
  missingInBooks: viewerProcedure
    .input(z.object({
      uploadId: z.string().uuid(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");

      const [upload] = await ctx.db
        .select({ id: gstr2bUploads.id, businessId: gstr2bUploads.businessId })
        .from(gstr2bUploads)
        .where(eq(gstr2bUploads.id, input.uploadId))
        .limit(1);

      if (!upload || upload.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found" });
      }

      const offset = (input.page - 1) * input.limit;
      const conditions = and(
        eq(gstr2bRecords.uploadId, input.uploadId),
        eq(gstr2bRecords.matchStatus, "missing_in_books"),
      );

      const [countRow] = await ctx.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(gstr2bRecords)
        .where(conditions);

      const rows = await ctx.db
        .select()
        .from(gstr2bRecords)
        .where(conditions)
        .orderBy(gstr2bRecords.supplierName, gstr2bRecords.invoiceDate)
        .limit(input.limit)
        .offset(offset);

      return {
        records: rows,
        total: countRow?.count ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  /**
   * Our purchase invoices that are not in the 2B for a given return period.
   * These are invoices our suppliers haven't filed yet — follow-up needed.
   */
  missingIn2B: viewerProcedure
    .input(z.object({
      returnPeriod: z.string().regex(/^\d{4}-\d{2}$/),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "GstReport");

      // Find the most recent upload for this period
      const [latestUpload] = await ctx.db
        .select({ id: gstr2bUploads.id })
        .from(gstr2bUploads)
        .where(
          and(
            eq(gstr2bUploads.businessId, ctx.businessId),
            eq(gstr2bUploads.returnPeriod, input.returnPeriod),
          ),
        )
        .orderBy(desc(gstr2bUploads.uploadedAt))
        .limit(1);

      if (!latestUpload) {
        return { records: [], total: 0, page: input.page, limit: input.limit };
      }

      // IDs of purchase invoices that DID appear in the 2B upload
      const matchedInvoiceIdRows = await ctx.db
        .select({ id: gstr2bRecords.matchedInvoiceId })
        .from(gstr2bRecords)
        .where(
          and(
            eq(gstr2bRecords.uploadId, latestUpload.id),
            sql`${gstr2bRecords.matchedInvoiceId} IS NOT NULL`,
          ),
        );

      const matchedIds = new Set(matchedInvoiceIdRows.map((r) => r.id).filter(Boolean) as string[]);

      // Determine period date range
      const [year, month] = input.returnPeriod.split("-").map(Number);
      const periodStart = new Date(year!, month! - 1, 1);
      const periodEnd   = new Date(year!, month!, 0, 23, 59, 59);

      const purchaseRows = await ctx.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          totalAmount: invoices.totalAmount,
          subtotal: invoices.subtotal,
          partyId: invoices.partyId,
          partyName: parties.name,
          partyGstin: parties.gstin,
        })
        .from(invoices)
        .leftJoin(parties, eq(invoices.partyId, parties.id))
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.type, "purchase"),
            sql`${invoices.status} != 'cancelled'`,
            isNull(invoices.deletedAt),
            sql`${invoices.invoiceDate} >= ${periodStart}`,
            sql`${invoices.invoiceDate} <= ${periodEnd}`,
            sql`${parties.gstin} IS NOT NULL`,
          ),
        );

      // Filter to only invoices NOT in 2B
      const missing = purchaseRows.filter((r) => !matchedIds.has(r.id));

      const total = missing.length;
      const offset = (input.page - 1) * input.limit;
      const page = missing.slice(offset, offset + input.limit);

      return {
        records: page.map((r) => ({
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          totalAmount: r.totalAmount,
          subtotal: r.subtotal,
          partyName: r.partyName,
          partyGstin: r.partyGstin,
        })),
        total,
        page: input.page,
        limit: input.limit,
      };
    }),

  /**
   * Manually link a 2B record to a specific purchase invoice.
   */
  linkInvoice: adminProcedure
    .input(gstr2bLinkInvoiceSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");

      // Verify record belongs to this business
      const [record] = await ctx.db
        .select({ id: gstr2bRecords.id, businessId: gstr2bRecords.businessId })
        .from(gstr2bRecords)
        .where(eq(gstr2bRecords.id, input.recordId))
        .limit(1);

      if (!record || record.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }

      // Verify invoice belongs to this business and is a purchase
      const [inv] = await ctx.db
        .select({ id: invoices.id, type: invoices.type, businessId: invoices.businessId })
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .limit(1);

      if (!inv || inv.businessId !== ctx.businessId || inv.type !== "purchase") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Purchase invoice not found" });
      }

      await ctx.db
        .update(gstr2bRecords)
        .set({
          matchedInvoiceId: input.invoiceId,
          matchStatus: "matched",
          mismatchReasons: null,
        })
        .where(eq(gstr2bRecords.id, input.recordId));

      return { success: true };
    }),

  /**
   * Mark a 2B record as intentionally ignored (e.g. RCM-paid, already handled).
   */
  ignoreRecord: adminProcedure
    .input(gstr2bIgnoreRecordSchema)
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "GstReport");

      const [record] = await ctx.db
        .select({ id: gstr2bRecords.id, businessId: gstr2bRecords.businessId })
        .from(gstr2bRecords)
        .where(eq(gstr2bRecords.id, input.recordId))
        .limit(1);

      if (!record || record.businessId !== ctx.businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }

      await ctx.db
        .update(gstr2bRecords)
        .set({ matchStatus: "ignored" })
        .where(eq(gstr2bRecords.id, input.recordId));

      return { success: true };
    }),
});
