import { describe, it, expect } from "vitest";
import {
  defineAbilityFor,
  mapDbRole,
  canModify,
  isWithinEditWindow,
  EDIT_WINDOW_MS,
  ALL_RESOURCES,
  ALL_ACTIONS,
  type Resource,
  type Action,
} from "../permissions.js";

describe("mapDbRole", () => {
  it.each([
    ["owner", "superadmin"],
    ["admin", "admin"],
    ["member", "seller"],
    ["viewer", "accountant"],
    ["superadmin", "superadmin"],
    ["seller_manager", "seller_manager"],
    ["seller", "seller"],
    ["accountant", "accountant"],
  ])("maps %s -> %s", (input, expected) => {
    expect(mapDbRole(input)).toBe(expected);
  });

  it("returns empty string for unknown roles", () => {
    expect(mapDbRole("garbage")).toBe("");
    expect(mapDbRole(undefined)).toBe("");
    expect(mapDbRole(null)).toBe("");
    expect(mapDbRole("")).toBe("");
  });
});

describe("defineAbilityFor", () => {
  it("superadmin can do everything on every resource", () => {
    const a = defineAbilityFor("superadmin");
    for (const r of ALL_RESOURCES) {
      for (const act of ALL_ACTIONS) {
        expect(a.can(act, r)).toBe(true);
      }
    }
  });

  it("admin can do everything on every resource", () => {
    const a = defineAbilityFor("admin");
    for (const r of ALL_RESOURCES) {
      for (const act of ALL_ACTIONS) {
        expect(a.can(act, r)).toBe(true);
      }
    }
  });

  it("unknown role gets no permissions", () => {
    const a = defineAbilityFor("unknown_role");
    for (const r of ALL_RESOURCES) {
      for (const act of ALL_ACTIONS) {
        expect(a.can(act, r)).toBe(false);
      }
    }
  });

  it("nullish role gets no permissions", () => {
    expect(defineAbilityFor(null).can("read", "Invoice")).toBe(false);
    expect(defineAbilityFor(undefined).can("read", "Invoice")).toBe(false);
  });

  it("normalises legacy DB roles via mapDbRole", () => {
    expect(defineAbilityFor("owner").can("delete", "Business")).toBe(true);
    expect(defineAbilityFor("member").can("create", "Invoice")).toBe(true);
    expect(defineAbilityFor("viewer").can("manage", "BankAccount")).toBe(true);
  });

  // ── Role contract — must match packages/api/src/lib/permissions.ts ────
  // Snapshot the *complete* (action, resource) decision matrix for each role
  // so any drift between this client-side mirror and the API rules is caught.

  const ROLE_CONTRACT: Record<string, Array<[Action, Resource, boolean]>> = {
    seller_manager: [
      ["create", "Invoice", true], ["read", "Invoice", true],
      ["update", "Invoice", true], ["delete", "Invoice", true],
      ["create", "Party", true],  ["update", "Party", true],
      ["delete", "Party", false],
      ["create", "Item", true],   ["update", "Item", true], ["delete", "Item", false],
      ["create", "Payment", true], ["update", "Payment", true], ["delete", "Payment", false],
      ["read", "Expense", true],  ["create", "Expense", false],
      ["read", "BankAccount", true], ["create", "BankAccount", false],
      ["read", "Report", true],
      ["create", "Store", true], ["update", "Store", true], ["delete", "Store", false],
      ["create", "RecurringInvoice", true], ["delete", "RecurringInvoice", true],
    ],
    seller: [
      ["create", "Invoice", true], ["read", "Invoice", true], ["update", "Invoice", true],
      ["delete", "Invoice", false],
      ["create", "Party", true],  ["update", "Party", false], ["delete", "Party", false],
      ["create", "Item", false],  ["read", "Item", true],
      ["create", "Payment", true], ["update", "Payment", true], ["delete", "Payment", false],
      ["read", "Expense", false],
      ["read", "BankAccount", false],
      ["read", "Store", true], ["create", "Store", false],
      ["read", "RecurringInvoice", true], ["create", "RecurringInvoice", false],
    ],
    accountant: [
      ["read", "Invoice", true], ["create", "Invoice", false], ["update", "Invoice", false],
      ["read", "Party", true], ["create", "Party", false], ["update", "Party", false],
      ["read", "Item", true], ["create", "Item", false],
      ["create", "Payment", true], ["update", "Payment", true],
      ["create", "Expense", true], ["update", "Expense", true], ["delete", "Expense", true],
      ["create", "BankAccount", true], ["update", "BankAccount", true], ["delete", "BankAccount", true],
      ["create", "Account", true], ["delete", "Account", true],
      ["read", "GstReport", true],
      ["read", "EWayBill", true],
      ["read", "Store", true], ["create", "Store", false],
      ["read", "RecurringInvoice", true], ["create", "RecurringInvoice", false],
    ],
  };

  for (const [role, contract] of Object.entries(ROLE_CONTRACT)) {
    describe(`${role} role contract`, () => {
      const ability = defineAbilityFor(role);
      it.each(contract)("%s %s -> %s", (action, resource, expected) => {
        expect(ability.can(action, resource)).toBe(expected);
      });
    });
  }
});

