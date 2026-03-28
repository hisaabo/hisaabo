# Hisaabo Web App — Usability Audit

**Date**: 2026-03-26
**Auditor**: UX Researcher Agent
**Scope**: All route files in `apps/web/src/routes/` and key components in `apps/web/src/components/`
**Target users**: Indian small business owners, shop keepers, accountants — moderate to low tech literacy

---

## Executive Summary

Hisaabo is a well-structured invoicing application with solid foundational UX patterns: toast notifications for every mutation, confirm dialogs on destructive actions, skeleton loading states, and keyboard shortcuts for power users. The core flows are functional. However, several issues create friction for non-technical Indian SMB users — primarily around discoverability of complex features, ambiguous terminology, the party ledger balance sign convention, and mobile/tablet usability.

**Issue count by severity:**
- Critical: 4
- High: 9
- Medium: 11
- Low: 7

---

## 1. Information Architecture

### MEDIUM — Sidebar section label "MONEY" is ambiguous

**Location**: `__root.tsx`, `navSections` array (line 76)

The section labeled "MONEY" contains Payments, Cash & Bank, and Expenses. For Indian SMB users accustomed to accounting terminology, "Accounts" or "Finance" would be more recognisable. "MONEY" is informal and does not signal accounting to a new user scanning the sidebar.

**Recommendation**: Rename "MONEY" to "FINANCE" or "ACCOUNTS". Rename "CONTACTS" to "PARTIES" (matching the Indian accounting convention already used throughout the rest of the app).

---

### MEDIUM — "Parties" terminology not explained on first encounter

**Location**: `parties.tsx` — `EmptyState` (line 207)

The term "party" is accounting jargon. The empty state reads "Add your first customer or supplier to get started" which is helpful context, but the sidebar nav label and page title just say "Parties" with no explanation. A first-time user may not connect "Parties" = "Customers and Suppliers."

**Recommendation**: Add a subtitle or tooltip on the sidebar item: "Parties — Customers & Suppliers". On the page header, change the description from "Manage your customers and suppliers" to something visible without entering the page, such as appending it to the nav item.

---

### LOW — "COMPLIANCE" section contains only one item ("Reports")

**Location**: `__root.tsx`, lines 83–88

A whole nav section for a single link adds visual weight without benefit. For non-GST businesses, this link shows as "Reports", which could be merged into the OVERVIEW or FINANCE section.

**Recommendation**: Consider merging "Reports" into the OVERVIEW section, or removing the section header and placing it near the bottom of the FINANCE group.

---

### LOW — Settings is reachable only via the bottom sidebar link; no breadcrumb

**Location**: `__root.tsx`, `settings.tsx`

Settings is at the bottom of the sidebar outside the main nav sections, which is standard. However, Settings contains seven sub-tabs (Business, Documents, Team, Appearance, Data, Account, Online Store) and there is no persistent breadcrumb or page-level indication of which tab is active when arriving via a deep link. The URL does not encode the active settings tab, so refreshing always returns to "Business."

**Recommendation**: Encode the active settings tab in the URL query param (e.g., `/settings?tab=team`) so users can share links to specific settings sections and so refresh preserves position.

---

## 2. Task Flows

### CRITICAL — Invoice creation: party selector only shows first 100 records

**Location**: `DocumentCreator.tsx`, line 119–123

```tsx
const { data: partiesData } = trpc.party.list.useQuery({
  type: invoiceType === "sale" ? "customer" : "supplier",
  page: 1,
  limit: 100,
});
```

The party combobox in the invoice creator loads at most 100 parties. A business with more than 100 customers will silently not find some customers in the invoice creator. The combobox does client-side filtering on the loaded set only — there is no server-side search. This is a data integrity risk: a user may select the wrong party or give up.

**Recommendation**: Replace the static 100-record load with a server-side search-as-you-type combobox. Debounce input and query `trpc.party.search` (or add a search param to `party.list`). This is the same approach used in `RecordPaymentPanel.tsx` where parties are also capped at 100. Both need fixing.

---

### CRITICAL — Item selector in invoice creator uses a `<select>` limited to 100 items

**Location**: `DocumentCreator.tsx`, line 125 and lines 463–472

```tsx
const { data: itemsData } = trpc.item.list.useQuery({ page: 1, limit: 100 });
```

