# Testing Architecture Plan — Hisaabo Monorepo

**Date:** 2026-03-26
**Scope:** Three parallel test suites (API, Web, Mobile) plus CI integration

---

## 1. Overview and Priorities

Testing resources are not infinite. The priority ordering below reflects actual risk, not alphabetical order.

**Priority 1 — API integration tests.** The API is the security boundary. Every CASL role, every cross-business query, every monetary calculation that touches the database must be verified against a real PostgreSQL instance. A wrong assertion here means real money or real data leaks.

**Priority 2 — `packages/shared` unit tests.** The `money` module and `calcLineItem`/`calcInvoiceTotals` functions run on both client and server. A rounding bug here propagates to every invoice in the system and cannot be caught by type-checking alone.

**Priority 3 — Web component tests.** UI components with ARIA contracts (Modal, Combobox, Listbox) must be tested for keyboard navigation and focus management since they were custom-built rather than using a headless library.

**Priority 4 — Mobile store tests.** The Zustand stores that manage auth token and biometric state drive the app's security UX. Their async state transitions need explicit assertion.

**Priority 5 — E2E tests.** End-to-end tests are the most expensive to write and maintain. A small focused suite covering the critical happy paths is more valuable than broad coverage.

---

## 2. Test Database Strategy

### The Core Decision

The API integration tests must run against real PostgreSQL. Mocking Drizzle queries invalidates the security tests — you cannot verify that `eq(invoices.businessId, ctx.businessId)` actually filters correctly without running the SQL.

### Approach: Docker Compose test service (not Testcontainers)

The repo already uses `docker-compose.yml` for the dev database. Add a `docker-compose.test.yml` with an isolated test database that:

- Uses a separate port (`5433`) to avoid collision with the dev database
- Is destroyed and recreated before each test run
- Uses `pnpm db:push` (schema push, not migrations) to keep setup fast

**Trade-off accepted:** Testcontainers would be more hermetic per-test but requires a Docker socket in CI and is significantly slower to start. The test-specific compose file achieves the same isolation with less complexity and zero additional dependencies.

### Schema isolation within the test database

The Hisaabo data model has two schema layers:

1. **Control schema** (`packages/db/src/control-schema.ts`) — users, sessions, tenants, tenant_members, invitations. Lives in the main DB.
2. **Tenant schema** (`packages/db/src/tenant-schema.ts`) — businesses, parties, items, invoices, payments, expenses, etc. In self-hosted mode this is the same DB; in cloud mode it is per-tenant.

For self-hosted testing (which is what `MULTI_TENANT=false` does), both schemas live in the same test database. Push both schemas before the test suite runs.

### Test data lifecycle

Use a `beforeEach` transaction rollback pattern for integration tests:

```
beforeAll: start test DB, push schemas, seed static reference data
beforeEach: begin a transaction, run test inside it
afterEach: rollback the transaction (data disappears, no truncation needed)
afterAll: close connections
```

Drizzle supports passing a transaction as the `db` argument. The test helper creates the transaction, injects it as the tRPC context `db`, and the afterEach rolls it back. This is faster than truncating tables and guarantees isolation between tests.

**Exception:** Tests that verify `FOR UPDATE` locking (invoice number generation) cannot use transaction rollback — they need to commit and then clean up explicitly.

---

## 3. File Structure

```
hisaabo/
├── packages/
│   ├── shared/
│   │   └── src/
│   │       └── __tests__/
│   │           ├── money.test.ts
│   │           ├── calc.test.ts
│   │           └── validators.test.ts
│   ├── api/
│   │   └── src/
│   │       └── __tests__/
│   │           ├── helpers/
│   │           │   ├── db.ts          # test DB connection + schema push
│   │           │   ├── context.ts     # createTestContext() factory
│   │           │   └── fixtures.ts    # createUser(), createBusiness(), etc.
│   │           ├── unit/
│   │           │   └── permissions.test.ts
│   │           └── integration/
│   │               ├── auth.test.ts
│   │               ├── tenant.test.ts
│   │               ├── business.test.ts
│   │               ├── party.test.ts
│   │               ├── item.test.ts
│   │               ├── invoice.test.ts
│   │               ├── payment.test.ts
│   │               ├── expense.test.ts
│   │               ├── dashboard.test.ts
│   │               └── security.test.ts   # cross-cutting security scenarios
│   └── db/
│       └── src/
│           └── __tests__/
│               └── tenant-pool.test.ts
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   └── __tests__/
│   │   │       ├── components/
│   │   │       │   ├── ui/
│   │   │       │   │   ├── Modal.test.tsx
│   │   │       │   │   ├── Combobox.test.tsx
│   │   │       │   │   ├── Listbox.test.tsx
│   │   │       │   │   ├── SlideOver.test.tsx
│   │   │       │   │   ├── Tabs.test.tsx
│   │   │       │   │   └── Pagination.test.tsx
│   │   │       │   └── InvoiceCreator.test.tsx
│   │   │       └── lib/
│   │   │           └── utils.test.ts
│   │   └── e2e/
│   │       ├── auth.spec.ts
│   │       ├── invoice.spec.ts
│   │       ├── payment.spec.ts
│   │       └── navigation.spec.ts
│   └── mobile/
│       └── src/
│           └── __tests__/
│               ├── stores/
│               │   ├── auth.test.ts
│               │   ├── biometric.test.ts
│               │   └── business.test.ts
│               └── components/
│                   ├── ui/
│                   │   ├── StatusBadge.test.tsx
│                   │   ├── SearchBar.test.tsx
│                   │   └── FAB.test.tsx
│                   ├── LockScreen.test.tsx
│                   └── BiometricSetupPrompt.test.tsx
├── docker-compose.test.yml
└── vitest.workspace.ts
```

