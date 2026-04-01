# @hisaabo/mcp

The Hisaabo MCP server. Connect Hisaabo invoicing data to Claude Desktop, OpenClaw, or any MCP-compatible AI agent. 130+ tools covering every business operation.

[![Model Context Protocol](https://img.shields.io/badge/MCP-compatible-7C3AED)](https://modelcontextprotocol.io/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**What this does:** Once configured, you can ask Claude "How much does Gupta Enterprises owe me?" or "Create an invoice for 20 bags of rice at ₹1,250 each" and it will call the real Hisaabo API, use your live business data, and return accurate results.

---

## 5-Minute Setup

**Step 1: Get your credentials**

```bash
npm install -g @hisaabo/cli
hisaabo login --api-url https://your-hisaabo-instance.com
hisaabo whoami --json
```

Copy the `token`, `tenantId`, and `businessId` values from the output.

**Step 2: Add to Claude Desktop**

Open `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "hisaabo": {
      "command": "npx",
      "args": ["@hisaabo/mcp"],
      "env": {
        "HISAABO_API_URL": "https://your-hisaabo-instance.com",
        "HISAABO_API_KEY": "sess_...",
        "HISAABO_TENANT_ID": "tenant-uuid-here",
        "HISAABO_BUSINESS_ID": "business-uuid-here"
      }
    }
  }
}
```

**Step 3: Restart Claude Desktop**

Ask Claude: *"What is my business's total outstanding receivables?"*

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `HISAABO_API_URL` | Yes | Base URL of your Hisaabo API (e.g. `http://localhost:3000` for local dev) |
| `HISAABO_API_KEY` | Yes | Session token from `hisaabo whoami --json` → `token` |
| `HISAABO_TENANT_ID` | Yes | Tenant UUID from `hisaabo whoami --json` → `tenantId` |
| `HISAABO_BUSINESS_ID` | Yes | Business UUID from `hisaabo whoami --json` → `businessId` |

**Token expiry:** Session tokens last 30 days. If the MCP server stops responding, run `hisaabo login` to get a fresh token and update the `claude_desktop_config.json`.

---

## Available Tools

130+ tools across all business domains.

### Invoicing

| Tool | What it does |
|---|---|
| `invoice_list` | List invoices with filters (status, party, date range) |
| `invoice_create` | Create a sale or purchase invoice |
| `invoice_get` | Get a single invoice with all line items and payment history |
| `invoice_update` | Edit an existing invoice (line items, dates, notes, discount) |
| `invoice_update_status` | Change invoice status (draft → sent → paid → cancelled) |
| `invoice_pdf_url` | Get URL to download invoice PDF (A4 or thermal) |
| `invoice_delete` | Soft-delete a draft or unpaid invoice |

### Documents

| Tool | What it does |
|---|---|
| `document_convert` | Convert a document to another type (e.g. quotation → invoice) |
| `quotation_list/create/get/update_status/delete` | Manage price quotes |
| `credit_note_list/create/get/update_status/delete` | Manage credit notes |
| `debit_note_list/create/get/update_status/delete` | Manage debit notes |
| `delivery_challan_list/create/get/update_status/delete` | Manage delivery challans |
| `proforma_list/create/get/update_status/delete` | Manage proforma invoices |
| `sales_return_list/create/get/update_status/delete` | Manage sales returns |
| `purchase_return_list/create/get/update_status/delete` | Manage purchase returns |

### Parties

| Tool | What it does |
|---|---|
| `party_list` | List customers and suppliers with outstanding balances |
| `party_get` | Get a party's full profile and current balance |
| `party_create` | Add a new customer or supplier |
| `party_update` | Update party details (phone, GSTIN, address, credit terms) |
| `party_delete` | Delete a party record |
| `party_ledger` | Get full transaction ledger for a party |
| `party_ledger_report` | Aggregated ledger report suitable for sharing with the party |
| `party_get_stats` | Get invoice and payment counts for a party |
| `party_top_items` | Get the top 5 items transacted with a party |
| `party_merge` | Merge two duplicate party records into one |

### Items & Inventory

| Tool | What it does |
|---|---|
| `item_list` | List items with current stock levels |
| `item_get` | Get a single item with pricing and stock history |
| `item_create` | Create a new product or service item |
| `item_update` | Update item details, pricing, or GST rate |
| `item_delete` | Delete an item record |
| `item_adjust_stock` | Manually adjust stock (corrections, write-offs) |
| `item_categories` | List all item categories |
| `item_list_variants` | List all variants for a variant-mode item |
| `item_create_variant` | Add a variant to a variant-mode item |
| `item_update_variant` | Update an existing item variant |
| `item_delete_variant` | Delete an item variant |
| `item_merge` | Merge two items (moves invoice history, deletes source) |
| `item_switch_base_unit` | Change the base unit of measure for an item |
| `item_rename_unit` | Rename a unit across all linked invoice line items |
| `item_stock_adjustment_history` | View the audit log of stock adjustments |
| `item_low_stock_count` | Count items below their low-stock alert threshold |

### Payments

| Tool | What it does |
|---|---|
| `payment_list` | List payments with filters |
| `payment_create` | Record a payment (Cash, UPI, Bank, Cheque) |
| `payment_get` | Get full payment details including linked invoices |
| `payment_update` | Update a payment record |
| `payment_delete` | Soft-delete a payment |
| `payment_unpaid_invoices` | List unpaid invoices for a party (for allocation) |
| `payment_untracked` | List payments not linked to a bank account |
| `payment_default_account` | Get recommended bank account for a new payment |

### Expenses

| Tool | What it does |
|---|---|
| `expense_list` | List expenses by category and date |
| `expense_create` | Record a business expense |
| `expense_update` | Update an expense record |
| `expense_delete` | Delete an expense record |
| `expense_categories` | List all expense categories |

### GST

| Tool | What it does |
|---|---|
| `gst_report` | Get GSTR-1 or GSTR-3B data for a month |
| `gst_report_csv` | Download GSTR data as a CSV for portal upload |

### Dashboard & Reports

| Tool | What it does |
|---|---|
| `dashboard_summary` | Get key business metrics for a time period |
| `report_daybook` | All transactions for a date range, ordered by date |
| `report_outstanding` | Receivables and payables with aging buckets |
| `report_tax_summary` | Taxable turnover and GST collected/paid by rate |
| `report_item_sales` | Sales quantity and revenue per item |
| `report_stock_summary` | Current stock value with opening/closing comparison |
| `report_party_statement` | Full transaction statement for a party |
| `report_payment_summary` | Payment totals grouped by mode |

### Shipments

| Tool | What it does |
|---|---|
| `shipment_list` | List shipments with filters |
| `shipment_get` | Get a shipment with full tracking history |
| `shipment_create` | Create a shipment linked to an invoice |
| `shipment_update` | Update tracking number, status, or delivery date |
| `shipment_delete` | Delete a shipment record |

### Bank Accounts

| Tool | What it does |
|---|---|
| `bank_account_list` | List all bank and cash accounts |
| `bank_account_get` | Get a single account with current balance |
| `bank_account_create` | Add a new bank or cash account |
| `bank_account_transfer` | Record a fund transfer between accounts |
| `bank_account_transactions` | List transactions for an account |
| `bank_account_summary` | Account balance and cash flow summary |

### Automated Invoices

| Tool | What it does |
|---|---|
| `automated_invoice_list` | List recurring invoice templates |
| `automated_invoice_get` | Get template details with line items |
| `automated_invoice_create` | Create a new recurring template |
| `automated_invoice_update` | Modify an existing template |
| `automated_invoice_delete` | Remove a template |
| `automated_invoice_pause` | Pause automatic generation |
| `automated_invoice_resume` | Resume a paused template |
| `automated_invoice_run_now` | Manually trigger invoice generation |
| `automated_invoice_history` | View execution history |
| `automated_invoice_plan_usage` | Check monthly run quota |
| `automated_invoice_suggestions` | Get AI-detected recurring patterns |

### Store

| Tool | What it does |
|---|---|
| `store_settings` | Get online store configuration |
| `store_update_settings` | Update store settings (slug, tagline, enable/disable) |
| `store_orders` | List customer orders from the store |
| `store_order_get` | Get full details of a single order |
| `store_order_update` | Update order status (preparing / ready / delivered) |
| `store_confirm_order` | Confirm a pending order and activate its invoice |
| `store_cancel_order` | Cancel an order with an optional reason |

### Sales Targets

| Tool | What it does |
|---|---|
| `target_list` | List sales targets |
| `target_create` | Create a new sales target |
| `target_progress` | Get progress data for a target |
| `target_my` | Get targets assigned to the current user |

### Import

| Tool | What it does |
|---|---|
| `import_parties` | Bulk-import parties from CSV or JSON |
| `import_items` | Bulk-import items from CSV or JSON |
| `import_invoices` | Bulk-import historical invoices (migration) |
| `import_payments` | Bulk-import historical payment records |

### Business

| Tool | What it does |
|---|---|
| `business_list` | List all businesses associated with the authenticated account |
| `business_create` | Create a new business under the authenticated account |

### Tenant / Team Management

| Tool | What it does |
|---|---|
| `tenant_list` | List all organizations the current user belongs to |
| `tenant_members` | List all members of the current tenant |
| `tenant_invite_member` | Invite a user to join the tenant by email |
| `tenant_remove_member` | Remove a member from the tenant |
| `tenant_update_member_role` | Change a member's role (admin / seller_manager / seller / accountant) |

### API Keys

| Tool | What it does |
|---|---|
| `api_key_list` | List API keys for the current user |
| `api_key_create` | Create a new API key (shown exactly once) |
| `api_key_revoke` | Permanently revoke an API key |

## Available Resources

Resources are read-only context that AI agents can load into their context window:

| Resource URI | Description |
|---|---|
| `business://current` | Business profile: name, GSTIN, currency, financial year |
| `parties://customers` | Top 50 customers by name (id, name, phone, balance) |
| `parties://suppliers` | Top 50 suppliers by name |
| `items://inventory` | Up to 100 items with stock levels, prices, HSN codes |
| `invoices://recent` | Last 10 sale invoices |
| `dashboard://summary` | Current FY: total sales, receivables, payables, cash |

---

## Conversation Examples

**Check outstanding balance:**
```
You: "How much does Vinod & Sons owe me?"
Claude: "Vinod & Sons has ₹45,000 outstanding across 3 invoices.
         The oldest is BB-12801 from 63 days ago.
         Should I draft a payment reminder?"
```

**Create an invoice:**
```
You: "Bill Sharma Fabrics for 50 meters of georgette at ₹180/m, due 15th April"
Claude: "Done. Invoice BB-15042 created:
         Sharma Fabrics — ₹9,000
         50m Georgette @ ₹180/m (GST 5%)
         Total: ₹9,450 | Due: April 15, 2026"
```

**Create a quotation and convert it to an invoice:**
```
You: "Send Sharma Textiles a quote for 500m of silk at ₹320/m, valid for 15 days"
Claude: "Done. Quotation QT-0041 created for Sharma Textiles:
         500m Silk Fabric @ ₹320/m = ₹1,60,000 + GST (5%)
         Total: ₹1,68,000 | Valid until: April 16, 2026
         Should I convert this to an invoice once they confirm?"

You: "Yes, they confirmed — convert it"
Claude: "Invoice BB-15109 created from QT-0041:
         Sharma Textiles — ₹1,68,000 | Due: May 1, 2026"
```

**Morning business briefing:**
```
You: "Give me today's numbers"
Claude: "Today so far: ₹84,500 revenue (12 invoices)
         Outstanding: ₹2,34,000 across 18 invoices
         Critical: Vinod & Sons — ₹45,000 overdue 63 days
         3 items need restocking. GSTR-3B due in 4 days."
```

---

## Transport

The server uses stdio transport (stdin/stdout), which is the standard for MCP servers running as subprocesses. Your MCP client (Claude Desktop, OpenClaw) starts and stops the process automatically. No separate server daemon or open port is needed.

---

## Development

```bash
# From monorepo root
pnpm --filter @hisaabo/mcp dev

# Build
pnpm --filter @hisaabo/mcp build

# Type-check
pnpm --filter @hisaabo/mcp typecheck
```

For local development, set `HISAABO_API_URL=http://localhost:3000` and use a session token from a local login.

---

## Full Documentation

[docs.hisaabo.in/ai/mcp-server](https://docs.hisaabo.in/ai/mcp-server/) — Setup guide, all tools with input/output schemas, security considerations, and integration examples.
