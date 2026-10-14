# TDS (Tax Deducted at Source) Architecture & Payment Workflow

## Overview

In Indian B2B commerce, under the Income Tax Act, 1961, customers (buyers) often deduct Tax Deducted at Source (TDS) before paying an invoice (e.g., Section 194C for contractor services, Section 194J for professional/technical fees).

When a customer pays an invoice subject to TDS:
1. The customer remits the **net cash amount** to the business seller.
2. The customer retains the **TDS deducted amount** to deposit with the Central Government (income tax department) in the business's PAN/TAN.
3. The customer issues Form 16A (TDS certificate) to the business.
4. The business records the gross settlement of the invoice: the net cash received plus the TDS receivable asset, fully discharging the customer's invoice debt.

---

## 1. Statutory Tax Code Registry & Auto-Seeding

Hisaabo maintains a standard statutory tax code registry defined in `@hisaabo/shared` (`TDS_TAX_CODES`).

### Statutory Sections Included:
- **194C**: Payments to Contractors / Subcontractors (Individual/HUF: 1%, Company/Firm: 2%)
- **194J(a)**: Fees for Technical Services (2%)
- **194J(b)**: Fees for Professional Services or Royalty (10%)
- **194H**: Commission or Brokerage (5%)
- **194I(a)**: Rent on Plant and Machinery (2%)
- **194I(b)**: Rent on Land, Building, or Furniture (10%)
- **194Q**: Purchase of Goods (0.1%)

### Tenant Provisioning & Lazy Seeding:
- When a new tenant is created via `business.create`, all default statutory sections are auto-seeded into `tds_section_configs` with `active: true`.
- For existing tenants or test fixtures, `tdsSection.list` and `payment.create` employ lazy auto-seeding (`seedTdsSections`) with idempotency (`onConflictDoNothing`), guaranteeing that every tenant has active TDS sections ready in the UI dropdown without manual SQL migrations.

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
- **Customer deducts 10% TDS (194J)**: ₹1,000.00
- **Net Cash Received**: ₹9,000.00

**Payload Submitted**:
- `payment.amount`: `"9000.00"` (Net cash deposited)
- `allocations[0].amount`: `"10000.00"` (Gross debt settled)
- `allocations[0].tdsAmount`: `"1000.00"` (Tax withheld)
- `allocations[0].tdsSectionCode`: `"194J"`
- `allocations[0].tdsRate`: `"10.0"`

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

---

## 4. Customer Statement Accounting (`reports.partyStatement`)

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
2. **Multi-Invoice Guard**:
   - If multiple invoices are selected, TDS input is disabled with a notice requiring single-invoice allocation per TDS payment, preventing ambiguous deduction assignment.
3. **TAN Integration**:
   - Customer Tax Deduction and Collection Account Number (TAN) is recorded on the party profile (`PartyDetailSlideOver`, `AddPartyModal`, `QuickPartyCreate`).

---

## 6. Validation Rules & Invariants

All TDS payments are strictly validated against repository invariants:
1. `money.compare(tdsAmount, "0") > 0` requires `tdsSectionCode` to be present and `tdsRate > 0`.
2. `money.compare(tdsAmount, grossAmount) <= 0`: TDS amount cannot exceed the gross invoice settlement.
3. `money.compare(tdsAmount, "0") === 0`: TDS section code and rate must be omitted or undefined.
4. Active section validation: `tdsSectionCode` must exist and be active in `tds_section_configs` or the statutory registry.
5. All financial arithmetic uses `@hisaabo/shared` `money` module with 2-decimal-place rounding (`money.round2`).