---

## 4. Agent A — `packages/shared` Unit Tests

### Framework

Vitest. No browser environment needed. Add to `packages/shared/package.json`:

```json
"devDependencies": {
  "vitest": "^2.0.0"
},
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### `money.test.ts` — Critical scenarios

The `money` module uses integer paise internally. These cases verify that the conversion boundaries are correct.

**Addition:**
- `money.add("1.99", "0.01")` returns `"2.00"` (boundary at whole number)
- `money.add("0.1", "0.2")` returns `"0.30"` (the classic JS float trap — must not return `"0.30000000000000004"`)
- `money.add("-5.00", "3.00")` returns `"-2.00"` (negative result)
- `money.add("0", "0")` returns `"0.00"`
- `money.add("99999999999999.99", "0.01")` returns `"100000000000000.00"` (NUMERIC(15,2) boundary)

**Multiplication:**
- `money.mul("333.33", "3")` returns `"999.99"` (not `"999.9900000000001"`)
- `money.mul("10.00", "0.1")` returns `"1.00"` (floating factor)
- `money.mul("0.01", "0.01")` returns `"0.00"` (truncation of sub-paise result)
- `money.mul("0", "100")` returns `"0.00"`

**Percent:**
- `money.percent("100.00", "18")` returns `"18.00"` (GST at 18%)
- `money.percent("100.00", "28")` returns `"28.00"` (GST at 28%)
- `money.percent("1000.00", "0.1")` returns `"1.00"` (fractional percent)
- `money.percent("0.01", "50")` returns `"0.00"` (rounds to zero)

**Edge inputs:**
- `money.add("", "1.00")` returns `"1.00"` (NaN input treated as 0)
- `money.add(NaN, "1.00")` returns `"1.00"`
- `money.sum([])` returns `"0.00"`

### `calc.test.ts` — Critical scenarios

These test `calcLineItem` and `calcInvoiceTotals` which drive every invoice in the system.

**`calcLineItem` — tax-exclusive (default):**
- Qty 10, price 100, tax 18%, discount 0%: subtotal=1000, taxAmount=180, total=1180
- Qty 10, price 100, tax 18%, discount 10%: subtotal=1000, after=900, taxAmount=162, total=1062 (discount before tax)
- Qty 1, price 0, tax 28%: total=0.00 (zero price)
- Qty 100, price 0.01, tax 0%: total=1.00 (paise accumulation)
- Qty 3, price 33.33, tax 0%, discount 0%: subtotal=99.99 (not 100)
- Tax percent 56%: maximum allowed, should compute without error
- Discount percent 100%: total=0.00

**`calcLineItem` — tax-inclusive mode:**
- Qty 1, price 118.00, tax 18%, taxInclusive=true: base=100.00, taxAmount=18.00, total=100.00+18.00 = the original 118 reconstructed
- Verify `afterDiscount + taxAmount === total` invariant holds

**`calcInvoiceTotals`:**
- Three line items with different tax rates: verify individual tax amounts sum correctly
- Invoice-level discount as amount: `invoiceDiscount=50, invoiceDiscountType="amount"` deducted from subtotal
- Invoice-level discount as percent: `invoiceDiscount=10, invoiceDiscountType="percent"` of subtotal
- Round-off positive: `roundOff="0.50"` adds to total
- Round-off negative: `roundOff="-0.50"` subtracts from total
- Additional charges: charge of 50 adds to total

### `validators.test.ts` — Critical scenarios

Test the schemas that gate every API call. Invalid inputs that reach the server would bypass the Zod layer.

**GSTIN regex:**
- Valid: `"29AABCU9603R1ZX"` (Karnataka, real format)
- Invalid: `"29AABCU9603R1Z"` (too short), `"AABCU9603R1ZX"` (no state code), `""` (empty, but `.optional()` should accept)

**PAN regex:**
- Valid: `"AABCU9603R"`
- Invalid: `"aabcu9603r"` (lowercase), `"AABCU963R"` (wrong length)

**`createInvoiceSchema`:**
- `lineItems` must have at least one entry (`.min(1)`)
- Quantity `"0"` fails the `> 0` refinement
- Tax percent `"57"` fails the `<= 56` refinement
- Discount percent `"101"` fails the `<= 100` refinement
- `partyId` non-UUID string fails

**`createItemSchema`:**
- `itemMode="variants"` with `unitVariants` non-empty fails (the cross-field refinement)
- `itemMode="alt_units"` with `variantAttributes` non-empty fails
- Both fields empty is valid regardless of mode

**`registerSchema`:**
- Mismatched `password`/`confirmPassword` fails with error on `confirmPassword` path
- Password shorter than 8 chars fails

---

## 5. Agent B — API Integration Tests

### Framework

Vitest with `@trpc/server`'s `createCallerFactory` for in-process tRPC calls. This exercises the full middleware chain (isAuthenticated → hasTenantAccess → hasBusinessAccess → withPermissions) against the real database without an HTTP round-trip.

Add to `packages/api/package.json`:

```json
"devDependencies": {
  "vitest": "^2.0.0",
  "@types/node": "^22.0.0"
}
```

### `helpers/db.ts` — Test database bootstrap

```
TEST_DATABASE_URL=postgresql://hisaabo:hisaabo_dev@localhost:5433/hisaabo_test
```

The helper exports:
- `setupTestDb()`: called in `beforeAll`, pushes both control and tenant schemas
- `teardownTestDb()`: called in `afterAll`, closes the connection pool
- `beginTestTransaction()`: called in `beforeEach`, returns a tx-wrapped db instance
- `rollbackTestTransaction()`: called in `afterEach`

### `helpers/context.ts` — Context factory

`createTestContext(overrides)` returns a `Context` object that bypasses the HTTP request/cookie parsing. It accepts:

```typescript
interface TestContextOverrides {
  userId?: string;
  tenantId?: string;
  businessId?: string;
  role?: string;   // "superadmin" | "admin" | "seller_manager" | "seller" | "accountant"
  db?: TenantDatabase;  // inject the transaction-wrapped db
}
```

This is the key seam: instead of mocking the middleware, the test creates a context that middleware would have produced, then calls procedures directly via `createCallerFactory`.

### `helpers/fixtures.ts` — Data factories

Each factory function runs inside the test transaction:

- `createUser(tx, { email, name })` — inserts user + session, returns `{ userId, sessionId }`
- `createTenant(tx, { slug })` — inserts tenant, returns `{ tenantId }`
- `createMembership(tx, { tenantId, userId, role })` — inserts `tenant_members` row
- `createBusiness(tx, db, { businessId? })` — inserts business, returns `{ businessId }`
- `createParty(tx, db, { businessId, name, type })` — returns `{ partyId }`
- `createItem(tx, db, { businessId, name })` — returns `{ itemId }`
- `createInvoice(tx, db, { businessId, partyId })` — returns `{ invoiceId }`

### `integration/security.test.ts` — Cross-cutting security scenarios

These are the highest-value tests. They verify the security invariants from the SECURITY_PENDING.md audit.

**Cross-business isolation:**

```
Scenario: User A cannot read Business B's invoices
  Given: Two businesses (B1, B2) in the same tenant
  And: User A is a member scoped to B1
  When: User A calls invoice.list with x-business-id=B2
  Then: Returns empty list (businessId filter silently excludes)

