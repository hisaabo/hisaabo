/** Human-readable labels for tenant member roles. */
export const roleLabels: Record<string, string> = {
  owner: "Owner",
  superadmin: "Super Admin",
  admin: "Admin",
  seller_manager: "Sales Manager",
  member: "Member",
  seller: "Seller",
  accountant: "Accountant",
};

/** Get a display-friendly label for a role code. */
export function formatRole(role: string): string {
  return roleLabels[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
}

// ── Role-based access control ──────────────────────────────────
//
// Lives here (rather than inside the root route) so that non-React callers —
// the WebMCP runtime, tests, future workers — can gate on the same matrix the
// sidebar uses. Mirrors `defineAbilityFor` in `packages/api/src/lib/permissions.ts`;
// the server remains the enforcer of record, this is only for hiding things
// the user cannot do anyway. The sidebar only consults `read`/`manage`; the
// `create`/`update`/`delete` entries exist so WebMCP write tools are offered to
// exactly the roles the API lets write (seller_manager/seller create parties
// and payments, accountants create payments and expenses).

export const ROLE_ABILITIES: Record<string, Set<string>> = {
  owner: new Set(["*"]),
  admin: new Set(["*"]),
  seller_manager: new Set([
    "Invoice:read", "Invoice:create", "Invoice:update",
    "Party:read", "Party:create", "Party:update",
    "Item:read", "Item:create", "Item:update",
    "Payment:read", "Payment:create", "Payment:update",
    "Store:read", "RecurringInvoice:read", "Business:read",
  ]),
  seller: new Set([
    "Invoice:read", "Invoice:create", "Invoice:update",
    "Party:read", "Party:create", "Item:read",
    "Payment:read", "Payment:create", "Payment:update",
    "Store:read", "Business:read", "RecurringInvoice:read",
  ]),
  accountant: new Set([
    "Payment:read", "Payment:create", "Payment:update",
    "Expense:read", "Expense:create", "Expense:update", "Expense:delete",
    "BankAccount:read", "Invoice:read",
    "Party:read", "Item:read", "Store:read", "RecurringInvoice:read",
    "Report:read", "GstReport:read", "Business:read",
  ]),
};

/**
 * Can `role` perform `action` on `resource`?
 *
 * Returns `true` for a missing or unknown role on purpose: the session query
 * resolves after the first paint, and flashing an empty sidebar is worse than
 * briefly showing a link the API would reject anyway.
 */
export function canAccess(role: string | null | undefined, resource: string, action: string): boolean {
  if (!role) return true; // graceful degradation while loading
  const abilities = ROLE_ABILITIES[role];
  if (!abilities) return true; // unknown role — show all
  if (abilities.has("*")) return true;
  return abilities.has(`${resource}:${action}`);
}
