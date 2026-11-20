/**
 * payment-settlement.ts — the single definition of what a payment "settles".
 *
 * A customer receipt can carry TDS the customer withheld (payment_allocations
 * .tds_amount). The business received only `payments.amount` in cash, but the
 * customer's debt shrinks by cash + TDS:
 *
 *     settled = payments.amount + SUM(payment_allocations.tds_amount)
 *
 * Every surface that reduces a party's balance by a payment (party ledger,
 * ledger CSV / PDF, Tally export, statement of account, "collected" charts)
 * must use the SETTLED amount, otherwise a TDS-settled customer keeps showing
 * the withheld tax as outstanding. Surfaces that describe actual money moving
 * (bank balances, cash in hand, payment-mode breakdown, bank reconciliation)
 * stay on the net cash amount `payments.amount` — never mix the two within one
 * widget.
 *
 * Use the SQL fragments for aggregations / raw ledger queries and the JS
 * helpers to build ledger rows from already-fetched payments.
 */

import { sql, type SQL } from "drizzle-orm";
import { payments } from "@hisaabo/db";
import { money } from "@hisaabo/shared";

/**
 * Correlated scalar subquery: total TDS withheld on a payment (numeric, 0.00
 * when none). Reference the payment either by its table name (`payments`, the
 * default) or by the alias it carries in the surrounding query.
 */
export function paymentTdsSql(alias?: string): SQL<string> {
  const paymentId = alias ? sql`${sql.identifier(alias)}.id` : sql`${payments.id}`;
  return sql<string>`COALESCE((
    SELECT SUM(tds_pa.tds_amount)
    FROM payment_allocations tds_pa
    WHERE tds_pa.payment_id = ${paymentId}
  ), 0)::numeric(15,2)`;
}

/** SQL scalar: net cash + TDS withheld (numeric) for a payment row. */
export function paymentSettledSql(alias?: string): SQL<string> {
  const amount = alias ? sql`${sql.identifier(alias)}.amount` : sql`${payments.amount}`;
  return sql<string>`(${amount}::numeric + ${paymentTdsSql(alias)})`;
}

export interface PaymentSettlement {
  /** Net cash that moved (payments.amount). */
  cash: string;
  /** TDS withheld by the customer, "0.00" when none. */
  tds: string;
  /** cash + tds — what the receipt discharged of the party's balance. */
  settled: string;
  hasTds: boolean;
}

/** Combine a payment's net cash with its (possibly absent) TDS. */
export function paymentSettlement(
  amount: string,
  tdsAmount: string | null | undefined,
): PaymentSettlement {
  const tds = money.add(tdsAmount || "0", "0");
  return {
    cash: amount,
    tds,
    settled: money.add(amount, tds),
    hasTds: money.compare(tds, "0") > 0,
  };
}

export interface PaymentLedgerInput {
  mode: string;
  amount: string;
  tdsAmount?: string | null;
}

export interface PaymentLedgerLeg extends PaymentSettlement {
  description: string;
  debit: string;
  credit: string;
}

/**
 * The party-ledger leg of a payment. Customers: the receipt CREDITS the
 * settled amount. Suppliers: the payment DEBITS it (TDS is customer-side only,
 * so tds is always 0 there).
 */
export function paymentLedgerLeg(
  partyType: string,
  pmt: PaymentLedgerInput,
): PaymentLedgerLeg {
  const settlement = paymentSettlement(pmt.amount, pmt.tdsAmount);
  const isSupplier = partyType === "supplier";
  return {
    ...settlement,
    description: settlement.hasTds
      ? `Payment (${pmt.mode}) (incl. TDS ₹${settlement.tds})`
      : `Payment (${pmt.mode})`,
    debit: isSupplier ? settlement.settled : "0",
    credit: isSupplier ? "0" : settlement.settled,
  };
}