The line-item product selector is a plain HTML `<select>` with a limit of 100 items. For a business with 200+ SKUs:
1. Items beyond the first 100 are invisible.
2. A plain `<select>` on mobile has a platform OS picker that is difficult to search.
3. No visual indication that the list may be incomplete.

**Recommendation**: Replace the `<select>` with the `Combobox` component (already exists in the UI library). Add server-side search. This is the most-used field in the most-used flow — it must be reliable regardless of catalog size.

---

### HIGH — RecordPaymentPanel: the multi-invoice allocation workflow is not discoverable

**Location**: `RecordPaymentPanel.tsx`, lines 410–584

The payment panel works well once discovered, but the entry point is opaque:
- From the invoice list, the "Record Payment" action button is **only visible on hover** (inside `group-hover:opacity-100`), meaning touch users and keyboard users cannot access it without hovering first.
- From the invoice detail panel, "Record Payment" is a clearly labeled button — this is the better entry point.
- The payments page has a "+ Record Payment" button that requires the user to select the party first, then the invoices load. This two-step approach works but is not obvious; the label "Unpaid Invoices" appears only after party selection with no hint before selecting a party.

**Recommendation**:
1. Make the "Record Payment" row action always visible (not hover-only), or use a visible button/icon in the row rather than opacity-0.
2. Add a hint text below the party selector in RecordPaymentPanel: "After selecting a party, you'll see their outstanding invoices."

---

### HIGH — Item variant/alt-unit mode is derived invisibly

**Location**: `items.tsx`, lines 620–624

```tsx
const derivedMode: ItemMode = itemType === "service" ? "simple"
  : variantAttributes.length > 0 ? "variants"
  : unitVariants.some((v) => v.unit && v.salePrice) ? "alt_units"
  : "simple";
```

The item creation form uses implicit mode derivation — the user never selects "Simple / Alt Units / Variants" explicitly. Adding a unit variant changes the mode to `alt_units`; adding attributes changes it to `variants`. This is clever but:
- The user never sees a mode selector; they discover the behavior by expanding the "Alternate Units" or "Product Variants" disclosures.
- The `ALT`, `VAR`, `SVC` badges on the items list use technical abbreviations a shop owner may not recognise.
- There is no explanation of what alt-units or variants mean in context.

**Recommendation**:
1. Add a visible mode indicator in the add/edit form: "This item will be saved as: Simple / Alt-Unit / Variant" that updates reactively as the user fills in fields.
2. In the items list, replace `ALT` / `VAR` badges with plain-text tooltips: "Multiple selling units" and "Has variants (size, color, etc.)".
3. Add a short one-line description inside each Disclosure section explaining what it does.

---

### HIGH — Party ledger: balance sign convention is confusing

**Location**: `parties.tsx`, lines 436–438

```tsx
isPositiveBalance ? "text-red-600" : balanceNum < 0 ? "text-emerald-600" : "text-text-primary"
```

A **positive balance is shown in red**. For a customer, a positive balance means they owe money (you are owed), which should be highlighted as a receivable — red implies danger/loss. For a supplier, it would mean you owe them. Without a label indicating direction (receivable vs payable), many non-accountant users will interpret "red = bad = I'm losing money" rather than "red = customer owes me."

**Recommendation**:
1. Add explicit labels: "Receivable" (green or neutral) and "Payable" (amber) next to the balance amount in the party detail panel.
2. Alternatively, show balance as "₹X receivable" / "₹X payable" rather than relying purely on color and sign.
3. On the parties list, the "Balance" column header should clarify: "Balance (+ = receivable)".

---

### HIGH — Quotation and document pages have no date range filter or search

**Location**: `quotations.tsx`, `credit-notes.tsx`, `delivery-challans.tsx`, `proforma-invoices.tsx`, `sales-returns.tsx`

These pages use a simple `trpc.quotation.list.useQuery({ page: 1, limit: 50 })` — no search, no date range, no infinite scroll. A business with 200 quotations will see only the first 50 with no way to find older ones.

**Recommendation**: Apply the same DateRangeBar + SearchInput + infinite scroll pattern used on Invoices and Payments. At minimum add a search input and increase the limit or add pagination.

---

### MEDIUM — Invoice list: "Unfulfilled" status tab is unclear

**Location**: `invoices.tsx`, line 32

