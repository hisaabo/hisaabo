/**
 * Pure tests for lib/party-balance.ts: which documents move a party's balance
 * and which side of the party's ledger they land on. No database.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  BALANCE_DOCUMENT_TYPES,
  documentLedgerSide,
  invoiceBalanceSql,
  isBalanceReduction,
} from "../lib/party-balance.js";

describe("isBalanceReduction", () => {
  it.each([
    ["credit_note", "sale", true],
    ["sales_return", "sale", true],
    ["purchase_return", "purchase", true],
    ["debit_note", "purchase", true], // we debit the supplier: we owe them less
    ["debit_note", "sale", false], // the customer owes us more
    ["invoice", "sale", false],
    ["invoice", "purchase", false],
  ])("%s on a %s document -> %s", (documentType, type, expected) => {
    expect(isBalanceReduction(documentType, type)).toBe(expected);
  });
});

describe("documentLedgerSide (debit-minus-credit statement)", () => {
  it.each([
    ["invoice", "sale", "debit"],
    ["debit_note", "sale", "debit"],
    ["credit_note", "sale", "credit"],
    ["sales_return", "sale", "credit"],
    ["invoice", "purchase", "credit"],
    ["purchase_return", "purchase", "debit"],
    ["debit_note", "purchase", "debit"], // was "credit": a purchase-side debit note reduces the payable
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

describe("invoiceBalanceSql", () => {
  const rendered = new PgDialect().sqlToQuery(invoiceBalanceSql()).sql.replace(/\s+/g, " ");

  it("is 0 for documents that never post", () => {
    expect(rendered).toContain(
      `WHEN "invoices"."document_type" NOT IN ('invoice', 'credit_note', 'sales_return', 'purchase_return', 'debit_note') THEN 0`,
    );
  });

  it("negates credit notes, returns and purchase-side debit notes", () => {
    expect(rendered).toContain(`"invoices"."document_type" IN ('credit_note', 'sales_return', 'purchase_return')`);
    expect(rendered).toContain(`("invoices"."document_type" = 'debit_note' AND "invoices"."type" = 'purchase')`);
    expect(rendered).toContain(`THEN -("invoices"."total_amount"::numeric - "invoices"."amount_paid"::numeric)`);
  });

  it("adds everything else (the unpaid part)", () => {
    expect(rendered).toMatch(/ELSE \("invoices"\."total_amount"::numeric - "invoices"\."amount_paid"::numeric\) END$/);
  });
});
