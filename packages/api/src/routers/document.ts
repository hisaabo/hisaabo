import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { invoices, invoiceItems } from "@hisaabo/db";
import { convertDocumentSchema, createInvoiceSchema, type DocumentType } from "@hisaabo/shared";
import { router, memberProcedure, createCallerFactory } from "../trpc.js";
import { createDocumentRouter } from "../lib/document-router-factory.js";

// ── Per-document-type routers ───────────────────────────────────

export const quotationRouter = createDocumentRouter({
  documentType: "quotation",
  prefixColumn: "quotationPrefix",
  counterColumn: "nextQuotationNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "none",
});

export const creditNoteRouter = createDocumentRouter({
  documentType: "credit_note",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "paid", "cancelled"],
  stockEffect: "increment", // returning items to stock
});

export const debitNoteRouter = createDocumentRouter({
  documentType: "debit_note",
  prefixColumn: "creditNotePrefix", // shares credit note counter
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "paid", "cancelled"],
  stockEffect: "none",
});

export const deliveryChallanRouter = createDocumentRouter({
  documentType: "delivery_challan",
  prefixColumn: "deliveryChallanPrefix",
  counterColumn: "nextDeliveryChallanNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "decrement",
});

export const proformaRouter = createDocumentRouter({
  documentType: "proforma",
  prefixColumn: "proformaPrefix",
  counterColumn: "nextProformaNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "none",
});

export const salesReturnRouter = createDocumentRouter({
  documentType: "sales_return",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "increment", // returned items come back into stock
});

export const purchaseReturnRouter = createDocumentRouter({
  documentType: "purchase_return",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "decrement", // sending items back reduces stock
});

// ── Document conversion router ──────────────────────────────────

export const documentRouter = router({
  /**
   * Convert a document (e.g. quotation → invoice, proforma → invoice).
   * Copies all line items from the source document and creates a new
   * document of the target type, linked via referenceDocumentId.
   */
  convert: memberProcedure
    .input(convertDocumentSchema)
    .mutation(async ({ input, ctx }) => {
      // 1. Fetch source document with line items
      const [sourceDoc] = await ctx.db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.sourceDocumentId),
            eq(invoices.businessId, ctx.businessId)
          )
        )
        .limit(1);

      if (!sourceDoc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source document not found" });
      }

      const sourceLineItems = await ctx.db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, sourceDoc.id))
        .orderBy(invoiceItems.sortOrder);

      // 2. Build createInvoiceSchema-compatible input from source
      const convertInput = createInvoiceSchema.parse({
        partyId: sourceDoc.partyId,
        type: sourceDoc.type,
        documentType: input.targetDocumentType,
        invoiceDate: sourceDoc.invoiceDate.toISOString(),
        dueDate: sourceDoc.dueDate ? sourceDoc.dueDate.toISOString() : undefined,
        notes: sourceDoc.notes ?? undefined,
        termsAndConditions: sourceDoc.termsAndConditions ?? undefined,
        additionalCharges: sourceDoc.additionalCharges,
        roundOff: sourceDoc.roundOff,
        referenceDocumentId: sourceDoc.id,
        lineItems: sourceLineItems.map((li) => ({
          itemId: li.itemId ?? undefined,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
        })),
      });

      // 3. Determine which router to delegate to and invoke its create procedure
      const targetType = input.targetDocumentType;
      const callerCtx = { user: ctx.user, businessId: ctx.businessId, tenantId: ctx.tenantId, db: ctx.db, req: ctx.req, resHeaders: ctx.resHeaders };

      // For invoice target type, import dynamically to avoid circular deps
      if (targetType === "invoice") {
        const { invoiceRouter } = await import("./invoice.js");
        const callerFactory = createCallerFactory(invoiceRouter);
        const caller = callerFactory(callerCtx);
        const newDoc = await caller.create(convertInput);
        return { id: newDoc.id, documentType: "invoice" as DocumentType, invoiceNumber: newDoc.invoiceNumber };
      }

      const targetRouterMap: Record<Exclude<DocumentType, "invoice">, ReturnType<typeof createDocumentRouter>> = {
        quotation: quotationRouter,
        credit_note: creditNoteRouter,
        debit_note: debitNoteRouter,
        delivery_challan: deliveryChallanRouter,
        proforma: proformaRouter,
        sales_return: salesReturnRouter,
        purchase_return: purchaseReturnRouter,
      };

      const targetRouter = targetRouterMap[targetType as Exclude<DocumentType, "invoice">];

      if (!targetRouter) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported target document type: ${targetType}` });
      }

      // Use createCallerFactory to reuse the factory-generated create procedure
      const callerFactory = createCallerFactory(targetRouter);
      const caller = callerFactory(callerCtx);
      const newDoc = await caller.create(convertInput);
      return { id: newDoc.id, documentType: targetType, invoiceNumber: newDoc.invoiceNumber };
    }),
});
