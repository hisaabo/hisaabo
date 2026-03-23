import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  db,
  invoices,
  invoiceItems,
  items,
  businesses,
  parties,
} from "@billbook/db";
import {
  createInvoiceSchema,
  paginationSchema,
  type DocumentType,
} from "@billbook/shared";
import { router, businessProcedure } from "../trpc.js";

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
    prefix: businesses.creditNotePrefix,
    counter: businesses.nextCreditNoteNumber,
    setCounter: (n: number) => ({ nextCreditNoteNumber: n }),
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
    prefix: businesses.creditNotePrefix,
    counter: businesses.nextCreditNoteNumber,
    setCounter: (n: number) => ({ nextCreditNoteNumber: n }),
  },
  purchase_return: {
    prefix: businesses.creditNotePrefix,
    counter: businesses.nextCreditNoteNumber,
    setCounter: (n: number) => ({ nextCreditNoteNumber: n }),
  },
} as const;

type KnownDocType = keyof typeof bizColumns;

export function createDocumentRouter(config: DocumentRouterConfig) {
  const docType = config.documentType;
  const allowedStatusEnum = config.allowedStatuses as [string, ...string[]];

  return router({
    list: businessProcedure
      .input(
        z.object({
          type: z.enum(["sale", "purchase"]).optional(),
          status: z.enum(allowedStatusEnum).optional(),
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
        ];

        if (input.type) conditions.push(eq(invoices.type, input.type));
        if (input.status) {
          conditions.push(
            eq(invoices.status, input.status as InvoiceStatus)
          );
        }
        if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
        if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
        if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

        const offset = (input.page - 1) * input.limit;

        // If itemId filter: find invoice IDs that have that item, then filter
        let invoiceIdFilter: string[] | null = null;
        if (input.itemId) {
          const rows = await db
            .select({ invoiceId: invoiceItems.invoiceId })
            .from(invoiceItems)
            .where(eq(invoiceItems.itemId, input.itemId));
          invoiceIdFilter = rows.map((r) => r.invoiceId);
          if (invoiceIdFilter.length === 0) {
            return { data: [], total: 0, page: input.page, limit: input.limit };
          }
          conditions.push(inArray(invoices.id, invoiceIdFilter));
        }

        const [data, [{ count }]] = await Promise.all([
          db
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
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(invoices)
            .where(and(...conditions)),
        ]);

        return { data, total: count, page: input.page, limit: input.limit };
      }),

    getById: businessProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        const [invoice] = await db
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
          db
            .select()
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, input.id))
            .orderBy(invoiceItems.sortOrder),
          db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1),
        ]);

        return { ...invoice, lineItems, party: party ?? null };
      }),

    create: businessProcedure
      .input(createInvoiceSchema)
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
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

          // Calculate line item totals (JS arithmetic only for deriving DB-stored strings)
          const processedItems = input.lineItems.map((li, idx) => {
            const qty = parseFloat(li.quantity);
            const price = parseFloat(li.unitPrice);
            const disc = parseFloat(li.discountPercent || "0");
            const tax = parseFloat(li.taxPercent || "0");

            const subtotal = qty * price;
            const discounted = subtotal * (1 - disc / 100);
            const taxAmt = discounted * (tax / 100);
            const total = discounted + taxAmt;

            return {
              itemId: li.itemId || null,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              taxAmount: taxAmt.toFixed(2),
              discountPercent: li.discountPercent || "0",
              totalAmount: total.toFixed(2),
              sortOrder: idx,
            };
          });

          const subtotal = processedItems.reduce(
            (s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.taxAmount),
            0
          );
          const taxAmount = processedItems.reduce((s, i) => s + parseFloat(i.taxAmount), 0);
          const discountAmount = 0; // line-item level discounts already factored in
          const charges = input.charges ?? [];
          const additionalCharges = charges.length > 0
            ? charges.reduce((sum, c) => sum + parseFloat(c.amount), 0)
            : parseFloat(input.additionalCharges || "0");
          const roundOff = parseFloat(input.roundOff || "0");
          const totalAmount =
            subtotal + taxAmount + additionalCharges + roundOff - discountAmount;

          const [doc] = await tx
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
              subtotal: subtotal.toFixed(2),
              taxAmount: taxAmount.toFixed(2),
              discountAmount: discountAmount.toFixed(2),
              charges: charges.length > 0 ? charges : null,
              additionalCharges: additionalCharges.toFixed(2),
              roundOff: roundOff.toFixed(2),
              totalAmount: totalAmount.toFixed(2),
              notes: input.notes,
              termsAndConditions: input.termsAndConditions,
              referenceDocumentId: input.referenceDocumentId || null,
            })
            .returning();

          if (processedItems.length > 0) {
            await tx
              .insert(invoiceItems)
              .values(processedItems.map((li) => ({ ...li, invoiceId: doc.id })));
          }

          // Stock effects
          if (config.stockEffect === "decrement") {
            for (const li of input.lineItems) {
              if (li.itemId) {
                await tx
                  .update(items)
                  .set({
                    stockQuantity: sql`${items.stockQuantity}::numeric - ${li.quantity}::numeric`,
                    updatedAt: new Date(),
                  })
                  .where(eq(items.id, li.itemId));
              }
            }
          } else if (config.stockEffect === "increment") {
            for (const li of input.lineItems) {
              if (li.itemId) {
                await tx
                  .update(items)
                  .set({
                    stockQuantity: sql`${items.stockQuantity}::numeric + ${li.quantity}::numeric`,
                    updatedAt: new Date(),
                  })
                  .where(eq(items.id, li.itemId));
              }
            }
          }

          return doc;
        });
      }),

    updateStatus: businessProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(allowedStatusEnum),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const [doc] = await db
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

        return doc;
      }),

    delete: businessProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
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

          // Reverse stock effects on delete
          if (config.stockEffect !== "none") {
            const lineItems = await tx
              .select()
              .from(invoiceItems)
              .where(eq(invoiceItems.invoiceId, input.id));

            for (const li of lineItems) {
              if (li.itemId) {
                if (config.stockEffect === "decrement") {
                  // was decremented on create → add back on delete
                  await tx
                    .update(items)
                    .set({
                      stockQuantity: sql`${items.stockQuantity}::numeric + ${li.quantity}::numeric`,
                      updatedAt: new Date(),
                    })
                    .where(eq(items.id, li.itemId));
                } else if (config.stockEffect === "increment") {
                  // was incremented on create → subtract on delete
                  await tx
                    .update(items)
                    .set({
                      stockQuantity: sql`${items.stockQuantity}::numeric - ${li.quantity}::numeric`,
                      updatedAt: new Date(),
                    })
                    .where(eq(items.id, li.itemId));
                }
              }
            }
          }

          // Cascade on invoice_items is handled by FK, but we already fetched line items above
          await tx
            .delete(invoices)
            .where(
              and(
                eq(invoices.id, input.id),
                eq(invoices.businessId, ctx.businessId)
              )
            );

          return { success: true };
        });
      }),
  });
}