describe("isWithinEditWindow", () => {
  const NOW = new Date("2025-05-25T12:00:00.000Z").getTime();

  it("is true for roles without time restrictions regardless of age", () => {
    expect(
      isWithinEditWindow({
        role: "admin",
        resource: "Invoice",
        createdAt: new Date("2020-01-01"),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isWithinEditWindow({
        role: "accountant",
        resource: "Payment",
        createdAt: new Date("2020-01-01"),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("is true for time-restricted role on non-restricted resource", () => {
    expect(
      isWithinEditWindow({
        role: "seller",
        resource: "Party",
        createdAt: new Date("2020-01-01"),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("is true for time-restricted role when within window", () => {
    const createdAt = new Date(NOW - 60 * 60 * 1000); // 1 hour ago
    expect(
      isWithinEditWindow({ role: "seller", resource: "Invoice", createdAt, now: NOW }),
    ).toBe(true);
    expect(
      isWithinEditWindow({ role: "seller_manager", resource: "Payment", createdAt, now: NOW }),
    ).toBe(true);
  });

  it("is false for time-restricted role when window has elapsed", () => {
    const createdAt = new Date(NOW - EDIT_WINDOW_MS - 1);
    expect(
      isWithinEditWindow({ role: "seller", resource: "Invoice", createdAt, now: NOW }),
    ).toBe(false);
    expect(
      isWithinEditWindow({ role: "seller_manager", resource: "Payment", createdAt, now: NOW }),
    ).toBe(false);
  });

  it("accepts string and number createdAt inputs", () => {
    const createdAtIso = new Date(NOW - 30 * 60 * 1000).toISOString();
    expect(
      isWithinEditWindow({ role: "seller", resource: "Invoice", createdAt: createdAtIso, now: NOW }),
    ).toBe(true);
    expect(
      isWithinEditWindow({ role: "seller", resource: "Invoice", createdAt: NOW - 30 * 60 * 1000, now: NOW }),
    ).toBe(true);
  });

  it("does not block when createdAt is unknown", () => {
    expect(
      isWithinEditWindow({ role: "seller", resource: "Invoice", createdAt: null, now: NOW }),
    ).toBe(true);
    expect(
      isWithinEditWindow({ role: "seller", resource: "Invoice", createdAt: "not-a-date", now: NOW }),
    ).toBe(true);
  });
});

describe("canModify", () => {
  const NOW = new Date("2025-05-25T12:00:00.000Z").getTime();

  it("denies when role lacks permission", () => {
    const ability = defineAbilityFor("seller");
    const result = canModify(ability, "delete", "Invoice", { createdAt: new Date(NOW) }, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no-permission");
  });

  it("allows when role has permission and is not time-restricted", () => {
    const ability = defineAbilityFor("admin");
    const result = canModify(ability, "update", "Invoice", { createdAt: new Date(2020, 0, 1) }, NOW);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("denies when within permission but past edit window", () => {
    const ability = defineAbilityFor("seller");
    const result = canModify(
      ability,
      "update",
      "Invoice",
      { createdAt: new Date(NOW - EDIT_WINDOW_MS - 1) },
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("window-expired");
  });

  it("returns remainingMs while within window", () => {
    const ability = defineAbilityFor("seller_manager");
    const result = canModify(
      ability,
      "update",
      "Payment",
      { createdAt: new Date(NOW - 30 * 60 * 1000) },
      NOW,
    );
    expect(result.allowed).toBe(true);
    expect(result.remainingMs).toBeCloseTo(EDIT_WINDOW_MS - 30 * 60 * 1000, -3);
  });
});
