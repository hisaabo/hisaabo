import { eq, and, sql, desc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { invoices, invoiceItems, items, itemVariants, businesses, parties, shipments, itcLedgerEntries, eInvoiceConfigs } from "@hisaabo/db";
import { createInvoiceSchema, updateInvoiceStatusSchema, paginationSchema, documentTypes, invoiceChargeSchema, invoiceLineItemSchema, calcLineItem, calcInvoiceTotals, validateInvoiceTotals, MAX_ROUND_OFF, checkInvoiceStatusTransition, checkInvoiceDeleteAllowed, canCreateDocumentType, SELLER_PURCHASE_DENIED_MESSAGE, money } from "@hisaabo/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure, type TenantDatabase } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { assertNoPaymentsOrActiveIrn } from "../lib/invoice-unlink-guard.js";
import { escapeLike } from "../lib/escape-like.js";
import { buildBusinessDateFilter } from "../lib/business-date.js";
import { IRPClient, IRPError } from "../lib/irp-client.js";
import { mapInvoiceToIRP } from "../lib/invoice-to-irp.js";
import { applyStockDeltas } from "../lib/stock-adjust.js";

// Reverse the stock (and purchase ITC) impact an invoice had at creation.
// Shared by delete and cancel so both undo exactly the same effects.
type InvoiceTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

async function reverseInvoiceEffects(
  tx: InvoiceTx,
  businessId: string,
  inv: { id: string; type: "sale" | "purchase"; documentType: string },
) {
  const lineItemRows = await tx.select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, inv.id));

  // Reverse stock per line item (batched, NUMERIC arithmetic in SQL)
  await applyStockDeltas(
    tx,
    lineItemRows.map((li) => ({ ...li, sign: inv.type === "sale" ? (1 as const) : (-1 as const) })),
    { businessId },
  );

  // Auto-reverse ITC when a purchase invoice is deleted/cancelled
  if (inv.type === "purchase" && inv.documentType === "invoice") {
    await tx.update(itcLedgerEntries)
      .set({ status: "reversed", reversalReason: "invoice_cancelled", updatedAt: new Date() })
      .where(and(
        eq(itcLedgerEntries.invoiceId, inv.id),
        eq(itcLedgerEntries.businessId, businessId),
        inArray(itcLedgerEntries.status, ["available", "blocked"]),
      ));
  }
}

