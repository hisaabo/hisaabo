# TDS (Tax Deducted at Source) Architecture & Payment Workflow

## Overview

This Phase 1 workflow covers customer-deducted TDS on sales receipts (receivable-side TDS). The shared registry contains current numeric tax codes and legacy section identifiers for historical review; it does not establish the applicable rate or legal eligibility for an individual transaction.

When a customer pays an invoice subject to TDS:
1. The customer remits the **net cash amount** to the business seller.
2. The customer retains the **TDS deducted amount** to deposit with the Central Government (income tax department) in the business's PAN/TAN.
3. The customer issues Form 16A (TDS certificate) to the business.
4. The business records the gross settlement of the invoice: the net cash received plus the TDS receivable asset, fully discharging the customer's invoice debt.

---

## 1. Statutory Tax Code Registry & Auto-Seeding

Hisaabo maintains a standard statutory tax code registry defined in `@hisaabo/shared` (`TDS_TAX_CODES`).

### Codes and configuration:
- Current registry entries use numeric codes such as **1023**, **1024**, **1026**, and **1027**. Use the tenant's active list (`tdsSection.list`) to choose a configured code.
- Codes such as **194C** and **194J** are marked legacy and require review; they are not automatically mapped to current codes.
- The current registry source is [Razorpay's tax-code reference](https://razorpay.com/docs/payroll/tax-verifications/tax-codes). Registry labels and effective dates do not determine a transaction's applicable rate.
- The official statutory reference for provisions and applicable rates is the [Income Tax Department (Government of India) TDS Rates](https://wm.incometaxindia.gov.in/w/tds-rates-1).

### Tenant Provisioning & Lazy Seeding:
- When a new tenant is created via `business.create`, all default statutory sections are auto-seeded into `tds_section_configs` with `active: true`.
- `tdsSection.list` is a read-only query: for a business with no section rows yet (created before TDS support, or restored from an older backup) it returns the registry defaults computed in memory, in the same shape and without writing anything. The rows are persisted by `business.create`, by `tdsSection.create`, or by the first payment create/update that records TDS (`seedTdsSections`, idempotent via `onConflictDoNothing`).
- `tdsSection.create` (add a possibly back-dated configuration) requires `manage:Business` (admins), not the payment-entry permission. A duplicate `(business, code, version)` is a `CONFLICT`; `version` is capped at 1000.
- Section validity is evaluated on the **business-local (IST) calendar date** of the receipt, so a receipt dated 1 Apr 2026 passes a section effective from 1 Apr 2026 even though an IST browser sends it as `2026-03-31T18:30:00Z`.
- `tds_section_configs` is part of the self-export/import archive (as are `payment_allocations.tds_*` and `parties.tan`); older backups without them still import.

---

## 2. Payment Allocation Model: Gross Settlement vs Net Cash Received

The payment flow distinguishes between:
- **Gross Settlement (`allocations[i].amount`)**: The total amount credited against the invoice debt.
- **TDS Deducted (`allocations[i].tdsAmount`)**: The tax withheld by the customer under a specific section (`tdsSectionCode`).
- **Net Cash Received (`payment.amount`)**: The actual liquid funds received into the business's bank or cash drawer.

### Mathematical Relationship:
$$\text{Gross Settlement} = \text{Net Cash} + \text{TDS Deducted}$$
$$\text{Net Cash} = \text{Gross Settlement} - \text{TDS Deducted}$$

### Example:
- **Invoice Balance Due**: ₹10,000.00
- **Example deduction amount**: ₹1,000.00 (illustrative only; the application does not determine this rate)
- **Net Cash Received**: ₹9,000.00

**Payload Submitted**:
- `payment.amount`: `"9000.00"` (Net cash deposited)
- `allocations[0].amount`: `"10000.00"` (Gross debt settled)
- `allocations[0].tdsAmount`: `"1000.00"` (Tax withheld)
- `allocations[0].tdsSectionCode`: `"1027"` (example current registry code; tenant configuration must include it)
- `allocations[0].tdsRate`: `"10.0"` (stored client-supplied metadata, not independently validated against statutory rules)

**Invoice Balance**:
$$\text{New Amount Paid} = \text{Previous Amount Paid} + \text{Gross Settlement} = ₹10,000.00$$
$$\text{Remaining Balance} = ₹0.00 \implies \text{Status: "paid"}$$

---

## 3. Double-Entry General Ledger Semantics

A TDS payment records balanced double-entry accounting entries:

| Account | Type | Debit (₹) | Credit (₹) | Note |
|---|---|---|---|---|
| **Bank / Cash Account** | Asset | 9,000.00 | — | Net cash received |
| **TDS Receivable** | Asset | 1,000.00 | — | Tax credit available in Form 26AS / AIS |
| **Accounts Receivable (Party)** | Asset | — | 10,000.00 | Customer invoice balance fully cleared |

Total Debits (₹10,000.00) == Total Credits (₹10,000.00). The ledger is strictly balanced.

**Account 1600.** The derived ledger needs the system **1600 – TDS Receivable** asset account only for a receipt that actually carries TDS. When such a receipt is written, the API makes sure a system, active 1600 exists (creating or reactivating it). If 1600 is a user-created (non-system) account, the receipt is rejected with a clear message and nothing is written; the derived ledger likewise refuses to post TDS into a non-system 1600. The system 1600 can be renamed but not deactivated. The cash-flow statement treats 1600 as a current asset (working capital), not investing.

---

## 4. Settled vs cash across every party-ledger surface

A receipt **settles** `payments.amount + SUM(payment_allocations.tds_amount)`; the single definition lives in `packages/api/src/lib/payment-settlement.ts` (SQL fragment + JS helper) and is used by:
`reports.partyStatement`, `party.ledgerReport` / `ledgerReportCSV` / `ledger`, `party.tallyExport` (the TDS is emitted as a second Receipt leg Dr *TDS Receivable* / Cr party), the ledger PDF statement and its UPI QR (`lib/party-ledger.ts`), and the dashboard's invoiced-vs-collected trend (`salesTrend.collected`; `cashCollected` is reported alongside).
Metrics about money that actually moved (bank balances, cash in hand, payment-mode breakdown, payment summary, bank reconciliation) intentionally stay on net cash; the two are never mixed within one widget.

### Customer statement (`reports.partyStatement`)

In the customer statement of account:
- Invoices increase the customer's balance due (Debits).
- Payments credit the customer's balance due (Credits).
- Because the customer's liability was discharged by both the cash transfer and the statutory tax withholding on behalf of the seller, the total settlement amount credited to the customer is:
  $$\text{Credit} = \text{pmt.amount} + \text{pmt.tdsAmount} = 9,000.00 + 1,000.00 = ₹10,000.00$$
- The statement displays a clear transaction description:
  `Payment received (incl. TDS ₹1,000.00)`
- The customer closing balance correctly reconciles to **₹0.00**, eliminating false outstanding debts.

---

## 5. UI and UX Controls

1. **Party Context Gating**:
   - TDS controls only appear when receiving payments from **Customers**.
   - TDS inputs are hidden and cleared for **Suppliers** (where TDS deduction by us would be TDS Payable, handled during invoice booking).
2. **Pre-fill on the taxable value**:
   - With a single invoice selected and a rate entered, the TDS amount is pre-filled as the allocation's share of the invoice's **taxable value (excluding GST)** × rate (invoice 10,000 + 18% GST, 10% → ₹1,000, not ₹1,180). It is only a suggestion: the user can overwrite it, or press "Use suggested" to restore it.
3. **Multi-Invoice Guard**:
   - If multiple invoices are selected, the web UI blocks TDS with a notice requiring a single invoice per TDS payment, preventing ambiguous deduction assignment. The API itself accepts per-allocation TDS across several invoices.
4. **Edit mode**: the panel always sends `allocations` on edit; `[]` (all invoices unchecked) clears the payment's allocations, whereas omitting the field keeps them. All amounts are normalised to 2-decimal strings before submit.
5. **TAN Integration**:
   - Customer Tax Deduction and Collection Account Number (TAN) is recorded on the party profile (`PartyDetailSlideOver`, `AddPartyModal`, `QuickPartyCreate`).

---

## 6. Validation Rules & Invariants

TDS validation is **bound-only**. For each allocation:
1. `0 < tdsAmount <= grossAmount` (TDS cannot exceed the gross invoice settlement).
2. `tdsAmount > 0` requires `tdsSectionCode` and a `tdsRate` with `0 < rate <= 100` (at most 2 decimals; stored as metadata).
3. `tdsAmount == 0`: section code and rate must be omitted; even a zero rate is rejected as metadata without a deduction.
4. Active section validation: `tdsSectionCode` must exist, be active, and be effective on the (IST) payment date in tenant-scoped `tds_section_configs`.
5. Across the receipt: gross allocations == net cash + TDS exactly, and each allocation respects the invoice's remaining balance.
6. All financial arithmetic uses the `@hisaabo/shared` `money` module with 2-decimal-place rounding.

The recorded rate is **not** cross-checked against `rate × gross`. TDS is commonly deducted on the pre-GST taxable value (invoice ₹10,000 + 18% GST = ₹11,800; 10% TDS on ₹10,000 = ₹1,000), and the amount the customer actually withheld is the source of truth. The application does not determine the legally eligible base, thresholds, exemptions, surcharge, or the applicable statutory rate; do not treat the recorded rate as verified tax advice. Historical payments before a code's configured effective date need an explicitly configured historical section; the application does not guess a legacy mapping or rate.

### Editing a TDS receipt

`payment.update` with `allocations` omitted re-applies the stored allocations; `allocations: []` clears them all. Changing the cash amount of a payment that is split across invoices or carries TDS requires `allocations` (otherwise the new amount would not reconcile with the gross settlement); the API answers with "Allocations are required when changing the payment amount of a payment that is split across invoices or carries TDS. Edit this payment on the web app, where you can re-allocate it."

## 7. Supplier-side TDS scope

Supplier/payable-side TDS is not implemented. TDS on customer receipts debits account **1600 – TDS Receivable**; a supplier deduction would instead create a TDS payable liability and requires separate supplier invoice deductions, settlement and remittance records, and reporting/reconciliation. Do not record supplier deductions through the customer-receipt TDS fields or account 1600.
