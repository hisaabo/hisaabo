/**
 * Role-Based Access Control — Contract Test Suite
 *
 * Documents and enforces which navigation items, pages, and action buttons
 * each user role should have access to. This is a PURE DATA contract test —
 * it does not render components (routes depend on TanStack Router). Instead
 * it tests the PERMISSION MATRIX as a specification, duplicating the CASL
 * logic from `@hisaabo/api` since cross-package imports are not available
 * in web tests.
 *
 * ┌──────────────────┬────────┬───────┬────────────────┬────────┬────────────┐
 * │ Capability        │ super  │ admin │ seller_manager │ seller │ accountant │
 * │                   │ admin  │       │                │        │            │
 * ├──────────────────┼────────┼───────┼────────────────┼────────┼────────────┤
 * │ Dashboard         │   R    │   R   │       R        │   R    │     R      │
 * │ Invoices (CRUD)   │  CRUD  │ CRUD  │     CRUD       │  CRU   │     R      │
 * │ Quotations        │  CRUD  │ CRUD  │     CRUD       │  CRU   │     R      │
 * │ Sales Returns     │  CRUD  │ CRUD  │     CRUD       │  CRU   │     R      │
 * │ Credit Notes      │  CRUD  │ CRUD  │     CRUD       │  CRU   │     R      │
 * │ Delivery Challans │  CRUD  │ CRUD  │     CRUD       │  CRU   │     R      │
 * │ Proforma Invoices │  CRUD  │ CRUD  │     CRUD       │  CRU   │     R      │
 * │ Store Orders      │  CRUD  │ CRUD  │     CRU        │   R    │     R      │
 * │ Automated Invs    │  CRUD  │ CRUD  │     CRUD       │   R    │     R      │
 * │ Parties (CRU)     │  CRUD  │ CRUD  │     CRU        │  CR    │     R      │
 * │ Items (CRU)       │  CRUD  │ CRUD  │     CRU        │   R    │     R      │
 * │ Payments (CRU)    │  CRUD  │ CRUD  │     CRU        │  CRU   │    CRU     │
 * │ Cash & Bank       │  CRUD  │ CRUD  │      R         │   -    │   manage   │
 * │ Expenses (CRUD)   │  CRUD  │ CRUD  │      R         │   -    │    CRUD    │
 * │ Shipments          │  CRUD  │ CRUD  │      R         │   R    │     R      │
 * │ GST Returns       │  CRUD  │ CRUD  │      -         │   -    │     R      │
 * │ Reports           │  CRUD  │ CRUD  │      R         │   -    │     R      │
 * │ Settings          │  CRUD  │ CRUD  │      -         │   -    │     -      │
 * │ Team Management   │  CRUD  │ CRUD  │      -         │   -    │     -      │
 * │ Sales Targets     │  CRUD  │ CRUD  │    manage      │   R    │     -      │
 * └──────────────────┴────────┴───────┴────────────────┴────────┴────────────┘
 *
 * Source of truth: packages/api/src/lib/permissions.ts
 * Run with: pnpm --filter @hisaabo/web test -- --run src/__tests__/role-access.test.ts
 */

import { describe, it, expect } from "vitest";

// ─── Duplicated Permission Logic ─────────────────────────────────────────────
// Mirrors defineAbilityFor from @hisaabo/api without CASL dependency.
// We use a simple Set-based approach since we only need can/cannot checks.

type Action = "create" | "read" | "update" | "delete" | "manage";

type Resource =
  | "Invoice" | "Payment" | "Party" | "Item" | "Expense"
  | "BankAccount" | "BankTransaction"
  | "Business" | "Team" | "Import" | "Report" | "GstReport"
  | "Store" | "SalesTarget" | "RecurringInvoice"
  | "all";

const ALL_ACTIONS: Action[] = ["create", "read", "update", "delete", "manage"];
const ALL_RESOURCES: Resource[] = [
  "Invoice", "Payment", "Party", "Item", "Expense",
  "BankAccount", "BankTransaction", "Business", "Team",
  "Import", "Report", "GstReport", "Store", "SalesTarget",
  "RecurringInvoice",
];

interface SimpleAbility {
  can(action: Action, resource: Resource): boolean;
}

/**
 * Pure-data mirror of defineAbilityFor from packages/api/src/lib/permissions.ts.
 * Any change to the API permissions.ts MUST be reflected here, and vice versa.
 * If these tests fail after an API change, update this function to match.
 */
