# Hisaabo Workflow Map

**Version**: 1.0
**Date**: 2026-03-28
**Author**: Workflow Architect
**Status**: Draft
**Scope**: All user-facing and system workflows across Web, Mobile, and Store platforms

---

## About This Document

This document maps every workflow in the Hisaabo application — verified against actual source code in `packages/api/src/routers/`, `apps/web/src/routes/`, `apps/mobile/app/`, and `apps/store/src/`. Every step, branch, failure mode, and role constraint listed here was confirmed from reading the code, not inferred from descriptions.

**Role definitions** (from `packages/api/src/lib/permissions.ts`):

| Role | Can Do |
|---|---|
| superadmin / owner | Everything — full manage on all resources |
| admin | Everything — full manage on all resources |
| seller_manager | Create/read/update invoices, parties, items, payments; read expenses/bank/reports; manage store and sales targets |
| seller | Create/read invoices (own, within 2h edit window); read parties/items; create payments (own) |
| accountant | Read invoices/parties/items; manage payments, expenses, bank accounts, transactions; read reports |

---

## Workflow Index

| ID | Workflow | Platform | Roles | Status |
|---|---|---|---|---|
| WF-01 | First-time Setup | Web, Mobile | All | Approved |
| WF-02 | Password / Magic Link Login | Web, Mobile | All | Approved |
| WF-03 | Mobile Biometric / PIN Unlock | Mobile | All | Approved |
| WF-04 | Create Sale Invoice | Web, Mobile | superadmin, admin, seller_manager, seller | Approved |
| WF-05 | Create Purchase Invoice | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-06 | Edit Invoice | Web, Mobile | superadmin, admin, seller_manager, seller (own, <2h) | Approved |
| WF-07 | Record Payment (Single Invoice) | Web, Mobile | superadmin, admin, seller_manager, seller, accountant | Approved |
| WF-08 | Record Multi-Invoice Payment | Web, Mobile | superadmin, admin, seller_manager, accountant | Approved |
| WF-09 | Share Invoice PDF | Web, Mobile | superadmin, admin, seller_manager, seller | Approved |
| WF-10 | Convert Quotation to Invoice | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-11 | Add New Party | Web, Mobile | superadmin, admin, seller_manager, seller | Approved |
| WF-12 | Add Party from Phone Contacts | Mobile | superadmin, admin, seller_manager, seller | Approved |
| WF-13 | View Party Ledger | Web, Mobile | superadmin, admin, seller_manager, accountant | Approved |
| WF-14 | Merge Duplicate Parties | Web | superadmin, admin | Approved |
| WF-15 | Add Simple Item | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-16 | Add Item with Variants | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-17 | Add Item with Alt Units | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-18 | Adjust Stock | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-19 | Record Expense | Web, Mobile | superadmin, admin, seller_manager, accountant | Approved |
| WF-20 | Bank Account Transfer | Web, Mobile | superadmin, admin, accountant | Approved |
| WF-21 | View Dashboard | Web, Mobile | All except seller (no Report permission) | Approved |
| WF-22 | Generate GSTR-1 / Sales Report | Web | superadmin, admin, seller_manager, accountant | Approved |
| WF-23 | View Profit & Loss | Web | superadmin, admin, seller_manager, accountant | Approved |
| WF-24 | View Receivables Aging | Web | superadmin, admin, seller_manager, accountant | Approved |
| WF-25 | Export to Tally | Web | superadmin, admin, accountant | Approved |
| WF-26 | Invite Team Member | Web | superadmin, admin, owner | Approved |
| WF-27 | Accept Team Invitation | Web, Mobile | Invited user | Approved |
| WF-28 | Set Sales Target | Web | superadmin, admin, seller_manager | Approved |
| WF-29 | View Team Performance | Web | superadmin, admin, seller_manager | Approved |
| WF-30 | Customer Places Store Order | Store (browser) | Public (no auth) | Approved |
| WF-31 | Business Confirms Store Order | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-32 | Business Fulfills Store Order | Web, Mobile | superadmin, admin, seller_manager | Approved |
| WF-33 | Import Data from MyBillBook | Web | superadmin, admin | Approved |
| WF-34 | Export Business Data | Web | superadmin, admin | Approved |

**Parity gap note**: The following workflows exist on Web but have no mobile equivalent screen:
- WF-14 (Merge Parties) — mobile has party detail but no merge UI
- WF-22 (GSTR-1/Reports) — mobile has no reports tab
- WF-23 (P&L) — mobile only
- WF-24 (Aging Report) — web only
- WF-25 (Tally Export) — web only
- WF-28 (Set Sales Target) — admin side is web only; seller view (`myTargets`) is accessible mobile via the team screen
- WF-33 (Import) — web only
- WF-34 (Export) — web only
- Credit notes, delivery challans, proforma invoices — web-only creation (mobile has read list under More tab but no create screen)

---

## WF-01: First-time Setup

**Trigger**: New user registers and is redirected post-login
**Roles**: All
**Platform**: Web, Mobile

### Happy path

1. User lands on `/login` (web) or the login screen (mobile).
2. Registers with email + password (or receives a magic link — see WF-02).
3. On first magic link verification, `verifyMagicLink` returns `needsProfile: true` when `user.name` is null.
4. Web redirects to `/auth/complete-profile` (detected in root layout: `!session.user.name`). Mobile redirects to `/(auth)/verify` which reads `needsProfile`.
5. User enters display name. `auth.completeProfile` is called → name saved → session cache invalidated.
6. Root layout detects `businesses.length === 0` → redirects to `/settings`.
7. Settings page renders `<BusinessForm>` (no business exists yet).
8. User fills business name, GST type, optional GSTIN, PAN, phone, address → `business.create` called.
9. A Cash bank account is auto-created atomically with the business (inside the same `business.create` transaction).
10. After business creation, `<WhatsNextModal>` appears offering: Import data or Start fresh.
11. If "Import data" → `<ImportWizard>` opens (WF-33).
12. If "Start fresh" → user navigates to Invoices/Items to begin.

### Branch conditions

- **Password registration vs magic link**: Password registration completes name in the form. Magic link registration creates a nameless user requiring the complete-profile step.
- **GST registered?**: If `gstRegistrationType !== "unregistered"` and GSTIN provided, invoice PDFs render as full GST invoices; reports show GST terminology. If unregistered, UI shows "Sales Report" / "Tax Summary" labels instead.
- **Multi-tenant mode**: If `MULTI_TENANT=true`, a new tenant is created for the user's org. If `MULTI_TENANT=false` (default self-hosted), the user joins the shared "Default Organization" tenant. The first joiner gets `owner` role; subsequent users get `member`.
- **Has existing data?**: Import wizard shown post-setup. Skippable.

### Failure modes

- **Duplicate email during registration**: `auth.register` throws `CONFLICT`. User sees "Email already registered" error. No account created.
- **Invalid GSTIN format**: Client-side validation rejects the format before submission.
- **Business name already used**: No uniqueness constraint on business name — two businesses with the same name can exist. Gap: no deduplication warning.
- **Session expired during setup**: Root layout detects no session → redirects to `/login`. Setup progress is lost — resume is not implemented. The user must restart business creation.

### Observable states

- User record: created (no name) → name set → profile complete
- Business: not exists → exists (with Cash account)
- Milestone banner: "Your first invoice" displayed after first invoice is created (localStorage key checked)

---

## WF-02: Password / Magic Link Login

