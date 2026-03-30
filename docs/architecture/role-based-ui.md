# Role-Based UI Architecture

**Status**: Proposed
**Date**: 2026-03-28
**Author**: Architecture Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision Records](#2-architecture-decision-records)
3. [Role & Permission Model](#3-role--permission-model)
4. [The useRole Hook](#4-the-userole-hook)
5. [Dashboard Architecture](#5-dashboard-architecture)
6. [Web Navigation Filtering](#6-web-navigation-filtering)
7. [Mobile Navigation Filtering](#7-mobile-navigation-filtering)
8. [Permission Checking Patterns](#8-permission-checking-patterns)
9. [API Endpoints by Role](#9-api-endpoints-by-role)
10. [Settings Access by Role](#10-settings-access-by-role)
11. [Implementation Phases](#11-implementation-phases)

---

## 1. Executive Summary

Hisaabo's current UI shows every user the same admin-centric dashboard, full navigation, and all action buttons regardless of their role. A `seller` doing field sales sees bank balances and GST reports they cannot meaningfully act on. An `accountant` sees invoice creation prominently when their job is payment reconciliation. This mismatch increases cognitive load and exposes UI affordances for actions the API will reject.

The goal is for each role to open the app and immediately see what they need to do today — no noise, no denied-action dead ends.

**Key constraints that shaped this design:**

- The `auth.me` tRPC query already returns a `role` field (the raw DB enum: `owner`, `admin`, `seller_manager`, `seller`, `accountant`, `member`, `viewer`). The `mapDbRole` function in `permissions.ts` maps legacy values to the canonical five-role model.
- CASL (`@casl/ability`) is already used server-side. The same permission definitions can be replicated client-side to drive UI visibility without a round-trip.
- The `target.myTargets` and `target.list` tRPC endpoints exist and return progress data — the Seller and Seller Manager dashboards can use them immediately.
- Filtering must fail closed: if the role is unknown (null, empty, network error), the UI defaults to the most restrictive profile (equivalent to `seller`) and shows only what is safe.

---

## 2. Architecture Decision Records

### ADR-001: Per-Role Dashboard Components Instead of One Conditional Dashboard

**Status**: Proposed

**Context**: The current `DashboardPage` in `apps/web/src/routes/index.tsx` is already substantial (~776 lines). Adding `seller`, `seller_manager`, and `accountant` dashboard widgets as conditionals inside the same file would push it past 1,500 lines, create branching render paths that are hard to test in isolation, and couple unrelated data dependencies (e.g., an accountant's bank balance query fires even when the current user is a seller).

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. Mega dashboard with conditionals | One file, no routing changes | 1,500+ line component; all role queries fire for all users; untestable in isolation |
| B. Separate dashboard components, dispatched from index.tsx | Clean isolation; each component owns its queries; easy to test | More files |
| C. Separate routes (`/dashboard/seller`, `/dashboard/admin`) | Maximum isolation | Breaks direct navigation to `/`; changes existing URL contract |

**Decision**: Option B. The `apps/web/src/routes/index.tsx` route becomes a thin dispatcher that reads the role and renders one of four dashboard components. Each component lives in `apps/web/src/components/dashboards/`. The route file stays minimal; all data fetching moves into the role-specific component.

**Consequences**: Index route shrinks to ~30 lines. Each dashboard component is independently testable. Queries are strictly scoped — a seller's dashboard never fires `dashboard.summary` (which requires Report read permission). Adding a future `branch_manager` role means adding one new component without touching existing ones.

---

### ADR-002: Client-Side CASL Ability for UI Visibility (Not Authorization)

**Status**: Proposed

**Context**: The server already uses CASL to authorize every mutation and query. The question is how the client drives visibility of nav items, action buttons, and empty states. Three options exist:

| Option | Pros | Cons |
|--------|------|------|
| A. Role string comparisons (`role === "seller"`) | Simple | Scattered if-chains; breaks when a new role is added |
| B. Replicate CASL `defineAbilityFor` client-side | Consistent with server logic; single source of truth for capability logic | Must keep in sync; CASL bundle (~15 KB gzip) already in the API package |
| C. Server-returns-permissions endpoint (`auth.myPermissions`) | Frontend does not duplicate logic | Extra round-trip; cache invalidation complexity |

**Decision**: Option B. Copy `defineAbilityFor` and `mapDbRole` verbatim into a new `apps/web/src/lib/permissions.ts` (and the mobile equivalent). The `useRole` hook calls `defineAbilityFor(mapDbRole(role))` and exposes both convenience booleans and a `can(action, resource)` function.

CRITICAL: Client-side CASL is for UI visibility only. It must never replace server-side enforcement. The server checks every request independently.

**Consequences**: Client permissions can drift from server if `packages/api/src/lib/permissions.ts` is edited without updating the app copies. Mitigate by adding a comment header that points to the canonical source and by adding a lint check (or a shared package export) in a later phase. For now, the copy is acceptable given the small team size.

---

### ADR-003: Mobile Uses Conditional Tab Rendering, Not Hidden Routes

**Status**: Proposed

**Context**: Expo Router tabs are defined declaratively in `apps/mobile/app/(app)/_layout.tsx`. A `seller` should not see the Payments tab with full access — they can create payments but not view all. An `accountant` should not see a Parties tab that only shows read-only data alongside a "Create Party" button that the API will reject.

Expo Router supports `href: null` to hide a tab from the tab bar while keeping the route accessible via `router.push`. This means hiding a tab does not prevent deep-link access — actual permission enforcement stays on the API.

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. `href: null` per role to hide tabs | Simple, Expo-native pattern | Tab count changes by role which shifts remaining tab positions |
| B. All 5 tabs always visible; role gates content within each screen | Stable tab layout | Accountant sees "Payments" tab but its content behaves differently |
| C. Render a role-specific tab layout component | Maximum flexibility | Complex, fights Expo Router's declarative model |

**Decision**: Option A with a stable tab count. The five tabs (Home, Invoices, Parties, Payments, More) are always present in the tab bar. Role-specific differences are handled inside each screen and the More menu — not by hiding top-level tabs. This avoids tab position shifting, which is disorienting on mobile. The More menu filters its grid by role.

The only exception is the accountant: the Invoices tab shows a read-only list with no "Create" FAB. The Payments tab shows full access. The Parties tab shows read-only. These states are driven by `useRole().can(...)` within each screen.

---

### ADR-004: Settings Access Is Role-Scoped, Not Role-Blocked

**Status**: Proposed

**Context**: The settings page (`apps/web/src/routes/settings.tsx`) renders a nav with tabs: Business, Documents, Appearance, Account, Store, Team, Data. A `seller` has no business for editing business info, but they do need to update their own profile (name, password). Blocking settings entirely would prevent password changes.

**Decision**: The Settings nav (`apps/web/src/components/settings/SettingsNav.tsx`) filters its tab list based on role. `seller` and `accountant` see only: Account (profile), Appearance. `seller_manager` additionally sees Store (if the business has a store). `admin` and `superadmin` see everything. On mobile, the settings screen applies the same filter to its menu items.

---

## 3. Role & Permission Model

The five canonical roles and their read-right summary:

| Capability | admin/superadmin | seller_manager | seller | accountant |
|------------|-----------------|----------------|--------|------------|
| See all business financials | Yes | No | No | Yes (read) |
| Create / edit invoices | Yes | Yes | Own, <2hrs | No |
| Delete invoices | Yes | Unpaid, <2hrs | No | No |
| Manage parties | Yes | create/read/update | create/read | read |
| Manage items | Yes | create/read/update | read | read |
| Record payments | Yes | Yes | Own invoices | Full CRUD |
| View expenses | Yes | read | No | Full CRUD |
| Cash & Bank | Yes | read | No | Full CRUD |
| GST Returns | Yes | read | No | read |
| Sales targets | manage | read own team | read own | No |
| Team management | Yes | No | No | No |
| Settings | Full | Store + Profile | Profile only | Profile only |

The raw DB role returned by `auth.me` maps to canonical roles via `mapDbRole`:

| DB value | Canonical role |
|----------|---------------|
| `owner` | `superadmin` |
| `admin` | `admin` |
| `seller_manager` | `seller_manager` |
| `seller` | `seller` |
| `member` | `seller` (legacy) |
| `accountant` | `accountant` |
| `viewer` | `accountant` (legacy) |

---

## 4. The useRole Hook

### Web: `apps/web/src/hooks/useRole.ts`

```typescript
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { defineAbilityFor, mapDbRole } from "@/lib/permissions";
import type { Action, Resource } from "@/lib/permissions";

export type KnownRole =
  | "superadmin"
  | "admin"
  | "seller_manager"
  | "seller"
  | "accountant";

export function useRole() {
  const { data: session } = trpc.auth.me.useQuery();

  // mapDbRole converts legacy DB values (owner, member, viewer) to canonical roles.
  // Fall back to "seller" (most restrictive) if role is unknown or session is loading.
  const rawRole = session?.role ?? "";
  const canonicalRole = (mapDbRole(rawRole) || "seller") as KnownRole;

  const ability = useMemo(
    () => defineAbilityFor({ userId: session?.user?.id ?? "", role: canonicalRole }),
    [canonicalRole, session?.user?.id],
  );

  return {
    role: canonicalRole,
    isAdmin: canonicalRole === "superadmin" || canonicalRole === "admin",
    isSellerManager: canonicalRole === "seller_manager",
    isSeller: canonicalRole === "seller",
    isAccountant: canonicalRole === "accountant",
    // Convenience: covers both admin roles
    isAdminOrAbove: canonicalRole === "superadmin" || canonicalRole === "admin",
    can: (action: Action, resource: Resource) => ability.can(action, resource),
  };
}
```

The hook depends on `trpc.auth.me` which is already fetched in `RootLayout` and cached — this call hits the React Query cache, it does not fire a new request.

The file `apps/web/src/lib/permissions.ts` is a verbatim copy of `packages/api/src/lib/permissions.ts` with the `TRPCError` import removed (it is never called client-side) and the `requireCan` helper omitted. Add a comment at the top:

```typescript
// IMPORTANT: This file must stay in sync with packages/api/src/lib/permissions.ts.
// Client-side only — drives UI visibility. All API calls enforce permissions independently.
```

### Mobile: `apps/mobile/src/hooks/useRole.ts`

Identical structure, importing from `../../src/lib/trpc` and `../../src/lib/permissions`. The mobile `trpc.auth.me` is already queried in `AppLayout` (`app/(app)/_layout.tsx`) and cached.

```typescript
import { useMemo } from "react";
import { trpc } from "../lib/trpc";
import { defineAbilityFor, mapDbRole } from "../lib/permissions";

// Same implementation as web version — see apps/web/src/hooks/useRole.ts
```

---

## 5. Dashboard Architecture

### 5.1 Web: Dashboard Dispatch

`apps/web/src/routes/index.tsx` becomes a dispatcher. The existing `DashboardPage` function is renamed `AdminDashboard` and moved to `apps/web/src/components/dashboards/AdminDashboard.tsx`.

New `index.tsx` (approximately 30 lines):

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { useRole } from "@/hooks/useRole";
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import { SellerDashboard } from "@/components/dashboards/SellerDashboard";
import { SellerManagerDashboard } from "@/components/dashboards/SellerManagerDashboard";
import { AccountantDashboard } from "@/components/dashboards/AccountantDashboard";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { role } = useRole();

  switch (role) {
    case "seller":        return <SellerDashboard />;
    case "seller_manager": return <SellerManagerDashboard />;
    case "accountant":    return <AccountantDashboard />;
    default:              return <AdminDashboard />;
  }
}
```

### 5.2 AdminDashboard (existing, moved)

File: `apps/web/src/components/dashboards/AdminDashboard.tsx`

Move the entire current `DashboardPage` function and all its helpers (milestone logic, chart components, summary cards, period helpers) here verbatim. No behavior change. The charts and `trpc.dashboard.*` queries remain.

### 5.3 SellerDashboard (new)

File: `apps/web/src/components/dashboards/SellerDashboard.tsx`

Data dependencies (all require `seller` permissions — confirmed against `permissions.ts`):
- `trpc.target.myTargets` — active targets for the current user with progress
- `trpc.invoice.list` filtered by `createdByUserId = currentUser.id`, today's date range
- `trpc.payment.list` filtered by `createdByUserId = currentUser.id`, today's date range

Layout:
1. Page header: "My Dashboard" with a prominent "+ New Invoice" button (link to `/invoices`)
2. My Targets section: one card per active target showing a progress bar, percentage, `onTrack` indicator, and days remaining. If no targets exist, show a subdued empty state ("Your manager will set targets for you").
3. Performance Today: two stat cards — "Invoices Today" (count) and "Sales Today" (sum of `totalAmount`). These are derived by filtering the invoice list to `invoiceDate >= today`.
4. My Recent Invoices: the same invoice list component reused from the admin dashboard but pre-filtered to own invoices.
5. My Collections Today: payment rows recorded today by this user.

The seller cannot see `dashboard.summary` (which requires `Report` read). All queries use `invoice.list` and `payment.list` with user-scoped filters that the API enforces server-side.

### 5.4 SellerManagerDashboard (new)

File: `apps/web/src/components/dashboards/SellerManagerDashboard.tsx`

Data dependencies:
- `trpc.target.list` with `{ active: true, withProgress: true }` — all sellers' targets (seller_manager has `read` on `SalesTarget`)
- `trpc.invoice.list` with today's date range — all invoices (seller_manager has full invoice read)
- `trpc.dashboard.topSellingItems` — reused from admin dashboard (seller_manager has `read` on `Report`)

Layout:
1. Page header: "Team Dashboard" with a "+ New Invoice" button
2. Team Targets: progress bars per seller. Group by `userId`, show seller name alongside each target. Requires cross-referencing `target.list` results with team member names (available from `trpc.team.list` or from the target's `userId`).
3. Team Performance Today: a compact table or card grid — one row per team member showing invoice count and total value for today. Derived by grouping `invoice.list` results by `createdByUserId`.
4. Top Selling Items: reuse the `TopSellingChart` component from `AdminDashboard`.
5. My Recent Invoices: own invoices (filter by current user's ID on the client after fetching).

### 5.5 AccountantDashboard (new)

File: `apps/web/src/components/dashboards/AccountantDashboard.tsx`

Data dependencies:
- `trpc.dashboard.invoiceStatusBreakdown` — to find overdue count and amount (accountant has `read` on `Invoice`)
- `trpc.bankAccount.list` — all bank accounts with balances (accountant has `manage` on `BankAccount`)
- `trpc.expense.list` — recent expenses grouped by category (accountant has full expense access)
- `trpc.gst.filingStatus` or equivalent — GST readiness (accountant has `read` on `GstReport`)
- `trpc.payment.list` — recent payments (accountant has full payment access)

Layout:
1. Page header: "Finance Dashboard" — no "New Invoice" button (accountant cannot create invoices)
2. Payments Due: overdue invoice count and amount (from `invoiceStatusBreakdown`), with a link to `/invoices?status=overdue`
3. Bank Balances: one card per bank account showing current balance
4. Expense Summary: a simple bar or list showing expenses by category for the current month
5. GST Filing Status: upcoming GSTR-1 / GSTR-3B deadlines and whether the current period is ready (based on `gst.filingStatus`)
6. Recent Payments: the last 10 payments recorded, with party name and amount

### 5.6 Mobile Dashboard Dispatch

`apps/mobile/app/(app)/(home)/index.tsx` applies the same dispatch pattern:

```typescript
import { useRole } from "../../../src/hooks/useRole";
import { AdminHomeScreen } from "../../../src/components/dashboards/AdminHomeScreen";
import { SellerHomeScreen } from "../../../src/components/dashboards/SellerHomeScreen";
import { SellerManagerHomeScreen } from "../../../src/components/dashboards/SellerManagerHomeScreen";
import { AccountantHomeScreen } from "../../../src/components/dashboards/AccountantHomeScreen";

export default function DashboardScreen() {
  const { role } = useRole();
  switch (role) {
    case "seller":         return <SellerHomeScreen />;
    case "seller_manager": return <SellerManagerHomeScreen />;
    case "accountant":     return <AccountantHomeScreen />;
    default:               return <AdminHomeScreen />;
  }
}
```

The existing `DashboardScreen` content becomes `AdminHomeScreen`. The mobile role-specific dashboards mirror the web equivalents in content but use React Native components.

---

## 6. Web Navigation Filtering

### 6.1 Current Structure

The sidebar nav is driven by the `navSections` constant in `apps/web/src/routes/__root.tsx` (lines 45-89). Each item has `{ to, label, icon }`. There is no filtering today — every item is always rendered.

### 6.2 Filtered Nav Structure

Extend the nav item type to include an optional `allowedRoles` field:

```typescript
type NavItem = {
  to: string;
  label: string;
  icon: React.FC;
  exact?: boolean;
  allowedRoles?: KnownRole[]; // undefined = visible to all roles
};
```

Add `allowedRoles` to items that should be hidden:

```typescript
const navSections = [
  {
    label: "OVERVIEW",
    items: [
      { to: "/", label: "Dashboard", icon: DashboardIcon, exact: true },
      // visible to all — no allowedRoles
    ],
  },
  {
    label: "SALES",
    items: [
      { to: "/invoices", label: "Invoices", icon: InvoiceIcon },
      { to: "/quotations", label: "Quotations", icon: QuotationIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager"] },
      { to: "/sales-returns", label: "Sales Returns", icon: SalesReturnIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager"] },
      { to: "/credit-notes", label: "Credit Notes", icon: CreditNoteIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager"] },
      { to: "/delivery-challans", label: "Delivery Challans", icon: DeliveryIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager"] },
      { to: "/proforma-invoices", label: "Proforma Invoices", icon: ProformaIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager"] },
    ],
  },
  {
    label: "CONTACTS",
    items: [
      { to: "/parties", label: "Parties", icon: PartyIcon },
      // visible to all — accountant and seller see it read-only, enforced inside the route
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { to: "/items", label: "Items", icon: ItemIcon },
      // visible to all
    ],
  },
  {
    label: "MONEY",
    items: [
      { to: "/payments", label: "Payments", icon: PaymentIcon },
      { to: "/cash-and-bank", label: "Cash & Bank", icon: BankIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager", "accountant"] },
      { to: "/expenses", label: "Expenses", icon: ExpenseIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager", "accountant"] },
    ],
  },
  {
    label: "COMPLIANCE",
    items: [
      { to: "/gst", label: "__REPORTS__", icon: GSTIcon,
        allowedRoles: ["superadmin", "admin", "seller_manager", "accountant"] },
    ],
  },
] as const; // remove "as const" if adding allowedRoles dynamically
```

### 6.3 Filtering in the Render Loop

In `RootLayout`, read the role before rendering the sidebar:

```typescript
const { role } = useRole();

// In the nav render:
const visibleItems = section.items.filter(
  (item) => !item.allowedRoles || item.allowedRoles.includes(role)
);
if (visibleItems.length === 0) return null;
```

This replaces the existing `visibleItems` mapping that only handled the GST label rename. The GST label rename logic remains inside the map, applied after the role filter.

### 6.4 Settings Nav Filtering

`apps/web/src/components/settings/SettingsNav.tsx` renders tab links. Add a role check:

```typescript
const { role } = useRole();

const SETTINGS_TABS = [
  { key: "account",    label: "Account",    roles: null },       // null = all
  { key: "appearance", label: "Appearance", roles: null },
  { key: "business",   label: "Business",   roles: ["superadmin", "admin"] },
  { key: "documents",  label: "Documents",  roles: ["superadmin", "admin"] },
  { key: "store",      label: "Store",      roles: ["superadmin", "admin", "seller_manager"] },
  { key: "team",       label: "Team",       roles: ["superadmin", "admin"] },
  { key: "data",       label: "Data",       roles: ["superadmin", "admin"] },
];

const visibleTabs = SETTINGS_TABS.filter(
  (t) => !t.roles || t.roles.includes(role)
);
```

If a restricted user navigates directly to `/settings/business`, the `BusinessTab` component checks `can("update", "Business")` and renders an unauthorized message rather than an editable form.

### 6.5 Keyboard Shortcuts

The Alt+Shift navigation shortcuts in `RootLayout` (`useHotkeys`) should also be filtered. Wrap each handler with a role check, or register only the shortcuts for the active user's role. The simplest approach:

```typescript
// Only register Cash & Bank and Expenses shortcuts for roles that can see those pages
...(can("read", "BankAccount") ? [
  { key: "b", alt: true, shift: true, handler: () => navigate({ to: "/cash-and-bank" }), ... },
  { key: "e", alt: true, shift: true, handler: () => navigate({ to: "/expenses" }), ... },
] : []),
```

---

## 7. Mobile Navigation Filtering

### 7.1 Tab Bar (unchanged structure)

Per ADR-003, the five tabs remain visible for all roles. Role differences are expressed inside screens. The exception: the `(items)` tab is already `href: null` (hidden, navigated from More) — this stays as-is for all roles.

Seller-specific tab behavior:
- `(invoices)`: shows all invoices the API returns for this user. The seller's invoice list query naturally returns only their invoices (the API filters by `createdByUserId` when the role is `seller`). The Create FAB remains visible — sellers can create invoices.
- `(payments)`: shows payments recorded by this user. Create FAB visible.
- `(parties)`: read + create (no edit/delete UI shown).

Accountant-specific tab behavior:
- `(invoices)`: list visible, no Create FAB rendered (check `can("create", "Invoice")` before rendering `FAB`).
- `(payments)`: full access, Create FAB visible.
- `(parties)`: list visible, no Create FAB.

### 7.2 More Menu Filtering

`apps/mobile/app/(app)/(more)/index.tsx` currently renders `ALL_ITEMS` (10 items) for every user. Filter by role:

```typescript
const { can, role } = useRole();

const ALL_ITEMS: (MenuItem & { visible?: () => boolean })[] = [
  { label: "Items",             icon: "cube-outline",              route: "/(items)" },
  { label: "Expenses",          icon: "receipt-outline",           route: "/(more)/expenses",
    visible: () => can("read", "Expense") },
  { label: "Cash & Bank",       icon: "wallet-outline",            route: "/(more)/bank",
    visible: () => can("read", "BankAccount") },
  { label: "Quotations",        icon: "document-text-outline",     route: "/(more)/quotations",
    visible: () => role !== "seller" && role !== "accountant" },
  { label: "Credit Notes",      icon: "return-down-back-outline",  route: "/(more)/credit-notes",
    visible: () => role !== "seller" && role !== "accountant" },
  { label: "Delivery Challans", icon: "car-outline",               route: "/(more)/delivery-challans",
    visible: () => role !== "seller" && role !== "accountant" },
  { label: "Store Orders",      icon: "storefront-outline",        route: "/(more)/store-orders",
    visible: () => can("read", "Store") },
  { label: "GST Returns",       icon: "pie-chart-outline",         route: "/(more)/gst",
    visible: () => can("read", "GstReport") },
  { label: "Business Reports",  icon: "bar-chart-outline",         route: "/(more)/reports",
    visible: () => can("read", "Report") },
  { label: "Settings",          icon: "settings-outline",          route: "/(more)/settings" },
];

const visibleItems = ALL_ITEMS.filter((i) => !i.visible || i.visible());
```

The `recentRoutes` tracking (SecureStore) must also filter out routes that are no longer visible for the current role when rendering the "Recent" section. Apply the same filter to `recentItems`.

### 7.3 Mobile Settings Filtering

`apps/mobile/app/(app)/(more)/settings/index.tsx` lists settings options. Apply the same role filter as the web: sellers and accountants see only Profile and Appearance. The Team management screen (`settings/team.tsx`) checks `can("manage", "Team")` and redirects or shows an access-denied view if the check fails.

---

## 8. Permission Checking Patterns

### 8.1 Checking Before Rendering Action Buttons

The pattern for action buttons in list pages:

```tsx
// apps/web/src/routes/invoices.tsx
function InvoicesPage() {
  const { can } = useRole();

  return (
    <PageHeader
      title="Invoices"
      actions={
        can("create", "Invoice") ? (
          <Link to="/invoices/new" className="btn-primary">+ New Invoice</Link>
        ) : null
      }
    />
    // ...
  );
}
```

### 8.2 Checking Before Rendering Edit/Delete Controls in a Row

```tsx
function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const { can, isSeller } = useRole();

  // Sellers can only edit own invoices within 2hrs — the time check is server-enforced.
  // Client shows the edit button if the user can conceptually edit invoices.
  const showEdit = can("update", "Invoice");
  const showDelete = can("delete", "Invoice");

  return (
    <tr>
      {/* ... cells ... */}
      <td>
        {showEdit && <EditButton invoiceId={invoice.id} />}
        {showDelete && <DeleteButton invoiceId={invoice.id} />}
      </td>
    </tr>
  );
}
```

If a seller tries to edit an invoice that is >2hrs old, the mutation will fail with a `FORBIDDEN` tRPC error. The UI should catch this and display the error message from the server rather than silently failing.

### 8.3 Checking Read-Only vs Full-Access in a Form

For cases where a role can see but not mutate (e.g., accountant viewing a party):

```tsx
function PartyDetail({ party }: { party: Party }) {
  const { can } = useRole();
  const canEdit = can("update", "Party");

  return (
    <form>
      <input
        value={party.name}
        readOnly={!canEdit}
        className={canEdit ? "" : "cursor-default select-text"}
      />
      {canEdit && <button type="submit">Save</button>}
    </form>
  );
}
```

### 8.4 Handling Access Denials on Direct URL Navigation

A seller who navigates directly to `/cash-and-bank` (e.g., from a bookmark) will reach a route that is not in their sidebar. The route component itself checks:

```tsx
function CashAndBankPage() {
  const { can } = useRole();

  if (!can("read", "BankAccount")) {
    return (
      <EmptyState
        title="Access restricted"
        description="You don't have permission to view this page."
      />
    );
  }
  // ...rest of page
}
```

This is a defense-in-depth measure. The API enforces permissions independently — a direct API call from the browser console would also be rejected.

---

## 9. API Endpoints by Role

This documents which tRPC procedures each role's UI actually calls, to confirm that no UI action will consistently produce `FORBIDDEN` errors.

### superadmin / admin

All procedures available. The admin dashboard calls:
- `dashboard.summary`
- `dashboard.salesTrend`
- `dashboard.invoiceStatusBreakdown`
- `dashboard.topSellingItems`
- `dashboard.topCustomers`
- `invoice.list`, `invoice.create`, `invoice.update`, `invoice.delete`
- `party.*`, `item.*`, `payment.*`, `expense.*`
- `bankAccount.*`, `bankTransaction.*`
- `gst.*`, `target.*`, `team.*`

### seller_manager

Dashboard calls:
- `target.list` with `{ active: true, withProgress: true }` — permitted (`read` on `SalesTarget`)
- `invoice.list` — permitted
- `dashboard.topSellingItems` — permitted (`read` on `Report`)
- Own invoice count for today — derived from `invoice.list` client-side

Feature pages:
- `invoice.create`, `invoice.update`, `invoice.delete` (API enforces <2hrs for delete)
- `party.create`, `party.read`, `party.update`
- `item.create`, `item.read`, `item.update`
- `payment.create`, `payment.read`, `payment.update`
- `expense.list` (read only — no create/delete)
- `bankAccount.list`, `bankTransaction.list` (read only)
- `gst.*` (read only)
- `store.*` (create/read/update)
- `target.list`, `target.getProgress` (read only — create/delete is admin-only)

### seller

Dashboard calls:
- `target.myTargets` — permitted (`viewerProcedure` checks `can("read", "SalesTarget")`)
- `invoice.list` — the API returns only the seller's own invoices
- `payment.list` — the API returns only the seller's own payments

Feature pages:
- `invoice.create`, `invoice.update` (own, <2hrs — API enforces)
- `party.create`, `party.list`
- `item.list` (read only)
- `payment.create`, `payment.list`
- `store.list` (read only)

NOT called: `dashboard.summary`, `expense.*`, `bankAccount.*`, `gst.*`

### accountant

Dashboard calls:
- `dashboard.invoiceStatusBreakdown` — permitted (`read` on `Invoice`)
- `bankAccount.list` — permitted (`manage` on `BankAccount`)
- `expense.list` — permitted
- `payment.list` — permitted

Feature pages:
- `payment.create`, `payment.update`, `payment.delete`
- `expense.create`, `expense.update`, `expense.delete`
- `bankAccount.*`, `bankTransaction.*`
- `invoice.list` (read only — no create button shown)
- `party.list`, `item.list` (read only)
- `gst.*` (read only)

NOT called: `invoice.create`, `invoice.update`, `invoice.delete`, `target.*`, `team.*`

---

## 10. Settings Access by Role

| Settings Tab | admin | seller_manager | seller | accountant |
|--------------|-------|----------------|--------|------------|
| Account (profile, password) | Yes | Yes | Yes | Yes |
| Appearance (theme) | Yes | Yes | Yes | Yes |
| Business (name, GSTIN, address) | Yes | No | No | No |
| Documents (invoice templates, prefix) | Yes | No | No | No |
| Store (store toggle, catalog settings) | Yes | Yes | No | No |
| Team (invite, roles, remove) | Yes | No | No | No |
| Data (import, export, backup) | Yes | No | No | No |

The settings route itself is always accessible. Non-admin users are not told that some tabs exist — the tabs simply do not render. If they navigate to a tab URL directly, the tab component renders an access-denied `EmptyState`.

---

## 11. Implementation Phases

### Phase 1: Foundation (no visible user-facing change)

Goal: Build the shared permission infrastructure that subsequent phases depend on.

1. Create `apps/web/src/lib/permissions.ts` — copy `defineAbilityFor`, `mapDbRole`, `Action`, `Resource` types from `packages/api/src/lib/permissions.ts`. Remove `TRPCError` import and `requireCan`. Add sync comment.
2. Create `apps/mobile/src/lib/permissions.ts` — same copy.
3. Create `apps/web/src/hooks/useRole.ts` as specified in Section 4.
4. Create `apps/mobile/src/hooks/useRole.ts` as specified in Section 4.
5. Verify `trpc.auth.me` returns a `role` field in both apps (confirmed in `auth.ts` line 444 — it does). Note: the role is the raw DB value, `mapDbRole` canonicalizes it.

Acceptance: `useRole()` can be called in any web component and returns the correct canonical role for the logged-in user. No UI changes yet.

### Phase 2: Web Navigation Filtering

Goal: Sellers and accountants stop seeing menu items they cannot use.

1. Extend `NavItem` type with optional `allowedRoles` in `__root.tsx`.
2. Add `allowedRoles` to items per Section 6.2.
3. Add role filter to the `visibleItems` computation in `RootLayout` nav render loop.
4. Add role filter to `SettingsNav.tsx` per Section 6.4.
5. Add role guards to route components that are now hidden from nav but still reachable by URL (Cash & Bank, Expenses, GST for sellers; Invoice create for accountants) per Section 8.4.
6. Filter keyboard shortcuts per Section 6.5.

Acceptance: A seller session shows only Dashboard, Invoices, Parties, Items, Payments in the sidebar. An accountant session shows Dashboard, Invoices, Parties, Items, Payments, Cash & Bank, Expenses, GST Returns.

### Phase 3: Web Dashboard Dispatch

Goal: Each role opens the app and sees data relevant to their job.

1. Move existing `DashboardPage` and all its helpers to `apps/web/src/components/dashboards/AdminDashboard.tsx`. Re-export as named export.
2. Create `SellerDashboard.tsx` per Section 5.3.
3. Create `SellerManagerDashboard.tsx` per Section 5.4.
4. Create `AccountantDashboard.tsx` per Section 5.5.
5. Replace `apps/web/src/routes/index.tsx` with the dispatcher per Section 5.2.

Acceptance: Each role sees the correct dashboard. `trpc.dashboard.summary` is not called for sellers (verify via Network tab — the query should not appear in seller sessions).

### Phase 4: Action Button Gating (Web)

Goal: Remove action buttons that would produce `FORBIDDEN` errors.

1. Invoices page: show "+ New Invoice" button only if `can("create", "Invoice")`.
2. Invoice row: show Edit only if `can("update", "Invoice")`; Delete only if `can("delete", "Invoice")`.
3. Parties page: show "+ New Party" only if `can("create", "Party")`. Hide Edit/Delete for roles with only read access.
4. Items page: show "+ New Item" only if `can("create", "Item")`. Hide Edit for seller (read-only).
5. Payments page: show "+ New Payment" only if `can("create", "Payment")`.
6. Expenses page: show "+ New Expense" only if `can("create", "Expense")`.

Acceptance: An accountant visiting `/invoices` sees a list with no "+ New Invoice" button. A seller visiting `/items` sees a list with no edit controls.

### Phase 5: Mobile Navigation Filtering

Goal: Mobile More menu and tab screen content respect role.

1. Create `apps/mobile/src/hooks/useRole.ts` (already built in Phase 1).
2. Create `apps/mobile/src/lib/permissions.ts` (already built in Phase 1).
3. Filter `ALL_ITEMS` in `MoreScreen` per Section 7.2.
4. Apply role guards to individual screens: remove Create FABs for roles without create permission.
5. Filter `recentItems` in `MoreScreen` to exclude routes no longer visible.

Acceptance: A seller's More menu does not show Expenses, Cash & Bank, GST Returns, or Quotations.

### Phase 6: Mobile Dashboard Dispatch

Goal: Mobile home tab shows role-appropriate content.

1. Move existing `DashboardScreen` to `apps/mobile/src/components/dashboards/AdminHomeScreen.tsx`.
2. Create `SellerHomeScreen.tsx`, `SellerManagerHomeScreen.tsx`, `AccountantHomeScreen.tsx` per Section 5.6.
3. Replace `apps/mobile/app/(app)/(home)/index.tsx` with the dispatcher.

Acceptance: Mobile seller session shows own targets and own invoices, not the business-wide financial overview.

### Phase 7: Settings Filtering (Web + Mobile)

Goal: Sellers and accountants do not see settings tabs that expose business configuration they cannot change.

1. Web: filter `SettingsNav.tsx` tabs per Section 10.
2. Web: add `EmptyState` guard to each restricted settings tab component (BusinessTab, TeamTab, etc.).
3. Mobile: filter settings screen menu per Section 7.3.
4. Mobile: add access guard to `settings/team.tsx`.

Acceptance: A seller navigating to `/settings` sees only Account and Appearance tabs.

---

### What Is Explicitly Out of Scope

- **Server-side changes**: No API changes are required. All permission logic is already implemented in `packages/api/src/lib/permissions.ts` and enforced in each tRPC procedure. This plan is purely a UI concern.
- **Custom role creation**: The permission model is fixed to five roles. If the DB team enum is extended, `permissions.ts` and `mapDbRole` need updating first — UI follows.
- **Per-business role overrides**: The current model is one role per tenant membership. A user who is a `seller` in one business is a `seller` in all businesses under the same tenant. This is a product decision, not a UI architecture concern.
- **Audit logging**: Route guards (Section 8.4) produce user-visible error states, not audit log entries. If access-denied events need to be tracked, that is a separate infrastructure concern.