Scenario: User A cannot read Business B's invoices by ID
  Given: An invoice created under B2
  When: User A (scoped to B1) calls invoice.getById with that invoice's ID
  Then: Returns null (not throws)

Scenario: Cross-business party on invoice creation
  Given: Party P belongs to B2
  When: User A (scoped to B1) calls invoice.create with partyId=P.id
  Then: Throws BAD_REQUEST "Party not found in this business"

Scenario: Cross-business item on invoice creation
  Given: Item I belongs to B2
  When: User A (scoped to B1) calls invoice.create with lineItems containing itemId=I.id
  Then: Throws BAD_REQUEST "One or more items do not belong to this business"
```

**Cross-tenant isolation:**

```
Scenario: User from Tenant A cannot select Tenant B
  When: User from Tenant A calls tenant.select with tenantId=B
  Then: Throws FORBIDDEN "Not a member of this organization"
```

**CASL role enforcement — invoice:**

```
Scenario: accountant cannot create invoice
  Given: User with role "accountant"
  When: calls invoice.create
  Then: Throws FORBIDDEN "Cannot create Invoice"

Scenario: seller cannot delete invoice
  Given: User with role "seller"
  When: calls invoice.delete
  Then: Throws FORBIDDEN "Cannot delete Invoice"

Scenario: seller_manager can delete unpaid invoice within 2 hours
  Given: User with role "seller_manager"
  And: An invoice created 1 hour ago with status "unfulfilled"
  When: calls invoice.delete
  Then: Succeeds, invoice status becomes "cancelled"

Scenario: seller_manager cannot delete invoice older than 2 hours
  Given: An invoice created 3 hours ago
  When: seller_manager calls invoice.delete
  Then: Throws FORBIDDEN "Can only delete invoices within 2 hours of creation"

Scenario: seller_manager cannot delete paid invoice
  Given: An invoice with status "paid"
  When: seller_manager calls invoice.delete
  Then: Throws FORBIDDEN "Cannot delete paid invoices"
```

**CASL role enforcement — expenses:**

```
Scenario: seller cannot read expenses
  Given: User with role "seller"
  When: calls expense.list
  Then: Throws FORBIDDEN "Cannot read Expense"

Scenario: accountant can create expense
  Given: User with role "accountant"
  When: calls expense.create with valid input
  Then: Succeeds
