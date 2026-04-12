/**
 * shipment-invoice-sync.ts — Keeps invoice charges in sync with shipment costs.
 *
 * WHY THIS FILE EXISTS:
 * When a shipment is created/updated/deleted against an invoice, the invoice's
 * `charges` JSONB column must reflect the shipment cost as a named entry keyed
 * by `shipmentId`. This file provides two transactional helpers that perform
 * that sync under a row-level lock so concurrent shipment mutations don't race.
 *
 * TOTAL AMOUNT FORMULA (delta-based, avoids full recalculation):
 *   newAdditionalCharges = sum of all charge amounts after mutation
 *   newTotal = (oldTotal - oldAdditionalCharges) + newAdditionalCharges
 *
 * The delta formula is safe because subtotal, taxAmount, discountAmount, and
 * roundOff are not changed here — only the charges portion of the total shifts.
 */

import { eq, and } from "drizzle-orm";
import { invoices } from "@hisaabo/db";
import { money } from "@hisaabo/shared";
import { TRPCError } from "@trpc/server";
import type { TenantDatabase } from "../trpc.js";

// The transaction object Drizzle passes to the db.transaction() callback.
// Using Parameters<...> avoids importing drizzle internals directly.
type TenantTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

type InvoiceCharge = { label: string; amount: string; shipmentId?: string };

/**
 * Upserts a shipping charge entry on an invoice.
 *
 * - If an entry with `shipmentId` already exists, updates its amount.
 * - If no entry exists and cost > "0", inserts a new one.
 * - If no entry exists and cost === "0", no-op.
 * - Blocked entirely if the invoice is paid.
 *
 * Must be called inside a DB transaction (tx) to maintain atomicity.
 */
export async function upsertShipmentCharge(
  tx: TenantTx,
  invoiceId: string,
  businessId: string,
  shipmentId: string,
  cost: string,
  label?: string,
): Promise<void> {
  // Row-lock the invoice to prevent concurrent charge mutations
  const [invoice] = await tx
    .select({
      status: invoices.status,
      charges: invoices.charges,
      additionalCharges: invoices.additionalCharges,
      totalAmount: invoices.totalAmount,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .for("update")
    .limit(1);

  if (!invoice) return; // Invoice doesn't exist or doesn't belong to business

  if (invoice.status === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot modify shipment on a paid invoice",
    });
  }

  const existingCharges: InvoiceCharge[] = (invoice.charges as InvoiceCharge[] | null) ?? [];
  const oldAdditionalCharges = invoice.additionalCharges ?? "0";
  const oldTotal = invoice.totalAmount ?? "0";

  // Find existing entry for this shipment
  const existingIdx = existingCharges.findIndex((c) => c.shipmentId === shipmentId);

  let newCharges: InvoiceCharge[];

  if (existingIdx >= 0) {
    if (money.isZero(cost)) {
      // Cost updated to zero — remove the entry
      newCharges = existingCharges.filter((_, i) => i !== existingIdx);
    } else {
      // Update existing entry amount
      newCharges = existingCharges.map((c, i) =>
        i === existingIdx ? { ...c, amount: cost } : c
      );
    }
  } else if (!money.isZero(cost)) {
    // New entry with positive cost
    newCharges = [
      ...existingCharges,
      { label: label ?? "Shipping", amount: cost, shipmentId },
    ];
  } else {
    // Cost is zero and no existing entry — no-op
    return;
  }

  // Recalculate totals
  const newAdditionalCharges =
    newCharges.length > 0 ? money.sum(newCharges.map((c) => c.amount)) : "0.00";

  // Delta formula: subtract old charges portion, add new charges portion
  const newTotal = money.add(
    money.sub(oldTotal, oldAdditionalCharges),
    newAdditionalCharges,
  );

  await tx
    .update(invoices)
    .set({
      charges: newCharges.length > 0 ? newCharges : null,
      additionalCharges: newAdditionalCharges,
      totalAmount: newTotal,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}

/**
 * Removes a shipping charge entry from an invoice.
 *
 * Silently no-ops if no entry for `shipmentId` exists.
 * Blocked entirely if the invoice is paid.
 *
 * Must be called inside a DB transaction (tx) to maintain atomicity.
 */
export async function removeShipmentCharge(
  tx: TenantTx,
  invoiceId: string,
  businessId: string,
  shipmentId: string,
): Promise<void> {
  const [invoice] = await tx
    .select({
      status: invoices.status,
      charges: invoices.charges,
      additionalCharges: invoices.additionalCharges,
      totalAmount: invoices.totalAmount,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .for("update")
    .limit(1);

  if (!invoice) return;

  if (invoice.status === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot modify shipment on a paid invoice",
    });
  }

  const existingCharges: InvoiceCharge[] = (invoice.charges as InvoiceCharge[] | null) ?? [];
  const hasEntry = existingCharges.some((c) => c.shipmentId === shipmentId);

  if (!hasEntry) return; // No-op: entry doesn't exist

  const newCharges = existingCharges.filter((c) => c.shipmentId !== shipmentId);
  const oldAdditionalCharges = invoice.additionalCharges ?? "0";
  const oldTotal = invoice.totalAmount ?? "0";

  const newAdditionalCharges =
    newCharges.length > 0 ? money.sum(newCharges.map((c) => c.amount)) : "0.00";

  const newTotal = money.add(
    money.sub(oldTotal, oldAdditionalCharges),
    newAdditionalCharges,
  );

  await tx
    .update(invoices)
    .set({
      charges: newCharges.length > 0 ? newCharges : null,
      additionalCharges: newAdditionalCharges,
      totalAmount: newTotal,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}
