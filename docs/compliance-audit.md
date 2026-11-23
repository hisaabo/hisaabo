# Hisaabo Compliance Audit Report

**Assessment Date**: 2026-03-28
**Auditor**: ComplianceAuditor (internal self-assessment)
**Scope**: Indian regulatory compliance — GST, Invoice rules, DPDPA 2023, financial accuracy, audit trail, and data portability
**Application Version**: Branch `feat/variants-docker-s3`, commit `724dd54`

## Important Disclaimers

- This is a **self-assessment**, not a third-party certification or government attestation.
- Hisaabo is **not a certified GST software** recognized under any government scheme. It is a business management tool that generates data in formats compatible with GST filing. All reports must be reviewed by the business owner or their chartered accountant before filing with the GST portal.
- Hisaabo does **not file returns automatically**. It generates GSTR-1 and GSTR-3B data that the user or their CA then submits via the GST portal or offline utility.
- Self-hosted deployments place full responsibility for data backup, server security, and regulatory compliance on the operator. The application provides tooling (backup scripts, HTTPS configuration guidance) but cannot enforce their use.

---

## Executive Summary

| Area | Status | Score |
|------|--------|-------|
| GST Compliance | PARTIALLY COMPLIANT | 68/100 |
| Invoice Compliance | PARTIALLY COMPLIANT | 72/100 |
| Data Privacy (DPDPA) | PARTIALLY COMPLIANT | 55/100 |
| Financial Accuracy | COMPLIANT | 88/100 |
| Audit Trail | PARTIALLY COMPLIANT | 62/100 |
| Data Portability | PARTIALLY COMPLIANT | 65/100 |

**Overall Readiness**: 68/100

**Critical Gaps**: 4
**High Gaps**: 6
**Medium Gaps**: 7

**Estimated time to address all Critical and High gaps**: 4-6 weeks with a 1-2 engineer effort.

**Key findings in plain language**: The application's core invoicing and financial arithmetic is well-implemented and correct. The GST report structure is largely accurate for the common cases (B2B, B2CS, B2CL, HSN). The most significant gaps are: (1) floating-point arithmetic is used in the GST report aggregation layer instead of the fixed-point `money` module, which can produce rounding errors in report totals; (2) the GSTR-1 CSV export format is not directly importable into the GST portal's offline utility without reformatting; (3) there is no DPDPA-specific privacy notice, data deletion endpoint, or consent record for store customers; (4) the audit trail does not cover expense mutations or business settings changes.

---

## 1. GST Compliance

### 1.1 GSTR-1 Report Structure

**Status**: PARTIALLY COMPLIANT

**Control Reference**: CGST Act 2017, Section 37 and CGST Rules 2017, Rule 59

**What was checked**: The `generateGSTR1` function in `packages/api/src/lib/gst-reports.ts` was reviewed against the four mandatory GSTR-1 tables: B2B (Table 4), B2CL (Table 5), B2CS (Table 7), and HSN Summary (Table 12), plus credit and debit notes (Tables 9 and 9B).

**Evidence**: `packages/api/src/lib/gst-reports.ts`, lines 7-81 (type definitions), lines 193-279 (main classification logic), lines 282-357 (credit/debit notes).

**Findings**:

PASSING:
- B2B classification is correct: any invoice where the party has a GSTIN is placed in B2B. One row per invoice, consistent with Table 4 requirements.
- B2CL threshold of Rs 2,50,000 is correct (line 233): `total > 250000`.
- B2CS catchall logic is correct: intra-state unregistered or inter-state under threshold.
- Credit notes and debit notes are fetched separately and include the reference (original) invoice number when available (lines 337-357). This matches GSTR-1 Tables 9 and 9B requirements.
- Cancelled invoices are excluded via `sql\`${invoices.status} != 'cancelled'\`` (line 153).
- HSN summary is built from the actual `items.hsn` column (lines 171-181), not inferred, with a `0000` fallback for items with no HSN set (line 181).

GAPS:

**Gap 1.1.1 (HIGH)**: The GSTR-1 CSV export format (`gstr1ToCSV`, lines 472-516) uses a generic multi-section flat CSV with section headers as text rows. The GST portal offline utility expects a specific column mapping per table. The current CSV will require manual reformatting before upload. The documentation (apps/docs/src/content/docs/gst/gstr1.mdx, line 126) correctly advises users to "import the CSV or manually enter the data," but this creates friction and error risk. A JSON export matching the GSTN JSON schema would be more useful.
- Current state (at audit time): Generic CSV, multi-section, not directly importable to GST Offline Utility.
- Target state: JSON export matching GSTN schema, or at minimum, per-section CSV files matching the offline utility's column order.
- Remediation: Implement a `gstr1ToJson()` function outputting the GSTN API JSON schema format. Expose it as a separate export endpoint.
- Effort: 3-5 days.
- **Update (corrected in 0.10.1)**: the JSON export exists. `gst.gstr1Json` (`packages/api/src/routers/gst.ts`) returns the portal JSON built by `gstr1ToPortalJson` (`packages/api/src/lib/gst-reports.ts`), with the business GSTIN, financial year and filing period, in the schema the GST portal's offline tool accepts. The CSV (`gst.gstr1CSV`) is unchanged and is still a generic multi-section file. What remains open: the web GSTR-1 tab does not call `gst.gstr1Json` yet, so the JSON is reachable through the API only (the GSTR-9 tab does offer its JSON).

**Gap 1.1.2 (MEDIUM)**: Zero-rated supplies (exports of goods/services, SEZ supplies) are not separately classified. They fall into B2B or B2CS based on the party GSTIN. The GSTR-1 requires zero-rated supplies in Table 6A (exports) and Table 6B (SEZ). The documentation acknowledges this limitation (`apps/docs/src/content/docs/gst/index.mdx`, line 65).
- Current state: Zero-rated supplies not identified; no `exportType` field on invoices.
- Target state: An `exportType` field (none/export/sez) on invoices, with Table 6A/6B generation.
- Remediation: Add `exportType` enum to invoice schema and branch logic in `generateGSTR1`.
- Effort: 5-7 days.

**Gap 1.1.3 (MEDIUM)**: Composition scheme GSTR-4 is not generated. The documentation acknowledges this. Composition businesses can use Hisaabo for record-keeping but must prepare GSTR-4 manually.
- Current state: Not implemented.
- Recommendation: Add a prominent disclaimer in the UI when `gstRegistrationType === "composition"` explaining GSTR-4 must be filed separately.

**Gap 1.1.4 (MEDIUM)**: The B2CL section is aggregated by state (line 236: `b2cLargeMap.get(state)`). The GST portal Table 5 requires one row per invoice, not per state. Aggregation loses the individual invoice detail required for accurate filing.
- Evidence: `gst-reports.ts` line 193-239; the `b2cLargeMap` groups by state string, collapsing all invoices.
- Current state: B2CL is state-aggregated.
- Target state: One row per invoice, matching Table 5 of GSTR-1.
- Remediation: Change `b2cLargeMap` to an array and push individual invoice records.
- Effort: 1 day.

### 1.2 Tax Calculation Rules (CGST/SGST vs IGST)

**Status**: COMPLIANT

**Evidence**: `packages/api/src/lib/gst-reports.ts`, lines 184-191 (state comparison), lines 211-213 (tax split).

**Findings**: The intra/inter-state detection uses a two-level comparison: first compares 2-digit `stateCode` columns (preferred, more reliable), falling back to text state name comparison. This is the correct approach. The CGST/SGST split (50/50 of total tax) is correct for intra-state. IGST = full tax for inter-state is correct. The same logic is applied consistently in the invoice PDF (`invoice-pdf.ts`, lines 337-360) and in the GSTR-3B generator (`gst-reports.ts`, lines 414-426).

### 1.3 State Code Logic

**Status**: COMPLIANT

**Evidence**: `packages/db/src/tenant-schema.ts` does not define state codes; `packages/db/src/tenant-schema.ts` for `parties` and `businesses` tables both include a `stateCode text` column (tenant-schema.ts lines 34, 84). The GSTIN validator in `validators.ts` line 57 enforces the 15-character format including the 2-digit state code prefix (`[0-9]{2}...`).

**Gap 1.3.1 (LOW)**: The `stateCode` field on `businesses` and `parties` is optional and freeform (max 2 characters). There is no validation enforcing that it is one of the 38 valid Indian state codes (01-38). An incorrect state code entry will silently cause wrong CGST/SGST vs IGST classification.
- Remediation: Add a Zod enum for the 38 valid GST state codes and validate on input. Display a dropdown in the UI.
- Effort: 1 day.