function defineAbilityFor(role: string): SimpleAbility {
  const grants = new Set<string>();

  function can(action: Action, resource: Resource | "all") {
    if (resource === "all" && action === "manage") {
      // "manage all" = every action on every resource
      for (const a of ALL_ACTIONS) {
        for (const r of ALL_RESOURCES) {
          grants.add(`${a}:${r}`);
        }
      }
    } else if (action === "manage") {
      // "manage <Resource>" = every action on that resource
      for (const a of ALL_ACTIONS) {
        grants.add(`${a}:${resource}`);
      }
    } else {
      grants.add(`${action}:${resource}`);
    }
  }

  switch (role) {
    case "superadmin":
      can("manage", "all");
      break;

    case "admin":
      can("manage", "all");
      break;

    case "seller_manager":
      can("create", "Invoice");
      can("read", "Invoice");
      can("update", "Invoice");
      can("delete", "Invoice");
      can("create", "Party");
      can("read", "Party");
      can("update", "Party");
      can("create", "Item");
      can("read", "Item");
      can("update", "Item");
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment");
      can("read", "Expense");
      can("read", "BankAccount");
      can("read", "BankTransaction");
      can("read", "Business");
      can("read", "Report");
      can("create", "Store");
      can("read", "Store");
      can("update", "Store");
      can("read", "SalesTarget");
      can("manage", "SalesTarget");
      can("create", "RecurringInvoice");
      can("read", "RecurringInvoice");
      can("update", "RecurringInvoice");
      can("delete", "RecurringInvoice");
      break;

    case "seller":
      can("create", "Invoice");
      can("read", "Invoice");
      can("update", "Invoice");
      can("create", "Party");
      can("read", "Party");
      can("read", "Item");
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment");
      can("read", "Business");
      can("read", "Store");
      can("read", "SalesTarget");
      can("read", "RecurringInvoice");
      break;

    case "accountant":
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment");
      can("create", "Expense");
      can("read", "Expense");
      can("update", "Expense");
      can("delete", "Expense");
      can("manage", "BankAccount");
      can("manage", "BankTransaction");
      can("read", "Report");
      can("read", "GstReport");
      can("read", "Invoice");
      can("read", "Party");
      can("read", "Item");
      can("read", "Business");
      can("read", "Store");
      can("read", "RecurringInvoice");
      break;

    default:
      // Unknown role gets nothing
      break;
  }

  return {
    can: (action: Action, resource: Resource) => grants.has(`${action}:${resource}`),
  };
}

// ─── Navigation Items (mirrors __root.tsx navSections) ───────────────────────

const ALL_NAV_ITEMS = [
  // OVERVIEW
  "Dashboard",
  // SALES
  "Invoices",
  "Quotations",
  "Sales Returns",
  "Credit Notes",
  "Delivery Challans",
  "Proforma Invoices",
  "Store Orders",
  "Automated Invoices",
  // CONTACTS
  "Parties",
  // INVENTORY
  "Items",
  // MONEY
  "Payments",
  "Cash & Bank",
  "Expenses",
  "Shipments",
  // COMPLIANCE
  "GST Returns",
  "Reports",
  // ACCOUNT
  "Settings",
] as const;

type NavItem = (typeof ALL_NAV_ITEMS)[number];

// ─── Navigation Visibility Contract ──────────────────────────────────────────
// Maps each nav item to the permission check that controls whether the user
// should be able to see/access that page. "visible" means the nav item should
// be rendered; "hidden" means the item should not be shown or should be
// inaccessible.

interface NavItemPermission {
  navItem: NavItem;
  resource: Resource;
  action: Action;
}

/**
 * Maps navigation items to the minimum permission needed to view that page.
 * Most pages require at least "read" on their primary resource.
 */
