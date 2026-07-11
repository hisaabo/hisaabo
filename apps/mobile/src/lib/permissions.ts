/**
 * Client-side permission mirror.
 *
 * This is a faithful port of the server's CASL rules in
 * `packages/api/src/lib/permissions.ts` (`mapDbRole` + `defineAbilityFor`).
 * The server is always the source of truth and enforces every mutation; this
 * mirror exists purely to decide which UI affordances (create / edit / delete
 * buttons, nav items) to render, so a read-only role like `accountant` never
 * sees action buttons it cannot use.
 *
 * IMPORTANT: any change to the server permissions.ts MUST be reflected here,
 * and vice versa. The contract is covered by src/__tests__/role-access.test.ts.
 */

export type Action = "create" | "read" | "update" | "delete" | "manage";

export type Resource =
  | "Invoice" | "Payment" | "Party" | "Item" | "Expense"
  | "BankAccount" | "BankTransaction"
  | "Business" | "Team" | "Import" | "Report" | "GstReport"
  | "Store" | "SalesTarget" | "RecurringInvoice"
  | "Account" | "ITC"
  | "BankReconciliation" | "EInvoice" | "EWayBill"
  | "all";

const CRUD: Action[] = ["create", "read", "update", "delete"];

const ALL_RESOURCES: Exclude<Resource, "all">[] = [
  "Invoice", "Payment", "Party", "Item", "Expense",
  "BankAccount", "BankTransaction", "Business", "Team",
  "Import", "Report", "GstReport", "Store", "SalesTarget",
  "RecurringInvoice", "Account", "ITC",
  "BankReconciliation", "EInvoice", "EWayBill",
];

/**
 * Map raw DB roles (which may still be legacy enum values) to the permission
 * roles used below. Mirrors `mapDbRole` in packages/api/src/lib/permissions.ts.
 */
function normalizeRole(dbRole: string): string {
  const mapping: Record<string, string> = {
    owner: "superadmin",        // Legacy: owner = superadmin
    admin: "admin",
    member: "seller",           // Legacy: member = seller
    viewer: "accountant",       // Legacy: viewer = accountant
    superadmin: "superadmin",
    seller_manager: "seller_manager",
    seller: "seller",
    accountant: "accountant",
  };
  return mapping[dbRole] ?? "";
}

/**
 * Build the grant set for a normalized role. Mirrors `defineAbilityFor`.
 * A `manage` grant expands to every CRUD action on that resource (and, for
 * `all`, on every resource) so `can()` can answer create/read/update/delete.
 */
function grantsFor(role: string): Set<string> {
  const grants = new Set<string>();

  function can(action: Action, resource: Resource) {
    if (action === "manage" && resource === "all") {
      for (const r of ALL_RESOURCES) for (const a of CRUD) grants.add(`${a}:${r}`);
      grants.add(`manage:all`);
      return;
    }
    if (action === "manage") {
      for (const a of CRUD) grants.add(`${a}:${resource}`);
      grants.add(`manage:${resource}`);
      return;
    }
    grants.add(`${action}:${resource}`);
  }

  switch (role) {
    case "superadmin":
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
      can("read", "Account");
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
      can("manage", "Account");
      can("manage", "ITC");
      can("manage", "BankReconciliation");
      can("read", "EInvoice");
      can("read", "EWayBill");
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
      // Unknown role gets nothing.
      break;
  }

  return grants;
}

// Small cache so we don't rebuild the grant set on every render.
const grantCache = new Map<string, Set<string>>();

function grantsForCached(dbRole: string): Set<string> {
  const normalized = normalizeRole(dbRole);
  let g = grantCache.get(normalized);
  if (!g) {
    g = grantsFor(normalized);
    grantCache.set(normalized, g);
  }
  return g;
}

/**
 * Whether `role` may perform `action` on `resource`.
 *
 * While the role is still loading (`null`/`undefined`) we return `true` so the
 * UI doesn't flash restricted state before the session resolves — the server
 * still enforces the real check on any mutation. A known-but-unmapped role
 * resolves to no grants (deny), matching the server default.
 */
export function canAccess(
  role: string | null | undefined,
  resource: Resource,
  action: Action,
): boolean {
  if (!role) return true; // graceful degradation while session loads
  const grants = grantsForCached(role);
  if (grants.has("manage:all")) return true;
  return grants.has(`${action}:${resource}`);
}