```tsx
{ value: "unfulfilled", label: "Unfulfilled" },
```

"Unfulfilled" is an internal status for invoices where goods/services haven't been delivered yet. For a small shop owner, the word "unfulfilled" is technical. The status badge on the row shows "Unfulfilled" but the user who created the invoice as a delivery order may not map this to their mental model.

**Recommendation**: Rename to "Pending Delivery" or "To Deliver" with an appropriate icon. Update the "Mark Fulfilled" button label to "Mark as Delivered" for clarity.

---

### MEDIUM — Ledger in party detail panel: "load more" is missing

**Location**: `parties.tsx`, line 344–346

```tsx
const { data: ledger } = trpc.party.ledger.useQuery(
  { partyId, page: 1, limit: 30 },
  ...
);
```

The ledger is capped at 30 entries. A note appears ("Showing X of Y") but there is no "Load more" button or pagination. A user auditing a party's full transaction history cannot see beyond 30 entries from this panel.

**Recommendation**: Add pagination or "Load more" to the full ledger tab. The overview tab's preview correctly links to the ledger tab ("View all"), so the full ledger tab is the right place for pagination.

---

### MEDIUM — Clicking a ledger document number navigates away without preserving state

**Location**: `parties.tsx`, lines 607–614

```tsx
onClick={() => {
  onClose();
  navigate({ to: row.type === "payment" ? "/payments" : "/invoices" });
}}
```

Clicking a document number in the party ledger closes the party panel and navigates to the Invoices or Payments page — but does NOT select or highlight the specific document. The user lands on the list with no way to find which specific invoice was linked. The equivalent in `invoices.tsx` line 393–395 does pass `{ search: { selected: pmt.id } }` for payments, so the pattern exists but is not used for invoice navigation from ledger.

**Recommendation**: Pass a `selected` search param when navigating: `navigate({ to: "/invoices", search: { selected: row.documentId } })` so the invoice detail panel opens automatically.

---

## 3. Error Prevention

### HIGH — Delete action on items does not show item name in confirmation

**Location**: `items.tsx`, lines 457–468

```tsx
<ConfirmDialog
  title="Delete item?"
  description="This action cannot be undone."
  ...
/>
```

The confirm dialog for deleting an item does not include the item name. The delete button on a row triggers `setDeleteId(item.id)` but the item name is not stored. Compare this to invoice deletion (line 803): `description={`Delete invoice ${deleteNumber}? This action cannot be undone.`}` — invoices include the number. A user who accidentally clicks delete on the wrong row has no confirmation that they are deleting the right item.

**Recommendation**: Store the item name alongside the deleteId state and include it in the confirm dialog: "Delete item 'Steel Bolt M6'? This action cannot be undone."

---

### HIGH — No duplicate invoice prevention

**Location**: `DocumentCreator.tsx`, `handleSubmit` (lines 327–383)

There is no check for potential duplicate invoices (same party, same date, same approximate amount). An accidental double-click on "Create Invoice" while the mutation is pending could theoretically submit twice; however, the `disabled={activeMutation.isPending}` on the button prevents most double-submissions. The deeper issue is there is no server-side or client-side warning when creating an invoice that appears identical to a recent one.

**Recommendation**: The `disabled` state handles most double-click scenarios. Additionally, consider showing a soft warning (not a blocker) if an invoice with the same party, same date, and same total already exists: "A similar invoice (INV-2024-0042) was created today for this party. Continue?"

---

### MEDIUM — Invoice edit is not blocked for paid invoices on the row action, only in the detail panel

**Location**: `invoices.tsx`, lines 185–188 vs. the table row edit flow

In the invoice detail panel footer, the Edit button is only shown when `invoice.status !== "paid"`. However, the edit flow is triggered from both the detail panel and via `setEditInvoice` from the detail panel — there is no edit button visible on the row itself. This is actually fine as currently coded. However, the `updateMutation` in `DocumentCreator` has no guard against editing a paid invoice if the `editInvoiceId` is somehow passed directly.

**Recommendation**: Add a server-side guard (likely already present in the API router, but confirm) and a client-side check in `DocumentCreator.handleSubmit` to reject edits on paid/cancelled invoices.

---

### MEDIUM — Expenses form: category is a free-text field with no validation

**Location**: `expenses.tsx`, lines 51–67

