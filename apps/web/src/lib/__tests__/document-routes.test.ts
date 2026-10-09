import { describe, it, expect } from "vitest";
import { documentRouteFor } from "../document-routes";

describe("documentRouteFor", () => {
  it.each([
    ["payment", "/payments"],
    ["invoice", "/invoices"],
    ["credit_note", "/credit-notes"],
    ["sales_return", "/sales-returns"],
    ["debit_note", "/invoices"],
    ["purchase_return", "/invoices"],
    ["unknown", "/invoices"],
  ])("%s -> %s", (type, route) => {
    expect(documentRouteFor(type)).toBe(route);
  });
});