```

**Auth middleware:**

```
Scenario: Unauthenticated request to protected procedure
  Given: A context with user=null
  When: calls any protectedProcedure
  Then: Throws UNAUTHORIZED

Scenario: No tenant selected
  Given: A context with user set but tenantId=null
  When: calls any tenantProcedure
  Then: Throws BAD_REQUEST "No organization selected"

Scenario: businessId not in tenant
  Given: A businessId that does not exist in the tenant DB
  When: calls any businessProcedure
  Then: Throws FORBIDDEN "Business not found"
```

**Invitation token plaintext (SECURITY_PENDING.md Finding 1):**

```
Scenario: Invitation token is never returned in plain text from DB queries
  Given: An invitation is created
  When: The invitation is read from DB
  Then: The stored token is a 64-char hex string (SHA-256 hash), not the raw token

Scenario: Accepting invitation with raw token works
  When: acceptInvitation called with the raw token returned by inviteMember
  Then: Succeeds (API hashes the token before comparing)

Scenario: Accepting invitation with pre-hashed token fails
  When: acceptInvitation called with the SHA-256 hash directly
  Then: Throws error (token not found)
```

**Admin role hierarchy (SECURITY_PENDING.md Finding 3):**

```
Scenario: Admin cannot remove owner
  Given: A tenant with an owner and an admin
  When: Admin calls tenant.removeMember with the owner's userId
  Then: Throws FORBIDDEN

Scenario: Admin cannot remove another admin
  When: Admin calls tenant.removeMember with another admin's userId
  Then: Throws FORBIDDEN

Scenario: Owner can remove admin
  When: Owner calls tenant.removeMember with an admin's userId
  Then: Succeeds
```

### `integration/invoice.test.ts` — Business logic

```
Scenario: Invoice number is sequential and atomic
  Given: Business with invoicePrefix="INV", nextInvoiceNumber=1
  When: Two invoices are created concurrently
  Then: Invoice numbers are "INV-00001" and "INV-00002" (no duplicates)

Scenario: Stock is decremented on sale invoice creation
  Given: An item with stockQuantity=10
  When: A sale invoice is created for qty=3 of that item
  Then: item.stockQuantity = 7.000

Scenario: Stock is incremented on purchase invoice creation
  Given: An item with stockQuantity=10
  When: A purchase invoice is created for qty=5
  Then: item.stockQuantity = 15.000

Scenario: Stock is correctly reversed and reapplied on invoice update
  Given: A sale invoice with qty=3 (stock went from 10 to 7)
  When: Invoice is updated to qty=5
  Then: item.stockQuantity = 5.000 (10 - 5, old adjustment reversed, new applied)

Scenario: Invoice totals are calculated with fixed-point arithmetic
  Given: Line item with qty=3, unitPrice="33.33", tax=0%, discount=0%
  When: Invoice is created
  Then: totalAmount="99.99" (not "99.99000000000001")

Scenario: Tax-inclusive item price is back-calculated correctly
  Given: Item with salePrice="118.00", taxPercent="18", taxInclusive=true
  When: Invoice line item is processed
  Then: taxAmount="18.00", subtotal="100.00", total="118.00"
```

### `integration/payment.test.ts` — Payment allocation

```
Scenario: Payment marks invoice as paid when amount equals balance
  Given: An invoice with totalAmount=1000, amountPaid=0
  When: A payment of 1000 is created
  Then: invoice.status="paid", invoice.amountPaid=1000

Scenario: Payment marks invoice as partial when amount < balance
  Given: An invoice with totalAmount=1000
  When: A payment of 600 is created
  Then: invoice.status="partial", invoice.amountPaid=600

Scenario: Multi-invoice payment allocation
  Given: Two invoices with balances 500 and 700
  When: A payment of 1200 is created with allocations=[{invoiceId:I1, amount:500}, {invoiceId:I2, amount:700}]
  Then: I1.status="paid", I2.status="paid"

Scenario: Payment cannot allocate to invoice from different business
  Given: Invoice I belongs to Business B2
  When: User scoped to B1 creates payment with allocation to I
  Then: Throws BAD_REQUEST
```

### `integration/auth.test.ts`

```
Scenario: Register creates user, session, default tenant membership
  When: auth.register called with valid email/password
  Then: User exists in DB, session exists, tenant_members has owner row

Scenario: Login with correct password returns session
  When: auth.login with correct credentials
  Then: Session ID returned, session exists in DB with 30-day expiry

Scenario: Login with wrong password throws UNAUTHORIZED
  When: auth.login with wrong password
  Then: Throws UNAUTHORIZED (not exposing which field is wrong)

Scenario: Magic link token is hashed in storage
  When: auth.requestMagicLink called
  Then: magicLinkTokens row has tokenHash (64-char hex), not the raw token

Scenario: Magic link is single-use
  Given: A valid magic link token
  When: auth.verifyMagicLink called twice with same token
  Then: First call succeeds, second call throws UNAUTHORIZED

Scenario: Expired magic link is rejected
  Given: A token with expiresAt in the past
  When: auth.verifyMagicLink called
  Then: Throws UNAUTHORIZED