**Trigger**: User navigates to `/login` (web) or opens login screen (mobile)
**Roles**: All
**Platform**: Web, Mobile

### Happy path — magic link

1. User enters email. Client calls `auth.sendMagicLink`.
2. API generates a raw token (`crypto.randomUUID() + nanoid(32)`), stores SHA-256 hash in `magic_link_tokens`, emails the raw token link to the user. Always returns `{ success: true }` regardless of whether the email exists (anti-enumeration).
3. Token expires in 15 minutes.
4. User clicks link → browser opens `/auth/verify?token=<rawToken>`.
5. `auth.verifyMagicLink` atomically marks token `usedAt` (TOCTOU-safe single UPDATE), looks up or creates user, creates session cookie (30-day expiry).
6. If new user (`isNewUser: true` or `needsProfile: true`) → redirect to `/auth/complete-profile`.
7. If existing user → redirect to `/` (dashboard).

### Happy path — password login

1. User enters email + password. Client calls `auth.login`.
2. API fetches user, verifies Argon2id hash (65536 kib memory, 3 time, 4 parallelism).
3. Checks user has at least one tenant membership (enforced separately from password check).
4. Creates session cookie. Returns user object.
5. Root layout detects session → renders app.

### Happy path — password registration (web + mobile)

1. User fills name, email, password, confirmPassword.
2. Client calls `auth.register`. Duplicate check → hash password → insert user → assign tenant → create session.
3. Mobile navigates to `/(app)/(home)` via `router.replace`. Web root layout detects session and redirects.

### Branch conditions

- **Multiple tenants**: If user belongs to multiple tenants, `session.tenantId` is null after login. Root layout calls `tenant.list`; if exactly one tenant returned, auto-selects it via `tenant.select`. If multiple, a `<TenantPicker>` modal is shown (web). Mobile app layout does the same auto-select via `useEffect`.
- **No business after login**: Root layout redirects to `/settings` for business creation (WF-01 step 6+).
- **Mobile: token in Bearer header**: Mobile stores session token in SecureStore (via `expo-secure-store`), sends it as `Authorization: Bearer <token>` header (since cookies are not used in native apps).

### Failure modes

- **Wrong password**: `auth.login` returns `UNAUTHORIZED` with message "Invalid email or password" (deliberately vague — does not reveal whether email exists).
- **No org membership**: `auth.login` returns `FORBIDDEN` if the user has no tenant membership. This can happen if a user was removed from all tenants.
- **Magic link expired/used**: `verifyMagicLink` returns `BAD_REQUEST`. User sees "Invalid, expired, or already used link. Please request a new one."
- **Rate limit on magic link**: Silently capped at 5 requests per email per 15 minutes. Extra requests return `{ success: true }` but no email is sent. User is not notified of rate limit (anti-enumeration).
- **Network failure**: tRPC query fails. Web shows inline error message. Mobile shows error banner.

### Observable states

- Customer sees: email sent confirmation screen → link click → redirect → app loads
- Operator sees: nothing (no admin visibility into login events currently)
- Database: `magic_link_tokens.used_at` set on use; `sessions` row created with IP, user agent, expiry

---

## WF-03: Mobile Biometric / PIN Unlock

**Trigger**: App opens (cold start or foreground resume after 30 seconds in background)
**Roles**: All
**Platform**: Mobile only

### How the lock works (verified from `apps/mobile/src/stores/biometric.ts` and `apps/mobile/app/_layout.tsx`)

The lock is a local UX gate, not a new auth session. The session token remains in SecureStore. The lock prevents rendering the app until the user proves local identity. If the session has expired server-side, `auth.me` will fail after unlock and the user is redirected to login.

### Happy path — biometric (Face ID / Fingerprint)

1. App hydrates three stores in parallel: `useAuthStore`, `useBusinessStore`, `useBiometricStore`.
2. Biometric store reads three SecureStore keys: `hisaabo_biometric_enabled`, `hisaabo_pin_hash`, `hisaabo_setup_prompted`.
3. If `biometricEnabled === true` or `pinEnabled === true` AND token exists → `authGate = "locked"`.
4. `LockScreen` component renders as the only visible content.
5. `LockScreen` calls `useBiometricStore.authenticate()` → `LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Hisaabo", cancelLabel: "Use PIN" })`.
6. On success → `useBiometricStore.unlock()` (sets `isLocked: false`) → `verifyTokenAndProceed()` → `auth.me` called.
7. If server session valid → `authGate = "ready"` → app renders.
8. If server session expired → `logout()` called → `authGate = "login"` → user redirected to login screen.

### Happy path — PIN

1. Same steps 1-4 as biometric.
2. User taps "Use PIN" on biometric prompt (or biometric not available but PIN set).
3. `LockScreen` renders a 4-digit PIN entry UI.
4. User enters 4 digits. `useBiometricStore.verifyPin(pin)` computes a 32-bit integer hash of the PIN and compares to stored hash.
5. Match → same flow as step 6 above.
6. No match → error shown; user can retry or tap "Log out" to clear session.

### Happy path — re-lock on background

- `AppState` change handler in root layout: when app goes to background, `lastBackground` timestamp is stored.
- On foreground resume: if `Date.now() - lastBackground > RELOCK_THRESHOLD (30000ms)` and `biometricEnabled || pinEnabled` → `lockApp()` called → `authGate = "locked"` → lock screen shown again.

### Setting up biometric or PIN (from `apps/mobile/app/(app)/(more)/settings/profile.tsx`)

1. User opens Settings → Profile.
2. Toggle "Fingerprint / Face ID" switch.
3. `LocalAuthentication.authenticateAsync({ promptMessage: "Verify to enable biometric unlock" })` is triggered first to confirm the user is the device owner.
4. On success → `biometricStore.enableBiometric()` → writes `hisaabo_biometric_enabled = "1"` to SecureStore.
5. For PIN: user taps "Set PIN" → 4-digit entry modal → confirm step → `biometricStore.setPin(pin)` → writes hash to SecureStore.

### Branch conditions