**Gap 1.3.2 (LOW)**: The GSTIN regex in `validators.ts` line 57 (`/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/`) validates format correctly but does not cross-check the embedded state code (first 2 digits) against the business's or party's stored `stateCode`. A GSTIN from Maharashtra (27) could be stored against a party with `stateCode = "29"` (Karnataka) without any warning.
- Remediation: On party save, if both GSTIN and stateCode are provided, warn if the GSTIN's first 2 digits do not match `stateCode`.
- Effort: 0.5 days.

### 1.4 HSN Code Handling

**Status**: PARTIALLY COMPLIANT

**Evidence**: `packages/db/src/tenant-schema.ts`, line 112 (`hsn: text("hsn")`); `gst-reports.ts` lines 171-181.

**Findings**: HSN codes are stored on items, not on invoice line items. When generating the HSN summary, the code looks up the item by `itemId` and fetches the HSN (line 177). Line items without an `itemId` (manually typed descriptions) get HSN code `0000`.

**Gap 1.4.1 (MEDIUM)**: HSN codes are not stored on invoice line items at the time of invoicing. If an item's HSN is updated after an invoice is created, the GSTR-1 HSN summary for past periods will reflect the new HSN, not the HSN at the time of the transaction. For audit purposes, HSN should be snapshotted onto `invoice_items` at creation time.
- Evidence: `packages/db/src/tenant-schema.ts`, `invoiceItems` table (lines 209-228) has no `hsn` column.
- Current state: HSN resolved dynamically from current item record.
- Target state: Add `hsn` column to `invoiceItems` table; populate at invoice creation time.
- Remediation: Schema migration to add `hsn text` to `invoice_items`; populate in `invoice.create` and `document-router-factory.ts`.
- Effort: 2 days.

**Gap 1.4.2 (LOW)**: Items with `itemMode = "variants"` share one HSN code at the item level. This is correct for most use cases. However, if variants of the same item have different HSN codes (rare but possible for composite goods), the system cannot represent this.
- Recommendation: This is an edge case. Document the limitation.

### 1.5 Invoice Numbering

**Status**: COMPLIANT

**Evidence**: `packages/api/src/routers/invoice.ts`, lines 146-157; `packages/db/src/tenant-schema.ts` line 38.

**Findings**: Invoice numbers are generated atomically using a PostgreSQL `SELECT ... FOR UPDATE` lock on the business row, then incrementing `nextInvoiceNumber`. The format is `{prefix}-{5-digit-zero-padded-number}` (e.g., `INV-00001`). The unique index `invoices_number_idx` enforces uniqueness per business (tenant-schema.ts line 201). This satisfies GST Rule 46(b) requiring sequential, unique invoice numbers within a financial year. The prefix and starting number are configurable per business.

**Gap 1.5.1 (LOW)**: The invoice number sequence is continuous across financial years. GST rules technically require the numbering to reset at the start of each financial year (April 1 for most businesses, as configured in `financialYearStart`). The current implementation does not reset. In practice many tax authorities accept continuous numbering, but resetting is the safer approach.
- Remediation: Add a cron job or UI prompt to reset `nextInvoiceNumber` to 1 at the financial year boundary.
- Effort: 1 day.

---

## 2. Invoice Compliance

### 2.1 Mandatory Fields per GST Rules

**Status**: PARTIALLY COMPLIANT

**Control Reference**: CGST Rules 2017, Rule 46 (Tax Invoice mandatory fields)

**Evidence**: `packages/api/src/lib/invoice-pdf.ts` (PDF generation), `packages/db/src/tenant-schema.ts` (invoice schema).

Rule 46 requires the following on a Tax Invoice:

| Mandatory Field | Status | Evidence |
|---|---|---|
| Name, address, GSTIN of supplier | COMPLIANT | invoice-pdf.ts lines 154-188; GSTIN shown when gstRegistrationType != "unregistered" |
| Consecutive serial number | COMPLIANT | invoice.ts lines 153; uniqueIndex on invoiceNumber |
| Date of issue | COMPLIANT | invoiceDate field; shown in PDF line 199 |
| Name, address, GSTIN of recipient (for B2B) | PARTIALLY COMPLIANT | GSTIN shown if available (pdf.ts line 226-229); address optional in schema |
| Description of goods/services | COMPLIANT | `description` field on invoice_items; text("description").notNull() |
| HSN/SAC code | PARTIALLY COMPLIANT | Shown in PDF when gstRegistrationType is regular/composition (pdf.ts line 234); but see Gap 1.4.1 |
| Quantity and unit | PARTIALLY COMPLIANT | Quantity shown; unit is stored in selectedUnit but not currently displayed on PDF |
| Total value | COMPLIANT | totalAmount shown in PDF |
| Taxable value and discount | COMPLIANT | subtotal and discountAmount shown |
| Rate of tax (CGST/SGST/IGST) | COMPLIANT | GST breakdown table in PDF (pdf.ts lines 333-399) |
| Amount of tax | COMPLIANT | taxAmount per line item and in breakdown |
| Place of supply (state) | PARTIALLY COMPLIANT | Business and party states shown; explicit "Place of Supply" label not present |
| Address of delivery if different from place of supply | NOT IMPLEMENTED | shippingAddress field on party exists but not shown on PDF |
| Whether supply is on reverse charge basis | NOT IMPLEMENTED | No reverse charge field |
| Invoice/Bill of Supply/Credit Note designation | COMPLIANT | Title changes based on gstRegistrationType (pdf.ts lines 130-135) |
| Signature/digital signature | NOT APPLICABLE (self-hosted, not digital) | - |

**Gap 2.1.1 (HIGH)**: "Place of Supply" is not labeled as such on the PDF. Rule 46(h) requires the place of supply to be stated explicitly for inter-state transactions. While the state is visible in the party address, it is not labeled as "Place of Supply."
- Current state: Party state appears in billing address block; no "Place of Supply" label.
- Target state: Add a "Place of Supply: [State Name] ([State Code])" line to the invoice PDF, visible on inter-state B2B invoices.
- Remediation: Add to `generateA4Invoice` and the other format generators.
- Effort: 0.5 days.

**Gap 2.1.2 (HIGH)**: Reverse charge mechanism is not implemented. Under GST, certain categories of supply (legal services, goods transport, security services, etc.) require the buyer to pay GST under Reverse Charge Mechanism (RCM). There is no field to flag an invoice as RCM, and the PDF does not print "Reverse Charge: Yes/No" as required by Rule 46(p).
- Current state: No RCM field on invoices schema or PDF.
- Target state: Add `isReverseCharge boolean` to the invoice schema; print on PDF; exclude from output tax in GSTR reports.
- Remediation: Schema change + PDF change + GST report exclusion logic.
- Effort: 3 days.

**Gap 2.1.3 (MEDIUM)**: The unit of measurement is not printed on the PDF line items. Rule 46(e) requires the "description of goods or services including unique quantity code." Only the numeric quantity is shown; the unit (pcs, kg, etc.) is stored but not rendered.
- Evidence: `invoice-pdf.ts` line 275: `doc.text(parseFloat(item.quantity).toLocaleString("en-IN"), ...)` — no unit.
- Remediation: Pass `selectedUnit` to the PDF data struct and render it alongside quantity.
- Effort: 0.5 days.

**Gap 2.1.4 (MEDIUM)**: Shipping address (place of delivery when different from place of supply) is stored on the `parties` table (`shippingAddress` column, tenant-schema.ts line 79) but is not passed to the invoice PDF or printed. Rule 46(j) requires the delivery address when different from billing address for supply of goods.
- Remediation: Pass `partyShippingAddress` to `InvoicePDFData` and render it when it differs from `partyBillingAddress`.
- Effort: 1 day.

### 2.2 Invoice PDF Output

**Status**: PARTIALLY COMPLIANT (see gaps above)

**Evidence**: `packages/api/src/lib/invoice-pdf.ts`.

**Positive findings**: The PDF correctly distinguishes "TAX INVOICE" (regular GST), "BILL OF SUPPLY" (composition/unregistered), and "PURCHASE INVOICE" (line 130-135). The GST breakdown table showing CGST/SGST or IGST per tax rate is present (lines 330-399). Amount in words using the Indian numbering system (crore, lakh, thousand) is implemented (lines 98-126). GSTIN and PAN are printed. UPI QR code is generated for outgoing sale invoices with a balance due.

