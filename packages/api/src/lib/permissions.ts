import { AbilityBuilder, PureAbility, createMongoAbility } from "@casl/ability";
import { TRPCError } from "@trpc/server";

// Action types
export type Action = "create" | "read" | "update" | "delete" | "manage";

// Resource types
export type Resource =
  | "Invoice" | "Payment" | "Party" | "Item" | "Expense"
  | "BankAccount" | "BankTransaction"
  | "Business" | "Team" | "Import" | "Report" | "GstReport"
  | "Store" | "SalesTarget" | "RecurringInvoice"
  | "Account" | "ITC"
  | "BankReconciliation" | "EInvoice" | "EWayBill"
  | "all";

export type AppAbility = PureAbility<[Action, Resource]>;

interface PermissionContext {
  userId: string;
  role: string;
}

export function defineAbilityFor(ctx: PermissionContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const { role } = ctx;

  switch (role) {
    case "superadmin":
      can("manage", "all");
      break;

    case "admin":
      can("manage", "all");
      // Cannot demote or remove superadmin (handled in team management logic, not CASL)
      break;

    case "seller_manager":
      // Invoices: full CRUD, delete only unpaid <2hrs (time check done at endpoint level)
      can("create", "Invoice");
      can("read", "Invoice");
      can("update", "Invoice");
      can("delete", "Invoice"); // API enforces: unpaid + <2hrs
      // Parties & Items
      can("create", "Party");
      can("read", "Party");
      can("update", "Party");
      can("create", "Item");
      can("read", "Item");
      can("update", "Item");
      // Payments: create for own invoices, edit within 2hrs
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment"); // API enforces: own + <2hrs
      // View only
      can("read", "Expense");
      can("read", "BankAccount");
      can("read", "BankTransaction");
      can("read", "Account");
      can("read", "Business");
      can("read", "Report");
      // Store: create/read/update (toggle items, confirm orders)
      can("create", "Store");
      can("read", "Store");
      can("update", "Store");
      // Sales targets: read own targets + manage targets for their team
      can("read", "SalesTarget");
      can("manage", "SalesTarget");
      // Recurring invoices: full CRUD
      can("create", "RecurringInvoice");
      can("read", "RecurringInvoice");
      can("update", "RecurringInvoice");
      can("delete", "RecurringInvoice");
      break;

    case "seller":
      // Invoices: create, edit own only within 2hrs
      can("create", "Invoice");
      can("read", "Invoice");
      can("update", "Invoice"); // API enforces: own + <2hrs
      // Parties: create + read
      can("create", "Party");
      can("read", "Party");
      // Items: read only
      can("read", "Item");
      // Payments: create for own invoices, edit within 2hrs
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment"); // API enforces: own + <2hrs
      // View basics
      can("read", "Business");
      // Store: read only (view orders)
      can("read", "Store");
      // Sales targets: read (myTargets is self-scoped, list filtered by admin)
      can("read", "SalesTarget");
      // Recurring invoices: read only
      can("read", "RecurringInvoice");
      break;

    case "accountant":
      // Full financial access
      can("create", "Payment");
      can("read", "Payment");
      can("update", "Payment");
      can("create", "Expense");
      can("read", "Expense");
      can("update", "Expense");
      can("delete", "Expense");
      can("manage", "BankAccount");
      can("manage", "BankTransaction");
      can("manage", "Account");
      can("manage", "ITC");
      can("manage", "BankReconciliation");
      can("read", "EInvoice");
      can("read", "EWayBill");
      can("read", "Report");
      can("read", "GstReport");
      // Read-only on non-financial
      can("read", "Invoice");
      can("read", "Party");
      can("read", "Item");
      can("read", "Business");
      // Store: read only (view orders for reconciliation)
      can("read", "Store");
      // Recurring invoices: read only
      can("read", "RecurringInvoice");
      break;

    default:
      // Unknown role gets nothing
      break;
  }

  return build();
}

// Map legacy DB enum values to the new permission roles
export function mapDbRole(dbRole: string): string {
  const mapping: Record<string, string> = {
    "owner": "superadmin",        // Legacy: owner = superadmin
    "admin": "admin",
    "member": "seller",           // Legacy: member = seller (most common)
    "viewer": "accountant",       // Legacy: viewer = accountant
    // New roles (once enum is extended):
    "superadmin": "superadmin",
    "seller_manager": "seller_manager",
    "seller": "seller",
    "accountant": "accountant",
  };
  // Unknown roles map to an empty string — defineAbilityFor hits the default case (no permissions)
  return mapping[dbRole] ?? "";
}

// Helper to enforce CASL permissions in tRPC procedures
export function requireCan(ability: AppAbility, action: Action, resource: Resource): void {
  if (!ability.can(action, resource)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Cannot ${action} ${resource}` });
  }
}
