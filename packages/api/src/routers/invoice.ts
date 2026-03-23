import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, invoices, invoiceItems, items, businesses, parties } from "@billbook/db";
import { createInvoiceSchema, updateInvoiceStatusSchema, paginationSchema, documentTypes, invoiceChargeSchema, invoiceLineItemSchema } from "@billbook/shared";
import { router, businessProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";

export const invoiceRouter = router({
  list: businessProcedure
    .input(z.object({
      type: z.enum(["sale", "purchase"]).optional(),
      status: z.enum(["draft", "sent", "paid", "partial", "overdue", "cancelled"]).optional(),
      partyId: z.string().uuid().optional(),
      documentType: z.enum(documentTypes).default("invoice"),
      fromDate: z.string().datetime().optional(),
      toDate: z.string().datetime().optional(),
      itemId: z.string().uuid().optional(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, input.documentType),
      ];
      if (input.type) conditions.push(eq(invoices.type, input.type));
      if (input.status) conditions.push(eq(invoices.status, input.status));
      if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
      if (input.fromDate) conditions.push(gte(invoices.invoiceDate, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(invoices.invoiceDate, new Date(input.toDate)));

      // itemId filter: find invoices that contain this item
      if (input.itemId) {
        const rows = await db
          .select({ invoiceId: invoiceItems.invoiceId })
          .from(invoiceItems)
          .where(eq(invoiceItems.itemId, input.itemId));
        const ids = rows.map((r) => r.invoiceId);
        if (ids.length === 0) {
          return { data: [], total: 0, page: input.page, limit: input.limit };
        }
        conditions.push(inArray(invoices.id, ids));
      }

      const offset = (input.page - 1) * input.limit;

      const [data, [{ count }]] = await Promise.all([
        db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          type: invoices.type,
          status: invoices.status,
          documentType: invoices.documentType,
          invoiceDate: invoices.invoiceDate,
          dueDate: invoices.dueDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          partyName: parties.name,
          partyId: parties.id,
        }).from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .where(and(...conditions))
          .orderBy(desc(invoices.invoiceDate))
          .limit(input.limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` }).from(invoices)
          .where(and(...conditions)),
      ]);

      return { data, total: count, page: input.page, limit: input.limit };
    }),

  getById: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [invoice] = await db.select().from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!invoice) return null;

      const [lineItems, [party]] = await Promise.all([
        db.select().from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, input.id))
          .orderBy(invoiceItems.sortOrder),
        db.select().from(parties)
          .where(eq(parties.id, invoice.partyId)).limit(1),
      ]);

      return { ...invoice, lineItems, party: party ?? null };
    }),

  create: businessProcedure.input(createInvoiceSchema).mutation(async ({ input, ctx }) => {
    return db.transaction(async (tx) => {
      // Get and increment invoice number atomically
      const [biz] = await tx.select({
        prefix: businesses.invoicePrefix,
        nextNum: businesses.nextInvoiceNumber,
      }).from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .for("update");

      const invoiceNumber = `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`;

      await tx.update(businesses)
        .set({ nextInvoiceNumber: biz.nextNum + 1 })
        .where(eq(businesses.id, ctx.businessId));

      // Calculate line item totals
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

      const subtotal = processedItems.reduce((s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.taxAmount), 0);
      const taxAmount = processedItems.reduce((s, i) => s + parseFloat(i.taxAmount), 0);
      const charges = input.charges ?? [];
      const additionalCharges = charges.length > 0
        ? charges.reduce((sum, c) => sum + parseFloat(c.amount), 0)
        : parseFloat(input.additionalCharges || "0");
      const roundOff = parseFloat(input.roundOff || "0");
      const totalAmount = subtotal + taxAmount + additionalCharges + roundOff;

      const [invoice] = await tx.insert(invoices).values({
        businessId: ctx.businessId,
        partyId: input.partyId,
        type: input.type,
        documentType: "invoice",
        invoiceNumber,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        discountAmount: "0.00",
        charges: charges.length > 0 ? charges : null,
        additionalCharges: additionalCharges.toFixed(2),
        roundOff: roundOff.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        notes: input.notes,
        termsAndConditions: input.termsAndConditions,
        referenceDocumentId: input.referenceDocumentId || null,
      }).returning();

      if (processedItems.length > 0) {
        await tx.insert(invoiceItems).values(
          processedItems.map((li) => ({ ...li, invoiceId: invoice.id }))
        );
      }

      // Update stock quantities for sale invoices
      if (input.type === "sale") {
        for (const li of input.lineItems) {
          if (li.itemId) {
            await tx.update(items)
              .set({
                stockQuantity: sql`${items.stockQuantity}::numeric - ${li.quantity}::numeric`,
                updatedAt: new Date(),
              })
              .where(eq(items.id, li.itemId));
          }
        }
      } else if (input.type === "purchase") {
        for (const li of input.lineItems) {
          if (li.itemId) {
            await tx.update(items)
              .set({
                stockQuantity: sql`${items.stockQuantity}::numeric + ${li.quantity}::numeric`,
                updatedAt: new Date(),
              })
              .where(eq(items.id, li.itemId));
          }
        }
      }

      return invoice;
    });
  }),

  updateStatus: businessProcedure
    .input(z.object({ id: z.string().uuid(), ...updateInvoiceStatusSchema.shape }))
    .mutation(async ({ input, ctx }) => {
      const [invoice] = await db.update(invoices)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .returning();
      return invoice;
    }),

  update: businessProcedure
    .input(z.object({
      id: z.string().uuid(),
      partyId: z.string().uuid().optional(),
      invoiceDate: z.string().datetime().optional(),
      dueDate: z.string().datetime().optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      termsAndConditions: z.string().max(2000).optional().nullable(),
      charges: z.array(invoiceChargeSchema).optional(),
      roundOff: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
      lineItems: z.array(invoiceLineItemSchema).min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.transaction(async (tx) => {
        // 1. Fetch existing invoice
        const [existing] = await tx.select()
          .from(invoices)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        if (existing.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot edit a paid invoice. Remove payments first." });

        // 2. Build update payload
        const updates: Record<string, any> = { updatedAt: new Date() };

        if (input.partyId) updates.partyId = input.partyId;
        if (input.invoiceDate) updates.invoiceDate = new Date(input.invoiceDate);
        if (input.dueDate !== undefined) updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.termsAndConditions !== undefined) updates.termsAndConditions = input.termsAndConditions;

        // 3. Handle charges
        if (input.charges) {
          updates.charges = input.charges;
          updates.additionalCharges = input.charges
            .reduce((sum, c) => sum + parseFloat(c.amount), 0)
            .toFixed(2);
        }
        if (input.roundOff !== undefined) updates.roundOff = input.roundOff;

        // 4. Handle line items — delete old, insert new, recalculate totals
        if (input.lineItems) {
          // Delete existing line items
          await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));

          // Process and insert new line items (same logic as create)
          const processedItems = input.lineItems.map((li, idx) => {
            const qty = parseFloat(li.quantity) || 0;
            const price = parseFloat(li.unitPrice) || 0;
            const disc = parseFloat(li.discountPercent || "0");
            const tax = parseFloat(li.taxPercent || "0");
            const subtotal = qty * price;
            const afterDiscount = subtotal * (1 - disc / 100);
            const taxAmt = afterDiscount * (tax / 100);
            const total = afterDiscount + taxAmt;

            return {
              invoiceId: input.id,
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

          if (processedItems.length > 0) {
            await tx.insert(invoiceItems).values(processedItems);
          }

          // Recalculate totals
          const subtotal = processedItems.reduce((s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.taxAmount), 0);
          const taxAmount = processedItems.reduce((s, i) => s + parseFloat(i.taxAmount), 0);
          const additionalCharges = input.charges
            ? input.charges.reduce((sum, c) => sum + parseFloat(c.amount), 0)
            : parseFloat(existing.additionalCharges);
          const roundOff = input.roundOff !== undefined ? parseFloat(input.roundOff) : parseFloat(existing.roundOff);
          const totalAmount = subtotal + taxAmount + additionalCharges + roundOff;

          updates.subtotal = subtotal.toFixed(2);
          updates.taxAmount = taxAmount.toFixed(2);
          updates.totalAmount = totalAmount.toFixed(2);
        }

        // 5. Apply update
        const [updated] = await tx.update(invoices)
          .set(updates)
          .where(eq(invoices.id, input.id))
          .returning();

        return updated;
      });
    }),

  delete: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [inv] = await db.select({ status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (inv && inv.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft invoices can be deleted" });
      }

      await db.delete(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)));
      return { success: true };
    }),
});