- **No biometric hardware / not enrolled**: `checkHardware()` returns `available: false`. Toggle is disabled in UI.
- **Token exists but no biometric set**: `authGate = "ready"` immediately. `verifyTokenAndProceed()` called to confirm server session.
- **No token**: `authGate = "login"` immediately. Lock screen never shown.
- **First launch after update (setupPrompted)**`: `hisaabo_setup_prompted` key controls whether to prompt users to set up biometric. Not yet prompted → prompt is shown once.

### Security note

The PIN hash uses a 32-bit integer XOR hash (not cryptographically strong). The code comment states: "Simple hash for PIN (local UX lock only, not a security boundary). The real auth is the session token in SecureStore." Collision risk is real but the primary protection is the server session.

### Failure modes

- **Biometric cancelled**: Prompt cancelled → lock screen remains → user can try again or use PIN.
- **Wrong PIN**: Error message shown. No lockout counter is implemented — unlimited retries.
- **Network down after biometric success**: `auth.me` fails with network error. Code path: `catch {}` block sets `authGate = "ready"` anyway (deliberate: financial app should not block offline use).

---

## WF-04: Create Sale Invoice

**Trigger**: User clicks "New Invoice" (web: keyboard shortcut `N`, or "+ New" button) or taps "+" on mobile Invoices tab
**Roles**: superadmin, admin, seller_manager, seller
**Platform**: Web, Mobile

### Happy path

1. User selects or creates a party (customer). Party lookup queries `party.list` filtered by type=customer. On mobile, the PartyPickerModal also shows phone contacts not already in the system.
2. User adds line items. Each line item requires: item/description, quantity, unit price. Optional: tax %, discount %.
3. For each line item, `calcLineItem()` computes tax amount and total using fixed-point arithmetic (NUMERIC(15,2) safe).
4. Optional invoice-level settings: invoice date, due date, notes, terms, additional charges, round-off, invoice-level discount (amount or percent).
5. User reviews calculated subtotal, tax, discount, total.
6. User submits. Client calls `invoice.create` with `type: "sale"`, `documentType: "invoice"`.
7. Server transaction:
   a. Validates `partyId` belongs to this business (cross-business attack prevention).
   b. Validates all `itemId`s belong to this business.
   c. Acquires row-lock on `businesses` row with `FOR UPDATE`.
   d. Reads `invoicePrefix` + `nextInvoiceNumber`, generates `INV-00042` style number.
   e. Increments `nextInvoiceNumber` atomically.
   f. Calculates totals using `calcInvoiceTotals()`.
   g. Inserts `invoices` row.
   h. Inserts `invoice_items` rows.
   i. For each line item with an `itemId`: decrements `items.stock_quantity` (sale = stock out). For variants: decrements `item_variants.stock_quantity`.
8. Audit log entry written: `invoice.create`.
9. Success: Invoice created with status `unfulfilled`. User redirected to invoice detail or list.

### Branch conditions

- **GST invoice vs non-GST**: If `business.gstin` is set and `gstRegistrationType !== "unregistered"`, PDF renders as full GST invoice with GSTIN, HSN codes, CGST/SGST/IGST breakdown. If unregistered, simpler format.
- **Item with variants**: When a variant item is selected on web (ItemCreator), the user picks a specific variant (attribute combination). `variantId` is sent in the line item; `conversionFactor` is set to `"1"` (variants have no conversion factor).
- **Item with alt units**: User can select a non-base unit from `item.unitVariants`. `selectedUnit` and `conversionFactor` are sent. Stock is decremented in base unit equivalents.
- **Simple text line item (no itemId)**: User types a description with no item linked. No stock adjustment is made. `itemId` is null in the database.
- **Invoice discount**: Applied as either a flat amount or a percentage of subtotal. Calculation handled by `calcInvoiceTotals()` in `@hisaabo/shared`.
- **Draft status**: A `status: "draft"` invoice can be created by choosing to save as draft. Draft invoices: not included in receivables balance, not counted in sales totals.
- **Purchase vs sale**: `type: "purchase"` increments stock instead of decrementing. Party type should be supplier.

### Failure modes

- **Party not in this business**: `BAD_REQUEST` — "Party not found in this business". No invoice created.
- **Item not in this business**: `BAD_REQUEST` — "One or more items do not belong to this business". No invoice created.
- **Concurrent invoice number collision**: The `FOR UPDATE` lock on businesses prevents two transactions from reading the same `nextInvoiceNumber`. No collision is possible.
- **Empty line items**: Validated client-side and by `createInvoiceSchema.lineItems.min(1)`. Cannot submit without at least one line item.
- **Network failure after submission**: No partial state — the entire operation is wrapped in a PostgreSQL transaction. Either all steps commit or all roll back.

### Observable states

- Customer sees: invoice PDF (after download/share) with status indicator
- Operator sees: invoice in list with status `unfulfilled`, amount, party name
- Database: `invoices.status = "unfulfilled"`, `items.stock_quantity` decremented
- Logs: `[audit] invoice.create invoiceNumber=INV-00042 type=sale totalAmount=12500.00`

### Mobile vs Web differences

- Web uses `<DocumentCreator>` (full side panel with all fields including charges, variants, alt units).
- Mobile create screen (`apps/mobile/app/(app)/(invoices)/create.tsx`) is a simplified form: supports basic line items (description, qty, price, tax, discount) but does NOT support variant selection, alt unit selection, additional charges, or invoice-level discount. These are web-only features during invoice creation on mobile.
- Mobile does show a PartyPicker with phone contacts integration (WF-12).

---

## WF-05: Create Purchase Invoice

**Trigger**: Same as WF-04 but user selects "Purchase" type
**Roles**: superadmin, admin, seller_manager
**Platform**: Web, Mobile
**Note**: seller role cannot create purchase invoices (only `create Invoice` for sales is included in seller permissions, but the API `invoice.create` accepts any type — the UI restricts purchase creation to admin+ roles in the web DocumentCreator)

### Differences from WF-04

- `type: "purchase"` → stock is **incremented** for each line item with an itemId.
- Party type should be a supplier (customer suppliers can also exist but purchase invoices are typically for suppliers).
- Affects `payable` balance (what the business owes), not receivable.
- PDF format uses "Purchase Invoice" label.

All other steps, failure modes, and observable states are identical to WF-04.

---

## WF-06: Edit Invoice

**Trigger**: User opens an invoice and clicks "Edit" (web) or "Edit" button (mobile)
**Roles**: superadmin, admin, seller_manager; seller (own invoices within 2 hours of creation only)
**Platform**: Web, Mobile

### Happy path

1. User navigates to invoice detail. `invoice.getById` loads the invoice with line items and party.
2. User modifies: party, date, due date, line items, charges, notes, terms, discounts.
3. Client calls `invoice.update`.
4. Server transaction:
   a. Fetches existing invoice with `FOR UPDATE` lock.
   b. Validates invoice is not `paid` (cannot edit paid invoices — "Remove payments first").
   c. Validates new `partyId` belongs to this business (if changed).
   d. Validates new `itemId`s belong to this business (if line items changed).
   e. **Reverses old stock adjustments**: reads old line items → for each itemId, adds back the old quantity to stock (sale: increment back; purchase: decrement back).
   f. Deletes old `invoice_items` rows.
   g. Inserts new `invoice_items` rows.
   h. **Applies new stock adjustments**: decrements/increments stock for new line items.
   i. Recalculates totals.
   j. Updates `invoices` row.
5. Client refreshes invoice detail.

### Branch conditions

- **Paid invoice**: Cannot be edited. User must delete payment allocations first (via payment detail).
- **Seller time window**: The API `memberProcedure` does not enforce the 2-hour window directly — the frontend and permissions check handle this. This is noted as a gap in `SECURITY_PENDING.md`.
- **Line items unchanged**: If `input.lineItems` is not provided, stock adjustments are skipped — only metadata (date, notes, etc.) is updated.

### Failure modes

- **Invoice is paid**: Returns `BAD_REQUEST` — "Cannot edit a paid invoice. Remove payments first."
- **Invoice not found**: Returns `NOT_FOUND`.
- **Network failure mid-transaction**: Full rollback. Stock is not partially adjusted.

---

## WF-07: Record Payment (Single Invoice)

**Trigger**: User opens an invoice detail and clicks "Record Payment", or navigates to Payments → New Payment
**Roles**: superadmin, admin, seller_manager, seller, accountant
**Platform**: Web, Mobile

### Happy path

1. User selects a party. `payment.unpaidInvoices` is called to show all unpaid/partial invoices for that party.
2. User selects the invoice to pay.
3. System pre-fills payment amount with the outstanding balance (`totalAmount - amountPaid`).
4. `payment.defaultAccount` is called: checks most recent payment method used for this party → then business-wide most common → then `isDefault` account.
5. User selects payment mode: cash, bank, UPI, cheque, other.
6. User selects bank account (optional but recommended for reconciliation).
7. User sets payment date and optional reference number and notes.
8. Client calls `payment.create`.
9. Server transaction:
   a. Validates `partyId` belongs to this business.
   b. Generates payment number atomically (same `FOR UPDATE` pattern as invoice).
   c. Inserts `payments` row.
   d. Overpayment guard: fetches invoice balance before applying. If `allocation.amount > balance`, throws `BAD_REQUEST`.
   e. Atomically updates `invoices.amount_paid` and sets status: `paid` if `amount_paid >= total_amount`; `partial` if partial; else unchanged.
   f. If `bankAccountId` provided: determines transaction type (deposit for sale payment, withdrawal for purchase payment) by checking first linked invoice's type. Inserts `bank_transactions` row. Updates `bank_accounts.current_balance`.
10. Audit log: `payment.create`.

### Failure modes

- **Overpayment**: `BAD_REQUEST` — "Allocation X exceeds invoice balance Y". No payment created.
- **Party not in this business**: `BAD_REQUEST`.
- **Bank account not in this business**: `NOT_FOUND`. Defense-in-depth scope check prevents cross-business access.
- **Concurrent double-payment**: Not fully protected — two concurrent requests could both pass the overpayment guard before either updates `amount_paid`. This is a known race condition gap.

### Observable states

- Invoice status: `partial` → `paid` (depending on amount)
- Bank account balance: updated immediately
- Party ledger: payment appears as a credit entry

---

## WF-08: Record Multi-Invoice Payment

**Trigger**: User opens "Record Payment" panel and selects multiple invoices
**Roles**: superadmin, admin, seller_manager, accountant (seller can only create simple payments)
**Platform**: Web (full multi-allocation UI), Mobile (basic single-invoice payment only)

### Happy path

1. User selects a party.
2. System loads all unpaid/partial invoices for the party via `payment.unpaidInvoices`.
3. User checks multiple invoices. The UI calculates total outstanding and suggests the total.
4. User can adjust the payment amount and allocate it across invoices.
5. Client sends `payment.create` with `allocations: [{ invoiceId, amount }, ...]`.
6. Server processes each allocation in sequence within a transaction. The `primaryInvoiceId` is set to `allocations[0].invoiceId` for backward-compatible list display.
7. Each allocation: overpayment guard → update `amount_paid` + status.
8. `payment_allocations` rows are inserted for each allocation.
9. Bank account updated once for the total payment amount.

### Branch conditions

- **Payment amount less than total outstanding**: Applied proportionally or user-defined. Remaining invoices stay `partial`.
- **Payment with discount**: `discount` field on payment records a discount amount. Not automatically deducted from invoices — it is a memo field.

### Mobile parity gap

Mobile payment creation (`apps/mobile/app/(app)/(more)/payments/create.tsx`) supports single-invoice payment only. The `allocations` array is not sent from mobile. Multi-invoice payment requires the web app.

---

## WF-09: Share Invoice PDF

**Trigger**: User clicks "Download PDF" on invoice detail or list (web), or share button (mobile)
**Roles**: superadmin, admin, seller_manager, seller
**Platform**: Web, Mobile

### Happy path — Web

1. User opens invoice detail. "Download PDF" dropdown appears with format options.
2. If business has GSTIN (`gstRegistrationType !== "unregistered"`): options are "GST Invoice (A4)", "Simple Invoice (A5)", "Thermal Receipt".
3. If unregistered: options are "Invoice (A5)", "Thermal Receipt".
4. User selects format. Client calls `GET /api/invoices/:id/pdf?format=<format>` with `x-business-id` header.
5. Server generates PDF using PDFKit (`src/lib/invoice-pdf.ts`). Returns binary PDF blob.
6. Client creates an object URL, triggers `<a>` click to download as `INV-00042_a4.pdf`.
7. If the invoice was in `draft` status and user shared it, `onShared()` callback updates status to `sent` (called via `invoice.updateStatus`).

### Happy path — Mobile

No direct PDF generation endpoint on mobile. The mobile app relies on the same REST API. Mobile shows a share button that opens the native share sheet.

### Failure modes

- **PDF generation fails**: HTTP 500 returned. `toast.error("Failed to download PDF")`.
- **Invoice not found**: HTTP 404. Error displayed.
- **Large invoice with many line items**: PDFKit handles this synchronously — no streaming. Potential timeout for very large invoices.

---

## WF-10: Convert Quotation to Invoice

**Trigger**: User opens a quotation and clicks "Convert to Invoice"
**Roles**: superadmin, admin, seller_manager
**Platform**: Web (quotation list page), Mobile (More → Quotations)

### Happy path

1. User opens Quotations page (web: `/quotations`, mobile: More → Quotations).
2. User finds a quotation with status `sent` or `draft`.
3. User clicks "Convert to Invoice".
4. Client calls `document.convert` with `sourceDocumentId: quotationId, targetDocumentType: "invoice"`.
5. Server fetches source quotation with all line items.
6. Passes line items through `createInvoiceSchema.parse()` for validation.
7. Calls the invoice router's `create` method internally (using `createCallerFactory`).
8. New invoice is created: same party, same line items, `referenceDocumentId` pointing to the quotation.
9. Invoice is assigned the next invoice number atomically.
10. Stock is adjusted (sale: decremented; purchase: incremented).
11. Original quotation status is NOT automatically updated. The operator must manually update the quotation to "cancelled" or leave it.
12. Client redirects to new invoice detail.

### Branch conditions

- **Convert quotation → proforma**: Same flow with `targetDocumentType: "proforma"`. No stock effect for proforma.
- **Convert proforma → invoice**: Same flow. Stock adjustment applied at invoice creation.
- **Convert delivery challan → invoice**: Supported. Stock was already decremented at challan creation; invoice creation decrements again. This is a double-count risk if the challan and invoice are both active.

### Failure modes

- **Source document not found**: `NOT_FOUND`.
- **Source party no longer in this business**: `BAD_REQUEST` from invoice creation.
- **Source items no longer in this business**: `BAD_REQUEST`.

---

## WF-11: Add New Party

**Trigger**: User navigates to Parties → "New Party" (web) or Parties tab → "+" (mobile)
**Roles**: superadmin, admin, seller_manager, seller
**Platform**: Web, Mobile

### Happy path

1. User fills: name (required), type (customer or supplier), phone, email, GSTIN, PAN, billing address, city, state, pincode, opening balance, category.
2. Client calls `party.create`.
3. Server inserts party row with `businessId` scoped.
4. Party immediately available for invoice creation.

### Validation

- **GSTIN format**: Validated as `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$` on mobile. Web uses the shared Zod schema.
- **Phone**: On mobile, validated as 7-15 digits (stripping spaces, dashes, parens). Web uses the shared schema.
- **Opening balance**: Represents pre-existing balance at time of onboarding. Positive = the party owes money to the business (customer balance). Negative = the business owes the party (supplier balance).

### Failure modes

- **Missing name**: Returns `BAD_REQUEST`. Name is the only required field.
- **Duplicate party name**: No uniqueness constraint enforced. Two parties with the same name can exist. The import wizard does check for duplicates by name (case-insensitive), but the direct create endpoint does not.

---

## WF-12: Add Party from Phone Contacts (Mobile)

**Trigger**: User opens invoice create screen (mobile), taps the party picker, contact list is shown
**Roles**: superadmin, admin, seller_manager, seller
**Platform**: Mobile only

### Happy path

1. Invoice create screen opens the `PartyPickerModal`.
2. Modal loads: (a) existing parties from `party.list`, (b) phone contacts via `useContacts` hook.
3. `useContacts` checks `expo-contacts` permission status on mount.
4. If permission `granted`: contacts are loaded and sorted by first name.
5. Contacts already in the system (by phone number normalization: last 10 digits) are filtered out of the contacts section.
6. Modal shows two sections: "Parties" (existing) and "From Contacts" (new from phone).
7. User taps a contact from phone. `createPartyMutation` is called with the contact's name, phone, email.
8. Party is created as type matching the invoice type (sale → customer; purchase → supplier).
9. New party is returned and selected in the picker.
10. Invoice creation continues with the new party pre-filled.

### Branch conditions

- **Permission undetermined**: A "Allow access to contacts" prompt is shown in the modal. User can grant or deny.
- **Permission denied**: Contacts section does not appear. User can only select from existing parties or type a name to create manually.
- **Contact has no phone number**: Still appears in the list, but no phone normalization is applied. It will be shown even if a party with the same name exists (no name deduplication in this flow).
- **Contact already in system**: Filtered out of the "From Contacts" section by comparing normalized phone numbers.

### Failure modes

- **Party creation fails** (e.g., network error): Error shown in modal. Party not created; user must retry.
- **Contacts not loaded**: If `getContactsAsync` fails, contacts array is empty. No error surface; the "From Contacts" section is simply empty.

---

## WF-13: View Party Ledger

**Trigger**: User navigates to Parties → select party → Ledger tab (web), or Parties → party detail → Ledger (mobile)
**Roles**: superadmin, admin, seller_manager, accountant
**Platform**: Web, Mobile

### Happy path

1. User opens party detail.
2. User selects a date range (optional; defaults to full history).
3. Client calls `party.ledgerReport` with `partyId`, optional `fromDate`, `toDate`.
4. Server fetches all invoices and payments for the party within the date range.
5. Entries are merged and sorted by date. Running balance is computed:
   - Customer: invoices are debits (money owed to business); payments are credits.
   - Supplier: invoices are credits (money business owes); payments are debits.
6. Returns: entries with running balance, totals (total debit, total credit), closing balance, party details.
7. Web renders a ledger table with running balance column. Mobile renders a flat list.

### Branch conditions

- **Opening balance**: Added as the starting balance before any entries. `party.openingBalance` from the party record.
- **Large history**: Query has a `limit` parameter defaulting to 1000. Up to 5000 rows can be requested. Beyond that, user must apply date range filters.

### Failure modes

- **Party not found**: Returns `null`. UI shows not-found state.
- **Date range with no transactions**: Returns empty entries with closing balance = opening balance.

---

## WF-14: Merge Duplicate Parties

**Trigger**: User navigates to Parties → finds a party → "Merge" option (web only)
**Roles**: superadmin, admin
**Platform**: Web only

### Happy path

1. User selects source party (to be deleted) and target party (to be kept).
2. Client calls `party.merge` with `sourceId` and `targetId`.
3. Server transaction:
   a. Fetches both parties; validates they belong to this business.
   b. Moves all invoices from `sourceId → targetId` (UPDATE).
   c. Moves all payments from `sourceId → targetId`.
   d. Merges opening balances (adds source balance to target balance).
   e. Fills missing fields on target from source (phone, email, GSTIN, PAN, address, city, state, pincode, category) — does not overwrite existing data.
   f. Deletes the source party.
4. Audit log: `party.merge`.
5. Client shows success message and navigates to target party detail.

### Failure modes

- **Source = target**: `BAD_REQUEST` — "Cannot merge a party into itself".
- **Either party not found**: `NOT_FOUND`.
- **Concurrent modification**: If another user is creating an invoice for the source party during the merge, the invoice's `partyId` update happens in the same transaction, so the invoice will correctly reference the target party.

---

## WF-15: Add Simple Item

**Trigger**: User navigates to Items → "New Item" (web) or Items section (mobile)
**Roles**: superadmin, admin, seller_manager
**Platform**: Web, Mobile

### Happy path

1. User fills: name (required), item type (product/service), unit, sale price, purchase price (optional), tax %, HSN code, SKU, stock quantity, low stock alert threshold, category.
2. `itemMode` defaults to `"simple"`.
3. Client calls `item.create`.
4. Server inserts item row. No variants created.

### Branch conditions

- **Service items**: `itemType: "service"`. Stock tracking is typically irrelevant for services but the field exists.
- **Tax inclusive pricing**: `taxInclusive: true` means the sale price already includes tax. Calculation in `calcLineItem` handles this.
- **Store visibility**: `storeEnabled: false` by default. Must be explicitly enabled in Settings → Store to appear in the online store.

---

## WF-16: Add Item with Variants

**Trigger**: User creates an item and sets `itemMode: "variants"` in the item form
**Roles**: superadmin, admin, seller_manager
**Platform**: Web (full variant builder), Mobile (variant create has limited support)

### Happy path

1. User opens item creation form and switches mode to "Variants".
2. User defines variant attributes (e.g., Size: S/M/L, Color: Red/Blue). These are stored in `items.variant_attributes` as JSON.
3. User defines individual variants: each combination has its own SKU, sale price, purchase price, stock quantity, low stock alert.
4. Client calls `item.create` with `itemMode: "variants"` and `variants: [...]` array.
5. Server transaction: inserts `items` row, then inserts each variant into `item_variants`.
6. On future invoice creation, the user picks a specific variant. Stock is tracked per variant.

### Branch conditions

- **Variant stock vs item stock**: For variant items, `items.stock_quantity` is ignored. `item_variants.stock_quantity` is used per variant. The list view shows aggregate stock across all variants.
- **Store visibility per variant**: Each variant can be individually enabled/disabled in the store via `store.updateVariantStoreSettings`.

### Failure modes

- **Cannot switch base unit on variant item**: `switchBaseUnit` mutation throws `BAD_REQUEST` — "Cannot switch base unit on a variant item."
- **Empty variants array**: Allowed — creates the item with variant mode but no variants yet. Variants can be added later via `item.update`.

---

## WF-17: Add Item with Alt Units

**Trigger**: User creates an item and sets `itemMode: "alt_units"`
**Roles**: superadmin, admin, seller_manager
**Platform**: Web (full alt-unit builder), Mobile (limited)

### How alt units work

One item has a base unit (e.g., "box") and one or more alternate units (e.g., "piece"). Each alt unit has a conversion factor (e.g., 1 box = 12 pieces) and its own sale price and optional purchase price. Stock is tracked in the base unit. When a sale uses an alt unit, the quantity sold is converted to base units before stock adjustment.

### Happy path

1. User defines base unit and sets base sale price.
2. User adds alt units: each with unit name, conversion factor, sale price.
3. `items.unit_variants` stores the alt unit array as JSON.
4. On invoice creation, user selects the alt unit → `selectedUnit` and `conversionFactor` sent in line item.
5. Stock adjustment: `quantity * conversionFactor` applied to `items.stock_quantity`.

### Switching base unit (post-creation)

`item.switchBaseUnit` performs a complex migration:
1. Converts stock: `new_stock = old_stock * factor`.
2. Converts prices: `new_price = old_price / factor`.
3. Adds old base unit to `unit_variants` (as an alt unit with `conversionFactor = 1/factor`).
4. Updates historical invoice line items: multiplies their `conversion_factor` by `1/factor`.

---

## WF-18: Adjust Stock

**Trigger**: User navigates to Items → item detail → "Adjust Stock" (web) or same on mobile
**Roles**: superadmin, admin, seller_manager
**Platform**: Web, Mobile

### Happy path

1. User finds the item (search or browse list).
2. User enters adjustment quantity (positive = add stock; negative = remove stock). Zero is rejected.
3. User optionally adds a reason and date.
4. Client calls `item.adjustStock`.
5. Server transaction:
   a. `FOR UPDATE` lock on item (or variant if `variantId` provided).
   b. Reads previous stock.
   c. Calculates new stock = previous + adjustment.
   d. Updates stock quantity.
   e. Inserts `stock_adjustments` record with previous stock, new stock, reason, date, user.
6. Client shows updated stock quantity.

### Branch conditions

- **Variant adjustment**: If `variantId` is provided, the variant's stock is adjusted. The parent item's stock_quantity is not changed (variants own their stock).
- **Negative resulting stock**: Allowed. No guard against going below zero.

### Failure modes

- **Item not found**: `NOT_FOUND`.
- **Variant not found (or doesn't belong to this business)**: `NOT_FOUND` (the query joins `item_variants` with `items` and checks `items.businessId`).
- **Zero quantity**: Schema rejects: `quantity.refine(v => parseFloat(v) !== 0)`.

---

## WF-19: Record Expense

**Trigger**: User navigates to Expenses → "New Expense" (web) or More → Expenses → "+" (mobile)
**Roles**: superadmin, admin, seller_manager, accountant
**Platform**: Web, Mobile

### Happy path

1. User fills: category (free text), description (optional), amount, payment mode, expense date, reference number (optional).
2. Client calls `expense.create`.
3. Server inserts `expenses` row (soft-deletable; `deleted_at` column).

### Branch conditions

- **Category**: Free text. No predefined list. Categories from existing expenses are suggested as a combobox via `expense.categories` query.
- **Bank account linkage**: Expenses do NOT automatically deduct from a bank account. Unlike payments, expenses are standalone records. No `bankAccountId` in the expense schema. This is a parity gap with full accounting systems.

### Failure modes

- **Amount validation**: Must be a valid decimal string (`^\d+(\.\d{1,2})?$`).
- **Future date**: Allowed — no date validation beyond format.

---

## WF-20: Bank Account Transfer

**Trigger**: User navigates to Cash & Bank → "Transfer" (web) or More → Bank → Transfer (mobile)
**Roles**: superadmin, admin, accountant
**Platform**: Web, Mobile

### Happy path

1. User selects source account and destination account (must be different).
2. User enters amount, optional description and date.
3. Client calls `bankAccount.transfer`.
4. Server transaction:
   a. Locks both accounts in a consistent order (lower UUID first) to prevent deadlocks from concurrent transfers in opposite directions.
   b. Subtracts amount from source account's `current_balance`.
   c. Adds amount to destination account's `current_balance`.
   d. Inserts two `bank_transactions` rows: a withdrawal for source, a deposit for destination. Both reference each other via `referenceType: "transfer"` and `referenceId`.

### Failure modes

- **Same account**: `BAD_REQUEST` — "Cannot transfer to the same account".
- **Account not found**: `NOT_FOUND` — "One or both accounts not found".
- **Insufficient balance**: Not validated — transfer can result in a negative balance. No guard.

---

## WF-21: View Dashboard

**Trigger**: User lands on `/` (web) or Home tab (mobile)
**Roles**: All except seller (seller lacks `read: Report` permission)
**Platform**: Web, Mobile

### What the dashboard shows (verified from `dashboard.ts`)

The `dashboard.summary` query computes (scoped to current financial year by default, custom date range optional):

- **Total sales** (sale invoices, non-cancelled)
- **Total purchases** (purchase invoices, non-cancelled)
- **Total expenses**
- **Receivable** = sum of (total_amount - amount_paid) for unpaid/partial sale invoices
- **Payable** = sum of (total_amount - amount_paid) for unpaid/partial purchase invoices
- **Cash in / Cash out**: payments by mode within the period
- **Recent invoices**: last 10

Web additionally shows charts (bar chart of monthly sales, pie chart of payment modes) via Recharts.

### Branch conditions

- **Financial year start**: Configured per business via `financialYearStart` column (1-indexed month). Defaults to April (month 4) for Indian businesses. Dashboard defaults to current FY.
- **Custom date range**: User can override with any date range.
- **No data**: Empty states shown with calls to action.

---

## WF-22: Generate GSTR-1 / Sales Report

**Trigger**: User navigates to GST Returns (web: `/gst` route) → GSTR-1 tab
**Roles**: superadmin, admin, seller_manager, accountant
**Platform**: Web only

### Happy path

1. User selects month and year.
2. Client calls `gst.gstr1` with year and month.
3. Server calls `generateGSTR1()` from `src/lib/gst-reports.ts`. Aggregates sale invoices by party GSTIN, groups by supply type (intra-state CGST/SGST, inter-state IGST, B2C, export).
4. Returns structured report object.
5. User reviews the report on screen.
6. User clicks "Export CSV" → calls `gst.gstr1CSV` → downloads `GSTR1_April_2025.csv`.

### Branch conditions

- **GST unregistered businesses**: Report is labeled "Sales Report" instead of "GSTR-1". Same data engine, different terminology.
- **GSTR-3B tab**: Summary of output/input tax for the month. `gst.gstr3b` computes the summary.
- **P&L tab**: Revenue (sales) - COGS (purchases) - expenses = net profit. Computed client-side from `dashboard.summary` data.
- **Aging tab**: Overdue invoice buckets (0-30, 31-60, 61-90, 90+ days). Computed from party ledger data.
- **Party Ledger tab**: Per-party ledger (same as WF-13 but accessed from reports).
- **Tally Export tab**: Generates Tally-compatible XML for import.

---

## WF-23: View Profit & Loss

**Trigger**: User navigates to GST Returns → P&L tab
**Roles**: superadmin, admin, seller_manager, accountant
**Platform**: Web only

The P&L report is computed from `dashboard.summary` data and the expense list. No dedicated backend endpoint — the calculation is:

```
Revenue = total sale invoices (non-draft, non-cancelled)
COGS    = total purchase invoices (non-draft, non-cancelled)
Expenses = sum of expense records
Gross Profit = Revenue - COGS
Net Profit = Gross Profit - Expenses
```

**Gap**: No COGS separation by item category. Purchases and direct costs are treated as equivalent.

---

## WF-24: View Receivables Aging

**Trigger**: User navigates to GST Returns → Aging Report tab
**Roles**: superadmin, admin, seller_manager, accountant
**Platform**: Web only

Aging is computed client-side from invoice data already loaded. Invoices are bucketed by days overdue: 0-30, 31-60, 61-90, 90+ days. The `invoices.due_date` field is used. If `due_date` is null, invoices are excluded from aging buckets.

**Gap**: No server-side aging endpoint. The web fetches all unpaid invoices and groups them in the browser. For businesses with thousands of invoices, this could be slow.

---

## WF-25: Export to Tally

**Trigger**: User navigates to GST Returns → Tally Export tab
**Roles**: superadmin, admin, accountant
**Platform**: Web only

Tally XML export generates a Tally-importable XML file from the invoice and payment data for the selected date range. Implementation is in `src/lib/gst-reports.ts`.

---

## WF-26: Invite Team Member

**Trigger**: User navigates to Settings → Team → "Invite Member"
**Roles**: superadmin, admin, owner (tenant-level)
**Platform**: Web (Settings page), Mobile (Settings → Team screen)

### Happy path

1. User enters email and selects role: admin, seller_manager, seller, or accountant.
2. Client calls `tenant.inviteMember`.
3. Server checks caller has `owner`, `superadmin`, or `admin` role in the tenant.
4. Checks if email is already a member (if user exists and is already in tenant → `CONFLICT`).
5. Generates `nanoid(32)` raw token → stores SHA-256 hash in `invitations` table. Token expires in 7 days.
6. Returns `{ token: rawToken, expiresAt }`. The raw token is what must be sent by email.

**Gap identified**: The `inviteMember` mutation returns the raw token but does NOT automatically send an email. The email sending step is not implemented in the router. The UI must display the token/link to the admin who then manually shares it (or this is a pending feature). This is a critical gap if invitation emails are expected.

### Failure modes

- **User already a member**: `CONFLICT` — "User is already a member".
- **Caller not admin/owner**: `FORBIDDEN`.
- **Invalid role**: Schema rejects via `z.enum(["admin", "seller_manager", "seller", "accountant"])`. Owner role cannot be assigned via invitation.

---

## WF-27: Accept Team Invitation

**Trigger**: Invitee receives a link with `?token=<rawToken>` and navigates to it while logged in
**Roles**: Any authenticated user (must match invitation email)
**Platform**: Web

### Happy path

1. User is already logged in (or logs in / registers first).
2. Client calls `tenant.acceptInvitation` with the raw token from the URL.
3. Server hashes token → looks up invitation (must be non-expired, non-accepted).
4. Verifies invitation email matches the current user's email (case-insensitive).
5. Creates `tenant_members` row with the role from the invitation.
6. Marks invitation as accepted.
7. User now has access to the tenant. On next page load, `tenant.list` will include the new tenant.

### Failure modes

- **Token expired**: `NOT_FOUND` — "Invalid or expired invitation".
- **Token already accepted**: `BAD_REQUEST` — "Invitation already accepted".
- **Email mismatch**: `FORBIDDEN` — "This invitation was sent to a different email address". User must log in with the correct email.
- **Already a member** (double-click / race): Handled gracefully — marks invitation accepted and returns without error.

---

## WF-28: Set Sales Target

**Trigger**: User navigates to Settings → Sales Targets → "New Target"
**Roles**: superadmin, admin, seller_manager
**Platform**: Web only (admin side)

### Happy path

1. Admin selects a user (seller) by userId.
2. Selects target type: `order_count` (number of invoices), `order_value` (total INR), or `item_quantity` (specific item sold).
3. If `item_quantity`: must also select a specific item.
4. Sets target value (number), period type (daily/weekly/monthly/quarterly/custom), and start/end dates.
5. Client calls `target.create`.
6. Server validates: `item_quantity` requires `itemId`; `periodEnd > periodStart`.
7. Inserts `sales_targets` row.

### Progress computation (verified from `target.ts`)

`computeTargetProgress()` counts completed invoices created by the target user within the period. Conditions: `type = "sale"`, `documentType = "invoice"`, `status NOT IN ('draft', 'cancelled')`. Progress is real-time — no caching.

**On-track calculation**: `current >= (daysElapsed / daysTotal) * targetValue`.

---

## WF-29: View Team Performance

**Trigger**: User navigates to Settings → Sales Targets (web), or the team screen on mobile
**Roles**: superadmin, admin, seller_manager (see all); seller (own targets only via `target.myTargets`)
**Platform**: Web (full view), Mobile (profile screen shows `myTargets`)

### Happy path

1. Admin calls `target.list` with `withProgress: true`.
2. Server attaches `computeTargetProgress()` result to each target.
3. UI renders each target with current value, target value, progress bar, on-track indicator.
4. Seller uses `target.myTargets` to see their own active targets with progress.

---

## WF-30: Customer Places Store Order

**Trigger**: Customer navigates to `<domain>/store/<slug>` and browses the store
**Roles**: Public (no auth required)
**Platform**: Store app (browser, mobile browser)

### Happy path

1. Store app extracts `slug` from URL path.
2. `fetchCatalog(slug)` calls `GET /store/:slug/catalog.json`.
3. Server resolves slug → business → verifies `storeEnabled: true`.
4. Returns catalog: business info (name, tagline, contact, accent color, min order amount), paginated items (only `storeEnabled: true` items), categories.
5. Items with `itemMode: "variants"` include only `storeEnabled: true` variants.
6. Items with `itemMode: "alt_units"` include unit variants with store-safe prices (no purchase price exposed).
7. **Never exposed to public**: purchase price, exact stock quantity beyond `inStock: boolean`, HSN, SKU, internal business fields.
8. Customer browses items by category or search.
9. Customer adds items to cart (localStorage persisted).
10. Customer taps cart. Sees item list, quantities, total.
11. Customer proceeds to "Phone Verify" screen.
12. Customer enters phone number. (Turnstile verification is required.)
13. Customer fills checkout form: name, phone (pre-filled from previous step), email (optional), delivery address, city, pincode, delivery notes.
14. Client calls `POST /store/:slug/order` with Turnstile token.
15. Server:
    a. Verifies Turnstile token (returns 403 if invalid).
    b. Validates `customerPhone` as a valid 10-digit Indian mobile number (`^[6-9]\d{9}$`).
    c. Rate limits: 5 orders per phone per minute (in-memory rate map, resets on server restart).
    d. Validates all items are store-enabled and belong to the business.
    e. For variant items: validates variant is store-enabled.
    f. Validates min order amount if set.
    g. Checks stock (if `storeAllowNegativeStock: false`, out-of-stock items are rejected).
    h. Calculates totals.
    i. Creates a draft invoice and inserts `store_orders` row atomically.
    j. Returns `{ orderNumber, total, businessWhatsapp }`.
16. Store shows order confirmation screen with order number.
17. If `storeWhatsappNumber` configured, a WhatsApp link is shown for the customer to message the business.

### Branch conditions

- **Min order amount**: If `storeMinOrderAmount` set and total is below, order is rejected with error.
- **Out of stock**: If `storeAllowNegativeStock: false` (default), items with `stockQuantity <= 0` are filtered out of the catalog (`inStock: false` in response). The order endpoint also validates stock at submission time.
- **`storeAllowNegativeStock: true`**: Out-of-stock items appear with a "low stock" indicator but can still be ordered.
- **Variants**: Customer picks an attribute combination. The matching variant's price is used.
- **Alt units**: Customer picks a unit from the dropdown. `conversionFactor` sent in the order.

### Failure modes

- **Store not found / disabled**: HTTP 404.
- **Turnstile verification fails**: HTTP 403. Customer must reload and try again.
- **Invalid phone number**: HTTP 400 — "customerPhone must be a valid 10-digit Indian mobile number".
- **Rate limit**: HTTP 429 — "Too many orders. Please wait a moment before trying again."
- **Item no longer available**: HTTP 400 — "One or more items are not available in this store".
- **Min order not met**: HTTP 400 (with specific amount in message).
- **Cart stale (item removed from store between browse and checkout)**: Caught by server-side item validation.

---

## WF-31: Business Confirms Store Order

**Trigger**: Business user sees a new pending order (notification or polling the store orders list)
**Roles**: superadmin, admin, seller_manager
**Platform**: Web (More → Store Orders), Mobile (More → Store Orders)

### Happy path

1. User navigates to Store Orders. Pending orders shown at top.
2. User opens order detail. Sees customer name, phone, items, delivery address, linked invoice.
3. User clicks "Confirm Order".
4. Client calls `store.confirmOrder`.
5. Server transaction:
   a. Verifies order is in `pending` status.
   b. Updates order status to `confirmed`, sets `confirmedAt`.
   c. Updates linked invoice status from `draft` → `sent`.
6. Order now shows as `confirmed`.

### Failure modes

- **Order already confirmed or beyond**: `BAD_REQUEST` — "Cannot confirm an order with status X".
- **Order not found**: `NOT_FOUND`.

**Gap**: No push notification mechanism exists for new orders. Business users must poll the order list manually or set up external monitoring.

---

## WF-32: Business Fulfills Store Order

**Trigger**: User advances order through the fulfillment pipeline
**Roles**: superadmin, admin, seller_manager
**Platform**: Web, Mobile

### States and transitions

```
pending → confirmed → preparing → ready → delivered
                   ↘ cancelled (from pending, confirmed, preparing, ready)
