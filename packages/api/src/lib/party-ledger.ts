/**
 * party-ledger.ts — the running-balance statement behind the party ledger PDF
 * (GET /api/parties/:id/ledger.pdf) and its UPI "pay the outstanding" QR.
 *
 * Payments reduce the party's balance by what they SETTLED (net cash + any
 * customer-withheld TDS, see payment-settlement.ts); using cash alone would
 * leave the withheld tax as "outstanding" and put it on the QR code.
 */

import { and, eq, type SQL } from "drizzle-orm";
import { invoices, payments, type TenantDatabase } from "@hisaabo/db";
import { money } from "@hisaabo/shared";
import { buildBusinessDateFilter } from "./business-date.js";
import { paymentLedgerLeg, paymentTdsSql } from "./payment-settlement.js";
import { signedOpeningBalance } from "./party-balance.js";

export interface PartyLedgerEntry {
  date: Date;
  type: "invoice" | "payment";
  number: string;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface PartyLedgerStatement {
  entries: PartyLedgerEntry[];
  summary: { totalDebit: string; totalCredit: string; closingBalance: string };
  /** The balance the statement starts from, signed like the running balance (supplier: negative). */
  openingBalance: string;
}

export async function buildPartyLedgerStatement(
  db: TenantDatabase,
  businessId: string,
  party: { id: string; type: string; openingBalance: string },
  range: { from?: Date | null; to?: Date | null } = {},
): Promise<PartyLedgerStatement> {
  const invoiceConditions: SQL[] = [
    eq(invoices.partyId, party.id),
    eq(invoices.businessId, businessId),
    eq(invoices.documentType, "invoice"),
    ...buildBusinessDateFilter(invoices, range),
  ];
  const paymentConditions: SQL[] = [
    eq(payments.partyId, party.id),
    eq(payments.businessId, businessId),
    ...buildBusinessDateFilter(payments, range),
  ];

  const [partyInvoices, partyPayments] = await Promise.all([
    db.select({
      invoiceNumber: invoices.invoiceNumber,
      date: invoices.invoiceDate,
      type: invoices.type,
      totalAmount: invoices.totalAmount,
    }).from(invoices).where(and(...invoiceConditions)).orderBy(invoices.invoiceDate),
    db.select({
      paymentNumber: payments.paymentNumber,
      date: payments.paymentDate,
      amount: payments.amount,
      mode: payments.mode,
      tdsAmount: paymentTdsSql(),
    }).from(payments).where(and(...paymentConditions)).orderBy(payments.paymentDate),
  ]);

  const rows = [
    ...partyInvoices.map((inv) => ({
      date: inv.date as Date,
      type: "invoice" as const,
      number: inv.invoiceNumber,
      description: inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice",
      debit: inv.type === "sale" ? inv.totalAmount : "0",
      credit: inv.type === "sale" ? "0" : inv.totalAmount,
    })),
    ...partyPayments.map((pmt) => {
      const leg = paymentLedgerLeg(party.type, pmt);
      return {
        date: pmt.date as Date,
        type: "payment" as const,
        number: pmt.paymentNumber || "",
        description: leg.description,
        debit: leg.debit,
        credit: leg.credit,
      };
    }),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Debit-minus-credit: a supplier's opening balance (what we owe them) starts negative.
  const openingBalance = signedOpeningBalance(party.type, party.openingBalance);
  let runningBalance = openingBalance;
  const entries = rows.map((e) => {
    runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
    return { ...e, runningBalance };
  });

  const totalDebit = money.sum(rows.map((e) => e.debit));
  const totalCredit = money.sum(rows.map((e) => e.credit));
  const closingBalance = money.add(money.sub(openingBalance, totalCredit), totalDebit);

  return { entries, summary: { totalDebit, totalCredit, closingBalance }, openingBalance };
}
