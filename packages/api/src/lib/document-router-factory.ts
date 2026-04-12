import { eq, and, sql, desc, gte, lte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  invoices,
  invoiceItems,
  items,
  itemVariants,
  businesses,
  parties,
} from "@hisaabo/db";
import {
  createInvoiceSchema,
  paginationSchema,
  type DocumentType,
  calcLineItem,
  calcInvoiceTotals,
} from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { logAudit } from "./audit.js";

type InvoiceStatus = "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

export interface DocumentRouterConfig {
  documentType: string;
  /** column name on businesses table for prefix, e.g. "quotationPrefix" */
  prefixColumn: keyof typeof businesses.$inferSelect | null;
  /** column name for next number counter, e.g. "nextQuotationNumber" */
  counterColumn: keyof typeof businesses.$inferSelect | null;
  allowedStatuses: string[];
  /** whether creating this document type affects item stock */
  stockEffect: "none" | "decrement" | "increment";
}

// Map document type to prefix/counter columns on businesses table
const bizColumns = {
  quotation: {
    prefix: businesses.quotationPrefix,
    counter: businesses.nextQuotationNumber,
    setCounter: (n: number) => ({ nextQuotationNumber: n }),
  },
  credit_note: {
    prefix: businesses.creditNotePrefix,
    counter: businesses.nextCreditNoteNumber,
    setCounter: (n: number) => ({ nextCreditNoteNumber: n }),
  },
  debit_note: {
    prefix: businesses.debitNotePrefix,
    counter: businesses.nextDebitNoteNumber,
    setCounter: (n: number) => ({ nextDebitNoteNumber: n }),
  },
  delivery_challan: {
    prefix: businesses.deliveryChallanPrefix,
    counter: businesses.nextDeliveryChallanNumber,
    setCounter: (n: number) => ({ nextDeliveryChallanNumber: n }),
  },
  proforma: {
    prefix: businesses.proformaPrefix,
    counter: businesses.nextProformaNumber,
    setCounter: (n: number) => ({ nextProformaNumber: n }),
  },
  sales_return: {
    prefix: businesses.salesReturnPrefix,
    counter: businesses.nextSalesReturnNumber,
    setCounter: (n: number) => ({ nextSalesReturnNumber: n }),
  },
  purchase_return: {
    prefix: businesses.purchaseReturnPrefix,
    counter: businesses.nextPurchaseReturnNumber,
    setCounter: (n: number) => ({ nextPurchaseReturnNumber: n }),
  },
} as const;

type KnownDocType = keyof typeof bizColumns;

