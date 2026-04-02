/**
 * EXHAUSTIVE PERMISSION MATRIX TESTS
 *
 * WHY THIS FILE EXISTS:
 * The permissions module implements Role-Based Access Control (RBAC) using the
 * CASL library. Mistakes here are high-severity security vulnerabilities:
 * - A seller gaining delete access means financial records can be destroyed.
 * - An accountant gaining create access means unauthorized invoices can be issued.
 * - An unknown role receiving any permissions is a privilege escalation path.
 *
 * These tests document the EXACT permission matrix for every role x every
 * resource x every action. They serve as both unit tests and a living
 * specification that contributors must update whenever roles are changed.
 *
 * COVERAGE: 5 roles x 15 resources x 5 actions = 375 permission checks,
 * plus unknown/empty role denial, mapDbRole, and requireCan tests.
 *
 * AUDIT REFERENCE: Role permission matrix must match SECURITY_AUDIT.md findings.
 */

import { describe, it, expect } from "vitest";
import { defineAbilityFor, mapDbRole, requireCan } from "../lib/permissions.js";
import type { Action, Resource } from "../lib/permissions.js";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Shared constants — the full set of concrete resources and actions
// ---------------------------------------------------------------------------
const ALL_RESOURCES: Resource[] = [
  "Invoice", "Payment", "Party", "Item", "Expense",
  "BankAccount", "BankTransaction",
  "Business", "Team", "Import", "Report", "GstReport",
  "Store", "SalesTarget", "RecurringInvoice",
];

const ALL_ACTIONS: Action[] = ["create", "read", "update", "delete", "manage"];

