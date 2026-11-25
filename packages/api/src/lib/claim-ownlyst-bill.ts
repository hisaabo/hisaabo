import { eq, and, sql, ilike, isNull } from "drizzle-orm";
import { invoices, invoiceItems, items, businesses, parties, itcLedgerEntries } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";
import {
  calcLineItem,
  calcInvoiceTotals,
  type ClaimOwnlystBillInput,
  type Unit,
} from "@hisaabo/shared";
import { applyStockDeltas } from "./stock-adjust.js";
import { logAudit } from "./audit.js";
import { escapeLike } from "./escape-like.js";

export interface ClaimResult {
  success: boolean;
  alreadyClaimed: boolean;
  invoiceId: string;
  invoiceNumber: string;
}

export async function processClaimOwnlystBill(
  db: TenantDatabase,
  businessId: string,
  user: { id: string; name: string | null },
  input: ClaimOwnlystBillInput
): Promise<ClaimResult> {
  // 1. Idempotency check via dedupeKey in notes
  const escapedDedupe = escapeLike(input.dedupeKey);
  const [existing] = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.type, "purchase"),
        isNull(invoices.deletedAt),
        sql`${invoices.notes} LIKE ${`%[ownlyst-claim:${escapedDedupe}]%`}`
      )
    )
    .limit(1);

  if (existing) {
    return {
      success: true,
      alreadyClaimed: true,
      invoiceId: existing.id,
      invoiceNumber: existing.invoiceNumber,
    };
  }

  return await db.transaction(async (tx) => {
    // 2. Supplier Party Upsert
    let supplierParty: { id: string; stateCode: string | null } | undefined;
    if (input.supplier.gstin && input.supplier.gstin.trim()) {
      const [foundByGstin] = await tx
        .select({ id: parties.id, stateCode: parties.stateCode })
        .from(parties)
        .where(
          and(
            eq(parties.businessId, businessId),
            eq(parties.type, "supplier"),
            eq(parties.gstin, input.supplier.gstin.trim())
          )
        )
        .limit(1);
      supplierParty = foundByGstin;
    }

    if (!supplierParty) {
      const [foundByName] = await tx
        .select({ id: parties.id, stateCode: parties.stateCode })
        .from(parties)
        .where(
          and(
            eq(parties.businessId, businessId),
            eq(parties.type, "supplier"),
            ilike(parties.name, input.supplier.name.trim())
          )
        )
        .limit(1);
      supplierParty = foundByName;
    }

    if (!supplierParty) {
      const gstinTrimmed = input.supplier.gstin?.trim() || null;
      const autoPan =
        gstinTrimmed && gstinTrimmed.length === 15 ? gstinTrimmed.slice(2, 12) : null;
      const autoStateCode =
        gstinTrimmed && gstinTrimmed.length === 15 ? gstinTrimmed.slice(0, 2) : null;

      const [newParty] = await tx
        .insert(parties)
        .values({
          businessId,
          type: "supplier",
          name: input.supplier.name.trim(),
          gstin: gstinTrimmed,
          pan: input.supplier.pan?.trim() || autoPan,
          email: input.supplier.email?.trim() || null,
          phone: input.supplier.phone?.trim() || null,
          billingAddress: input.supplier.address?.trim() || null,
          shippingAddress: input.supplier.address?.trim() || null,
          city: input.supplier.city?.trim() || null,
          state: input.supplier.state?.trim() || null,
          stateCode: input.supplier.stateCode?.trim() || autoStateCode,
          pincode: input.supplier.pincode?.trim() || null,
          bankAccountNumber: input.supplier.bankAccountNumber?.trim() || null,
          bankIfsc: input.supplier.bankIfsc?.trim() || null,
          source: "ownlyst",
        })
        .returning({ id: parties.id, stateCode: parties.stateCode });
      supplierParty = newParty;
    }

    // 3. Item Masters Upsert
    const resolvedLineItems: Array<{
      itemId: string;
      itemName: string;
      description: string | null;
      quantity: string;
      unitPrice: string;
      taxPercent: string;
      discountPercent: string;
      taxAmount: string;
      totalAmount: string;
      sortOrder: number;
      selectedUnit: Unit;
      conversionFactor: string;
      variantId: string | null;
      itemType: "product" | "service";
    }> = [];

    for (let idx = 0; idx < input.lineItems.length; idx++) {
      const li = input.lineItems[idx];
      const [foundItem] = await tx
        .select({ id: items.id, itemType: items.itemType })
        .from(items)
        .where(
          and(
            eq(items.businessId, businessId),
            isNull(items.deletedAt),
            ilike(items.name, li.itemName.trim())
          )
        )
        .limit(1);

      let itemId: string;
      let itemType: "product" | "service";
      if (foundItem) {
        itemId = foundItem.id;
        itemType = foundItem.itemType;
      } else {
        itemType = li.itemType ?? (li.hsn?.startsWith("99") ? "service" : "product");
        const [newItem] = await tx
          .insert(items)
          .values({
            businessId,
            name: li.itemName.trim(),
            description: li.description?.trim() || null,
            hsn: li.hsn?.trim() || null,
            unit: li.unit || "pcs",
            itemType,
            purchasePrice: li.unitPrice,
            salePrice: li.unitPrice,
            taxPercent: li.taxPercent || "0",
            source: "ownlyst",
          })
          .returning({ id: items.id, itemType: items.itemType });
        itemId = newItem.id;
        itemType = newItem.itemType;
      }

      const calc = calcLineItem({
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      });

      resolvedLineItems.push({
        itemId,
        itemName: li.itemName.trim(),
        description: li.description || null,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        taxAmount: calc.taxAmount,
        discountPercent: li.discountPercent || "0",
        totalAmount: calc.total,
        sortOrder: idx,
        selectedUnit: li.unit || "pcs",
        conversionFactor: "1",
        variantId: null,
        itemType,
      });
    }

    // 4. Collision-Safe Invoice Numbering avoiding unique constraint crashes
    const [biz] = await tx
      .select({
        prefix: businesses.invoicePrefix,
        nextNum: businesses.nextInvoiceNumber,
        gstRegistrationType: businesses.gstRegistrationType,
        stateCode: businesses.stateCode,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .for("update");

    let assignedNumber = input.invoiceNumber;
    let nextNum = biz.nextNum;
    let [clash] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.businessId, businessId), eq(invoices.invoiceNumber, assignedNumber))
      )
      .limit(1);

    while (clash) {
      assignedNumber = `${biz.prefix}-${String(nextNum).padStart(5, "0")}`;
      nextNum++;
      [clash] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(eq(invoices.businessId, businessId), eq(invoices.invoiceNumber, assignedNumber))
        )
        .limit(1);
    }

    if (nextNum !== biz.nextNum) {
      await tx
        .update(businesses)
        .set({ nextInvoiceNumber: nextNum })
        .where(eq(businesses.id, businessId));
    }

    // 5. Calculate Totals
    const totals = calcInvoiceTotals({
      lineItems: input.lineItems.map((li) => ({
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      roundOff: "0",
    });

    // 6. Insert Purchase Bill (notes contain vendor original number and dedupe token)
    const combinedNotes = `${input.notes || ""}\n[Vendor Bill: ${input.invoiceNumber}]\n[ownlyst-claim:${input.dedupeKey}]`.trim();
    const [invoice] = await tx
      .insert(invoices)
      .values({
        businessId,
        partyId: supplierParty.id,
        type: "purchase",
        documentType: "invoice",
        invoiceNumber: assignedNumber,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxTotal,
        discountAmount: totals.invoiceDiscountAmount,
        roundOff: totals.roundOff,
        totalAmount: totals.total,
        notes: combinedNotes,
        source: "ownlyst",
        isReverseCharge: input.isReverseCharge ?? false,
        createdByUserId: user.id,
        createdByName: user.name,
      })
      .returning();

    // 7. Insert Line Items
    if (resolvedLineItems.length > 0) {
      await tx.insert(invoiceItems).values(
        resolvedLineItems.map((li) => ({
          invoiceId: invoice.id,
          itemId: li.itemId,
          itemName: li.itemName,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          taxAmount: li.taxAmount,
          discountPercent: li.discountPercent,
          totalAmount: li.totalAmount,
          sortOrder: li.sortOrder,
          selectedUnit: li.selectedUnit,
          conversionFactor: li.conversionFactor,
          variantId: li.variantId,
        }))
      );
    }

    // 8. Stock Increment for Product Items
    const productDeltas = resolvedLineItems
      .filter((li) => li.itemType === "product")
      .map((li) => ({
        itemId: li.itemId,
        quantity: li.quantity,
        sign: 1 as const,
        conversionFactor: "1",
      }));
    if (productDeltas.length > 0) {
      await applyStockDeltas(tx, productDeltas, { businessId });
    }

    // 9. Input Tax Credit (ITC) for Purchase GST
    if (parseFloat(totals.taxTotal) > 0 && biz.gstRegistrationType !== "composition") {
      const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
      const returnPeriod = `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, "0")}`;
      const sameState =
        !!(biz.stateCode && supplierParty.stateCode && biz.stateCode === supplierParty.stateCode);

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
        businessId,
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

    // 10. Audit Log
    await logAudit(tx as unknown as TenantDatabase, {
      businessId,
      userId: user.id,
      action: "invoice.claim_ownlyst",
      entityType: "invoice",
      entityId: invoice.id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        type: invoice.type,
        totalAmount: invoice.totalAmount,
        dedupeKey: input.dedupeKey,
      },
    });

    return {
      success: true,
      alreadyClaimed: false,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    };
  });
}
