import type { Action, Resource } from "@hisaabo/shared";

export type RoutePermission = { action: Action; resource: Resource };

type NavLike = { to: string; resource: Resource; action: Action };

// The POS register is not in the sidebar but creates invoices.
const EXTRA_ROUTES: Array<{ to: string } & RoutePermission> = [
  { to: "/pos", action: "create", resource: "Invoice" },
];

/**
 * Permission required to view `pathname`, derived from the sidebar nav config
 * so route access and nav visibility cannot drift. Returns null for routes
 * with no permission requirement (settings, auth pages, unknown paths).
 */
export function findRoutePermission(pathname: string, navItems: NavLike[]): RoutePermission | null {
  const candidates = [...navItems, ...EXTRA_ROUTES];
  for (const item of candidates) {
    const matches =
      item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(item.to + "/");
    if (matches) return { action: item.action, resource: item.resource };
  }
  return null;
}

type VisibleNavLike = NavLike & { label: string; gstOnly?: boolean };

/**
 * Nav items a user can see: role-permitted, GST-only entries hidden for
 * unregistered businesses, and the compliance/report labels adjusted. Shared by
 * the sidebar and the command palette so the two cannot drift.
 */
export function getVisibleNavItems<T extends VisibleNavLike>(
  items: T[],
  canAccess: (resource: Resource, action: Action) => boolean,
  isGstRegistered: boolean,
): T[] {
  return items
    .filter((item) => canAccess(item.resource, item.action) && (!item.gstOnly || isGstRegistered))
    .map((item) => {
      if (item.to === "/gst") {
        return { ...item, label: isGstRegistered ? "GST Returns" : "Tax Reports" };
      }
      if (item.to === "/reports") {
        return { ...item, label: "Business Reports" };
      }
      return item;
    });
}