```

- `confirmOrder`: `pending → confirmed` (WF-31)
- `updateOrderStatus(preparing)`: `confirmed → preparing`
- `updateOrderStatus(ready)`: `preparing → ready`
- `updateOrderStatus(delivered)`: `ready → delivered`
- `cancelOrder`: any non-terminal status → `cancelled` (+ cancels linked invoice)

### Happy path

1. User opens confirmed order.
2. Clicks "Start Preparing" → `store.updateOrderStatus({ status: "preparing" })`.
3. Clicks "Ready for Pickup/Delivery" → `store.updateOrderStatus({ status: "ready" })`.
4. Clicks "Mark Delivered" → `store.updateOrderStatus({ status: "delivered" })`.
5. Invoice (linked via `storeOrders.invoiceId`) status remains `sent` — the operator should manually record a payment to mark the invoice paid.

### Failure modes

- **Cancelled order**: `BAD_REQUEST` — "Cannot update a cancelled order".
- **Order not found**: `NOT_FOUND`.
- **Status skipped**: The API only validates `status === "cancelled"` as a guard. It does not enforce sequential transitions for `preparing → ready → delivered`. A "ready" → "preparing" transition is technically possible through direct API calls.

---

## WF-33: Import Data from MyBillBook

**Trigger**: User clicks "Import" in the WhatsNext modal after business creation, or navigates to Settings → Data → Import
**Roles**: superadmin, admin
**Platform**: Web only

### What can be imported (from `import.ts`)

- `import.importParties`: Batch upsert of parties (skips by name, case-insensitive).
- `import.importItems`: Batch upsert of items.
- `import.importInvoices`: Imports invoices with line items.
- `import.importPayments`: Imports payment records.
- `import.importOpeningBalances`: Sets opening balances on existing parties.
- `import.importBankAccounts` / `import.importBankTransactions`: Imports bank account history.

### Happy path

1. User exports data from MyBillBook (or other source) and uploads via the `<ImportWizard>` component.
2. Client parses the file (CSV or JSON) client-side.
3. Client sends batch arrays to the appropriate import endpoints.
4. Server processes in chunks of 500 records (PostgreSQL parameter limit).
5. Returns `{ created, skipped, total }` for parties and items.
6. On completion, data is immediately available.

### Failure modes

- **Duplicate party name**: Silently skipped (not an error). `skipped` counter incremented.
- **Invalid GSTIN in import data**: Passes without validation in the import endpoint (validation is relaxed for bulk import). The party will be created with the invalid GSTIN.

---

## WF-34: Export Business Data

**Trigger**: User navigates to Settings → Data → Export
**Roles**: superadmin, admin
**Platform**: Web only

Client calls `business.exportData` which returns CSV strings for: parties, items, invoices, line_items, payments, expenses. The web client triggers browser downloads for each CSV file.

---

## Cross-Cutting Concerns

### Invoice Status State Machine

```
[draft] → (share/send) → [unfulfilled]
[unfulfilled] → (partial payment) → [partial]
[unfulfilled] → (full payment) → [paid]
[partial] → (remaining payment) → [paid]
[any non-paid] → (manual status change) → [sent]
[any non-paid] → (manual status change) → [overdue]
[any non-paid, non-paid] → (cancel) → [cancelled]
```

The `overdue` status is not automatically set by a background job. It must be manually updated or set by a future scheduled process. This is a gap — overdue invoices require manual operator action.

### Stock Impact by Document Type

| Document Type | Type | Stock Effect |
|---|---|---|
| invoice | sale | Decrement |
| invoice | purchase | Increment |
| quotation | any | None |
| proforma | any | None |
| delivery_challan | sale | Decrement |
| credit_note | any | Increment (returning to stock) |
| sales_return | any | Increment |
| purchase_return | any | Decrement |
| store_order | (auto invoice) | Decremented at invoice creation |

### Session Management

- Sessions expire after 30 days.
- Mobile: token stored in `expo-secure-store`. Sent as `Authorization: Bearer <token>`.
- Web: `HttpOnly; Secure; SameSite=Lax` cookie.
- Logout: session row deleted from DB + session cache invalidated.
- Session cache: in-memory (TTL 60s by default) in the API process. Horizontal scaling without shared cache would cause stale sessions.

### Atomic Counter Pattern

All document numbers (invoice, payment, quotation, credit note, delivery challan, proforma) use the same pattern:
1. `SELECT ... FROM businesses WHERE id = ? FOR UPDATE` — row-level lock.
2. Read current counter.
3. Generate number string.
4. Increment counter in same transaction.

This prevents duplicate numbers under concurrent load. Numbers are never reused (gap-less sequences).

### Audit Log

`logAudit()` is called after: `invoice.create`, `payment.create`, `party.merge`, and other write operations. Log entries include: businessId, userId, action string, entityType, entityId, metadata JSON, IP address. Read via `business.auditTrail`.

---

## Known Gaps and Open Questions

| # | Gap | Severity | Notes |
|---|---|---|---|
| G-01 | `inviteMember` does not send invitation email — returns raw token only | High | Admin must manually share the link |
| G-02 | `overdue` invoice status is not automatically set by a background job | Medium | Manual status change required |
| G-03 | Seller 2-hour edit window is enforced in UI only, not fully in API | Medium | API `memberProcedure` does not check creation timestamp + userId |
| G-04 | Store order notification: no push/webhook when a new order arrives | Medium | Business must poll the order list |
| G-05 | Concurrent double-payment race condition on invoices | Medium | Two simultaneous payments could both pass the overpayment guard |
| G-06 | Delivery challan → invoice double-counts stock decrement | Medium | Both challan creation and invoice creation decrement stock |
| G-07 | Expense records have no bank account linkage | Low | Expenses don't reduce bank balances automatically |
| G-08 | Mobile lacks variant selection and alt unit selection in invoice creation | Low | Web-only features during mobile invoice creation |
| G-09 | Aging report is computed client-side (no server endpoint) | Low | Performance risk for businesses with large invoice history |
| G-10 | Import endpoint does not validate GSTIN format | Low | Invalid GSTINs can be imported silently |
| G-11 | PIN hash uses 32-bit XOR (not cryptographically secure) | Low | Documented as UX-only lock; real security is the server session |
| G-12 | No lockout counter on PIN entry — unlimited retries | Low | Brute-force PIN guessing possible on a stolen unlocked device |
| G-13 | `storeAllowNegativeStock: true` does not enforce a hard stock limit | Low | Business must manually monitor stock |
| G-14 | Session cache is in-memory — stale on horizontal scale-out | Low | Logout on one instance may not immediately invalidate on another |
