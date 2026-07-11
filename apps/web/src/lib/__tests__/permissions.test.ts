import { describe, it, expect } from "vitest";
import { canAccess } from "../permissions";

/**
 * Guards the client-side permission mirror used to gate action buttons.
 * Must stay in lockstep with packages/api/src/lib/permissions.ts.
 */
describe("canAccess", () => {
  describe("accountant is read-only on sales resources", () => {
    it("cannot create/update/delete invoices, parties, items", () => {
      for (const resource of ["Invoice", "Party", "Item"] as const) {
        expect(canAccess("accountant", resource, "read")).toBe(true);
        expect(canAccess("accountant", resource, "create")).toBe(false);
        expect(canAccess("accountant", resource, "update")).toBe(false);
        expect(canAccess("accountant", resource, "delete")).toBe(false);
      }
    });

    it("cannot update store orders or recurring invoices", () => {
      expect(canAccess("accountant", "Store", "update")).toBe(false);
      expect(canAccess("accountant", "RecurringInvoice", "update")).toBe(false);
      expect(canAccess("accountant", "RecurringInvoice", "delete")).toBe(false);
    });

    it("retains its financial write access", () => {
      expect(canAccess("accountant", "Expense", "create")).toBe(true);
      expect(canAccess("accountant", "Expense", "delete")).toBe(true);
      expect(canAccess("accountant", "BankAccount", "create")).toBe(true);
      expect(canAccess("accountant", "BankAccount", "delete")).toBe(true);
      expect(canAccess("accountant", "BankTransaction", "create")).toBe(true);
      expect(canAccess("accountant", "Payment", "create")).toBe(true);
      expect(canAccess("accountant", "Payment", "update")).toBe(true);
      // ...but not delete payments
      expect(canAccess("accountant", "Payment", "delete")).toBe(false);
    });
  });

  describe("legacy DB roles are normalized (closes the show-all gap)", () => {
    it("viewer behaves like accountant (read-only sales)", () => {
      expect(canAccess("viewer", "Invoice", "read")).toBe(true);
      expect(canAccess("viewer", "Invoice", "delete")).toBe(false);
      expect(canAccess("viewer", "Item", "create")).toBe(false);
      expect(canAccess("viewer", "Expense", "create")).toBe(true);
    });

    it("member behaves like seller", () => {
      expect(canAccess("member", "Invoice", "create")).toBe(true);
      expect(canAccess("member", "Invoice", "delete")).toBe(false);
      expect(canAccess("member", "Expense", "read")).toBe(false);
    });

    it("owner behaves like superadmin (full access)", () => {
      expect(canAccess("owner", "Invoice", "delete")).toBe(true);
      expect(canAccess("owner", "BankAccount", "delete")).toBe(true);
    });
  });

  describe("seller can write invoices but not delete them", () => {
    it("gates invoice actions correctly", () => {
      expect(canAccess("seller", "Invoice", "create")).toBe(true);
      expect(canAccess("seller", "Invoice", "update")).toBe(true);
      expect(canAccess("seller", "Invoice", "delete")).toBe(false);
      expect(canAccess("seller", "Item", "create")).toBe(false);
    });
  });

  describe("admin/superadmin have full access", () => {
    it("can do everything", () => {
      for (const role of ["admin", "superadmin"]) {
        expect(canAccess(role, "Invoice", "delete")).toBe(true);
        expect(canAccess(role, "Party", "create")).toBe(true);
        expect(canAccess(role, "BankAccount", "delete")).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    it("null/undefined role is permissive (session still loading)", () => {
      expect(canAccess(null, "Invoice", "delete")).toBe(true);
      expect(canAccess(undefined, "Invoice", "delete")).toBe(true);
    });

    it("unknown role gets nothing (deny by default)", () => {
      expect(canAccess("gremlin", "Invoice", "read")).toBe(false);
      expect(canAccess("gremlin", "Invoice", "create")).toBe(false);
    });
  });
});
