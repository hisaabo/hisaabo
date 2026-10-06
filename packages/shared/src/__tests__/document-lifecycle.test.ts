import { describe, it, expect } from "vitest";
import {
  DOCUMENT_STATUS_TRANSITIONS,
  checkDocumentStatusTransition,
  checkInvoiceUnlinkAllowed,
  getDocumentStatuses,
  type NonInvoiceDocumentType,
} from "../invoice-status.js";
import { canCreateDocumentType } from "../permissions.js";
import { documentTypes } from "../validators.js";

const TYPES = documentTypes.filter((t) => t !== "invoice") as NonInvoiceDocumentType[];

describe("DOCUMENT_STATUS_TRANSITIONS", () => {
  it("covers every non-invoice document type", () => {
    expect(Object.keys(DOCUMENT_STATUS_TRANSITIONS).sort()).toEqual([...TYPES].sort());
  });

  it.each(TYPES)("%s: transitions only reference known statuses and cancelled is terminal", (type) => {
    const table = DOCUMENT_STATUS_TRANSITIONS[type];
    const known = new Set(Object.keys(table));
    for (const targets of Object.values(table)) {
      for (const t of targets) expect(known.has(t)).toBe(true);
    }
    expect(table.cancelled).toEqual([]);
    expect(getDocumentStatuses(type)).toContain("draft");
  });

  it.each(TYPES)("%s: exhaustive matrix matches the table", (type) => {
    const statuses = getDocumentStatuses(type);
    for (const from of statuses) {
      for (const to of statuses) {
        const allowed = from === to || DOCUMENT_STATUS_TRANSITIONS[type][from]!.includes(to);
        expect(checkDocumentStatusTransition(type, from, to) === null).toBe(allowed);
      }
    }
  });

  it("rejects statuses outside the type's lifecycle", () => {
    expect(checkDocumentStatusTransition("quotation", "draft", "paid")).toMatch(/Cannot change/);
    expect(checkDocumentStatusTransition("sales_return", "draft", "paid")).toMatch(/Cannot change/);
    expect(checkDocumentStatusTransition("quotation", "converted", "sent")).toMatch(/Cannot change/);
  });

  it("terminal states stay terminal", () => {
    expect(checkDocumentStatusTransition("quotation", "cancelled", "draft")).not.toBeNull();
    expect(checkDocumentStatusTransition("credit_note", "paid", "sent")).not.toBeNull();
    expect(checkDocumentStatusTransition("credit_note", "paid", "cancelled")).not.toBeNull();
    expect(checkDocumentStatusTransition("delivery_challan", "sent", "draft")).not.toBeNull();
  });

  it("allows the paths the UIs use", () => {
    expect(checkDocumentStatusTransition("quotation", "draft", "sent")).toBeNull();
    expect(checkDocumentStatusTransition("credit_note", "sent", "paid")).toBeNull();
    expect(checkDocumentStatusTransition("debit_note", "sent", "paid")).toBeNull();
    expect(checkDocumentStatusTransition("purchase_return", "draft", "cancelled")).toBeNull();
  });

  it("rejects unknown document types", () => {
    expect(checkDocumentStatusTransition("invoice", "draft", "sent")).toMatch(/Unsupported/);
  });
});

describe("checkInvoiceUnlinkAllowed", () => {
  const clean = { amountPaid: "0.00", allocationCount: 0, irn: null, eInvoiceStatus: null };

  it("allows a clean document", () => {
    expect(checkInvoiceUnlinkAllowed("delete", clean)).toBeNull();
    expect(checkInvoiceUnlinkAllowed("cancel", clean)).toBeNull();
  });

  it("blocks on allocation rows or amount paid", () => {
    expect(checkInvoiceUnlinkAllowed("delete", { ...clean, allocationCount: 1 })).toMatch(/payment allocation/);
    expect(checkInvoiceUnlinkAllowed("cancel", { ...clean, amountPaid: "10.00" })).toMatch(/Cannot cancel/);
  });

  it("blocks on an active IRN only", () => {
    expect(checkInvoiceUnlinkAllowed("delete", { ...clean, irn: "abc", eInvoiceStatus: "generated" })).toMatch(/Cancel the e-invoice/);
    expect(checkInvoiceUnlinkAllowed("delete", { ...clean, irn: "abc", eInvoiceStatus: null })).not.toBeNull();
    expect(checkInvoiceUnlinkAllowed("delete", { ...clean, irn: "abc", eInvoiceStatus: "cancelled" })).toBeNull();
    expect(checkInvoiceUnlinkAllowed("delete", { ...clean, eInvoiceStatus: "failed" })).toBeNull();
    expect(checkInvoiceUnlinkAllowed("delete", { ...clean, eInvoiceStatus: "pending" })).toBeNull();
  });
});

describe("canCreateDocumentType", () => {
  it("blocks sellers (incl. legacy member) on purchase-side documents", () => {
    for (const role of ["seller", "member"]) {
      expect(canCreateDocumentType(role, "invoice", "purchase")).toBe(false);
      expect(canCreateDocumentType(role, "purchase_return", "sale")).toBe(false);
      expect(canCreateDocumentType(role, "debit_note")).toBe(false);
      expect(canCreateDocumentType(role, "credit_note", "purchase")).toBe(false);
    }
  });

  it("lets sellers create sale-side documents", () => {
    for (const t of ["invoice", "quotation", "proforma", "delivery_challan", "credit_note", "sales_return"]) {
      expect(canCreateDocumentType("seller", t, "sale")).toBe(true);
    }
  });

  it("does not restrict other roles", () => {
    for (const role of ["superadmin", "admin", "seller_manager", "accountant", "owner"]) {
      expect(canCreateDocumentType(role, "invoice", "purchase")).toBe(true);
      expect(canCreateDocumentType(role, "debit_note", "purchase")).toBe(true);
    }
  });
});
