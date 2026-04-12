/**
 * Shared logic for generating an invoice from a recurring invoice template.
 * Used by both the scheduler (automatic) and the "runNow" manual trigger.
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import {
  invoices, invoiceItems, items, itemVariants, businesses, parties,
  recurringInvoiceTemplates, recurringInvoiceRuns,
} from "@hisaabo/db";
import { calcLineItem, calcInvoiceTotals } from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";

interface TemplateRow {
  id: string;
  businessId: string;
  partyId: string;
  type: "sale" | "purchase";
  lineItems: Array<{
    itemId?: string;
    itemName: string;
    description?: string | null;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    discountPercent: string;
    selectedUnit?: string | null;
    conversionFactor?: string | null;
    variantId?: string | null;
  }>;
  notes: string | null;
  termsAndConditions: string | null;
  additionalCharges: string;
  charges: Array<{ label: string; amount: string }> | null;
  frequency: string;
  customIntervalDays: number | null;
  nextRunDate: Date;
  totalRuns: number;
  maxRuns: number | null;
  endDate: Date | null;
  createdByUserId: string | null;
}

/** Advance a date by N months, clamping to the last day of the target month. */
function addMonthsClamped(d: Date, months: number): void {
  const originalDay = d.getDate();
  d.setDate(1); // avoid day overflow skipping months
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
}

/** Calculate the next run date after a given date based on frequency. */
export function computeNextRunDate(
  from: Date,
  frequency: string,
  customIntervalDays?: number | null,
): Date {
  const d = new Date(from);
  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": addMonthsClamped(d, 1); break;
    case "quarterly": addMonthsClamped(d, 3); break;
    case "half_yearly": addMonthsClamped(d, 6); break;
    case "yearly": addMonthsClamped(d, 12); break;
    case "custom": d.setDate(d.getDate() + (customIntervalDays || 30)); break;
  }
  return d;
}

/**
 * Generate an invoice from a recurring template inside a transaction.
 * Returns the created invoice and run record, or throws on failure.
 */
export async function generateInvoiceFromTemplate(
  db: TenantDatabase,
  template: TemplateRow,
): Promise<{ invoiceId: string; runId: string }> {
  return db.transaction(async (tx) => {
    // Validate party still exists
    const [partyCheck] = await tx.select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.id, template.partyId), eq(parties.businessId, template.businessId)))
      .limit(1);
    if (!partyCheck) throw new Error("Party not found");

    // Validate line item IDs belong to business.
    //
    // Soft-delete note: the recurring generator runs on a 60s tick in the
    // background. Templates freeze `itemName`, `unitPrice`, and tax data
    // at creation time, so even if the underlying item has since been
    // soft-deleted, the generated invoice still carries a complete line.
    // Treat this as a historical ownership check and do NOT filter by
    // `deletedAt`. If the item was hard-deleted (only possible before
    // Stage 5), the count mismatch still catches it.
    const lineItemIds = template.lineItems
      .map((li) => li.itemId)
      .filter((id): id is string => Boolean(id));
    if (lineItemIds.length > 0) {
      const ownedItems = await tx.select({ id: items.id })
        .from(items)
        .where(and(inArray(items.id, lineItemIds), eq(items.businessId, template.businessId)));
      if (ownedItems.length !== new Set(lineItemIds).size) {
        throw new Error("One or more items no longer belong to this business");
      }
    }

    // Get and increment invoice number atomically
    const [biz] = await tx.select({
      prefix: businesses.invoicePrefix,
      nextNum: businesses.nextInvoiceNumber,
    }).from(businesses)
      .where(eq(businesses.id, template.businessId))
      .for("update");

    const invoiceNumber = `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`;
    await tx.update(businesses)
      .set({ nextInvoiceNumber: biz.nextNum + 1 })
      .where(eq(businesses.id, template.businessId));

    // Calculate line item totals
    const processedItems = template.lineItems.map((li, idx) => {
      const calc = calcLineItem({
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      });
      return {
        itemId: li.itemId || null,
        itemName: li.itemName,
        description: li.description ?? null,
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

    const charges = template.charges ?? [];
    const totals = calcInvoiceTotals({
      lineItems: template.lineItems.map((li) => ({
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
      charges: charges.length > 0 ? charges : undefined,
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      roundOff: "0",
    });
    const additionalCharges = charges.length > 0
      ? totals.chargesTotal
      : (template.additionalCharges || "0");

    // Create invoice
    const [invoice] = await tx.insert(invoices).values({
      businessId: template.businessId,
      partyId: template.partyId,
      type: template.type,
      documentType: "invoice",
      invoiceNumber,
      invoiceDate: new Date(),
      subtotal: totals.subtotal,
      taxAmount: totals.taxTotal,
      discountAmount: "0",
      charges: charges.length > 0 ? charges : null,
      additionalCharges,
      roundOff: "0",
      totalAmount: totals.total,
      notes: template.notes,
      termsAndConditions: template.termsAndConditions,
      createdByUserId: template.createdByUserId,
      source: "recurring",
    }).returning();

    if (processedItems.length > 0) {
      await tx.insert(invoiceItems).values(
        processedItems.map((li) => ({ ...li, invoiceId: invoice.id }))
      );
    }

    // Update stock per line item using PostgreSQL NUMERIC arithmetic
    // to avoid JS floating-point drift in intermediate accumulation
    for (const li of template.lineItems) {
      if (li.variantId) {
        await tx.update(itemVariants).set({
          stockQuantity: template.type === "sale"
            ? sql`${itemVariants.stockQuantity}::numeric - ${li.quantity}::numeric`
            : sql`${itemVariants.stockQuantity}::numeric + ${li.quantity}::numeric`,
          updatedAt: new Date(),
        }).where(eq(itemVariants.id, li.variantId));
      } else if (li.itemId) {
        const cf = li.conversionFactor || "1";
        await tx.update(items).set({
          stockQuantity: template.type === "sale"
            ? sql`${items.stockQuantity}::numeric - (${li.quantity}::numeric * ${cf}::numeric)`
            : sql`${items.stockQuantity}::numeric + (${li.quantity}::numeric * ${cf}::numeric)`,
          updatedAt: new Date(),
        }).where(eq(items.id, li.itemId));
      }
    }

    // Record execution
    const [run] = await tx.insert(recurringInvoiceRuns).values({
      templateId: template.id,
      businessId: template.businessId,
      invoiceId: invoice.id,
      status: "success",
    }).returning();

    // Update template: bump totalRuns, lastRunDate, compute nextRunDate
    const nextRun = computeNextRunDate(
      template.nextRunDate,
      template.frequency,
      template.customIntervalDays,
    );
    const newTotalRuns = template.totalRuns + 1;
    const isCompleted = (template.maxRuns && newTotalRuns >= template.maxRuns)
      || (template.endDate && nextRun > template.endDate);

    await tx.update(recurringInvoiceTemplates).set({
      totalRuns: newTotalRuns,
      lastRunDate: new Date(),
      nextRunDate: nextRun,
      status: isCompleted ? "completed" : undefined,
      updatedAt: new Date(),
    }).where(eq(recurringInvoiceTemplates.id, template.id));

    return { invoiceId: invoice.id, runId: run.id };
  });
}
