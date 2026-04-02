import { parties, invoices, payments, paymentAllocations, businesses } from "@hisaabo/db";
import { eq, and, sql } from "drizzle-orm";
import { money } from "@hisaabo/shared";
import { buildInvoiceStatusUpdate } from "../helpers.js";
import type { TenantDatabase } from "../../../trpc.js";
import type { CanonicalPayment } from "../types.js";

export interface PaymentsImportResult {
  created: number;
  skipped: number;
  total: number;
  errors: string[];
  directCreated: number;
}

export async function runPaymentsImport(
  db: TenantDatabase,
  businessId: string,
  user: { id: string; name: string | null },
  source: string,
  canonicalPayments: CanonicalPayment[],
  paidInvoiceNumbers: string[],
): Promise<PaymentsImportResult> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Pre-fetch parties
  const allPartiesForPayments = await db
    .select({ id: parties.id, name: parties.name })
    .from(parties).where(eq(parties.businessId, businessId));
  const partyByName = new Map(
    allPartiesForPayments.map(p => [p.name.toLowerCase(), p.id])
  );

  // Pre-fetch all invoices with their current balances
  const allInvs = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      totalAmount: invoices.totalAmount,
      amountPaid: invoices.amountPaid,
      partyId: invoices.partyId,
      status: invoices.status,
      documentType: invoices.documentType,
      invoiceDate: invoices.invoiceDate,
    })
    .from(invoices).where(eq(invoices.businessId, businessId));

  const invoiceByNumber = new Map(allInvs.map(inv => [inv.invoiceNumber, inv]));

  // Build per-party unpaid invoice list for chronological allocation
  const unpaidByParty = new Map<string, typeof allInvs>();
  for (const inv of allInvs) {
    if (inv.documentType !== "invoice") continue;
    if (inv.status === "paid" || inv.status === "cancelled") continue;
    const list = unpaidByParty.get(inv.partyId) || [];
    list.push(inv);
    unpaidByParty.set(inv.partyId, list);
  }
  // Sort each party's invoices by date for chronological allocation
  for (const list of unpaidByParty.values()) {
    list.sort((a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());
  }

  // In-memory balance tracker — starts from DB state, updated as we allocate
  const balanceTracker = new Map<string, number>();
  for (const inv of allInvs) {
    balanceTracker.set(inv.id, money.toNumber(inv.totalAmount) - money.toNumber(inv.amountPaid));
  }

  // ── Phase 1: Pre-validate and simulate allocations in memory ──
  type PaymentRow = {
    id: string;
    paymentNumber: string;
    partyId: string;
    primaryInvoiceId: string | null;
    amount: string;
    mode: "cash" | "bank" | "upi" | "cheque" | "other";
    referenceNumber: string | null;
    paymentDate: Date;
    notes: string | null;
  };

  type InvoiceAllocation = {
    paymentId: string;
    invoiceId: string;
    allocAmount: number;
  };

  const validPayments: PaymentRow[] = [];
  const allAllocations: InvoiceAllocation[] = [];
  let autoNumberCount = 0;

  for (const pmt of canonicalPayments) {
    const partyId = partyByName.get(pmt.partyName.toLowerCase());
    if (!partyId) {
      errors.push(`Party "${pmt.partyName}" not found for payment`);
      skipped++;
      continue;
    }

    const paymentId = crypto.randomUUID();
    let primaryInvoiceId: string | null = null;
    let remaining = money.toNumber(pmt.amount);

    if (pmt.invoiceNumbers?.length) {
      // CSV path: allocate to the EXPLICITLY named invoices first
      for (const invNum of pmt.invoiceNumbers) {
        if (remaining <= 0) break;
        const inv = invoiceByNumber.get(invNum);
        if (!inv) continue;
        if (!primaryInvoiceId) primaryInvoiceId = inv.id;

        const balance = balanceTracker.get(inv.id) || 0;
        if (balance <= 0) continue;

        const allocAmt = Math.min(remaining, balance);
        allAllocations.push({ paymentId, invoiceId: inv.id, allocAmount: allocAmt });
        balanceTracker.set(inv.id, balance - allocAmt);
        remaining -= allocAmt;
      }
    }

    // If there's remaining amount (or no invoice numbers), allocate chronologically
    if (remaining > 0) {
      const partyInvs = unpaidByParty.get(partyId) || [];
      for (const inv of partyInvs) {
        if (remaining <= 0) break;
        const balance = balanceTracker.get(inv.id) || 0;
        if (balance <= 0) continue;

        const allocAmt = Math.min(remaining, balance);
        if (!primaryInvoiceId) primaryInvoiceId = inv.id;
        allAllocations.push({ paymentId, invoiceId: inv.id, allocAmount: allocAmt });
        balanceTracker.set(inv.id, balance - allocAmt);
        remaining -= allocAmt;
      }
    }

    const needsAutoNumber = !pmt.paymentNumber;
    if (needsAutoNumber) autoNumberCount++;

    validPayments.push({
      id: paymentId,
      paymentNumber: pmt.paymentNumber || "", // placeholder, assigned in batch
      partyId,
      primaryInvoiceId,
      amount: pmt.amount,
      mode: pmt.mode,
      referenceNumber: pmt.referenceNumber || null,
      paymentDate: pmt.paymentDate,
      notes: pmt.notes || null,
    });

    created++;
  }

  // ── Phase 2: Batch insert in one transaction ──
  if (validPayments.length > 0) {
    await db.transaction(async (tx) => {
      // Get counter for auto-numbered payments
      if (autoNumberCount > 0) {
        const [biz] = await tx
          .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .for("update");

        let counter = biz.nextNum;
        for (const p of validPayments) {
          if (!p.paymentNumber) {
            p.paymentNumber = `${biz.prefix}-${String(counter).padStart(5, "0")}`;
            counter++;
          }
        }

        await tx.update(businesses)
          .set({ nextPaymentNumber: counter })
          .where(eq(businesses.id, businessId));
      }

      // Bulk insert all payments in chunks of 500
      for (let i = 0; i < validPayments.length; i += 500) {
        const chunk = validPayments.slice(i, i + 500);
        await tx.insert(payments).values(chunk.map(p => ({
          id: p.id,
          businessId,
          partyId: p.partyId,
          invoiceId: p.primaryInvoiceId,
          paymentNumber: p.paymentNumber,
          amount: p.amount,
          discount: "0",
          mode: p.mode,
          referenceNumber: p.referenceNumber,
          paymentDate: p.paymentDate,
          notes: p.notes,
          createdByUserId: user.id,
          createdByName: user.name,
          source,
        })));
      }

      // Group allocations by invoiceId and sum
      const invoiceUpdates = new Map<string, number>();
      for (const alloc of allAllocations) {
        invoiceUpdates.set(alloc.invoiceId, (invoiceUpdates.get(alloc.invoiceId) || 0) + alloc.allocAmount);
      }

      // Apply one UPDATE per affected invoice
      for (const [invoiceId, totalAlloc] of invoiceUpdates) {
        await tx.execute(buildInvoiceStatusUpdate(invoiceId, businessId, totalAlloc.toFixed(2)));
      }

      // Bulk insert payment allocation records
      if (allAllocations.length > 0) {
        const allocRows = allAllocations.map(a => ({
          paymentId: a.paymentId,
          invoiceId: a.invoiceId,
          amount: a.allocAmount.toFixed(2),
        }));
        for (let i = 0; i < allocRows.length; i += 500) {
          await tx.insert(paymentAllocations).values(allocRows.slice(i, i + 500));
        }
      }
    });
  }

  // ── Phase 3: Auto-create payments for direct-paid invoices ──
  // Invoices marked "Paid" in the source but not fully covered by C&B allocation.
  let directCreated = 0;

  if (paidInvoiceNumbers.length > 0) {
    const paidSet = new Set(paidInvoiceNumbers);

    // Re-fetch these invoices to get current amountPaid after C&B allocation
    const freshInvs = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        partyId: invoices.partyId,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        invoiceDate: invoices.invoiceDate,
      })
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.source, source)));

    // Filter to only "Paid" invoices with a shortfall, sorted REVERSE chronologically
    const needsPayment = freshInvs
      .filter((inv) => {
        if (!paidSet.has(inv.invoiceNumber)) return false;
        const shortfall = money.toNumber(inv.totalAmount) - money.toNumber(inv.amountPaid);
        return shortfall > 0.01;
      })
      .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());

    if (needsPayment.length > 0) {
      await db.transaction(async (tx) => {
        const [biz2] = await tx
          .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .for("update");

        let counter2 = biz2.nextNum;
        const directPaymentRows = needsPayment.map((inv) => {
          const shortfall = money.sub(inv.totalAmount, inv.amountPaid);
          const paymentNumber = `${biz2.prefix}-${String(counter2).padStart(5, "0")}`;
          counter2++;
          return {
            id: crypto.randomUUID(),
            businessId,
            partyId: inv.partyId,
            invoiceId: inv.id,
            paymentNumber,
            amount: shortfall,
            discount: "0",
            mode: "cash" as const,
            paymentDate: inv.invoiceDate,
            notes: `Auto-created for direct-paid invoice ${inv.invoiceNumber}`,
            createdByUserId: user.id,
            createdByName: user.name,
            source,
          };
        });

        await tx.update(businesses)
          .set({ nextPaymentNumber: counter2 })
          .where(eq(businesses.id, businessId));

        for (let i = 0; i < directPaymentRows.length; i += 500) {
          await tx.insert(payments).values(directPaymentRows.slice(i, i + 500));
        }

        // Update amountPaid + status on these invoices
        for (const dp of directPaymentRows) {
          await tx.execute(buildInvoiceStatusUpdate(dp.invoiceId!, businessId, dp.amount));
        }

        directCreated = directPaymentRows.length;
      });
    }
  }

  return { created: created + directCreated, skipped, total: canonicalPayments.length, errors, directCreated };
}