export function createDocumentRouter(config: DocumentRouterConfig) {
  const docType = config.documentType;
  const allowedStatusEnum = config.allowedStatuses as [string, ...string[]];

  return router({
    list: viewerProcedure
      .input(
        z.object({
          type: z.enum(["sale", "purchase"]).optional(),
          status: z.union([z.enum(allowedStatusEnum), z.array(z.enum(allowedStatusEnum))]).optional(),
          partyId: z.string().uuid().optional(),
          fromDate: z.string().datetime().optional(),
          toDate: z.string().datetime().optional(),
          search: z.string().optional(),
          itemId: z.string().uuid().optional(),
          ...paginationSchema.shape,
        })
      )
      .query(async ({ input, ctx }) => {
        const conditions = [
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.documentType, docType as DocumentType),
          isNull(invoices.deletedAt),
        ];

        if (input.type) conditions.push(eq(invoices.type, input.type));
        if (input.status) {
          if (Array.isArray(input.status)) {
            conditions.push(inArray(invoices.status, input.status as InvoiceStatus[]));
          } else {
            conditions.push(eq(invoices.status, input.status as InvoiceStatus));
          }
        }
        if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
        if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
        if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

        const offset = (input.page - 1) * input.limit;

        // If itemId filter: use EXISTS subquery instead of loading IDs into memory
        if (input.itemId) {
          conditions.push(
            sql`EXISTS (SELECT 1 FROM ${invoiceItems} WHERE ${invoiceItems.invoiceId} = ${invoices.id} AND ${invoiceItems.itemId} = ${input.itemId})`
          );
        }

        const [data, [{ count }]] = await Promise.all([
          ctx.db
            .select({
              id: invoices.id,
              invoiceNumber: invoices.invoiceNumber,
              type: invoices.type,
              status: invoices.status,
              documentType: invoices.documentType,
              invoiceDate: invoices.invoiceDate,
              dueDate: invoices.dueDate,
              totalAmount: invoices.totalAmount,
              amountPaid: invoices.amountPaid,
              referenceDocumentId: invoices.referenceDocumentId,
              partyName: parties.name,
              partyId: parties.id,
            })
            .from(invoices)
            .innerJoin(parties, eq(parties.id, invoices.partyId))
            .where(and(...conditions))
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit)
            .offset(offset),
          ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(invoices)
            .where(and(...conditions)),
        ]);

        return { data, total: count, page: input.page, limit: input.limit };
      }),

    getById: viewerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        const [invoice] = await ctx.db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.id, input.id),
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.documentType, docType as DocumentType)
            )
          )
          .limit(1);

        if (!invoice) return null;

        const [lineItems, [party]] = await Promise.all([
          ctx.db
            .select()
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, input.id))
            .orderBy(invoiceItems.sortOrder),
          ctx.db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1),
        ]);

        return { ...invoice, lineItems, party: party ?? null };
      }),

    create: memberProcedure
      .input(createInvoiceSchema)
      .mutation(async ({ input, ctx }) => {
        const doc = await ctx.db.transaction(async (tx) => {
          // Security: validate that partyId belongs to the current business.
          const [partyCheck] = await tx.select({ id: parties.id })
            .from(parties)
            .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
            .limit(1);
          if (!partyCheck) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
          }

          // Security: validate that every itemId in line items belongs to the current business.
          // Soft-delete note: mirrors `invoice.ts` — this is an ownership
          // check, not an active-state check. Allowing soft-deleted items
          // keeps backdated document creation (CLI, imports, historical
          // re-entry) functional.
          const createLineItemIds = input.lineItems
            .map((li) => li.itemId)
            .filter((id): id is string => Boolean(id));
          if (createLineItemIds.length > 0) {
            const ownedItems = await tx.select({ id: items.id })
              .from(items)
              .where(and(inArray(items.id, createLineItemIds), eq(items.businessId, ctx.businessId)));
            if (ownedItems.length !== new Set(createLineItemIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more items do not belong to this business" });
            }
          }

          // Determine prefix/counter columns for this document type
          const cols = bizColumns[docType as KnownDocType];

          let docNumber: string;

          if (cols) {
            // Atomic counter increment with FOR UPDATE lock
            const [biz] = await tx
              .select({
                prefix: cols.prefix,
                counter: cols.counter,
              })
              .from(businesses)
              .where(eq(businesses.id, ctx.businessId))
              .for("update");

            docNumber = `${biz.prefix}-${String(biz.counter).padStart(5, "0")}`;

            await tx
              .update(businesses)
              .set(cols.setCounter((biz.counter as number) + 1))
              .where(eq(businesses.id, ctx.businessId));
          } else {
            // Fallback: derive number from MAX of existing documents of this type
            const [maxRow] = await tx
              .select({
                maxNum: sql<number>`coalesce(max(cast(regexp_replace(${invoices.invoiceNumber}, '[^0-9]', '', 'g') as integer)), 0)`,
              })
              .from(invoices)
              .where(
                and(
                  eq(invoices.businessId, ctx.businessId),
                  eq(invoices.documentType, docType as DocumentType)
                )
              );
            const nextNum = (maxRow?.maxNum ?? 0) + 1;
            const prefix = docType.toUpperCase().replace(/_/g, "").slice(0, 4);
            docNumber = `${prefix}-${String(nextNum).padStart(5, "0")}`;
          }

          // Calculate line item totals using fixed-point arithmetic
          const processedItems = input.lineItems.map((li, idx) => {
            const calc = calcLineItem({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            });
            return {
              itemId: li.itemId || null,
              itemName: li.itemName,
              description: li.description || null,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              taxAmount: calc.taxAmount,
              discountPercent: li.discountPercent || "0",
              totalAmount: calc.total,
              sortOrder: idx,
              selectedUnit: li.selectedUnit || null,
              conversionFactor: li.conversionFactor || "1",
            };
          });

          const charges = input.charges ?? [];
          const totals = calcInvoiceTotals({
            lineItems: input.lineItems.map((li) => ({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            })),
            charges: charges.length > 0 ? charges : undefined,
            roundOff: charges.length > 0 ? (input.roundOff || "0") : undefined,
          });
          const additionalCharges = charges.length > 0
            ? totals.chargesTotal
            : (input.additionalCharges || "0");
          const roundOff = input.roundOff || "0";

          const [result] = await tx
            .insert(invoices)
            .values({
              businessId: ctx.businessId,
              partyId: input.partyId,
              type: input.type,
              // ALWAYS use config.documentType — never trust client-supplied value
              documentType: docType as DocumentType,
              invoiceNumber: docNumber,
              invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              subtotal: totals.subtotal,
              taxAmount: totals.taxTotal,
              discountAmount: "0.00",
              charges: charges.length > 0 ? charges : null,
              additionalCharges,
              roundOff,
              totalAmount: totals.total,
              notes: input.notes,
              termsAndConditions: input.termsAndConditions,
              referenceDocumentId: input.referenceDocumentId || null,
              createdByUserId: ctx.user!.id,
              createdByName: ctx.user!.name,
            })
            .returning();

          if (processedItems.length > 0) {
            await tx
              .insert(invoiceItems)
              .values(processedItems.map((li) => ({ ...li, invoiceId: result.id })));
          }

          // Stock effects (adjusted for unit conversion)
          // Group by itemId and sum quantities to avoid redundant per-row updates.
          // skipStockAdjustment lets callers (e.g. challan→invoice conversion) opt out.
          // Stock effects — one UPDATE per line item using PostgreSQL NUMERIC
          // arithmetic to avoid JS floating-point drift in accumulation
          if (config.stockEffect !== "none" && !input.skipStockAdjustment) {
            for (const li of input.lineItems) {
              if (li.variantId) {
                await tx
                  .update(itemVariants)
                  .set({
                    stockQuantity: config.stockEffect === "decrement"
                      ? sql`${itemVariants.stockQuantity}::numeric - ${li.quantity}::numeric`
                      : sql`${itemVariants.stockQuantity}::numeric + ${li.quantity}::numeric`,
                    updatedAt: new Date(),
                  })
                  .where(and(
                    eq(itemVariants.id, li.variantId),
                    sql`EXISTS (SELECT 1 FROM items WHERE items.id = item_variants.item_id AND items.business_id = ${ctx.businessId})`
                  ));
              } else if (li.itemId) {
                const cf = li.conversionFactor || "1";
                await tx
                  .update(items)
                  .set({
                    stockQuantity: config.stockEffect === "decrement"
                      ? sql`${items.stockQuantity}::numeric - (${li.quantity}::numeric * ${cf}::numeric)`
                      : sql`${items.stockQuantity}::numeric + (${li.quantity}::numeric * ${cf}::numeric)`,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(items.id, li.itemId), eq(items.businessId, ctx.businessId)));
              }
            }
          }

          return result;
        });

        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user!.id,
          action: `${config.documentType}.create`,
          entityType: config.documentType,
          entityId: doc.id,
          metadata: { invoiceNumber: doc.invoiceNumber, type: config.documentType },
          ipAddress: ctx.req.headers.get("x-forwarded-for"),
        });

        return doc;
      }),

    updateStatus: memberProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(allowedStatusEnum),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [doc] = await ctx.db
          .update(invoices)
          .set({
            status: input.status as InvoiceStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(invoices.id, input.id),
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.documentType, docType as DocumentType)
            )
          )
          .returning();

        if (!doc) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
        }

        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user!.id,
          action: `${config.documentType}.updateStatus`,
          entityType: config.documentType,
          entityId: input.id,
          metadata: { invoiceNumber: doc.invoiceNumber, fromStatus: input.status },
          ipAddress: ctx.req.headers.get("x-forwarded-for"),
        });

        return doc;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const deleteResult = await ctx.db.transaction(async (tx) => {
          const [doc] = await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, input.id),
                eq(invoices.businessId, ctx.businessId),
                eq(invoices.documentType, docType as DocumentType)
              )
            )
            .limit(1);

          if (!doc) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
          }

          // Already soft-deleted — return early
          if (doc.deletedAt) return { success: true, invoiceNumber: doc.invoiceNumber, deleted: false };

          // Reverse stock effects on delete (using stored conversionFactor)
          if (config.stockEffect !== "none") {
            const lineItems = await tx
              .select()
              .from(invoiceItems)
              .where(eq(invoiceItems.invoiceId, input.id));

            // Reverse stock per line item using PostgreSQL NUMERIC arithmetic
            for (const li of lineItems) {
              if (li.variantId) {
                await tx.update(itemVariants).set({
                  stockQuantity: config.stockEffect === "decrement"
                    ? sql`${itemVariants.stockQuantity}::numeric + ${li.quantity}::numeric`
                    : sql`${itemVariants.stockQuantity}::numeric - ${li.quantity}::numeric`,
                  updatedAt: new Date(),
                }).where(and(
                  eq(itemVariants.id, li.variantId),
                  sql`EXISTS (SELECT 1 FROM items WHERE items.id = item_variants.item_id AND items.business_id = ${ctx.businessId})`
                ));
              } else if (li.itemId) {
                const cf = li.conversionFactor ?? "1";
                await tx.update(items).set({
                  stockQuantity: config.stockEffect === "decrement"
                    ? sql`${items.stockQuantity}::numeric + (${li.quantity}::numeric * ${cf}::numeric)`
                    : sql`${items.stockQuantity}::numeric - (${li.quantity}::numeric * ${cf}::numeric)`,
                  updatedAt: new Date(),
                }).where(and(eq(items.id, li.itemId), eq(items.businessId, ctx.businessId)));
              }
            }
          }

          // Soft delete: set deletedAt + cancel the document
          await tx
            .update(invoices)
            .set({ deletedAt: new Date(), status: "cancelled" as const, updatedAt: new Date() })
            .where(
              and(
                eq(invoices.id, input.id),
                eq(invoices.businessId, ctx.businessId)
              )
            );

          return { success: true, invoiceNumber: doc.invoiceNumber, deleted: true };
        });

        if (deleteResult.deleted) {
          logAudit(ctx.db, {
            businessId: ctx.businessId,
            userId: ctx.user!.id,
            action: `${config.documentType}.delete`,
            entityType: config.documentType,
            entityId: input.id,
            metadata: { invoiceNumber: deleteResult.invoiceNumber },
            ipAddress: ctx.req.headers.get("x-forwarded-for"),
          });
        }

        return { success: deleteResult.success };
      }),
  });
}
