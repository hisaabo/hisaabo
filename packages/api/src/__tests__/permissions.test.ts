/**
 * Tests for packages/api/src/lib/permissions.ts
 *
 * WHY THIS FILE EXISTS:
 * The permissions module implements Role-Based Access Control (RBAC) using the
 * CASL library. Mistakes here are high-severity security vulnerabilities:
 * - A seller gaining delete access means financial records can be destroyed.
 * - An accountant gaining create access means unauthorized invoices can be issued.
 * - An unknown role receiving any permissions is a privilege escalation path.
 *
 * These tests document the EXACT permission matrix for every role. They serve
 * as both unit tests and a living specification that contributors must update
 * whenever roles are changed.
 *
 * AUDIT REFERENCE: Role permission matrix must match SECURITY_AUDIT.md findings.
 */

import { describe, it, expect } from "vitest";
import { defineAbilityFor, mapDbRole, requireCan } from "../lib/permissions.js";
import type { Action, Resource } from "../lib/permissions.js";
import { TRPCError } from "@trpc/server";

// ─────────────────────────────────────────────────────────────────────────────
// defineAbilityFor — builds CASL ability objects per role
// ─────────────────────────────────────────────────────────────────────────────
describe("defineAbilityFor — builds CASL ability for each role", () => {

  // ── superadmin ──────────────────────────────────────────────────────────────
  describe("superadmin role — can manage all resources", () => {
    const ability = defineAbilityFor({ userId: "user-1", role: "superadmin" });

    it("can create invoices", () => {
      expect(ability.can("create", "Invoice")).toBe(true);
    });

    it("can delete invoices", () => {
      expect(ability.can("delete", "Invoice")).toBe(true);
    });

    it("can manage team members", () => {
      expect(ability.can("manage", "Team")).toBe(true);
    });

    it("can access GST reports", () => {
      expect(ability.can("read", "GstReport")).toBe(true);
    });
  });

  // ── admin ───────────────────────────────────────────────────────────────────
  describe("admin role — can manage all resources (same as superadmin for permissions)", () => {
    const ability = defineAbilityFor({ userId: "user-2", role: "admin" });

    it("can create invoices", () => {
      expect(ability.can("create", "Invoice")).toBe(true);
    });

    it("can delete invoices", () => {
      expect(ability.can("delete", "Invoice")).toBe(true);
    });

    it("can manage team members", () => {
      expect(ability.can("manage", "Team")).toBe(true);
    });
  });

  // ── seller ───────────────────────────────────────────────────────────────────
  describe("seller role — limited to creating sales and reading data", () => {
    const ability = defineAbilityFor({ userId: "user-3", role: "seller" });

    it("can create invoices", () => {
      // Sellers are the front-line staff who generate invoices.
      expect(ability.can("create", "Invoice")).toBe(true);
    });

    it("can read invoices", () => {
      expect(ability.can("read", "Invoice")).toBe(true);
    });

    it("CANNOT delete invoices — audit finding: sellers must not destroy records", () => {
      // SECURITY: Allowing sellers to delete invoices would let them cover up sales.
      expect(ability.can("delete", "Invoice")).toBe(false);
    });

    it("CANNOT create items — sellers should not modify the product catalog", () => {
      expect(ability.can("create", "Item")).toBe(false);
    });

    it("CANNOT access reports — financial reports are restricted to managers", () => {
      // SECURITY: Sellers should not see revenue reports or competitor pricing data.
      expect(ability.can("read", "Report")).toBe(false);
    });

    it("CANNOT create expenses", () => {
      expect(ability.can("create", "Expense")).toBe(false);
    });

    it("CANNOT manage bank accounts", () => {
      expect(ability.can("manage", "BankAccount")).toBe(false);
    });

    it("can create parties (needed to onboard new customers at point of sale)", () => {
      expect(ability.can("create", "Party")).toBe(true);
    });

    it("can create payments (to record cash collected from customers)", () => {
      expect(ability.can("create", "Payment")).toBe(true);
    });

    it("can read items (to build invoices from the product catalog)", () => {
      expect(ability.can("read", "Item")).toBe(true);
    });
  });

  // ── seller_manager ─────────────────────────────────────────────────────────
  describe("seller_manager role — all seller permissions plus delete (with time constraints)", () => {
    const ability = defineAbilityFor({ userId: "user-4", role: "seller_manager" });

    it("can delete invoices (API enforces the 2-hour constraint at endpoint level)", () => {
      // CASL grants the permission; the time constraint is enforced in the invoice router.
      expect(ability.can("delete", "Invoice")).toBe(true);
    });

    it("can create and update items (manages the product catalog)", () => {
      expect(ability.can("create", "Item")).toBe(true);
      expect(ability.can("update", "Item")).toBe(true);
    });

    it("CANNOT delete items (prevents accidental catalog destruction)", () => {
      expect(ability.can("delete", "Item")).toBe(false);
    });

    it("can read reports (view sales performance)", () => {
      expect(ability.can("read", "Report")).toBe(true);
    });

    it("CANNOT access GST reports (financial compliance is accountant territory)", () => {
      expect(ability.can("read", "GstReport")).toBe(false);
    });

    it("CANNOT manage bank accounts", () => {
      expect(ability.can("manage", "BankAccount")).toBe(false);
    });
  });

  // ── accountant ─────────────────────────────────────────────────────────────
  describe("accountant role — full financial access, no invoice creation", () => {
    const ability = defineAbilityFor({ userId: "user-5", role: "accountant" });

    it("CANNOT create invoices — accountants reconcile, they do not sell", () => {
      // SECURITY: An accountant creating invoices could generate fraudulent documents.
      expect(ability.can("create", "Invoice")).toBe(false);
    });

    it("can read invoices (needed for reconciliation)", () => {
      expect(ability.can("read", "Invoice")).toBe(true);
    });

    it("can manage bank accounts", () => {
      expect(ability.can("manage", "BankAccount")).toBe(true);
    });

    it("can create and delete expenses", () => {
      expect(ability.can("create", "Expense")).toBe(true);
      expect(ability.can("delete", "Expense")).toBe(true);
    });

    it("can access GST reports", () => {
      expect(ability.can("read", "GstReport")).toBe(true);
    });

    it("can access financial reports", () => {
      expect(ability.can("read", "Report")).toBe(true);
    });

    it("CANNOT delete invoices", () => {
      expect(ability.can("delete", "Invoice")).toBe(false);
    });

    it("CANNOT manage team members", () => {
      expect(ability.can("manage", "Team")).toBe(false);
    });
  });

  // ── unknown/invalid role ───────────────────────────────────────────────────
  describe("unknown role — deny-by-default: zero permissions", () => {
    // SECURITY AUDIT FINDING: Unknown roles must not inherit any permissions.
    // An attacker who somehow injects an unrecognized role string should get nothing.
    const unknownAbility = defineAbilityFor({ userId: "user-6", role: "unknown_role" });
    const emptyStringAbility = defineAbilityFor({ userId: "user-7", role: "" });

    const testResources: Resource[] = ["Invoice", "Payment", "Party", "Item", "Expense", "Report"];
    const testActions: Action[] = ["create", "read", "update", "delete"];

    it("grants zero permissions for an unknown role string", () => {
      for (const resource of testResources) {
        for (const action of testActions) {
          expect(unknownAbility.can(action, resource)).toBe(false);
        }
      }
    });

    it("grants zero permissions for an empty string role", () => {
      for (const resource of testResources) {
        for (const action of testActions) {
          expect(emptyStringAbility.can(action, resource)).toBe(false);
        }
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapDbRole — maps legacy DB enum values to permission roles
// ─────────────────────────────────────────────────────────────────────────────
describe("mapDbRole — maps legacy DB enum values to permission role strings", () => {
  it("maps 'owner' to 'superadmin' (legacy alias)", () => {
    // The first registered user gets the 'owner' DB role — map to max permissions.
    expect(mapDbRole("owner")).toBe("superadmin");
  });

  it("maps 'admin' to 'admin'", () => {
    expect(mapDbRole("admin")).toBe("admin");
  });

  it("maps 'member' to 'seller' (legacy: general staff member = seller)", () => {
    // Most existing multi-user setups use 'member' for shop floor staff.
    expect(mapDbRole("member")).toBe("seller");
  });

  it("maps 'viewer' to 'accountant' (legacy: read-only user = accountant)", () => {
    expect(mapDbRole("viewer")).toBe("accountant");
  });

  it("maps new CASL role names to themselves (passthrough)", () => {
    expect(mapDbRole("superadmin")).toBe("superadmin");
    expect(mapDbRole("seller_manager")).toBe("seller_manager");
    expect(mapDbRole("seller")).toBe("seller");
    expect(mapDbRole("accountant")).toBe("accountant");
  });

  it("maps unknown DB role values to an empty string (no permissions)", () => {
    // SECURITY: Unrecognized DB roles must not silently elevate to any permission.
    // The empty string maps to the default case in defineAbilityFor (zero perms).
    expect(mapDbRole("some_future_role_not_in_mapping")).toBe("");
    expect(mapDbRole("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireCan — the CASL enforcement helper used in all routers
// ─────────────────────────────────────────────────────────────────────────────
describe("requireCan — throws FORBIDDEN TRPCError when permission is denied", () => {
  it("does not throw when the ability grants the permission", () => {
    const ability = defineAbilityFor({ userId: "u1", role: "superadmin" });
    // Should not throw:
    expect(() => requireCan(ability, "delete", "Invoice")).not.toThrow();
  });

  it("throws FORBIDDEN TRPCError when the ability denies the permission", () => {
    // A seller trying to delete an invoice should result in a FORBIDDEN error.
    const ability = defineAbilityFor({ userId: "u2", role: "seller" });
    let caught: unknown;
    try {
      requireCan(ability, "delete", "Invoice");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("FORBIDDEN");
  });

  it("includes the action and resource in the error message", () => {
    const ability = defineAbilityFor({ userId: "u3", role: "accountant" });
    let message = "";
    try {
      requireCan(ability, "create", "Invoice");
    } catch (e) {
      message = (e as TRPCError).message;
    }
    expect(message).toContain("create");
    expect(message).toContain("Invoice");
  });
});