const NAV_PERMISSION_MAP: NavItemPermission[] = [
  // Dashboard is universally visible (requires reading Business)
  { navItem: "Dashboard", resource: "Business", action: "read" },
  // Sales section — all map to Invoice resource
  { navItem: "Invoices", resource: "Invoice", action: "read" },
  { navItem: "Quotations", resource: "Invoice", action: "read" },
  { navItem: "Sales Returns", resource: "Invoice", action: "read" },
  { navItem: "Credit Notes", resource: "Invoice", action: "read" },
  { navItem: "Delivery Challans", resource: "Invoice", action: "read" },
  { navItem: "Proforma Invoices", resource: "Invoice", action: "read" },
  { navItem: "Store Orders", resource: "Store", action: "read" },
  { navItem: "Automated Invoices", resource: "RecurringInvoice", action: "read" },
  // Contacts
  { navItem: "Parties", resource: "Party", action: "read" },
  // Inventory
  { navItem: "Items", resource: "Item", action: "read" },
  // Money
  { navItem: "Payments", resource: "Payment", action: "read" },
  { navItem: "Cash & Bank", resource: "BankAccount", action: "read" },
  { navItem: "Expenses", resource: "Expense", action: "read" },
  { navItem: "Shipments", resource: "Invoice", action: "read" },
  // Compliance
  { navItem: "GST Returns", resource: "GstReport", action: "read" },
  { navItem: "Reports", resource: "Report", action: "read" },
  // Account
  { navItem: "Settings", resource: "Business", action: "manage" },
];

// ─── Navigation Visibility Contract Data ─────────────────────────────────────

const NAV_CONTRACT: Record<string, { visible: NavItem[]; hidden: NavItem[] }> = {
  superadmin: {
    visible: [
      "Dashboard", "Invoices", "Quotations", "Sales Returns", "Credit Notes",
      "Delivery Challans", "Proforma Invoices", "Store Orders", "Automated Invoices",
      "Parties", "Items", "Payments", "Cash & Bank", "Expenses", "Shipments",
      "GST Returns", "Reports", "Settings",
    ],
    hidden: [],
  },
  admin: {
    visible: [
      "Dashboard", "Invoices", "Quotations", "Sales Returns", "Credit Notes",
      "Delivery Challans", "Proforma Invoices", "Store Orders", "Automated Invoices",
      "Parties", "Items", "Payments", "Cash & Bank", "Expenses", "Shipments",
      "GST Returns", "Reports", "Settings",
    ],
    hidden: [],
  },
  seller_manager: {
    visible: [
      "Dashboard", "Invoices", "Quotations", "Sales Returns", "Credit Notes",
      "Delivery Challans", "Proforma Invoices", "Store Orders", "Automated Invoices",
      "Parties", "Items", "Payments", "Cash & Bank", "Expenses",
      "Shipments", "Reports",
    ],
    hidden: ["GST Returns", "Settings"],
  },
  seller: {
    visible: [
      "Dashboard", "Invoices", "Quotations", "Sales Returns", "Credit Notes",
      "Delivery Challans", "Proforma Invoices", "Store Orders", "Automated Invoices",
      "Parties", "Items", "Payments", "Shipments",
    ],
    hidden: ["Cash & Bank", "Expenses", "GST Returns", "Reports", "Settings"],
  },
  accountant: {
    visible: [
      "Dashboard", "Invoices", "Quotations", "Sales Returns", "Credit Notes",
      "Delivery Challans", "Proforma Invoices", "Store Orders", "Automated Invoices",
      "Parties", "Items", "Payments", "Cash & Bank", "Expenses", "Shipments",
      "GST Returns", "Reports",
    ],
    hidden: ["Settings"],
  },
};

// ─── Action Button Contract Data ─────────────────────────────────────────────