export const invoiceRouter = router({
  list: viewerProcedure
    .input(z.object({
      type: z.enum(["sale", "purchase"]).nullish(),
      status: z.union([
        z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"]),
        z.array(z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"])),
      ]).nullish(),
      partyId: z.string().uuid().nullish(),
      documentType: z.enum(documentTypes).default("invoice"),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      itemId: z.string().uuid().nullish(),
      search: z.string().nullish(),
      sortBy: z.enum(["date", "amount", "number"]).nullish(),
      sortDir: z.enum(["asc", "desc"]).nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, input.documentType),
        isNull(invoices.deletedAt),
      ];
      if (input.type) conditions.push(eq(invoices.type, input.type));
      if (Array.isArray(input.status)) {
        conditions.push(inArray(invoices.status, input.status));
      } else if (input.status === "overdue") {
        // Overdue is computed: due date has passed AND invoice is not paid/cancelled/draft
        conditions.push(sql`${invoices.dueDate} < NOW()`);
        conditions.push(sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`);
      } else if (input.status) {
        conditions.push(eq(invoices.status, input.status));
      }
      if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
      conditions.push(...buildBusinessDateFilter(invoices, { from: input.fromDate, to: input.toDate }));
      if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(
          sql`(${invoices.invoiceNumber} ILIKE ${term} OR EXISTS (
            SELECT 1 FROM ${parties} WHERE ${parties.id} = ${invoices.partyId} AND ${parties.name} ILIKE ${term}
          ))`
        );
      }

      // itemId filter: find invoices that contain this item
      if (input.itemId) {
        const rows = await ctx.db
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

      // Subquery: total CN/SR/PR amount issued against each invoice
      const adjSq = ctx.db
        .select({
          refId: invoices.referenceDocumentId,
          totalAdj: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)`.as("total_adj"),
        })
        .from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          sql`${invoices.documentType} IN ('credit_note', 'sales_return', 'purchase_return')`,
          sql`${invoices.status} NOT IN ('cancelled')`,
          isNull(invoices.deletedAt),
        ))
        .groupBy(invoices.referenceDocumentId)
        .as("adj");

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          type: invoices.type,
          status: invoices.status,
          documentType: invoices.documentType,
          invoiceDate: invoices.invoiceDate,
          dueDate: invoices.dueDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          totalAdjusted: sql<string>`COALESCE(${adjSq.totalAdj}::text, '0')`.as("total_adjusted"),
          partyName: parties.name,
          partyId: parties.id,
          createdByName: invoices.createdByName,
          // `source` carries the origin channel: "pos", "online_store",
          // "webhook", or null for manually-typed invoices. Surfaced in the
          // list UI as a small chip so managers can tell at a glance where
          // an invoice came from.
          source: invoices.source,
        }).from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .leftJoin(adjSq, eq(adjSq.refId, invoices.id))
          .where(and(...conditions))
          .orderBy(
            input.sortBy === "amount"
              ? (input.sortDir === "asc" ? sql`${invoices.totalAmount}::numeric ASC` : sql`${invoices.totalAmount}::numeric DESC`)
              : input.sortBy === "number"
                ? (input.sortDir === "asc" ? invoices.invoiceNumber : desc(invoices.invoiceNumber))
                : (input.sortDir === "asc" ? invoices.invoiceDate : desc(invoices.invoiceDate)),
            // Unique tiebreaker keeps offset pages stable (no duplicated/skipped rows)
            input.sortDir === "asc" ? invoices.id : desc(invoices.id),
          )
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(invoices)
          .where(and(...conditions)),
      ]);

      // Compute effective status: if fully adjusted, override to "adjusted"
      const enrichedData = data.map(inv => {
        const adj = parseFloat(inv.totalAdjusted || "0");
        const total = parseFloat(inv.totalAmount);
        const effectiveStatus = (adj >= total - 0.01 && inv.status !== "cancelled" && inv.status !== "draft")
          ? "adjusted"
          : inv.status;
        return { ...inv, status: effectiveStatus };
      });

      return { data: enrichedData, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const [invoice] = await ctx.db.select().from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!invoice) return null;

      const [lineItems, [party]] = await Promise.all([
        ctx.db.select().from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, input.id))
          .orderBy(invoiceItems.sortOrder),
        ctx.db.select().from(parties)
          .where(eq(parties.id, invoice.partyId)).limit(1),
      ]);

      // Fetch the base unit for each linked item so the UI can display a unit
      // even when selectedUnit is null (i.e. the item's base unit was used).
      //
      // Historical join — soft-deleted items must still resolve here so
      // legacy invoice detail pages render correctly after the item is
      // removed from the active catalog. Do NOT add `isNull(deletedAt)`.
      const linkedItemIds = lineItems.map(li => li.itemId).filter((id): id is string => Boolean(id));
      const itemUnitMap = new Map<string, string>();
      if (linkedItemIds.length > 0) {
        const itemUnits = await ctx.db
          .select({ id: items.id, unit: items.unit })
          .from(items)
          .where(inArray(items.id, linkedItemIds));
        for (const row of itemUnits) {
          itemUnitMap.set(row.id, row.unit);
        }
      }

      const lineItemsWithUnit = lineItems.map(li => ({
        ...li,
        itemUnit: li.itemId ? (itemUnitMap.get(li.itemId) ?? null) : null,
      }));

      // Fetch child documents (CN/SR) that reference this invoice
      const relatedDocs = await ctx.db.select({
        id: invoices.id,
        documentType: invoices.documentType,
        invoiceNumber: invoices.invoiceNumber,
        totalAmount: invoices.totalAmount,
        status: invoices.status,
      }).from(invoices)
        .where(and(
          eq(invoices.referenceDocumentId, input.id),
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
          sql`${invoices.status} NOT IN ('cancelled')`,
        ));

      // Compute total adjusted amount (CN + SR + PR) for effective balance
      const totalAdjusted = relatedDocs
        .filter(d => ["credit_note", "sales_return", "purchase_return"].includes(d.documentType))
        .reduce((sum, d) => sum + parseFloat(d.totalAmount), 0)
        .toFixed(2);

      // Dynamic effective status: if fully adjusted by CN/SR, override to "adjusted"
      const adjNum = parseFloat(totalAdjusted);
      const invTotal = parseFloat(invoice.totalAmount);
      const effectiveStatus = (adjNum >= invTotal - 0.01 && invoice.status !== "cancelled" && invoice.status !== "draft")
        ? "adjusted"
        : invoice.status;

      return { ...invoice, status: effectiveStatus, lineItems: lineItemsWithUnit, party: party ?? null, relatedDocuments: relatedDocs, totalAdjusted };
    }),

  create: memberProcedure.input(createInvoiceSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Invoice");
    if (!canCreateDocumentType(ctx.role, input.documentType, input.type)) {
      throw new TRPCError({ code: "FORBIDDEN", message: SELLER_PURCHASE_DENIED_MESSAGE });
    }
    const invoice = await ctx.db.transaction(async (tx) => {
      // Security: validate that the partyId belongs to the current business before
      // creating the invoice. Without this check an attacker could associate an
      // invoice with a party from a different business within the same tenant.
      const [partyCheck] = await tx.select({ id: parties.id, stateCode: parties.stateCode })
        .from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);
      if (!partyCheck) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
      }

      if (input.referenceDocumentId) {
        const [refDoc] = await tx.select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.id, input.referenceDocumentId), eq(invoices.businessId, ctx.businessId)))
          .limit(1);
        if (!refDoc) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Referenced document not found in this business" });
        }
      }

      // Composition scheme: block inter-state sale invoices.
      // Composition dealers may only make intra-state outward supplies (GST rule).
      if (input.type === "sale") {
        const [biz] = await tx.select({
          gstRegistrationType: businesses.gstRegistrationType,
          stateCode: businesses.stateCode,
        }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);

        if (biz?.gstRegistrationType === "composition") {
          if (partyCheck.stateCode && biz.stateCode && partyCheck.stateCode !== biz.stateCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Composition scheme businesses cannot make inter-state outward supplies",
            });
          }
        }
      }

      // Security: validate that every itemId in line items belongs to the current business.
      // Without this an attacker could reference items from another business — which would
      // allow stock manipulation on entities they do not own.
      //
      // Soft-delete note: this check intentionally does NOT filter by
      // `deleted_at IS NULL`. The frontend item picker only shows active
      // items, so legitimate new invoices never reference soft-deleted
      // rows in practice. Allowing soft-deleted items here is what lets
      // historical invoices still be re-submitted through the edit path
      // (or replayed via the CLI) without manual unsoft-deletion.
      const lineItemIds = input.lineItems
        .map((li) => li.itemId)
        .filter((id): id is string => Boolean(id));
      if (lineItemIds.length > 0) {
        const ownedItems = await tx.select({ id: items.id })
          .from(items)
          .where(and(inArray(items.id, lineItemIds), eq(items.businessId, ctx.businessId)));
        if (ownedItems.length !== new Set(lineItemIds).size) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "One or more items do not belong to this business" });
        }
      }

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
          conversionFactor: li.variantId ? "1" : (li.conversionFactor || "1"),
          variantId: li.variantId || null,
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
        invoiceDiscount: input.invoiceDiscount || "0",
        invoiceDiscountType: input.invoiceDiscountType || "amount",
        roundOff: input.roundOff || "0",
      });
      const additionalCharges = charges.length > 0
        ? totals.chargesTotal
        : (input.additionalCharges || "0");
      const roundOff = input.roundOff || "0";

      const [invoice] = await tx.insert(invoices).values({
        businessId: ctx.businessId,
        partyId: input.partyId,
        type: input.type,
        documentType: "invoice",
        invoiceNumber,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxTotal,
        discountAmount: totals.invoiceDiscountAmount,
        charges: charges.length > 0 ? charges : null,
        additionalCharges,
        roundOff,
        totalAmount: totals.total,
        notes: input.notes,
        termsAndConditions: input.termsAndConditions,
        referenceDocumentId: input.referenceDocumentId || null,
        deliveryMethod: input.deliveryMethod || "self_pickup",
        isReverseCharge: input.isReverseCharge ?? false,
        source: input.source ?? null,
        createdByUserId: ctx.user!.id,
        createdByName: ctx.user!.name,
      }).returning();

      if (processedItems.length > 0) {
        await tx.insert(invoiceItems).values(
          processedItems.map((li) => ({ ...li, invoiceId: invoice.id }))
        );
      }

      // Update stock quantities for sale/purchase invoices.
      // Skip when skipStockAdjustment is set — used when converting from
      // delivery_challan (which already decremented stock) to avoid double-counting.
      // Variant lines adjust the variant only (no conversion); item lines adjust
      // the item by quantity * conversion factor. Batched into one UPDATE per table.
      if (!input.skipStockAdjustment) {
        await applyStockDeltas(
          tx,
          input.lineItems.map((li) => ({ ...li, sign: input.type === "sale" ? -1 : 1 })),
          { businessId: ctx.businessId },
        );
      }

      // Auto-create a shipment entry only when a shipping charge is present on a
      // sale invoice. Kept inside the transaction so a failed shipment insert
      // rolls back the whole invoice rather than leaving a charged invoice with
      // no corresponding shipment record.
      if (input.type === "sale") {
        const shippingChargeIdx = (input.charges ?? []).findIndex((c) =>
          /shipping|delivery|freight|transport/i.test(c.label)
        );
        const shippingCharge = shippingChargeIdx >= 0 ? (input.charges ?? [])[shippingChargeIdx] : undefined;
        if (shippingCharge && parseFloat(shippingCharge.amount) > 0) {
          const [newShipment] = await tx.insert(shipments).values({
            businessId: ctx.businessId,
            invoiceId: invoice.id,
            partyId: input.partyId,
            mode: input.deliveryMethod === "self_pickup" ? "hand_delivery" : (input.deliveryMethod || "hand_delivery"),
            cost: shippingCharge.amount,
            status: "pending",
          }).returning();

          // Tag the charge entry in the invoice with the auto-created shipment ID
          const taggedCharges = (invoice.charges ?? []).map((c, i) =>
            i === shippingChargeIdx ? { ...c, shipmentId: newShipment.id } : c
          );
          await tx.update(invoices)
            .set({ charges: taggedCharges })
            .where(eq(invoices.id, invoice.id));
          // Reflect the tag in the returned object so callers see the shipmentId
          invoice.charges = taggedCharges as typeof invoice.charges;
        }
      }

      // Auto-create ITC (Input Tax Credit) ledger entry for purchase invoices
      // with GST. ITC is not available for composition scheme businesses.
      if (input.type === "purchase" && parseFloat(totals.taxTotal) > 0) {
        const [bizForItc] = await tx.select({
          gstRegistrationType: businesses.gstRegistrationType,
          stateCode: businesses.stateCode,
        }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);

        if (bizForItc?.gstRegistrationType !== "composition") {
          const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
          const returnPeriod = `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, "0")}`;

          const sameState = !!(bizForItc?.stateCode && partyCheck.stateCode && bizForItc.stateCode === partyCheck.stateCode);

          // Use integer paise arithmetic to avoid floating-point rounding errors
          const taxPaise = Math.round(parseFloat(totals.taxTotal) * 100);
          let cgst = "0";
          let sgst = "0";
          let igst = "0";

          if (sameState) {
            const halfPaise = Math.floor(taxPaise / 2);
            const remainderPaise = taxPaise - halfPaise;
            cgst = (halfPaise / 100).toFixed(2);
            sgst = (remainderPaise / 100).toFixed(2);
          } else {
            igst = (taxPaise / 100).toFixed(2);
          }

          await tx.insert(itcLedgerEntries).values({
            businessId: ctx.businessId,
            invoiceId: invoice.id,
            returnPeriod,
            status: "available",
            cgst,
            sgst,
            igst,
            cess: "0",
            isReverseCharge: input.isReverseCharge ?? false,
          });
        }
      }

      return invoice;
    });

    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: "invoice.create",
      entityType: "invoice",
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, type: invoice.type, totalAmount: invoice.totalAmount },
      ipAddress: ctx.ipAddress,
    });

    // ── Async e-invoice submission (fire-and-forget) ───────────────────────
    // Invoice creation MUST NOT fail due to IRP errors. We check eligibility
    // synchronously but submit asynchronously so the HTTP response is returned
    // immediately while the IRP call happens in the background.
    // Eligibility: sale invoice, B2B (party has GSTIN), tax > 0, e-invoicing enabled.
    if (
      input.type === "sale" &&
      input.documentType !== "quotation" &&
      input.documentType !== "delivery_challan" &&
      input.documentType !== "proforma" &&
      parseFloat(invoice.taxAmount) > 0
    ) {
      // Capture everything needed for the async task before returning
      const invoiceId = invoice.id;
      const businessId = ctx.businessId;
      const db = ctx.db;

      // Non-blocking: check e-invoice config + party GSTIN
      setTimeout(async () => {
        try {
          const [config] = await db
            .select()
            .from(eInvoiceConfigs)
            .where(and(eq(eInvoiceConfigs.businessId, businessId), eq(eInvoiceConfigs.isEnabled, true)))
            .limit(1);

          if (!config) return; // E-invoicing not configured/enabled

          // Fetch the full invoice with party
          const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
          if (!inv) return;

          const [party] = await db.select().from(parties).where(eq(parties.id, inv.partyId)).limit(1);
          if (!party?.gstin) return; // B2C — skip

          const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
          if (!biz) return;

          // Historical join — the IRP submission is for a specific
          // (already created) invoice. Soft-deleted items must still
          // resolve so their HSN/itemType survive into the IRP payload.
          // Do NOT filter by `deletedAt` here.
          const lineItemRows = await db
            .select({
              itemName: invoiceItems.itemName,
              description: invoiceItems.description,
              quantity: invoiceItems.quantity,
              unitPrice: invoiceItems.unitPrice,
              taxPercent: invoiceItems.taxPercent,
              taxAmount: invoiceItems.taxAmount,
              discountPercent: invoiceItems.discountPercent,
              totalAmount: invoiceItems.totalAmount,
              selectedUnit: invoiceItems.selectedUnit,
              itemType: items.itemType,
              itemHsn: items.hsn,
            })
            .from(invoiceItems)
            .leftJoin(items, eq(items.id, invoiceItems.itemId))
            .where(eq(invoiceItems.invoiceId, invoiceId))
            .orderBy(invoiceItems.sortOrder);

          // Mark as pending
          await db
            .update(invoices)
            .set({ eInvoiceStatus: "pending", updatedAt: new Date() })
            .where(eq(invoices.id, invoiceId));

          const irpJson = mapInvoiceToIRP(
            {
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              type: inv.type,
              documentType: inv.documentType,
              subtotal: inv.subtotal,
              taxAmount: inv.taxAmount,
              discountAmount: inv.discountAmount,
              additionalCharges: inv.additionalCharges,
              roundOff: inv.roundOff,
              totalAmount: inv.totalAmount,
              isReverseCharge: inv.isReverseCharge ?? false,
            },
            lineItemRows.map((li) => ({
              itemName: li.itemName,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent,
              taxAmount: li.taxAmount,
              discountPercent: li.discountPercent,
              totalAmount: li.totalAmount,
              selectedUnit: li.selectedUnit,
              itemType: li.itemType,
              itemHsn: li.itemHsn,
            })),
            {
              gstin: party.gstin,
              name: party.name,
              billingAddress: party.billingAddress,
              city: party.city,
              state: party.state,
              stateCode: party.stateCode,
              pincode: party.pincode,
              phone: party.phone,
              email: party.email,
            },
            {
              gstin: biz.gstin,
              legalName: biz.legalName,
              name: biz.name,
              address: biz.address,
              city: biz.city,
              state: biz.state,
              stateCode: biz.stateCode,
              pincode: biz.pincode,
              phone: biz.phone,
              email: biz.email,
            },
          );

          const client = new IRPClient(config, db);
          const result = await client.generateIRN(irpJson);

          await db
            .update(invoices)
            .set({
              irn: result.irn,
              irnAckNumber: result.ackNo,
              irnAckDate: result.ackDt,
              signedQrCode: result.signedQrCode,
              signedInvoice: { signedInvoice: result.signedInvoice },
              eInvoiceStatus: "generated",
              eInvoiceError: null,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId));
        } catch (err) {
          // IRP errors must not bubble up — just log and mark as failed
          const isRetryable = err instanceof IRPError && err.isRetryable;
          const errorMsg = err instanceof Error ? err.message : "Unknown IRP error";
          if (process.env.NODE_ENV !== "test") {
            console.error("[e-invoice auto-submit]", errorMsg);
          }
          await db
            .update(invoices)
            .set({
              eInvoiceStatus: isRetryable ? "pending" : "failed",
              eInvoiceError: errorMsg,
              eInvoiceRetryCount: sql`COALESCE(${invoices.eInvoiceRetryCount}, 0) + 1`,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId))
            .catch(() => {/* swallow DB errors in background task */});
        }
      }, 0);
    }

    return invoice;
  }),

  // Get the delivery method used on the most recent sale invoice for a party
  lastDeliveryMethod: viewerProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [row] = await ctx.db.select({ deliveryMethod: invoices.deliveryMethod })
        .from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.partyId, input.partyId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
        ))
        .orderBy(desc(invoices.invoiceDate))
        .limit(1);
      return row?.deliveryMethod || "self_pickup";
    }),

  updateStatus: memberProcedure
    .input(z.object({ id: z.string().uuid(), ...updateInvoiceStatusSchema.shape }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");

      const { invoice, fromStatus } = await ctx.db.transaction(async (tx) => {
        const [before] = await tx.select({
          id: invoices.id,
          status: invoices.status,
          type: invoices.type,
          documentType: invoices.documentType,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          createdAt: invoices.createdAt,
          deletedAt: invoices.deletedAt,
          irn: invoices.irn,
          eInvoiceStatus: invoices.eInvoiceStatus,
        })
          .from(invoices)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!before || before.deletedAt) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }

        const transitionError = checkInvoiceStatusTransition(before.status, input.status, before);
        if (transitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: transitionError });
        }

        const isCancelling = input.status === "cancelled" && before.status !== "cancelled";
        if (isCancelling) {
          // Cancelling undoes stock like delete does, so it needs the same permission and rule.
          requireCan(ctx.ability, "delete", "Invoice");
          const verdict = checkInvoiceDeleteAllowed(ctx.role, { status: before.status, createdAt: before.createdAt });
          if (!verdict.allowed) throw new TRPCError({ code: "FORBIDDEN", message: verdict.message });
          await assertNoPaymentsOrActiveIrn(tx, "cancel", before);
          await reverseInvoiceEffects(tx, ctx.businessId, before);
        }

        const [invoice] = await tx.update(invoices)
          .set({ status: input.status, updatedAt: new Date() })
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .returning();

        return { invoice, fromStatus: before.status };
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.updateStatus",
        entityType: "invoice",
        entityId: input.id,
        metadata: { invoiceNumber: invoice.invoiceNumber, fromStatus, toStatus: input.status },
        ipAddress: ctx.ipAddress,
      });

      return invoice;
    }),

  update: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      partyId: z.string().uuid().optional(),
      invoiceDate: z.string().datetime().optional(),
      dueDate: z.string().datetime().optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      termsAndConditions: z.string().max(2000).optional().nullable(),
      charges: z.array(invoiceChargeSchema).optional(),
      invoiceDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      invoiceDiscountType: z.enum(["amount", "percent"]).optional(),
      roundOff: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
      lineItems: z.array(invoiceLineItemSchema).min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      const updated = await ctx.db.transaction(async (tx) => {
        // 1. Fetch existing invoice
        const [existing] = await tx.select()
          .from(invoices)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        if (existing.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        if (existing.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot edit a cancelled invoice." });
        if (existing.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot edit a paid invoice. Remove payments first." });

        // Security: validate partyId belongs to this business before applying the update.
        if (input.partyId) {
          const [partyCheck] = await tx.select({ id: parties.id })
            .from(parties)
            .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
            .limit(1);
          if (!partyCheck) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
          }
        }

        // Security: validate itemIds in line items belong to this business.
        // Soft-delete note: like `create`, this is an ownership check, not
        // an active-state check. Allowing soft-deleted items keeps the
        // edit path working for historical invoices whose line items
        // reference rows the user has since removed from their catalog.
        if (input.lineItems) {
          const updateLineItemIds = input.lineItems
            .map((li) => li.itemId)
            .filter((id): id is string => Boolean(id));
          if (updateLineItemIds.length > 0) {
            const ownedItems = await tx.select({ id: items.id })
              .from(items)
              .where(and(inArray(items.id, updateLineItemIds), eq(items.businessId, ctx.businessId)));
            if (ownedItems.length !== new Set(updateLineItemIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more items do not belong to this business" });
            }
          }

          // Security: validate variantIds belong to items in this business.
          // Same soft-delete rationale as above.
          const updateVariantIds = input.lineItems
            .map((li) => li.variantId)
            .filter((id): id is string => Boolean(id));
          if (updateVariantIds.length > 0) {
            const ownedVariants = await tx.select({ id: itemVariants.id })
              .from(itemVariants)
              .innerJoin(items, eq(items.id, itemVariants.itemId))
              .where(and(inArray(itemVariants.id, updateVariantIds), eq(items.businessId, ctx.businessId)));
            if (ownedVariants.length !== new Set(updateVariantIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more variants do not belong to this business" });
            }
          }
        }

        // 2. Build update payload
        const updates: Record<string, any> = { updatedAt: new Date() };

        if (input.partyId) updates.partyId = input.partyId;
        if (input.invoiceDate) updates.invoiceDate = new Date(input.invoiceDate);
        if (input.dueDate !== undefined) updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.termsAndConditions !== undefined) updates.termsAndConditions = input.termsAndConditions;

        // 3. Handle charges — preserve shipment-linked entries that should not be
        // directly edited by the user (they are managed via shipment mutations).
        if (input.charges !== undefined) {
          const existingShipmentCharges = (existing.charges ?? []).filter((c) => (c as { shipmentId?: string }).shipmentId);
          const userCharges = (input.charges ?? []).filter((c) => !(c as { shipmentId?: string }).shipmentId);
          const mergedCharges = [...userCharges, ...existingShipmentCharges];
          updates.charges = mergedCharges.length > 0 ? mergedCharges : null;
          updates.additionalCharges = mergedCharges.length > 0
            ? money.sum(mergedCharges.map((c) => c.amount))
            : "0.00";
        }
        if (input.roundOff !== undefined) {
          if (money.compare(input.roundOff, MAX_ROUND_OFF) > 0 || money.compare(input.roundOff, `-${MAX_ROUND_OFF}`) < 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Round off cannot exceed ${MAX_ROUND_OFF} in either direction` });
          }
          updates.roundOff = input.roundOff;
        }

        // 4. Handle line items — delete old, insert new, recalculate totals
        if (input.lineItems) {
          // Recalculate totals using fixed-point arithmetic.
          // Use merged charges (updates.charges) if charges were modified; otherwise
          // fall back to existing charges. This ensures shipment-linked charge entries
          // are included in the total even when the user didn't touch charges.
          const chargesForTotals = updates.charges !== undefined
            ? (updates.charges as Array<{ amount: string }> | null) ?? []
            : (existing.charges as Array<{ amount: string }> | null) ?? [];
          const roundOffStr = input.roundOff !== undefined ? input.roundOff : existing.roundOff;
          const totalsInput = {
            lineItems: input.lineItems.map((li) => ({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            })),
            charges: chargesForTotals.length > 0 ? chargesForTotals : undefined,
            invoiceDiscount: input.invoiceDiscount || existing.discountAmount || "0",
            invoiceDiscountType: input.invoiceDiscountType || "amount",
            roundOff: roundOffStr,
          };
          const totalsError = validateInvoiceTotals(totalsInput);
          if (totalsError) throw new TRPCError({ code: "BAD_REQUEST", message: totalsError });
          const totals = calcInvoiceTotals(totalsInput);
          if (money.compare(totals.total, existing.amountPaid) < 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice total cannot be less than the amount already paid" });
          }

          // Step 1: Read old line items to reverse their stock impact
          const oldLineItems = await tx.select({
            itemId: invoiceItems.itemId,
            quantity: invoiceItems.quantity,
            conversionFactor: invoiceItems.conversionFactor,
            variantId: invoiceItems.variantId,
          }).from(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));

          // Steps 2 and 5 (reverse old stock effect, apply new) are netted into a
          // single batched adjustment after the new lines are inserted.

          // Step 3: Delete existing line items
          await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));

          // Step 4: Process and insert new line items using fixed-point arithmetic
          const processedItems = input.lineItems.map((li, idx) => {
            const calc = calcLineItem({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            });
            return {
              invoiceId: input.id,
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
              conversionFactor: li.variantId ? "1" : (li.conversionFactor || "1"),
              variantId: li.variantId || null,
            };
          });

          if (processedItems.length > 0) {
            await tx.insert(invoiceItems).values(processedItems);
          }

          // Step 5: Net stock adjustment — reverse old lines, apply new lines
          const sign: 1 | -1 = existing.type === "sale" ? 1 : -1;
          await applyStockDeltas(
            tx,
            [
              ...oldLineItems.map((li) => ({ ...li, sign })),
              ...input.lineItems.map((li) => ({ ...li, sign: -sign as 1 | -1 })),
            ],
            { businessId: ctx.businessId },
          );

          updates.subtotal = totals.subtotal;
          updates.taxAmount = totals.taxTotal;
          updates.discountAmount = totals.invoiceDiscountAmount;
          updates.totalAmount = totals.total;
        }

        // 5. Apply update
        const [result] = await tx.update(invoices)
          .set(updates)
          .where(eq(invoices.id, input.id))
          .returning();

        return result;
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.update",
        entityType: "invoice",
        entityId: updated.id,
        metadata: { invoiceNumber: updated.invoiceNumber },
        ipAddress: ctx.ipAddress,
      });

      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Invoice");

      const result = await ctx.db.transaction(async (tx) => {
        // Row lock + re-check inside the transaction so concurrent deletes
        // cannot both reverse stock.
        const [inv] = await tx.select({ id: invoices.id, status: invoices.status, type: invoices.type, documentType: invoices.documentType, invoiceNumber: invoices.invoiceNumber, deletedAt: invoices.deletedAt, createdAt: invoices.createdAt, amountPaid: invoices.amountPaid, irn: invoices.irn, eInvoiceStatus: invoices.eInvoiceStatus })
          .from(invoices)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!inv || inv.deletedAt) return null; // missing or already soft-deleted

        // seller_manager: can only delete unpaid invoices created within the last 2 hours
        const verdict = checkInvoiceDeleteAllowed(ctx.role, { status: inv.status, createdAt: inv.createdAt });
        if (!verdict.allowed) throw new TRPCError({ code: "FORBIDDEN", message: verdict.message });

        await assertNoPaymentsOrActiveIrn(tx, "delete", inv);

        // A cancelled invoice already had its stock/ITC reversed when it was cancelled.
        if (inv.status !== "cancelled") {
          await reverseInvoiceEffects(tx, ctx.businessId, inv);
        }

        // Soft delete
        await tx.update(invoices)
          .set({ deletedAt: new Date(), status: "cancelled" as const, updatedAt: new Date() })
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)));

        return inv;
      });

      if (!result) return { success: true };

      await logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.delete",
        entityType: "invoice",
        entityId: input.id,
        metadata: { invoiceNumber: result.invoiceNumber, previousStatus: result.status },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),
});
