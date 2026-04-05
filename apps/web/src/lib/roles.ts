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
