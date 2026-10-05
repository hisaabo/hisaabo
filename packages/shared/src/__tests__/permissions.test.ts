import { describe, it, expect } from "vitest";
import {
  defineAbilityFor,
  mapDbRole,
  canModify,
  INVOICE_DELETE_WINDOW_MS,
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


describe("defineAbilityFor — 'manage' semantics", () => {
  it("is true only when every concrete action is granted on the resource", () => {
    // seller_manager is granted manage on SalesTarget …
    expect(defineAbilityFor("seller_manager").can("manage", "SalesTarget")).toBe(true);
    // … whereas seller has create/read/update on Invoice but not delete, so not manage.
    expect(defineAbilityFor("seller").can("manage", "Invoice")).toBe(false);
    // accountant manages BankAccount but is read-only on Invoice.
    expect(defineAbilityFor("accountant").can("manage", "BankAccount")).toBe(true);
    expect(defineAbilityFor("accountant").can("manage", "Invoice")).toBe(false);
  });

  it("admin and superadmin manage every resource", () => {
    for (const role of ["admin", "superadmin"]) {
      for (const r of ALL_RESOURCES) {
        expect(defineAbilityFor(role).can("manage", r)).toBe(true);
      }
    }
  });

  it("unknown roles manage nothing", () => {
    expect(defineAbilityFor("nope").can("manage", "Invoice")).toBe(false);
  });

  it("exposes the canonical (mapped) role name", () => {
    expect(defineAbilityFor("owner").role).toBe("superadmin");
    expect(defineAbilityFor("viewer").role).toBe("accountant");
    expect(defineAbilityFor("nope").role).toBe("");
  });
});


// ── canModify: role permission + the API's one record-level rule ────────────
// Mirrors packages/api/src/routers/invoice.ts `delete`: a seller_manager may
// delete an invoice only if it is not paid and createdAt >= now - 2h. Nothing
// else in the API is time- or status-restricted beyond the CASL matrix.

describe("canModify — role permission", () => {
  const NOW = new Date("2025-05-25T12:00:00.000Z").getTime();

  it("denies with no-permission when the role lacks the action", () => {
    expect(canModify(defineAbilityFor("seller"), "delete", "Invoice", { createdAt: NOW }, NOW)).toEqual({
      allowed: false,
      reason: "no-permission",
    });
    expect(canModify(defineAbilityFor("accountant"), "update", "Invoice", undefined, NOW)).toEqual({
      allowed: false,
      reason: "no-permission",
    });
  });

  it("checks permission before any record rule (no-permission wins)", () => {
    expect(canModify(defineAbilityFor("seller"), "delete", "Invoice", { status: "paid", createdAt: 0 }, NOW).reason).toBe(
      "no-permission",
    );
  });

  it("denies everything for unknown roles", () => {
    expect(canModify(defineAbilityFor("nope"), "update", "Party", undefined, NOW).allowed).toBe(false);
  });
});

describe("canModify — edits are never time-limited (matches invoice.update / payment.update)", () => {
  const NOW = new Date("2025-05-25T12:00:00.000Z").getTime();
  const longAgo = { createdAt: NOW - 365 * 24 * 60 * 60 * 1000 };

  it.each([
    ["seller", "Invoice"],
    ["seller", "Payment"],
    ["seller_manager", "Invoice"],
    ["seller_manager", "Payment"],
    ["accountant", "Payment"],
    ["admin", "Invoice"],
  ] as const)("%s may update a year-old %s", (role, resource) => {
    expect(canModify(defineAbilityFor(role), "update", resource, longAgo, NOW)).toEqual({ allowed: true });
  });
});

describe("canModify — seller_manager invoice delete (unpaid and ≤ 2 hours old)", () => {
  const NOW = new Date("2025-05-25T12:00:00.000Z").getTime();
  const sm = defineAbilityFor("seller_manager");

  it("allows a fresh unpaid invoice", () => {
    expect(canModify(sm, "delete", "Invoice", { status: "draft", createdAt: NOW - 60_000 }, NOW)).toEqual({ allowed: true });
  });

  it("denies a paid invoice regardless of age", () => {
    expect(canModify(sm, "delete", "Invoice", { status: "paid", createdAt: NOW }, NOW)).toEqual({
      allowed: false,
      reason: "invoice-paid",
    });
  });

  it("allows exactly at the window boundary and denies 1ms after (server uses createdAt < now - 2h)", () => {
    expect(canModify(sm, "delete", "Invoice", { createdAt: NOW - INVOICE_DELETE_WINDOW_MS }, NOW)).toEqual({ allowed: true });
    expect(canModify(sm, "delete", "Invoice", { createdAt: NOW - INVOICE_DELETE_WINDOW_MS - 1 }, NOW)).toEqual({
      allowed: false,
      reason: "window-expired",
    });
  });

  it("is a 2-hour window", () => {
    expect(INVOICE_DELETE_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("only applies to Invoice deletes — other resources and actions are unaffected", () => {
    const old = { status: "paid", createdAt: 0 };
    expect(canModify(sm, "update", "Invoice", old, NOW)).toEqual({ allowed: true });
    expect(canModify(sm, "delete", "RecurringInvoice", old, NOW)).toEqual({ allowed: true });
  });

  it("does not apply to admin or superadmin (including the legacy 'owner' role)", () => {
    for (const role of ["admin", "superadmin", "owner"]) {
      expect(canModify(defineAbilityFor(role), "delete", "Invoice", { status: "paid", createdAt: 0 }, NOW)).toEqual({
        allowed: true,
      });
    }
  });

  it("defaults `now` to the current time when omitted", () => {
    expect(canModify(sm, "delete", "Invoice", { createdAt: new Date() }).allowed).toBe(true);
    expect(
      canModify(sm, "delete", "Invoice", { createdAt: new Date(Date.now() - INVOICE_DELETE_WINDOW_MS - 1000) }).reason,
    ).toBe("window-expired");
  });

  describe("createdAt input shapes", () => {
    it("accepts Date objects, epoch-ms numbers and ISO strings", () => {
      const stale = NOW - INVOICE_DELETE_WINDOW_MS - 1;
      for (const createdAt of [new Date(stale), stale, new Date(stale).toISOString()]) {
        expect(canModify(sm, "delete", "Invoice", { createdAt }, NOW).reason).toBe("window-expired");
      }
    });

    it("treats a numeric 0 as a real (very old) timestamp, not as missing", () => {
      expect(canModify(sm, "delete", "Invoice", { createdAt: 0 }, NOW).reason).toBe("window-expired");
    });

    it("does not block when the record or its createdAt is missing or unparseable (API stays authoritative)", () => {
      for (const record of [undefined, {}, { createdAt: null }, { createdAt: "not-a-date" }, { createdAt: new Date("garbage") }]) {
        expect(canModify(sm, "delete", "Invoice", record, NOW)).toEqual({ allowed: true });
      }
    });

    it("still applies the paid rule when createdAt is unknown", () => {
      expect(canModify(sm, "delete", "Invoice", { status: "paid" }, NOW).reason).toBe("invoice-paid");
    });
  });
});

describe("package entry point", () => {
  it("re-exports the permission API that web, desktop and mobile import from @hisaabo/shared", async () => {
    const pkg = await import("../index.js");
    expect(pkg.defineAbilityFor).toBe(defineAbilityFor);
    expect(pkg.mapDbRole).toBe(mapDbRole);
    expect(pkg.canModify).toBe(canModify);
    expect(pkg.ALL_ACTIONS).toBe(ALL_ACTIONS);
    expect(pkg.ALL_RESOURCES).toBe(ALL_RESOURCES);
    expect(pkg.INVOICE_DELETE_WINDOW_MS).toBe(INVOICE_DELETE_WINDOW_MS);
  });
});
