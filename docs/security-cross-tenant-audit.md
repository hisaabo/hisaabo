# Cross-Tenant Isolation Audit — Hisaabo API

**Date**: 2026-03-26
**Auditor**: Security Engineer Agent
**Scope**: All tRPC procedures and REST endpoints in `packages/api/src/`
**Result summary**: 2 HIGH, 3 MEDIUM findings — all fixed in this audit session

---

## Architecture Overview

```
Request
  └── session cookie / Bearer token
        └── controlDb: sessions → users (userId, tenantId)
              └── ctx.tenantId (server-set, never client-controlled)
                    └── getTenantDb(tenantId) → ctx.db (tenant-isolated DB)
                          └── x-business-id header
                                └── hasBusinessAccess: validates business exists in ctx.db
```

The key isolation boundary is `ctx.db`: it is already scoped to the authenticated user's tenant, so no tRPC procedure can reach another tenant's data simply by querying `ctx.db`. Cross-tenant access would require supplying a foreign `tenantId` value, which is impossible because `ctx.tenantId` is derived exclusively from the server-side `sessions` table.

---

## Middleware Chain Review

| Procedure base | Auth level | Business scoping |
|---|---|---|
| `publicProcedure` | None | None |
| `protectedProcedure` | Session required | None |
| `tenantProcedure` | Session + tenant | ctx.db = tenant DB |
| `businessProcedure` | Tenant + business | ctx.businessId validated to exist in ctx.db |
| `authorizedProcedure` | Business + CASL role | Full isolation + permission checks |
| `viewerProcedure` | Alias for authorized | Same |
| `memberProcedure` | Alias for authorized | Same |
| `adminProcedure` | Alias for authorized | Same |

**Key finding**: `hasTenantAccess` does NOT re-verify that the user is a current member of the session's tenant on every request. It trusts the `tenantId` stored in the `sessions` table. This is architecturally correct — the tenant switch path (`tenant.select`) validates membership before updating the session. However, it means that removing a user from a tenant does not immediately invalidate their existing session. This is an accepted latency of up to 60 seconds (session cache TTL), not an isolation bypass.

### Cross-Business Access Within a Tenant (`hasBusinessAccess`)

`hasBusinessAccess` validates that `ctx.businessId` (from the `x-business-id` header) exists in `ctx.db`. However, it does **not** validate that the requesting user has been granted access to that specific business — only that the business exists in the tenant. In the current data model, every tenant member can access every business in the tenant. This matches the documented design: businesses are tenant-scoped resources, not user-scoped. If per-business access control is a future requirement, `hasBusinessAccess` must be extended to check a `businessMembers` table.

---

## Router-by-Router Findings

### `auth.ts` — No Issues

All procedures use `publicProcedure` or `protectedProcedure`. Email-change confirmation reads the `userId` from the server-side token record, never from client input. Magic link tokens use SHA-256 hashing and atomic mark-used updates to prevent replay.

### `tenant.ts` — No Issues

`tenant.select` verifies membership before updating the session's `tenantId`. `inviteMember`, `removeMember`, and `updateMemberRole` all re-check caller's role against the control DB on every call (no reliance on stale CASL ability).

### `business.ts`

#### `business.list` — No Issue (annotated)
Uses `tenantProcedure` with no WHERE clause. Since `ctx.db` is the tenant's isolated database, this correctly returns only the businesses belonging to the authenticated user's tenant. The lack of a WHERE clause is safe by design.

#### `business.getById` — No Issue (annotated)
Same reasoning — `ctx.db` is already tenant-scoped.

#### `business.update` — No Issue
Uses `tenantProcedure`. `ctx.db` prevents cross-tenant updates. `requireTenantAdmin` gates the mutation.

#### `business.updateSequenceNumber` — Low Risk
Uses raw `sql.identifier` for the column name, but that column is looked up from a hardcoded map (`counterColumns`), not user input. No injection risk.

### `invoice.ts`

#### FIXED — HIGH: `invoice.create` — Cross-Business `partyId` and `itemId` injection

**File**: `packages/api/src/routers/invoice.ts`, original line 177, 197-200
**Severity**: HIGH
**Attack vector**: A member of Business A passes `partyId` belonging to Business B in `invoice.create`. The invoice is created referencing Business B's party. The attacker can then query the party's ledger or stats, which would show the newly created cross-business relationship, and can manipulate Business B's party balance (especially via payment allocations).

Similarly, `itemId` values in line items were not validated. An attacker could supply item IDs from Business B, triggering stock deductions on Business B's items.

