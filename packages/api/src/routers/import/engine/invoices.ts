import { parties, items, invoices, invoiceItems, payments, shipments } from "@hisaabo/db";
import { eq, sql } from "drizzle-orm";
import { calcLineItem, money } from "@hisaabo/shared";
import type { TenantDatabase } from "../../../trpc.js";
import type { CanonicalInvoice } from "../types.js";

export interface InvoiceImportOpts {
  autoCreatePayments: boolean;
  defaultPaymentMode: "cash" | "bank" | "upi" | "cheque" | "other";
}

export interface InvoiceImportResult {
  created: number;
  skipped: number;
  total: number;
  errors: string[];
}

export async function runInvoicesImport(
  db: TenantDatabase,
  businessId: string,
  user: { id: string; name: string | null },
  source: string,
  canonicalInvoices: CanonicalInvoice[],
  opts: InvoiceImportOpts,
): Promise<InvoiceImportResult> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Pre-fetch reference data
  const allParties = await db.select({ id: parties.id, name: parties.name })
    .from(parties).where(eq(parties.businessId, businessId));
  const partyByName = new Map(allParties.map(p => [p.name.toLowerCase(), p.id]));

  const allItems = await db.select({ id: items.id, name: items.name })
    .from(items).where(eq(items.businessId, businessId));
  const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i.id]));

  const existingNumbers = new Set(
    (await db.select({ n: invoices.invoiceNumber })
      .from(invoices).where(eq(invoices.businessId, businessId)))
      .map(r => r.n)
  );

  // ── Phase 1: Pre-validate and prepare all rows in memory ──
  const validInvoices: Array<{
    invoiceId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoiceRow: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineItemRows: any[];
    stockDeltas: Map<string, number>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    autoPaymentRow: any | null;
  }> = [];

  for (const inv of canonicalInvoices) {
    const partyId = partyByName.get(inv.partyName.toLowerCase());
    if (!partyId) {
      errors.push(`Party "${inv.partyName}" not found for invoice ${inv.invoiceNumber}`);
      skipped++;
      continue;
    }

    if (existingNumbers.has(inv.invoiceNumber)) {
      skipped++;
      continue;
    }

    const invoiceId = crypto.randomUUID();

    const invoiceRow = {
      id: invoiceId,
      businessId,
      partyId,
      type: inv.type,
      documentType: "invoice" as const,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate ?? null,
      status: (money.toNumber(inv.totalAmount) === 0 ? "paid" : "sent") as "paid" | "sent",
      subtotal: inv.subtotal,
      taxAmount: inv.taxAmount,
      discountAmount: inv.discountAmount,
      charges: inv.charges?.length ? inv.charges : null,
      additionalCharges: inv.charges?.length
        ? inv.charges.reduce((s, c) => s + money.toNumber(c.amount), 0).toFixed(2)
        : "0",
      roundOff: "0",
      totalAmount: inv.totalAmount,
      amountPaid: money.toNumber(inv.totalAmount) === 0 ? inv.totalAmount : "0",
      notes: inv.notes || null,
      createdByUserId: user.id,
      createdByName: inv.createdByName || user.name,
      source,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineItemRows: any[] = [];
    const stockDeltas = new Map<string, number>();

    if (inv.lineItems?.length) {
      for (let idx = 0; idx < inv.lineItems.length; idx++) {
        const li = inv.lineItems[idx];
        const itemId = li.itemName ? (itemByName.get(li.itemName.toLowerCase()) ?? null) : null;

        const calc = calcLineItem({
          quantity: li.quantity || "1",
          unitPrice: li.unitPrice || "0",
          taxPercent: li.taxPercent || "0",
          discountPercent: li.discountPercent || "0",
        });

        const cf = li.conversionFactor || "1";
        lineItemRows.push({
          invoiceId,
          itemId,
          // Post Bug B: itemName is the required snapshot. The adapter
          // already enforces a non-empty itemName via the canonical schema,
          // but we keep the fallback as defence in depth in case a row
          // somehow slipped through. description is the optional notes
          // column — imported invoices have no user-authored notes, so
          // it stays null.
          itemName: li.itemName || "Imported item",
          description: li.description ?? null,
          quantity: li.quantity,
          selectedUnit: li.unit || null,
          conversionFactor: cf,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent || "0",
          taxAmount: calc.taxAmount,
          discountPercent: li.discountPercent || "0",
          totalAmount: calc.total,
          sortOrder: idx,
        });

        if (itemId) {
          // Stock delta in base units: qty × conversionFactor
          const baseQty = money.toNumber(li.quantity || "1") * money.toNumber(cf);
          stockDeltas.set(itemId, (stockDeltas.get(itemId) || 0) + baseQty);
        }
      }
    } else {
      lineItemRows.push({
        invoiceId,
        itemId: null,
        // Synthetic single-line fallback when the source CSV had no line
        // items. Use itemName as the placeholder display text; description
        // (notes) stays null.
        itemName: `Imported: ${inv.invoiceNumber}`,
        description: null,
        quantity: "1",
        unitPrice: inv.totalAmount,
        taxPercent: "0",
        taxAmount: "0",
        discountPercent: "0",
        totalAmount: inv.totalAmount,
        sortOrder: 0,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let autoPaymentRow: any | null = null;
    if (opts.autoCreatePayments && money.isPositive(inv.amountPaid)) {
      const mode = inv.paymentMode || opts.defaultPaymentMode;
      autoPaymentRow = {
        businessId,
        partyId,
        invoiceId,
        paymentNumber: `IMP-${inv.invoiceNumber}`,
        amount: inv.amountPaid,
        discount: "0",
        mode,
        paymentDate: inv.invoiceDate,
        notes: `Imported payment for ${inv.invoiceNumber}`,
        createdByUserId: user.id,
        createdByName: inv.createdByName || user.name,
        source,
      };
    }

    validInvoices.push({ invoiceId, invoiceRow, lineItemRows, stockDeltas, autoPaymentRow });
    existingNumbers.add(inv.invoiceNumber);
    created++;
  }

  // ── Phase 2: Batch insert in chunks of 100 ──
  const BATCH = 100;
  for (let i = 0; i < validInvoices.length; i += BATCH) {
    const batch = validInvoices.slice(i, i + BATCH);

    await db.transaction(async (tx) => {
      // Bulk insert invoices
      await tx.insert(invoices).values(batch.map(b => b.invoiceRow));

      // Bulk insert all line items for this batch
      const allLineItems = batch.flatMap(b => b.lineItemRows);
      if (allLineItems.length > 0) {
        for (let j = 0; j < allLineItems.length; j += 500) {
          await tx.insert(invoiceItems).values(allLineItems.slice(j, j + 500));
        }
      }

      // Aggregate stock deltas by direction
      const saleDeltas = new Map<string, number>();
      const purchaseDeltas = new Map<string, number>();
      for (const b of batch) {
        for (const [itemId, qty] of b.stockDeltas) {
          if (b.invoiceRow.type === "sale") {
            saleDeltas.set(itemId, (saleDeltas.get(itemId) || 0) + qty);
          } else {
            purchaseDeltas.set(itemId, (purchaseDeltas.get(itemId) || 0) + qty);
          }
        }
      }

      // Apply sale stock adjustments (subtract)
      for (const [itemId, totalQty] of saleDeltas) {
        await tx.update(items).set({
          stockQuantity: sql`${items.stockQuantity}::numeric - ${totalQty.toFixed(3)}::numeric`,
          updatedAt: new Date(),
        }).where(eq(items.id, itemId));
      }

      // Apply purchase stock adjustments (add)
      for (const [itemId, totalQty] of purchaseDeltas) {
        await tx.update(items).set({
          stockQuantity: sql`${items.stockQuantity}::numeric + ${totalQty.toFixed(3)}::numeric`,
          updatedAt: new Date(),
        }).where(eq(items.id, itemId));
      }

      // Bulk insert auto-payment records if any
      const autoPayments = batch.map(b => b.autoPaymentRow).filter(Boolean);
      if (autoPayments.length > 0) {
        await tx.insert(payments).values(autoPayments);
      }

      // Auto-create shipment entries only for sale invoices with shipping charges
      const shipmentRows = batch
        .filter(b => b.invoiceRow.type === "sale")
        .map(b => {
          const charges = (b.invoiceRow.charges as Array<{ label: string; amount: string }>) || [];
          const shippingCharge = charges.find((c) =>
            /shipping|delivery|freight|transport/i.test(c.label)
          );
          if (!shippingCharge || parseFloat(shippingCharge.amount) <= 0) return null;
          return {
            businessId: b.invoiceRow.businessId,
            invoiceId: b.invoiceId,
            partyId: b.invoiceRow.partyId,
            mode: "hand_delivery",
            cost: shippingCharge.amount,
            status: "delivered" as const, // imported invoices are historical — shipment already happened
            shipmentDate: b.invoiceRow.invoiceDate,
            actualDelivery: b.invoiceRow.invoiceDate,
          };
        })
        .filter(Boolean) as Array<{
          businessId: string;
          invoiceId: string;
          partyId: string;
          mode: string;
          cost: string;
          status: "delivered";
          shipmentDate: Date;
          actualDelivery: Date;
        }>;

      if (shipmentRows.length > 0) {
        await tx.insert(shipments).values(shipmentRows);
      }
    });
  }

  return { created, skipped, total: canonicalInvoices.length, errors };
}
