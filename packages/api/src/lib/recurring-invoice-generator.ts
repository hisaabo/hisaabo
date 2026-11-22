/**
 * Shared logic for generating an invoice from a recurring invoice template.
 * Used by both the scheduler (automatic) and the "runNow" manual trigger.
 */

import { eq, and, inArray } from "drizzle-orm";
import {
  invoices, invoiceItems, items, businesses, parties,
  recurringInvoiceTemplates, recurringInvoiceRuns,
} from "@hisaabo/db";
import {
  calcLineItem,
  calcInvoiceTotals,
  businessDateOf,
  businessDateParts,
  businessTimeOfDayMs,
  businessInstant,
  addMonthsClampedYmd,
} from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";
import { applyStockDeltas } from "./stock-adjust.js";

export interface TemplateRow {
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
  /** Together they say whether the template has an anchor day (see `templateAnchor`). */
  startDate?: Date;
  createdAt?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_PER_PERIOD: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const DAYS_PER_PERIOD: Record<string, number> = { weekly: 7, biweekly: 14 };

/**
 * The instant of the template's first occurrence when it was created with a start date in the future
 * (`startDate` after `createdAt`): the anchor every later monthly / quarterly / half-yearly / yearly
 * occurrence is counted from, so a template due "on the 1st" or "on the 31st" keeps that day. A
 * template whose start date was today or in the past has no anchor (its first run was computed from
 * the creation time), and each run is counted from the previous one.
 */
export function templateAnchor(t: { startDate?: Date | null; createdAt?: Date | null }): Date | null {
  return t.startDate && t.createdAt && t.startDate.getTime() > t.createdAt.getTime() ? t.startDate : null;
}

/**
 * The run date after `from`, on the BUSINESS calendar (IST, see @hisaabo/shared business-time): the
 * calendar day moves, the IST time of day is kept, and the result does not depend on the server's
 * time zone. Days-based frequencies add whole days (IST has no daylight saving). Month-based ones add
 * calendar months and clamp to the month's last day (31 Jan -> 28/29 Feb, 30 Apr -> 30 May); with an
 * `anchor` (see `templateAnchor`) the occurrences are counted from the anchor's day, so the day
 * comes back after a short month (31 Jan -> 28 Feb -> 31 Mar), and a drifted `from` is pulled back
 * onto the anchor's schedule at its next occurrence.
 */
export function computeNextRunDate(
  from: Date,
  frequency: string,
  customIntervalDays?: number | null,
  anchor?: Date | null,
): Date {
  const days = frequency === "custom" ? (customIntervalDays || 30) : DAYS_PER_PERIOD[frequency];
  if (days !== undefined) return new Date(from.getTime() + days * DAY_MS);

  const months = MONTHS_PER_PERIOD[frequency];
  if (months === undefined) return new Date(from);

  if (anchor) {
    const a = businessDateParts(anchor);
    const tod = businessTimeOfDayMs(anchor);
    // the first occurrence of the anchor's schedule after `from` (at most 200 years of them)
    for (let k = 0; k < 2400; k++) {
      const c = businessInstant(addMonthsClampedYmd(a, k * months), tod);
      if (c.getTime() > from.getTime()) return c;
    }
  }
  return businessInstant(addMonthsClampedYmd(businessDateParts(from), months), businessTimeOfDayMs(from));
}

/** The transaction handle `db.transaction` passes to its callback. */
export type TenantTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

/** Narrows a `recurring_invoice_templates` row (its JSONB columns are untyped at runtime) to what the generator takes. */
export function toTemplateRow(row: typeof recurringInvoiceTemplates.$inferSelect): TemplateRow {
  return {
    ...row,
    lineItems: row.lineItems as TemplateRow["lineItems"],
    charges: row.charges as TemplateRow["charges"],
  };
}

/**
 * Manual trigger ("Run now"): generates one invoice from a template in its own
 * transaction. Returns the created invoice and run record, or throws on failure.
 *
 * The template row is locked (`FOR UPDATE`, waiting if the scheduler or another
 * click holds it) and the run works from its CURRENT state, not the caller's
 * earlier read, so two clicks in a row consume two successive occurrences
 * instead of racing for the same one.
 */
export async function generateInvoiceFromTemplate(
  db: TenantDatabase,
  template: TemplateRow,
): Promise<{ invoiceId: string; runId: string }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select()
      .from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id))
      .for("update");
    if (!locked) throw new Error("Template not found");
    if (locked.status !== "active" && locked.status !== "paused") {
      throw new Error("Template must be active or paused");
    }
    return generateInvoiceInTx(tx, toTemplateRow(locked));
  });
}

/**
 * Generates one invoice from a recurring template inside the caller's
 * transaction, which must already hold the template row's lock
 * (`SELECT ... FOR UPDATE`) and pass that locked row as `template`. The run
 * consumes the occurrence `template.nextRunDate` and advances it; the lock is
 * what keeps a concurrent runner from consuming the same one (and
 * `recurring_run_occurrence_uniq` catches it if one ever does). The invoice,
 * its stock movement, the run record and the template update commit or roll
 * back together.
 */
export async function generateInvoiceInTx(
  tx: TenantTx,
  template: TemplateRow,
): Promise<{ invoiceId: string; runId: string }> {
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

  // Update stock (batched, NUMERIC arithmetic in SQL)
  await applyStockDeltas(
    tx,
    template.lineItems.map((li) => ({ ...li, sign: template.type === "sale" ? -1 : 1 })),
  );

  // Record execution
  const [run] = await tx.insert(recurringInvoiceRuns).values({
    templateId: template.id,
    businessId: template.businessId,
    invoiceId: invoice.id,
    status: "success",
    scheduledFor: template.nextRunDate,
  }).returning();

  // Update template: bump totalRuns, lastRunDate, compute nextRunDate
  const nextRun = computeNextRunDate(
    template.nextRunDate,
    template.frequency,
    template.customIntervalDays,
    templateAnchor(template),
  );
  const newTotalRuns = template.totalRuns + 1;
  // The end date is a calendar day (IST) and an occurrence ON that day still runs.
  const isCompleted = (template.maxRuns && newTotalRuns >= template.maxRuns)
    || (template.endDate && businessDateOf(nextRun) > businessDateOf(template.endDate));

  await tx.update(recurringInvoiceTemplates).set({
    totalRuns: newTotalRuns,
    lastRunDate: new Date(),
    nextRunDate: nextRun,
    status: isCompleted ? "completed" : undefined,
    updatedAt: new Date(),
  }).where(eq(recurringInvoiceTemplates.id, template.id));

  return { invoiceId: invoice.id, runId: run.id };
}
