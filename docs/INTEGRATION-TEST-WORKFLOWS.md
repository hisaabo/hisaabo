# Hisaabo Integration Test Workflow Tree

**Version**: 1.0
**Date**: 2026-03-31
**Author**: Workflow Architect
**Status**: Draft
**Scope**: Every testable API workflow, grouped by test file

---

## Table of Contents

- [A. Entity Lifecycle Workflows (per router)](#a-entity-lifecycle-workflows)
  - [A1. auth.test.ts](#a1-authtestts)
  - [A2. tenant.test.ts](#a2-tenanttestts)
  - [A3. business.test.ts](#a3-businesstestts)
  - [A4. party.test.ts](#a4-partytestts)
  - [A5. item.test.ts](#a5-itemtestts)
  - [A6. invoice.test.ts](#a6-invoicetestts)
  - [A7. payment.test.ts](#a7-paymenttestts)
  - [A8. expense.test.ts](#a8-expensetestts)
  - [A9. bankAccount.test.ts](#a9-bankaccounttestts)
  - [A10. dashboard.test.ts](#a10-dashboardtestts)
  - [A11. gst.test.ts](#a11-gsttestts)
  - [A12. store.test.ts](#a12-storetestts)
  - [A13. shipment.test.ts](#a13-shipmenttestts)
  - [A14. target.test.ts](#a14-targettestts)
  - [A15. apiKey.test.ts](#a15-apikeytestts)
  - [A16. import.test.ts](#a16-importtestts)
  - [A17. document.test.ts](#a17-documenttestts)
  - [A18. reports.test.ts](#a18-reportstestts)
- [B. Cross-Cutting Concern Workflows](#b-cross-cutting-concern-workflows)
  - [B1. multi-tenant-isolation.test.ts](#b1-multi-tenant-isolationtestts)
  - [B2. multi-business-isolation.test.ts](#b2-multi-business-isolationtestts)
  - [B3. role-based-access.test.ts](#b3-role-based-accesstestts)
  - [B4. shared-user-across-tenants.test.ts](#b4-shared-user-across-tenantstestts)
  - [B5. concurrent-access.test.ts](#b5-concurrent-accesstestts)
  - [B6. financial-integrity.test.ts](#b6-financial-integritytestts)
- [C. Docker Image Workflows](#c-docker-image-workflows)
  - [C1. docker-api.test.ts](#c1-docker-apitestts)
  - [C2. docker-once.test.ts](#c2-docker-oncetestts)
- [D. Validation Workflows](#d-validation-workflows)
  - [D1. zod-validation.test.ts](#d1-zod-validationtestts)
  - [D2. business-rule-validation.test.ts](#d2-business-rule-validationtestts)
  - [D3. state-machine-validation.test.ts](#d3-state-machine-validationtestts)

---

## Test Infrastructure Prerequisites

Before any test file runs, the test harness must provide:

```
FIXTURE: Test Infrastructure
  - PostgreSQL instance (test-specific database, wiped between suites)
  - Control schema applied (users, tenants, sessions, tenant_members, invitations, magic_link_tokens, api_keys)
  - Tenant schema applied (businesses, parties, items, invoices, etc.)
  - tRPC caller factory with injectable context (user, tenantId, businessId, req, resHeaders)
  - Helper: createTestUser(email, password, name) -> { userId, sessionId }
  - Helper: createTestTenant(name, ownerUserId) -> { tenantId }
  - Helper: createTestBusiness(tenantId, userId, overrides?) -> { businessId, db }
  - Helper: createTestParty(businessId, db, overrides?) -> { partyId }
  - Helper: createTestItem(businessId, db, overrides?) -> { itemId }
  - Helper: createTestInvoice(businessId, db, overrides?) -> { invoiceId, invoiceNumber }
  - Helper: buildCallerContext(userId, tenantId, businessId, role?) -> Context
```

---

## A. Entity Lifecycle Workflows

---

### A1. auth.test.ts

**File**: `packages/api/src/routers/auth.ts`
**Middleware chain**: publicProcedure (register, login, sendMagicLink, verifyMagicLink, confirmEmailChange), protectedProcedure (logout, logoutAll, completeProfile, updateName, requestEmailChange)

#### Workflow: Password Registration

```
describe("auth.register")

PRE-CONDITIONS: Empty users table

STEP 1: Register with valid credentials
  INPUT: { email: "test@example.com", name: "Test User", password: "securepass1", confirmPassword: "securepass1" }
  ASSERT:
    - Returns { user: { id, email, name }, sessionToken }
    - user.email === "test@example.com"
    - user.name === "Test User"
    - sessionToken is a string of length 64
    - Set-Cookie header contains session_id
    - Database: users table has row with email "test@example.com"
    - Database: users.passwordHash is NOT the plaintext password (argon2id hash)
    - Database: sessions table has row with userId matching user.id
    - Database: session.expiresAt is ~30 days from now
    - Database: tenant_members has row linking user to a tenant (auto-created)
    - IF MULTI_TENANT=true: tenants table has auto-created tenant "{name}'s Organization"
    - IF MULTI_TENANT=false: user joined "default" tenant

STEP 2: Register with duplicate email
  INPUT: { email: "test@example.com", name: "Other", password: "securepass1", confirmPassword: "securepass1" }
  ASSERT:
    - Throws TRPCError with code "CONFLICT"
    - Message: "Email already registered"
    - Database: still only 1 user with this email

STEP 3: Register with mismatched passwords
  INPUT: { email: "new@example.com", name: "New", password: "password1", confirmPassword: "password2" }
  ASSERT:
    - Throws Zod validation error
    - Error path includes "confirmPassword"
    - Message: "Passwords don't match"

STEP 4: Register with short password
  INPUT: { email: "new@example.com", name: "New", password: "short", confirmPassword: "short" }
  ASSERT:
    - Throws Zod validation error on password (min 8)

STEP 5: Register with invalid email
  INPUT: { email: "not-an-email", name: "New", password: "securepass1", confirmPassword: "securepass1" }
  ASSERT:
    - Throws Zod validation error on email

STEP 6: Register with empty name
  INPUT: { email: "new@example.com", name: "", password: "securepass1", confirmPassword: "securepass1" }
  ASSERT:
    - Throws Zod validation error on name (min 2)

STEP 7: Register with Turnstile token (when configured)
  INPUT: { ..., turnstileToken: "invalid-token" }
  ASSERT:
    - IF TURNSTILE_SECRET_KEY is set: Throws FORBIDDEN "Verification failed"
    - IF not set: Turnstile is skipped, registration proceeds
```

#### Workflow: Password Login

```
describe("auth.login")

PRE-CONDITIONS: User "test@example.com" exists with password "securepass1"

STEP 1: Login with correct credentials
  INPUT: { email: "test@example.com", password: "securepass1" }
  ASSERT:
    - Returns { user: { id, email, name }, sessionToken }
    - Set-Cookie header contains session_id
    - Database: new session created

STEP 2: Login with wrong password
  INPUT: { email: "test@example.com", password: "wrongpassword" }
  ASSERT:
    - Throws UNAUTHORIZED "Invalid email or password"
    - No new session created

STEP 3: Login with non-existent email
  INPUT: { email: "nobody@example.com", password: "anything" }
  ASSERT:
    - Throws UNAUTHORIZED "Invalid email or password"
    - Error message is identical to wrong-password case (no enumeration)

STEP 4: Login for magic-link-only user (no passwordHash)
  PRE-CONDITIONS: User exists via magic link (passwordHash is null)
  INPUT: { email: "magiconly@example.com", password: "anything" }
  ASSERT:
    - Throws UNAUTHORIZED "Invalid email or password"

STEP 5: Login for user with no tenant membership
  PRE-CONDITIONS: User exists, tenant_members empty for this user
  INPUT: { email: "orphan@example.com", password: "securepass1" }
  ASSERT:
    - Throws FORBIDDEN "Account has no organization membership"
```

#### Workflow: Magic Link

```
describe("auth.sendMagicLink + auth.verifyMagicLink")

PRE-CONDITIONS: None (handles both new and existing users)

STEP 1: Request magic link for existing user
  INPUT: { email: "existing@example.com" }
  ASSERT:
    - Returns { success: true }
    - Database: magic_link_tokens has new row with email, tokenHash, expiresAt (~15 min)
    - Email service was called with magic link URL

STEP 2: Request magic link for non-existent email
  INPUT: { email: "newuser@example.com" }
  ASSERT:
    - Returns { success: true } (no enumeration)
    - Database: magic_link_tokens still created
    - Email still sent

STEP 3: Verify valid magic link
  INPUT: { token: "<raw-token-from-step-1>" }
  ASSERT:
    - Returns { user, sessionToken, isNewUser: false, needsProfile: false }
    - Database: magic_link_tokens.usedAt is now set
    - Database: users.emailVerified = true
    - Set-Cookie header present

STEP 4: Verify valid magic link for new user (auto-creates account)
  INPUT: { token: "<raw-token-for-new-email>" }
  ASSERT:
    - Returns { user, sessionToken, isNewUser: true, needsProfile: true }
    - Database: new user created with email, emailVerified=true, name=null
    - Database: tenant auto-created and membership established

STEP 5: Verify expired token
  PRE-CONDITIONS: Token created with expiresAt in the past
  INPUT: { token: "<expired-raw-token>" }
  ASSERT:
    - Throws BAD_REQUEST "Invalid, expired, or already used link"

STEP 6: Verify already-used token
  PRE-CONDITIONS: Token already has usedAt set
  INPUT: { token: "<used-raw-token>" }
  ASSERT:
    - Throws BAD_REQUEST (atomic update-returning found no matching row)

STEP 7: Verify tampered token
  INPUT: { token: "random-garbage" }
  ASSERT:
    - Throws BAD_REQUEST

STEP 8: Rate limiting - 6th request within 15 minutes
  PRE-CONDITIONS: 5 tokens already created for this email in last 15 min
  INPUT: { email: "ratelimited@example.com" }
  ASSERT:
    - Returns { success: true } (no error, but no token created)
    - Database: still only 5 tokens for this email
```

#### Workflow: Complete Profile

```
describe("auth.completeProfile")

PRE-CONDITIONS: User authenticated via magic link, user.name is null

STEP 1: Set profile name
  INPUT: { name: "My Name" }
  ASSERT:
    - Returns { success: true }
    - Database: users.name = "My Name"
    - Session cache invalidated (subsequent auth.me returns updated name)

STEP 2: Invalid name (too short)
  INPUT: { name: "A" }
  ASSERT:
    - Throws Zod validation error (min 2)
```

#### Workflow: Email Change

```
describe("auth.requestEmailChange + auth.confirmEmailChange")

PRE-CONDITIONS: User authenticated with email "old@example.com"

STEP 1: Request email change
  INPUT: { newEmail: "new@example.com" }
  ASSERT:
    - Returns { success: true }
    - Database: magic_link_tokens has row with email="new@example.com", userId=current user
    - Email sent to new@example.com

STEP 2: Request change to already-taken email
  INPUT: { newEmail: "existing@example.com" }
  ASSERT:
    - Throws CONFLICT "Email already in use"

STEP 3: Confirm email change
  INPUT: { token: "<raw-token>" }
  ASSERT:
    - Returns { success: true, newEmail: "new@example.com" }
    - Database: user.email = "new@example.com", emailVerified = true
    - userId is read from token row, NOT from client input (security)

STEP 4: Confirm with token that has no userId (not an email-change token)
  INPUT: { token: "<magic-link-token-without-userId>" }
  ASSERT:
    - Throws BAD_REQUEST "Invalid or expired link"
```

#### Workflow: Session Management

```
describe("auth.me / auth.logout / auth.logoutAll / auth.updateName")

PRE-CONDITIONS: User authenticated

STEP 1: auth.me returns current user
  ASSERT:
    - Returns { user: { id, email, name }, tenantId, tenantName, role, needsProfile }
    - tenantId matches session's tenantId
    - role is the mapped CASL role from tenant_members

STEP 2: auth.me for unauthenticated request
  PRE-CONDITIONS: No session cookie
  ASSERT:
    - Returns { user: null, tenantId: null, tenantName: null, role: null, needsProfile: false }

STEP 3: auth.logout
  ASSERT:
    - Returns { success: true }
    - Database: session row deleted
    - Set-Cookie clears session_id (Max-Age=0)

STEP 4: auth.logoutAll
  PRE-CONDITIONS: User has 3 active sessions
  ASSERT:
    - Returns { success: true }
    - Database: all 3 sessions deleted
    - All session cache entries evicted

STEP 5: auth.updateName
  INPUT: { name: "Updated Name" }
  ASSERT:
    - Returns { success: true }
    - Database: users.name = "Updated Name"
    - Session cache invalidated
```

---

### A2. tenant.test.ts

**File**: `packages/api/src/routers/tenant.ts`
**Middleware chain**: protectedProcedure (list, select, acceptInvitation), tenantProcedure (current, members, inviteMember, removeMember, updateMemberRole)

#### Workflow: Tenant Listing and Selection

```
describe("tenant.list + tenant.select")

PRE-CONDITIONS: User is member of 2 tenants (Org-A as owner, Org-B as seller)

STEP 1: List tenants
  ASSERT:
    - Returns array of 2 memberships
    - Each has: { tenantId, role, tenantName, tenantSlug, tenantPlan }
    - Only active tenants included

STEP 2: Select a tenant
  INPUT: { tenantId: "<org-b-id>" }
  ASSERT:
    - Returns { success: true }
    - Database: sessions.tenantId updated to org-b-id
    - Subsequent requests use org-b-id for tenant context

STEP 3: Select tenant user is NOT a member of
  INPUT: { tenantId: "<random-uuid>" }
  ASSERT:
    - Throws FORBIDDEN "Not a member of this organization"
    - Session tenantId unchanged
```

#### Workflow: Member Invitation

```
describe("tenant.inviteMember")

PRE-CONDITIONS: Caller is owner of tenant

STEP 1: Invite new member
  INPUT: { email: "newmember@example.com", role: "seller" }
  ASSERT:
    - Returns { token: <raw-token-string>, expiresAt: <7-days-from-now> }
    - Database: invitations row created with tokenHash (NOT raw token), role="seller"
    - expiresAt is ~7 days from now

STEP 2: Invite already-existing member
  PRE-CONDITIONS: "existing@example.com" is already a member
  INPUT: { email: "existing@example.com", role: "admin" }
  ASSERT:
    - Throws CONFLICT "User is already a member"

STEP 3: Invite with insufficient permissions
  PRE-CONDITIONS: Caller has role "seller" (not owner/superadmin/admin)
  INPUT: { email: "someone@example.com", role: "seller" }
  ASSERT:
    - Throws FORBIDDEN "Only owners and admins can invite members"
```

#### Workflow: Accept Invitation

```
describe("tenant.acceptInvitation")

PRE-CONDITIONS: Invitation exists for "invitee@example.com", caller is logged in as invitee@example.com

STEP 1: Accept valid invitation
  INPUT: { token: "<raw-invitation-token>" }
  ASSERT:
    - Returns { tenantId }
    - Database: tenant_members row created with role from invitation
    - Database: invitations.acceptedAt set
    - Atomic: membership creation and invitation acceptance in same transaction

STEP 2: Accept expired invitation
  PRE-CONDITIONS: invitation.expiresAt is in the past
  INPUT: { token: "<expired-token>" }
  ASSERT:
    - Throws NOT_FOUND "Invalid or expired invitation"

STEP 3: Accept already-accepted invitation
  PRE-CONDITIONS: invitation.acceptedAt is already set
  INPUT: { token: "<used-token>" }
  ASSERT:
    - Throws BAD_REQUEST "Invitation already accepted"

STEP 4: Accept invitation addressed to different email
  PRE-CONDITIONS: Caller email is "other@example.com", invitation is for "invitee@example.com"
  INPUT: { token: "<token-for-different-email>" }
  ASSERT:
    - Throws FORBIDDEN "This invitation was sent to a different email address"

STEP 5: Accept invitation when already a member (double-click)
  PRE-CONDITIONS: Caller is already a member of this tenant
  INPUT: { token: "<valid-token>" }
  ASSERT:
    - Returns { tenantId } (no error)
    - Database: invitation marked accepted, no duplicate membership
```

#### Workflow: Remove Member

```
describe("tenant.removeMember")

PRE-CONDITIONS: Caller is owner, target is a "seller" member

STEP 1: Remove a regular member
  INPUT: { userId: "<seller-user-id>" }
  ASSERT:
    - Returns { success: true }
    - Database: tenant_members row deleted

STEP 2: Remove self
  INPUT: { userId: "<caller-user-id>" }
  ASSERT:
    - Throws BAD_REQUEST "Cannot remove yourself"

STEP 3: Remove a superadmin/owner
  PRE-CONDITIONS: Target has role "owner" or "superadmin"
  INPUT: { userId: "<owner-user-id>" }
  ASSERT:
    - Throws FORBIDDEN "Cannot remove a superadmin"

STEP 4: Remove with insufficient permissions
  PRE-CONDITIONS: Caller has role "seller"
  ASSERT:
    - Throws FORBIDDEN "Only owners and admins can remove members"
```

#### Workflow: Update Member Role

```
describe("tenant.updateMemberRole")

PRE-CONDITIONS: Caller is owner

STEP 1: Change seller to admin
  INPUT: { userId: "<seller-id>", role: "admin" }
  ASSERT:
    - Returns { success: true }
    - Database: tenant_members.role = "admin"

STEP 2: Change owner/superadmin role
  INPUT: { userId: "<owner-id>", role: "seller" }
  ASSERT:
    - Throws FORBIDDEN "Cannot change the role of a superadmin"

STEP 3: Change role with insufficient permissions
  PRE-CONDITIONS: Caller is "seller"
  ASSERT:
    - Throws FORBIDDEN "Only owners and admins can change roles"
```

---

### A3. business.test.ts

**File**: `packages/api/src/routers/business.ts`
**Middleware chain**: tenantProcedure (list, getById, create, update, updateSequenceNumber), viewerProcedure/adminProcedure (auditTrail, exportData)

#### Workflow: Business CRUD

```
describe("business.create + business.list + business.getById + business.update")

PRE-CONDITIONS: User is owner of tenant, tenant DB initialized

STEP 1: Create business
  INPUT: {
    name: "My Shop",
    pan: "ABCDE1234F",
    phone: "9876543210",
    address: "123 Main St",
    invoicePrefix: "INV",
    currency: "INR"
  }
  ASSERT:
    - Returns business object with generated UUID
    - business.createdByUserId = caller's userId
    - business.nextInvoiceNumber = 1
    - business.nextPaymentNumber = 1
    - business.financialYearStart = 4 (April)
    - Database: bank_accounts has auto-created "Cash" account for this business
    - Cash account: accountType="cash", openingBalance="0", currentBalance="0"

STEP 2: List businesses
  ASSERT:
    - Returns array containing the created business
    - Only businesses in caller's tenant DB are returned

STEP 3: Get business by ID
  INPUT: { id: "<business-id>" }
  ASSERT:
    - Returns full business object
    - All fields match what was created

STEP 4: Update business
  INPUT: { id: "<business-id>", data: { name: "Updated Shop", gstin: "29ABCDE1234F1Z5" } }
  ASSERT:
    - Returns updated business
    - name = "Updated Shop"
    - gstin = "29ABCDE1234F1Z5"
    - updatedAt changed

STEP 5: Create business without admin role
  PRE-CONDITIONS: Caller has role "seller" in tenant
  ASSERT:
    - Throws FORBIDDEN "Only admins can manage businesses"
```

#### Workflow: Sequence Number Management

```
describe("business.updateSequenceNumber")

PRE-CONDITIONS: Business exists with nextInvoiceNumber = 5

STEP 1: Advance invoice number
  INPUT: { businessId: "<id>", documentType: "invoice", newNumber: 100 }
  ASSERT:
    - Returns { success: true, previousNumber: 5, newNumber: 100 }
    - Database: businesses.next_invoice_number = 100

STEP 2: Attempt to go backwards
  INPUT: { businessId: "<id>", documentType: "invoice", newNumber: 3 }
  ASSERT:
    - Throws BAD_REQUEST "New number (3) cannot be less than current (100)"

STEP 3: Invalid document type
  INPUT: { businessId: "<id>", documentType: "nonexistent", newNumber: 1 }
  ASSERT:
    - Throws BAD_REQUEST "Invalid document type"
```

#### Workflow: Audit Trail

```
describe("business.auditTrail")

PRE-CONDITIONS: Several audited actions have occurred

STEP 1: Fetch audit trail
  INPUT: { page: 1, limit: 10 }
  ASSERT:
    - Returns { data: [...], page, limit }
    - Each entry has: action, entityType, entityId, userId, metadata, createdAt
    - Ordered by createdAt DESC
```

#### Workflow: Data Export

```
describe("business.exportData")

PRE-CONDITIONS: Business has parties, items, invoices, payments, expenses

STEP 1: Export all data
  ASSERT:
    - Returns { parties, items, invoices, lineItems, payments, expenses }
    - Each is a CSV string with header row
    - CSV fields match expected columns
    - Only data from this business is included
```

---

### A4. party.test.ts

**File**: `packages/api/src/routers/party.ts`
**Middleware chain**: viewerProcedure (list, getById, topItems, ledger), memberProcedure (create, update), adminProcedure (delete)

#### Workflow: Party CRUD

```
describe("party.create + party.list + party.getById + party.update + party.delete")

PRE-CONDITIONS: Business exists, caller has "admin" role

STEP 1: Create customer party
  INPUT: {
    type: "customer",
    name: "Acme Corp",
    phone: "9876543210",
    email: "acme@example.com",
    gstin: "29ABCDE1234F1Z5",
    openingBalance: "1000.50"
  }
  ASSERT:
    - Returns party with UUID, businessId matching ctx.businessId
    - All fields match input
    - openingBalance = "1000.50" (string, not float)

STEP 2: Create supplier party
  INPUT: { type: "supplier", name: "Raw Materials Inc" }
  ASSERT:
    - Returns party with type = "supplier"

STEP 3: List all parties (no filter)
  INPUT: { page: 1, limit: 20 }
  ASSERT:
    - Returns { data, total, page, limit }
    - total = 2
    - Each party has computed `balance` field

STEP 4: List with type filter
  INPUT: { filter: "customer", page: 1, limit: 20 }
  ASSERT:
    - Returns only customer parties

STEP 5: List with search
  INPUT: { search: "Acme", page: 1, limit: 20 }
  ASSERT:
    - Returns parties matching "Acme" (ILIKE)

STEP 6: List with "outstanding" filter
  PRE-CONDITIONS: Party has unpaid invoices
  INPUT: { filter: "outstanding", page: 1, limit: 20 }
  ASSERT:
    - Returns only parties with balance > 0

STEP 7: List with "overdue" filter
  PRE-CONDITIONS: Party has invoice with status "overdue"
  INPUT: { filter: "overdue", page: 1, limit: 20 }
  ASSERT:
    - Returns only parties with overdue invoices

STEP 8: List sorted by balance
  INPUT: { sortBy: "balance", sortDir: "desc", page: 1, limit: 20 }
  ASSERT:
    - Parties ordered by computed balance DESC

STEP 9: Get party by ID
  INPUT: { id: "<party-id>" }
  ASSERT:
    - Returns full party with computed balance
    - balance = openingBalance + totalInvoiced - totalPaid

STEP 10: Get non-existent party
  INPUT: { id: "<random-uuid>" }
  ASSERT:
    - Returns null (not an error)

STEP 11: Update party
  INPUT: { id: "<party-id>", data: { name: "Acme Corp Updated", phone: "1111111111" } }
  ASSERT:
    - Returns updated party
    - name changed, phone changed
    - updatedAt changed
    - type NOT changeable via update (omitted from updatePartySchema)

STEP 12: Delete party
  INPUT: { id: "<party-id>" }
  ASSERT:
    - Returns { success: true }
    - Database: party row deleted
    - NOTE: If party has invoices, FK constraint with onDelete="restrict" will THROW
      - This is a business rule: cannot delete party with invoices
      - Test should verify the database error is propagated

STEP 13: Delete party that has invoices
  PRE-CONDITIONS: Party has at least one invoice
  INPUT: { id: "<party-with-invoices>" }
  ASSERT:
    - Throws error (FK constraint violation, onDelete="restrict")
```

#### Workflow: Party Top Items

```
describe("party.topItems")

PRE-CONDITIONS: Party has 7 different items across multiple invoices

STEP 1: Get top items for party
  INPUT: { partyId: "<party-id>" }
  ASSERT:
    - Returns array of up to 5 items
    - Each has: itemId, itemName, totalQuantity, totalAmount, invoiceCount
    - Ordered by totalQuantity DESC
    - Only non-cancelled invoices counted
    - Only "invoice" documentType counted
```

---

### A5. item.test.ts

**File**: `packages/api/src/routers/item.ts`
**Middleware chain**: viewerProcedure (list, getById, salesStats, priceHistory, stockMovements, relatedInvoices, topBuyers, listVariants, stockAdjustmentHistory, lowStockCount, suggestMerges), memberProcedure (create, update, switchBaseUnit, createVariant, updateVariant, bulkCreateVariants, adjustStock), adminProcedure (delete, deleteVariant, renameUnit, merge)

#### Workflow: Simple Item CRUD

```
describe("item.create (simple) + item.list + item.getById + item.update + item.delete")

PRE-CONDITIONS: Business exists

STEP 1: Create simple product
  INPUT: {
    name: "Widget A",
    unit: "pcs",
    itemMode: "simple",
    salePrice: "100.00",
    purchasePrice: "60.00",
    taxPercent: "18",
    stockQuantity: "50",
    lowStockAlert: "10",
    hsn: "8471",
    itemType: "product"
  }
  ASSERT:
    - Returns item with UUID, businessId
    - stockQuantity = "50" (string)
    - itemMode = "simple"
    - variants = [] (empty array)

STEP 2: Create service item
  INPUT: { name: "Consulting", itemType: "service", salePrice: "5000.00", unit: "person" }
  ASSERT:
    - Returns item with itemType = "service"

STEP 3: List items
  INPUT: { page: 1, limit: 20 }
  ASSERT:
    - Returns { data, total, page, limit }
    - Each item has: variantCount (null for simple), variantTotalStock (null for simple)
    - Ordered by updatedAt DESC

STEP 4: List with search
  INPUT: { search: "Widget", page: 1, limit: 20 }
  ASSERT:
    - Returns matching items (ILIKE)

STEP 5: List with lowStock filter
  PRE-CONDITIONS: Widget has stock=5 and lowStockAlert=10
  INPUT: { lowStock: true, page: 1, limit: 20 }
  ASSERT:
    - Returns items where stockQuantity <= lowStockAlert

STEP 6: Get item by ID
  INPUT: { id: "<item-id>" }
  ASSERT:
    - Returns full item
    - For simple items: variants = []

STEP 7: Update item
  INPUT: { id: "<item-id>", data: { name: "Widget A v2", salePrice: "120.00" } }
  ASSERT:
    - Returns updated item
    - salePrice = "120.00"

STEP 8: Delete item
  INPUT: { id: "<item-id>" }
  ASSERT:
    - Returns { success: true }
    - Database: item row deleted
    - Note: invoiceItems with this itemId get set to null (onDelete: "set null")
```

#### Workflow: Item with Variants

```
describe("item.create (variants) + variant CRUD")

STEP 1: Create variant item with initial variants
  INPUT: {
    name: "T-Shirt",
    itemMode: "variants",
    variantAttributes: ["Size", "Color"],
    variants: [
      { attributeValues: { Size: "S", Color: "Red" }, salePrice: "500", stockQuantity: "20" },
      { attributeValues: { Size: "M", Color: "Blue" }, salePrice: "550", stockQuantity: "30" },
    ]
  }
  ASSERT:
    - Returns item with itemMode = "variants"
    - item.variants has 2 entries
    - Each variant has: attributeValues, salePrice, stockQuantity

STEP 2: Create additional variant
  INPUT: { itemId: "<item-id>", variant: { attributeValues: { Size: "L", Color: "Green" }, salePrice: "600", stockQuantity: "10" } }
  ASSERT:
    - Returns new variant
    - item now has 3 variants

STEP 3: Create variant on non-variant item
  PRE-CONDITIONS: Item has itemMode = "simple"
  INPUT: { itemId: "<simple-item-id>", variant: { ... } }
  ASSERT:
    - Throws BAD_REQUEST "Item is not in variants mode"

STEP 4: Bulk create variants
  INPUT: { itemId: "<item-id>", variants: [{ ... }, { ... }, { ... }] }
  ASSERT:
    - Returns array of created variants
    - Max 100 per call

STEP 5: Update variant
  INPUT: { variantId: "<variant-id>", data: { salePrice: "650" } }
  ASSERT:
    - Returns updated variant

STEP 6: Delete variant
  INPUT: { variantId: "<variant-id>" }
  ASSERT:
    - Returns { success: true }
    - invoiceItems with this variantId get set to null

STEP 7: List item by ID returns variants
  INPUT: { id: "<variant-item-id>" }
  ASSERT:
    - item.variants is populated
    - Ordered by createdAt

STEP 8: List items shows variant summary
  ASSERT:
    - Variant item has variantCount = N, variantTotalStock = sum of variant stocks
```

#### Workflow: Alt Units Item

```
describe("item.create (alt_units) + switchBaseUnit")

STEP 1: Create alt_units item
  INPUT: {
    name: "Rice",
    itemMode: "alt_units",
    unit: "kg",
    salePrice: "80.00",
    stockQuantity: "100",
    unitVariants: [
      { unit: "g", conversionFactor: 0.001, salePrice: "0.08" },
      { unit: "bag", conversionFactor: 25, salePrice: "1900.00" },
    ]
  }
  ASSERT:
    - Returns item with itemMode = "alt_units"
    - unitVariants stored as JSONB

STEP 2: Cannot mix unitVariants with product variants
  INPUT: { name: "Bad", itemMode: "variants", unitVariants: [{ unit: "g", conversionFactor: 0.001, salePrice: "1" }] }
  ASSERT:
    - Throws Zod refine error

STEP 3: Switch base unit
  INPUT: { id: "<rice-id>", newUnit: "g", conversionFactor: 1000 }
  ASSERT:
    - item.unit changed to "g"
    - item.stockQuantity changed from "100" to "100000" (100 * 1000)
    - item.salePrice changed from "80.00" to "0.08" (80 / 1000)
    - item.unitVariants: old base "kg" added as variant with factor 0.001
    - invoice_items updated: conversion_factor multiplied by 1/1000

STEP 4: Cannot switch base unit on variant item
  INPUT: { id: "<variant-item-id>", newUnit: "g", conversionFactor: 1000 }
  ASSERT:
    - Throws BAD_REQUEST "Cannot switch base unit on a variant item"
```

#### Workflow: Stock Adjustment

```
describe("item.adjustStock")

PRE-CONDITIONS: Item exists with stockQuantity = "50"

STEP 1: Add stock
  INPUT: { itemId: "<id>", quantity: "10", reason: "New shipment received" }
  ASSERT:
    - Returns stock_adjustments record
    - adjustment.previousStock = "50.000"
    - adjustment.newStock = "60.000"
    - adjustment.quantity = "10"
    - Database: items.stockQuantity = "60.000"

STEP 2: Remove stock
  INPUT: { itemId: "<id>", quantity: "-5", reason: "Damaged goods" }
  ASSERT:
    - newStock = "55.000"

STEP 3: Adjust variant stock
  INPUT: { itemId: "<id>", variantId: "<variant-id>", quantity: "15", reason: "Restock" }
  ASSERT:
    - item_variants.stockQuantity updated (not items.stockQuantity)

STEP 4: Zero quantity rejected
  INPUT: { itemId: "<id>", quantity: "0" }
  ASSERT:
    - Throws Zod error "Quantity cannot be zero"

STEP 5: Stock adjustment history
  INPUT: { itemId: "<id>", page: 1, limit: 20 }
  ASSERT:
    - Returns paginated list of adjustments
    - Ordered by adjustmentDate DESC
```

#### Workflow: Item Merge

```
describe("item.suggestMerges + item.merge")

PRE-CONDITIONS: Items exist: "Okra", "Okra 0.25", "Okra 0.5"

STEP 1: Get merge suggestions
  ASSERT:
    - Returns suggestions with baseName "Okra"
    - suggestedConversions shows Okra 0.25 -> Okra (factor 0.25), Okra 0.5 -> Okra (factor 0.5)

STEP 2: Merge items
  INPUT: { sourceId: "<okra-025-id>", targetId: "<okra-id>", stockConversionFactor: 0.25 }
  ASSERT:
    - Returns { success: true, mergedInto: "<okra-id>" }
    - Database: source item deleted
    - Database: invoice_items re-linked from source to target with adjusted conversion_factor
    - Database: target stockQuantity increased by (source stock * 0.25)

STEP 3: Cannot merge item into itself
  INPUT: { sourceId: "<id>", targetId: "<id>", stockConversionFactor: 1 }
  ASSERT:
    - Throws BAD_REQUEST "Cannot merge an item into itself"

STEP 4: Cannot merge variant items
  INPUT: { sourceId: "<variant-item>", targetId: "<simple-item>", stockConversionFactor: 1 }
  ASSERT:
    - Throws BAD_REQUEST "Cannot merge variant items"
```

#### Workflow: Item Analytics

```
describe("item.salesStats + item.priceHistory + item.stockMovements + item.topBuyers + item.relatedInvoices + item.lowStockCount")

PRE-CONDITIONS: Item has been used in multiple invoices (sale and purchase)

STEP 1: salesStats
  INPUT: { id: "<item-id>" }
  ASSERT:
    - Returns: totalSaleAmount, totalSaleQty, avgGrossPrice, avgNetPrice,
      totalPurchaseAmount, totalPurchaseQty, saleInvoiceCount
    - Excludes draft and cancelled invoices
    - Only "invoice" documentType

STEP 2: priceHistory
  INPUT: { id: "<item-id>" }
  ASSERT:
    - Returns array of up to 50 entries
    - Each has: invoiceDate, invoiceNumber, invoiceType, unitPrice, quantity, partyName
    - Ordered by invoiceDate DESC

STEP 3: stockMovements
  INPUT: { id: "<item-id>" }
  ASSERT:
    - Returns array with direction annotation ("in" or "out")
    - sale/delivery_challan = "out", purchase/return = "in"

STEP 4: relatedInvoices (paginated)
  INPUT: { id: "<item-id>", page: 1, limit: 10 }
  ASSERT:
    - Returns distinct invoices containing this item

STEP 5: topBuyers
  INPUT: { id: "<item-id>" }
  ASSERT:
    - Returns up to 5 parties
    - Ordered by totalAmount DESC

STEP 6: lowStockCount
  ASSERT:
    - Returns integer count
    - Includes both simple items with lowStockAlert and variant items with lowStockAlert
```

---

### A6. invoice.test.ts

**File**: `packages/api/src/routers/invoice.ts`
**Middleware chain**: viewerProcedure (list, getById, lastDeliveryMethod), memberProcedure (create, update, updateStatus), adminProcedure (delete)

#### Workflow: Invoice Creation

```
describe("invoice.create")

PRE-CONDITIONS: Business exists with nextInvoiceNumber=1, invoicePrefix="INV".
  Party "Acme" exists. Items "Widget" (stock=100) and "Gadget" (stock=50) exist.

STEP 1: Create sale invoice with 2 line items
  INPUT: {
    partyId: "<acme-id>",
    type: "sale",
    invoiceDate: "2026-03-15T00:00:00.000Z",
    dueDate: "2026-04-15T00:00:00.000Z",
    lineItems: [
      { itemId: "<widget-id>", description: "Widget A", quantity: "10", unitPrice: "100.00", taxPercent: "18", discountPercent: "5" },
      { itemId: "<gadget-id>", description: "Gadget B", quantity: "5", unitPrice: "200.00", taxPercent: "12" }
    ],
    notes: "Test invoice"
  }
  ASSERT:
    - Returns invoice with invoiceNumber = "INV-00001"
    - documentType = "invoice"
    - status = "draft"
    - subtotal, taxAmount, totalAmount computed using fixed-point arithmetic
    - Line item totals match calcLineItem() output
    - Database: businesses.nextInvoiceNumber = 2 (atomically incremented)
    - Database: items "Widget" stockQuantity = 90 (100 - 10)
    - Database: items "Gadget" stockQuantity = 45 (50 - 5)
    - Database: invoice_items has 2 rows with sortOrder 0 and 1
    - Database: audit_log has entry for "invoice.create"

STEP 2: Create purchase invoice (stock INCREMENT)
  INPUT: { partyId: "<supplier-id>", type: "purchase", lineItems: [{ itemId: "<widget-id>", quantity: "20", ... }] }
  ASSERT:
    - Database: items "Widget" stockQuantity = 110 (90 + 20)

STEP 3: Create invoice with variant items
  INPUT: { lineItems: [{ itemId: "<tshirt-id>", variantId: "<size-m-red-id>", quantity: "3", ... }] }
  ASSERT:
    - Database: item_variants.stockQuantity decremented by 3 (NOT items.stockQuantity)
    - conversionFactor forced to "1" for variant items

STEP 4: Create invoice with conversion factor (alt_units item)
  INPUT: { lineItems: [{ itemId: "<rice-id>", quantity: "2", conversionFactor: "25", selectedUnit: "bag", ... }] }
  ASSERT:
    - Database: items.stockQuantity decremented by 50 (2 * 25)

STEP 5: Create invoice with skipStockAdjustment=true
  INPUT: { skipStockAdjustment: true, lineItems: [{ itemId: "<widget-id>", quantity: "5", ... }] }
  ASSERT:
    - Database: items.stockQuantity UNCHANGED (no decrement)

STEP 6: Create invoice with charges (shipping, packaging)
  INPUT: {
    charges: [
      { label: "Shipping", amount: "100.00" },
      { label: "Packaging", amount: "50.00" }
    ],
    lineItems: [...]
  }
  ASSERT:
    - invoice.charges stored as JSONB
    - invoice.additionalCharges = "150.00"
    - invoice.totalAmount includes charges
    - Database: shipments row auto-created (because "Shipping" charge on sale invoice)

STEP 7: Create invoice with round-off
  INPUT: { roundOff: "-0.50", lineItems: [...] }
  ASSERT:
    - invoice.totalAmount adjusted by -0.50

STEP 8: Create invoice with invoice-level discount
  INPUT: { invoiceDiscount: "10", invoiceDiscountType: "percent", lineItems: [...] }
  ASSERT:
    - discountAmount computed as 10% of subtotal

STEP 9: Atomic invoice number generation under concurrent access
  (Covered in B5. concurrent-access.test.ts)

STEP 10: Party from different business (security)
  INPUT: { partyId: "<party-from-other-business>", type: "sale", lineItems: [...] }
  ASSERT:
    - Throws BAD_REQUEST "Party not found in this business"

STEP 11: Item from different business (security)
  INPUT: { lineItems: [{ itemId: "<item-from-other-business>", ... }] }
  ASSERT:
    - Throws BAD_REQUEST "One or more items do not belong to this business"

STEP 12: Empty line items
  INPUT: { partyId: "<id>", type: "sale", lineItems: [] }
  ASSERT:
    - Throws Zod validation error (min 1)

STEP 13: Zero quantity line item
  INPUT: { lineItems: [{ quantity: "0", ... }] }
  ASSERT:
    - Throws Zod validation error "Quantity must be greater than 0"

STEP 14: Tax percent exceeds 56%
  INPUT: { lineItems: [{ taxPercent: "60", ... }] }
  ASSERT:
    - Throws Zod validation error "Tax percent cannot exceed 56%"
```

#### Workflow: Invoice Listing

```
describe("invoice.list")

PRE-CONDITIONS: 10 invoices exist with various types, statuses, dates

STEP 1: List all invoices
  INPUT: { page: 1, limit: 20 }
  ASSERT:
    - Returns { data, total, page, limit }
    - Only documentType="invoice" returned (not quotations, etc.)
    - Soft-deleted invoices excluded (deletedAt IS NULL)
    - Includes partyName via JOIN

STEP 2: Filter by type
  INPUT: { type: "sale", page: 1, limit: 20 }
  ASSERT: Only sale invoices returned

STEP 3: Filter by status "overdue"
  INPUT: { status: "overdue", page: 1, limit: 20 }
  ASSERT:
    - Returns invoices where dueDate < NOW() AND status NOT IN ('paid','cancelled','draft')
    - This is a COMPUTED filter (not a stored status)

STEP 4: Filter by partyId
  INPUT: { partyId: "<id>", page: 1, limit: 20 }
  ASSERT: Only invoices for this party

STEP 5: Filter by date range
  INPUT: { fromDate: "2026-01-01T...", toDate: "2026-03-31T...", page: 1, limit: 20 }
  ASSERT: Only invoices within range

STEP 6: Search by invoice number or party name
  INPUT: { search: "INV-00001", page: 1, limit: 20 }
  ASSERT: Matching invoices returned (ILIKE on invoiceNumber and partyName)

STEP 7: Filter by itemId
  INPUT: { itemId: "<widget-id>", page: 1, limit: 20 }
  ASSERT: Only invoices containing this item

STEP 8: Sort by amount DESC
  INPUT: { sortBy: "amount", sortDir: "desc", page: 1, limit: 20 }
  ASSERT: Invoices ordered by totalAmount DESC
```

#### Workflow: Invoice Update

```
describe("invoice.update")

PRE-CONDITIONS: Draft invoice with 2 line items exists

STEP 1: Update line items (triggers stock reversal + re-application)
  INPUT: {
    id: "<invoice-id>",
    lineItems: [
      { itemId: "<widget-id>", description: "Widget A", quantity: "20", unitPrice: "100.00", taxPercent: "18" }
    ]
  }
  ASSERT:
    - Old line items deleted
    - Old stock effect reversed (Widget +10 back, Gadget +5 back)
    - New stock effect applied (Widget -20)
    - Totals recalculated
    - Net Widget stock change: original 100 -> 90 (create) -> 100 (reverse) -> 80 (new)

STEP 2: Update party (security check)
  INPUT: { id: "<invoice-id>", partyId: "<different-party-id>" }
  ASSERT:
    - Party validated against businessId
    - Invoice partyId updated

STEP 3: Cannot edit paid invoice
  PRE-CONDITIONS: Invoice has status = "paid"
  INPUT: { id: "<paid-invoice-id>", notes: "updated" }
  ASSERT:
    - Throws BAD_REQUEST "Cannot edit a paid invoice. Remove payments first."

STEP 4: Update metadata only (no line items)
  INPUT: { id: "<id>", notes: "new notes", dueDate: "2026-05-01T..." }
  ASSERT:
    - Notes and dueDate updated
    - No stock changes
    - Line items unchanged
```

#### Workflow: Invoice Status Update

```
describe("invoice.updateStatus")

STEP 1: Draft -> Sent
  INPUT: { id: "<id>", status: "sent" }
  ASSERT: status = "sent"

STEP 2: Any status transition allowed
  NOTE: The invoice router does NOT enforce a state machine. Any status
  can transition to any other status. This is by design for flexibility.
  State machine validation tests are in D3.
```

#### Workflow: Invoice Deletion

```
describe("invoice.delete")

PRE-CONDITIONS: Sale invoice exists with 2 line items

STEP 1: Soft-delete invoice
  INPUT: { id: "<id>" }
  ASSERT:
    - Returns { success: true }
    - Database: invoice.deletedAt is set
    - Database: invoice.status = "cancelled"
    - Database: audit_log entry for "invoice.delete"
    - NOTE: Stock is NOT reversed on invoice soft-delete (by design in invoice router)
      - The document-factory router DOES reverse stock on delete, but invoice router does not
      - This is a FINDING to verify/confirm

STEP 2: Delete already-deleted invoice (idempotent)
  INPUT: { id: "<already-deleted-id>" }
  ASSERT: Returns { success: true } (no error)

STEP 3: Delete non-existent invoice
  INPUT: { id: "<random-uuid>" }
  ASSERT: Returns { success: true } (graceful)

STEP 4: Seller_manager deletion constraints
  PRE-CONDITIONS: Caller has role "seller_manager"
  BRANCH A: Delete unpaid invoice created < 2 hours ago
    ASSERT: Succeeds
  BRANCH B: Delete paid invoice
    ASSERT: Throws FORBIDDEN "Cannot delete paid invoices"
  BRANCH C: Delete invoice created > 2 hours ago
    ASSERT: Throws FORBIDDEN "Can only delete invoices within 2 hours of creation"
```

---

### A7. payment.test.ts

**File**: `packages/api/src/routers/payment.ts`
**Middleware chain**: viewerProcedure (list, getById, unpaidInvoices, defaultAccount, untrackedPayments), memberProcedure (create, update, assignAccount), adminProcedure (delete)

#### Workflow: Payment Creation

```
describe("payment.create")

PRE-CONDITIONS: Business with nextPaymentNumber=1, party "Acme" with a sale invoice
  (totalAmount="1000.00", amountPaid="0", status="sent")

STEP 1: Create payment against single invoice
  INPUT: {
    partyId: "<acme-id>",
    invoiceId: "<invoice-id>",
    amount: "500.00",
    mode: "upi",
    referenceNumber: "UPI123"
  }
  ASSERT:
    - Returns payment with paymentNumber = "PAY-00001"
    - Database: businesses.nextPaymentNumber = 2
    - Database: invoice.amountPaid = "500.00"
    - Database: invoice.status = "partial" (500 < 1000)
    - Database: audit_log entry for "payment.create"

STEP 2: Create payment that fully pays invoice
  INPUT: { partyId: "<acme-id>", invoiceId: "<invoice-id>", amount: "500.00", mode: "cash" }
  ASSERT:
    - Database: invoice.amountPaid = "1000.00"
    - Database: invoice.status = "paid" (1000 >= 1000)

STEP 3: Create multi-invoice allocation payment
  PRE-CONDITIONS: 2 unpaid invoices: INV-1 (balance 300), INV-2 (balance 700)
  INPUT: {
    partyId: "<id>",
    amount: "800.00",
    mode: "bank",
    allocations: [
      { invoiceId: "<inv-1-id>", amount: "300.00" },
      { invoiceId: "<inv-2-id>", amount: "500.00" }
    ]
  }
  ASSERT:
    - INV-1: amountPaid increased by 300, status = "paid"
    - INV-2: amountPaid increased by 500, status = "partial"
    - payment.invoiceId = first allocation's invoiceId (backward compat)

STEP 4: Overpayment guard
  PRE-CONDITIONS: Invoice balance = "200.00"
  INPUT: { allocations: [{ invoiceId: "<id>", amount: "300.00" }] }
  ASSERT:
    - Throws BAD_REQUEST "Allocation 300.00 exceeds invoice balance 200.00"
    - Transaction rolled back, no partial state

STEP 5: Payment with bank account
  PRE-CONDITIONS: Bank account "HDFC Savings" with currentBalance = "5000.00"
  INPUT: { bankAccountId: "<hdfc-id>", amount: "500.00", mode: "bank", invoiceId: "<sale-inv-id>" }
  ASSERT:
    - Database: bank_transactions row created (type="deposit" for sale payment)
    - Database: bankAccounts.currentBalance = "5500.00" (5000 + 500)

STEP 6: Payment for purchase invoice (withdrawal)
  INPUT: { bankAccountId: "<hdfc-id>", amount: "300.00", mode: "bank", invoiceId: "<purchase-inv-id>" }
  ASSERT:
    - Database: bank_transactions.type = "withdrawal"
    - Database: bankAccounts.currentBalance decreased by 300

STEP 7: Payment with no invoice (unlinked party payment)
  INPUT: { partyId: "<id>", amount: "1000.00", mode: "cash" }
  ASSERT:
    - payment.invoiceId = null
    - No invoice status changes

STEP 8: Party from different business (security)
  INPUT: { partyId: "<party-from-other-biz>", amount: "100", mode: "cash" }
  ASSERT:
    - Throws BAD_REQUEST "Party not found in this business"
```

#### Workflow: Payment Update

```
describe("payment.update")

PRE-CONDITIONS: Payment PAY-00001 exists for 500.00 against INV-00001, linked to bank account

STEP 1: Update amount
  INPUT: { id: "<payment-id>", amount: "600.00" }
  ASSERT:
    - Old allocation reversed: invoice.amountPaid -= 500
    - Old bank transaction reversed: balance adjusted
    - New allocation applied: invoice.amountPaid += 600
    - New bank transaction created
    - Net effect on invoice: amountPaid changed by +100

STEP 2: Update with new allocations
  INPUT: { id: "<payment-id>", allocations: [{ invoiceId: "<inv-2>", amount: "600.00" }] }
  ASSERT:
    - Old invoice allocation reversed
    - New invoice allocation applied to different invoice

STEP 3: Remove bank account
  INPUT: { id: "<payment-id>", bankAccountId: null }
  ASSERT:
    - Old bank transaction reversed and deleted
    - No new bank transaction created

STEP 4: Update non-existent payment
  INPUT: { id: "<random-uuid>", amount: "100.00" }
  ASSERT:
    - Throws NOT_FOUND "Payment not found"
```

#### Workflow: Payment Deletion

```
describe("payment.delete")

PRE-CONDITIONS: Payment PAY-00001 exists: amount=500, linked to INV-00001 and bank account

STEP 1: Soft-delete payment
  INPUT: { id: "<payment-id>" }
  ASSERT:
    - Returns { success: true }
    - Database: payment.deletedAt is set
    - Database: invoice.amountPaid decreased by 500 (GREATEST(..., 0))
    - Database: bank transaction reversed and deleted
    - Database: bankAccount.currentBalance adjusted
    - Database: audit_log entry for "payment.delete"

STEP 2: Delete already-deleted payment (idempotent)
  INPUT: { id: "<already-deleted-id>" }
  ASSERT: Returns { success: true }

STEP 3: Delete non-existent payment
  INPUT: { id: "<random-uuid>" }
  ASSERT: Returns { success: false }
```

#### Workflow: Unpaid Invoices Query

```
describe("payment.unpaidInvoices")

PRE-CONDITIONS: Party has 5 invoices: 2 paid, 1 partial, 1 sent, 1 draft

STEP 1: Get unpaid invoices
  INPUT: { partyId: "<id>" }
  ASSERT:
    - Returns 2 invoices (partial + sent)
    - Draft and paid excluded
    - Cancelled excluded
    - Each has computed `balance` = totalAmount - amountPaid
```

#### Workflow: Default Account Query

```
describe("payment.defaultAccount")

STEP 1: Returns most recent payment method for party (Priority 1)
STEP 2: Falls back to business-wide most common (Priority 2)
STEP 3: Falls back to isDefault account (Priority 3)
STEP 4: Returns null when no accounts exist
```

#### Workflow: Untracked Payments + Assign Account

```
describe("payment.untrackedPayments + payment.assignAccount")

STEP 1: List payments without bank account
  ASSERT: Returns only payments where bankAccountId IS NULL

STEP 2: Assign specific payments to bank account
  INPUT: { paymentIds: ["<id1>", "<id2>"], bankAccountId: "<account-id>" }
  ASSERT:
    - Each payment's bankAccountId updated
    - Bank transactions created for each
    - Account balance updated once with net total

STEP 3: Assign all matching untracked payments
  INPUT: { allMatching: true, mode: "cash", bankAccountId: "<account-id>" }
  ASSERT:
    - All untracked cash payments assigned
```

---

### A8. expense.test.ts

**File**: `packages/api/src/routers/expense.ts`
**Middleware chain**: viewerProcedure (list, categories, summary), memberProcedure (create, update), adminProcedure (delete)

#### Workflow: Expense CRUD

```
describe("expense.create + expense.list + expense.update + expense.delete")

STEP 1: Create expense
  INPUT: {
    category: "Rent",
    description: "Office rent for March",
    amount: "25000.00",
    mode: "bank",
    expenseDate: "2026-03-01T00:00:00Z",
    referenceNumber: "RENT-MAR"
  }
  ASSERT:
    - Returns expense with UUID, businessId
    - createdByUserId and createdByName set

STEP 2: List expenses with filters
  INPUT: { category: "Rent", fromDate: "...", toDate: "...", search: "office", page: 1, limit: 20 }
  ASSERT:
    - Returns matching expenses
    - Soft-deleted excluded (deletedAt IS NULL)

STEP 3: Update expense
  INPUT: { id: "<id>", data: { amount: "26000.00" } }
  ASSERT: Amount updated

STEP 4: Update non-existent expense
  INPUT: { id: "<random-uuid>", data: { amount: "100" } }
  ASSERT: Throws NOT_FOUND

STEP 5: Delete expense (soft delete)
  INPUT: { id: "<id>" }
  ASSERT:
    - Returns { success: true }
    - Database: expense.deletedAt set

STEP 6: Delete already-deleted (idempotent)
  ASSERT: Returns { success: true }
```

#### Workflow: Expense Categories & Summary

```
describe("expense.categories + expense.summary")

STEP 1: Get distinct categories
  ASSERT: Returns array of category strings (no duplicates, excludes soft-deleted)

STEP 2: Get expense summary
  INPUT: { from: "...", to: "..." }
  ASSERT:
    - Returns array of { category, total, count }
    - Ordered by total DESC
    - Amounts are string (not float)
```

---

### A9. bankAccount.test.ts

**File**: `packages/api/src/routers/bankAccount.ts`
**Middleware chain**: viewerProcedure (list, getById, listTransactions, summary), memberProcedure (create, update, addTransaction, transfer), adminProcedure (delete)

#### Workflow: Bank Account CRUD

```
describe("bankAccount.create + list + getById + update + delete")

STEP 1: Create savings account
  INPUT: {
    accountName: "HDFC Savings",
    accountNumber: "12345678",
    ifsc: "HDFC0001234",
    bankName: "HDFC Bank",
    accountType: "savings",
    openingBalance: "10000.00",
    isDefault: true
  }
  ASSERT:
    - Returns account with currentBalance = openingBalance = "10000.00"
    - isDefault = true
    - If another account was default, its isDefault is cleared

STEP 2: List accounts
  ASSERT:
    - Returns all accounts for this business
    - Ordered by isDefault DESC, accountName ASC

STEP 3: GetById includes recent transactions
  INPUT: { id: "<id>" }
  ASSERT:
    - Returns account + recentTransactions (up to 20)

STEP 4: Update account
  INPUT: { id: "<id>", data: { accountName: "HDFC Main" } }
  ASSERT: Name updated

STEP 5: Delete account with no transactions
  INPUT: { id: "<id>" }
  ASSERT: { success: true }

STEP 6: Delete account WITH transactions
  PRE-CONDITIONS: Account has 3 transactions
  INPUT: { id: "<id>" }
  ASSERT:
    - Throws BAD_REQUEST "Cannot delete account with 3 transaction(s). Please delete transactions first."
```

#### Workflow: Bank Transactions

```
describe("bankAccount.addTransaction + listTransactions")

STEP 1: Add deposit
  INPUT: { bankAccountId: "<id>", type: "deposit", amount: "5000.00", description: "Customer payment" }
  ASSERT:
    - Returns transaction
    - Database: bankAccount.currentBalance += 5000

STEP 2: Add withdrawal
  INPUT: { bankAccountId: "<id>", type: "withdrawal", amount: "2000.00" }
  ASSERT:
    - Database: bankAccount.currentBalance -= 2000

STEP 3: List transactions with running balance
  INPUT: { bankAccountId: "<id>", page: 1, limit: 20 }
  ASSERT:
    - Each transaction has `balanceAfter` computed via window function
    - Ordered by transactionDate DESC
```

#### Workflow: Bank Transfer

```
describe("bankAccount.transfer")

PRE-CONDITIONS: Account A (balance 10000), Account B (balance 5000)

STEP 1: Transfer between accounts
  INPUT: { fromAccountId: "<a-id>", toAccountId: "<b-id>", amount: "3000.00" }
  ASSERT:
    - Account A balance = 7000
    - Account B balance = 8000
    - 2 bank_transactions created (withdrawal + deposit)
    - referenceType = "transfer"
    - Accounts locked in consistent order (lower ID first) to prevent deadlocks

STEP 2: Transfer to same account
  INPUT: { fromAccountId: "<id>", toAccountId: "<id>", amount: "100" }
  ASSERT:
    - Throws BAD_REQUEST "Cannot transfer to the same account"

STEP 3: Transfer with non-existent account
  INPUT: { fromAccountId: "<id>", toAccountId: "<random>", amount: "100" }
  ASSERT:
    - Throws NOT_FOUND "One or both accounts not found"
```

#### Workflow: Bank Summary

```
describe("bankAccount.summary")

STEP 1: Get summary
  ASSERT:
    - Returns { totalBalance, cashInHand, bankBalance, accountCount }
    - cashInHand = sum of accounts where accountType = "cash"
    - bankBalance = sum of accounts where accountType != "cash"
```

---

### A10. dashboard.test.ts

**File**: `packages/api/src/routers/dashboard.ts`
**Middleware chain**: viewerProcedure

#### Workflow: Dashboard Summary

```
describe("dashboard.summary")

PRE-CONDITIONS: Business has invoices, expenses, payments across current financial year

STEP 1: Summary with default date range (financial year)
  INPUT: {} (or no input)
  ASSERT:
    - Returns: totalSales, totalPurchases, totalExpenses, receivable, payable,
      cashInHand, recentInvoices, cashIn, cashOut
    - Financial year start respects business.financialYearStart (default April)
    - receivable = sum of unpaid sale invoices (balance sheet metric, NOT period-scoped)
    - payable = sum of unpaid purchase invoices (balance sheet metric)
    - All amounts are strings (not floats)

STEP 2: Summary with custom date range
  INPUT: { fromDate: "2026-01-01T...", toDate: "2026-03-31T..." }
  ASSERT:
    - Sales, purchases, expenses scoped to the date range
    - Receivable and payable remain unscoped (balance sheet items)

STEP 3: Summary with no data
  PRE-CONDITIONS: Empty business
  ASSERT:
    - All totals = "0"
    - recentInvoices = []
```

---

### A11. gst.test.ts

**File**: `packages/api/src/routers/gst.ts`
**Middleware chain**: viewerProcedure

#### Workflow: GST Reports

```
describe("gst.gstr1 + gst.gstr3b + gst.gstr1CSV")

PRE-CONDITIONS: Business with GST registration, invoices with various tax rates,
  parties with GSTIN for inter-state/intra-state detection

STEP 1: Generate GSTR-1
  INPUT: { year: 2026, month: 3 }
  ASSERT:
    - Returns structured report with period, sections (B2B, B2C, etc.)
    - Only sale invoices for the given month
    - Cancelled invoices excluded

STEP 2: Generate GSTR-3B
  INPUT: { year: 2026, month: 3 }
  ASSERT:
    - Returns summary of tax liability and input tax credit

STEP 3: Generate GSTR-1 CSV
  INPUT: { year: 2026, month: 3 }
  ASSERT:
    - Returns { csv: "<csv-string>", filename: "GSTR1_March_2026.csv" }

STEP 4: Report for non-GST business
  PRE-CONDITIONS: Business has gstRegistrationType = "unregistered"
  ASSERT:
    - Still returns data (generic financial report terminology)
```

---

### A12. store.test.ts

**File**: `packages/api/src/routers/store.ts`
**Middleware chain**: viewerProcedure (checkSlug, getSettings, listStoreItems, listOrders), memberProcedure (bulkToggleItems, updateItemStoreSettings, updateOrderStatus), adminProcedure (updateSettings)

#### Workflow: Store Settings

```
describe("store.updateSettings + getSettings + checkSlug")

STEP 1: Check slug availability
  INPUT: { slug: "my-shop" }
  ASSERT:
    - Returns { available: true } if no other business uses it
    - Returns { available: false } if taken

STEP 2: Enable store with settings
  INPUT: {
    storeEnabled: true,
    storeSlug: "my-shop",
    storeTagline: "Best widgets in town",
    storeAccentColor: "#FF5733",
    storeMinOrderAmount: "100.00"
  }
  ASSERT:
    - Returns updated settings
    - Slug uniqueness validated

STEP 3: Duplicate slug
  INPUT: { storeSlug: "<taken-slug>" }
  ASSERT:
    - Throws CONFLICT "This store URL is already taken"

STEP 4: Invalid slug format
  INPUT: { storeSlug: "MY SHOP!" }
  ASSERT:
    - Throws Zod error (regex: lowercase alphanumeric + hyphens)
```

#### Workflow: Store Item Visibility

```
describe("store.listStoreItems + bulkToggleItems + updateItemStoreSettings")

STEP 1: List store items (with storeEnabled filter)
  INPUT: { storeEnabled: true, page: 1, limit: 20 }
  ASSERT: Returns only items where storeEnabled=true

STEP 2: Bulk enable items for store
  INPUT: { itemIds: ["<id1>", "<id2>"], storeEnabled: true }
  ASSERT:
    - items.storeEnabled = true for both items
    - Returns { updated: 2 }

STEP 3: Update individual item store settings
  INPUT: { itemId: "<id>", storePrice: "150.00", storeCategory: "Electronics" }
  ASSERT: Store-specific fields updated
```

---

### A13. shipment.test.ts

**File**: `packages/api/src/routers/shipment.ts`
**Middleware chain**: viewerProcedure (list, getById), memberProcedure (create, update), adminProcedure (delete)

#### Workflow: Shipment CRUD

```
describe("shipment.create + list + getById + update + delete")

STEP 1: Create shipment
  INPUT: {
    invoiceId: "<invoice-id>",
    partyId: "<party-id>",
    carrier: "Delhivery",
    trackingNumber: "DL123456789"
  }
  ASSERT:
    - Returns shipment with status = "pending"
    - trackingUrl auto-generated: "https://www.delhivery.com/track/package/DL123456789"

STEP 2: Create shipment with unknown carrier (no auto URL)
  INPUT: { carrier: "Local Transport", trackingNumber: "LT001" }
  ASSERT:
    - trackingUrl = null (no builder for unknown carrier)

STEP 3: List shipments with filters
  INPUT: { status: "pending", page: 1, limit: 20 }
  ASSERT: Returns pending shipments with invoiceNumber and partyName via JOINs

STEP 4: Update status to delivered
  INPUT: { id: "<id>", status: "delivered" }
  ASSERT:
    - status = "delivered"
    - actualDelivery auto-set to now (if not provided)

STEP 5: Update tracking number (auto-regenerates URL)
  INPUT: { id: "<id>", carrier: "BlueDart", trackingNumber: "BD987654" }
  ASSERT:
    - trackingUrl updated to BlueDart tracking URL

STEP 6: Delete shipment
  INPUT: { id: "<id>" }
  ASSERT: Shipment deleted
```

---

### A14. target.test.ts

**File**: `packages/api/src/routers/target.ts`
**Middleware chain**: viewerProcedure (list, myTargets), adminProcedure (create, update, delete)

#### Workflow: Sales Target CRUD

```
describe("target.create + list + update + delete")

STEP 1: Create order_count target
  INPUT: {
    userId: "<seller-id>",
    targetType: "order_count",
    targetValue: "50",
    periodType: "monthly",
    periodStart: "2026-03-01T00:00:00Z",
    periodEnd: "2026-03-31T23:59:59Z"
  }
  ASSERT:
    - Returns target with all fields

STEP 2: Create item_quantity target without itemId
  INPUT: { targetType: "item_quantity", targetValue: "100", periodStart: "...", periodEnd: "...", periodType: "monthly" }
  ASSERT:
    - Throws BAD_REQUEST "itemId is required for item_quantity target type"

STEP 3: Create target with invalid period
  INPUT: { periodEnd: "<before-periodStart>", ... }
  ASSERT:
    - Throws BAD_REQUEST "periodEnd must be after periodStart"

STEP 4: List targets with progress
  INPUT: { withProgress: true }
  ASSERT:
    - Each target has: current, target, percentage, remaining, unit, onTrack, daysTotal, daysElapsed, daysRemaining
    - Progress computed from actual invoices by this seller

STEP 5: List active targets only
  INPUT: { active: true }
  ASSERT: Only targets where periodStart <= now <= periodEnd
```

---

### A15. apiKey.test.ts

**File**: `packages/api/src/routers/apiKey.ts`
**Middleware chain**: protectedProcedure (list, create, revoke)

#### Workflow: API Key Lifecycle

```
describe("apiKey.create + list + revoke")

PRE-CONDITIONS: Tenant has plan = "pro"

STEP 1: Create API key
  INPUT: { name: "CLI Access" }
  ASSERT:
    - Returns { id, name, key, keyPrefix, expiresAt }
    - key starts with "hisaabo_key_"
    - keyPrefix = first 20 chars of key
    - key is returned ONCE (never stored in plaintext)
    - Database: api_keys row with keyHash (SHA-256), not raw key
    - expiresAt = null (no expiration)

STEP 2: Create API key with expiration
  INPUT: { name: "Temp Key", expiresAt: "2026-06-01T00:00:00Z" }
  ASSERT:
    - expiresAt set to provided value

STEP 3: Create API key on free plan
  PRE-CONDITIONS: Tenant plan = "free"
  INPUT: { name: "Test" }
  ASSERT:
    - Throws FORBIDDEN "API keys are available on paid plans"

STEP 4: Create API key without tenant selected
  PRE-CONDITIONS: Session has no tenantId
  INPUT: { name: "Test" }
  ASSERT:
    - Throws BAD_REQUEST "No organization selected"

STEP 5: List API keys
  ASSERT:
    - Returns array of keys
    - NEVER includes key or keyHash (only id, name, keyPrefix, lastUsedAt, expiresAt, createdAt)

STEP 6: Revoke API key
  INPUT: { id: "<key-id>" }
  ASSERT:
    - Returns { success: true }
    - Database: api_keys row deleted

STEP 7: Revoke key belonging to different user
  INPUT: { id: "<other-users-key-id>" }
  ASSERT:
    - Throws NOT_FOUND "API key not found"
    - WHERE clause includes userId + tenantId (ownership check)

STEP 8: Authenticate with API key
  PRE-CONDITIONS: API key created, used as Bearer token
  ASSERT:
    - context.ts resolves user from api_keys via SHA-256 hash lookup
    - lastUsedAt updated on each use
    - Expired keys rejected
```

---

### A16. import.test.ts

**File**: `packages/api/src/routers/import.ts`
**Middleware chain**: adminProcedure (importParties, importItems, importInvoices)

#### Workflow: Import Parties

```
describe("import.importParties")

STEP 1: Import batch of parties
  INPUT: {
    source: "mybillbook",
    parties: [
      { name: "Party 1", type: "customer", phone: "111" },
      { name: "Party 2", type: "supplier", phone: "222" },
    ]
  }
  ASSERT:
    - Returns { created: 2, skipped: 0, total: 2 }
    - Database: 2 party rows with source = "mybillbook"

STEP 2: Import with duplicates (existing names)
  PRE-CONDITIONS: "Party 1" already exists
  INPUT: { parties: [{ name: "Party 1", ... }, { name: "Party 3", ... }] }
  ASSERT:
    - Returns { created: 1, skipped: 1, total: 2 }
    - Case-insensitive deduplication

STEP 3: Import with in-batch duplicates
  INPUT: { parties: [{ name: "New Party" }, { name: "New Party" }] }
  ASSERT:
    - Returns { created: 1, skipped: 1, total: 2 }
    - Second occurrence caught by in-memory tracking

STEP 4: Transactional safety
  PRE-CONDITIONS: Batch of 1000 parties, #750 has invalid data
  ASSERT:
    - Entire batch rolled back (all-or-nothing within transaction)
    - No partial data committed
```

#### Workflow: Import Items

```
describe("import.importItems")

STEP 1: Import with unit normalization
  INPUT: {
    items: [
      { name: "Item 1", unit: "KGS", salePrice: "100" },
      { name: "Item 2", unit: "BOTTLES", salePrice: "50" },
    ]
  }
  ASSERT:
    - Item 1 unit normalized to "kg"
    - Item 2 unit normalized to "btl"
    - stockQuantity always starts at "0" (overrides input)
    - Returns { created: 2, skipped: 0, total: 2, unmappedUnits: [] }

STEP 2: Unmapped units
  INPUT: { items: [{ name: "X", unit: "GALLONS" }] }
  ASSERT:
    - unit set to "other"
    - unmappedUnits: ["GALLONS"]
```

---

### A17. document.test.ts

**File**: `packages/api/src/routers/document.ts` + `packages/api/src/lib/document-router-factory.ts`
**Covers**: quotation, credit_note, debit_note, delivery_challan, proforma, sales_return, purchase_return

#### Workflow: Document Factory CRUD (per document type)

```
describe("quotation / creditNote / debitNote / deliveryChallan / proforma / salesReturn / purchaseReturn")

FOR EACH document type:

STEP 1: Create document
  INPUT: { partyId, type, lineItems: [...] }
  ASSERT:
    - invoiceNumber uses correct prefix (QTN-, CN-, DC-, PI-, etc.)
    - documentType matches config
    - Atomic counter increment
    - Stock effects match config:
      - quotation: NONE
      - credit_note: INCREMENT (returns to stock)
      - debit_note: NONE
      - delivery_challan: DECREMENT
      - proforma: NONE
      - sales_return: INCREMENT
      - purchase_return: DECREMENT

STEP 2: List documents (scoped by documentType)
  ASSERT:
    - Only returns documents of this type
    - Other document types excluded

STEP 3: Update status
  INPUT: { id, status: "<allowed-status>" }
  ASSERT:
    - Only statuses from allowedStatuses array accepted:
      - quotation: draft, sent, cancelled
      - credit_note: draft, sent, paid, cancelled
      - debit_note: draft, sent, paid, cancelled
      - delivery_challan: draft, sent, cancelled
      - proforma: draft, sent, cancelled
      - sales_return: draft, sent, cancelled
      - purchase_return: draft, sent, cancelled

STEP 4: Delete document (reverses stock)
  ASSERT:
    - Soft-delete (deletedAt set, status = "cancelled")
    - Stock reversed:
      - delivery_challan delete: stock ADDED BACK
      - credit_note delete: stock DECREMENTED BACK
      - quotation delete: no stock change
    - Already-deleted: returns { success: true } (idempotent)
```

#### Workflow: Document Conversion

```
describe("document.convert")

STEP 1: Convert quotation to invoice
  INPUT: { sourceDocumentId: "<quotation-id>", targetDocumentType: "invoice" }
  ASSERT:
    - New invoice created with:
      - referenceDocumentId = quotation's ID
      - Same partyId, type, lineItems, charges, notes
      - New invoice number (INV-XXXXX)
    - Stock decremented (quotation had none, invoice does)

STEP 2: Convert delivery_challan to invoice (skip stock)
  INPUT: { sourceDocumentId: "<challan-id>", targetDocumentType: "invoice" }
  ASSERT:
    - New invoice created with skipStockAdjustment = true
    - Stock NOT decremented again (challan already decremented)

STEP 3: Convert proforma to quotation
  INPUT: { sourceDocumentId: "<proforma-id>", targetDocumentType: "quotation" }
  ASSERT:
    - New quotation created

STEP 4: Source document not found
  INPUT: { sourceDocumentId: "<random-uuid>", targetDocumentType: "invoice" }
  ASSERT:
    - Throws NOT_FOUND "Source document not found"

STEP 5: Unsupported target type
  INPUT: { targetDocumentType: "nonexistent" }
  ASSERT:
    - Throws Zod validation error
```

---

### A18. reports.test.ts

**File**: `packages/api/src/routers/reports.ts`
**Middleware chain**: viewerProcedure

#### Workflow: Report Generation

```
describe("reports.daybook + reports.outstanding + reports.register + reports.taxSummary + reports.collectionEfficiency + reports.itemSales + reports.stockSummary + reports.partyStatement + reports.paymentSummary")

PRE-CONDITIONS: Business with invoices, payments, expenses, items across various dates

FOR EACH report:

STEP 1: Happy path with valid date range
  ASSERT:
    - Returns structured report data
    - Amounts are strings (not floats)
    - Only non-deleted records included

STEP 2: Empty date range (no data)
  ASSERT:
    - Returns empty/zero-valued report (not an error)

STEP 3: Reports respect businessId scoping
  ASSERT:
    - Only data from ctx.businessId included
```

---

## B. Cross-Cutting Concern Workflows

---

### B1. multi-tenant-isolation.test.ts

```
describe("Multi-Tenant Data Isolation")

PRE-CONDITIONS:
  - Tenant A with User A (owner) and Business A-1
  - Tenant B with User B (owner) and Business B-1
  - Each tenant has its own database (in cloud mode) or schema isolation

STEP 1: User A cannot list Tenant B's businesses
  CONTEXT: User A authenticated, tenantId = Tenant A
  ACTION: business.list
  ASSERT:
    - Returns only Business A-1
    - Business B-1 NOT present

STEP 2: User A cannot select Tenant B
  ACTION: tenant.select({ tenantId: "<tenant-b-id>" })
  ASSERT:
    - Throws FORBIDDEN "Not a member of this organization"

STEP 3: User A cannot access Business B's parties
  CONTEXT: Even if User A somehow had Tenant B's businessId in header
  ASSERT:
    - hasTenantAccess middleware rejects (tenantId mismatch)
    - OR hasBusinessAccess middleware rejects (business not in tenant DB)

STEP 4: Database isolation (cloud mode)
  ASSERT:
    - Tenant A's DB connection string points to different database than Tenant B
    - getTenantDb(tenantA.id) !== getTenantDb(tenantB.id)

STEP 5: API key scoped to tenant
  CONTEXT: API key created in Tenant A
  ACTION: Use API key, try to access Tenant B data
  ASSERT:
    - apiKey.tenantId resolves to Tenant A
    - Cannot access Tenant B resources
```

---

### B2. multi-business-isolation.test.ts

```
describe("Multi-Business Data Isolation Within Same Tenant")

PRE-CONDITIONS:
  - Tenant with Business A and Business B
  - Business A has Party "Customer-A"
  - Business B has Party "Customer-B"
  - Business A has Item "Widget-A"

STEP 1: Cannot create invoice in Business A with Business B's party
  CONTEXT: businessId = Business A
  ACTION: invoice.create({ partyId: "<customer-b-id>", ... })
  ASSERT:
    - Throws BAD_REQUEST "Party not found in this business"

STEP 2: Cannot create invoice with Business B's items
  CONTEXT: businessId = Business A
  ACTION: invoice.create({ lineItems: [{ itemId: "<widget-b-id>", ... }] })
  ASSERT:
    - Throws BAD_REQUEST "One or more items do not belong to this business"

STEP 3: Party list scoped to business
  CONTEXT: businessId = Business A
  ACTION: party.list({ page: 1, limit: 100 })
  ASSERT:
    - Returns only Customer-A
    - Customer-B NOT present

STEP 4: Invoice list scoped to business
  CONTEXT: businessId = Business A
  ACTION: invoice.list({ page: 1, limit: 100 })
  ASSERT: Only Business A invoices

STEP 5: Payment validation scoped to business
  CONTEXT: businessId = Business A
  ACTION: payment.create({ partyId: "<customer-b-id>", ... })
  ASSERT: Throws BAD_REQUEST "Party not found in this business"

STEP 6: Bank account scoped to business
  CONTEXT: businessId = Business A
  ACTION: bankAccount.list
  ASSERT: Only Business A accounts (including auto-created Cash)

STEP 7: Default bank account defense-in-depth
  ASSERT:
    - payment.defaultAccount final fetch includes businessId in WHERE clause
    - Even if defaultAccountId resolved to a Business B account, it would be filtered out
```

---

### B3. role-based-access.test.ts

```
describe("CASL Role-Based Access Control")

PRE-CONDITIONS:
  - 4 users in same tenant with different roles:
    - Owner (maps to superadmin)
    - Admin (maps to admin)
    - Seller (maps to seller)
    - Accountant (maps to accountant)
  - Business with parties, items, invoices, expenses, bank accounts

FOR EACH resource, test each role:

=== Superadmin (owner) ===
  - Can manage all resources (full CRUD on everything)

=== Admin ===
  - Can manage all resources
  - Cannot demote/remove a superadmin (handled at endpoint level, not CASL)

=== Seller Manager ===
  - CAN: create/read/update Invoice, create/read/update Party, create/read/update Item,
    create/read/update Payment, read Expense, read BankAccount, read Business, read Report,
    create/read/update Store, manage SalesTarget
  - CAN: delete Invoice (with time + status constraints at endpoint level)
  - CANNOT: delete Party, delete Item, delete Expense, delete BankAccount,
    create/update/delete BankTransaction, manage Business, manage Team,
    manage Import, read GstReport
  - Constraint: Can only delete unpaid invoices created within 2 hours

=== Seller ===
  - CAN: create/read/update Invoice (own + 2hr constraint at endpoint), create/read Party,
    read Item, create/read/update Payment (own + 2hr), read Business, read Store,
    read SalesTarget
  - CANNOT: update Party, create/update/delete Item, delete Invoice, delete Party,
    read/create/update/delete Expense, manage BankAccount, manage Team,
    manage Import, manage Store, read Report, read GstReport

=== Accountant ===
  - CAN: create/read/update Payment, create/read/update/delete Expense,
    manage BankAccount, manage BankTransaction, read Report, read GstReport,
    read Invoice, read Party, read Item, read Business, read Store
  - CANNOT: create/update/delete Invoice, create/update/delete Party,
    create/update/delete Item, manage Business, manage Team, manage Import,
    manage SalesTarget

=== Unknown Role ===
  - Gets NO permissions
  - Every action throws FORBIDDEN "Cannot {action} {resource}"

FOR EACH denied action:
  ASSERT:
    - Throws TRPCError with code "FORBIDDEN"
    - Message: "Cannot {action} {resource}"
```

---

### B4. shared-user-across-tenants.test.ts

```
describe("User Shared Across Multiple Tenants")

PRE-CONDITIONS:
  - User "shared@example.com" is member of Tenant A (owner) and Tenant B (seller)

STEP 1: List tenants shows both
  ACTION: tenant.list
  ASSERT:
    - Returns 2 memberships with different roles

STEP 2: Switch to Tenant A -> full access
  ACTION: tenant.select({ tenantId: A })
  ASSERT: Session tenantId = A

STEP 3: Access Business A features
  ASSERT: All owner operations succeed

STEP 4: Switch to Tenant B -> limited access
  ACTION: tenant.select({ tenantId: B })
  ASSERT: Session tenantId = B

STEP 5: Attempt admin operation on Tenant B
  ACTION: business.create({ ... })
  ASSERT: Throws FORBIDDEN (seller cannot create businesses)

STEP 6: Permission context re-evaluated on each request
  ASSERT:
    - withPermissions() middleware queries tenantMembers.role for CURRENT session's tenantId
    - Role is NOT cached across tenant switches
```

---

### B5. concurrent-access.test.ts

```
describe("Concurrent Access Safety")

=== Invoice Number Atomicity ===

STEP 1: 10 concurrent invoice.create calls
  ACTION: Promise.all(10 invoice creates)
  ASSERT:
    - All 10 succeed
    - All 10 have UNIQUE invoice numbers (INV-00001 through INV-00010)
    - No duplicate numbers
    - businesses.nextInvoiceNumber = 11
    - FOR UPDATE lock prevents race condition

=== Payment Number Atomicity ===

STEP 2: 10 concurrent payment.create calls
  ASSERT:
    - All 10 have unique payment numbers
    - Same FOR UPDATE lock mechanism

=== Bank Balance Atomicity ===

STEP 3: 5 concurrent deposits to same account
  ASSERT:
    - Final balance = opening + sum of all deposits
    - No lost updates (FOR UPDATE on bankAccounts)

=== Stock Quantity Atomicity ===

STEP 4: 5 concurrent sales of same item
  PRE-CONDITIONS: Item stock = 100, each sale = 10 units
  ASSERT:
    - Final stock = 50 (100 - 5*10)
    - SQL arithmetic (SET stockQuantity = stockQuantity - X) is atomic per-row

=== Default Tenant Race (Self-Hosted) ===

STEP 5: 2 concurrent registrations on fresh self-hosted instance
  ASSERT:
    - First user becomes owner of "Default Organization"
    - Second user becomes member (not owner)
    - Serializable transaction in getOrCreateDefaultTenant prevents double-owner
```

---

### B6. financial-integrity.test.ts

```
describe("Financial Calculation Integrity")

=== Money Never Uses Floating Point ===

STEP 1: Create invoice with values that cause float errors
  INPUT: { lineItems: [{ quantity: "0.1", unitPrice: "0.2", taxPercent: "18" }] }
  ASSERT:
    - Subtotal computed via fixed-point arithmetic (calcLineItem)
    - No floating-point rounding artifacts (e.g., 0.1 * 0.2 !== 0.020000000000000004)
    - All stored values are NUMERIC(15,2) strings

STEP 2: Payment allocation sums match invoice totals
  INPUT: Multiple partial payments that sum to invoice total
  ASSERT:
    - After all payments: amountPaid exactly equals totalAmount
    - No penny-rounding accumulation

STEP 3: Invoice edit preserves financial integrity
  INPUT: Edit invoice line items
  ASSERT:
    - Old totals fully reversed
    - New totals freshly computed
    - Net stock change is correct

STEP 4: Payment delete exactly reverses allocation
  ASSERT:
    - invoice.amountPaid -= payment.amount (using GREATEST(..., 0) guard)
    - Bank balance exactly reversed

=== Opening Balance in Party Ledger ===

STEP 5: Party balance includes opening balance
  PRE-CONDITIONS: Party with openingBalance = "5000.00", one invoice for 1000, one payment for 500
  ASSERT:
    - party.balance = 5000 + 1000 - 500 = 5500
    - All computed using money.add/money.sub (string arithmetic)
```

---

## C. Docker Image Workflows

---

### C1. docker-api.test.ts

```
describe("Dockerfile (API-only image)")

PRE-CONDITIONS: Docker available, PostgreSQL accessible

STEP 1: Build image
  ACTION: docker build -t hisaabo-api .
  ASSERT: Build succeeds

STEP 2: Start container with DATABASE_URL
  ACTION: docker run -e DATABASE_URL=... -p 3000:3000 hisaabo-api
  ASSERT:
    - Entrypoint runs migrations: "[entrypoint] Running database migrations..."
    - Server starts: "[entrypoint] Starting Hisaabo API server on port 3000..."
    - HEALTHCHECK passes: GET /health returns 200

STEP 3: Health check endpoint
  ACTION: GET http://localhost:3000/health
  ASSERT: Returns 200 within 15s start period

STEP 4: Migration failure does not crash container
  ACTION: Start with invalid DATABASE_URL
  ASSERT:
    - Migration warning printed
    - Server starts anyway (for health checks / debugging)

STEP 5: Environment variables
  ASSERT:
    - NODE_ENV=production
    - PORT=3000 (default)
    - HISAABO_VERSION set from build arg
```

---

### C2. docker-once.test.ts

```
describe("Dockerfile.once (All-in-one image)")

STEP 1: Build image
  ACTION: docker build -f Dockerfile.once -t hisaabo-once .
  ASSERT: Build succeeds (includes PostgreSQL 16 + s6-overlay)

STEP 2: First boot (fresh data dir)
  ACTION: docker run -v hisaabo-data:/storage -p 3000:3000 hisaabo-once
  ASSERT:
    - PostgreSQL initialized: "[postgres] Initializing new database cluster..."
    - flock acquired: "[postgres] Lock acquired - we own PostgreSQL"
    - Database created: "hisaabo" database exists
    - Migrations run: "[api] Running database migrations..."
    - API starts: "[api] Starting Hisaabo API on port 3000..."
    - GET /health returns 200

STEP 3: Persistent data across restarts
  ACTION: Stop and restart container
  ASSERT:
    - No re-initialization of pgdata
    - Data from previous run persists

STEP 4: Backup hook
  ACTION: Execute /hooks/pre-backup inside container
  ASSERT:
    - pg_dump creates /storage/backups/hisaabo.dump
    - File size > 0

STEP 5: Restore hook
  ACTION: Execute /hooks/post-restore inside container
  ASSERT:
    - Database dropped and recreated
    - Dump restored
```

---

## D. Validation Workflows

---

### D1. zod-validation.test.ts

```
describe("Zod Schema Validation — Every Input Schema")

FOR EACH schema, test invalid inputs:

=== registerSchema ===
  - email: "not-email" -> error
  - password: "short" -> error (min 8)
  - password: 129 chars -> error (max 128)
  - name: "A" -> error (min 2)
  - name: 101 chars -> error (max 100)
  - confirmPassword mismatch -> "Passwords don't match"

=== loginSchema ===
  - email: "" -> error
  - password: "short" -> error (min 8)

=== createBusinessSchema ===
  - name: "" -> error (min 1)
  - gstin: "INVALID" -> error (regex: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
  - gstin: "" -> allowed (optional, .or(z.literal("")))
  - pan: "INVALID" -> error (regex: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
  - currency: "US" -> error (length 3)
  - currency: "USDD" -> error (length 3)

=== createPartySchema ===
  - type: "invalid" -> error (enum: customer|supplier)
  - name: "" -> error (min 1)
  - gstin: "invalid" -> error
  - openingBalance: "abc" -> error (regex)
  - openingBalance: "-100.50" -> allowed (regex allows negative)
  - creditPeriodDays: 400 -> error (max 365)
  - creditPeriodDays: -1 -> error (min 0)

=== createItemSchema ===
  - name: "" -> error
  - unit: "nonexistent" -> error (enum)
  - itemMode: "invalid" -> error (enum: simple|alt_units|variants)
  - Mixing variants + unitVariants -> refine error
  - salePrice: "abc" -> error
  - taxPercent: "abc" -> error

=== createInvoiceSchema ===
  - partyId: "not-uuid" -> error
  - type: "invalid" -> error (sale|purchase)
  - lineItems: [] -> error (min 1)
  - lineItem.quantity: "0" -> error ("must be greater than 0")
  - lineItem.quantity: "-1" -> error (regex: /^\d+/)
  - lineItem.taxPercent: "60" -> error ("cannot exceed 56%")
  - lineItem.discountPercent: "101" -> error ("cannot exceed 100%")

=== createPaymentSchema ===
  - amount: "abc" -> error
  - mode: "bitcoin" -> error (enum)
  - allocation.amount: "-100" -> error (regex: /^\d+/)

=== createExpenseSchema ===
  - category: "" -> error (min 1)
  - amount: "abc" -> error

=== createBankAccountSchema ===
  - accountName: "" -> error (min 1)
  - accountType: "crypto" -> error (enum)
  - openingBalance: "abc" -> error

=== bankTransferSchema ===
  - amount: "0" -> allowed (regex matches)
  - amount: "-100" -> error (regex: /^\d+/)

=== createApiKeySchema ===
  - name: "" -> error (min 1)
  - name: 101 chars -> error (max 100)
```

---

### D2. business-rule-validation.test.ts

```
describe("Business Rule Validations")

STEP 1: Cannot delete party with invoices
  PRE-CONDITIONS: Party has 1 invoice
  ACTION: party.delete({ id: "<party-id>" })
  ASSERT:
    - Throws (FK constraint: parties.id referenced by invoices.partyId with onDelete="restrict")

STEP 2: Cannot delete party with payments
  PRE-CONDITIONS: Party has 1 payment
  ACTION: party.delete({ id: "<party-id>" })
  ASSERT:
    - Throws (FK constraint: payments.partyId with onDelete="restrict")

STEP 3: Cannot delete bank account with transactions
  PRE-CONDITIONS: Bank account has transactions
  ACTION: bankAccount.delete({ id: "<id>" })
  ASSERT:
    - Throws BAD_REQUEST "Cannot delete account with N transaction(s)"

STEP 4: Cannot overpay an invoice
  PRE-CONDITIONS: Invoice balance = "200.00"
  ACTION: payment.create({ allocations: [{ invoiceId, amount: "300.00" }] })
  ASSERT:
    - Throws BAD_REQUEST "Allocation 300.00 exceeds invoice balance 200.00"

STEP 5: Cannot edit paid invoice
  PRE-CONDITIONS: Invoice status = "paid"
  ACTION: invoice.update({ id, lineItems: [...] })
  ASSERT:
    - Throws BAD_REQUEST "Cannot edit a paid invoice"

STEP 6: Cannot go backwards on sequence numbers
  PRE-CONDITIONS: nextInvoiceNumber = 50
  ACTION: business.updateSequenceNumber({ documentType: "invoice", newNumber: 25 })
  ASSERT:
    - Throws BAD_REQUEST "New number (25) cannot be less than current (50)"

STEP 7: Cannot create variant on non-variant item
  PRE-CONDITIONS: Item has itemMode = "simple"
  ACTION: item.createVariant({ itemId, variant: {...} })
  ASSERT:
    - Throws BAD_REQUEST "Item is not in variants mode"

STEP 8: Cannot switch base unit on variant item
  PRE-CONDITIONS: Item has itemMode = "variants"
  ACTION: item.switchBaseUnit({ id, newUnit: "g", conversionFactor: 1000 })
  ASSERT:
    - Throws BAD_REQUEST "Cannot switch base unit on a variant item"

STEP 9: Cannot merge item into itself
  ACTION: item.merge({ sourceId: "<id>", targetId: "<same-id>", stockConversionFactor: 1 })
  ASSERT:
    - Throws BAD_REQUEST "Cannot merge an item into itself"

STEP 10: Cannot merge variant items
  ACTION: item.merge({ sourceId: "<variant-item>", targetId: "<other>", ... })
  ASSERT:
    - Throws BAD_REQUEST "Cannot merge variant items"

STEP 11: Stock adjustment quantity cannot be zero
  ACTION: item.adjustStock({ itemId, quantity: "0" })
  ASSERT:
    - Throws Zod error "Quantity cannot be zero"

STEP 12: Target period end must be after start
  ACTION: target.create({ periodStart: "2026-04-01T...", periodEnd: "2026-03-01T...", ... })
  ASSERT:
    - Throws BAD_REQUEST "periodEnd must be after periodStart"

STEP 13: item_quantity target requires itemId
  ACTION: target.create({ targetType: "item_quantity", itemId: null, ... })
  ASSERT:
    - Throws BAD_REQUEST "itemId is required for item_quantity target type"

STEP 14: API keys blocked on free plan
  PRE-CONDITIONS: Tenant plan = "free"
  ACTION: apiKey.create({ name: "test" })
  ASSERT:
    - Throws FORBIDDEN "API keys are available on paid plans"

STEP 15: Store slug uniqueness
  PRE-CONDITIONS: Business A has storeSlug = "my-shop"
  ACTION: Business B: store.updateSettings({ storeSlug: "my-shop" })
  ASSERT:
    - Throws CONFLICT "This store URL is already taken"

STEP 16: Bank transfer to same account
  ACTION: bankAccount.transfer({ fromAccountId: "<id>", toAccountId: "<same-id>", amount: "100" })
  ASSERT:
    - Throws BAD_REQUEST "Cannot transfer to the same account"
```

---

### D3. state-machine-validation.test.ts

```
describe("Invoice State Machine Validation")

NOTE: The Hisaabo invoice router does NOT enforce a strict state machine.
The updateStatus endpoint accepts ANY status transition. This is by
design (flexibility for Indian business workflows). However, the
PAYMENT system implicitly drives status via amountPaid thresholds:

=== Payment-Driven Status Transitions ===

STEP 1: draft -> (payment created) -> partial
  ASSERT: When amountPaid > 0 and < totalAmount, status = "partial"

STEP 2: partial -> (full payment) -> paid
  ASSERT: When amountPaid >= totalAmount, status = "paid"

STEP 3: paid -> (payment deleted) -> sent
  ASSERT: When payment reversed and amountPaid drops > 0, status stays "partial"
  ASSERT: When amountPaid drops to 0, status = "sent" (not draft, not original status)

=== Manual Status Transitions (all allowed) ===

STEP 4: Any status -> any status via updateStatus
  ASSERT: All combinations succeed (no enforcement)

=== Overdue Computation (not a stored status) ===

STEP 5: "overdue" filter on invoice.list
  ASSERT:
    - Invoices where dueDate < NOW() AND status NOT IN ('paid','cancelled','draft')
    - This is COMPUTED at query time, not a stored status value

=== Soft Delete Status ===

STEP 6: Any status -> cancelled (via delete)
  ASSERT:
    - invoice.delete sets status = "cancelled" and deletedAt = now

=== Document Factory Status Constraints ===

STEP 7: Quotation status limited to: draft, sent, cancelled
STEP 8: Credit note status limited to: draft, sent, paid, cancelled
STEP 9: Delivery challan status limited to: draft, sent, cancelled
STEP 10: Proforma status limited to: draft, sent, cancelled

=== Shipment Status Transitions ===

STEP 11: Valid transitions: pending -> shipped -> in_transit -> delivered
STEP 12: delivered -> returned (valid)
STEP 13: Any status directly settable (no enforcement in router)
STEP 14: Setting "delivered" auto-sets actualDelivery timestamp

=== Store Order Status Transitions ===

STEP 15: pending -> confirmed -> preparing -> ready -> delivered
STEP 16: Any status -> cancelled
```

---

## Assumptions

| # | Assumption | Verification Source | Risk if Wrong |
|---|---|---|---|
| A1 | money.add/money.sub/money.toNumber use fixed-point string arithmetic | packages/shared - not read in this audit | Floating point bugs in financial calculations |
| A2 | calcLineItem and calcInvoiceTotals use fixed-point arithmetic | packages/shared - not read in this audit | Incorrect invoice totals |
| A3 | Invoice soft-delete in invoice.ts does NOT reverse stock | Verified: code reads deletedAt/cancels but no stock reversal | Orphaned stock decrements on delete |
| A4 | Document factory soft-delete DOES reverse stock | Verified: document-router-factory.ts lines 404-435 | Inconsistency between invoice router and factory |
| A5 | getTenantDb returns isolated DB connection per tenant in cloud mode | Assumed from control-schema.ts tenant DB config fields | Cross-tenant data leakage |
| A6 | Session cache (60s TTL, max 1000) does not cause stale auth | context.ts uses Map cache | Stale permissions for ~60s after role change |
| A7 | Payment update reverses old SINGLE invoiceId but not old allocations | Verified: payment.update line 426 uses existing.invoiceId | Multi-allocation payments may not fully reverse on update |
| A8 | Email service calls are mockable in tests | Assumed | Cannot test magic link flows |
| A9 | Turnstile verification is skippable when no TURNSTILE_SECRET_KEY | Verified: verifyTurnstile skips when key absent | Cannot test Turnstile in CI |

---

## Open Questions

1. **A3 vs A4 inconsistency**: Invoice router delete does NOT reverse stock, but document-router-factory delete DOES. Is this intentional? Sale invoice stock should be reversed on delete.

2. **Payment update multi-allocation reversal**: The update path reverses the old `existing.invoiceId` single allocation but does not appear to reverse old `paymentAllocations` table entries. Is this a gap?

3. **Seller time constraints**: The 2-hour delete window for seller_manager is checked in the invoice router but NOT in the payment router. Should payment.update/delete also have time constraints for sellers?

4. **Store order workflow**: Store order status updates are not fully visible from the code read (store.ts was partially read). Need to verify the full order lifecycle including invoice auto-creation.

5. **Dashboard N+1**: The dashboard.summary endpoint runs 8 parallel queries. Are there N+1 concerns with recentInvoices or cashIn/cashOut?

6. **Magic link token cleanup**: Expired/used magic_link_tokens are never cleaned up. Should there be a background job?

---

## Reality Checker Findings

| # | Finding | Severity | Spec Section | Resolution |
|---|---|---|---|---|
| RC-1 | Invoice delete does not reverse stock (invoice.ts line 559-599) but document factory delete does (document-router-factory.ts line 381-450) | High | A6 - Invoice Deletion | Verify if this is intentional. If not, invoice.delete needs stock reversal. |
| RC-2 | Payment update reversal path handles single invoiceId but may miss paymentAllocations table cleanup | Medium | A7 - Payment Update | Verify: does update clear old paymentAllocations rows? |
| RC-3 | dbPassword stored in plaintext in tenants table (control-schema.ts line 29) | Critical | B1 - Tenant Isolation | Known TODO in code. Must encrypt before production cloud deployment. |
| RC-4 | Session cache TTL of 60s means role changes take up to 60s to take effect | Low | B3 - RBAC | Acceptable for UX, but test must account for cache invalidation. |
| RC-5 | invoice.updateStatus has no state machine enforcement | Low | D3 - State Machine | By design for flexibility. Document explicitly. |
