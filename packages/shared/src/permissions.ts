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

// ── Record-level rules beyond the role matrix ────────────────────────────────
// The API enforces exactly one rule on top of CASL
// (packages/api/src/routers/invoice.ts → `delete`): a seller_manager may delete
// an invoice only if it is not paid AND was created no more than 2 hours ago.
// Edits (`update`) carry no time limit for any role. canModify mirrors that so
// the UI hides the Delete action instead of letting it fail at the network.

export const INVOICE_DELETE_WINDOW_MS = 2 * 60 * 60 * 1000;

// Normalise a createdAt value to epoch ms. Returns null when the value is
// missing or unparseable — callers treat that as "unknown, don't block"
// because the API remains the authority.
function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export interface ModifyAffordance {
  allowed: boolean;
  reason?: "no-permission" | "invoice-paid" | "window-expired";
}

export interface ModifiableRecord {
  createdAt?: Date | string | number | null;
  status?: string | null;
}

// Role permission + the record-level rule above, for a specific record.
export function canModify(
  ability: Ability,
  action: "update" | "delete",
  resource: Resource,
  record?: ModifiableRecord,
  now: number = Date.now(),
): ModifyAffordance {
  if (!ability.can(action, resource)) {
    return { allowed: false, reason: "no-permission" };
  }
  if (ability.role !== "seller_manager" || action !== "delete" || resource !== "Invoice") {
    return { allowed: true };
  }
  if (record?.status === "paid") {
    return { allowed: false, reason: "invoice-paid" };
  }
  const createdMs = toEpochMs(record?.createdAt);
  if (createdMs == null) return { allowed: true };
  // Server rejects when createdAt < now - window, so exactly-at-window is allowed.
  if (now - createdMs > INVOICE_DELETE_WINDOW_MS) {
    return { allowed: false, reason: "window-expired" };
  }
  return { allowed: true };
}

const DELETE_DENIED_MESSAGES: Record<NonNullable<ModifyAffordance["reason"]>, string> = {
  "no-permission": "You do not have permission to delete this document",
  "invoice-paid": "Cannot delete paid invoices",
  "window-expired": "Can only delete invoices within 2 hours of creation",
};

// Single source of truth for the invoice-like delete rule, used by the invoice
// router and the document router factory. Pure: callers throw on !allowed.
export function checkInvoiceDeleteAllowed(
  role: string | null | undefined,
  record: ModifiableRecord,
  now: number = Date.now(),
): { allowed: true } | { allowed: false; reason: NonNullable<ModifyAffordance["reason"]>; message: string } {
  const verdict = canModify(defineAbilityFor(role), "delete", "Invoice", record, now);
  if (verdict.allowed) return { allowed: true };
  const reason = verdict.reason ?? "no-permission";
  return { allowed: false, reason, message: DELETE_DENIED_MESSAGES[reason] };
}
