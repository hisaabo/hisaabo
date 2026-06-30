// Permission model — single source of truth for web, desktop, mobile, and API.
//
// The API enforces these rules authoritatively via CASL (see
// packages/api/src/lib/permissions.ts). This module mirrors the same matrix
// with a set-based representation so the front-end (web/desktop/mobile) can
// gate UI affordances without pulling CASL into client bundles.
//
// Parity is guaranteed by a test in packages/api that asserts
// defineAbilityFor(role) here returns the same decisions as the API's CASL
// ability for every (role, action, resource) combination.

export type Action = "create" | "read" | "update" | "delete" | "manage";

export type Resource =
  | "Invoice" | "Payment" | "Party" | "Item" | "Expense"
  | "BankAccount" | "BankTransaction"
  | "Business" | "Team" | "Import" | "Report" | "GstReport"
  | "Store" | "SalesTarget" | "RecurringInvoice"
  | "Account" | "ITC"
  | "BankReconciliation" | "EInvoice" | "EWayBill";

export const ALL_RESOURCES: Resource[] = [
  "Invoice", "Payment", "Party", "Item", "Expense",
  "BankAccount", "BankTransaction",
  "Business", "Team", "Import", "Report", "GstReport",
  "Store", "SalesTarget", "RecurringInvoice",
  "Account", "ITC",
  "BankReconciliation", "EInvoice", "EWayBill",
];

export const ALL_ACTIONS: Action[] = ["create", "read", "update", "delete"];

export type RoleName =
  | "superadmin"
  | "admin"
  | "seller_manager"
  | "seller"
  | "accountant";

export interface Ability {
  can(action: Action, resource: Resource): boolean;
  role: string;
}

// Legacy DB role values still occur in production rows. Normalise to the
// canonical names used by defineAbilityFor.
export function mapDbRole(dbRole: string | null | undefined): RoleName | "" {
  if (!dbRole) return "";
  const mapping: Record<string, RoleName> = {
    owner: "superadmin",
    admin: "admin",
    member: "seller",
    viewer: "accountant",
    superadmin: "superadmin",
    seller_manager: "seller_manager",
    seller: "seller",
    accountant: "accountant",
  };
  return mapping[dbRole] ?? "";
}

function buildGrants(role: string): Set<string> {
  const grants = new Set<string>();
  const grant = (action: Action, resource: Resource) => grants.add(`${action}:${resource}`);
  const manageAll = () => {
    for (const r of ALL_RESOURCES) for (const a of ALL_ACTIONS) grant(a, r);
  };
  const manage = (resource: Resource) => {
    for (const a of ALL_ACTIONS) grant(a, resource);
  };

  switch (role) {
    case "superadmin":
    case "admin":
      manageAll();
      break;

    case "seller_manager":
      grant("create", "Invoice"); grant("read", "Invoice"); grant("update", "Invoice"); grant("delete", "Invoice");
      grant("create", "Party"); grant("read", "Party"); grant("update", "Party");
      grant("create", "Item"); grant("read", "Item"); grant("update", "Item");
      grant("create", "Payment"); grant("read", "Payment"); grant("update", "Payment");
      grant("read", "Expense");
      grant("read", "BankAccount");
      grant("read", "BankTransaction");
      grant("read", "Account");
      grant("read", "Business");
      grant("read", "Report");
      grant("create", "Store"); grant("read", "Store"); grant("update", "Store");
      manage("SalesTarget");
      grant("create", "RecurringInvoice"); grant("read", "RecurringInvoice");
      grant("update", "RecurringInvoice"); grant("delete", "RecurringInvoice");
      break;

    case "seller":
      grant("create", "Invoice"); grant("read", "Invoice"); grant("update", "Invoice");
      grant("create", "Party"); grant("read", "Party");
      grant("read", "Item");
      grant("create", "Payment"); grant("read", "Payment"); grant("update", "Payment");
      grant("read", "Business");
      grant("read", "Store");
      grant("read", "SalesTarget");
      grant("read", "RecurringInvoice");
      break;

    case "accountant":
      grant("create", "Payment"); grant("read", "Payment"); grant("update", "Payment");
      grant("create", "Expense"); grant("read", "Expense"); grant("update", "Expense"); grant("delete", "Expense");
      manage("BankAccount");
      manage("BankTransaction");
      manage("Account");
      manage("ITC");
      manage("BankReconciliation");
      grant("read", "EInvoice");
      grant("read", "EWayBill");
      grant("read", "Report");
      grant("read", "GstReport");
      grant("read", "Invoice");
      grant("read", "Party");
      grant("read", "Item");
      grant("read", "Business");
      grant("read", "Store");
      grant("read", "RecurringInvoice");
      break;

    default:
      // Unknown role → no grants.
      break;
  }

  return grants;
}