Scenario: Session cache is invalidated after logout
  Given: A user with a cached session
  When: auth.logout is called
  Then: The session cache entry is removed (next request hits DB)
```

### `integration/party.test.ts` — Ledger and balance

```
Scenario: Party list returns only parties from current business
  Given: 5 parties in B1, 5 parties in B2
  When: User scoped to B1 calls party.list
  Then: Returns exactly 5 results, all with businessId=B1

Scenario: Outstanding filter returns parties with unpaid balance
  Given: Party with one paid and one unpaid invoice
  When: party.list called with filter="outstanding"
  Then: Party appears in results

Scenario: Overdue filter returns parties with overdue invoices
  Given: Party with an invoice in status="overdue"
  When: party.list called with filter="overdue"
  Then: Party appears
```

### `unit/permissions.test.ts`

Test `defineAbilityFor` and `mapDbRole` in isolation:

```
For role "seller":
  - can("create", "Invoice") = true
  - can("delete", "Invoice") = false
  - can("read", "Expense") = false

For role "accountant":
  - can("create", "Invoice") = false
  - can("create", "Expense") = true
  - can("manage", "BankAccount") = true

For role "seller_manager":
  - can("delete", "Invoice") = true (time check is at endpoint level)
  - can("delete", "Party") = false

mapDbRole("owner") = "superadmin"
mapDbRole("member") = "seller"
mapDbRole("viewer") = "accountant"
mapDbRole("unknown_future_role") = "" (empty string, zero permissions)
```

### PDF endpoint security (SECURITY_PENDING.md Finding 4)

The PDF endpoint at `/api/invoices/:id/pdf` is in `server.ts` and is not a tRPC procedure. It needs a separate HTTP-level integration test.

```
Scenario: PDF endpoint validates business belongs to authenticated user's tenant
  Given: User A is authenticated, tenant T1
  And: Invoice I belongs to a business in tenant T2
  When: GET /api/invoices/{I.id}/pdf with User A's session and x-business-id from T2
  Then: 403 Forbidden
```

This test must use `fetch()` against a running Hono server instance (use `@hono/node-server` with a random port) rather than the tRPC caller factory.

---

## 6. Agent C — Web Component Tests

### Framework

Vitest + React Testing Library + jsdom. Add to `apps/web/package.json`:

```json
"devDependencies": {
  "vitest": "^2.0.0",
  "@testing-library/react": "^16.0.0",
  "@testing-library/user-event": "^14.0.0",
  "@testing-library/jest-dom": "^6.0.0",
  "axe-core": "^4.10.0",
  "@axe-core/react": "^4.10.0",
  "jsdom": "^25.0.0",
  "happy-dom": "^15.0.0"
}
```

Vitest config (`apps/web/vitest.config.ts`):

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

Setup file imports `@testing-library/jest-dom` for custom matchers.

### `Modal.test.tsx` — Focus management and ARIA

The Modal uses a custom `useFocusTrap` hook and manual keyboard handling. These are accessibility failure modes that axe-core alone cannot catch.

```
Renders with correct ARIA attributes:
  - role="dialog" on the outer container
  - aria-modal="true"
  - aria-labelledby pointing to the h2 when title is provided

Focus trap:
  - When modal opens, first focusable element receives focus
  - Tab key cycles forward through focusable elements
  - Shift+Tab cycles backward
  - Focus does not escape to elements behind the backdrop

Keyboard close:
  - Escape key calls onClose
  - Clicking backdrop calls onClose
  - Clicking inside modal content does not call onClose

Not rendered when closed:
  - When open=false, null is returned (no DOM node)

Axe accessibility check:
  - No violations reported by axe-core when modal is open with title
```

### `Combobox.test.tsx` — Keyboard navigation and ARIA

The Combobox handles `useId`, manual listbox role, and keyboard navigation. This is complex enough to warrant thorough testing.

```
Keyboard navigation:
  - ArrowDown opens the dropdown and focuses first option
  - ArrowDown/ArrowUp move active index, wrapping at boundaries
  - Enter selects the active option and calls onChange
  - Escape closes the dropdown without selection

ARIA state:
  - Input has aria-expanded="false" when closed, aria-expanded="true" when open
  - Active option has aria-selected="true"
  - Options list has role="listbox"

Server-side search:
  - When onQueryChange is provided, typing in the input calls onQueryChange with the input value
  - When isLoading=true, a loading indicator is rendered

Empty state:
  - When options=[] and query is set, emptyMessage is displayed
```

### `InvoiceCreator.test.tsx` — Calculation correctness

The `InvoiceCreator` component has its own `calcLine` function (using floating-point arithmetic) which is separate from the `money` module used server-side. This is a divergence that needs testing:

```
Line item total calculation:
  - qty=10, price=100, tax=18%, discount=0%: total renders as "1,180.00"
  - qty=10, price=100, tax=18%, discount=10%: total renders as "1,062.00"

Add line item:
  - Clicking "Add item" appends a new empty row
  - Total updates when new row is filled in

Remove line item:
  - Removing a row recalculates totals

Role-based field locking:
  - When isSeller=true, tax and discount fields are disabled/readonly
  - When isSeller=false, fields are editable