The expense form has a free-text `category` field. This allows unlimited variations: "Food", "food", "FOOD", "Foood". Over time, the category filter on the expenses list becomes polluted with near-duplicate categories.

**Recommendation**: Convert `category` to a combobox that suggests previously used categories (fetched from a distinct-values API call) while still allowing free entry for new categories. This keeps data consistent without being restrictive.

---

### LOW — Round-off field in invoice creator has no reasonable bounds

**Location**: `DocumentCreator.tsx`, lines 735–743

The "Round Off" input is a free number with no min/max bounds. A user could accidentally enter a large number and dramatically change the invoice total without noticing.

**Recommendation**: Cap round-off between -1.00 and 1.00 (standard Indian accounting convention) and add a `max="1"` `min="-1"` to the input. Show a warning if the user enters a value outside this range.

---

## 4. Feedback and Status

### MEDIUM — Loading state missing when switching between party detail tabs

**Location**: `parties.tsx`, lines 342–357

The `PartyDetailPanel` fetches ledger, invoice list, and top-items data conditionally based on `tab`. When switching to a new tab, there is no skeleton or spinner shown while the data loads. The tab content area is simply empty or shows the EmptyState until data arrives, which can be mistaken for genuinely empty data.

**Recommendation**: Add a tab-level loading skeleton: a short `isLoading` flag for each query, and render skeleton rows while loading instead of jumping to EmptyState.

---

### MEDIUM — Toast duration is not defined; success toasts may disappear too fast

**Location**: `Toast.tsx`

The `ToastContainer` renders toasts with `animate-toast-in` but no auto-dismiss timer is visible in the component. Checking the hook would confirm, but if the auto-dismiss is short (2–3 seconds), users performing bulk operations will miss confirmations. The error toast with a description (two-line) needs more time than a simple success.

**Recommendation**: Ensure success toasts show for at least 3 seconds and error toasts show for 5+ seconds or require manual dismissal. Verify the `useToast` hook's `duration` configuration.

---

### LOW — The "Mark Sent" / "Mark Fulfilled" action in the invoice row is an icon-only button

**Location**: `invoices.tsx`, lines 730–742

The send icon button (a paper-plane icon) in the invoice row action area has `title="Mark as sent"` for tooltip, but no visible label. On mobile or for users who don't hover, the action is invisible (`opacity-0 group-hover:opacity-100`).

**Recommendation**: Make the three key row actions (Mark Sent, Record Payment, Delete) always visible or accessible via a visible "..." overflow menu on mobile.

---

### LOW — Dashboard overdue alert shows total amount but links only to the general invoices list

**Location**: `index.tsx`, lines 622–638

The overdue alert banner correctly shows count and total but the "View →" link navigates to `/invoices` without pre-applying the "Overdue" filter tab.

**Recommendation**: Change the link to navigate with the overdue filter pre-applied: `navigate({ to: "/invoices", search: { status: "overdue" } })`. This requires the invoices route to read the filter from search params on mount.

---

## 5. Accessibility

### CRITICAL — DocumentCreator line-item inputs have no accessible labels

**Location**: `DocumentCreator.tsx`, lines 519–569

```tsx
<label className="text-[10px] font-medium text-text-tertiary block mb-0.5">Qty</label>
<input type="number" value={li.quantity} ... />
```

These `<label>` elements are not associated with their inputs via `htmlFor`/`id`. A screen reader user cannot determine which label belongs to which input. This affects every line item row for every invoice, quotation, and other document creation.

**Recommendation**: Use `useId()` to generate unique IDs for each line item's inputs and associate them with labels via `htmlFor`. Alternatively, use the existing `InputField` component which handles this via `FormField`. The fix is systematic but straightforward.

---

### CRITICAL — SlideOver does not auto-focus on open; focus trap may miss initial focus

**Location**: `SlideOver.tsx`, `useFocusTrap.ts`

The `useFocusTrap` hook (lines 18–23) only auto-focuses elements with `[autofocus]` or `[data-autofocus]`. The SlideOver component renders without any `autofocus` element by default. This means:
1. When a SlideOver opens, keyboard focus remains on the element that triggered it (behind the backdrop).
2. A keyboard user pressing Tab will cycle through elements behind the backdrop before Tab cycling enters the SlideOver.
3. The focus trap correctly wraps Tab within the SlideOver once focus is inside — but getting focus inside initially requires a click or explicit autofocus attribute.