### 2.3 Credit Notes and Debit Notes

**Status**: COMPLIANT

**Evidence**: `packages/db/src/tenant-schema.ts`, `documentTypeEnum` line 13; `gst-reports.ts` lines 282-357.

**Findings**: Credit notes and debit notes are distinct document types in the schema. They appear in the GSTR-1 report under the correct sections. The reference document ID links them back to the original invoice. The `createDocumentRouter` factory in `packages/api/src/lib/document-router-factory.ts` handles their creation using the same invoice calculation pipeline.

---

## 3. Data Privacy (DPDPA 2023)

### 3.1 Overview

**Status**: PARTIALLY COMPLIANT

**Control Reference**: Digital Personal Data Protection Act 2023 (India); IT Act 2000 Section 43A; IT (Reasonable Security Practices) Rules 2011.

**Important context**: DPDPA 2023 rules were still being notified as of early 2026. The core obligations around consent, purpose limitation, data principal rights, and security are active. The following assessment reflects the Act's stated requirements.

### 3.2 Password Security

**Status**: COMPLIANT

**Evidence**: `packages/api/src/routers/auth.ts`, lines 141-145.

**Findings**: Passwords are hashed using Argon2id with memory cost 65536 KB, time cost 3 iterations, parallelism 4. These parameters meet or exceed OWASP recommendations for Argon2id. Passwords are never logged, stored in plaintext, or returned in API responses.

### 3.3 Session Management

**Status**: COMPLIANT

**Evidence**: `packages/api/src/routers/auth.ts`, lines 448-458; `packages/api/src/context.ts`.

**Findings**: Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (in production). Session IDs are 64-character nanoid tokens (cryptographically random). Sessions expire after 30 days. Server-side invalidation on logout is implemented (sessions deleted from DB, cache evicted). Logout-all-sessions functionality exists. Magic link tokens are SHA-256 hashed before storage and are single-use (atomic update-and-check in `verifyMagicLink`, line 236-243). Token hash comparison prevents timing attacks.

**Gap 3.3.1 (HIGH — see SECURITY_PENDING.md)**: No per-email login rate limiting. Global rate limiter (120 req/min/IP) allows approximately 120 password attempts per minute per IP address, more from distributed IPs. An attacker conducting a credential stuffing or brute-force attack against a known email address is not blocked beyond the global limit.
- Evidence: `packages/api/src/routers/auth.ts` login procedure; `SECURITY_PENDING.md` line 23.
- Remediation: Track failed attempts per email in Redis or an in-memory map; lock out after 5 failures per 15 minutes with an exponential backoff.
- Effort: 1 day.

### 3.4 Sensitive Data Handling (PII: Phone, Email, GSTIN, PAN)

**Status**: PARTIALLY COMPLIANT

**Evidence**: `packages/db/src/tenant-schema.ts`, `parties` table (lines 71-102); `businesses` table (lines 20-67).

**Findings**: Customer phone, email, GSTIN, and PAN are stored in plaintext in the PostgreSQL database. No field-level encryption is applied. The parties table stores `bankAccountNumber` and `bankIfsc` in plaintext as well.

**Gap 3.4.1 (HIGH)**: PAN numbers (parties.pan, businesses.pan) and bank account numbers (parties.bankAccountNumber) are stored as plaintext. Under the IT (Reasonable Security Practices) Rules 2011 and DPDPA principles, sensitive financial identifiers should be encrypted at rest. In a self-hosted context the database itself should be the encryption boundary, but field-level encryption of PAN and bank account numbers provides defense-in-depth.
- Evidence: `tenant-schema.ts` lines 79, 94-95 (party PAN and bank); line 28 (business PAN).
- Remediation: Consider field-level AES-256 encryption for `pan` and `bankAccountNumber` columns with key management via environment variable. Alternatively, ensure and document that database-level encryption (PostgreSQL TDE via pgcrypto or disk encryption) is mandatory.
- Effort: 3-5 days for field-level encryption; 0.5 days for documentation requirement.

**Gap 3.4.2 (MEDIUM — known, see SECURITY_PENDING.md)**: Tenant DB passwords (`tenants.dbPassword`) are stored in plaintext in the control schema. This affects multi-tenant cloud deployments, not self-hosted instances.
- Evidence: `packages/db/src/control-schema.ts` line 29; `SECURITY_PENDING.md` lines 11-13.
- Remediation: AES-256-GCM envelope encryption with a `DB_ENCRYPTION_KEY` environment variable. Self-hosted operators are not affected.

**Gap 3.4.3 (HIGH — known, see SECURITY_PENDING.md)**: Invitation tokens in the `invitations` table are stored as raw plaintext (control-schema.ts line 91: `token: text("token").notNull()`). If an attacker reads the database (backup leak, SQL injection), they can use any pending invitation token to join any organization at any role.
- Evidence: `packages/db/src/control-schema.ts` line 91; `SECURITY_PENDING.md` lines 7-10.
- Remediation: Hash invitation tokens with SHA-256 on write; compare hash on accept. Return raw token only in the API response to the inviter, never stored.
- Effort: 1 day.

### 3.5 DPDPA-Specific Requirements

**Status**: NON-COMPLIANT (framework requirements not yet implemented)

**Evidence**: No privacy policy, consent capture, or data principal rights endpoint found in the codebase.

**Gap 3.5.1 (CRITICAL for SaaS/cloud deployment, LOW for pure self-hosted)**: DPDPA 2023 requires:
1. A clear, accessible Privacy Notice describing what personal data is collected, purpose of processing, and data principal rights.
2. Consent capture before processing personal data of customers (especially relevant for the online store where store customers submit their name and phone number).
3. Data principal rights: right to access data, right to correction, right to erasure ("right to be forgotten"), right to grievance redressal.
4. Contact details of a Data Protection Officer (or equivalent).

**Current state**: No privacy notice, no consent mechanism, no data deletion endpoint for end users. The store order form (`apps/store`) collects customer name, phone, and optionally email and delivery address with no visible privacy notice.
- Remediation for self-hosted: Provide a template privacy notice that operators must publish. Add a `DELETE /account` endpoint. Document data retention periods.
- Remediation for SaaS: Full consent capture on registration and store checkout; data deletion API; DPO contact information; privacy notice.
- Effort: 5-10 days.

**Gap 3.5.2 (HIGH)**: No data erasure ("right to be forgotten") mechanism exists. A business user who wants to delete their account has no self-service path to delete their personal data. Admins can soft-delete invoices and remove parties, but there is no account self-deletion flow.
- Current state: No `DELETE /account` or equivalent.
- Remediation: Implement an account deletion flow that: removes the user's sessions, anonymizes their name/email, removes personal data but preserves financial records required for statutory retention periods (7 years under Companies Act 2013).
- Effort: 2-3 days.

---

## 4. Financial Accuracy

### 4.1 Fixed-Point Arithmetic

**Status**: COMPLIANT

**Evidence**: `packages/shared/src/money.ts`; `packages/shared/src/calc.ts`.

**Findings**: The `money` module in `packages/shared/src/money.ts` implements integer paise arithmetic throughout. All values are converted to integer paise via `toPaise()` (which uses `Math.round(num * 100)`, eliminating floating-point representation error), operated on as integers, and converted back to decimal strings via `fromPaise()`. All four arithmetic operations (add, sub, mul, percent) operate entirely in integer paise. The `sum()` function accumulates paise integers, avoiding accumulation of floating-point error across line items.

The `calcLineItem` and `calcInvoiceTotals` functions in `calc.ts` use the `money` module exclusively. Invoice totals are computed server-side using these functions at creation time (invoice.ts lines 184-195) and on update (lines 463-476). The results are stored as `NUMERIC(15,2)` strings.

**Gap 4.1.1 (HIGH)**: The GST report aggregation in `gst-reports.ts` uses JavaScript `parseFloat()` and plain addition for all report totals (lines 207-219, 411-425, and the HSN accumulator lines 267-278). This is the one location in the financial pipeline that bypasses the `money` module. Because the source values are fetched from `NUMERIC(15,2)` database columns (which always have exactly 2 decimal places), the floating-point error will typically be in the 15th significant digit and will not produce visibly wrong results for most invoice sizes. However:
  - Report totals accumulated across hundreds of invoices can develop rounding errors that differ from the sum of correctly rounded individual values.
  - The `toFixed(2)` calls in the CSV export do not use the `money` module's rounding, so edge cases could produce totals that differ by Rs 0.01 from what the `money` module would produce.