interface ActionContract {
  role: string;
  page: string;
  resource: Resource;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const ACTION_CONTRACTS: ActionContract[] = [
  // Invoices
  { role: "superadmin",      page: "invoices", resource: "Invoice", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "invoices", resource: "Invoice", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "invoices", resource: "Invoice", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller",          page: "invoices", resource: "Invoice", canCreate: true,  canEdit: true,  canDelete: false },
  { role: "accountant",      page: "invoices", resource: "Invoice", canCreate: false, canEdit: false, canDelete: false },

  // Parties
  { role: "superadmin",      page: "parties", resource: "Party", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "parties", resource: "Party", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "parties", resource: "Party", canCreate: true,  canEdit: true,  canDelete: false },
  { role: "seller",          page: "parties", resource: "Party", canCreate: true,  canEdit: false,  canDelete: false },
  { role: "accountant",      page: "parties", resource: "Party", canCreate: false, canEdit: false, canDelete: false },

  // Items
  { role: "superadmin",      page: "items", resource: "Item", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "items", resource: "Item", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "items", resource: "Item", canCreate: true,  canEdit: true,  canDelete: false },
  { role: "seller",          page: "items", resource: "Item", canCreate: false, canEdit: false, canDelete: false },
  { role: "accountant",      page: "items", resource: "Item", canCreate: false, canEdit: false, canDelete: false },

  // Payments
  { role: "superadmin",      page: "payments", resource: "Payment", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "payments", resource: "Payment", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "payments", resource: "Payment", canCreate: true,  canEdit: true,  canDelete: false },
  { role: "seller",          page: "payments", resource: "Payment", canCreate: true,  canEdit: true,  canDelete: false },
  { role: "accountant",      page: "payments", resource: "Payment", canCreate: true,  canEdit: true,  canDelete: false },

  // Expenses
  { role: "superadmin",      page: "expenses", resource: "Expense", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "expenses", resource: "Expense", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "expenses", resource: "Expense", canCreate: false, canEdit: false, canDelete: false },
  { role: "seller",          page: "expenses", resource: "Expense", canCreate: false, canEdit: false, canDelete: false },
  { role: "accountant",      page: "expenses", resource: "Expense", canCreate: true,  canEdit: true,  canDelete: true  },

  // Bank Accounts
  { role: "superadmin",      page: "cash-and-bank", resource: "BankAccount", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "cash-and-bank", resource: "BankAccount", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "cash-and-bank", resource: "BankAccount", canCreate: false, canEdit: false, canDelete: false },
  { role: "seller",          page: "cash-and-bank", resource: "BankAccount", canCreate: false, canEdit: false, canDelete: false },
  { role: "accountant",      page: "cash-and-bank", resource: "BankAccount", canCreate: true,  canEdit: true,  canDelete: true  },

  // Recurring / Automated Invoices
  { role: "superadmin",      page: "automated-invoices", resource: "RecurringInvoice", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "automated-invoices", resource: "RecurringInvoice", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "automated-invoices", resource: "RecurringInvoice", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller",          page: "automated-invoices", resource: "RecurringInvoice", canCreate: false, canEdit: false, canDelete: false },
  { role: "accountant",      page: "automated-invoices", resource: "RecurringInvoice", canCreate: false, canEdit: false, canDelete: false },

  // Store
  { role: "superadmin",      page: "store-orders", resource: "Store", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "admin",           page: "store-orders", resource: "Store", canCreate: true,  canEdit: true,  canDelete: true  },
  { role: "seller_manager",  page: "store-orders", resource: "Store", canCreate: true,  canEdit: true,  canDelete: false },
  { role: "seller",          page: "store-orders", resource: "Store", canCreate: false, canEdit: false, canDelete: false },
  { role: "accountant",      page: "store-orders", resource: "Store", canCreate: false, canEdit: false, canDelete: false },
];

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Role-Based Access Control — Permission Contract", () => {

  // ── 1. Navigation Visibility Contract ────────────────────────────────────

  describe("Navigation visibility contract", () => {
    const roles = Object.keys(NAV_CONTRACT) as Array<keyof typeof NAV_CONTRACT>;

    describe.each(roles)("%s role", (role) => {
      const ability = defineAbilityFor(role);
      const contract = NAV_CONTRACT[role];

      if (contract.visible.length > 0) {
        it.each(contract.visible)(
          "can see \"%s\" in the sidebar",
          (navItem) => {
            const mapping = NAV_PERMISSION_MAP.find((m) => m.navItem === navItem);
            expect(mapping).toBeDefined();
            expect(ability.can(mapping!.action, mapping!.resource)).toBe(true);
          },
        );
      }

      if (contract.hidden.length > 0) {
        it.each(contract.hidden)(
          "cannot see \"%s\" in the sidebar",
          (navItem) => {
            const mapping = NAV_PERMISSION_MAP.find((m) => m.navItem === navItem);
            expect(mapping).toBeDefined();
            expect(ability.can(mapping!.action, mapping!.resource)).toBe(false);
          },
        );
      }
    });

    it("contract covers every navigation item", () => {
      for (const role of roles) {
        const contract = NAV_CONTRACT[role];
        const covered = new Set([...contract.visible, ...contract.hidden]);
        for (const navItem of ALL_NAV_ITEMS) {
          expect(covered.has(navItem)).toBe(true);
        }
      }
    });
  });

  // ── 2. Action Button Contract ────────────────────────────────────────────

  describe("Action button contract", () => {
    it.each(ACTION_CONTRACTS)(
      "$role on $page: create=$canCreate, edit=$canEdit, delete=$canDelete",
      ({ role, resource, canCreate, canEdit, canDelete }) => {
        const ability = defineAbilityFor(role);
        expect(ability.can("create", resource)).toBe(canCreate);
        expect(ability.can("update", resource)).toBe(canEdit);
        expect(ability.can("delete", resource)).toBe(canDelete);
      },
    );
  });

  // ── 3. Permission Boundary Tests ────────────────────────────────────────

  describe("superadmin role — full access", () => {
    const ability = defineAbilityFor("superadmin");

    it("can manage all resources", () => {
      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          expect(ability.can(action, resource)).toBe(true);
        }
      }
    });
  });

