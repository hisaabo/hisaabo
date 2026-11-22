/**
 * invoice-cancel.ts — what cancelling an invoice-backed document means, in one
 * place.
 *
 * The EFFECTS of a cancel are defined here and nowhere else:
 *   - `applyInvoiceCancel`: the role rule (seller_manager window), the "no
 *     payments allocated, no live IRN" guard, and the stock reversal (plus
 *     purchase ITC reversal) for documentType "invoice";
 *   - `applyDocumentCancel`: the same guard and the stock reversal for the other
 *     document types (credit/debit notes, challans, returns, ...).
 * A purchase-side reversal (purchase return, purchase-side debit note, credit
 * note / sales return raised from a purchase invoice) also has a negative ITC
 * ledger entry (itc-reversal-entries.ts): every path that cancels or deletes
 * one, through either function above, takes it away again.
 * `invoice.updateStatus` and the document router factory each lock the row and
 * run their own status transition, then call the matching `apply...Cancel`.
 * `cancelInvoiceInTx` is the whole thing (lock, rules, effects, status write) for
 * a caller that has only an id and a document of any type: `eInvoice.cancel`.
 * A cancel done through any of them therefore reverses exactly the same effects,
 * and sets status = "cancelled", which is what GSTR-1/3B, the ledger and party
 * balances filter on.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { invoices, invoiceItems, itcLedgerEntries } from "@hisaabo/db";
import {
  checkDocumentStatusTransition,
  checkInvoiceDeleteAllowed,
  checkInvoiceStatusTransition,
  type InvoiceStatusValue,
} from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";
import { requireCan, type AppAbility } from "./permissions.js";
import { applyStockDeltas } from "./stock-adjust.js";
import { assertNoPaymentsOrActiveIrn } from "./invoice-unlink-guard.js";
import { DOCUMENT_STOCK_EFFECT, reverseDocumentStockEffect, type StockEffect } from "./document-stock-reversal.js";
import { removePurchaseReversalItc } from "./itc-reversal-entries.js";

export type CancelTx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

/** Who is cancelling: the business scope plus the caller's role and ability. */
export interface CancelActor {
  businessId: string;
  role: string | null | undefined;
  ability: AppAbility;
}

/** The columns the cancel rules read. */
export interface CancelTarget {
  id: string;
  status: InvoiceStatusValue;
  type: "sale" | "purchase";
  documentType: string;
  totalAmount: string;
  amountPaid: string;
  createdAt: Date;
  irn: string | null;
  eInvoiceStatus: string | null;
}

// Reverse the stock (and purchase ITC) impact an invoice had at creation.
// Shared by delete and cancel so both undo exactly the same effects.
export async function reverseInvoiceEffects(
  tx: CancelTx,
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

  // invoice.delete accepts any document id: a purchase-side reversal deleted here loses its
  // negative ITC entry as well (a no-op for every other document).
  await removePurchaseReversalItc(tx, businessId, inv);
}

/**
 * Rules for cancelling a document whose documentType is "invoice": cancelling
 * undoes stock like delete does, so it needs the same permission and rule, and
 * it is refused while payments are allocated or an IRN is still live.
 * Read-only; safe to call with the plain db before doing anything irreversible.
 */
export async function assertInvoiceCancelAllowed(
  db: Pick<TenantDatabase, "select">,
  actor: CancelActor,
  target: CancelTarget,
): Promise<void> {
  requireCan(actor.ability, "delete", "Invoice");
  const verdict = checkInvoiceDeleteAllowed(actor.role, { status: target.status, createdAt: target.createdAt });
  if (!verdict.allowed) throw new TRPCError({ code: "FORBIDDEN", message: verdict.message });
  await assertNoPaymentsOrActiveIrn(db, "cancel", target);
}

/** `assertInvoiceCancelAllowed`, then undo the invoice's stock and ITC. Runs in the caller's row-locked transaction. */
export async function applyInvoiceCancel(
  tx: CancelTx,
  actor: CancelActor,
  target: CancelTarget,
): Promise<void> {
  await assertInvoiceCancelAllowed(tx, actor, target);
  await reverseInvoiceEffects(tx, actor.businessId, target);
}