- Current state: `parseFloat` addition in `generateGSTR1` and `generateGSTR3B`.
- Target state: Use `money.sum()` and `money.add()` throughout, accumulate paise integers.
- Evidence: `gst-reports.ts` lines 198-219 (totals), 411-425 (ITC calculation).
- Remediation: Replace `parseFloat` + `+=` pattern with `money.add()` accumulation.
- **Status (0.10.1): resolved** for `generateGSTR1` and `generateGSTR3B`. Every total, group and head is accumulated as integer paise through `money.add` / `money.sub` / `money.sum`, and CGST/SGST are split with the shared `money.splitHalf`; the report types still expose JS numbers, converted once at the end with `money.toNumber`. The CSV `toFixed(2)` calls and the portal-JSON helpers are unchanged.
- Effort: 1 day.

### 4.2 NUMERIC(15,2) Constraint

**Status**: COMPLIANT

**Evidence**: `packages/db/src/tenant-schema.ts`.

**Findings**: All monetary columns in the database schema use `numeric("...", { precision: 15, scale: 2 })`. This was verified for: `invoices.subtotal`, `taxAmount`, `discountAmount`, `additionalCharges`, `roundOff`, `totalAmount`, `amountPaid` (lines 179-186); `invoiceItems.unitPrice`, `taxAmount`, `totalAmount` (lines 215-219); `payments.amount`, `discount` (lines 237-238); `expenses.amount` (line 277); `bankAccounts.openingBalance`, `currentBalance` (lines 302-303); `parties.openingBalance`, `creditLimit` (lines 87, 90). No `FLOAT` or `DOUBLE PRECISION` columns are used for monetary values.

Stock quantities correctly use `NUMERIC(15,3)` (three decimal places) to support fractional quantities (e.g., kg, litres).

### 4.3 Rounding Rules

**Status**: COMPLIANT

**Evidence**: `packages/shared/src/money.ts`, `toPaise` (line 12), `fromPaise` (line 17).

**Findings**: `toPaise` uses `Math.round()` which implements "round half away from zero" (also known as "commercial rounding"). This is the standard rounding method for Indian GST. The `Math.round()` behavior is consistent with the CGST Act's rounding requirement of rounding to the nearest rupee (CGST Act Section 170), though Hisaabo retains paise precision at the line-item level.

### 4.4 Tax-Inclusive Price Calculation

**Status**: COMPLIANT

**Evidence**: `packages/shared/src/calc.ts`, lines 20-35.

**Findings**: The tax-inclusive back-calculation uses `grossPerUnit / (1 + taxRate / 100)` to derive the base price, then calculates discount and tax on the base. This is arithmetically correct. The intermediate `basePerUnit` is computed as a JavaScript float but immediately stringified to 2 decimal places before re-entering the `money` module, bounding the float error.

---

## 5. Audit Trail

### 5.1 Audit Log Schema

**Status**: COMPLIANT (schema design)

**Evidence**: `packages/db/src/tenant-schema.ts`, lines 355-371; `packages/api/src/lib/audit.ts`.

**Findings**: The `audit_log` table captures: `businessId`, `userId`, `action` (string identifier like `invoice.create`), `entityType`, `entityId`, `metadata` (JSON string), `ipAddress`, and `createdAt` timestamp with timezone. Three indexes support querying: by business, by entity type/ID, and by business+date. The schema design is adequate for regulatory requirements of who, what, and when.

The `logAudit()` function wraps the insert in a try/catch (line 27-29) so audit failures never block the business operation. This is an acceptable design choice for availability, but see Gap 5.1.1.

### 5.2 Coverage of Audit Events

**Status**: PARTIALLY COMPLIANT

**Evidence**: Reviewed all router files for `logAudit` calls.

**Findings**: `logAudit` is called for:
- `invoice.create` (invoice.ts line 266)
- `invoice.delete` (invoice.ts line 523)
- `payment.create` (payment.ts line 323)
- `payment.delete` (payment.ts line 648)
- `party.delete` (party.ts line 234)

**Gap 5.2.1 (HIGH)**: `invoice.update` and `invoice.updateStatus` mutations do NOT call `logAudit`. Changes to invoice amounts, party, dates, or line items are not logged. This is a significant gap — editing an invoice after issuance is a high-risk action from a compliance standpoint and regulators expect these changes to be traceable.
- Evidence: `invoice.ts` `update` procedure (lines 290-492) and `updateStatus` (lines 279-288) have no `logAudit` calls.
- Remediation: Add `logAudit` calls to both mutations, capturing the previous state in `metadata`.
- Effort: 0.5 days.

**Gap 5.2.2 (HIGH)**: Expenses are never audit-logged. The expense router (`packages/api/src/routers/expense.ts`) has no `logAudit` import or calls. Expense creation, update, and deletion are all unlogged.
- Evidence: Grep for `logAudit` in `expense.ts` returned no matches.
- Remediation: Add `logAudit` to expense `create`, `update`, and `delete` mutations.
- Effort: 0.5 days.

**Gap 5.2.3 (MEDIUM)**: Business settings changes (business profile update, sequence number changes) are not audit-logged. Changes to invoice prefix or GST registration type are security-sensitive.
- Evidence: `packages/api/src/routers/business.ts` has no `logAudit` calls.
- Remediation: Log `business.update` and `business.updateSequence` actions.
- Effort: 0.5 days.

**Gap 5.2.4 (MEDIUM)**: The audit log has `ON DELETE CASCADE` on `businessId` (tenant-schema.ts line 357). If a business is deleted, all associated audit logs are deleted. For regulatory purposes, audit logs should be retained even after a business is deactivated. In practice, business deletion should be a soft-delete (which is implemented for invoices and payments), but the cascade means accidental hard-deletion would destroy the audit trail.
- Remediation: Change the `businessId` foreign key to `ON DELETE SET NULL` or `ON DELETE RESTRICT`, and soft-delete businesses rather than hard-deleting.
- Effort: Schema migration, 0.5 days.

### 5.3 Tamper Resistance

**Status**: PARTIALLY COMPLIANT

**Gap 5.3.1 (MEDIUM)**: The audit log has no tamper-evident mechanism. A database administrator with write access to the `audit_log` table can modify or delete log entries without detection. For regulatory purposes (Income Tax Act 1961, Companies Act 2013 for incorporated entities), audit logs should be append-only or cryptographically chained (e.g., each row's hash includes the previous row's hash).
- Current state: Standard PostgreSQL table, writable by the application DB user.
- Target state for high-assurance: Separate write-only DB user for audit log inserts; no UPDATE/DELETE grants on audit_log; periodic hash-chain export to immutable storage.
- Remediation (pragmatic): Grant the application user only INSERT privilege on `audit_log`, never UPDATE or DELETE. Document this in deployment guide.
- Effort: 0.5 days (privilege restriction); 3 days (cryptographic hash chain).

---

## 6. Data Portability

### 6.1 CSV Export

**Status**: COMPLIANT

**Evidence**: `packages/api/src/routers/business.ts`, lines 138-177.

**Findings**: The `exportData` endpoint exports all business data as CSV: parties, items, invoices, line items, payments, and expenses. The CSV uses proper quoting for values containing commas or quotes. The export includes all non-sensitive financial fields. The endpoint is restricted to admin role (`adminProcedure`, line 138).

**Gap 6.1.1 (MEDIUM)**: The `exportData` endpoint does not include stock adjustments or bank transaction records. These may be needed for complete accounting export.
- Remediation: Add `stockAdjustments` and `bankTransactions` to the export.
- Effort: 0.5 days.

### 6.2 Tally XML Export

**Status**: IMPLEMENTED (corrected in 0.10.1; this section originally read "NOT IMPLEMENTED")

**Evidence**: `reports.tallyExport` (`packages/api/src/routers/reports.ts`) builds Tally Prime XML with `generateTallyXml` (`packages/api/src/lib/tally-xml-export.ts`): the chart of accounts as ledger masters plus a voucher for every invoice, payment, expense and manual journal entry in a period (voided entries together with their reversals; customer TDS as a Dr TDS Receivable line of the receipt). The web Reports > Tally Export tab downloads it. Covered by `tally-xml-export.test.ts` and `integration/tally-export.test.ts`.

The older `party.tallyExport` returns a CSV that Tally cannot import. It is deprecated as of 0.10.1 and no longer used by the web app.

