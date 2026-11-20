/**
 * Party-ledger accounting with TDS — the production helpers every ledger
 * surface (statement, ledger report / CSV / PDF, Tally export, party.ledger,
 * collected charts) shares: lib/payment-settlement.ts.
 *
 * End-to-end ledger/CSV/PDF balances through the real routers live in
 * tds-payment.integration.test.ts (needs Postgres).
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { money } from "@hisaabo/shared";
import {
  paymentLedgerLeg,
  paymentSettledSql,
  paymentSettlement,
  paymentTdsSql,
} from "../lib/payment-settlement.js";

const dialect = new PgDialect();

/** Fold ledger rows into a closing balance the way every ledger surface does. */
function closing(opening: string, rows: Array<{ debit: string; credit: string }>): string {
  return rows.reduce((bal, r) => money.add(money.sub(bal, r.credit), r.debit), opening);
}

describe("paymentSettlement", () => {
  it("settles cash + TDS", () => {
    expect(paymentSettlement("9000.00", "1000.00")).toEqual({
      cash: "9000.00",
      tds: "1000.00",
      settled: "10000.00",
      hasTds: true,
    });
  });

  it("treats missing / zero TDS as a plain cash receipt", () => {
    for (const tds of [undefined, null, "", "0", "0.00"]) {
      expect(paymentSettlement("500.00", tds)).toMatchObject({
        cash: "500.00",
        tds: "0.00",
        settled: "500.00",
        hasTds: false,
      });
    }
  });
});

describe("paymentLedgerLeg", () => {
  it("credits a customer's balance with cash + TDS and flags the TDS in the description", () => {
    const leg = paymentLedgerLeg("customer", { mode: "bank", amount: "9000.00", tdsAmount: "1000.00" });
    expect(leg.credit).toBe("10000.00");
    expect(leg.debit).toBe("0");
    expect(leg.tds).toBe("1000.00");
    expect(leg.cash).toBe("9000.00");
    expect(leg.description).toBe("Payment (bank) (incl. TDS ₹1000.00)");
  });

  it("leaves an ordinary receipt unchanged", () => {
    const leg = paymentLedgerLeg("customer", { mode: "upi", amount: "250.00" });
    expect(leg).toMatchObject({ credit: "250.00", debit: "0", tds: "0.00", description: "Payment (upi)" });
  });

  it("debits a supplier's balance", () => {
    const leg = paymentLedgerLeg("supplier", { mode: "cash", amount: "400.00" });
    expect(leg).toMatchObject({ debit: "400.00", credit: "0" });
  });

  it("clears a customer to zero when cash + TDS equal the invoice", () => {
    const leg = paymentLedgerLeg("customer", { mode: "bank", amount: "10800.00", tdsAmount: "1000.00" });
    // GST invoice 10,000 + 18% = 11,800; 10% TDS on the 10,000 taxable value.
    expect(closing("0.00", [{ debit: "11800.00", credit: "0" }, leg])).toBe("0.00");
  });

  it("leaves only the unpaid remainder after a partial TDS receipt", () => {
    const leg = paymentLedgerLeg("customer", { mode: "bank", amount: "4500.00", tdsAmount: "500.00" });
    expect(closing("0.00", [{ debit: "10000.00", credit: "0" }, leg])).toBe("5000.00");
  });

  it("keeps a multi-invoice receipt's aggregate TDS in one ledger row", () => {
    // 6,000 + 4,000 invoices settled by 9,000 cash + 1,000 TDS (summed over allocations).
    const leg = paymentLedgerLeg("customer", { mode: "bank", amount: "9000.00", tdsAmount: "1000.00" });
    const balance = closing("0.00", [
      { debit: "6000.00", credit: "0" },
      { debit: "4000.00", credit: "0" },
      leg,
    ]);
    expect(balance).toBe("0.00");
  });
});

describe("settled / TDS SQL fragments", () => {
  it("default to the payments table and correlate on payments.id", () => {
    const { sql: text } = dialect.sqlToQuery(paymentSettledSql());
    expect(text).toContain('"payments"."amount"::numeric');
    expect(text).toContain("FROM payment_allocations tds_pa");
    expect(text).toContain('tds_pa.payment_id = "payments"."id"');
    expect(text).toContain("SUM(tds_pa.tds_amount)");
  });

  it("can reference an aliased payments table", () => {
    const { sql: text } = dialect.sqlToQuery(paymentSettledSql("p"));
    expect(text).toContain('"p".amount::numeric');
    expect(text).toContain('tds_pa.payment_id = "p".id');
    expect(text).not.toContain('"payments"');
  });

  it("exposes the TDS part on its own", () => {
    const { sql: text } = dialect.sqlToQuery(paymentTdsSql());
    expect(text).toContain("COALESCE(");
    expect(text).toContain("::numeric(15,2)");
    expect(text).not.toContain('"payments"."amount"');
  });
});
