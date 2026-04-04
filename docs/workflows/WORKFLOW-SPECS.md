# Hisaabo Workflow Specifications

**Version**: 1.0
**Date**: 2026-04-04
**Author**: Workflow Architect
**Status**: Draft
**Purpose**: Build-ready workflow trees for BDD-style integration tests

---

## Table of Contents

1. [Auth & Onboarding](#1-auth--onboarding)
2. [Team Management](#2-team-management)
3. [Business Management](#3-business-management)
4. [Party Management](#4-party-management)
5. [Item Management](#5-item-management)
6. [Invoice Lifecycle](#6-invoice-lifecycle)
7. [Document Types & Conversion](#7-document-types--conversion)
8. [Payment Flow](#8-payment-flow)
9. [Bank & Reconciliation](#9-bank--reconciliation)
10. [Payment Gateway](#10-payment-gateway)
11. [Recurring Invoices](#11-recurring-invoices)
12. [Expense Tracking](#12-expense-tracking)
13. [GST Flow](#13-gst-flow)
14. [Online Store](#14-online-store)
15. [Shipment](#15-shipment)
16. [Permissions Matrix](#16-permissions-matrix)
17. [Plan Limits](#17-plan-limits)

---

## Conventions

- **DB columns**: Written as `table.column`
- **Money**: Always string `"0.00"` format, never JS float
- **Status transitions**: `[from] -> [to]` notation
- **Procedure levels**: `publicProcedure` (no auth), `protectedProcedure` (session required), `tenantProcedure` (session + tenant), `viewerProcedure`/`memberProcedure`/`adminProcedure` (session + tenant + business + CASL)
- **Business isolation**: All tenant-DB queries are scoped by `businessId` from `x-business-id` header

---

## 1. Auth & Onboarding

### WORKFLOW 1A: Password Registration

**Trigger**: `auth.register` (publicProcedure)
**Input**: `{ email, name, password, confirmPassword, turnstileToken? }`

```
STEP 1: Turnstile verification
  BRANCH: TURNSTILE_SECRET_KEY is set
    BRANCH: turnstileToken missing -> FAILURE(BAD_REQUEST, "Turnstile verification required")
    BRANCH: turnstileToken present
      ACTION: verifyTurnstile(token, ip)
      BRANCH: invalid -> FAILURE(FORBIDDEN, "Verification failed")
      BRANCH: valid -> STEP 2
  BRANCH: TURNSTILE_SECRET_KEY not set -> STEP 2

STEP 2: Duplicate check
  ACTION: SELECT user by email
  BRANCH: exists -> FAILURE(CONFLICT, "Email already registered")
  BRANCH: not found -> STEP 3

STEP 3: Transactional user creation
  BEGIN TRANSACTION on controlDb
    STEP 3a: Hash password (argon2id, memoryCost=65536, timeCost=3, parallelism=4)
    STEP 3b: INSERT user (email, name, passwordHash)
    STEP 3c: Check for pending invitation
      ACTION: SELECT invitation WHERE email=input.email AND acceptedAt IS NULL AND expiresAt > now()
      BRANCH: pending invite exists -> SKIP tenant creation (user will join via invite)
      BRANCH: no pending invite -> STEP 3d
    STEP 3d: Tenant assignment
      BRANCH: MULTI_TENANT=true
        ACTION: Create tenant (name="{name}'s Organization", slug=generateSlug)
        ACTION: provisionTenantDatabase(tenantId, slug) -- CREATE DATABASE, user, schema push
          BRANCH: provision fails -> DELETE orphaned tenant row, THROW
        ACTION: UPDATE tenant with dbName, dbHost, dbPort, dbUser, dbPassword
        ACTION: INSERT tenantMember (role="owner", acceptedAt=now())
      BRANCH: MULTI_TENANT=false (self-hosted)
        ACTION: getOrCreateDefaultTenant(userId)
          BEGIN INNER TX
            SELECT tenant WHERE slug="default" (create if not exists)
            INSERT tenantMember (role="owner" if first member, else "member")
          END INNER TX
    STEP 3e: Resolve tenant for session
      ACTION: SELECT memberships for user
      BRANCH: exactly 1 membership -> tenantId = that tenant
      BRANCH: 0 or >1 memberships -> tenantId = null
    STEP 3f: Enforce session limit (FIFO eviction of oldest)
    STEP 3g: INSERT session (id=nanoid(64), userId, tenantId, expiresAt=30days)
    STEP 3h: Set-Cookie session_id (HttpOnly, SameSite=Lax, Secure in production)
  COMMIT TRANSACTION

OUTPUT: { user: { id, email, name }, sessionToken }
```

**Observable state after success**:
- `users` row created (emailVerified=false)
- `tenants` row created (if MULTI_TENANT)
- `tenant_members` row created (role=owner)
- `sessions` row created (expiresAt = now + 30 days)
- Cookie `session_id` set in response

**Failure modes**:
| Failure | tRPC Code | Recovery |
|---------|-----------|----------|
| Turnstile token missing (prod) | BAD_REQUEST | Client must provide Turnstile token |
| Turnstile verification fails | FORBIDDEN | Refresh page, retry |
| Email already registered | CONFLICT | Login instead, or use different email |
| Password mismatch | BAD_REQUEST (Zod) | Fix client-side validation |
| DB provisioning fails | INTERNAL_SERVER_ERROR | Orphaned tenant row deleted; user can retry |

---

### WORKFLOW 1B: Password Login

**Trigger**: `auth.login` (publicProcedure)
**Input**: `{ email, password }`

```
STEP 1: Rate limit check
  ACTION: Check failedLoginAttempts map for email
  BRANCH: >= 5 attempts within 15min window -> FAILURE(TOO_MANY_REQUESTS)
  BRANCH: under limit -> STEP 2

STEP 2: User lookup
  ACTION: SELECT user by email (id, email, name, passwordHash)
  BRANCH: not found -> increment failedLoginAttempts, FAILURE(UNAUTHORIZED, "Invalid email or password")
  BRANCH: found but no passwordHash (magic-link-only account) -> increment attempts, FAILURE(UNAUTHORIZED)
  BRANCH: found with passwordHash -> STEP 3

STEP 3: Password verification
  ACTION: argon2.verify(passwordHash, inputPassword)
  BRANCH: invalid -> increment failedLoginAttempts, FAILURE(UNAUTHORIZED)
  BRANCH: valid -> clear failedLoginAttempts for email, STEP 4

STEP 4: Membership check
  ACTION: SELECT tenantMembers for user
  BRANCH: 0 memberships -> FAILURE(FORBIDDEN, "Account has no organization membership")
  BRANCH: >= 1 -> STEP 5

STEP 5: Create session
  ACTION: createSessionForUser(userId, ctx)
    Resolve tenantId (single membership -> auto-select, multiple -> null)
    enforceSessionLimit (evict oldest if at plan cap)
    INSERT session
    Set-Cookie

OUTPUT: { user: { id, email, name }, sessionToken }
```

**Observable state**: Session row created; oldest session may be deleted if at limit.

**Failure modes**:
| Failure | tRPC Code | Side Effect |
|---------|-----------|-------------|
| Rate limited | TOO_MANY_REQUESTS | 15-minute cooldown |
| User not found | UNAUTHORIZED | Attempt counter incremented |
| Wrong password | UNAUTHORIZED | Attempt counter incremented |
| No memberships | FORBIDDEN | User exists but cannot access any tenant |

---

### WORKFLOW 1C: Magic Link (Request)

**Trigger**: `auth.sendMagicLink` (publicProcedure)
**Input**: `{ email, turnstileToken?, source: "web"|"desktop"|"mobile" }`

```
STEP 1: Optional Turnstile verification (same as register)

STEP 2: Rate limit check
  ACTION: COUNT magicLinkTokens WHERE email AND createdAt > 15min ago
  BRANCH: >= 5 tokens -> return { success: true } (silent, no enumeration)
  BRANCH: < 5 -> STEP 3

STEP 3: Generate token
  ACTION: rawToken = crypto.randomUUID() + "-" + nanoid(32)
  ACTION: tokenHash = sha256(rawToken)
  ACTION: INSERT magicLinkTokens (email, tokenHash, expiresAt=15min, ipAddress)

STEP 4: Build URLs
  primaryUrl = deep link (desktop/mobile) or HTTPS link (web)
  secondaryUrl = the other

STEP 5: Send email
  ACTION: Check if user exists (for email template variant, not for access control)
  ACTION: emailService.sendMagicLink(email, primaryUrl, secondaryUrl, isNewUser)

OUTPUT: { success: true } -- ALWAYS, regardless of email existence (anti-enumeration)
```

---

### WORKFLOW 1D: Magic Link (Verify)

**Trigger**: `auth.verifyMagicLink` (publicProcedure)
**Input**: `{ token }`

```
STEP 1: Atomic token consumption
  ACTION: UPDATE magicLinkTokens SET usedAt=now()
    WHERE tokenHash=sha256(token) AND expiresAt > now() AND usedAt IS NULL
    RETURNING row
  BRANCH: no row returned -> FAILURE(BAD_REQUEST, "Invalid, expired, or already used link")
  BRANCH: row returned -> STEP 2

STEP 2: User upsert (inside transaction)
  BEGIN TRANSACTION
    STEP 2a: SELECT user by email
      BRANCH: user exists
        -> SET emailVerified=true
        -> isNewUser=false
      BRANCH: user does not exist
        -> INSERT user (email, emailVerified=true, name=null)
        -> isNewUser=true
        -> Check for pending invitation (same logic as register)
          BRANCH: pending invite -> skip tenant creation
          BRANCH: no invite -> assignTenantToNewUser
    STEP 2b: Create session (same as login STEP 5)
  COMMIT

OUTPUT: { user, sessionToken, isNewUser, needsProfile: !user.name }
```

**Key decision**: `needsProfile=true` signals the UI to show the profile completion form.

---

### WORKFLOW 1E: Complete Profile

**Trigger**: `auth.completeProfile` (protectedProcedure)
**Input**: `{ name }`

```
STEP 1: UPDATE users SET name=input.name WHERE id=ctx.user.id
STEP 2: Invalidate session cache for current session
OUTPUT: { success: true }
```

---

### WORKFLOW 1F: Email Change

**Trigger**: `auth.requestEmailChange` (protectedProcedure) then `auth.confirmEmailChange` (publicProcedure)

```
REQUEST PHASE:
  STEP 1: Check new email not taken -> CONFLICT if exists
  STEP 2: Generate token with userId bound to token row (prevents substitution attack)
  STEP 3: Send verification email to NEW address

CONFIRM PHASE:
  STEP 1: Atomic token consumption (same as magic link verify)
  STEP 2: Verify tokenRow.userId exists (must be an email-change token, not a magic link)
  STEP 3: UPDATE users SET email=tokenRow.email WHERE id=tokenRow.userId
    NOTE: userId comes from server-side token, NEVER from client input
```

---

### WORKFLOW 1G: Session Management

```
LOGOUT (single): DELETE session by id, clear cookie
LOGOUT ALL: DELETE all sessions for user, clear cookie
LIST SESSIONS: SELECT sessions for user (active or expired), mark current
REVOKE SESSION: DELETE specific session (cannot revoke current -- must use logout)
```

---

## 2. Team Management

### WORKFLOW 2A: Invite Member

**Trigger**: `tenant.inviteMember` (tenantProcedure)
**Input**: `{ email, role: "admin"|"seller_manager"|"seller"|"accountant" }`
**Precondition**: Caller role must be owner/superadmin/admin

```
STEP 1: Permission check
  ACTION: SELECT caller's tenantMember role
  BRANCH: not owner/superadmin/admin -> FAILURE(FORBIDDEN)

STEP 2: Plan limit check
  ACTION: enforceTeamMemberLimit(tenantId)
    COUNT members + pending invitations
    BRANCH: >= plan limit -> FAILURE(FORBIDDEN, "Upgrade to invite more")

STEP 3: Duplicate checks
  STEP 3a: If email matches existing user, check if already a member
    BRANCH: already a member -> FAILURE(CONFLICT, "User is already a member")
  STEP 3b: Check for existing pending invitation for this email+tenant
    BRANCH: pending exists -> FAILURE(CONFLICT, "A pending invitation already exists")

STEP 4: Create invitation
  ACTION: rawToken = nanoid(32), tokenHash = sha256(rawToken)
  ACTION: INSERT invitations (tenantId, email, role, token=tokenHash, expiresAt=7days)

STEP 5: Send email (fire-and-forget)
  ACTION: emailService.sendInvitation (catch errors, don't block)

OUTPUT: { token: rawToken, expiresAt }
```

**Observable state**:
- `invitations` row: tokenHash stored, acceptedAt=null, expiresAt=7 days
- Email sent (best-effort)

---

### WORKFLOW 2B: Accept Invitation

**Trigger**: `tenant.acceptInvitation` (protectedProcedure)
**Input**: `{ token }`

```
STEP 1: Look up invitation
  ACTION: SELECT invitation WHERE token=sha256(input.token) AND expiresAt > now()
  BRANCH: not found -> FAILURE(NOT_FOUND, "Invalid or expired invitation")
  BRANCH: already accepted -> FAILURE(BAD_REQUEST, "Already accepted")

STEP 2: Email match verification
  ACTION: SELECT current user's email
  BRANCH: email mismatch -> FAILURE(FORBIDDEN, "Invitation sent to a different email")

STEP 3: Check if already a member (idempotency / double-click protection)
  BRANCH: already member -> mark invitation accepted, auto-select tenant, return
  BRANCH: not yet member -> STEP 4

STEP 4: Atomic membership creation
  BEGIN TRANSACTION
    INSERT tenantMember (tenantId, userId, role=invitation.role, acceptedAt=now())
    UPDATE invitation SET acceptedAt=now()
  COMMIT

STEP 5: Auto-select tenant in session
  ACTION: UPDATE session SET tenantId, invalidate cache

OUTPUT: { tenantId, tenantName }
```

**Critical path**: Registration with pending invite skips auto-tenant creation. User registers, then accepts invite, and gets added to the inviting tenant.

---

### WORKFLOW 2C: Remove Member

**Trigger**: `tenant.removeMember` (tenantProcedure)
**Input**: `{ userId }`

```
STEP 1: Permission check (caller must be owner/superadmin/admin)
STEP 2: Self-removal check -> FAILURE(BAD_REQUEST, "Cannot remove yourself")
STEP 3: Target protection -> FAILURE(FORBIDDEN) if target is owner/superadmin
STEP 4: DELETE tenantMember
```

### WORKFLOW 2D: Update Member Role

**Trigger**: `tenant.updateMemberRole` (tenantProcedure)
**Input**: `{ userId, role: "admin"|"seller_manager"|"seller"|"accountant" }`

```
Same permission checks as remove.
Cannot change owner/superadmin role.
UPDATE tenantMember SET role.
```

---

## 3. Business Management

### WORKFLOW 3A: Create Business

**Trigger**: `business.create` (tenantProcedure)
**Input**: Full createBusinessSchema (name, PAN, phone, address, GST config, prefixes...)

```
STEP 1: Admin check (requireTenantAdmin -- owner/admin only)
STEP 2: Plan limit check (enforceBusinessLimit)
  BRANCH: >= maxBusinesses for plan -> FAILURE(FORBIDDEN, "Upgrade")
STEP 3: Transactional creation
  BEGIN TRANSACTION
    INSERT business (all fields + createdByUserId)
    INSERT bankAccount (name="Cash", type="cash", balance=0) -- auto-created
  COMMIT
STEP 4: Audit log

OUTPUT: full business row
```

**Observable state**:
- `businesses` row with auto-generated ID
- `bank_accounts` row for "Cash" account (always exists)
- Sequence counters all start at 1 (nextInvoiceNumber, nextPaymentNumber, etc.)

### WORKFLOW 3B: Update Business

**Trigger**: `business.update` (tenantProcedure)
**Input**: `{ id, data: partial business fields }`
Requires tenant admin. Partial update.

### WORKFLOW 3C: Update Sequence Number

**Trigger**: `business.updateSequenceNumber` (tenantProcedure)
**Input**: `{ businessId, documentType, newNumber }`

```
STEP 1: Tenant admin check
STEP 2: Fetch current counter value
STEP 3: Validate newNumber >= currentNumber (cannot go backwards)
  BRANCH: lower -> FAILURE(BAD_REQUEST)
STEP 4: Raw SQL UPDATE for dynamic column
```

---

## 4. Party Management

### WORKFLOW 4A: Create Party

**Trigger**: `party.create` (memberProcedure)
**Input**: createPartySchema `{ type: "customer"|"supplier", name, phone?, email?, gstin?, billingAddress?, openingBalance?, creditPeriodDays?, creditLimit?, ... }`
**Permission**: requireCan("create", "Party")

```
STEP 1: Permission check (CASL)
STEP 2: INSERT party with businessId scoping
  openingBalance defaults to "0"
  source defaults to null (manual creation)

OUTPUT: party row

OBSERVABLE STATE:
  - parties row created
  - party.openingBalance = input value (affects receivable/payable calculations)
```

**Failure modes**:
| Failure | Cause | Code |
|---------|-------|------|
| Permission denied | seller cannot create (wait -- seller CAN create) | FORBIDDEN |
| Validation error | Missing required fields, invalid GSTIN format | BAD_REQUEST |

### WORKFLOW 4B: Update Party

**Trigger**: `party.update` (memberProcedure)
**Input**: `{ id, ...partial fields }` (type is immutable -- omitted from updatePartySchema)

### WORKFLOW 4C: Delete Party (Soft)

**Trigger**: `party.delete` (adminProcedure)
- Party is referenced by invoices with ON DELETE RESTRICT -- cannot hard delete if invoices exist
- Soft delete behavior: depends on implementation (check party router)

---

## 5. Item Management

### WORKFLOW 5A: Create Item

**Trigger**: `item.create` (memberProcedure)
**Input**: createItemSchema
**Permission**: requireCan("create", "Item")

```
ITEM MODES (mutually exclusive):
  simple:     Standard item. Stock on items.stockQuantity.
  alt_units:  Item with alternative measurement units (unitVariants JSONB).
              Stock on items.stockQuantity, conversion factor per unit.
  variants:   Item with attribute-based variants (e.g., Size x Color).
              Stock on itemVariants.stockQuantity per variant.

VALIDATION RULES:
  - variants mode CANNOT have unitVariants
  - alt_units mode CANNOT have variantAttributes or variants

STEP 1: Permission check
STEP 2: Validate mode constraints (Zod refine)
STEP 3: INSERT item
STEP 4: If mode=variants AND variants array provided:
  INSERT itemVariants (attributeValues, sku, salePrice, purchasePrice, stockQuantity, lowStockAlert)
STEP 5: Audit log

OBSERVABLE STATE:
  - items row: stockQuantity set to input (default "0")
  - itemVariants rows (if variants mode): each with own stockQuantity
  - lowStockAlert threshold stored (used by dashboard/reports)
```

### WORKFLOW 5B: Update Item

**Trigger**: `item.update` (memberProcedure)
**Input**: `{ id, ...partial fields }`

```
Special handling for variants:
  - If variants array provided, DELETE existing variants, INSERT new ones
  - This is a full replacement, not a merge
```

### WORKFLOW 5C: Stock Adjustment

**Trigger**: `item.adjustStock` (memberProcedure)
**Input**: `{ itemId, variantId?, quantity (signed), reason }`

```
STEP 1: Fetch current stock (for audit trail)
STEP 2: UPDATE stock: new = current + quantity
STEP 3: INSERT stockAdjustments record (previousStock, newStock, reason)
```

---

## 6. Invoice Lifecycle

### WORKFLOW 6A: Create Invoice

**Trigger**: `invoice.create` (memberProcedure)
**Input**: createInvoiceSchema
**Permission**: requireCan("create", "Invoice")

This is the most complex workflow in the system. Every step inside a single DB transaction.

```
BEGIN TRANSACTION

STEP 1: Validate party ownership
  ACTION: SELECT party WHERE id=input.partyId AND businessId=ctx.businessId
  BRANCH: not found -> FAILURE(BAD_REQUEST, "Party not found in this business")

STEP 2: Validate item ownership
  ACTION: SELECT items WHERE id IN (lineItem.itemIds) AND businessId=ctx.businessId
  BRANCH: count mismatch -> FAILURE(BAD_REQUEST, "Items do not belong to this business")

STEP 3: Atomic invoice number generation
  ACTION: SELECT prefix, nextNum FROM businesses WHERE id=ctx.businessId FOR UPDATE
  ACTION: invoiceNumber = "{prefix}-{nextNum padded to 5}"
  ACTION: UPDATE businesses SET nextInvoiceNumber = nextNum + 1
  NOTE: FOR UPDATE lock prevents concurrent number generation race condition

STEP 4: Calculate line items (fixed-point arithmetic)
  FOR EACH lineItem:
    calc = calcLineItem({ quantity, unitPrice, taxPercent, discountPercent })
    result = { subtotal, discountAmount, afterDiscount, taxAmount, total }

  TAX CALCULATION MODES:
    tax_exclusive (default): subtotal = qty * price, tax applied on (subtotal - discount)
    tax_inclusive: back-calculate base = price / (1 + taxRate/100), then forward-calculate

STEP 5: Calculate invoice totals
  ACTION: calcInvoiceTotals({ lineItems, charges, invoiceDiscount, invoiceDiscountType, roundOff })
  FORMULA: total = subtotal + taxTotal - invoiceDiscountAmount + chargesTotal + roundOff
  WHERE:
    subtotal = SUM(lineItem.afterDiscount)
    invoiceDiscountAmount = if percent: subtotal * discountPercent/100, else flat amount
    chargesTotal = SUM(charge.amount)

STEP 6: INSERT invoice
  Fields: businessId, partyId, type, documentType="invoice", invoiceNumber,
          invoiceDate, dueDate, subtotal, taxAmount, discountAmount, charges,
          additionalCharges, roundOff, totalAmount, amountPaid="0",
          notes, termsAndConditions, referenceDocumentId, deliveryMethod,
          createdByUserId, createdByName

STEP 7: INSERT invoiceItems (one per line item)
  Each with: invoiceId, itemId, description, quantity, unitPrice, taxPercent,
             taxAmount, discountPercent, totalAmount, sortOrder,
             selectedUnit, conversionFactor, variantId

STEP 8: Stock adjustment (unless skipStockAdjustment=true)
  BRANCH: skipStockAdjustment=true -> SKIP (used for challan->invoice conversion)
  BRANCH: skipStockAdjustment=false
    FOR EACH lineItem:
      BRANCH: has variantId
        -> Stock lives on itemVariant, no conversion factor
        -> delta = quantity
      BRANCH: has itemId (no variant)
        -> Stock lives on item, with conversion factor
        -> delta = quantity * conversionFactor
    
    AGGREGATE by itemId/variantId (avoid N+1 updates)
    
    FOR sale invoices:
      UPDATE items/itemVariants SET stockQuantity = stockQuantity - delta
    FOR purchase invoices:
      UPDATE items/itemVariants SET stockQuantity = stockQuantity + delta

STEP 9: Auto-create shipment (conditional)
  BRANCH: type="sale" AND charges contain /shipping|delivery|freight|transport/i AND amount > 0
    -> INSERT shipment (businessId, invoiceId, partyId, mode, cost, status="pending")
  BRANCH: otherwise -> SKIP

COMMIT TRANSACTION

POST-TRANSACTION:
  STEP 10: Audit log (async, non-blocking)
```

**Observable state**:
| Entity | State |
|--------|-------|
| `invoices` | New row, status="draft", amountPaid="0", totalAmount=calculated |
| `invoice_items` | N rows linked to invoice |
| `items.stockQuantity` | Decremented (sale) or incremented (purchase) |
| `item_variants.stockQuantity` | Same, for variant items |
| `businesses.nextInvoiceNumber` | Incremented by 1 |
| `shipments` | New row if shipping charge detected |
| `audit_log` | Entry with action="invoice.create" |

**Failure modes**:
| Failure | Step | Code | Cleanup |
|---------|------|------|---------|
| Party not in business | 1 | BAD_REQUEST | TX rollback |
| Items not in business | 2 | BAD_REQUEST | TX rollback |
| Zero quantity line item | Input validation | BAD_REQUEST | None |
| Tax > 56% | Input validation | BAD_REQUEST | None |

---

### WORKFLOW 6B: Update Invoice

**Trigger**: `invoice.update` (memberProcedure)
**Input**: `{ id, partyId?, invoiceDate?, dueDate?, notes?, lineItems?, charges?, invoiceDiscount?, roundOff? }`

```
BEGIN TRANSACTION

STEP 1: Fetch existing invoice FOR UPDATE
  BRANCH: not found -> FAILURE(NOT_FOUND)
  BRANCH: status="paid" -> FAILURE(BAD_REQUEST, "Cannot edit a paid invoice. Remove payments first.")

STEP 2: Validate partyId/itemIds belong to business (same as create)

STEP 3: If lineItems provided (full replacement):
  STEP 3a: Reverse old stock adjustments
    Read old invoiceItems
    For each: reverse stock effect (sale: add back, purchase: subtract back)
  STEP 3b: DELETE old invoiceItems
  STEP 3c: Recalculate and INSERT new invoiceItems
  STEP 3d: Apply new stock adjustments
  STEP 3e: Recalculate invoice totals

STEP 4: UPDATE invoice with new values

COMMIT TRANSACTION
```

**Critical note**: Stock reversal + reapplication is done inside a single transaction. If the update fails mid-way, all stock changes are rolled back.

---

### WORKFLOW 6C: Update Invoice Status

**Trigger**: `invoice.updateStatus` (memberProcedure)
**Input**: `{ id, status }`
**Allowed statuses**: "draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"

```
STEP 1: Permission check
STEP 2: Fetch current status for audit
STEP 3: UPDATE invoice SET status
STEP 4: Audit log with fromStatus -> toStatus
```

**Status transition rules** (enforced by code):
```
[draft] -> sent, cancelled
[sent] -> partial (via payment), paid (via payment), cancelled, overdue (computed)
[partial] -> paid (via payment), cancelled, overdue (computed)
[paid] -> partial (via payment reversal)
[overdue] -- not a stored status, computed as: dueDate < now() AND status NOT IN (paid, cancelled, draft)
[cancelled] -- terminal (soft-deleted invoices also get this status)
```

**Note**: `overdue` is a computed state in list queries, not stored. The query checks `dueDate < NOW() AND status NOT IN ('paid', 'cancelled', 'draft')`.

---

### WORKFLOW 6D: Delete Invoice (Soft Delete)

**Trigger**: `invoice.delete` (adminProcedure)
**Input**: `{ id }`
**Permission**: requireCan("delete", "Invoice")

```
STEP 1: Fetch invoice
  BRANCH: not found -> return { success: true } (idempotent)
  BRANCH: already soft-deleted -> return { success: true }

STEP 2: Role-specific restrictions
  BRANCH: caller role = seller_manager
    BRANCH: invoice.status = "paid" -> FAILURE(FORBIDDEN, "Cannot delete paid invoices")
    BRANCH: invoice.createdAt < 2 hours ago -> FAILURE(FORBIDDEN, "Can only delete within 2 hours")

STEP 3: Reverse stock adjustments (inside transaction)
  Same logic as update: read lineItems, reverse stock effects

STEP 4: Soft delete
  UPDATE invoice SET deletedAt=now(), status="cancelled"

STEP 5: Audit log
```

**Observable state**: Invoice still exists with deletedAt set. All list queries filter `WHERE deletedAt IS NULL`.

---

## 7. Document Types & Conversion

### Document Type Registry

| Document Type | Prefix Column | Counter Column | Stock Effect | Allowed Statuses |
|---------------|---------------|----------------|--------------|------------------|
| `invoice` | invoicePrefix | nextInvoiceNumber | sale=decrement, purchase=increment | draft, unfulfilled, sent, paid, partial, overdue, cancelled |
| `quotation` | quotationPrefix | nextQuotationNumber | none | draft, sent, cancelled |
| `proforma` | proformaPrefix | nextProformaNumber | none | draft, sent, cancelled |
| `delivery_challan` | deliveryChallanPrefix | nextDeliveryChallanNumber | decrement | draft, sent, cancelled |
| `credit_note` | creditNotePrefix | nextCreditNoteNumber | increment | draft, sent, paid, cancelled |
| `debit_note` | creditNotePrefix | nextCreditNoteNumber | none | draft, sent, paid, cancelled |
| `sales_return` | creditNotePrefix | nextCreditNoteNumber | increment | draft, sent, cancelled |
| `purchase_return` | creditNotePrefix | nextCreditNoteNumber | decrement | draft, sent, cancelled |

**Shared counter**: credit_note, debit_note, sales_return, and purchase_return ALL share the creditNotePrefix/nextCreditNoteNumber counter.

---

### WORKFLOW 7A: Document Conversion

**Trigger**: `document.convert` (memberProcedure)
**Input**: `{ sourceDocumentId, targetDocumentType }`

```
STEP 1: Fetch source document + line items
  BRANCH: not found -> FAILURE(NOT_FOUND)

STEP 2: Build conversion input
  ACTION: Copy all fields from source (partyId, type, dates, notes, charges, lineItems)
  ACTION: Set referenceDocumentId = sourceDoc.id (links converted documents)

  SPECIAL CASE: delivery_challan -> invoice
    -> skipStockAdjustment = true
    -> REASON: Challan already decremented stock at creation. Converting to
       invoice must NOT decrement again. This is the ONLY case where
       skipStockAdjustment is set.

STEP 3: Delegate to target router's create procedure
  BRANCH: targetType = "invoice" -> invoiceRouter.create(convertInput)
  BRANCH: targetType = other -> matching documentRouter.create(convertInput)

STEP 4: Audit log (action="document.convert", metadata includes sourceType + targetType)

OUTPUT: { id, documentType, invoiceNumber }
```

**Valid conversion paths**:
```
quotation     -> invoice, proforma, delivery_challan
proforma      -> invoice, delivery_challan
delivery_challan -> invoice (with skipStockAdjustment!)
invoice       -> credit_note, delivery_challan, sales_return
credit_note   -> (terminal, no further conversion typical)
```

**Critical invariant**: When converting delivery_challan to invoice, stock must NOT be adjusted again. The `skipStockAdjustment=true` flag ensures this.

---

## 8. Payment Flow

### WORKFLOW 8A: Create Payment

**Trigger**: `payment.create` (memberProcedure)
**Input**: createPaymentSchema `{ partyId, amount, discount?, mode, bankAccountId?, invoiceId?, allocations?, ... }`
**Permission**: requireCan("create", "Payment")

```
BEGIN TRANSACTION

STEP 1: Validate party ownership
  SELECT party WHERE id AND businessId -> BAD_REQUEST if not found

STEP 2: Atomic payment number generation (same pattern as invoice)
  SELECT FOR UPDATE businesses -> paymentPrefix, nextPaymentNumber
  paymentNumber = "{prefix}-{nextNum}"
  UPDATE nextPaymentNumber++

STEP 3: Determine allocation strategy
  BRANCH: allocations array provided (multi-invoice payment)
    -> effectiveAllocations = input.allocations
    -> primaryInvoiceId = allocations[0].invoiceId
  BRANCH: only invoiceId provided (single-invoice payment)
    -> effectiveAllocations = [{ invoiceId, amount: input.amount }]
    -> primaryInvoiceId = input.invoiceId
  BRANCH: neither provided (advance/unallocated payment)
    -> effectiveAllocations = []
    -> primaryInvoiceId = null

STEP 4: INSERT payment
  (businessId, partyId, invoiceId=primaryInvoiceId, amount, discount, mode,
   paymentNumber, bankAccountId, createdByUserId, createdByName)

STEP 5: Apply invoice allocations
  FOR EACH allocation:
    STEP 5a: Overpayment guard
      SELECT invoice totalAmount, amountPaid
      balance = totalAmount - amountPaid
      BRANCH: allocation.amount > balance -> FAILURE(BAD_REQUEST, "exceeds invoice balance")
    STEP 5b: Atomic amountPaid + status update (single SQL)
      UPDATE invoices SET
        amount_paid = amount_paid + allocation.amount
        status = CASE
          WHEN new_amount_paid >= total_amount THEN 'paid'
          WHEN new_amount_paid > 0 THEN 'partial'
          ELSE status
        END
    STEP 5c: INSERT paymentAllocation (paymentId, invoiceId, amount)

STEP 6: Bank transaction (if bankAccountId provided)
  STEP 6a: SELECT bankAccount FOR UPDATE
  STEP 6b: Determine transaction type:
    BRANCH: linked invoice type = "sale" -> deposit (money coming IN)
    BRANCH: linked invoice type = "purchase" -> withdrawal (money going OUT)
    BRANCH: no linked invoice -> deposit (default)
  STEP 6c: INSERT bankTransaction (type, amount, referenceType="payment", referenceId=paymentId)
  STEP 6d: UPDATE bankAccount SET currentBalance = balance +/- amount

STEP 7: Gateway processing (if bankAccount is type="payment_gateway")
  -> See WORKFLOW 10A

COMMIT TRANSACTION

POST-TX: Audit log
```

**Observable state after success**:
| Entity | Change |
|--------|--------|
| `payments` | New row with paymentNumber |
| `payment_allocations` | One row per allocated invoice |
| `invoices.amountPaid` | Incremented by allocation amount |
| `invoices.status` | Transitioned to 'partial' or 'paid' |
| `bank_accounts.currentBalance` | Adjusted if bankAccountId provided |
| `bank_transactions` | Deposit or withdrawal record |
| If gateway: `expenses` | Charge expense created |
| If gateway: `bank_transactions` | Charge withdrawal + settlement transfer pair |

---

### WORKFLOW 8B: Update Payment

**Trigger**: `payment.update` (memberProcedure)
**Input**: updatePaymentSchema `{ id, amount?, mode?, bankAccountId?, allocations?, ... }`

This is a full reversal-then-reapply pattern:

```
BEGIN TRANSACTION

STEP 1: Fetch existing payment FOR UPDATE

STEP 2: REVERSE old invoice allocations
  BRANCH: allocation rows exist
    FOR EACH: UPDATE invoice SET amountPaid -= alloc.amount, recalculate status
    DELETE old paymentAllocations
  BRANCH: legacy (no allocations, just invoiceId)
    UPDATE invoice SET amountPaid -= payment.amount

STEP 3a: REVERSE old gateway operations (reverseGatewayPayment)
STEP 3b: REVERSE old bank transaction
  Find bankTransaction by referenceType="payment" + referenceId
  Reverse balance change, DELETE transaction

STEP 4: UPDATE payment record with new values

STEP 5: APPLY new allocations (same logic as create STEP 5)
STEP 6: Create new bank transaction (same as create STEP 6)
STEP 7: Process new gateway (same as create STEP 7)

COMMIT TRANSACTION
```

---

### WORKFLOW 8C: Delete Payment (Soft Delete)

**Trigger**: `payment.delete` (adminProcedure)

```
BEGIN TRANSACTION
  STEP 1: Reverse invoice amountPaid
  STEP 2: Reverse gateway operations
  STEP 3: Reverse bank transaction + balance
  STEP 4: UPDATE payment SET deletedAt=now()
COMMIT
```

---

## 9. Bank & Reconciliation

### WORKFLOW 9A: Create Bank Account

**Trigger**: `bankAccount.create` (memberProcedure)
**Input**: createBankAccountSchema `{ accountName, accountNumber?, ifsc?, bankName?, accountType, openingBalance, isDefault }`

```
STEP 1: INSERT bankAccount
  currentBalance = openingBalance (initial state)
STEP 2: If isDefault=true, UPDATE all other accounts SET isDefault=false
```

**Account types**: savings, current, cash, upi, credit_card, payment_gateway

---

### WORKFLOW 9B: Bank Transfer

**Trigger**: `bankAccount.transfer` (memberProcedure)
**Input**: bankTransferSchema `{ fromAccountId, toAccountId, amount, description?, transactionDate? }`

```
BEGIN TRANSACTION
  STEP 1: Validate both accounts belong to business
  STEP 2: SELECT fromAccount FOR UPDATE, SELECT toAccount FOR UPDATE
  STEP 3: INSERT bankTransaction (fromAccount, type="withdrawal", amount)
  STEP 4: INSERT bankTransaction (toAccount, type="deposit", amount)
  STEP 5: UPDATE fromAccount SET currentBalance -= amount
  STEP 6: UPDATE toAccount SET currentBalance += amount
COMMIT
```

---

### WORKFLOW 9C: Payment Account Assignment

**Trigger**: `payment.assignAccount` (memberProcedure)
**Input**: `{ paymentIds?, allMatching?, search?, mode?, bankAccountId }`

Bulk operation to assign bank accounts to untracked payments:

```
BEGIN TRANSACTION
  STEP 1: Verify target bankAccount exists
  STEP 2: Resolve payment IDs (explicit list OR query all matching untracked)
  STEP 3: For each payment:
    UPDATE payment SET bankAccountId
    INSERT bankTransaction (deposit or withdrawal based on linked invoice type)
  STEP 4: UPDATE bankAccount SET currentBalance += net change
COMMIT
```

---

## 10. Payment Gateway

### WORKFLOW 10A: Process Gateway Payment

**Trigger**: Called automatically inside payment.create/update when bankAccount.accountType = "payment_gateway"
**Function**: `processGatewayPayment(tx, params)`

```
STEP 1: Fetch gateway config
  SELECT paymentGatewayConfig WHERE bankAccountId AND businessId
  BRANCH: not found OR not active -> return null (no gateway processing)

STEP 2: Calculate gateway charge
  ACTION: calculateGatewayCharge(amount, chargeConfig, mode)
  LOGIC:
    Get rate for payment mode (credit_card, debit_card, upi, net_banking, wallet)
    Fall back to "default" rate if mode-specific not configured
    BRANCH: rate.type = "percentage" -> chargeAmount = amount * rate.value / 100
    BRANCH: rate.type = "flat" -> chargeAmount = rate.value
    Clamp: charge cannot exceed payment amount, cannot be negative
    netSettlement = amount - chargeAmount

STEP 3: Create charge expense (if chargeAmount > 0)
  INSERT expense (category=config.expenseCategory, amount=chargeAmount, mode="other")
  INSERT bankTransaction (gateway account, withdrawal, amount=charge, referenceType="gateway_charge", paymentId)
  UPDATE gatewayAccount.currentBalance -= chargeAmount

STEP 4: Auto-settle (if config.autoSettle AND netSettlement > 0)
  Lock both accounts in consistent order (prevent deadlocks: smaller UUID first)
  INSERT bankTransaction (gateway, withdrawal, amount=netSettlement, referenceType="gateway_settlement", paymentId)
  INSERT bankTransaction (settlement, deposit, amount=netSettlement, referenceType="gateway_settlement", paymentId)
  UPDATE gatewayAccount.currentBalance -= netSettlement
  UPDATE settlementAccount.currentBalance += netSettlement

OUTPUT: { chargeAmount, netSettlement, expenseId, settlementAccountId }
```

**Money flow example** (Rs 1000 payment via credit_card with 2% charge, autoSettle=true):
```
Gateway account: +1000 (payment deposit) -20 (charge) -980 (settlement) = net 0
Settlement account: +980
Expenses: +20 (gateway charge)
```

---

### WORKFLOW 10B: Reverse Gateway Payment

**Trigger**: Called inside payment.update/delete before main bank transaction reversal
**Function**: `reverseGatewayPayment(tx, { businessId, paymentId })`

```
STEP 1: Find all gateway-related bank transactions for this paymentId
  WHERE paymentId AND referenceType IN ("gateway_charge", "gateway_settlement")

STEP 2: Reverse charge transactions
  Soft-delete linked expense (SET deletedAt)
  Restore gateway account balance (add back charge amount)
  DELETE charge bank transaction

STEP 3: Reverse settlement transactions (come in pairs: withdrawal + deposit)
  FOR EACH settlement txn:
    Reverse balance change on the account
    DELETE settlement bank transaction
```

---

### WORKFLOW 10C: Configure Gateway

**Trigger**: `bankAccount.createGatewayConfig` (adminProcedure)
**Input**: createPaymentGatewayConfigSchema `{ bankAccountId, settlementAccountId, chargeConfig, expenseCategory, autoSettle }`

```
STEP 1: Validate bankAccountId is type="payment_gateway"
STEP 2: Validate settlementAccountId exists and belongs to business
STEP 3: INSERT paymentGatewayConfig
  Unique constraint on bankAccountId (1:1 relationship)
```

---

## 11. Recurring Invoices

### WORKFLOW 11A: Create Recurring Template

**Trigger**: `recurringInvoice.create` (memberProcedure)
**Input**: createRecurringInvoiceSchema `{ partyId, name, type, frequency, lineItems, startDate, endDate?, maxRuns?, ... }`

```
STEP 1: Validate party belongs to business
STEP 2: Calculate initial nextRunDate
  BRANCH: startDate > now -> nextRunDate = startDate
  BRANCH: startDate <= now -> nextRunDate = computeNextRunDate(now, frequency)
STEP 3: INSERT recurringInvoiceTemplate
  status = "active"
  totalRuns = 0
  lineItems stored as JSONB
```

### WORKFLOW 11B: Scheduler Tick (Every 60 seconds)

**Trigger**: setInterval in server.ts, calls `tick()` every 60s

```
STEP 1: Determine mode
  BRANCH: MULTI_TENANT=false -> get single tenant DB
  BRANCH: MULTI_TENANT=true -> iterate all active tenants

STEP 2: For each tenant DB, call processDueTemplates(db)

processDueTemplates:
  STEP 1: Find due templates
    SELECT FROM recurringInvoiceTemplates
      WHERE status="active" AND nextRunDate <= now()
      LIMIT 50
      FOR UPDATE SKIP LOCKED -- concurrency safety for multi-instance

  FOR EACH template:
    STEP 2: Plan limit check
      COUNT successful runs this month for this business
      BRANCH: >= RECURRING_RUNS_PER_MONTH (5 for free plan)
        INSERT recurringInvoiceRun (status="skipped_limit", errorMessage)
        Advance nextRunDate (so we don't retry every tick)
        CONTINUE

    STEP 3: Generate invoice
      Call generateInvoiceFromTemplate(db, template)
      (See WORKFLOW 11C)

    BRANCH: generation fails
      INSERT recurringInvoiceRun (status="failed", errorMessage)
      CONTINUE (don't crash the loop)
```

### WORKFLOW 11C: Generate Invoice from Template

**Function**: `generateInvoiceFromTemplate(db, template)`

```
BEGIN TRANSACTION
  STEP 1: Validate party still exists
    BRANCH: party deleted -> throw "Party not found"
  STEP 2: Validate line item IDs still belong to business
  STEP 3: Atomic invoice number generation (same as WORKFLOW 6A STEP 3)
  STEP 4: Calculate line items and totals
  STEP 5: INSERT invoice (source="recurring")
  STEP 6: INSERT invoiceItems
  STEP 7: Stock adjustment (same as invoice create)
  STEP 8: INSERT recurringInvoiceRun (status="success")
  STEP 9: Update template
    totalRuns++
    lastRunDate = now
    nextRunDate = computeNextRunDate(currentNextRunDate, frequency, customIntervalDays)
    BRANCH: (maxRuns reached) OR (endDate passed) -> status = "completed"
COMMIT
```

**nextRunDate calculation**:
| Frequency | Interval |
|-----------|----------|
| weekly | +7 days |
| biweekly | +14 days |
| monthly | +1 month (clamped to last day) |
| quarterly | +3 months |
| half_yearly | +6 months |
| yearly | +12 months |
| custom | +customIntervalDays (default 30) |

### WORKFLOW 11D: Pause / Resume / Run Now

```
PAUSE:
  Precondition: status = "active"
  UPDATE template SET status = "paused"

RESUME:
  Precondition: status = "paused"
  Recalculate nextRunDate from NOW (not from where it left off)
  UPDATE template SET status = "active", nextRunDate = new

RUN NOW:
  Precondition: status = "active" OR "paused"
  Call generateInvoiceFromTemplate immediately
```

---

## 12. Expense Tracking

### WORKFLOW 12A: Create Expense

**Trigger**: `expense.create` (memberProcedure)
**Input**: createExpenseSchema `{ category, description?, amount, mode, expenseDate?, referenceNumber?, bankAccountId? }`

```
BEGIN TRANSACTION

STEP 1: Permission check (requireCan("create", "Expense"))

STEP 2: INSERT expense

STEP 3: Resolve target bank account
  BRANCH: bankAccountId explicitly provided -> use it
  BRANCH: bankAccountId not provided -> auto-resolve from payment mode:
    cash -> bankAccounts WHERE type="cash"
    bank/cheque -> bankAccounts WHERE type IN ("savings", "current")
    upi -> bankAccounts WHERE type="upi"
    other -> no auto-resolve (skip bank debit)
    ORDER BY isDefault DESC, createdAt ASC -> pick first match

STEP 4: If target bank account resolved:
  SELECT account FOR UPDATE
  INSERT bankTransaction (type="withdrawal", referenceType="expense", referenceId=expense.id)
  UPDATE bankAccount SET currentBalance -= amount

COMMIT TRANSACTION

STEP 5: Audit log
```

### WORKFLOW 12B: Update Expense

**Pattern**: Reverse old bank transaction, then create new one (same as payment update pattern).

```
BEGIN TRANSACTION
  Fetch existing expense FOR UPDATE
  Find and reverse old bankTransaction (if exists): restore balance, DELETE txn
  UPDATE expense with new values
  Resolve new bank account (same logic as create)
  Create new bankTransaction + update balance
COMMIT
```

### WORKFLOW 12C: Delete Expense (Soft Delete)

```
BEGIN TRANSACTION
  Reverse bank transaction (restore balance, DELETE txn)
  UPDATE expense SET deletedAt=now()
COMMIT
```

**Auto-created expenses**: Gateway charge expenses are created by `processGatewayPayment` with mode="other" and category from gateway config. These are soft-deleted by `reverseGatewayPayment`.

---

## 13. GST Flow

### WORKFLOW 13A: Tax Classification

**Decision tree for inter/intra-state GST**:

```
STEP 1: Determine business stateCode (businesses.stateCode)
STEP 2: Determine party stateCode (parties.stateCode)

BRANCH: business.gstRegistrationType = "unregistered"
  -> No GST applicable, tax = 0

BRANCH: business.stateCode == party.stateCode (intra-state)
  -> Split tax into CGST (50%) + SGST (50%)
  -> Example: 18% tax -> CGST 9% + SGST 9%

BRANCH: business.stateCode != party.stateCode (inter-state)
  -> Apply IGST (full rate)
  -> Example: 18% tax -> IGST 18%

BRANCH: party.stateCode is null/empty
  -> Treat as intra-state (default)
```

### WORKFLOW 13B: GSTR Report Generation

**Reports generated**: GSTR-1 (outward supplies), GSTR-3B (summary)
**Trigger**: `gst.gstr1` / `gst.gstr3b` (viewerProcedure)
**Input**: `{ fromDate, toDate }`

```
STEP 1: Fetch all sale invoices in date range
STEP 2: Classify each invoice:
  B2B (business-to-business): party has GSTIN
  B2C (business-to-consumer): party has no GSTIN
    B2C Large: totalAmount > 2,50,000 (inter-state)
    B2C Small: everything else
STEP 3: Group by tax rate and state
STEP 4: Calculate totals per slab
```

---

## 14. Online Store

### WORKFLOW 14A: Configure Store

**Trigger**: `store.updateSettings` (adminProcedure)

```
STEP 1: Permission check (manage Store)
STEP 2: Validate slug uniqueness (within tenant DBs)
  BRANCH: slug already taken by another business -> FAILURE(CONFLICT)
STEP 3: UPDATE business with store settings
```

### WORKFLOW 14B: Store Order Lifecycle

**Order statuses**: pending -> confirmed -> preparing -> ready -> delivered
                     pending -> cancelled (from any non-terminal state)

```
NEW ORDER (external/public):
  INSERT storeOrder (status="pending", customerName, customerPhone, ...)
  INSERT linked invoice (documentType="invoice", status="draft")
  INSERT invoiceItems from order items
  Stock adjustment (if applicable)

CONFIRM ORDER:
  Precondition: status = "pending"
  UPDATE storeOrder SET status="confirmed", confirmedAt=now()
  UPDATE linked invoice SET status="sent"

UPDATE STATUS:
  Allowed transitions: confirmed -> preparing -> ready -> delivered
  BRANCH: status = "cancelled" -> FAILURE(BAD_REQUEST)

CANCEL ORDER:
  Precondition: status != "delivered" AND status != "cancelled"
  UPDATE storeOrder SET status="cancelled", cancellationReason, cancelledAt
  UPDATE linked invoice SET status="cancelled"
```

---

## 15. Shipment

### WORKFLOW 15A: Auto-Created Shipment

Shipments are auto-created during invoice creation when a shipping charge is detected:

```
TRIGGER: Invoice create, type="sale", charges array contains label matching /shipping|delivery|freight|transport/i

ACTION: INSERT shipment
  businessId, invoiceId, partyId
  mode = deliveryMethod (from invoice, mapped)
  cost = shipping charge amount
  status = "pending"
```

### WORKFLOW 15B: Create Shipment (Manual)

**Trigger**: `shipment.create` (memberProcedure)
**Permission**: requireCan("create", "Invoice") -- note: uses Invoice permission, not a Shipment resource

```
STEP 1: Auto-generate tracking URL
  If carrier is recognized (delhivery, bluedart, dtdc, ecom_express, india_post, shadowfax, xpressbees)
  AND trackingNumber provided -> auto-build tracking URL

STEP 2: INSERT shipment
  trackingUrl = input.trackingUrl OR autoUrl OR null
  (input trackingUrl takes priority over auto-generated)
```

### WORKFLOW 15C: Update Shipment

```
SPECIAL BEHAVIOR:
  When status set to "delivered" AND actualDelivery not provided:
    -> actualDelivery auto-set to now()

  When trackingNumber changes AND carrier recognized:
    -> trackingUrl auto-regenerated
```

### WORKFLOW 15D: Delete Shipment

**NOTE**: Shipment delete is a HARD DELETE (not soft delete). This differs from invoices and payments.

### WORKFLOW 15E: Shipment Status Transitions

```
[pending] -> shipped -> in_transit -> delivered
[pending] -> returned (from any non-delivered state)
```

The schema defines `shipmentEvents` for status timeline tracking, but the current shipment router does NOT create shipment events on status transitions. This appears to be future infrastructure that is not yet wired up.

---

## 16. Permissions Matrix

### CASL Ability Definitions by Role

| Resource | superadmin | admin | seller_manager | seller | accountant |
|----------|-----------|-------|----------------|--------|------------|
| Invoice - create | Y | Y | Y | Y | - |
| Invoice - read | Y | Y | Y | Y | Y (read-only) |
| Invoice - update | Y | Y | Y | Y (own, <2h) | - |
| Invoice - delete | Y | Y | Y (unpaid, <2h) | - | - |
| Payment - create | Y | Y | Y | Y | Y |
| Payment - read | Y | Y | Y | Y | Y |
| Payment - update | Y | Y | Y (own, <2h) | Y (own, <2h) | Y |
| Payment - delete | Y | Y | - | - | - |
| Party - create | Y | Y | Y | Y | - |
| Party - read | Y | Y | Y | Y | Y |
| Party - update | Y | Y | Y | - | - |
| Item - create | Y | Y | Y | - | - |
| Item - read | Y | Y | Y | Y | Y |
| Item - update | Y | Y | Y | - | - |
| Expense - CRUD | Y | Y | read-only | - | Y (full) |
| BankAccount - manage | Y | Y | read-only | - | Y (full) |
| Business - manage | Y | Y | read-only | read-only | read-only |
| Report - read | Y | Y | Y | - | Y |
| GstReport - read | Y | Y | - | - | Y |
| Store - manage | Y | Y | Y (create/read/update) | read-only | read-only |
| RecurringInvoice | Y | Y | Y (full) | read-only | read-only |
| SalesTarget | Y | Y | Y (manage) | read-only | - |
| Team - manage | Y | Y | - | - | - |

### Legacy Role Mapping

| DB Value | Maps To |
|----------|---------|
| owner | superadmin |
| admin | admin |
| member | seller |
| viewer | accountant |

### Procedure Level Requirements

| Procedure | Requires |
|-----------|----------|
| publicProcedure | Nothing |
| protectedProcedure | Valid session (cookie or Bearer token) |
| tenantProcedure | Session + tenantId on session |
| viewerProcedure | Session + tenant + business (x-business-id header) + CASL ability |
| memberProcedure | Same as viewer (CASL distinguishes at resource level) |
| adminProcedure | Same as viewer (CASL distinguishes at resource level) |

---

## 17. Plan Limits

### Plan Definitions

| Limit | free | pro | business | enterprise |
|-------|------|-----|----------|------------|
| maxBusinesses | 1 | 5 | unlimited | unlimited |
| maxTeamMembers | 3 | 15 | unlimited | unlimited |
| maxConcurrentSessions | 3 | 10 | unlimited | unlimited |
| maxApiKeys | 0 | 3 | unlimited | unlimited |
| recurringRunsPerMonth | 5 | unlimited | unlimited | unlimited |
| auditRetentionDays | 30 | 365 | unlimited | unlimited |
| dataExport | no | yes | yes | yes |
| onlineStore | no | yes | yes | yes |
| pdfBranding | yes | no | no | no |

### Enforcement Points

| Limit | Where Enforced | Behavior on Exceed |
|-------|---------------|-------------------|
| maxBusinesses | business.create | FORBIDDEN error |
| maxTeamMembers | tenant.inviteMember | FORBIDDEN error (counts members + pending invites) |
| maxConcurrentSessions | session creation | FIFO eviction (oldest session deleted, login NOT blocked) |
| maxApiKeys | apiKey.create | FORBIDDEN error (0 on free = feature gated) |
| recurringRunsPerMonth | scheduler tick | Run skipped, run record created with status="skipped_limit" |
| dataExport | business.exportData | FORBIDDEN error |

---

## Appendix A: Handoff Contracts

### A1: Auth Session Contract

```
SESSION CREATION:
  Creates: sessions row (id, userId, tenantId, expiresAt, ipAddress, userAgent)
  Sets: Set-Cookie: session_id={nanoid64}; Path=/; HttpOnly; SameSite=Lax; Secure(prod); Max-Age=2592000
  Caches: In-memory LRU (invalidated on tenant switch, profile update, logout)

SESSION RESOLUTION (on every request):
  Source: Cookie "session_id" OR Authorization: Bearer {sessionId}
  Lookup: SELECT session + user WHERE session.id AND session.expiresAt > now()
  Updates: session.lastUsedAt = now() (touch on use)
  Result: ctx.user, ctx.tenantId (may be null if multi-tenant and not yet selected)
```

### A2: Business Isolation Contract

```
HEADER: x-business-id: {uuid}
MIDDLEWARE: hasBusinessAccess
  Validates: business exists in tenant DB
  Sets: ctx.businessId, ctx.db (tenant-scoped database connection)
  All subsequent queries MUST include WHERE businessId = ctx.businessId
```

### A3: Atomic Number Generation Contract

```
PATTERN (used by invoice, payment, quotation, credit_note, delivery_challan, proforma, store_order):
  1. SELECT prefix, counter FROM businesses WHERE id = businessId FOR UPDATE
  2. number = "{prefix}-{counter.toString().padStart(5, '0')}"
  3. UPDATE businesses SET counter = counter + 1
  
  FOR UPDATE lock prevents concurrent requests from getting the same number.
  All three steps MUST be in the same transaction.
```

### A4: Stock Adjustment Contract

```
FOR sale invoices (and delivery_challan):
  item.stockQuantity -= quantity * conversionFactor
  variant.stockQuantity -= quantity (no conversion factor for variants)

FOR purchase invoices:
  item.stockQuantity += quantity * conversionFactor
  variant.stockQuantity += quantity

FOR credit_note and sales_return (stock effect = increment):
  item.stockQuantity += quantity * conversionFactor (items come back)

FOR purchase_return (stock effect = decrement):
  item.stockQuantity -= quantity * conversionFactor (items sent back)

AGGREGATION: Multiple line items referencing the same item/variant are
  aggregated (summed) before the UPDATE to avoid N+1 per-row updates.

REVERSAL: On invoice update (with lineItems) or delete:
  1. Read old line items
  2. Reverse old stock effects (opposite direction)
  3. Apply new stock effects (for update) or stop (for delete)
```

### A5: Payment -> Invoice Status Contract

```
ALLOCATION CREATES/UPDATES:
  UPDATE invoices SET
    amount_paid = amount_paid + allocation_amount,
    status = CASE
      WHEN new_paid >= total_amount THEN 'paid'
      WHEN new_paid > 0 THEN 'partial'
      ELSE status
    END

ALLOCATION REVERSAL:
  UPDATE invoices SET
    amount_paid = MAX(amount_paid - allocation_amount, 0),
    status = CASE
      WHEN new_paid >= total_amount THEN 'paid'
      WHEN new_paid > 0 THEN 'partial'
      ELSE 'sent'  -- reverts to 'sent' when fully reversed
    END
```

### A6: Gateway Processing Contract

```
TRIGGER: bankAccount.accountType = "payment_gateway" on payment create/update
INPUT: { businessId, paymentId, paymentNumber, bankAccountId, amount, mode, paymentDate }

FLOW:
  1. Lookup paymentGatewayConfig for bankAccountId
  2. Calculate charge based on mode (mode-specific rate, fallback to default)
  3. If charge > 0: create expense + withdrawal from gateway account
  4. If autoSettle + net > 0: transfer net from gateway to settlement account

LOCK ORDER: Smaller UUID first (prevents deadlocks when locking 2 accounts)

REVERSAL (called BEFORE main bank transaction reversal):
  1. Find all gateway bank_transactions WHERE paymentId
  2. Reverse charge: soft-delete expense, restore gateway balance
  3. Reverse settlement: restore both gateway and settlement balances
```

---

## Appendix B: Test Case Derivation

Every branch in the workflow trees above maps to a BDD test case. Below is the complete mapping organized by workflow.

### B1: Auth Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| AUTH-01 | 1A | Happy path | Register with valid data, verify session created |
| AUTH-02 | 1A | Turnstile required | Register without token when TURNSTILE_SECRET_KEY set -> BAD_REQUEST |
| AUTH-03 | 1A | Turnstile fails | Register with invalid token -> FORBIDDEN |
| AUTH-04 | 1A | Duplicate email | Register with existing email -> CONFLICT |
| AUTH-05 | 1A | Pending invite | Register with email that has pending invite -> no auto-tenant, user has 0 memberships |
| AUTH-06 | 1A | Self-hosted mode | Register without MULTI_TENANT -> default tenant created/joined |
| AUTH-07 | 1B | Happy path | Login with correct credentials -> session |
| AUTH-08 | 1B | Wrong password | Login with wrong password -> UNAUTHORIZED, attempt counted |
| AUTH-09 | 1B | Rate limited | Login 5+ times with wrong password -> TOO_MANY_REQUESTS |
| AUTH-10 | 1B | No memberships | Login for user with 0 memberships -> FORBIDDEN |
| AUTH-11 | 1B | Password-less account | Login with password for magic-link-only user -> UNAUTHORIZED |
| AUTH-12 | 1C | Happy path | Request magic link -> always returns success |
| AUTH-13 | 1C | Rate limited | Request 6th link in 15min -> returns success (silent) |
| AUTH-14 | 1D | Happy path, new user | Verify magic link -> new user created, needsProfile=true |
| AUTH-15 | 1D | Happy path, existing user | Verify magic link -> existing user, emailVerified=true |
| AUTH-16 | 1D | Expired token | Verify expired token -> BAD_REQUEST |
| AUTH-17 | 1D | Used token | Verify already-used token -> BAD_REQUEST |
| AUTH-18 | 1D | New user with invite | Magic link creates user, skips auto-tenant |
| AUTH-19 | 1E | Happy path | Complete profile -> name updated |
| AUTH-20 | 1F | Happy path | Request + confirm email change |
| AUTH-21 | 1F | Email taken | Request email change to taken email -> CONFLICT |
| AUTH-22 | 1G | Logout | Session deleted, cookie cleared |
| AUTH-23 | 1G | Logout all | All sessions deleted |
| AUTH-24 | 1G | Revoke other session | Target session deleted |
| AUTH-25 | 1G | Revoke current session | -> BAD_REQUEST |

### B2: Team Management Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| TEAM-01 | 2A | Happy path | Admin invites member -> invitation created, email sent |
| TEAM-02 | 2A | Non-admin caller | Seller tries to invite -> FORBIDDEN |
| TEAM-03 | 2A | Plan limit | Free plan, 3 members -> invite fails with upgrade message |
| TEAM-04 | 2A | Already a member | Invite existing member -> CONFLICT |
| TEAM-05 | 2A | Duplicate pending invite | Invite same email twice -> CONFLICT |
| TEAM-06 | 2B | Happy path | Accept invite -> membership created, tenant auto-selected |
| TEAM-07 | 2B | Expired token | Accept expired invite -> NOT_FOUND |
| TEAM-08 | 2B | Already accepted | Accept already-accepted invite -> BAD_REQUEST |
| TEAM-09 | 2B | Email mismatch | Wrong user accepts invite -> FORBIDDEN |
| TEAM-10 | 2B | Double-click | Already member accepts -> idempotent success |
| TEAM-11 | 2C | Happy path | Admin removes seller -> membership deleted |
| TEAM-12 | 2C | Self-removal | Remove yourself -> BAD_REQUEST |
| TEAM-13 | 2C | Remove superadmin | Try to remove owner -> FORBIDDEN |
| TEAM-14 | 2D | Happy path | Change seller to accountant |
| TEAM-15 | 2D | Change owner role | -> FORBIDDEN |

### B3: Invoice Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| INV-01 | 6A | Happy path, sale | Create sale invoice -> stock decremented, number generated |
| INV-02 | 6A | Happy path, purchase | Create purchase invoice -> stock incremented |
| INV-03 | 6A | Party validation | partyId from different business -> BAD_REQUEST |
| INV-04 | 6A | Item validation | itemId from different business -> BAD_REQUEST |
| INV-05 | 6A | Concurrent number | Two simultaneous creates -> unique numbers (FOR UPDATE) |
| INV-06 | 6A | skipStockAdjustment | Create with skip -> stock unchanged |
| INV-07 | 6A | Shipping charge detected | Sale with shipping charge -> shipment auto-created |
| INV-08 | 6A | No shipping charge | Sale without shipping -> no shipment |
| INV-09 | 6A | Alt unit conversion | Line item with conversionFactor -> stock adjusted by qty*factor |
| INV-10 | 6A | Variant stock | Line item with variantId -> variant stock adjusted, not item |
| INV-11 | 6A | Multiple items same item | Two lines referencing same item -> aggregated stock delta |
| INV-12 | 6A | Tax-inclusive calc | Item with taxInclusive=true -> back-calculated correctly |
| INV-13 | 6A | Invoice-level discount (percent) | Percent discount applied to subtotal |
| INV-14 | 6A | Invoice-level discount (amount) | Flat discount amount |
| INV-15 | 6A | Charges array | Multiple named charges -> chargesTotal summed |
| INV-16 | 6A | Round-off | Positive and negative round-off applied to total |
| INV-17 | 6B | Happy path | Update line items -> old stock reversed, new applied |
| INV-18 | 6B | Edit paid invoice | -> BAD_REQUEST |
| INV-19 | 6C | Status transition | draft -> sent |
| INV-20 | 6D | Happy path | Delete invoice -> soft delete, stock reversed |
| INV-21 | 6D | seller_manager delete paid | -> FORBIDDEN |
| INV-22 | 6D | seller_manager delete old | >2 hours -> FORBIDDEN |
| INV-23 | 6D | Idempotent | Delete already-deleted -> success |

### B4: Document Conversion Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| DOC-01 | 7A | Quotation -> Invoice | New invoice created, referenceDocumentId set, stock adjusted |
| DOC-02 | 7A | Proforma -> Invoice | Same as above |
| DOC-03 | 7A | Challan -> Invoice | skipStockAdjustment=true, stock NOT double-decremented |
| DOC-04 | 7A | Invoice -> Credit Note | Stock incremented (returned items) |
| DOC-05 | 7A | Invoice -> Sales Return | Stock incremented |
| DOC-06 | 7A | Source not found | -> NOT_FOUND |

### B5: Payment Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| PAY-01 | 8A | Single invoice allocation | Payment -> invoice.amountPaid updated, status partial/paid |
| PAY-02 | 8A | Multi-invoice allocation | Split payment across 2+ invoices |
| PAY-03 | 8A | Overpayment guard | Allocation > balance -> BAD_REQUEST |
| PAY-04 | 8A | Unallocated payment | No invoiceId or allocations -> payment created, no invoice update |
| PAY-05 | 8A | Bank account deposit | Sale payment with bankAccountId -> deposit transaction, balance + |
| PAY-06 | 8A | Bank account withdrawal | Purchase payment -> withdrawal transaction, balance - |
| PAY-07 | 8A | Gateway auto-processing | Payment to gateway account -> charge expense + settlement |
| PAY-08 | 8A | Party validation | partyId wrong business -> BAD_REQUEST |
| PAY-09 | 8B | Update amount | Reverse old, apply new -> invoice amounts recalculated |
| PAY-10 | 8B | Update allocations | Old reversed, new applied |
| PAY-11 | 8B | Switch bank account | Old bank txn reversed, new created |
| PAY-12 | 8B | Gateway reversal on update | Old gateway ops reversed, new applied |
| PAY-13 | 8C | Delete with invoice | amountPaid reversed, bank txn reversed, gateway reversed |
| PAY-14 | 8C | Delete already-deleted | Idempotent success |
| PAY-15 | 8C | **BUG** Delete multi-invoice payment | Only primary invoice amountPaid reversed; other allocations NOT reversed |
| PAY-16 | 8C | Delete does not recalculate invoice status | Invoice amountPaid decremented but status not recalculated (stays "paid") |

### B6: Gateway Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| GW-01 | 10A | Percentage charge | 2% on 1000 -> charge=20, net=980 |
| GW-02 | 10A | Flat charge | Flat 20 on 1000 -> charge=20, net=980 |
| GW-03 | 10A | Mode-specific rate | credit_card rate used, not default |
| GW-04 | 10A | Fallback to default | Unknown mode -> default rate used |
| GW-05 | 10A | No config | Gateway account without config -> null (no processing) |
| GW-06 | 10A | Charge > amount | Clamped to payment amount |
| GW-07 | 10A | autoSettle=true | Net transferred to settlement account |
| GW-08 | 10A | autoSettle=false | No settlement transfer, only charge |
| GW-09 | 10B | Full reversal | Expense soft-deleted, balances restored, txns deleted |

### B7: Recurring Invoice Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| REC-01 | 11A | Create template | Template active, nextRunDate calculated |
| REC-02 | 11B | Scheduler generates invoice | Template due -> invoice created, totalRuns++, nextRunDate advanced |
| REC-03 | 11B | Plan limit hit | 5th run on free -> status="skipped_limit", nextRunDate still advanced |
| REC-04 | 11B | Generation fails | Party deleted -> run recorded as "failed", loop continues |
| REC-05 | 11C | maxRuns reached | After final run -> template status = "completed" |
| REC-06 | 11C | endDate passed | Next run would be past endDate -> "completed" |
| REC-07 | 11D | Pause active | -> status="paused", scheduler skips it |
| REC-08 | 11D | Resume paused | -> status="active", nextRunDate recalculated from now |
| REC-09 | 11D | Pause non-active | -> BAD_REQUEST |
| REC-10 | 11D | Resume non-paused | -> BAD_REQUEST |
| REC-11 | 11D | Run now | Manual trigger -> invoice created immediately |

### B8: Bank & Reconciliation Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| BANK-01 | 9A | Create account | Account with openingBalance, currentBalance=openingBalance |
| BANK-02 | 9A | Set default | isDefault=true -> all others set to false |
| BANK-03 | 9B | Transfer | From account - amount, To account + amount, 2 bank_transaction rows |
| BANK-04 | 9C | Assign bulk | Multiple untracked payments -> all assigned, balance updated once |

### B9: Store Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| STORE-01 | 14A | Configure store | Slug uniqueness validated |
| STORE-02 | 14A | Duplicate slug | -> CONFLICT |
| STORE-03 | 14B | Confirm order | pending -> confirmed, invoice draft -> sent |
| STORE-04 | 14B | Cancel order | Sets cancelled, sets invoice cancelled |
| STORE-05 | 14B | Cancel delivered | -> BAD_REQUEST |
| STORE-06 | 14B | Update status flow | confirmed -> preparing -> ready -> delivered |

### B10: Plan Limit Test Cases

| ID | Workflow | Branch | Test Description |
|----|----------|--------|-----------------|
| PLAN-01 | 17 | Free business limit | 2nd business on free -> FORBIDDEN |
| PLAN-02 | 17 | Free team limit | 4th member/invite on free -> FORBIDDEN |
| PLAN-03 | 17 | Session FIFO eviction | 4th session on free -> oldest evicted, login succeeds |
| PLAN-04 | 17 | API keys on free | -> FORBIDDEN (0 allowed) |
| PLAN-05 | 17 | Data export on free | -> FORBIDDEN |

---

## Appendix C: State Machine Summary

### Invoice State Machine

```
             +--------+
             | draft  |
             +---+----+
                 |
        updateStatus("sent")
                 |
                 v
             +--------+     payment (partial)    +----------+
             |  sent  | -----------------------> | partial  |
             +---+----+                          +----+-----+
                 |                                    |
                 | payment (full)    payment (full)   |
                 |    +-------------------------------+
                 |    |
                 v    v
             +--------+
             |  paid  |
             +--------+
             
  ANY non-terminal state can -> [cancelled] via updateStatus or delete
  
  "overdue" is computed, not stored:
    WHERE dueDate < NOW() AND status NOT IN ('paid', 'cancelled', 'draft')
```

### Recurring Template State Machine

```
  [active] <-> [paused]    (pause/resume)
  [active]  -> [completed] (maxRuns or endDate reached)
  [active]  -> [expired]   (endDate passed without completion)
  [any]     -> DELETED     (hard delete by admin)
```

### Store Order State Machine

```
  [pending] -> [confirmed] -> [preparing] -> [ready] -> [delivered]
  [pending|confirmed|preparing|ready] -> [cancelled]
```

### Shipment State Machine

```
  [pending] -> [shipped] -> [in_transit] -> [delivered]
  [pending|shipped|in_transit] -> [returned]
```

---

## Appendix D: Assumptions

| # | Assumption | Verified Against | Risk if Wrong |
|---|-----------|-----------------|---------------|
| A1 | Session cache invalidation is immediate (in-memory Map) | context.ts | Stale data for up to 1 request if multi-instance |
| A2 | Stock can go negative (no constraint) | Schema has no CHECK >= 0 | Items can show negative stock after overselling |
| A3 | Payment allocations are fully consistent | FOR UPDATE locks used | Low risk -- PostgreSQL enforces serialization |
| A4 | Recurring scheduler runs on single instance | FOR UPDATE SKIP LOCKED | Safe for multi-instance but runs may process slowly |
| A5 | Gateway lock order (smaller UUID first) prevents deadlocks | gateway.ts code | If violated, deadlock possible between concurrent payments |
| A6 | deletedAt soft-delete is consistently filtered | Checked all list queries | If a query misses isNull(deletedAt), deleted records show up |
| A7 | Invoice number uniqueness is per-business | uniqueIndex on (businessId, invoiceNumber) | Cross-business collision impossible |
| A8 | Overdue is computed, never stored | List query uses SQL expression | Dashboard and reports must use same computation |
| A9 | All money strings have exactly 2 decimal places | money.ts fromPaise() | Display and comparison depend on this format |
| A10 | Login rate limiting is in-memory (not shared across instances) | auth.ts Map | Multi-instance deployment allows 5 * N attempts |

---

## Appendix E: Open Questions

1. **Stock enforcement**: Nothing prevents stockQuantity from going negative. Should there be a CHECK constraint or application-level guard for sales? The store has `storeAllowNegativeStock` but invoices have no such check.

2. **Invoice edit with payments**: Editing an invoice that has payments but is status="partial" IS allowed. If the edited totalAmount becomes less than amountPaid, does the invoice become "overpaid"? The code does not check this.

3. **BUG: Payment delete does not reverse multi-invoice allocations**: `payment.delete` (line 693-700 of payment.ts) only reverses `amountPaid` on the single `payment.invoiceId` column using `payment.amount`. For multi-invoice payments that use `paymentAllocations`, the non-primary invoices' `amountPaid` is never reversed, leaving them with inflated paid amounts. The `payment.update` handler (lines 460-493) correctly iterates `paymentAllocations` for reversal, but `payment.delete` does not. This is a data integrity bug.

4. **Concurrent template processing**: `FOR UPDATE SKIP LOCKED` on the scheduler prevents double-processing, but if a template's `generateInvoiceFromTemplate` takes longer than 60 seconds, the next tick could pick up already-processing templates on another instance. The lock is per-transaction so this is safe, but throughput may suffer.

5. **Email change race**: If two email-change requests are sent in rapid succession, both tokens are valid until one is used. The second use will fail (atomically marked as used), but the UX may be confusing.