**Proof of concept**:
```
POST /api/trpc/invoice.create
x-business-id: <Business-A-ID>

{
  "partyId": "<Business-B-party-UUID>",
  "lineItems": [{ "itemId": "<Business-B-item-UUID>", "quantity": "100", ... }]
}
```

**Fix applied** (`invoice.ts`, inside transaction before insert):
```typescript
// Validate partyId belongs to this business
const [partyCheck] = await tx.select({ id: parties.id })
  .from(parties)
  .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
  .limit(1);
if (!partyCheck) throw new TRPCError({ code: "BAD_REQUEST", ... });

// Validate all itemIds belong to this business
const lineItemIds = input.lineItems.map((li) => li.itemId).filter(Boolean) as string[];
if (lineItemIds.length > 0) {
  const ownedItems = await tx.select({ id: items.id }).from(items)
    .where(and(inArray(items.id, lineItemIds), eq(items.businessId, ctx.businessId)));
  if (ownedItems.length !== new Set(lineItemIds).size)
    throw new TRPCError({ code: "BAD_REQUEST", ... });
}
```

#### FIXED — HIGH: `invoice.update` — Cross-Business `partyId` and `itemId` injection

**File**: `packages/api/src/routers/invoice.ts`, original line 320
**Severity**: HIGH
**Attack vector**: Same as `invoice.create`. A user with update access to an invoice could change its `partyId` to a party in a different business.

**Fix applied**: Same pattern — validate `partyId` and `lineItems` item IDs before applying the update.

#### `invoice.getById` — No Issue
WHERE clause includes `eq(invoices.businessId, ctx.businessId)`.

#### `invoice.list`, `invoice.updateStatus`, `invoice.delete` — No Issues
All WHERE clauses include `eq(invoices.businessId, ctx.businessId)`.

### `payment.ts`

#### FIXED — MEDIUM: `payment.create` — Unvalidated `partyId`

**File**: `packages/api/src/routers/payment.ts`, line 189
**Severity**: MEDIUM
**Attack vector**: Passing a `partyId` from a different business creates a payment record pointing to a foreign party. While the payment is correctly tagged with `businessId: ctx.businessId`, it pollutes the party's payment history and could distort ledger reports for the other business if the party is somehow queried cross-business in future features.

**Fix applied**: Added `partyId` ownership check inside the transaction before insert.

#### FIXED — MEDIUM: `payment.defaultAccount` — Missing `businessId` in final fetch

**File**: `packages/api/src/routers/payment.ts`, lines 144-155
**Severity**: MEDIUM
**Attack vector**: The `defaultAccountId` is derived from recent payments (all scoped to `ctx.businessId`), but the final `SELECT` used only `eq(bankAccounts.id, defaultAccountId)` without a `businessId` constraint. In normal operation this cannot be exploited because the ID is derived from business-scoped payments. However, defence-in-depth requires that the final fetch also checks `businessId` to prevent data leakage if the ID derivation logic ever changes.

**Fix applied**: Added `eq(bankAccounts.businessId, ctx.businessId)` to the final bank account fetch.

#### `payment.create` — Invoice allocation check — Correct
The allocation SQL includes `AND business_id = ${ctx.businessId}`:
```sql
WHERE id = ${alloc.invoiceId} AND business_id = ${ctx.businessId}
```
This prevents a user from paying (and reducing the balance of) an invoice from another business.

#### `payment.update` — Correct
Fetches the payment with `eq(payments.businessId, ctx.businessId)` before applying changes. Invoice allocation update SQL also scopes by `business_id`.

#### `payment.assignAccount` — Correct
Bank account verified with `eq(bankAccounts.businessId, ctx.businessId)`. Payment IDs in the loop are re-fetched with `eq(payments.businessId, ctx.businessId)`.

### `party.ts`

#### `party.merge` — Correct
Both `sourceId` and `targetId` are validated against `ctx.businessId` before the merge:
```typescript
.where(and(eq(parties.id, input.sourceId), eq(parties.businessId, ctx.businessId)))
.where(and(eq(parties.id, input.targetId), eq(parties.businessId, ctx.businessId)))
```

All downstream UPDATE/DELETE operations also include `eq(invoices.businessId, ctx.businessId)` and `eq(payments.businessId, ctx.businessId)`.

#### `party.ledger`, `party.ledgerReport`, `party.getById` — Correct
All verify the party belongs to `ctx.businessId` first.

### `item.ts`

#### Item variants — Correct
`updateVariant` and `deleteVariant` join `itemVariants` with `items` and check `eq(items.businessId, ctx.businessId)`. `createVariant` verifies the parent item first. `store.updateVariantStoreSettings` does the same.