NOTE: The client-side calcLine in InvoiceCreator uses floating-point arithmetic,
not the fixed-point money module. This means a client preview may differ from
the server-persisted total for edge cases. This test suite should document the
current behavior and flag the divergence as a known issue to address separately.
```

### Accessibility integration with axe-core

Every component test should include an axe check as the last assertion:

```typescript
import { axe } from "jest-axe";  // or use @axe-core/react directly

it("has no accessibility violations", async () => {
  const { container } = render(<Modal open title="Test">content</Modal>);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

Components to prioritize for axe testing: Modal, Combobox, Listbox, SlideOver, Tabs, Pagination. These are interactive components with custom ARIA implementations.

### E2E Tests (Playwright)

Add to `apps/web/package.json`:

```json
"devDependencies": {
  "@playwright/test": "^1.48.0"
}
```

Playwright config (`apps/web/playwright.config.ts`):

```typescript
export default {
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
};
```

E2E tests require a running API with a seeded database. Use a dedicated test user seeded by a script, not by the test itself.

**`auth.spec.ts`:**

```
Magic link login flow:
  - Navigate to /login
  - Enter email, submit form
  - Observe "check your email" confirmation state
  - (In CI: use a test endpoint that directly returns the token)
  - Navigate to /verify?token=...
  - Assert redirect to dashboard
  - Assert user name appears in nav

Session persistence:
  - After login, reload the page
  - User remains logged in (session cookie preserved)
```

**`invoice.spec.ts`:**

```
Create sale invoice:
  - Navigate to /invoices/new
  - Select a customer from the Combobox
  - Add a line item (select item, qty, price)
  - Submit form
  - Assert redirect to invoice detail page
  - Assert invoice number appears (e.g., "INV-00001")
  - Assert total amount matches expected value

Invoice list filtering:
  - Navigate to /invoices
  - Filter by status "paid"
  - Assert only paid invoices are shown
```

**`payment.spec.ts`:**

```
Record payment against invoice:
  - Navigate to invoice detail page
  - Click "Record Payment"
  - Enter amount = full balance
  - Submit
  - Assert invoice status changes to "Paid"
```

**`navigation.spec.ts`:**

```
Responsive sidebar:
  - At 375px viewport width, sidebar is collapsed
  - Hamburger menu toggle opens/closes sidebar
  - Navigating to a route closes the sidebar on mobile

Keyboard navigation:
  - Tab through primary navigation links
  - All interactive elements are keyboard reachable
```

---

## 7. Agent D — Mobile Tests

### Framework

Jest + React Native Testing Library (RNTL). Expo provides a Jest preset (`jest-expo`).

Add to `apps/mobile/package.json`:

```json
"devDependencies": {
  "jest": "^29.0.0",
  "jest-expo": "~52.0.0",
  "@testing-library/react-native": "^12.0.0",
  "@testing-library/jest-native": "^5.0.0"
},
"jest": {
  "preset": "jest-expo",
  "setupFilesAfterFramework": ["@testing-library/jest-native/extend-expect"]
}
```

### Mock Strategy for Native Modules

Expo's native modules (`expo-secure-store`, `expo-local-authentication`) must be mocked. Create `apps/mobile/src/__tests__/__mocks__/`:

**`expo-secure-store.ts`:**

```typescript
const store = new Map<string, string>();
export const getItemAsync = jest.fn(async (key: string) => store.get(key) ?? null);
export const setItemAsync = jest.fn(async (key: string, value: string) => { store.set(key, value); });
export const deleteItemAsync = jest.fn(async (key: string) => { store.delete(key); });
export const __resetStore = () => store.clear();  // test helper
```

**`expo-local-authentication.ts`:**

```typescript
export const hasHardwareAsync = jest.fn(async () => true);
export const isEnrolledAsync = jest.fn(async () => true);
export const supportedAuthenticationTypesAsync = jest.fn(async () => [1]);
export const authenticateAsync = jest.fn(async () => ({ success: true }));
export const AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };
```

### `stores/biometric.test.ts`

The biometric store has non-trivial async state transitions. Each test calls `beforeEach(() => { SecureStore.__resetStore(); })`.

```
Initial state:
  - biometricEnabled=false, pinEnabled=false, isLocked=false, isHydrated=false

hydrate() — no stored data:
  - After hydrate(), isHydrated=true, biometricEnabled=false, pinEnabled=false, isLocked=false

hydrate() — biometric enabled:
  - With BIOMETRIC_ENABLED_KEY="1" in store
  - After hydrate(), biometricEnabled=true, isLocked=true (locks on start)

hydrate() — PIN enabled:
  - With PIN_HASH_KEY="<some hash>" in store
  - After hydrate(), pinEnabled=true, isLocked=true

hydrate() — SecureStore throws:
  - When getItemAsync rejects
  - After hydrate(), isHydrated=true (non-fatal), state remains at defaults

enableBiometric():
  - Calls SecureStore.setItemAsync with BIOMETRIC_ENABLED_KEY="1"
  - Sets biometricEnabled=true

verifyPin(pin):
  - After setPin("1234"), verifyPin("1234") returns true
  - verifyPin("0000") returns false
  - verifyPin("1234") when no PIN stored returns false

lock() / unlock():
  - lock() sets isLocked=true only when biometric or pin is enabled
  - lock() is a no-op when neither is enabled
  - unlock() always sets isLocked=false

authenticate():
  - When LocalAuthentication.authenticateAsync returns { success: true }, returns true
  - When it returns { success: false }, returns false
  - When it throws, returns false
```

### `stores/auth.test.ts`

```
Initial state:
  - token=null, isHydrated=false

hydrate() with token in SecureStore:
  - After hydrate(), token=<stored value>, isHydrated=true

hydrate() with no token:
  - After hydrate(), token=null, isHydrated=true

login(token):
  - Sets cachedToken and persists to SecureStore
  - token state is updated immediately (no re-hydrate needed)

logout():
  - Clears cachedToken and removes from SecureStore
  - token state becomes null
```

### `components/LockScreen.test.tsx`

```
Biometric unlock:
  - Renders "Unlock with biometrics" button when biometricEnabled=true
  - Pressing it calls useBiometricStore.authenticate()
  - On success, unlock() is called and onUnlock prop is invoked

PIN entry:
  - 4-digit PIN input renders when pinEnabled=true
  - Entering correct PIN calls unlock()
  - Entering wrong PIN shows error message
  - PIN is cleared after wrong attempt

Accessibility:
  - All buttons have accessible labels
  - Error messages are announced (via accessibilityLiveRegion or similar)
```

### `components/ui/StatusBadge.test.tsx`

```
Renders correct text and color for each status:
  - "paid" → green badge
  - "overdue" → red badge
  - "draft" → grey badge
  - "partial" → amber badge

Accessibility:
  - Has accessible text matching the status label
```

---

## 8. Vitest Workspace Configuration

The shared Vitest configuration at the monorepo root (`vitest.workspace.ts`) coordinates the three pure-JS suites:

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",        // unit tests, no DOM
  "packages/api",           // integration tests, needs TEST_DATABASE_URL
  "apps/web",               // jsdom, React 19
]);
```

Mobile tests run via Jest (not Vitest) because the `jest-expo` preset handles Metro bundler transforms. They are not included in the Vitest workspace.

Add to root `package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:mobile": "pnpm --filter @hisaabo/mobile test",
  "test:e2e": "pnpm --filter @hisaabo/web playwright test"
}
```

---

## 9. Docker Compose Test Service

`docker-compose.test.yml` — ephemeral test database on port 5433:

```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    container_name: hisaabo-db-test
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: hisaabo
      POSTGRES_PASSWORD: hisaabo_dev
      POSTGRES_DB: hisaabo_test
    tmpfs:
      - /var/lib/postgresql/data   # in-memory, dies with container
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hisaabo"]
      interval: 2s
      timeout: 2s
      retries: 10