**Recommendation**: In `useFocusTrap`, change the behavior so that when no `[autofocus]` element exists, the first focusable element in the container receives focus. This is standard ARIA dialog behavior. Alternatively, add `data-autofocus` to the Close button in SlideOver so focus at least lands inside the dialog immediately.

---

### HIGH — TenantPicker modal has no focus trap

**Location**: `__root.tsx`, lines 107–148

The `TenantPicker` component renders as a fixed overlay but does not use `useFocusTrap` or any focus management. When it appears (for users with multiple tenants), focus remains on whatever was previously focused — the user can Tab through content behind the overlay.

**Recommendation**: Wrap TenantPicker in the existing `Modal` component which already includes `useFocusTrap`, or add `useFocusTrap` directly to the TenantPicker container.

---

### HIGH — Inline `<select>` for product in DocumentCreator has no accessible label

**Location**: `DocumentCreator.tsx`, lines 463–472

```tsx
<select
  value={li.itemId || ""}
  onChange={(e) => selectProduct(li.id, e.target.value)}
  className="input py-1.5 text-sm"
>
  <option value="">Select product or custom item</option>
```

This `<select>` has no `<label>` element and no `aria-label`. Screen readers will announce it as an unlabeled form control. The same issue applies to the unit variant `<select>` on lines 475–493.

**Recommendation**: Add `aria-label="Product"` (and `aria-label="Unit"` for the unit selector) to these selects, or wrap them in a `<label>` element.

---

### MEDIUM — Color alone distinguishes balance direction in party panel

**Location**: `parties.tsx`, lines 433–443

The balance value uses color alone to convey direction (red for positive/receivable, green for negative/payable). Users with red-green color blindness (approximately 8% of males) cannot distinguish the two states.

**Recommendation**: Supplement color with a text indicator: show "↑ Receivable" or "↓ Payable" alongside the amount, or prefix with a directional arrow icon.

---

### MEDIUM — Status badges use color alone without text-based differentiation in the bar charts

**Location**: `index.tsx`, lines 90–96

Dashboard chart legend colors are hardcoded as hex values. The donut chart on the dashboard (InvoiceStatusChart) maps statuses to colors. Users with color vision deficiencies may not be able to distinguish "Partial" (amber) from "Overdue" (red) at a glance.

**Recommendation**: Add data labels or percentage labels directly on the donut chart segments for the two most critical statuses (Overdue, Partial).

---

## 6. Mobile and Responsive Design

### HIGH — Sidebar is always shown; no mobile hamburger menu

**Location**: `__root.tsx`, lines 346–425

The layout is `flex h-screen` with a fixed `w-56` sidebar. On tablet-sized screens (768px–1024px), the sidebar takes up 224px leaving insufficient space for the main content. On mobile (< 768px), the layout is unusable — both sidebar and content are squeezed into the viewport.

The SettingsNav does implement a mobile fallback (horizontal scrollable tabs below `md:`), but the main sidebar has no responsive breakpoint behavior.

**Recommendation**:
1. Add a hamburger toggle below `md:` breakpoint to collapse the sidebar to a drawer.
2. On tablet, consider a collapsed icon-only sidebar (56px) that expands on hover or click.
3. This is the single most impactful mobile fix.

---

### MEDIUM — Invoice creator SlideOver is `max-w-3xl` (768px) — on mobile it takes the full screen with no scroll optimisation

**Location**: `SlideOver.tsx`, line 50

```tsx
className="fixed right-0 top-0 bottom-0 w-full max-w-3xl flex flex-col animate-slide-in shadow-modal bg-surface-0"
```

On desktop this is fine. On a phone, `w-full` means the SlideOver covers the full screen, which is acceptable, but the 3-column grid for line items (`grid-cols-4`) will overflow on narrow screens.

**Recommendation**: Add responsive grid breakpoints to the line-item grid in `DocumentCreator.tsx`: change `grid grid-cols-4` to `grid grid-cols-2 sm:grid-cols-4` for the numeric fields.

---

### MEDIUM — Touch targets in invoice row actions are 28px (p-1.5 + 16px icon)

**Location**: `invoices.tsx`, lines 721–776