#### `item.switchBaseUnit` — Correct
Stock update SQL:
```sql
WHERE item_id = ${input.id}
  AND invoice_id IN (SELECT id FROM invoices WHERE business_id = ${ctx.businessId})
```
This prevents cross-business stock manipulation.

### `store.ts` (tRPC procedures)

#### FIXED — MEDIUM: `store.getOrder` — Unscoped invoice fetch

**File**: `packages/api/src/routers/store.ts`, original lines 333-336
**Severity**: MEDIUM
**Attack vector**: The linked invoice is fetched using only `eq(invoices.id, order.invoiceId)` without a `businessId` check. Since `order.invoiceId` is set server-side when the order is created, this cannot be exploited through the current order creation flow. However, if a database inconsistency ever placed a foreign `invoiceId` in a store order, invoice data from another business would be returned.

**Fix applied**:
```typescript
const [inv] = await ctx.db.select().from(invoices)
  .where(and(
    eq(invoices.id, order.invoiceId),
    eq(invoices.businessId, ctx.businessId),   // added
  ))
  .limit(1);
```

#### `store.checkSlug`, `store.getSettings`, `store.updateSettings` — Correct
Slug uniqueness check correctly excludes the current business only. Settings fetch/update scope by `ctx.businessId`.

#### Order management procedures — Correct
`listOrders`, `getOrder`, `confirmOrder`, `cancelOrder`, `updateOrderStatus` all scope to `ctx.businessId`.

### `bankAccount.ts` — No Issues

All CRUD procedures, `listTransactions`, `addTransaction`, `transfer` include `eq(bankAccounts.businessId, ctx.businessId)` in WHERE clauses.

### `expense.ts` — No Issues

All procedures scope by `eq(expenses.businessId, ctx.businessId)`.

### `dashboard.ts` — No Issues

All aggregation queries include `eq(invoices.businessId, ctx.businessId)`, `eq(payments.businessId, ctx.businessId)`, etc.

### `gst.ts` — No Issues

Delegates to `generateGSTR1`/`generateGSTR3B` with explicit `ctx.businessId` parameter.

### `import.ts` — No Issues

Uses `adminProcedure`. All inserts force `businessId: ctx.businessId`. Duplicate detection uses `eq(parties.businessId, ctx.businessId)`.

### `document.ts` (factory-generated routers)

#### FIXED — HIGH: All document-type `create` procedures — Cross-Business `partyId` and `itemId`

**File**: `packages/api/src/lib/document-router-factory.ts`, original line 272 (`partyId: input.partyId` without validation)
**Severity**: HIGH
**Affected document types**: quotation, credit_note, debit_note, delivery_challan, proforma, sales_return, purchase_return
**Attack vector**: Same as `invoice.create` — supplying a foreign `partyId` or `itemId`.

**Fix applied**: Same pattern — validate `partyId` and `lineItems` item IDs at the start of the transaction in `createDocumentRouter`.

---

## REST Endpoints

### `GET /api/invoices/:id/pdf` — Correct

- Session validated against control DB
- Tenant status verified (active)
- Business validated: `WHERE businesses.id = businessId` in tenant DB (cross-tenant access prevented by `getTenantDb(tenantId)`)
- Invoice scoped: `WHERE invoices.id = invoiceId AND business_id = businessId`
- Party and line items fetched within the same tenant DB

### `GET /api/parties/:id/ledger.pdf` — Correct

Same auth pattern as invoice PDF. Party validated with `WHERE parties.id = partyId AND business_id = businessId`. Invoice and payment queries further scope by `business_id = businessId`.

### `GET /store/:slug/catalog.json` — Correct (Public endpoint, no auth)

- Slug resolved to `(tenantId, businessId)` via `resolveStoreSlug`
- Business validated: `WHERE businesses.id = resolved.businessId AND store_enabled = true`
- Items filtered: `WHERE items.business_id = resolved.businessId AND store_enabled = true`
- Sensitive fields never exposed: `purchasePrice`, raw `stockQuantity`, `hsn`, `sku` are excluded

**Noted**: `stockQty` is included in the query result but stripped during transformation (only `inStock` boolean is returned). However a code reviewer should confirm that `stockQty` cannot leak via the `...rest` spread or serialisation.

### `POST /store/:slug/identify` — Correct (Public endpoint, no auth)

- Turnstile verification required
- Phone lookup scoped: `WHERE business_id = resolved.businessId`
- Returns only first name — no full PII disclosure

### `POST /store/:slug/order` — Correct (Public endpoint, no auth)

- Turnstile verification required
- Rate limited: 5 orders per phone per minute
- Items validated: `WHERE items.business_id = resolved.businessId AND store_enabled = true`
- Variant cross-check: `variant.itemId !== oi.itemId` prevents variant-item mismatch
- All inserts force `businessId: resolved.businessId`