export function defineAbilityFor(rawRole: string | null | undefined): Ability {
  const role = mapDbRole(rawRole);
  const grants = buildGrants(role);
  return {
    role,
    can(action, resource) {
      if (action === "manage") {
        // "manage" = the caller has every concrete action on this resource.
        return ALL_ACTIONS.every((a) => grants.has(`${a}:${resource}`));
      }
      return grants.has(`${action}:${resource}`);
    },
  };
}

// ── Time-based edit window ───────────────────────────────────────────────────
// The API enforces a 2-hour window on update/delete of Invoice and Payment for
// seller and seller_manager roles. The UI surfaces this so the action button
// is disabled with an explanation rather than failing at the network layer.

export const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;

const TIME_RESTRICTED_ROLES = new Set<string>(["seller", "seller_manager"]);
const TIME_RESTRICTED_RESOURCES = new Set<Resource>(["Invoice", "Payment"]);

export interface EditWindowInput {
  resource: Resource;
  role: string | null | undefined;
  createdAt: Date | string | number | null | undefined;
  now?: number;
}

export function isWithinEditWindow(input: EditWindowInput): boolean {
  const role = mapDbRole(input.role);
  if (!TIME_RESTRICTED_ROLES.has(role)) return true;
  if (!TIME_RESTRICTED_RESOURCES.has(input.resource)) return true;
  if (input.createdAt == null) return true; // unknown → don't block client-side
  const createdMs = input.createdAt instanceof Date
    ? input.createdAt.getTime()
    : typeof input.createdAt === "number"
      ? input.createdAt
      : Date.parse(input.createdAt);
  if (!Number.isFinite(createdMs)) return true;
  const now = input.now ?? Date.now();
  return now - createdMs < EDIT_WINDOW_MS;
}

export interface EditAffordance {
  allowed: boolean;
  reason?: "no-permission" | "window-expired";
  remainingMs?: number;
}

// Combined helper: ability check + edit-window check. Used by UI to decide
// whether to enable an Edit/Delete button and what tooltip to show.
export function canModify(
  ability: Ability,
  action: "update" | "delete",
  resource: Resource,
  record?: { createdAt?: Date | string | number | null },
  now: number = Date.now(),
): EditAffordance {
  if (!ability.can(action, resource)) {
    return { allowed: false, reason: "no-permission" };
  }
  if (!TIME_RESTRICTED_ROLES.has(ability.role) || !TIME_RESTRICTED_RESOURCES.has(resource)) {
    return { allowed: true };
  }
  if (!record?.createdAt) return { allowed: true };
  const createdMs = record.createdAt instanceof Date
    ? record.createdAt.getTime()
    : typeof record.createdAt === "number"
      ? record.createdAt
      : Date.parse(record.createdAt);
  if (!Number.isFinite(createdMs)) return { allowed: true };
  const elapsed = now - createdMs;
  if (elapsed >= EDIT_WINDOW_MS) {
    return { allowed: false, reason: "window-expired", remainingMs: 0 };
  }
  return { allowed: true, remainingMs: EDIT_WINDOW_MS - elapsed };
}