  describe("admin role — full access (superadmin demotion handled at endpoint level)", () => {
    const ability = defineAbilityFor("admin");

    it("has identical permissions to superadmin at the CASL level", () => {
      const superAbility = defineAbilityFor("superadmin");
      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          expect(ability.can(action, resource)).toBe(superAbility.can(action, resource));
        }
      }
    });
  });

  describe("seller_manager role — sales + team management", () => {
    const ability = defineAbilityFor("seller_manager");

    it("can create, read, update, and delete invoices", () => {
      expect(ability.can("create", "Invoice")).toBe(true);
      expect(ability.can("read", "Invoice")).toBe(true);
      expect(ability.can("update", "Invoice")).toBe(true);
      expect(ability.can("delete", "Invoice")).toBe(true);
    });

    it("can create and update parties but cannot delete them", () => {
      expect(ability.can("create", "Party")).toBe(true);
      expect(ability.can("update", "Party")).toBe(true);
      expect(ability.can("delete", "Party")).toBe(false);
    });

    it("can create and update items but cannot delete them", () => {
      expect(ability.can("create", "Item")).toBe(true);
      expect(ability.can("update", "Item")).toBe(true);
      expect(ability.can("delete", "Item")).toBe(false);
    });

    it("can manage sales targets for their team", () => {
      expect(ability.can("manage", "SalesTarget")).toBe(true);
      expect(ability.can("create", "SalesTarget")).toBe(true);
      expect(ability.can("read", "SalesTarget")).toBe(true);
    });

    it("can read expenses but cannot create, update, or delete them", () => {
      expect(ability.can("read", "Expense")).toBe(true);
      expect(ability.can("create", "Expense")).toBe(false);
      expect(ability.can("update", "Expense")).toBe(false);
      expect(ability.can("delete", "Expense")).toBe(false);
    });

    it("can read bank accounts but cannot manage them", () => {
      expect(ability.can("read", "BankAccount")).toBe(true);
      expect(ability.can("create", "BankAccount")).toBe(false);
      expect(ability.can("update", "BankAccount")).toBe(false);
    });

    it("cannot access GST reports", () => {
      expect(ability.can("read", "GstReport")).toBe(false);
    });

    it("cannot manage team members", () => {
      expect(ability.can("manage", "Team")).toBe(false);
      expect(ability.can("create", "Team")).toBe(false);
    });

    it("can fully manage recurring invoices", () => {
      expect(ability.can("create", "RecurringInvoice")).toBe(true);
      expect(ability.can("read", "RecurringInvoice")).toBe(true);
      expect(ability.can("update", "RecurringInvoice")).toBe(true);
      expect(ability.can("delete", "RecurringInvoice")).toBe(true);
    });
  });

  describe("seller role — limited to own sales work", () => {
    const ability = defineAbilityFor("seller");

    it("can create invoices but cannot delete them", () => {
      expect(ability.can("create", "Invoice")).toBe(true);
      expect(ability.can("read", "Invoice")).toBe(true);
      expect(ability.can("update", "Invoice")).toBe(true);
      expect(ability.can("delete", "Invoice")).toBe(false);
    });

    it("can create parties but cannot update or delete them", () => {
      expect(ability.can("create", "Party")).toBe(true);
      expect(ability.can("read", "Party")).toBe(true);
      expect(ability.can("update", "Party")).toBe(false);
      expect(ability.can("delete", "Party")).toBe(false);
    });

    it("can read items but cannot create, update, or delete them", () => {
      expect(ability.can("read", "Item")).toBe(true);
      expect(ability.can("create", "Item")).toBe(false);
      expect(ability.can("update", "Item")).toBe(false);
      expect(ability.can("delete", "Item")).toBe(false);
    });

    it("can create and update payments but cannot delete them", () => {
      expect(ability.can("create", "Payment")).toBe(true);
      expect(ability.can("read", "Payment")).toBe(true);
      expect(ability.can("update", "Payment")).toBe(true);
      expect(ability.can("delete", "Payment")).toBe(false);
    });

    it("cannot access expenses at all", () => {
      expect(ability.can("read", "Expense")).toBe(false);
      expect(ability.can("create", "Expense")).toBe(false);
    });

    it("cannot access bank accounts", () => {
      expect(ability.can("read", "BankAccount")).toBe(false);
      expect(ability.can("create", "BankAccount")).toBe(false);
    });

    it("cannot access GST reports", () => {
      expect(ability.can("read", "GstReport")).toBe(false);
    });

    it("cannot access general reports", () => {
      expect(ability.can("read", "Report")).toBe(false);
    });

    it("cannot manage business settings or team", () => {
      expect(ability.can("manage", "Business")).toBe(false);
      expect(ability.can("manage", "Team")).toBe(false);
    });

    it("can read sales targets but cannot create or manage them", () => {
      expect(ability.can("read", "SalesTarget")).toBe(true);
      expect(ability.can("create", "SalesTarget")).toBe(false);
      expect(ability.can("manage", "SalesTarget")).toBe(false);
    });

    it("can read recurring invoices but cannot create or modify them", () => {
      expect(ability.can("read", "RecurringInvoice")).toBe(true);
      expect(ability.can("create", "RecurringInvoice")).toBe(false);
      expect(ability.can("update", "RecurringInvoice")).toBe(false);
      expect(ability.can("delete", "RecurringInvoice")).toBe(false);
    });

    it("can read store orders but cannot create or update them", () => {
      expect(ability.can("read", "Store")).toBe(true);
      expect(ability.can("create", "Store")).toBe(false);
      expect(ability.can("update", "Store")).toBe(false);
    });
  });

  describe("accountant role — financial access, read-only on sales", () => {
    const ability = defineAbilityFor("accountant");

    it("can read invoices but cannot create, update, or delete them", () => {
      expect(ability.can("read", "Invoice")).toBe(true);
      expect(ability.can("create", "Invoice")).toBe(false);
      expect(ability.can("update", "Invoice")).toBe(false);
      expect(ability.can("delete", "Invoice")).toBe(false);
    });

    it("can fully manage expenses (create, read, update, delete)", () => {
      expect(ability.can("create", "Expense")).toBe(true);
      expect(ability.can("read", "Expense")).toBe(true);
      expect(ability.can("update", "Expense")).toBe(true);
      expect(ability.can("delete", "Expense")).toBe(true);
    });

    it("can manage bank accounts (full CRUD)", () => {
      expect(ability.can("create", "BankAccount")).toBe(true);
      expect(ability.can("read", "BankAccount")).toBe(true);
      expect(ability.can("update", "BankAccount")).toBe(true);
      expect(ability.can("delete", "BankAccount")).toBe(true);
      expect(ability.can("manage", "BankAccount")).toBe(true);
    });

    it("can manage bank transactions (full CRUD)", () => {
      expect(ability.can("create", "BankTransaction")).toBe(true);
      expect(ability.can("read", "BankTransaction")).toBe(true);
      expect(ability.can("update", "BankTransaction")).toBe(true);
      expect(ability.can("delete", "BankTransaction")).toBe(true);
    });

    it("can create and update payments but cannot delete them", () => {
      expect(ability.can("create", "Payment")).toBe(true);
      expect(ability.can("read", "Payment")).toBe(true);
      expect(ability.can("update", "Payment")).toBe(true);
      expect(ability.can("delete", "Payment")).toBe(false);
    });

    it("can read GST reports", () => {
      expect(ability.can("read", "GstReport")).toBe(true);
    });

    it("can read general reports", () => {
      expect(ability.can("read", "Report")).toBe(true);
    });

    it("cannot create items", () => {
      expect(ability.can("create", "Item")).toBe(false);
      expect(ability.can("update", "Item")).toBe(false);
    });

    it("cannot create parties", () => {
      expect(ability.can("create", "Party")).toBe(false);
      expect(ability.can("update", "Party")).toBe(false);
    });

    it("cannot manage team or business settings", () => {
      expect(ability.can("manage", "Team")).toBe(false);
      expect(ability.can("manage", "Business")).toBe(false);
    });

    it("cannot manage sales targets", () => {
      expect(ability.can("read", "SalesTarget")).toBe(false);
      expect(ability.can("manage", "SalesTarget")).toBe(false);
    });
  });

  describe("unknown role — zero permissions (security boundary)", () => {
    const ability = defineAbilityFor("unknown_role");

    it("cannot perform any action on any resource", () => {
      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          expect(ability.can(action, resource)).toBe(false);
        }
      }
    });

    it("empty string role also gets zero permissions", () => {
      const emptyAbility = defineAbilityFor("");
      for (const resource of ALL_RESOURCES) {
        expect(emptyAbility.can("read", resource)).toBe(false);
      }
    });
  });

  // ── 4. Cross-Role Comparison Tests ──────────────────────────────────────

  describe("cross-role permission escalation boundaries", () => {
    it("seller has strictly fewer permissions than seller_manager", () => {
      const seller = defineAbilityFor("seller");
      const manager = defineAbilityFor("seller_manager");

      // Everything a seller can do, a seller_manager can also do
      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          if (seller.can(action, resource)) {
            expect(manager.can(action, resource)).toBe(true);
          }
        }
      }

      // But seller_manager can do things seller cannot
      let managerHasMore = false;
      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          if (manager.can(action, resource) && !seller.can(action, resource)) {
            managerHasMore = true;
          }
        }
      }
      expect(managerHasMore).toBe(true);
    });

    it("accountant and seller have non-overlapping write domains", () => {
      const accountant = defineAbilityFor("accountant");
      const seller = defineAbilityFor("seller");

      // Accountant can create expenses, seller cannot
      expect(accountant.can("create", "Expense")).toBe(true);
      expect(seller.can("create", "Expense")).toBe(false);

      // Seller can create invoices, accountant cannot
      expect(seller.can("create", "Invoice")).toBe(true);
      expect(accountant.can("create", "Invoice")).toBe(false);
    });

    it("only admin-tier roles can manage business settings", () => {
      const roles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
      for (const role of roles) {
        const ability = defineAbilityFor(role);
        if (role === "superadmin" || role === "admin") {
          expect(ability.can("manage", "Business")).toBe(true);
        } else {
          expect(ability.can("manage", "Business")).toBe(false);
        }
      }
    });

    it("only admin-tier roles can manage team members", () => {
      const roles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
      for (const role of roles) {
        const ability = defineAbilityFor(role);
        if (role === "superadmin" || role === "admin") {
          expect(ability.can("manage", "Team")).toBe(true);
        } else {
          expect(ability.can("manage", "Team")).toBe(false);
        }
      }
    });

    it("only accountant and admin-tier roles can manage bank accounts", () => {
      const roles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
      for (const role of roles) {
        const ability = defineAbilityFor(role);
        if (role === "superadmin" || role === "admin" || role === "accountant") {
          expect(ability.can("manage", "BankAccount")).toBe(true);
        } else {
          expect(ability.can("manage", "BankAccount")).toBe(false);
        }
      }
    });

    it("GST reports are only accessible to accountant and admin-tier roles", () => {
      const roles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
      for (const role of roles) {
        const ability = defineAbilityFor(role);
        if (role === "superadmin" || role === "admin" || role === "accountant") {
          expect(ability.can("read", "GstReport")).toBe(true);
        } else {
          expect(ability.can("read", "GstReport")).toBe(false);
        }
      }
    });
  });

  // ── 5. Contract Completeness Checks ─────────────────────────────────────

  describe("contract completeness", () => {
    it("all five roles are covered in the navigation contract", () => {
      const expectedRoles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];
      for (const role of expectedRoles) {
        expect(NAV_CONTRACT[role]).toBeDefined();
      }
    });

    it("every nav item in the contract maps to a permission check", () => {
      const mappedItems = new Set(NAV_PERMISSION_MAP.map((m) => m.navItem));
      for (const navItem of ALL_NAV_ITEMS) {
        expect(mappedItems.has(navItem)).toBe(true);
      }
    });

    it("action contracts cover all five roles for each page", () => {
      const pages = [...new Set(ACTION_CONTRACTS.map((c) => c.page))];
      const expectedRoles = ["superadmin", "admin", "seller_manager", "seller", "accountant"];

      for (const page of pages) {
        const pageContracts = ACTION_CONTRACTS.filter((c) => c.page === page);
        const coveredRoles = pageContracts.map((c) => c.role);
        for (const role of expectedRoles) {
          expect(coveredRoles).toContain(role);
        }
      }
    });
  });
});