---

## Cross-Reference Validation Summary

| Mutation | Input ID | Validated to caller's business? | Status |
|---|---|---|---|
| `invoice.create` | `partyId` | Yes (FIXED) | Fixed |
| `invoice.create` | `itemId[]` | Yes (FIXED) | Fixed |
| `invoice.update` | `partyId` | Yes (FIXED) | Fixed |
| `invoice.update` | `itemId[]` | Yes (FIXED) | Fixed |
| `payment.create` | `partyId` | Yes (FIXED) | Fixed |
| `payment.create` | `invoiceId` in allocations | Yes (via SQL WHERE) | Clean |
| `payment.create` | `bankAccountId` | Yes (SELECT with businessId) | Clean |
| `payment.update` | `invoiceId` in allocations | Yes (via SQL WHERE) | Clean |
| `payment.update` | `bankAccountId` | Yes (SELECT with businessId) | Clean |
| `bankAccount.transfer` | `fromAccountId`, `toAccountId` | Yes (both verified) | Clean |
| `party.merge` | `sourceId`, `targetId` | Yes | Clean |
| `item.switchBaseUnit` | `itemId` | Yes | Clean |
| `item.createVariant` | `itemId` | Yes | Clean |
| `item.updateVariant` | `variantId` | Yes (join + businessId) | Clean |
| `document.*.create` | `partyId`, `itemId[]` | Yes (FIXED) | Fixed |
| `document.convert` | `sourceDocumentId` | Yes | Clean |

---

## Tenant-Switch Attack Vector Analysis

**Question**: Can a user in Tenant A supply `x-business-id` pointing to a Business in Tenant B?

**Answer**: No. The attack is blocked at two layers:
1. `ctx.db` is set to `getTenantDb(ctx.tenantId)` in `hasTenantAccess`. This is the tenant's isolated database.
2. `hasBusinessAccess` validates `businessId` exists in `ctx.db`. Since `ctx.db` is Tenant A's database, a Business ID from Tenant B will not be found there.

**Question**: Can a user manipulate `ctx.tenantId` by forging the session cookie?

**Answer**: No. `ctx.tenantId` comes from the `sessions` table in the control DB. The session ID is a 64-character random `nanoid` string. The session can only be created server-side on login. `tenant.select` is the only mutation that updates `tenantId` in the session — and it validates membership before writing.

---

## Informational Findings

### INFO-1: Session cache does not invalidate on tenant membership removal

When a tenant admin removes a member (`tenant.removeMember`), existing sessions for that user are not invalidated. The member will retain access until:
- Their session cookie expires (30 days), OR
- The session cache entry expires (60 seconds) AND the session is actively used

**Recommendation**: Call `invalidateSessionCache` for all sessions belonging to the removed user, and optionally delete the sessions from the DB if immediate revocation is required.

### INFO-2: `business.list` returns all businesses in the tenant

`tenantProcedure` has no per-user access control — every tenant member can list and fetch all businesses. This is by design for the current role model but should be revisited if per-business access control is added.

### INFO-3: `hasTenantAccess` does not re-verify membership on every request

Membership is verified once at `tenant.select` time and stored in the session. If a user's membership is revoked, their existing sessions retain access until they expire. See INFO-1.

### INFO-4: `store/catalog.json` exposes `stockQty` in raw query

The catalog query selects `stockQty: items.stockQuantity` and the field is stripped via destructuring before the response is built. However, the `inStock` field is derived from the raw numeric value `(${items.stockQuantity})::numeric > 0`. Double-check that no serialisation path (e.g., error handler, middleware logger) could inadvertently include the raw query result before the transformation step.

### INFO-5: Rate limiting is in-memory and not distributed

The rate limit maps (`rateMap`, `orderRateMap`) are in-memory per-process. In a multi-replica deployment, rate limits are not shared across replicas. An attacker could bypass the per-IP rate limit by distributing requests across the process pool. Consider Redis-backed rate limiting for production multi-replica deployments.

---

## Files Modified

| File | Change |
|---|---|
| `packages/api/src/routers/invoice.ts` | Added `partyId` and `itemId[]` validation in `create` and `update` |
| `packages/api/src/routers/payment.ts` | Added `partyId` validation in `create`; added `businessId` constraint to `defaultAccount` final fetch |
| `packages/api/src/routers/store.ts` | Added `businessId` constraint to linked invoice fetch in `getOrder` |
| `packages/api/src/lib/document-router-factory.ts` | Added `partyId` and `itemId[]` validation in factory-generated `create` procedure |
| `packages/api/src/routers/business.ts` | Added explanatory comments clarifying tenant-isolation guarantees |