// ── runReconcileDirectPayments ────────────────────────────────────────────────
// Reads from the DB (not from import data), so it does not go through an adapter.
export interface ReconcileResult {
  created: number;
  total: number;
  errors: string[];
}

export async function runReconcileDirectPayments(
  db: TenantDatabase,
  businessId: string,
  user: { id: string; name: string | null },
  source: string,
  excludeInvoiceIds: string[],
): Promise<ReconcileResult> {
  let created = 0;
  const errors: string[] = [];

  const rows = (await db.execute(sql`
    SELECT i.id, i.invoice_number, i.party_id, i.amount_paid, i.invoice_date, i.type
    FROM invoices i
    WHERE i.business_id = ${businessId}
      AND i.document_type = 'invoice'
      AND i.amount_paid::numeric > 0
      AND i.source = ${source}
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.business_id = ${businessId}
          AND p.invoice_id = i.id
      )
      ${excludeInvoiceIds.length > 0 ? sql`AND i.id NOT IN (${sql.join(excludeInvoiceIds.map(id => sql`${id}`), sql`,`)})` : sql``}
    ORDER BY i.invoice_date ASC
  `)) as unknown as Array<{
    id: string;
    invoice_number: string;
    party_id: string;
    amount_paid: string;
    invoice_date: Date;
    type: string;
  }>;

  if (rows.length === 0) {
    return { created: 0, total: 0, errors: [] };
  }

  await db.transaction(async (tx) => {
    const [biz] = await tx
      .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .for("update");

    let counter = biz.nextNum;

    const paymentRows = rows.map((inv) => {
      const paymentNumber = `${biz.prefix}-${String(counter).padStart(5, "0")}`;
      counter++;
      return {
        id: crypto.randomUUID(),
        businessId,
        partyId: inv.party_id,
        invoiceId: inv.id,
        paymentNumber,
        amount: inv.amount_paid,
        discount: "0",
        mode: "cash" as const,
        paymentDate: new Date(inv.invoice_date),
        notes: `Auto-created for direct-paid invoice ${inv.invoice_number}`,
        createdByUserId: user.id,
        createdByName: user.name,
        source,
      };
    });

    await tx.update(businesses)
      .set({ nextPaymentNumber: counter })
      .where(eq(businesses.id, businessId));

    for (let i = 0; i < paymentRows.length; i += 500) {
      await tx.insert(payments).values(paymentRows.slice(i, i + 500));
    }

    created = paymentRows.length;
  });

  return { created, total: rows.length, errors };
}