**Gap 6.2.1 (LOW, resolved)**: Many Indian SMBs file with a CA using Tally ERP, and a Tally XML export reduces the cost of syncing with Tally. This is now met by `reports.tallyExport`.
- Remaining: there is no CLI command or MCP tool for it (the API and the web tab only), and no import of Tally data in the other direction (the import wizard offers myBillBook only).

### 6.3 Backup Mechanisms

**Status**: COMPLIANT

**Evidence**: `scripts/backup.sh`; `scripts/postgresql-wal.conf`.

**Findings**: A cron-compatible backup script exists that performs both a `pg_basebackup` (binary backup for point-in-time recovery) and a `pg_dump` (SQL dump for portability). Backups are uploaded to S3/R2 via rclone with 30-day local retention. The backup file is verified with `gzip -t` before the script exits. WAL archiving configuration exists for point-in-time recovery.

**Gap 6.3.1 (MEDIUM)**: The backup script does not encrypt the backup files before uploading to S3/R2. The dump contains all customer PAN, GSTIN, phone, and bank account data in plaintext. If the S3 bucket is misconfigured (public access), the data would be exposed.
- Current state: `pg_dump | gzip > file`; uploaded unencrypted.
- Target state: `pg_dump | gzip | gpg --symmetric --batch --passphrase-file /etc/backup-key > file.gz.gpg`
- Remediation: Add GPG symmetric encryption to the backup script; document key management.
- Effort: 0.5 days.

**Gap 6.3.2 (LOW)**: The backup script does not test restore. A backup that cannot be restored is not a backup. A monthly restore test to a separate instance is recommended.
- Recommendation: Document a quarterly restore test procedure in the deployment guide.

---

## 7. Prioritized Recommendations

### Critical (address before handling sensitive customer data at scale)

1. **DPDPA Privacy Notice and Consent** (Gap 3.5.1): Add a privacy notice to the application, especially for the online store. Without this, processing customer personal data (name, phone) through the store is non-compliant with DPDPA.

2. **Invitation Token Storage** (Gap 3.4.3): Hash invitation tokens before storing. Plaintext tokens in the database are a direct privilege escalation vector if the database is read by an unauthorized party. This is already documented in `SECURITY_PENDING.md` as CRITICAL.

3. **Per-Email Login Rate Limiting** (Gap 3.3.1): The current global rate limit is insufficient to prevent credential stuffing. Add per-email failed-attempt tracking. Already documented in `SECURITY_PENDING.md` as HIGH.

4. **Invoice Edit Audit Logging** (Gap 5.2.1): Invoice updates are not logged. This is both a regulatory gap (audit trail completeness) and a fraud prevention gap.

### High (address before first external audit or before onboarding paying customers)

5. **Floating-Point in GST Reports** (Gap 4.1.1): Replace `parseFloat` + `+=` in `gst-reports.ts` with `money.add()` accumulation. Risk of Rs 0.01 discrepancies in report totals.

6. **B2CL Per-Invoice Rows** (Gap 1.1.4): The B2CL section aggregates by state instead of showing one row per invoice. Fix before providing GSTR-1 to a CA for filing.

7. **Place of Supply on PDF** (Gap 2.1.1): Required by CGST Rule 46(h). Affects B2B inter-state invoices. Small change, high compliance value.

8. **Unit of Measurement on PDF** (Gap 2.1.3): Required by CGST Rule 46(e). Small change.

9. **PAN / Bank Account Encryption** (Gap 3.4.1): Field-level encryption or mandatory documentation of database-level encryption for plaintext PAN storage.

10. **Expense Audit Logging** (Gap 5.2.2): Expenses are entirely unlogged. Add `logAudit` calls.

### Medium (address within 3 months)

11. **HSN Snapshot on Line Items** (Gap 1.4.1): Store HSN on `invoice_items` at creation time to prevent historical report drift when items are updated.

12. **Reverse Charge Mechanism** (Gap 2.1.2): Required for businesses dealing in RCM-liable categories. Medium effort, affects a subset of users.

13. **GSTR-1 JSON Export** (Gap 1.1.1): The export now exists (`gst.gstr1Json`, see the update under Gap 1.1.1); what remains is surfacing it in the web GSTR-1 tab. The CSV still needs reformatting before upload.

14. **Data Erasure Endpoint** (Gap 3.5.2): DPDPA right to be forgotten. Implement `DELETE /account` with audit record retention.

15. **Backup Encryption** (Gap 6.3.1): Encrypt backup files before offsite upload.

16. **Audit Log Append-Only Privilege** (Gap 5.3.1): Revoke UPDATE/DELETE on `audit_log` from the application DB user.

17. **State Code Enum Validation** (Gap 1.3.1): Replace freeform `stateCode` text field with validated enum of 38 Indian state codes.

18. **Financial Year Invoice Number Reset** (Gap 1.5.1): Optional but cleaner for multi-year compliance.

19. **Export: Stock Adjustments and Bank Transactions** (Gap 6.1.1): Complete the data export for full portability.

### Open items found after the audit

20. **Stock over-restored when cancelling an invoice converted from a delivery challan** (found during the 0.10.1 e-invoice cancel review, not fixed in 0.10.1; planned for 0.11). Converting a challan to an invoice passes `skipStockAdjustment: true`, so the invoice does not deduct stock (the challan already did), but that flag is not persisted on the invoice. Cancelling (or deleting) such an invoice runs the normal reversal (`reverseInvoiceEffects`), which adds the invoice's quantities back to stock even though the invoice never deducted them, and the challan's own deduction is untouched. Fix: persist the flag (or reverse only when the invoice deducted stock) and add a regression test. Until then, adjust stock manually after cancelling an invoice that was converted from a challan. The same applies when cancelling it by cancelling its e-invoice.

21. **E-invoicing never signed in to the IRP: the bundled NIC public key was invalid** (found during the 0.10.1 e-invoice cancel review; fixed in 0.10.1). The PEM in `irp-client.ts` (present since e-invoicing was added) is rejected by `crypto.createPublicKey`, so the RSA step threw before any request was sent. No IRN could ever have been generated by a real IRP call. Because it was a literal that nothing parsed, no test noticed. 0.10.1 removes it: the key comes from `IRP_PUBLIC_KEY_PEM`/`_PATH` (production) and `IRP_SANDBOX_PUBLIC_KEY_PEM`/`_PATH` (sandbox), is parsed and cached at first use, and a missing or invalid key is a clear `IRPNotConfiguredError`. Tests use a generated RSA pair, and a guard test fails if a PEM block is committed in source. Remaining: operators must obtain and configure the key (see DEPLOYMENT.md, "E-invoicing (IRP)"); no per-business key override exists (it would need a schema migration; add one only if GSP-style setups need it).

22. **IRP sign-in request and response handling: aligned with NIC's documentation, unverified against NIC's live sandbox** (0.10.1). Source: NIC's e-invoice sandbox documentation (Authentication v1.04, Get IRN details, Cancel IRN, and the "Sample Code in Java" page, at einv-apisandbox.nic.in), cross-checked with a GSP's published authentication guide. What changed: the request body is now `{"Data": ...}`, the Base64 of the credentials JSON RSA-encrypted with PKCS#1 v1.5 (`RSA/ECB/PKCS1PADDING` in NIC's sample), with the password in plain text (the old code sent per-field values and a SHA-256 hash of the password, which NIC does not document); and `Status` is read as the number 1 NIC documents (the old code compared it with the string `"1"`, which would have treated every response as a failure). Still unverified against a live sandbox, and ambiguous or inconsistent in the sources: the AppKey length (32 random bytes here, as the GSP guide says; NIC's Java sample generates 128 bits while its comment says 32 bytes); that the decrypted SEK is Base64 text of the key (as the GSP guide's example shows); the token-expiry date format; the endpoint paths (`/eivital/v1.04/auth`, `/eicore/v1.03/Invoice`, `/Invoice/Cancel`, `/Invoice/irn/{irn}`; NIC's pages show a `<URL>/api/...` placeholder); and how failure `ErrorDetails` are encoded. Action: run Test Connection and one generate/cancel against the NIC sandbox with real sandbox credentials and the sandbox key before announcing e-invoicing as working. Note that Node.js refuses PKCS#1 v1.5 for private-key decryption (so tests decrypt with no padding and strip the block by hand) but still encrypts with it, which is all the client needs.

