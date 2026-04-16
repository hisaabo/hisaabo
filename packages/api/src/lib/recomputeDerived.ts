/**
 * Post-import recompute helpers.
 *
 * Each function recomputes a denormalised column from first principles,
 * compares it against the imported value, updates the row unconditionally
 * (authoritative recompute wins over snapshot), and returns a list of
 * warnings for any delta > 0.01.
 *
 * None of these functions throw — the import proceeds regardless of
 * recompute discrepancies.
 */
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  bankAccounts,
  bankTransactions,
  items,
  itemVariants,
  invoices,
  stockAdjustments,
  paymentAllocations,
} from "@hisaabo/db";
import type { TenantDatabase } from "@hisaabo/db";
import { logger } from "./logger.js";

export interface RecomputeWarning {
  table: string;
  entityId: string;
  column: string;
  exported: string;
  computed: string;
  delta: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank account current balance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recompute currentBalance = openingBalance + SUM(deposits) - SUM(withdrawals)
 * for all bank accounts whose businessId is in businessIds.
 */
export async function recomputeBankBalances(
  db: TenantDatabase,
  businessIds: string[],
): Promise<{ warnings: RecomputeWarning[] }> {
  const warnings: RecomputeWarning[] = [];
  if (businessIds.length === 0) return { warnings };

  try {
    const accounts = await db
      .select({
        id: bankAccounts.id,
        openingBalance: bankAccounts.openingBalance,
        currentBalance: bankAccounts.currentBalance,
      })
      .from(bankAccounts)
      .where(inArray(bankAccounts.businessId, businessIds));

    if (accounts.length === 0) return { warnings };

    const accountIds = accounts.map((a) => a.id);

    // SUM deposits - SUM withdrawals per account
    const txnRows = await db
      .select({
        bankAccountId: bankTransactions.bankAccountId,
        net: sql<string>`
          COALESCE(
            SUM(
              CASE WHEN ${bankTransactions.type} = 'deposit'
                   THEN ${bankTransactions.amount}::numeric
                   ELSE -${bankTransactions.amount}::numeric
              END
            ),
            0
          )::text`,
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.bankAccountId, accountIds))
      .groupBy(bankTransactions.bankAccountId);

    const netByAccount = new Map(txnRows.map((r) => [r.bankAccountId, r.net]));

    for (const acct of accounts) {
      const net = netByAccount.get(acct.id) ?? "0";
      const computed = (
        parseFloat(acct.openingBalance) + parseFloat(net)
      ).toFixed(2);
      const delta = Math.abs(parseFloat(computed) - parseFloat(acct.currentBalance));

      if (delta > 0.01) {
        warnings.push({
          table: "bank_accounts",
          entityId: acct.id,
          column: "currentBalance",
          exported: acct.currentBalance,
          computed,
          delta: delta.toFixed(2),
        });
      }

      // Update unconditionally — recomputed value is authoritative
      await db
        .update(bankAccounts)
        .set({ currentBalance: computed, updatedAt: new Date() })
        .where(eq(bankAccounts.id, acct.id));
    }
  } catch (err) {
    logger.error({ err }, "[recomputeBankBalances] Failed");
  }

  return { warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Item / item variant stock quantity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recompute stockQuantity for items and item variants.
 *
 * Stock formula:
 *   item.stockQuantity =
 *     item.initialStock (approximated here as the first stockAdjustment baseline,
 *     but we don't have a separate field — we use the formula that the rest of
 *     the app uses: recompute from all stock adjustments and invoice deductions).
 *
 * Because the app updates stockQuantity incrementally on every stock adjustment
 * and invoice line item creation, we don't have a stored "initial stock" separate
 * from the running total. The safest recompute is therefore:
 *
 *   For each item, walk all stockAdjustments (which record previousStock → newStock)
 *   and check the final value matches the last adjustment's newStock.
 *
 * In practice we derive current stock by replaying all adjustments from zero
 * using the actual stockAdjustment delta (quantity column on stock_adjustments).
 * Then we subtract all invoice-item quantities (excluding cancelled/deleted invoices).
 *
 * WARNING: This is a best-effort snapshot recompute. The app's real-time path
 * (stock adjust + invoice flow) is the authoritative source. We warn on drift
 * and update — the imported value may be slightly stale for in-flight changes.
 */
export async function recomputeStock(
  db: TenantDatabase,
  businessIds: string[],
): Promise<{ warnings: RecomputeWarning[] }> {
  const warnings: RecomputeWarning[] = [];
  if (businessIds.length === 0) return { warnings };

  try {
    // ── Items (non-variant mode) ─────────────────────────────────────────────

    // Get all items in scope
    const allItems = await db
      .select({ id: items.id, stockQuantity: items.stockQuantity })
      .from(items)
      .where(inArray(items.businessId, businessIds));

    if (allItems.length > 0) {
      const itemIds = allItems.map((i) => i.id);

      // Net stock from stock adjustments — each row carries a delta (quantity)
      const adjRows = await db
        .select({
          itemId: stockAdjustments.itemId,
          net: sql<string>`COALESCE(SUM(${stockAdjustments.quantity}::numeric), 0)::text`,
        })
        .from(stockAdjustments)
        .where(
          and(
            inArray(stockAdjustments.itemId, itemIds),
            sql`${stockAdjustments.variantId} IS NULL`,
          ),
        )
        .groupBy(stockAdjustments.itemId);

      const adjNet = new Map(adjRows.map((r) => [r.itemId, r.net]));

      // Invoice item deductions for non-variant items (sale invoices subtract stock,
      // purchase invoices add stock — but the stock_adjustments already encode this
      // via the invoice creation hooks, so we don't double-count here).
      // We only recompute against adjustments to avoid re-deriving the entire
      // invoice flow which is handled by the incremental update path.
      // If a future audit finds systematic drift, this is the place to extend.

      for (const item of allItems) {
        const net = adjNet.get(item.id) ?? "0";
        // The last stock adjustment's newStock is the ground truth. Since we
        // summed deltas, this equals the total net movement. Compare with stored.
        const delta = Math.abs(parseFloat(net) - parseFloat(item.stockQuantity));
        if (delta > 0.01) {
          warnings.push({
            table: "items",
            entityId: item.id,
            column: "stockQuantity",
            exported: item.stockQuantity,
            computed: net,
            delta: delta.toFixed(3),
          });
          // Update to recomputed value
          await db
            .update(items)
            .set({ stockQuantity: net, updatedAt: new Date() })
            .where(eq(items.id, item.id));
        }
      }
    }

    // ── Item variants ────────────────────────────────────────────────────────

    // Get all item variants in scope (via their parent item's businessId)
    const allVariants = await db
      .select({
        id: itemVariants.id,
        itemId: itemVariants.itemId,
        stockQuantity: itemVariants.stockQuantity,
      })
      .from(itemVariants)
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(inArray(items.businessId, businessIds));

    if (allVariants.length > 0) {
      const variantIds = allVariants.map((v) => v.id);

      const variantAdjRows = await db
        .select({
          variantId: stockAdjustments.variantId,
          net: sql<string>`COALESCE(SUM(${stockAdjustments.quantity}::numeric), 0)::text`,
        })
        .from(stockAdjustments)
        .where(
          and(
            inArray(stockAdjustments.variantId, variantIds),
          ),
        )
        .groupBy(stockAdjustments.variantId);

      const variantAdjNet = new Map(
        variantAdjRows.map((r) => [r.variantId!, r.net]),
      );

      for (const variant of allVariants) {
        const net = variantAdjNet.get(variant.id) ?? "0";
        const delta = Math.abs(parseFloat(net) - parseFloat(variant.stockQuantity));
        if (delta > 0.01) {
          warnings.push({
            table: "item_variants",
            entityId: variant.id,
            column: "stockQuantity",
            exported: variant.stockQuantity,
            computed: net,
            delta: delta.toFixed(3),
          });
          await db
            .update(itemVariants)
            .set({ stockQuantity: net, updatedAt: new Date() })
            .where(eq(itemVariants.id, variant.id));
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "[recomputeStock] Failed");
  }

  return { warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice amountPaid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recompute amountPaid = SUM(payment_allocations.amount WHERE invoiceId = x)
 * for all invoices whose businessId is in businessIds.
 */
export async function recomputeAmountPaid(
  db: TenantDatabase,
  businessIds: string[],
): Promise<{ warnings: RecomputeWarning[] }> {
  const warnings: RecomputeWarning[] = [];
  if (businessIds.length === 0) return { warnings };

  try {
    // Aggregate paid amount per invoice from payment_allocations
    const allocRows = await db
      .select({
        invoiceId: paymentAllocations.invoiceId,
        totalPaid: sql<string>`COALESCE(SUM(${paymentAllocations.amount}::numeric), 0)::text`,
      })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .where(inArray(invoices.businessId, businessIds))
      .groupBy(paymentAllocations.invoiceId);

    const paidByInvoice = new Map(allocRows.map((r) => [r.invoiceId, r.totalPaid]));

    // Get all invoices in scope
    const allInvoices = await db
      .select({ id: invoices.id, amountPaid: invoices.amountPaid })
      .from(invoices)
      .where(inArray(invoices.businessId, businessIds));

    for (const inv of allInvoices) {
      const computed = paidByInvoice.get(inv.id) ?? "0.00";
      const delta = Math.abs(parseFloat(computed) - parseFloat(inv.amountPaid));

      if (delta > 0.01) {
        warnings.push({
          table: "invoices",
          entityId: inv.id,
          column: "amountPaid",
          exported: inv.amountPaid,
          computed,
          delta: delta.toFixed(2),
        });
      }

      // Update unconditionally
      await db
        .update(invoices)
        .set({ amountPaid: computed, updatedAt: new Date() })
        .where(eq(invoices.id, inv.id));
    }
  } catch (err) {
    logger.error({ err }, "[recomputeAmountPaid] Failed");
  }

  return { warnings };
}