/**
 * The document-type counterpart of `applyInvoiceCancel` (credit/debit notes,
 * challans, returns, ...): refused while payments are allocated or an IRN is still
 * live, then the document's stock effect is undone. `stockEffect` is what
 * creating that type did (see DOCUMENT_STOCK_EFFECT). Runs in the caller's
 * row-locked transaction.
 */
export async function applyDocumentCancel(
  tx: CancelTx,
  businessId: string,
  target: CancelTarget,
  stockEffect: StockEffect,
): Promise<void> {
  await assertNoPaymentsOrActiveIrn(tx, "cancel", target);
  await reverseDocumentStockEffect(tx, businessId, target.id, stockEffect);
  // A purchase-side reversal's negative ITC entry goes with it (a no-op for every other document).
  await removePurchaseReversalItc(tx, businessId, target);
}

/**
 * A half-cancel (IRN cancelled, invoice still live) leaves an explanatory
 * eInvoiceError on the row. Finishing the cancel by any path clears it.
 */
export function staleEInvoiceErrorPatch(row: { eInvoiceStatus: string | null }): { eInvoiceError?: null } {
  return row.eInvoiceStatus === "cancelled" ? { eInvoiceError: null } : {};
}

/**
 * Everything that can refuse a cancel for a predictable reason, for any
 * invoice-backed document type, without writing anything. `eInvoice.cancel`
 * runs this BEFORE calling the IRP (with `irnCancelled`, because by the time
 * the local cancel runs the IRN will be cancelled) so it never cancels at the
 * IRP and then fails locally on something it could have known.
 */
export async function assertCancellable(
  db: Pick<TenantDatabase, "select">,
  actor: CancelActor,
  target: CancelTarget,
  opts: { irnCancelled?: boolean } = {},
): Promise<void> {
  const t = opts.irnCancelled ? { ...target, eInvoiceStatus: "cancelled" } : target;
  const transitionError = t.documentType === "invoice"
    ? checkInvoiceStatusTransition(t.status, "cancelled", t)
    : checkDocumentStatusTransition(t.documentType, t.status, "cancelled");
  if (transitionError) throw new TRPCError({ code: "BAD_REQUEST", message: transitionError });

  if (t.documentType === "invoice") {
    await assertInvoiceCancelAllowed(db, actor, t);
  } else {
    await assertNoPaymentsOrActiveIrn(db, "cancel", t);
  }
}

/**
 * Cancel an invoice-backed document of any type inside `tx`: lock the row,
 * re-run `assertCancellable` under the lock, reverse its effects and set
 * status = "cancelled". `extra` is written in the same UPDATE, so the caller can
 * make its own state change (the e-invoice IRN state) land atomically with the
 * cancel. Returns `changed: false` (reversing nothing, writing only `extra`) when it is already cancelled.
 */
export async function cancelInvoiceInTx(
  tx: CancelTx,
  actor: CancelActor,
  invoiceId: string,
  opts: { irnCancelled?: boolean; extra?: Partial<typeof invoices.$inferInsert> } = {},
) {
  const [before] = await tx.select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, actor.businessId), isNull(invoices.deletedAt)))
    .for("update")
    .limit(1);
  if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

  if (before.status === "cancelled") {
    const [updated] = opts.extra
      ? await tx.update(invoices).set({ ...opts.extra, updatedAt: new Date() }).where(eq(invoices.id, before.id)).returning()
      : [before];
    return { invoice: updated!, fromStatus: before.status, changed: false };
  }

  const t = opts.irnCancelled ? { ...before, eInvoiceStatus: "cancelled" } : before;
  await assertCancellable(tx, actor, before, opts);
  if (before.documentType === "invoice") {
    await reverseInvoiceEffects(tx, actor.businessId, before);
  } else {
    await applyDocumentCancel(tx, actor.businessId, t, DOCUMENT_STOCK_EFFECT[before.documentType] ?? "none");
  }

  const [invoice] = await tx.update(invoices)
    .set({ ...staleEInvoiceErrorPatch(before), ...opts.extra, status: "cancelled", updatedAt: new Date() })
    .where(and(eq(invoices.id, before.id), eq(invoices.businessId, actor.businessId)))
    .returning();
  return { invoice: invoice!, fromStatus: before.status, changed: true };
}
