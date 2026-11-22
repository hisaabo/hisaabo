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
  signedOpeningBalance,
} from "../lib/party-balance.js";

describe("isBalanceReduction", () => {
  it.each([
    ["credit_note", "sale", true],
    ["sales_return", "sale", true],
    ["purchase_return", "purchase", true],
    ["debit_note", "purchase", true], // we debit the supplier: we owe them less
    ["credit_note", "purchase", true], // raised from a purchase invoice
    ["sales_return", "purchase", true],
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
    ["credit_note", "purchase", "debit"], // raised from a purchase invoice: reverses the purchase
    ["sales_return", "purchase", "debit"],
    ["purchase_return", "sale", "credit"],
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

describe("signedOpeningBalance", () => {
  it("a customer's opening balance (they owe us) is a debit: positive", () => {
    expect(signedOpeningBalance("customer", "25000.00")).toBe("25000.00");
  });

  it("a supplier's opening balance (we owe them) is a credit: negative", () => {
    expect(signedOpeningBalance("supplier", "10000.00")).toBe("-10000.00");
  });

  it("zero stays zero, with no negative zero", () => {
    expect(signedOpeningBalance("supplier", "0")).toBe("0.00");
    expect(signedOpeningBalance("supplier", "0.00")).toBe("0.00");
    expect(signedOpeningBalance("customer", "0")).toBe("0.00");
  });

  it("an opening balance that is already negative flips for a supplier", () => {
    expect(signedOpeningBalance("supplier", "-500.00")).toBe("500.00");
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