23. **E-way bill client (`ewb-client.ts`) is unverified against NIC, and has no public key configured at all.** (a) It RSA-encrypts the client secret with **OAEP/SHA-256** when a key is given, whereas NIC's e-invoice sample uses PKCS#1 v1.5. No authoritative NIC e-way bill document or sample was available to settle which padding the e-way bill API wants, so it is left unchanged and unverified. (b) The router builds the client without a public key (`new EWBClient(config)` in `routers/ewayBill.ts`), so the RSA step is skipped and the client secret is sent in plain text on the assumption that the sandbox accepts it (unverified); the production behaviour is unknown. There is no `IRP_*`-style variable for an e-way bill key. (c) The session key is decrypted with the first 32 characters of the client secret as the AES key, rather than with a per-session app key as in the e-invoice flow; unverified. (d) The auth path (`/ewbapi/v1.03/authenticate`), hosts (`ewb-apisandbox.nic.in`, `ewb.nic.in`) and field names are not checked against NIC's e-way bill documentation. (e) E-way bill credentials come from the server environment (`NIC_EWB_CLIENT_ID`, `NIC_EWB_CLIENT_SECRET`, `NIC_EWB_USERNAME`, `NIC_EWB_PASSWORD`, `NIC_EWB_SANDBOX`), not per business, and there is no connection test for e-way bills (the e-invoice one is `eInvoice.testConnection`). Treat e-way bill generation as **unverified against the NIC sandbox** until all of this is checked with real credentials; do not rely on it for production.

### Open items recorded after the 0.10.1 accounting corrections

Known issues that the 0.10.1 ledger / GST corrections deliberately did not change:

24. **Reverse-charge liability in the books** (related to Gap 2.1.2): GSTR-3B reports reverse-charge purchases in Table 3.1(d) and takes the ITC, but the derived ledger posts a reverse-charge purchase like an ordinary one: no output-tax liability is credited and no matching input credit is debited for the RCM tax itself. A purchase-side return, debit note or credit note raised from a reverse-charge purchase inherits that purchase's reverse-charge flag, so it reduces the same table and ITC bucket as the purchase it reverses.
25. **Tax-inclusive pricing uses a float** (Gap 4.1): `calcLineItem` with `taxInclusive` derives the base price as `unitPrice / (1 + rate / 100)` in floating point before stringifying to two decimals. The error is bounded to the paisa by the immediate `toFixed(2)`, but a line near a half-paisa boundary can round differently from an exact calculation.
26. **GSTR-2B reconciliation tax split** (`gstr2b.reconcile`): resolved in 0.10.1. The books side now compares purchase invoices only (purchase-side reversals are not matched against supplier invoices) and uses the same CGST / SGST / IGST heads and per-line split as GSTR-3B, instead of the earlier tax / 2 heuristic.
27. **ITC ledger for reversals created before 0.10.1**: purchase-side reversals written before the ITC ledger started recording them have no entry, so the ITC dashboard for those months is gross while GSTR-3B Table 4 is net.

28. **E-invoice supply type (`SupTyp`)** (found in the 0.10.1 filing review; fixed in 0.10.1). `invoice-to-irp.ts` sent `EXPWP` (export with payment) for every inter-state sale and `B2B` only for intra-state ones. The IRP's `SupTyp` values are `B2B`, `SEZWP`, `SEZWOP`, `EXPWP`, `EXPWOP` and `DEXP`, and inter- versus intra-state is expressed by IGST versus CGST + SGST and the place of supply, not by the supply type. Hisaabo has no export, SEZ or deemed-export fields until 0.11.0, so every mapped invoice is now `B2B`. The same review changed three related assumptions: a customer that looks foreign (GSTIN `URP`, or state code 96 set on the customer or read from its GSTIN) is refused instead of filed as a domestic supply ("Exports aren't supported in e-invoicing yet; available in 0.11"); a missing customer or business state code is read from the GSTIN (first two digits) instead of being assumed equal to the seller's (or `"00"` for the business), which had filed an inter-state sale to a customer without a state code as CGST + SGST; and `IgstOnIntra` is documented as `N` because Hisaabo never charges IGST on an intra-state supply. Because the NIC key was invalid until 0.10.1 (item 21), no wrongly typed e-invoice was ever filed live. Still open for 0.11.0: export, SEZ with and without payment, and deemed-export supply types need the buyer category, shipping-bill and port fields; the IRP's place of supply is taken to be the buyer's state, with no separate ship-to or bill-to.

29. **GST return periods tied to the business's accounting year** (found in the 0.10.1 filing review; fixed in 0.10.1). The GST financial year is always April-March; `businesses.financialYearStart` is the accounting year and belongs to the trial balance, P&L, balance sheet and dashboard only. (a) `gst.gstr1Json` derived the GSTR-1 financial-year label from `financialYearStart` (a January-books business labelled Jan-Mar as the following year; a July-books business labelled Apr-Jun as the previous year). The label was never written into the portal JSON (`gstr1ToPortalJson` ignores it and the offline-tool schema has no such key), and `fp` was always right, so no filed document was wrong; it now comes from `lib/gst-period.ts` (April-March) and is returned as `financialYear`. (b) `gst.cmp08` used calendar quarters (Q1 = Jan-Mar); the GST quarters are Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar, so `year` is now the start year of the financial year. Its money was also JS floats (`parseFloat`, `* 0.01`); it is now exact paise. Checked and already April-March: GSTR-9 (`generateGSTR9`), GSTR-1 and GSTR-3B (calendar month), ITC ledger and GSTR-2B (calendar month); no TDS code uses `financialYearStart`. Observed, not changed: the GSTR-1, GSTR-3B and GSTR-2B month windows end at `23:59:59.000`, so a document stamped in the last second of a month after `.000` is in no month; GSTR-9 portal JSON `ret_period` is `"Apr 2025"` (`gstr9ToPortalJson` in `gstr9-generator.ts`), which looks unlike the MMYYYY filing periods the portal uses elsewhere (GSTR-1's `fp` is `"012026"`); the right value for GSTR-9 (probably the last month of the year, `032026`, under an `fp` key) is **UNVERIFIED**: no authoritative source for the GSTR-9 offline-tool JSON schema could be found without a portal login (the public GSTR-9 offline utility manual at tutorial.gst.gov.in does not show the JSON keys, and the field-level schema is only on the developer portal behind sign-in), so it is not changed. Download a system-generated GSTR-9 JSON from the portal and compare its top-level keys and period value before anyone relies on `gst.gstr9Json`. Both items want a CA's eye before 0.11.

30. **E-invoice HSN fallback `9999`** (found in the 0.10.1 filing review; fixed in 0.10.1). `invoice-to-irp.ts` sent `HsnCd = item HSN ?? "9999"`: a made-up code on any line whose item had none. Generation is now refused before the IRP is called and before the invoice changes state, with one message per line, and the code must be 4 to 8 digits and meet the turnover minimum through `validateHsnForTurnover` (4 digits up to and including ₹5 Cr, 6 above, compared exactly in paise; it compared floats). `businesses.annual_turnover` is the input, but nothing in the app sets it, so for almost every business it is unknown and only the 4-digit minimum applies (TODO in `resolveHsn` for 0.11.0). Also corrected: `isValidHsn`'s comment promised "exact match or prefix" while the code is, and stays, an exact match against the curated master list (it is not used on the e-invoice path). Still open for 0.11.0: capture annual turnover; snapshot HSN on invoice lines (today the live item's HSN is used, so editing an item's HSN rewrites history for later e-invoices and the GSTR-1 HSN summary); a typed-in line has no HSN at all; GSTR-1 Table 12 files a missing HSN as `0000` (item 31). The e-way bill mapper sent `hsnCode: ""` for a missing HSN; it now refuses the line with the same per-line message and the same digit / turnover rule as the e-invoice (`lib/hsn-check.ts`, shared by both).