```

Using `tmpfs` means no volume to clean up between runs and faster I/O. The container is started by CI and by the `test:api:setup` script.

---

## 10. CI Pipeline Changes

The current `.github/workflows/ci.yml` has two jobs: `typecheck-lint` and `build`. The following additions preserve the existing structure and add test jobs as parallel siblings.

### New job: `test-unit`

Runs on every PR and push to main. No database required.

```yaml
test-unit:
  name: Unit Tests (shared)
  runs-on: ubuntu-latest
  timeout-minutes: 5
  needs: typecheck-lint
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @hisaabo/shared test
```

### New job: `test-api`

Runs on every PR and push to main. Requires PostgreSQL service.

```yaml
test-api:
  name: API Integration Tests
  runs-on: ubuntu-latest
  timeout-minutes: 15
  needs: typecheck-lint
  services:
    postgres:
      image: postgres:16-alpine
      env:
        POSTGRES_USER: hisaabo
        POSTGRES_PASSWORD: hisaabo_dev
        POSTGRES_DB: hisaabo_test
      ports:
        - 5433:5432
      options: >-
        --health-cmd pg_isready
        --health-interval 5s
        --health-timeout 5s
        --health-retries 5
  env:
    TEST_DATABASE_URL: postgresql://hisaabo:hisaabo_dev@localhost:5433/hisaabo_test
    NODE_ENV: test
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - name: Push test schema
      run: pnpm --filter @hisaabo/db db:push
      env:
        DATABASE_URL: postgresql://hisaabo:hisaabo_dev@localhost:5433/hisaabo_test
    - name: Run API tests
      run: pnpm --filter @hisaabo/api test
