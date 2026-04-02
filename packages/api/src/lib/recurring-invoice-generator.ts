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
    description: string;
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
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "half_yearly": d.setMonth(d.getMonth() + 6); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
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

    // Validate line item IDs belong to business
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
        description: li.description,
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

    // Update stock for sale/purchase
    const itemStockMap = new Map<string, number>();
    const variantStockMap = new Map<string, number>();
    for (const li of template.lineItems) {
      if (li.variantId) {
        const qty = parseFloat(li.quantity);
        variantStockMap.set(li.variantId, (variantStockMap.get(li.variantId) || 0) + qty);
      } else if (li.itemId) {
        const qty = parseFloat(li.quantity) * parseFloat(li.conversionFactor || "1");
        itemStockMap.set(li.itemId, (itemStockMap.get(li.itemId) || 0) + qty);
      }
    }
    for (const [itemId, totalQty] of itemStockMap) {
      const qtyStr = totalQty.toFixed(3);
      await tx.update(items).set({
        stockQuantity: template.type === "sale"
          ? sql`${items.stockQuantity}::numeric - ${qtyStr}::numeric`
          : sql`${items.stockQuantity}::numeric + ${qtyStr}::numeric`,
        updatedAt: new Date(),
      }).where(eq(items.id, itemId));
    }
    for (const [variantId, totalQty] of variantStockMap) {
      const qtyStr = totalQty.toFixed(3);
      await tx.update(itemVariants).set({
        stockQuantity: template.type === "sale"
          ? sql`${itemVariants.stockQuantity}::numeric - ${qtyStr}::numeric`
          : sql`${itemVariants.stockQuantity}::numeric + ${qtyStr}::numeric`,
        updatedAt: new Date(),
      }).where(eq(itemVariants.id, variantId));
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