31. **GSTR-1 Table 12 keyed by HSN alone, with no rate and a fixed UQC** (found in the 0.10.1 filing review; fixed in 0.10.1). `generateGSTR1` summed every line of an HSN into one row, so an HSN sold at 5% and 18% had its two rates mixed and no rate to report; the portal JSON (`gstr1ToPortalJson`) filled every `uqc` with `toUqc(null)` (`NOS`) and had no `rt`; the CSV had no HSN section; and the quantity was summed as JS floats. Rows are now keyed by HSN + UQC + GST rate, the JSON carries `rt` and the real `uqc`, the CSV has an HSN section, the quantity is summed in integer thousandths, and the UQC is the unit of the line (the line's `selected_unit`, else the item's unit) through the existing `toUqc` map, which now also covers every unit Hisaabo offers (it missed `g`, `l`, `m`, `cm`, `ft`, `pair`, `pkt`, `bun`, `btl`, `pouch`, `jar`, `in`, `pet`, `person`, `other`, so they all came out as `NOS`). Totals tie to the B2B + B2CS sections and to GSTR-3B 3.1(a) (golden scenario 18). The row key includes the UQC, which goes beyond "HSN and rate": adding kilograms and grams under one row would make the quantity meaningless. Still open for 0.11.0: cess (`csamt` and the CSV Cess column are 0, sales lines have no cess); HSN is read from the live item (no snapshot on the invoice line, so editing an item's HSN rewrites months already filed); a missing HSN used to be filed as `0000` silently; the GSTR-1 JSON export is now refused while any line has none (`assertGstr1JsonExportable`: the message lists the items and typed-in lines to fix), and the report (`hsnMissing`), the CSV (warning, `NO HSN` lines, Flag column), the web GSTR-1 tab and the CLI show them flagged, an HSN that is present but malformed (not 4 to 8 digits) or too short for the turnover (`validateHsnForTurnover`) now blocks the JSON export too, through the same `lib/hsn-check.ts` and wording as the e-invoice (`hsnInvalid`, flagged rows and CSV lines); whether services should carry UQC `NA` instead of the unit of the line is a question for a CA; Table 12 is not netted for credit and debit notes (Table 12's instructions need a CA's reading); whether the portal JSON needs a per-row `val` (total value) key is unconfirmed. 

32. **GST month windows ended at 23:59:59.000 and used the server's time zone** (found in the 0.10.1 filing review; fixed in 0.10.1). `generateGSTR1`, `generateGSTR3B`, GSTR-2B `missingIn2B`, CMP-08 and the dashboard's monthly comparison built a month as `new Date(y, m-1, 1)` to `new Date(y, m, 0, 23, 59, 59)` in the server's time zone with an inclusive upper bound. (a) A document stamped after `23:59:59.000` on the last day was in no month. (b) Worse, the web app sends a date-only date as the browser's local midnight (`dayjs(date).toISOString()`, so "1 April" in India is `2026-03-31T18:30:00Z`), and the shipped images set no `TZ`: on a UTC server every document dated the 1st of a month was filed in the previous month's GSTR-1 and GSTR-3B. The ITC ledger's `return_period`, written when a purchase or a purchase return is created, and the date sent to the IRP (`DocDtls.Dt`; the IRP also takes the document's financial year from it) and the e-way bill (`docDate`) read the date in the server's time zone too. All now use the IST calendar from `lib/gst-period.ts` (fixed UTC+05:30) with half-open windows (`buildBusinessDateFilter` takes a new exclusive `before`), so the result does not depend on the server's `TZ`. Not changed: ITC ledger rows written before 0.10.1 keep their stored period; the accounting reports (trial balance, P&L, balance sheet, `financialYearStart`) still use the server's time zone for their date arithmetic; the party statement, and the Tally export format dates in the server's time zone; the recurring-invoice scheduler's per-month plan limit counts calendar months in the server's time zone. A business whose users work outside India, or who enter dates in another zone, gets IST month boundaries by design (a CA question: is the GST period of a document decided by the date the user typed, which is what the IST convention approximates, or by the time it was recorded?).

33. **Date filters computed in UTC or the viewer's zone** (reported by the founder; fixed in 0.10.1). A document date is a timestamptz that means a calendar day; "This Month" is a window of days; so every surface must use one zone. Hisaabo's is India (IST, fixed UTC+05:30, `@hisaabo/shared` `business-time.ts`): windows are half-open IST midnights `[from, before)`, the API takes `fromDate` / `toDate` with `toDate` the last millisecond before the next period, a picked date is stored as 00:00 IST, a stored instant is read as its IST day. Audit of every date-range path (locations as of 0.10.1 before this change):

    | Where | What it did | |
    |---|---|---|
    | web `hooks/useDateRange.ts:27-64` `getDatePreset` | This Month / Last Month / Last 30 / This FY / Last FY in **UTC** | wrong, fixed |
    | web `hooks/useDateRange.ts:99-104` custom range | browser-local midnight / end of day | wrong for non-IST browsers, fixed |
    | web `lib/fy-bounds.ts:25-39` | FY bounds in UTC | wrong, fixed |
    | web `lib/utils.ts:25-82` `formatDate*`, `formatDateInput`, `todayISODate`, `toISOString*` | dayjs in the browser's zone (every picked date written, every date shown) | wrong for non-IST viewers, fixed |
    | web `components/ui/MonthPeriodBar.tsx:26-29`, `routes/gst.tsx:46,1460`, `itc.tsx:105`, `gstr2b.tsx:664` | default month / FY from the browser clock | wrong, fixed |
    | web `AccountTab.tsx:380-395`, `SalesTargetsTab.tsx:57-86`, `lib/webmcp/tools/dashboard.ts:38-70`, `ImportWizard.tsx:1946`, `DocumentCreator.tsx:132,219`, `routes/index.tsx:448` | browser-local ranges, defaults, a DD/MM/YYYY cell as local midnight, due-date arithmetic, week labels | wrong, fixed |
    | mobile `(home)/index.tsx:29-62` | `Date.UTC` periods | wrong, fixed |
    | mobile `(more)/reports.tsx:27-52`, `settings/account.tsx:87-93`, `(parties)/[id].tsx:73-74,92-93` | phone-local periods and ranges | wrong, fixed |
    | mobile ~20 create / edit screens (`X.toISOString()` of a picker Date), `src/lib/utils.ts:37-71` | stored the picker's instant (time of day, phone zone); showed phone-local days | wrong for non-IST phones, fixed (`business-day.ts`) |
    | CLI `dates.ts:30-34` | default zone = the machine's (day boundaries via `toApiDateTime` were already zone-aware) | wrong default, now IST; `--tz` / `HISAABO_TZ` override |
    | CLI `commands/invoice/list.ts:39-41`, `commands/gst/index.ts:19-22`, `format.ts:46-50` | `new Date()` local month / day | wrong, fixed |
    | API `lib/business-date.ts` `buildBusinessDateFilter` | inclusive `to` only | gained an exclusive `before` (client-supplied instants are used as given, correct once clients send IST windows) |
    | API `routers/reports.ts:59-62` daybook | date-only days parsed in the server's zone | wrong, fixed |
    | API `routers/reports.ts:1283-1290` trial balance default year | server zone | wrong, fixed |
    | API `routers/reports.ts:2093-2095` Tally export file name | UTC date of the instant | wrong, fixed |
    | API `routers/dashboard.ts:35-38`, `:270-290`, `:326-352`, `:873-876` | FY start, FY grouping (`EXTRACT` in the DB zone), month / week buckets (`date_trunc` in the DB zone), monthly comparison | wrong, fixed |
    | API GST windows and ITC return period (`gst-reports.ts`, `gstr2b.ts`, `gst.ts`, `invoice.ts:443`, `itc-reversal-entries.ts:97`) | server zone, `23:59:59` end | fixed in item 32 |
    | API `lib/invoice-pdf.ts:117`, `ledger-pdf.ts:52`, `routers/party.ts:600,666`, `lib/tally-xml-export.ts:47`, `gst-reports.ts:839` | printed dates in the server's zone | wrong (an invoice dated 1 April printed as 31 March on a UTC server), fixed |
    | API `routers/recurringInvoice.ts:344`, `lib/recurring-invoice-scheduler.ts:104` | plan-limit month in the server's zone | wrong, fixed |
    | API `store.ts:430`, `business.ts:424`, `payment.ts`, `expense.ts`, `invoice.ts` lists | client-supplied instants used as given | correct, unchanged |
    | API `reports.ts:233,885`, aging, `computeNextRunDate`, `item.ts:20` | instants, durations, schedule arithmetic | not calendar-day filters, unchanged |

    Open: the time zone is a constant (`BUSINESS_TIME_ZONE`) because `businesses` has no time zone column (TODO for 0.11.0, with its migration); a business outside India gets IST days; dates entered from a browser east of India's zone before this change can be a day off and cannot be repaired automatically.

34. **Recurring-invoice run dates in the server's zone** (follow-up to item 33; fixed in 0.10.1). `computeNextRunDate` advanced the date with `setDate` / `setMonth` in the server's zone. The web app stores a start date as IST midnight (18:30 UTC the evening before), so on a UTC server a monthly template due on the 1st ran 1 Feb, 1 Mar, then 29 Mar, 29 Apr ... (the clamp to a short month moved the day for good), and a template on the 31st stuck on the 28th; the end date cut a run later in the day than its midnight. Run dates are now computed on the IST calendar (day moves, IST time of day kept, month-end clamp), a template created with a future start date counts every later monthly / quarterly / half-yearly / yearly run from its start day (`templateAnchor`: the 31st comes back after a short month), and the end date is a calendar day that still runs. The scheduler's due check (an instant comparison) was already zone-free and is unchanged; a run is generated once and dated the day it runs (catch-up is never back-dated, up to 12 per template per tick). Stored `next_run_date` values are not rewritten (their IST day is the day they were due); a template that had already drifted keeps its stored date and, when anchored, returns to its start day at the following run; UPGRADING has the query to list them. Open: an unanchored template (start date today or earlier) counts from the previous run, so its clamped day sticks (31 Jan, 28 Feb, 28 Mar) and cannot be re-aligned without a stored anchor day (candidate for 0.11.0 together with the business time zone). **Follow-up (review):** the anchor (the start day a monthly / quarterly / yearly template is counted from) was first applied to every template created with `start_date > created_at`, which would have snapped templates written by the old arithmetic (31 Jan -> 3 Mar -> 3 Apr, off their start day) onto a schedule they were never on and moved their next runs: it now applies only when the next run is still exactly on the start day's schedule. Resume recomputed the next run from now, which gave back to the scheduler the occurrences "Run now" had consumed; `recurring_run_occurrence_uniq` then refused them on every tick and the template never advanced: resume keeps a later next run, and a due occurrence that already has a run (and was not advanced by a concurrent runner) is advanced past without billing it again. **CA question:** none; both are scheduling, not tax. The invoices "Run now" generates are dated the day of the click while their `scheduled_for` is the occurrence (a future one), as before.

35. **Four different rules for "is this supply intra-state?"** (found in the 0.10.1 filing review; fixed in 0.10.1). GSTR-1 / GSTR-3B / GSTR-2B / the ITC entries (`isIntraStateSupply`) compared state codes, then state names, then said IGST; `derive-ledger.ts` said "cannot tell: CGST + SGST"; `invoice-pdf.ts` said "cannot tell: IGST"; `invoice-to-irp.ts` took the state from the GSTIN and refused when it had none; `invoice-to-ewb.ts` compared the raw stored codes. A party with a GSTIN and no state on file was therefore IGST in the returns and CGST + SGST in the ledger and the IRP payload for the same invoice; a business in code 37 and a customer on the legacy 28 were "inter-state"; a stored code `50` or `00` was compared like a real state. Now one function (`packages/shared/src/gst-state.ts`): GSTIN state, then stored code, then state name; 28 maps to 37 and 25 to 26 for the comparison (the IRP and NIC still get the code the GSTIN carries); an invalid stored code is ignored; the party and business forms reject codes outside 01-38, 96, 97; the e-invoice and e-way bill refuse a stored code that disagrees with the GSTIN. **UNVERIFIED / CA questions:** (a) a recipient whose state cannot be worked out is treated as intra-state, the supplier's own (section 10(1)(c) and 12(2)(b) of the IGST Act: the supplier's location when the recipient's address is not on record). Before this the returns said IGST for such a sale and the ledger CGST + SGST. Please confirm for a POS walk-in with no address, and whether months already filed with IGST for such sales need amending. (b) We map 28 to 37 for the comparison on the reading that a pre-bifurcation Andhra Pradesh code is the same place of supply as the current one; confirm that a GSTIN still starting 28 (if any are in use) is Andhra Pradesh for place-of-supply purposes. (c) Whether the IRP accepts `Stcd` / `Pos` 28 for such a buyer was not checked against the IRP master; Hisaabo sends the code on the GSTIN unchanged, as before.

36. **GSTR-1 portal JSON could not be filed** (found in the 0.10.1 filing review; fixed in 0.10.1). `gstr1ToPortalJson` wrote every B2B invoice as ONE item with `rt: 0`, every credit / debit note as `rt: 0` with zero tax, B2CL without invoice number, date, value or rate (and an unknown state as pos `99`), B2CS with the supplier's state on every row and INTRA / INTER decided from "CGST > 0", and Table 12 rows without `val`; the UQC maps for GSTR-1, the IRP and the e-way bill were three different maps with codes that are not on the UQC list (feet as `FTS`; `CMT`, `FT`, `INH`, `DZN`, `PAR`, `JAR`, `PKT`, `TNE`; a bunch as `BDL` on the e-way bill). Now rate-wise rows per document (one `itms` entry per rate, summed line by line so B2B + B2CL + B2CS = Table 12), invoice-level B2CL, B2CS by supply type + place of supply + rate, `val` on HSN rows, services `NA` / quantity 0, one shared UQC map. The export is refused, naming the document, for what it still cannot write: notes to unregistered customers, documents whose lines do not add up to their totals, a customer state that is not a GST state. **UNVERIFIED / CA questions:** (a) the `hsn_b2b` / `hsn_b2c` split of Table 12 described by third-party schema notes is NOT implemented: no authoritative schema was available; (b) services with UQC `NA` and quantity 0, and the UQC list, are from the portal's help as remembered and were not re-fetched; (c) whether the portal needs the `gt` / `cur_gt` keys on upload; (d) **the B2CL threshold**: Notification 12/2024-Central Tax lowered the invoice value above which an inter-state supply to an unregistered person is reported invoice-wise (Table 5) from 2.5 lakh to 1 lakh; sources give 1 August or 1 September 2024 and GSTN's advisory of 3 September 2024 said to continue the existing reporting until the portal is updated. Hisaabo's `gstr1` and `gstr3b` (3.2) still use 2.5 lakh. Please confirm the threshold and its effective date for each month of 2024-25 and 2025-26 so it can be made date-dependent; (e) credit / debit notes to unregistered customers: Table 9B (CDNUR) applies to the B2CL kind, the rest are netted in Table 7; whether netting may be negative on the portal is unconfirmed, so those notes are refused in the JSON rather than guessed.

---

## Appendix A: Files Reviewed

| File | Purpose |
|---|---|
| `packages/api/src/lib/gst-reports.ts` | GSTR-1 and GSTR-3B generation engine |
| `packages/api/src/routers/gst.ts` | GST report tRPC endpoints |
| `packages/api/src/routers/invoice.ts` | Invoice CRUD, number generation |
| `packages/api/src/lib/invoice-pdf.ts` | PDF generation (A4, A5, thermal) |
| `packages/api/src/lib/audit.ts` | Audit log helper |
| `packages/api/src/context.ts` | Session validation, auth context |
| `packages/api/src/routers/auth.ts` | Registration, login, magic link, session management |
| `packages/api/src/server.ts` | Hono server, rate limiting, CORS, PDF endpoint |
| `packages/shared/src/money.ts` | Fixed-point monetary arithmetic |
| `packages/shared/src/calc.ts` | Invoice line item and total calculation |
| `packages/shared/src/validators.ts` | Zod schemas, GSTIN/PAN regex validation |
| `packages/db/src/tenant-schema.ts` | Tenant database schema (invoices, parties, audit_log, etc.) |
| `packages/db/src/control-schema.ts` | Control database schema (users, sessions, tenants, invitations) |
| `apps/docs/src/content/docs/gst/` | GST documentation |
| `SECURITY.md` | Security architecture documentation |
| `SECURITY_PENDING.md` | Known unresolved security findings |
| `scripts/backup.sh` | PostgreSQL backup script |

## Appendix B: Regulatory References

| Regulation | Relevance |
|---|---|
| CGST Act 2017, Section 31 | Tax invoice issuance obligation |
| CGST Rules 2017, Rule 46 | Mandatory fields on a tax invoice |
| CGST Rules 2017, Rule 59 | GSTR-1 filing requirements |
| CGST Act 2017, Section 37 | Outward supplies return (GSTR-1) |
| CGST Act 2017, Section 39 | Monthly return (GSTR-3B) |
| CGST Act 2017, Section 170 | Rounding off of tax |
| Digital Personal Data Protection Act 2023 | Personal data handling obligations |
| IT (Reasonable Security Practices) Rules 2011 | Security standards for sensitive personal data |
| Companies Act 2013, Section 128 | Books of accounts retention (minimum 8 years) |
| Income Tax Act 1961 | Financial record retention for tax purposes |
