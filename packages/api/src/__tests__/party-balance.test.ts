/**
 * Pure tests for lib/party-balance.ts: which documents move a party's balance
 * and which side of the party's ledger they land on. No database.
 *
 * Convention (the documented one): a balance is SIGNED, debit minus credit.
 * Positive = they owe you, negative = you owe them, for customers and suppliers.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  BALANCE_DOCUMENT_TYPES,
  documentLedgerSide,
  invoiceBalanceSql,
  invoiceIsLedgerDebitSql,
} from "../lib/party-balance.js";

describe("documentLedgerSide (debit-minus-credit statement)", () => {
  it.each([
    ["invoice", "sale", "debit"],
    ["debit_note", "sale", "debit"],
    ["credit_note", "sale", "credit"],
    ["sales_return", "sale", "credit"],
    ["invoice", "purchase", "credit"],
    ["purchase_return", "purchase", "debit"],
    ["debit_note", "purchase", "debit"], // was "credit": a purchase-side debit note reduces the payable
    ["credit_note", "purchase", "debit"], // raised from a purchase invoice: reverses the purchase
    ["sales_return", "purchase", "debit"],
    ["purchase_return", "sale", "credit"],
  ])("%s on a %s document lands on the %s side", (documentType, type, expected) => {
    expect(documentLedgerSide(documentType, type)).toBe(expected);
  });

  it.each(["quotation", "proforma", "delivery_challan", "other"])("%s never posts", (documentType) => {
    expect(documentLedgerSide(documentType, "sale")).toBeNull();
    expect(documentLedgerSide(documentType, "purchase")).toBeNull();
  });

  it("covers exactly the documents the ledger posts", () => {
    expect([...BALANCE_DOCUMENT_TYPES].sort()).toEqual(
      ["credit_note", "debit_note", "invoice", "purchase_return", "sales_return"],
    );
  });
});

describe("the SQL fragments", () => {
  const render = (q: Parameters<InstanceType<typeof PgDialect>["sqlToQuery"]>[0]) =>
    new PgDialect().sqlToQuery(q).sql.replace(/\s+/g, " ");

  it("invoiceIsLedgerDebitSql: a sale invoice / sale debit note, or any reversal of a purchase, debits", () => {
    expect(render(invoiceIsLedgerDebitSql())).toBe(
      `( ("invoices"."type" = 'sale' AND "invoices"."document_type" IN ('invoice', 'debit_note')) OR ("invoices"."type" = 'purchase' AND "invoices"."document_type" IN ('credit_note', 'sales_return', 'purchase_return', 'debit_note')) )`,
    );
  });

  it("invoiceBalanceSql: 0 for documents that never post, +unpaid on the debit side, -unpaid on the credit side", () => {
    const rendered = render(invoiceBalanceSql());
    expect(rendered).toContain(
      `WHEN "invoices"."document_type" NOT IN ('invoice', 'credit_note', 'sales_return', 'purchase_return', 'debit_note') THEN 0`,
    );
    expect(rendered).toContain(
      `THEN ("invoices"."total_amount"::numeric - "invoices"."amount_paid"::numeric) ELSE -("invoices"."total_amount"::numeric - "invoices"."amount_paid"::numeric) END`,
    );
  });
});
