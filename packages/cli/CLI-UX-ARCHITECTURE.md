# Hisaabo CLI: UX Architecture & Interaction Patterns

## Table of Contents

1. [Global Conventions](#1-global-conventions)
2. [Information Density](#2-information-density)
3. [Interactive Flows](#3-interactive-flows)
4. [Non-Interactive Mode](#4-non-interactive-mode)
5. [Error States](#5-error-states)
6. [Navigation Patterns](#6-navigation-patterns)
7. [Configuration & Auth](#7-configuration--auth)
8. [Implementation Notes](#8-implementation-notes)

---

## 1. Global Conventions

### Command Grammar

Every command follows: `hisaabo <resource> <action> [flags]`

```
hisaabo login
hisaabo dashboard
hisaabo invoice list
hisaabo invoice create
hisaabo invoice get INV-0042
hisaabo invoice pdf INV-0042
hisaabo party list --type customer
hisaabo payment create
hisaabo expense list --from 2026-04-01 --to 2026-06-30
hisaabo gst r1 --quarter Q1
hisaabo report daybook --from 2026-04-01 --to 2026-04-30
```

Resources match the existing tRPC router names exactly: `invoice`, `party`, `item`, `payment`, `expense`, `bank`, `shipment`, `gst`, `report`.

### INR Formatting

All monetary values use the Indian numbering system with the rupee symbol. This matches the existing `formatCurrency` in `packages/shared`:

```
  12,345.00    -- amounts under 1 lakh, no symbol in tables (column header has it)
1,23,456.78    -- lakhs grouping
15,00,000.00   -- standard crore notation
```

Right-align all currency columns. Use the `en-IN` locale for grouping. The column header carries the symbol once:

```
  Amount (₹)
─────────────
  12,345.00
1,23,456.78
```

Negative amounts (credit notes, refunds) use a minus prefix, not parentheses:

```
 -5,000.00
```

### Date Formatting

Match the existing `formatDate` function (en-IN, `dd MMM yyyy`):

```
30 Mar 2026
01 Apr 2025
```

For relative dates in status contexts (overdue by, due in):

```
Due in 3 days
Overdue by 12 days
Due today
```

### Status Indicators

Terminal-safe Unicode characters with ANSI colors. These map directly to the `invoiceStatusEnum` and the existing `STATUS_CONFIG` in the mobile app:

```
Status      Symbol   Color (ANSI)        Code
──────────────────────────────────────────────
paid        [PAID]    green  (32)        \x1b[32m
sent        [SENT]    blue   (34)        \x1b[34m
draft       [DRAFT]   dim    (2)         \x1b[2m
partial     [PARTIAL] yellow (33)        \x1b[33m
overdue     [OVERDUE] red    (31)        \x1b[31m
cancelled   [CANCEL]  dim    (2;9)       \x1b[2;9m  (dim + strikethrough)
unfulfilled [UNFUL]   blue   (34)        \x1b[34m
pending     [PEND]    yellow (33)        \x1b[33m
confirmed   [CONF]    blue   (34)        \x1b[34m
delivered   [DELIV]   green  (32)        \x1b[32m
```

When `--no-color` is set or `NO_COLOR` env var is present, strip all ANSI codes and use text-only badges:

```
[PAID]   [OVERDUE]   [DRAFT]   [PARTIAL]
```

### Terminal Width Awareness

Detect terminal width via `process.stdout.columns` (default 80). Three layout tiers:

- **Narrow (< 80)**: Compact single-line per record, truncate party names to 15 chars
- **Standard (80-120)**: Full table with all relevant columns
- **Wide (> 120)**: Add extra columns (notes, created by, etc.)

---

## 2. Information Density

### 2.1 Invoice List

The most-used screen. Optimized for scanning 50+ invoices quickly.

**Standard width (80-120 cols):**

```
 Sale Invoices                                              FY 2025-26
 ══════════════════════════════════════════════════════════════════════

  #           Party            Date          Amount (₹)    Status
 ─────────────────────────────────────────────────────────────────────
  INV-0042    Sharma Traders   30 Mar 2026    15,400.00    [PAID]
  INV-0041    Patel & Sons     28 Mar 2026    1,23,000.00  [PARTIAL]
  INV-0040    Gupta Retail     27 Mar 2026       800.00    [OVERDUE]
  INV-0039    ABC Wholesale    25 Mar 2026    45,200.00    [SENT]
  INV-0038    Kumar Stores     24 Mar 2026     2,500.00    [DRAFT]
 ─────────────────────────────────────────────────────────────────────
  Showing 1-20 of 156           Total: 8,45,900.00

  [n] Next page  [p] Previous  [/] Search  [q] Quit
```

**Narrow width (< 80 cols):**

```
 INV-0042  Sharma Traders     15,400.00  [PAID]
 INV-0041  Patel & Sons     1,23,000.00  [PARTIAL]
 INV-0040  Gupta Retail          800.00  [OVERDUE]
```

**Wide width (> 120 cols) adds columns:**

```
  #           Party            Date          Due           Amount (₹)    Paid (₹)     Balance (₹)   Status
 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  INV-0042    Sharma Traders   30 Mar 2026   14 Apr 2026    15,400.00    15,400.00          0.00    [PAID]
  INV-0041    Patel & Sons     28 Mar 2026   12 Apr 2026   1,23,000.00   50,000.00     73,000.00    [PARTIAL]
```

### 2.2 Invoice Detail View

When a user runs `hisaabo invoice get INV-0042`:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  SALE INVOICE  INV-0042                           [PAID]        │
 ├─────────────────────────────────────────────────────────────────┤
 │  Party:    Sharma Traders (Customer)                            │
 │  Date:     30 Mar 2026                                          │
 │  Due:      14 Apr 2026                                          │
 │  Created:  Saurabh (30 Mar 2026, 10:32 AM)                     │
 │  Delivery: Hand Delivery                                        │
 ├─────────────────────────────────────────────────────────────────┤
 │                                                                  │
 │   #  Item               Qty   Rate (₹)    Tax%   Amount (₹)    │
 │  ── ─────────────────── ───── ────────── ────── ────────────    │
 │   1  Basmati Rice 5kg   10    1,200.00    5%      12,600.00    │
 │   2  Toor Dal 1kg        5      180.00   12%       1,008.00    │
 │   3  Packing Charges     1      200.00    0%         200.00    │
 │                                                                  │
 ├─────────────────────────────────────────────────────────────────┤
 │  Subtotal:             13,808.00                                │
 │  Tax:                   1,608.00                                │
 │  Additional Charges:      200.00  (Delivery)                    │
 │  Discount:               -216.00                                │
 │  Round Off:                 0.22                                │
 │  ─────────────────────────────────                              │
 │  Total:                15,400.00                                │
 │  Paid:                 15,400.00                                │
 │  Balance:                   0.00                                │
 ├─────────────────────────────────────────────────────────────────┤
 │  Notes: Deliver before Holi                                     │
 │  Terms: Payment within 15 days of invoice date                  │
 └─────────────────────────────────────────────────────────────────┘

 Actions: [e] Edit  [p] PDF  [s] Share  [d] Duplicate  [pay] Record Payment
```

### 2.3 Dashboard Summary

`hisaabo dashboard`:

```
 Hisaabo Dashboard                     Sharma Trading Co.
 FY 2025-26 (01 Apr 2025 - 31 Mar 2026)
 ═══════════════════════════════════════════════════════════

 ┌─ Revenue ───────────┐  ┌─ Expenses ──────────┐
 │  Sales    18,45,000  │  │  Purchases 8,20,000 │
 │  Cash In  15,30,000  │  │  Expenses  2,15,000 │
 │                      │  │  Cash Out  9,80,000  │
 └──────────────────────┘  └─────────────────────┘

 ┌─ Outstanding ────────────────────────────────────┐
 │  Receivable    3,15,000   from 12 parties        │
 │  Payable       1,40,000   to 5 parties           │
 │  Net Position  1,75,000   receivable              │
 └──────────────────────────────────────────────────┘

 ┌─ Recent Invoices ───────────────────────────────────────┐
 │  INV-0042  Sharma Traders   15,400.00  [PAID]    Today  │
 │  INV-0041  Patel & Sons   1,23,000.00  [PARTIAL] 2d ago │
 │  INV-0040  Gupta Retail       800.00   [OVERDUE] 3d ago │
 │  INV-0039  ABC Wholesale   45,200.00   [SENT]    5d ago │
 │  INV-0038  Kumar Stores     2,500.00   [DRAFT]   6d ago │
 └─────────────────────────────────────────────────────────┘

 Low Stock Alerts: Basmati Rice 5kg (2 left), Toor Dal 1kg (5 left)
```

### 2.4 Party List

`hisaabo party list --type customer`:

```
 Customers                                           12 total
 ════════════════════════════════════════════════════════════════

  Name               Phone          Balance (₹)   Invoices  Category
 ──────────────────────────────────────────────────────────────────────
  Sharma Traders     +91 98765xxxxx   45,200.00    23        Retail
  Patel & Sons       +91 87654xxxxx   73,000.00    18        Wholesale
  Gupta Retail       +91 76543xxxxx      800.00     4        Retail
  ABC Wholesale      +91 65432xxxxx        0.00    31        Wholesale

 Sort: [n] Name  [b] Balance  [i] Invoice count  [q] Quit
```

### 2.5 Item List

`hisaabo item list`:

```
 Items                                                45 total
 ═══════════════════════════════════════════════════════════════

  Name              HSN       Unit    Sale (₹)   Stock   Tax%
 ─────────────────────────────────────────────────────────────
  Basmati Rice 5kg  10063010  pcs     1,200.00    2 !     5%
  Toor Dal 1kg      07139090  kg        180.00    5      12%
  Packing Box       48191000  pcs        50.00   200      0%
  Courier Service   996812    -         250.00    -      18%

 ! = below low stock alert threshold
```

### 2.6 GST Reports

`hisaabo gst r1 --quarter Q4`:

```
 GSTR-1 Summary                            Q4 FY 2025-26
 Jan 2026 - Mar 2026                    GSTIN: 07AAACR5055K1Z5
 ═════════════════════════════════════════════════════════════

 B2B Invoices (> ₹2,50,000)
 ──────────────────────────────────────────────────────────────
  Invoice     Party GSTIN        Taxable (₹)    Tax (₹)
  INV-0035    07AAACR5055K1Z5    3,50,000.00    63,000.00
  INV-0029    27AABCU9603R1ZM    2,80,000.00    50,400.00

 B2C (Small) Summary
 ──────────────────────────────────────────────────────────────
  Rate     Taxable (₹)     CGST (₹)     SGST (₹)
   5%      4,50,000.00    11,250.00    11,250.00
  12%      2,80,000.00    16,800.00    16,800.00
  18%        95,000.00     8,550.00     8,550.00

 Totals
 ──────────────────────────────────────────────────────────────
  Total Taxable:    14,55,000.00
  Total Tax:         1,61,550.00
  Total Invoices:    42
```

---

## 3. Interactive Flows

### 3.1 First-Time Login

```
$ hisaabo login

  Hisaabo CLI
  ───────────

  Server URL [http://localhost:3000]: https://billing.mycompany.in
  Email: saurabh@example.com
  Password: ••••••••

  Authenticating... done

  You have access to 2 businesses:

   #  Business              GSTIN               Role
  ── ────────────────────── ─────────────────── ──────
   1  Sharma Trading Co.    07AAACR5055K1Z5     owner
   2  Kumar Enterprises     27AABCU9603R1ZM     admin

  Select business [1]: 1

  Active business: Sharma Trading Co.
  Config saved to ~/.config/hisaabo/config.json

  You can switch businesses anytime with:
    hisaabo business switch
```

### 3.2 Invoice Creation (Interactive)

`hisaabo invoice create`:

The flow mirrors the web `InvoiceCreator.tsx` but linearized for terminal. Each step can be skipped or pre-filled via flags.

```
$ hisaabo invoice create

  New Sale Invoice
  ────────────────

  Type (sale/purchase) [sale]: sale

  Select Party:
  > Search: sha█
    1  Sharma Traders     +91 98765xxxxx   Customer
    2  Shankar & Co.      +91 87654xxxxx   Customer

  Party [1]: 1
  Party: Sharma Traders

  Add Line Items (empty description to finish):

  Item 1:
    Search item: bas█
      1  Basmati Rice 5kg   ₹1,200.00/pcs   Stock: 2
      2  Basmati Rice 1kg     ₹280.00/pcs    Stock: 15
    Item [1]: 1
    Quantity [1]: 10
    Unit Price [1200.00]: 1200
    Tax % [5]: 5
    Discount % [0]:
    > Basmati Rice 5kg  x10  @1,200.00  5% tax  = 12,600.00

  Item 2:
    Search item: toor█
      1  Toor Dal 1kg   ₹180.00/kg   Stock: 5
    Item [1]: 1
    Quantity [1]: 5
    Unit Price [180.00]:
    Tax % [12]:
    Discount % [0]:
    > Toor Dal 1kg  x5  @180.00  12% tax  = 1,008.00

  Item 3:
    Description:      (empty, done adding items)

  ─── Invoice Summary ───────────────────────────
  Subtotal:          13,608.00
  Tax:                1,608.00
  Additional Charges [0]:
  Discount [0]:
  Round Off [auto]: 0.22

  Total:             15,216.22

  Invoice Date [30 Mar 2026]:
  Due Date [14 Apr 2026]:
  Delivery Method [self_pickup]: hand_delivery
  Notes:
  Terms:
  ───────────────────────────────────────────────

  Create this invoice? (y/n) [y]: y

  Created: INV-0042 for ₹15,216.22
  View:    hisaabo invoice get INV-0042
  PDF:     hisaabo invoice pdf INV-0042
```

**Shortcut for power users** -- supply everything via flags:

```
$ hisaabo invoice create \
    --party "Sharma Traders" \
    --item "Basmati Rice 5kg" --qty 10 --rate 1200 \
    --item "Toor Dal 1kg" --qty 5 \
    --delivery hand_delivery \
    --yes
```

### 3.3 Payment Recording (Interactive)

`hisaabo payment create`:

```
$ hisaabo payment create

  Record Payment
  ──────────────

  Select Party:
  > Search: pat█
    1  Patel & Sons   Balance: ₹73,000.00 receivable

  Party [1]: 1

  Unpaid Invoices for Patel & Sons:
   #  Invoice     Date          Total (₹)    Paid (₹)     Due (₹)      Status
  ── ────────── ────────────── ─────────── ─────────── ─────────── ──────────
   1  INV-0041   28 Mar 2026   1,23,000.00  50,000.00   73,000.00  [PARTIAL]
   2  INV-0036   15 Mar 2026     25,000.00       0.00   25,000.00  [SENT]

  Allocate to specific invoices? (y/n) [y]: y

  INV-0041 - Due: ₹73,000.00
    Amount to allocate [73000.00]: 50000

  INV-0036 - Due: ₹25,000.00
    Amount to allocate [25000.00]: 25000

  Total Payment: 75,000.00

  Payment Mode (cash/bank/upi/cheque/other) [upi]: upi
  Reference Number: TXN123456
  Bank Account [HDFC Current]: 1
  Payment Date [30 Mar 2026]:
  Notes:

  Record this payment? (y/n) [y]: y

  Recorded: PAY-0089 for ₹75,000.00
  Allocated: INV-0041 (₹50,000.00), INV-0036 (₹25,000.00)
  Patel & Sons new balance: ₹23,000.00 receivable
```

### 3.4 Quick Operations (No Wizard Needed)

Some operations should be instant, no wizard:

```
# Mark invoice as sent
$ hisaabo invoice status INV-0042 sent
  INV-0042 status updated: draft -> [SENT]

# Download PDF
$ hisaabo invoice pdf INV-0042
  Saved: INV-0042.pdf (45 KB)

$ hisaabo invoice pdf INV-0042 --output ~/Desktop/
  Saved: ~/Desktop/INV-0042.pdf (45 KB)

# Quick expense entry
$ hisaabo expense create --amount 500 --category "Office Supplies" --mode cash
  Created: Expense #45 - Office Supplies ₹500.00

# Switch business
$ hisaabo business switch
  1  Sharma Trading Co.    [active]
  2  Kumar Enterprises
  Select [2]: 2
  Switched to: Kumar Enterprises
```

### 3.5 Search and Filtering

Consistent filtering grammar across all resources:

```
# Date ranges
$ hisaabo invoice list --from 2026-01-01 --to 2026-03-31
$ hisaabo invoice list --this-month
$ hisaabo invoice list --this-quarter
$ hisaabo invoice list --this-fy

# Status filtering
$ hisaabo invoice list --status overdue
$ hisaabo invoice list --status overdue,partial

# Party filtering
$ hisaabo invoice list --party "Sharma Traders"
$ hisaabo invoice list --party-id 550e8400-e29b-41d4-a716-446655440000

# Type filtering
$ hisaabo invoice list --type sale
$ hisaabo party list --type customer

# Combined
$ hisaabo invoice list --type sale --status overdue --this-month

# Full text search
$ hisaabo party search "sharma"
$ hisaabo item search "basmati"
```

---

## 4. Non-Interactive Mode

### 4.1 JSON Output

Every command supports `--json` for machine-readable output:

```
$ hisaabo invoice list --status overdue --json
```

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "invoiceNumber": "INV-0040",
      "party": {
        "id": "...",
        "name": "Gupta Retail"
      },
      "type": "sale",
      "status": "overdue",
      "invoiceDate": "2026-03-27T00:00:00.000Z",
      "dueDate": "2026-03-30T00:00:00.000Z",
      "totalAmount": "800.00",
      "amountPaid": "0.00",
      "balance": "800.00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "hasMore": false
  }
}
```

### 4.2 Piping Patterns

TSV output for piping to standard Unix tools:

```
# Pipe to awk for custom calculations
$ hisaabo invoice list --status overdue --format tsv | awk -F'\t' '{sum += $5} END {print sum}'

# Pipe to grep
$ hisaabo party list --format tsv | grep "Wholesale"

# Feed into another command
$ hisaabo invoice list --status draft --format ids | xargs -I{} hisaabo invoice status {} sent

# CSV export
$ hisaabo invoice list --this-fy --format csv > invoices-fy2526.csv
```

Output formats:

| Flag | Format | Use Case |
|------|--------|----------|
| (default) | Pretty table | Human reading |
| `--json` | JSON | Scripts, jq |
| `--format tsv` | Tab-separated | Unix pipes, awk |
| `--format csv` | CSV with headers | Spreadsheet import |
| `--format ids` | One ID per line | xargs, loops |
| `--quiet` / `-q` | Suppress all output except errors | Cron jobs |

### 4.3 Exit Codes

```
0    Success
1    General error (unexpected)
2    Usage error (bad arguments, missing required flags)
3    Authentication error (not logged in, expired token)
4    Authorization error (insufficient permissions)
5    Not found (resource doesn't exist)
6    Validation error (business logic violation)
7    Network error (API unreachable)
8    Conflict (duplicate invoice number, concurrent edit)
```

Script example:

```bash
#!/bin/bash
# Daily overdue reminder script (cron: 0 9 * * *)

overdue=$(hisaabo invoice list --status overdue --json 2>/dev/null)
exit_code=$?

if [ $exit_code -eq 3 ]; then
  echo "Auth expired, re-login needed" >&2
  exit 1
fi

if [ $exit_code -eq 7 ]; then
  echo "API unreachable" >&2
  exit 1
fi

count=$(echo "$overdue" | jq '.pagination.total')
total=$(echo "$overdue" | jq '[.data[].balance | tonumber] | add')

if [ "$count" -gt 0 ]; then
  echo "ALERT: $count overdue invoices totaling INR $total"
  echo "$overdue" | jq -r '.data[] | "\(.invoiceNumber) - \(.party.name) - INR \(.balance)"'
fi
```

### 4.4 Idempotent Operations

For scripting safety, create operations accept `--idempotency-key`:

```
# Safe to retry -- won't create duplicate invoices
$ hisaabo invoice create --idempotency-key "daily-sharma-2026-03-30" \
    --party "Sharma Traders" \
    --item "Basmati Rice 5kg" --qty 10 \
    --yes

# First run:  Created: INV-0043
# Second run: Already exists: INV-0043 (idempotency key match)
```

### 4.5 Batch Operations

```
# Bulk status update
$ hisaabo invoice status --from-status draft --to-status sent --this-week
  Updated 8 invoices: draft -> sent

# Import from CSV (matches existing import router)
$ hisaabo import parties --file customers.csv --dry-run
  Parsed 45 records: 40 new, 3 duplicates (will skip), 2 errors
  Run without --dry-run to import.

$ hisaabo import parties --file customers.csv
  Imported 40 parties, skipped 3 duplicates, 2 errors (see import-errors.log)
```

---

## 5. Error States

### 5.1 Validation Errors

Field-level errors with the exact field name (matching Zod validator paths from `packages/shared`):

```
$ hisaabo party create --name "" --phone "abc"

  Error: Validation failed (2 errors)

    name      String must contain at least 1 character(s)
    phone     Invalid phone number format

  Run with --help for field requirements.
```

For interactive mode, validate inline and re-prompt:

```
  Name: █
  Error: Name is required. Try again.
  Name: █
```

### 5.2 Network Errors

```
$ hisaabo dashboard

  Error: Cannot reach Hisaabo API at https://billing.mycompany.in

  Possible causes:
    - Server is not running (try: docker compose up -d)
    - Network is unreachable
    - URL is wrong (check: hisaabo config show)

  Last successful connection: 30 Mar 2026, 09:15 AM
```

### 5.3 Authentication Errors

```
$ hisaabo invoice list

  Error: Session expired

  Run 'hisaabo login' to re-authenticate.
  Your business selection will be preserved.
```

Token refresh happens silently. Only show auth errors when refresh also fails.

### 5.4 Business Logic Errors

Map these to user-understandable messages:

```
# Insufficient stock
$ hisaabo invoice create --party "Sharma" --item "Basmati Rice 5kg" --qty 100 --yes

  Error: Insufficient stock for Basmati Rice 5kg

    Available: 2 pcs
    Requested: 100 pcs

  Use --skip-stock-check to override (for back-orders).

# Duplicate invoice number
$ hisaabo invoice create ...

  Error: Invoice number INV-0042 already exists

  The server auto-assigns the next number. If you need to reset:
    hisaabo business sequence invoice 100

# Credit limit exceeded
$ hisaabo invoice create --party "Kumar Stores" ...

  Warning: This invoice will exceed Kumar Stores' credit limit.

    Credit Limit:    50,000.00
    Current Balance: 48,000.00
    This Invoice:     5,000.00
    New Balance:     53,000.00

  Proceed anyway? (y/n) [n]:
```

### 5.5 Error Output Convention

Errors always go to stderr, never stdout. This keeps piping clean:

```
# stdout has the data, stderr has the error
$ hisaabo invoice list --json 2>errors.log | jq '.data | length'
```

Error format in `--json` mode:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": {
      "name": "String must contain at least 1 character(s)",
      "phone": "Invalid phone number format"
    }
  }
}
```

---

## 6. Navigation Patterns

### 6.1 Help Structure

Three levels of help, matching how users actually ask for help:

**Level 1: Overview** (`hisaabo --help`):

```
Hisaabo CLI - Self-hosted invoicing for Indian businesses

Usage: hisaabo <command> [options]

Commands:
  login              Authenticate with your Hisaabo server
  dashboard          View business summary and key metrics
  business           Manage businesses and settings

  invoice            Create, list, and manage invoices
  party              Manage customers and suppliers
  item               Manage products and services
  payment            Record and track payments
  expense            Track business expenses

  bank               Manage bank accounts and transactions
  shipment           Track deliveries and shipments
  gst                GST returns and compliance
  report             Financial reports (daybook, outstanding, P&L, etc.)
  import             Import data from CSV or other apps

  config             View and edit CLI configuration

Run 'hisaabo <command> --help' for details on a specific command.
Run 'hisaabo <command> <subcommand> --help' for subcommand details.

Examples:
  hisaabo invoice list --this-month --status overdue
  hisaabo invoice create --party "Sharma Traders" --item "Rice" --qty 10
  hisaabo dashboard
  hisaabo gst r1 --quarter Q4
```

**Level 2: Command help** (`hisaabo invoice --help`):

```
hisaabo invoice - Manage invoices

Usage: hisaabo invoice <subcommand> [options]

Subcommands:
  list               List invoices with filters
  get <number>       View invoice details
  create             Create a new invoice (interactive or flags)
  edit <number>      Edit a draft invoice
  status <number>    Update invoice status
  pdf <number>       Download invoice PDF
  delete <number>    Delete a draft invoice
  duplicate <number> Create a copy of an invoice

Common Flags:
  --type <sale|purchase>     Filter by invoice type
  --status <status>          Filter by status
  --party <name>             Filter by party name
  --from <YYYY-MM-DD>        Start date
  --to <YYYY-MM-DD>          End date
  --this-month               Current month shortcut
  --this-quarter             Current quarter shortcut
  --this-fy                  Current financial year shortcut
  --json                     Output as JSON
  --format <tsv|csv|ids>     Alternative output formats
  --no-color                 Disable colored output

Examples:
  hisaabo invoice list --type sale --this-month
  hisaabo invoice get INV-0042
  hisaabo invoice create --party "Sharma" --item "Rice" --qty 10 --yes
  hisaabo invoice pdf INV-0042 --output ~/invoices/
  hisaabo invoice status INV-0042 paid
  hisaabo invoice list --status overdue --json | jq '.data[].party.name'
```

**Level 3: Subcommand help** (`hisaabo invoice create --help`):

```
hisaabo invoice create - Create a new invoice

Usage: hisaabo invoice create [options]

Without flags, starts an interactive wizard.
With flags, creates directly (use --yes to skip confirmation).

Options:
  --type <sale|purchase>     Invoice type (default: sale)
  --party <name|id>          Party name (fuzzy match) or UUID
  --item <name> --qty <n>    Add a line item (repeatable)
    --rate <amount>            Override item sale price
    --tax <percent>            Override tax percentage
    --discount <percent>       Line item discount
  --date <YYYY-MM-DD>        Invoice date (default: today)
  --due <YYYY-MM-DD>         Due date (default: party credit period)
  --delivery <method>        self_pickup|hand_delivery|courier|bus|transport|post
  --notes <text>             Invoice notes
  --terms <text>             Terms and conditions
  --additional-charges <n>   Additional charges amount
  --invoice-discount <n>     Invoice-level discount
  --invoice-discount-type    amount|percent (default: amount)
  --skip-stock-check         Allow negative stock
  --yes                      Skip confirmation prompt
  --idempotency-key <key>    Prevent duplicate creation on retry
  --json                     Output created invoice as JSON

Examples:
  # Interactive wizard
  hisaabo invoice create

  # Quick sale
  hisaabo invoice create --party "Sharma" --item "Rice" --qty 10 --yes

  # Multiple items
  hisaabo invoice create \
    --party "Patel & Sons" \
    --item "Basmati Rice 5kg" --qty 10 --rate 1200 \
    --item "Toor Dal 1kg" --qty 5 \
    --delivery hand_delivery \
    --notes "Deliver before Holi" \
    --yes

  # Scripted with JSON output
  hisaabo invoice create --party "Sharma" --item "Rice" --qty 10 --yes --json
```

### 6.2 Command Discovery

**Fuzzy matching on typos:**

```
$ hisaabo invioce list

  Unknown command: invioce

  Did you mean?
    invoice     Manage invoices

  Run 'hisaabo --help' for all commands.
```

**Contextual suggestions after actions:**

```
$ hisaabo invoice create ... --yes

  Created: INV-0043 for ₹15,216.22

  Next steps:
    hisaabo invoice get INV-0043      View details
    hisaabo invoice pdf INV-0043      Download PDF
    hisaabo invoice status INV-0043 sent    Mark as sent
    hisaabo payment create            Record a payment
```

**Shortest unique prefix (for power users):**

```
$ hisaabo inv list          # matches 'invoice'
$ hisaabo pay create        # matches 'payment'
$ hisaabo dash              # matches 'dashboard'
$ hisaabo exp list          # matches 'expense'
```

### 6.3 Shell Completions

Provide installable completions for bash, zsh, and fish:

```
$ hisaabo completion bash >> ~/.bashrc
$ hisaabo completion zsh >> ~/.zshrc
$ hisaabo completion fish > ~/.config/fish/completions/hisaabo.fish
```

Completions cover:

- Commands and subcommands
- Flag names and their allowed values (statuses, types, modes)
- Party names (cached locally, refreshed on `hisaabo party list`)
- Item names (cached locally)
- Invoice numbers (recent, cached)
- Bank account names

Cache location: `~/.cache/hisaabo/completions.json`, refreshed every 5 minutes or on explicit list commands.

### 6.4 Recent Command Context

```
$ hisaabo invoice list --type sale --this-month --status overdue

  ... (results) ...

$ hisaabo invoice list --repeat
  (re-runs the previous invoice list command with same filters)

$ hisaabo invoice list --last
  (shows what filters were used last time)
  Last: --type sale --this-month --status overdue (30 Mar 2026, 10:45 AM)
```

---

## 7. Configuration & Auth

### 7.1 Config File

Location: `~/.config/hisaabo/config.json`

```json
{
  "server": "https://billing.mycompany.in",
  "session": {
    "id": "...",
    "expiresAt": "2026-04-29T10:32:00.000Z"
  },
  "activeBusinessId": "550e8400-e29b-41d4-a716-446655440000",
  "activeBusiness": "Sharma Trading Co.",
  "defaults": {
    "invoiceType": "sale",
    "deliveryMethod": "hand_delivery",
    "pageSize": 20
  },
  "display": {
    "color": true,
    "dateFormat": "en-IN",
    "compactMode": false
  }
}
```

### 7.2 Config Commands

```
$ hisaabo config show
  Server:    https://billing.mycompany.in
  Business:  Sharma Trading Co. (07AAACR5055K1Z5)
  User:      saurabh@example.com
  Session:   Valid until 29 Apr 2026
  Defaults:  invoice type=sale, delivery=hand_delivery, page=20

$ hisaabo config set defaults.pageSize 50
  Updated: defaults.pageSize = 50

$ hisaabo config set display.color false
  Updated: display.color = false
```

### 7.3 Environment Variable Overrides

Every config value can be overridden via env var (useful for CI/CD):

```
HISAABO_SERVER=https://billing.mycompany.in
HISAABO_SESSION_ID=...
HISAABO_BUSINESS_ID=...
HISAABO_NO_COLOR=1
HISAABO_FORMAT=json
```

Priority: CLI flags > env vars > config file > defaults.

---

## 8. Implementation Notes

### 8.1 Recommended Libraries

| Concern | Library | Why |
|---------|---------|-----|
| CLI framework | `@oclif/core` or `commander` + `inquirer` | oclif for plugin architecture, commander+inquirer for simpler setup |
| Table rendering | `cli-table3` | Handles Unicode box drawing, column alignment, width truncation |
| Colors | `chalk` | Respects `NO_COLOR`, supports 256-color detection |
| Spinners | `ora` | Non-blocking progress for API calls |
| Prompts | `@inquirer/prompts` | Modern, composable, supports autocomplete |
| JSON output | Built-in `JSON.stringify` | No dependency needed |
| HTTP client | `ofetch` or `ky` | Small, handles retries, timeout |
| Fuzzy search | `fuse.js` | For party/item name matching in interactive mode |
| Keychain | `keytar` | Secure session storage on macOS/Linux |

### 8.2 Package Structure

```
apps/cli/
  package.json                 # @hisaabo/cli
  src/
    index.ts                   # Entry point, CLI parser setup
    commands/
      login.ts
      dashboard.ts
      invoice/
        list.ts
        get.ts
        create.ts
        status.ts
        pdf.ts
      party/
        list.ts
        get.ts
        create.ts
      item/
        list.ts
        create.ts
      payment/
        list.ts
        create.ts
      expense/
        list.ts
        create.ts
      bank/
        list.ts
        create.ts
        transfer.ts
      gst/
        r1.ts
        r3b.ts
      report/
        daybook.ts
        outstanding.ts
        pnl.ts
        tax-summary.ts
      shipment/
        list.ts
        track.ts
      import.ts
      config.ts
      business/
        list.ts
        switch.ts
      completion.ts
    lib/
      api.ts                   # HTTP client, auth header injection, business ID header
      config.ts                # Read/write ~/.config/hisaabo/config.json
      format.ts                # INR formatting, date formatting, status badges
      table.ts                 # Table rendering with width detection
      prompt.ts                # Interactive prompts, party/item search
      errors.ts                # Error classification and display
      cache.ts                 # Completion cache, party/item name cache
    types.ts                   # CLI-specific types (extends @hisaabo/shared)
  bin/
    hisaabo                    # Shebang entry: #!/usr/bin/env node
  tsconfig.json
  tsup.config.ts               # Bundle for distribution
```

### 8.3 API Communication

The CLI talks to the same Hono+tRPC API as the web app. Two options:

**Option A: Direct tRPC client** (recommended -- get full type safety):

```typescript
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@hisaabo/api";
import SuperJSON from "superjson";

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${config.server}/api/trpc`,
      headers: () => ({
        cookie: `session_id=${config.session.id}`,
        "x-business-id": config.activeBusinessId,
      }),
      transformer: SuperJSON,
    }),
  ],
});

// Fully typed:
const invoices = await trpc.invoice.list.query({
  type: "sale",
  status: "overdue",
  page: 1,
  limit: 20,
});
```

**Option B: REST-like HTTP** (for simpler build, but loses type safety):

```typescript
const response = await fetch(`${config.server}/api/trpc/invoice.list`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: `session_id=${config.session.id}`,
    "x-business-id": config.activeBusinessId,
  },
  body: JSON.stringify({ json: { type: "sale", status: "overdue" } }),
});
```

Option A is strongly preferred since the existing monorepo already has `@hisaabo/api` available as a devDependency for type imports.

### 8.4 Auth Flow

The API uses session cookies (HttpOnly, 30-day expiry). The CLI stores the session ID in the config file (or system keychain if `keytar` is available):

```typescript
// Login: call auth.login, extract session_id from Set-Cookie header
const response = await fetch(`${server}/api/trpc/auth.login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ json: { email, password } }),
});

const setCookie = response.headers.get("set-cookie");
const sessionId = parseCookie(setCookie, "session_id");

// Store in config
await saveConfig({ session: { id: sessionId, expiresAt: "..." } });
```

### 8.5 Performance Budget

For a user billing 50 invoices a day, every millisecond counts:

| Operation | Target | How |
|-----------|--------|-----|
| CLI startup | < 200ms | Lazy-load commands, minimal top-level imports |
| Invoice list | < 500ms | Single tRPC batch call, stream table rows |
| Invoice create (flags) | < 800ms | Single mutation call |
| Dashboard | < 1s | Single batch call (matches existing Promise.all in dashboard router) |
| PDF download | < 2s | Stream to file, show progress bar |
| Completion load | < 100ms | Read from local cache file |

### 8.6 Offline Considerations

The CLI requires network access (it talks to the API). But provide graceful degradation:

- Cache the last dashboard response for `hisaabo dashboard --cached`
- Cache party and item lists for completion (5 min TTL)
- Queue operations for later with `hisaabo invoice create ... --queue` (writes to `~/.local/share/hisaabo/queue.json`, flushed on `hisaabo sync`)

### 8.7 Document Type Support

The CLI should support all 8 document types from the schema, using the existing `document-router-factory.ts` endpoints:

```
hisaabo invoice list                    # type=invoice (default)
hisaabo quotation list                  # documentType=quotation
hisaabo credit-note list                # documentType=credit_note
hisaabo debit-note list                 # documentType=debit_note
hisaabo challan list                    # documentType=delivery_challan
hisaabo proforma list                   # documentType=proforma
hisaabo sales-return list               # documentType=sales_return
hisaabo purchase-return list            # documentType=purchase_return
```

Or use a unified flag:

```
hisaabo invoice list --doc-type quotation
```

### 8.8 Report Command Mapping

Maps to the 11 report types in `routers/reports.ts`:

```
hisaabo report daybook --from 2026-04-01 --to 2026-04-30
hisaabo report outstanding --type receivable
hisaabo report sale-register --this-fy
hisaabo report purchase-register --this-fy
hisaabo report tax-summary --this-quarter
hisaabo report pnl --this-fy
hisaabo report balance-sheet --as-of 2026-03-31
hisaabo report stock --low-stock
hisaabo report ageing --type receivable
hisaabo report party-statement --party "Sharma Traders"
hisaabo report expense-summary --this-fy
```

---

## Design Decisions and Rationale

**Why text badges (`[PAID]`) instead of emoji?**
Emoji rendering varies wildly across terminals and SSH sessions. A user SSH-ing into their billing server from PuTTY on Windows will see broken emoji. Text badges with ANSI colors work everywhere.

**Why right-aligned currency with Indian grouping?**
Indian accountants read numbers from right to left (thousands, lakhs, crores). Right-alignment makes columns scannable. The `en-IN` locale grouping (12,34,567) matches what they see in Tally, GST portal, and bank statements.

**Why interactive by default, flags for scripting?**
An accountant creating their first invoice needs guidance. A developer writing a cron job needs flags. Defaulting to interactive with a `--yes` escape hatch serves both without a mode switch.

**Why fuzzy search for party/item names?**
Users remember "Sharma" not the full "Sharma Trading Co. Pvt. Ltd." Fuzzy search with ranked results prevents UUID lookups for simple operations.

**Why separate exit codes?**
A cron job needs to distinguish "invoice not found" (exit 5, retry later) from "auth expired" (exit 3, alert admin). Generic exit 1 for everything makes automation brittle.

**Why `--format ids` output?**
The most common scripting pattern is "get a list of things, do something to each." Piping IDs through xargs is the Unix way. Without this, users parse JSON with jq just to get IDs.