```

### New job: `test-web`

Runs on every PR and push to main. Uses jsdom, no server required.

```yaml
test-web:
  name: Web Component Tests
  runs-on: ubuntu-latest
  timeout-minutes: 10
  needs: typecheck-lint
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @hisaabo/web test
```

### New job: `test-mobile`

Runs only when `apps/mobile/**` changes, to keep PR feedback fast.

```yaml
test-mobile:
  name: Mobile Store Tests
  runs-on: ubuntu-latest
  timeout-minutes: 10
  needs: typecheck-lint
  if: |
    github.event_name == 'push' ||
    contains(github.event.pull_request.changed_files, 'apps/mobile/')
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @hisaabo/mobile test
```

Note: The `changed_files` approach above is a simplification. The actual implementation should use `dorny/paths-filter` action or `tj-actions/changed-files` to correctly detect mobile file changes in PR context.

### New job: `test-e2e`

Runs only on pushes to main (not PRs) to avoid slow feedback in development.

```yaml
test-e2e:
  name: E2E Tests (Playwright)
  runs-on: ubuntu-latest
  timeout-minutes: 30
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  needs: [build, test-api]
  services:
    postgres:
      image: postgres:16-alpine
      env:
        POSTGRES_USER: hisaabo
        POSTGRES_PASSWORD: hisaabo_dev
        POSTGRES_DB: hisaabo_e2e
      ports:
        - 5432:5432
      options: >-
        --health-cmd pg_isready
        --health-interval 5s
        --health-timeout 5s
        --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm build
    - name: Seed E2E database
      run: pnpm db:push && node scripts/seed-e2e.js
      env:
        DATABASE_URL: postgresql://hisaabo:hisaabo_dev@localhost:5432/hisaabo_e2e
    - name: Install Playwright browsers
      run: pnpm exec playwright install --with-deps chromium
    - name: Run E2E tests
      run: pnpm --filter @hisaabo/web test:e2e
      env:
        DATABASE_URL: postgresql://hisaabo:hisaabo_dev@localhost:5432/hisaabo_e2e
    - name: Upload Playwright report
      uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: apps/web/playwright-report/
```

---

## 11. Mock Strategy Summary

| Layer | What to mock | What to test against real |
|---|---|---|
| `packages/shared` | Nothing | Pure functions, no I/O |
| `packages/api` unit | Nothing | In-memory `defineAbilityFor` |
| `packages/api` integration | Email service (nodemailer/SMTP), magic link delivery | Real PostgreSQL via transaction rollback |
| `apps/web` component | tRPC client (via MSW or vi.mock), router | DOM interactions, ARIA, axe |
| `apps/web` E2E | Nothing | Full stack (real API + real DB) |
| `apps/mobile` stores | `expo-secure-store`, `expo-local-authentication` | Store state machines |
| `apps/mobile` components | `expo-haptics`, `expo-router` navigation | Component rendering, RNTL interactions |

The email service in `packages/api/src/lib/email.ts` must be mocked in integration tests. The test context override for `createTestContext()` should include an `emailService` field that captures sent messages in an array rather than delivering them, allowing tests to assert on what would have been sent.

---

## 12. Known Gaps to Address Before Testing

These issues, identified in SECURITY_PENDING.md and code review, will cause specific test failures if not resolved first. Writing the tests before fixing these creates failing tests that document the gaps, which is the preferred approach.

**Gap 1 — Invitation tokens (CRITICAL):**
`invitations.token` in `control-schema.ts` line 90 stores the raw token. The `tenant.ts` router has `hashInvitationToken()` defined but is not yet consistently used on the read path. The security test for invitation token storage will fail until this is fixed.

**Gap 2 — Admin can remove owner (HIGH):**
`tenant.removeMember` has no role hierarchy enforcement. The security tests for this will fail and should be committed as failing tests with a `TODO` comment until the fix is implemented.

**Gap 3 — PDF endpoint tenant validation (MEDIUM):**
The PDF endpoint at `/api/invoices/:id/pdf` in `server.ts` does not validate that `businessId` belongs to the authenticated user's tenant. The HTTP-level test for this will fail.

**Gap 4 — Client-side money calculation divergence:**
`InvoiceCreator.tsx` uses a local `calcLine` function with `parseFloat` (floating-point), not the `money` module. For edge-case amounts this will produce a different display total than what the server persists. The test should document this divergence explicitly as a pending fix.

**Gap 5 — No per-email login rate limiting (HIGH):**
The auth test for login rate limiting will fail because only global IP-based rate limiting exists. This gap needs a separate implementation (Redis-backed or DB-backed per-email counter) before the test can pass.

---

## 13. Parallelization Plan

The four agents can work concurrently from the start. The only dependency is that Agent B needs the test database helpers before writing integration test bodies — but the helpers can be stubbed and filled in while the test scenarios are written.

```
Agent A: packages/shared unit tests
  - No dependencies
  - Estimated: 1 day to full coverage
  - Unblocked from day 1

Agent B: packages/api integration tests
  - Needs: docker-compose.test.yml (can self-author)
  - Needs: helpers/db.ts, helpers/context.ts, helpers/fixtures.ts
  - Estimated: 3-4 days for all security scenarios + business logic
  - Start with helpers, then security.test.ts, then per-router files

Agent C: apps/web component + E2E tests
  - No dependency on Agent B
  - Component tests can start immediately
  - E2E tests need API running; can mock API with MSW for component tests
  - Estimated: 2 days for components, 1 day for E2E

Agent D: apps/mobile tests
  - No dependency on other agents
  - Estimated: 1.5 days for stores + components
  - Start with mock setup, then stores (highest value), then components
```

CI jobs are structured so that `test-unit`, `test-api`, `test-web`, and `test-mobile` all run in parallel after `typecheck-lint`, keeping total PR feedback time within the existing budget (currently ~10 minutes; new expected total ~15 minutes with API tests as the bottleneck).