// ═══════════════════════════════════════════════════════════════════════════
// defineAbilityFor — builds CASL ability objects per role
// ═══════════════════════════════════════════════════════════════════════════
describe("defineAbilityFor — builds CASL ability for each role", () => {

  // ── superadmin ──────────────────────────────────────────────────────────
  describe("superadmin role — unrestricted access via manage:all", () => {
    const ability = defineAbilityFor({ userId: "u-sa", role: "superadmin" });

    // superadmin has `manage` on `all`, which grants every action on every resource.
    it.each(
      ALL_RESOURCES.flatMap((r) => ALL_ACTIONS.map((a) => [a, r] as [Action, Resource]))
    )("can %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(true);
    });
  });

  // ── admin ───────────────────────────────────────────────────────────────
  describe("admin role — unrestricted access via manage:all (superadmin demotion guard is endpoint-level)", () => {
    const ability = defineAbilityFor({ userId: "u-ad", role: "admin" });

    // admin has the same CASL grant as superadmin (manage:all).
    // The distinction between admin and superadmin is enforced in team
    // management endpoint logic, not in CASL rules.
    it.each(
      ALL_RESOURCES.flatMap((r) => ALL_ACTIONS.map((a) => [a, r] as [Action, Resource]))
    )("can %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(true);
    });
  });

  // ── seller_manager ─────────────────────────────────────────────────────
  describe("seller_manager role — sales leadership with catalog management", () => {
    const ability = defineAbilityFor({ userId: "u-sm", role: "seller_manager" });

    // ---- Allowed permissions ----
    // Derived from the switch case in permissions.ts:
    //   Invoice:           create, read, update, delete
    //   Party:             create, read, update
    //   Item:              create, read, update
    //   Payment:           create, read, update
    //   Expense:           read
    //   BankAccount:       read
    //   BankTransaction:   read
    //   Business:          read
    //   Report:            read
    //   Store:             create, read, update
    //   SalesTarget:       read, manage (manage grants all 5 actions via CASL)
    //   RecurringInvoice:  create, read, update, delete
    //
    // Note: can("manage", "SalesTarget") in CASL grants create/read/update/delete/manage on SalesTarget.

    const CAN: [Action, Resource][] = [
      // Invoice — full CRUD (delete constraint is API-level)
      ["create", "Invoice"],
      ["read",   "Invoice"],
      ["update", "Invoice"],
      ["delete", "Invoice"],
      // Party — CRU, no delete
      ["create", "Party"],
      ["read",   "Party"],
      ["update", "Party"],
      // Item — CRU, no delete (prevents catalog destruction)
      ["create", "Item"],
      ["read",   "Item"],
      ["update", "Item"],
      // Payment — CRU (edit constraint is API-level: own + <2hrs)
      ["create", "Payment"],
      ["read",   "Payment"],
      ["update", "Payment"],
      // Expense — read only
      ["read", "Expense"],
      // BankAccount — read only
      ["read", "BankAccount"],
      // BankTransaction — read only
      ["read", "BankTransaction"],
      // Business — read only
      ["read", "Business"],
      // Report — read only
      ["read", "Report"],
      // Store — CRU (toggle items, confirm orders)
      ["create", "Store"],
      ["read",   "Store"],
      ["update", "Store"],
      // SalesTarget — manage grants all actions
      ["create", "SalesTarget"],
      ["read",   "SalesTarget"],
      ["update", "SalesTarget"],
      ["delete", "SalesTarget"],
      ["manage", "SalesTarget"],
      // RecurringInvoice — full CRUD
      ["create", "RecurringInvoice"],
      ["read",   "RecurringInvoice"],
      ["update", "RecurringInvoice"],
      ["delete", "RecurringInvoice"],
    ];

    it.each(CAN)("can %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(true);
    });

    // ---- Denied permissions ----
    // Everything else is denied. Build the explicit list by subtracting CAN from the full matrix.
    const canSet = new Set(CAN.map(([a, r]) => `${a}:${r}`));
    const CANNOT: [Action, Resource][] = ALL_RESOURCES.flatMap((r) =>
      ALL_ACTIONS
        .filter((a) => !canSet.has(`${a}:${r}`))
        .map((a) => [a, r] as [Action, Resource])
    );

    it.each(CANNOT)("cannot %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(false);
    });
  });

  // ── seller ──────────────────────────────────────────────────────────────
  describe("seller role — front-line sales staff, strictly limited", () => {
    const ability = defineAbilityFor({ userId: "u-se", role: "seller" });

    // ---- Allowed permissions ----
    // From switch case:
    //   Invoice:           create, read, update (own + <2hrs enforced at API level)
    //   Party:             create, read
    //   Item:              read
    //   Payment:           create, read, update (own + <2hrs enforced at API level)
    //   Business:          read
    //   Store:             read
    //   SalesTarget:       read
    //   RecurringInvoice:  read

    const CAN: [Action, Resource][] = [
      // Invoice — create, read, update (no delete: sellers must not destroy records)
      ["create", "Invoice"],
      ["read",   "Invoice"],
      ["update", "Invoice"],
      // Party — create + read (onboard new customers at point of sale)
      ["create", "Party"],
      ["read",   "Party"],
      // Item — read only (browse the product catalog)
      ["read", "Item"],
      // Payment — create, read, update (record cash collected)
      ["create", "Payment"],
      ["read",   "Payment"],
      ["update", "Payment"],
      // Business — read only
      ["read", "Business"],
      // Store — read only (view orders)
      ["read", "Store"],
      // SalesTarget — read only (view own targets)
      ["read", "SalesTarget"],
      // RecurringInvoice — read only
      ["read", "RecurringInvoice"],
    ];

    it.each(CAN)("can %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(true);
    });

    // ---- Denied permissions ----
    const canSet = new Set(CAN.map(([a, r]) => `${a}:${r}`));
    const CANNOT: [Action, Resource][] = ALL_RESOURCES.flatMap((r) =>
      ALL_ACTIONS
        .filter((a) => !canSet.has(`${a}:${r}`))
        .map((a) => [a, r] as [Action, Resource])
    );

    it.each(CANNOT)("cannot %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(false);
    });
  });

  // ── accountant ──────────────────────────────────────────────────────────
  describe("accountant role — full financial access, read-only on non-financial", () => {
    const ability = defineAbilityFor({ userId: "u-ac", role: "accountant" });

    // ---- Allowed permissions ----
    // From switch case:
    //   Payment:           create, read, update
    //   Expense:           create, read, update, delete
    //   BankAccount:       manage (grants all 5 actions)
    //   BankTransaction:   manage (grants all 5 actions)
    //   Report:            read
    //   GstReport:         read
    //   Invoice:           read
    //   Party:             read
    //   Item:              read
    //   Business:          read
    //   Store:             read
    //   RecurringInvoice:  read

    const CAN: [Action, Resource][] = [
      // Payment — CRU (no delete)
      ["create", "Payment"],
      ["read",   "Payment"],
      ["update", "Payment"],
      // Expense — full CRUD
      ["create", "Expense"],
      ["read",   "Expense"],
      ["update", "Expense"],
      ["delete", "Expense"],
      // BankAccount — manage grants all actions
      ["create", "BankAccount"],
      ["read",   "BankAccount"],
      ["update", "BankAccount"],
      ["delete", "BankAccount"],
      ["manage", "BankAccount"],
      // BankTransaction — manage grants all actions
      ["create", "BankTransaction"],
      ["read",   "BankTransaction"],
      ["update", "BankTransaction"],
      ["delete", "BankTransaction"],
      ["manage", "BankTransaction"],
      // Report — read only
      ["read", "Report"],
      // GstReport — read only
      ["read", "GstReport"],
      // Invoice — read only (reconciliation)
      ["read", "Invoice"],
      // Party — read only
      ["read", "Party"],
      // Item — read only
      ["read", "Item"],
      // Business — read only
      ["read", "Business"],
      // Store — read only (order reconciliation)
      ["read", "Store"],
      // RecurringInvoice — read only
      ["read", "RecurringInvoice"],
    ];

    it.each(CAN)("can %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(true);
    });

    // ---- Denied permissions ----
    const canSet = new Set(CAN.map(([a, r]) => `${a}:${r}`));
    const CANNOT: [Action, Resource][] = ALL_RESOURCES.flatMap((r) =>
      ALL_ACTIONS
        .filter((a) => !canSet.has(`${a}:${r}`))
        .map((a) => [a, r] as [Action, Resource])
    );

    it.each(CANNOT)("cannot %s %s", (action, resource) => {
      expect(ability.can(action, resource)).toBe(false);
    });
  });

  // ── unknown / empty role ───────────────────────────────────────────────
  describe("unknown role — deny-by-default: ZERO permissions on all resources", () => {
    // SECURITY: An attacker who injects an unrecognized role string must get nothing.
    const unknownAbility  = defineAbilityFor({ userId: "u-unk", role: "unknown_role" });
    const emptyAbility    = defineAbilityFor({ userId: "u-emp", role: "" });
    const sqlInjAbility   = defineAbilityFor({ userId: "u-sql", role: "'; DROP TABLE users;--" });

    const ALL_PAIRS: [Action, Resource][] = ALL_RESOURCES.flatMap((r) =>
      ALL_ACTIONS.map((a) => [a, r] as [Action, Resource])
    );

    describe("unknown role string", () => {
      it.each(ALL_PAIRS)("cannot %s %s", (action, resource) => {
        expect(unknownAbility.can(action, resource)).toBe(false);
      });
    });

    describe("empty string role", () => {
      it.each(ALL_PAIRS)("cannot %s %s", (action, resource) => {
        expect(emptyAbility.can(action, resource)).toBe(false);
      });
    });

    describe("adversarial role string", () => {
      it.each(ALL_PAIRS)("cannot %s %s", (action, resource) => {
        expect(sqlInjAbility.can(action, resource)).toBe(false);
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mapDbRole — maps legacy DB enum values to permission roles
// ═══════════════════════════════════════════════════════════════════════════
describe("mapDbRole — maps legacy DB enum values to permission role strings", () => {

  // ---- Legacy aliases ----
  it.each([
    ["owner",   "superadmin"],
    ["member",  "seller"],
    ["viewer",  "accountant"],
  ] as [string, string][])("maps legacy '%s' to '%s'", (dbRole, expected) => {
    expect(mapDbRole(dbRole)).toBe(expected);
  });

  // ---- Identity pass-through for current roles ----
  it.each([
    ["superadmin",     "superadmin"],
    ["admin",          "admin"],
    ["seller_manager", "seller_manager"],
    ["seller",         "seller"],
    ["accountant",     "accountant"],
  ] as [string, string][])("passes through current role '%s' unchanged", (dbRole, expected) => {
    expect(mapDbRole(dbRole)).toBe(expected);
  });

  // ---- Unknown values → empty string (zero permissions) ----
  it.each([
    "",
    "root",
    "some_future_role",
    "ADMIN",                    // case-sensitive — uppercase is unknown
    "superAdmin",               // camelCase is unknown
    "'; DROP TABLE users;--",   // adversarial input
  ])("maps unknown value '%s' to empty string", (dbRole) => {
    expect(mapDbRole(dbRole)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// requireCan — the CASL enforcement helper used in all tRPC routers
// ═══════════════════════════════════════════════════════════════════════════
describe("requireCan — throws FORBIDDEN TRPCError when permission is denied", () => {

  it("does not throw when the ability grants the requested permission", () => {
    const ability = defineAbilityFor({ userId: "u1", role: "superadmin" });
    expect(() => requireCan(ability, "delete", "Invoice")).not.toThrow();
  });

  it("does not throw for a role-specific grant (accountant can read GstReport)", () => {
    const ability = defineAbilityFor({ userId: "u2", role: "accountant" });
    expect(() => requireCan(ability, "read", "GstReport")).not.toThrow();
  });

  it("throws TRPCError with code FORBIDDEN when the ability denies the permission", () => {
    const ability = defineAbilityFor({ userId: "u3", role: "seller" });
    expect(() => requireCan(ability, "delete", "Invoice")).toThrowError();
    try {
      requireCan(ability, "delete", "Invoice");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("includes the action and resource in the error message for debuggability", () => {
    const ability = defineAbilityFor({ userId: "u4", role: "accountant" });
    try {
      requireCan(ability, "create", "Invoice");
    } catch (e) {
      const msg = (e as TRPCError).message;
      expect(msg).toContain("create");
      expect(msg).toContain("Invoice");
    }
  });

  it("throws for unknown role attempting any action", () => {
    const ability = defineAbilityFor({ userId: "u5", role: "" });
    expect(() => requireCan(ability, "read", "Invoice")).toThrowError();
    try {
      requireCan(ability, "read", "Invoice");
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-cutting security properties
// ═══════════════════════════════════════════════════════════════════════════
describe("cross-cutting security properties", () => {

  it("only superadmin and admin can manage Team", () => {
    const roles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
    for (const role of roles) {
      const ability = defineAbilityFor({ userId: "u-cc", role });
      if (role === "superadmin" || role === "admin") {
        expect(ability.can("manage", "Team")).toBe(true);
      } else {
        expect(ability.can("manage", "Team")).toBe(false);
      }
    }
  });

  it("only superadmin and admin can access Import", () => {
    const roles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
    for (const role of roles) {
      const ability = defineAbilityFor({ userId: "u-cc", role });
      const allowed = role === "superadmin" || role === "admin";
      for (const action of ALL_ACTIONS) {
        expect(ability.can(action, "Import")).toBe(allowed);
      }
    }
  });

  it("only accountant (and superadmin/admin) can read GstReport", () => {
    const expectations: Record<string, boolean> = {
      superadmin: true,
      admin: true,
      seller_manager: false,
      seller: false,
      accountant: true,
    };
    for (const [role, expected] of Object.entries(expectations)) {
      const ability = defineAbilityFor({ userId: "u-cc", role });
      expect(ability.can("read", "GstReport")).toBe(expected);
    }
  });

  it("no non-admin role can delete Party or Item", () => {
    for (const role of ["seller_manager", "seller", "accountant"]) {
      const ability = defineAbilityFor({ userId: "u-cc", role });
      expect(ability.can("delete", "Party")).toBe(false);
      expect(ability.can("delete", "Item")).toBe(false);
    }
  });

  it("seller cannot escalate to manage on any resource", () => {
    const ability = defineAbilityFor({ userId: "u-cc", role: "seller" });
    for (const resource of ALL_RESOURCES) {
      expect(ability.can("manage", resource)).toBe(false);
    }
  });

  it("mapDbRole followed by defineAbilityFor produces correct abilities for legacy roles", () => {
    // owner → superadmin → manage all
    const ownerAbility = defineAbilityFor({ userId: "u-legacy", role: mapDbRole("owner") });
    expect(ownerAbility.can("manage", "Team")).toBe(true);
    expect(ownerAbility.can("delete", "Invoice")).toBe(true);

    // member → seller → limited
    const memberAbility = defineAbilityFor({ userId: "u-legacy", role: mapDbRole("member") });
    expect(memberAbility.can("create", "Invoice")).toBe(true);
    expect(memberAbility.can("delete", "Invoice")).toBe(false);
    expect(memberAbility.can("manage", "Team")).toBe(false);

    // viewer → accountant → financial
    const viewerAbility = defineAbilityFor({ userId: "u-legacy", role: mapDbRole("viewer") });
    expect(viewerAbility.can("manage", "BankAccount")).toBe(true);
    expect(viewerAbility.can("create", "Invoice")).toBe(false);
    expect(viewerAbility.can("read", "GstReport")).toBe(true);
  });
});