Row action buttons use `p-1.5 rounded-lg` around a `w-4 h-4` icon, resulting in a 28px touch target. Apple HIG and Android guidelines require minimum 44px touch targets for reliable tapping on mobile.

**Recommendation**: Increase action button padding to at least `p-2.5` which gives a ~37px target, or use `p-3` for 40px. Since these buttons are hidden on hover, a better alternative is a dedicated action column with a "..." overflow menu for mobile.

---

### LOW — Export CSV dropdown uses `group-hover:block` — not touch-accessible

**Location**: `items.tsx`, lines 322–326

The export CSV dropdown in the Items page uses CSS hover to reveal sub-options (`hidden group-hover:block`). Touch devices do not fire hover events. A user on a tablet cannot access "Simple Items", "Alt Unit Items", or "Variant Items" export options.

**Recommendation**: Replace the hover-reveal dropdown with a proper dropdown button that toggles on click/tap, using a `useState` boolean and a click-outside handler.

---

## 7. Cognitive Load

### MEDIUM — Dashboard shows 8 summary cards plus 2 profit cards plus 4 charts — too much at once

**Location**: `index.tsx`, `DashboardPage` (lines 582–648)

The dashboard renders:
- 6 summary cards (Sales, Purchases, Receivable, Payable, Cash Position, Expenses)
- 2 profit cards (Gross Profit, Net Profit)
- 1 overdue alert (contextual)
- 4 charts (Sales Trend, Invoice Status, Top Selling, Top Customers)

That is 12+ data elements before scrolling. For a shop owner checking their daily status, the most important information is: How much did I sell? Who owes me money? — buried in the middle of a busy grid.

**Recommendation**:
1. Promote the two most actionable metrics (Receivable and Overdue count) to a persistent status bar at the top.
2. Collapse the 6 summary cards + 2 profit cards into a single scrollable row with the most important items (Receivable, Sales) first.
3. Make charts collapsible or lazy-loaded so the page feels less dense on first view.

---

### MEDIUM — Settings page has 7 tabs including "Online Store" which may not be relevant to most users

**Location**: `settings.tsx`, `SettingsNav`

The Settings nav shows: Business, Documents, Team, Appearance, Data, Account, Online Store. "Online Store" is a premium/advanced feature. For a basic user setting up the app, this tab adds cognitive load and may raise questions ("Do I need a store?").

**Recommendation**: Move "Online Store" to the bottom of the settings nav, visually separated from core settings. Add a badge (e.g., "Pro" or "Optional") if it requires a paid plan, so users immediately understand its scope.

---

### MEDIUM — The "Merge" action in the party detail footer is a destructive operation in a non-obvious location

**Location**: `parties.tsx`, lines 376–383

The party detail SlideOver footer has only one button: "Merge". This is a heavy, irreversible operation (it deletes the source party and reassigns all its data). Having it as the sole footer action implies it is the primary action for the party detail view, which is misleading. The typical primary actions (edit party, record payment, create invoice for this party) are absent from the detail panel footer.

**Recommendation**:
1. Move "Merge" out of the primary footer to an overflow menu ("..." menu) or an "Advanced" section inside the panel.
2. Add primary actions to the footer: "Edit" and "Record Payment" for the selected party.

---

### LOW — The "Alternate Units" disclosure in item creation requires understanding conversion factor semantics

**Location**: `items.tsx`, lines 821–891

The "Alternate Units" section shows inputs for "Unit", a label that reads `Per {unit}` (e.g., "Per kg"), and "Sale Price". The label "Per kg" is meant to capture how many base units are in this alt unit (e.g., 1 bag = 5 kg, so conversion factor = 5). This is not intuitive — the label does not explain the direction of conversion.

**Recommendation**: Add an inline example as placeholder text: "e.g. 1 bag = 5 kg → enter 5 here". Use a sentence like "1 [alt unit] = [factor] [base unit]" to make the semantics explicit.

---

### LOW — Command palette only contains navigation commands

**Location**: `CommandPalette.tsx`, lines 28–39

The command palette (Ctrl+K) only navigates to pages. It does not support "New Invoice", "Add Party", or other action commands. Power users who expect to trigger actions from the palette will be disappointed.

**Recommendation**: Add action commands: "New Invoice", "Record Payment", "Add Party", "Add Item". These can dispatch to the same handlers used by the + buttons on each page.

