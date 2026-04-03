# @hisaabo/cli

Terminal-first invoicing and business management for Indian businesses. Manage invoices, parties, items, payments, expenses, GST reports, and more -- all from the command line.

[![npm](https://img.shields.io/npm/v/@hisaabo/cli?logo=npm&logoColor=white&label=@hisaabo/cli)](https://www.npmjs.com/package/@hisaabo/cli)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: O'Saasy](https://img.shields.io/badge/license-O'Saasy-blue)](https://github.com/hisaabo/hisaabo/blob/main/LICENSE)

**What this does:** Run `hisaabo invoice list --this-month` and get a formatted table of every invoice your business issued this month. Run `hisaabo gst r3b --quarter Q4` and get your GSTR-3B numbers ready for filing. Pipe any command to `jq` or a spreadsheet with `--json`, `--format csv`, or `--format tsv`.

---

## Quick Start

```bash
npm install -g @hisaabo/cli
```

**Log in interactively:**

```bash
hisaabo login --api-url https://your-hisaabo-instance.com
```

You'll be prompted for email and password, then asked to pick a business if you have more than one.

**Log in with an API key (for scripts and CI):**

```bash
hisaabo login --api-url https://your-hisaabo-instance.com --token hisaabo_key_abc123...
```

Generate API keys at Settings > API Keys in the Hisaabo web app.

**Verify your session:**

```bash
hisaabo whoami
```

---

## Command Reference

### Auth and Session

| Command | Description |
|---|---|
| `hisaabo login` | Authenticate with email/password or API key |
| `hisaabo logout` | Clear saved credentials |
| `hisaabo whoami` | Show current user and active business |
| `hisaabo switch` | Switch active business |

### Business

| Command | Description |
|---|---|
| `hisaabo business list` | List all businesses under your account |
| `hisaabo business switch` | Switch active business |

### Dashboard

| Command | Description |
|---|---|
| `hisaabo dashboard` | Financial summary with box-drawing UI (alias: `dash`) |

### Invoices

| Command | Description |
|---|---|
| `invoice list` | List invoices (filterable by status, party, date range, type) |
| `invoice get <id>` | Get full invoice details with line items |
| `invoice create` | Create a new invoice (interactive or with flags) |
| `invoice status <id> <status>` | Update status (draft, sent, paid, cancelled) |
| `invoice pdf <id>` | Download invoice as PDF |
| `invoice delete <id>` | Delete an invoice |

### Parties (Customers and Suppliers)

| Command | Description |
|---|---|
| `party list` | List parties (filterable by type, category, search) |
| `party get <id>` | Get party profile with balance |
| `party create` | Add a new customer or supplier |
| `party ledger <id>` | Debit/credit history for a party |
| `party delete <id>` | Delete a party |

### Items

| Command | Description |
|---|---|
| `item list` | List items (filter by category, type, low stock) |
| `item get <id>` | Get item details with stock and pricing |
| `item create` | Add a new product or service |
| `item stock <id> <adjustment>` | Adjust stock (+10, -5, or set to 100) |
| `item delete <id>` | Delete an item |

### Payments

| Command | Description |
|---|---|
| `payment list` | List payments (filterable by party, date range) |
| `payment create` | Record a payment (cash, bank, UPI, cheque) |
| `payment delete <id>` | Delete a payment |

### Expenses

| Command | Description |
|---|---|
| `expense list` | List expenses (filterable by category, date range) |
| `expense create` | Record a business expense |
| `expense delete <id>` | Delete an expense |

### Bank Accounts

| Command | Description |
|---|---|
| `bank list` | List accounts with balances |
| `bank get <id>` | Get account details |
| `bank create` | Add a new bank account |
| `bank transfer` | Transfer between accounts |
| `bank transactions <id>` | List transactions for an account |

### GST

| Command | Description |
|---|---|
| `gst r1` | GSTR-1 report (by quarter or month) |
| `gst r3b` | GSTR-3B report (by quarter or month) |
| `gst r1-csv` | Download GSTR-1 as GSTN-compatible CSV for filing |

### Reports

| Command | Description |
|---|---|
| `report daybook` | Day book -- all transactions for a period |
| `report outstanding` | Outstanding receivables and payables |
| `report tax-summary` | Tax collected and paid, grouped by rate |
| `report item-sales` | Item-wise sales breakdown |
| `report stock` | Current stock summary |

### Shipments

| Command | Description |
|---|---|
| `shipment list` | List shipments (filterable by status, invoice) |
| `shipment get <id>` | Get shipment details |
| `shipment create` | Create a shipment linked to an invoice |
| `shipment update <id>` | Update status or tracking info |

### Targets

| Command | Description |
|---|---|
| `target list` | List sales targets |
| `target my` | Show your target progress |
| `target create` | Set a new sales target (daily, weekly, monthly, quarterly) |

### Recurring Invoices

| Command | Description |
|---|---|
| `automated-invoice list` | List recurring invoice templates |
| `automated-invoice get <id>` | Get template details |
| `automated-invoice create` | Create a new recurring template |
| `automated-invoice pause <id>` | Pause an active template |
| `automated-invoice resume <id>` | Resume a paused template |
| `automated-invoice run-now <id>` | Manually trigger invoice generation |
| `automated-invoice delete <id>` | Delete a template |

### Store

| Command | Description |
|---|---|
| `store settings` | Show online store settings |
| `store orders` | List store orders |

### Import

| Command | Description |
|---|---|
| `import parties <file>` | Bulk import parties from JSON or CSV |
| `import items <file>` | Bulk import items from JSON or CSV |

---

## Terminal Examples

**List this month's sale invoices:**

```
$ hisaabo invoice list --type sale --this-month

 ──────────────────────────────────────────────────────────────────────
  #            Party                  Amount  Status    Date
 ──────────────────────────────────────────────────────────────────────
  BB-15042     Sharma Fabrics       9,450.00  [PAID]    Today
  BB-15041     Gupta Enterprises   1,24,800.00  [SENT]    Yesterday
  BB-15040     Mehta Traders       47,200.00  [DRAFT]   3d ago
  BB-15039     Vinod & Sons        18,000.00  [OVERDUE] 12d ago
 ──────────────────────────────────────────────────────────────────────

  Showing 1-4 of 4
```

**Check a party's outstanding balance:**

```
$ hisaabo party get f3a1...

  Gupta Enterprises (customer)
  ────────────────────────────────────────
  Phone:    +91 98765 43210
  GSTIN:    27AABCG1234A1Z5
  City:     Mumbai
  Balance:  1,24,800.00 receivable
  Invoices: 14 (3 unpaid)
```

**Pull GSTR-3B numbers for Q4 and pipe to a file:**

```
$ hisaabo gst r3b --quarter Q4 --json | jq '.taxPayable'
{
  "igst": "0.00",
  "cgst": "18420.00",
  "sgst": "18420.00",
  "cess": "0.00"
}
```

---

## Output Formats and Scripting

Every `list` command supports multiple output formats:

| Flag | Format | Use case |
|---|---|---|
| *(default)* | Colored table | Human reading in a terminal |
| `--json` | Pretty-printed JSON | Piping to `jq`, scripts, CI |
| `--format tsv` | Tab-separated values | Pasting into spreadsheets |
| `--format csv` | Comma-separated values | Import into Excel, Google Sheets |
| `--format ids` | One ID per line | Piping into `xargs` |

**Pipe invoice IDs into a loop:**

```bash
hisaabo invoice list --status draft --format ids | xargs -I{} hisaabo invoice status {} sent
```

**Export all parties to CSV:**

```bash
hisaabo party list --format csv > parties.csv
```

**Environment variables:**

- `NO_COLOR=1` -- disable colored output (also respects `FORCE_COLOR=0`)
- Terminal width is detected automatically. Tables adapt to narrow (<80), standard (80-120), and wide (>120) terminals.

---

## Common Flags

Most commands accept these flags:

| Flag | Description |
|---|---|
| `--json` | Output as JSON instead of a table |
| `--format <fmt>` | Output format: `table`, `tsv`, `csv`, `ids` |
| `--page <n>` | Page number for paginated results |
| `--limit <n>` | Items per page |
| `--from <date>` | Start date filter (YYYY-MM-DD) |
| `--to <date>` | End date filter (YYYY-MM-DD) |
| `--this-month` | Filter to current calendar month |
| `--this-fy` | Filter to current financial year (April-March) |
| `-y, --yes` | Skip confirmation prompts |

---

## Multi-Business Support

If you manage multiple businesses under one account, list and switch between them from the CLI:

```bash
# List all businesses on your account
hisaabo business list

# Switch the active business (interactive picker)
hisaabo switch

# Or switch via the business subcommand
hisaabo business switch
```

All subsequent commands operate on the active business. The `dashboard`, `invoice`, `party`, and every other command scopes data to whichever business is currently selected. Switching resets all cached data so you always see numbers for the correct business.

**Web and mobile UI:** Business switching is also available without the CLI. In the web app, tap the business name in the sidebar to open a popover listing all your businesses plus a "Create New Business" option. On mobile, tap the business name on the home dashboard to open a bottom sheet with the same options.

---

## Development

```bash
# From the monorepo root
pnpm install

# Run the CLI in dev mode (no build step needed)
pnpm --filter @hisaabo/cli dev -- invoice list

# Build
pnpm --filter @hisaabo/cli build

# Type-check
pnpm --filter @hisaabo/cli typecheck
```

For local development, point at your local API:

```bash
hisaabo login --api-url http://localhost:3000
```

The CLI stores credentials in the OS config directory (`~/.config/hisaabo-cli` on Linux, `~/Library/Preferences/hisaabo-cli` on macOS).

---

## Full Documentation

[docs.hisaabo.in/cli](https://docs.hisaabo.in/cli) -- Setup guide, full command reference with all flags, scripting recipes, and CI/CD integration examples.