---

## Summary Table

| # | Area | Issue | Severity |
|---|------|-------|----------|
| 1 | Task Flow | Party/item selector capped at 100 records in DocumentCreator | Critical |
| 2 | Task Flow | Item selector is a plain `<select>` limited to 100 items | Critical |
| 3 | Accessibility | Line-item inputs have no associated labels in DocumentCreator | Critical |
| 4 | Accessibility | SlideOver does not move focus inside on open | Critical |
| 5 | Task Flow | Record Payment row action is hover-only; not touch accessible | High |
| 6 | Task Flow | Variant/alt-unit mode is derived silently with no user feedback | High |
| 7 | Task Flow | Party ledger balance sign convention is confusing | High |
| 8 | Task Flow | Quotation/document pages lack search and date range | High |
| 9 | Error Prevention | Item delete confirm dialog omits item name | High |
| 10 | Error Prevention | No duplicate invoice warning | High |
| 11 | Accessibility | TenantPicker has no focus trap | High |
| 12 | Accessibility | Product `<select>` in DocumentCreator has no label | High |
| 13 | Mobile | Sidebar has no mobile/tablet responsive behavior | High |
| 14 | Information Architecture | Sidebar "MONEY" label is ambiguous | Medium |
| 15 | Information Architecture | "Parties" not explained for new users | Medium |
| 16 | Task Flow | "Unfulfilled" status label is technical/unclear | Medium |
| 17 | Task Flow | Ledger load-more missing (capped at 30) | Medium |
| 18 | Task Flow | Ledger document link navigates without selecting the document | Medium |
| 19 | Error Prevention | Invoice edit not guarded for paid invoices at client level | Medium |
| 20 | Error Prevention | Expense category is free text, no suggestions | Medium |
| 21 | Feedback | Party detail tab content shows empty state while loading | Medium |
| 22 | Feedback | Toast duration not confirmed; may be too short for errors | Medium |
| 23 | Accessibility | Balance direction communicated by color only | Medium |
| 24 | Accessibility | Dashboard chart legend uses color only | Medium |
| 25 | Mobile | Line item grid overflows on narrow screens | Medium |
| 26 | Mobile | Touch targets on row actions are ~28px (below 44px minimum) | Medium |
| 27 | Cognitive Load | Dashboard shows 12+ data elements before scroll | Medium |
| 28 | Cognitive Load | Settings "Online Store" tab raises confusion for new users | Medium |
| 29 | Cognitive Load | "Merge" is the only footer action in party detail | Medium |
| 30 | Information Architecture | "COMPLIANCE" section for single item adds visual noise | Low |
| 31 | Information Architecture | Settings tab not encoded in URL | Low |
| 32 | Feedback | "Mark Sent" is icon-only in invoice row | Low |
| 33 | Feedback | Overdue alert link doesn't pre-filter invoices list | Low |
| 34 | Mobile | Export CSV dropdown is hover-only (not touch accessible) | Low |
| 35 | Cognitive Load | Alt-unit conversion factor label unclear | Low |
| 36 | Cognitive Load | Command palette only navigates, no actions | Low |
| 37 | Error Prevention | Round-off field has no reasonable bounds | Low |

---

## Recommended Prioritisation

### Immediate (before first external user)

1. **Party/item selector server-side search** (Critical) — data integrity risk in primary flow
2. **Associate line-item labels with inputs** (Critical) — basic accessibility and legal compliance
3. **SlideOver focus management** (Critical) — keyboard users cannot use the app
4. **TenantPicker focus trap** (High) — keyboard users cannot select their tenant

### Sprint 1 (first month)

5. Party ledger balance sign clarification with text labels
6. Record Payment row action always visible
7. Delete confirm dialogs include entity name everywhere
8. Quotations/document pages gain search + date range
9. Mobile sidebar hamburger drawer

### Sprint 2

10. Item creation mode indicator (visible derived mode label)
11. Alt-unit conversion factor explanation text
12. Dashboard metric prioritisation (receivable + overdue prominent)
13. Ledger document click passes selected ID to destination page
14. Touch target sizes increased on row actions

---

*Research basis: Static code audit of all route and component files. User testing with representative Indian SMB users recommended to validate severity rankings and discover any additional friction not visible from code alone.*
