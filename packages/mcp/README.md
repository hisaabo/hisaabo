# @hisaabo/mcp

The Hisaabo MCP server. Connect Hisaabo invoicing data to Claude Desktop, OpenClaw, or any MCP-compatible AI agent.

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

| Tool | What it does |
|---|---|
| `invoice_list` | List invoices with filters (status, party, date range) |
| `invoice_create` | Create a sale or purchase invoice |
| `invoice_get` | Get a single invoice with all line items |
| `invoice_update_status` | Change invoice status (draft → sent → paid) |
| `party_list` | List customers and suppliers with outstanding balances |
| `party_get` | Get a party's full profile and running ledger |
| `party_create` | Add a new customer or supplier |
| `item_list` | List items with current stock levels |
| `item_get` | Get a single item with pricing and stock history |
| `item_adjust_stock` | Manually adjust stock (corrections, write-offs) |
| `payment_list` | List payments with filters |
| `payment_create` | Record a payment (Cash, UPI, Bank, Cheque) |
| `expense_list` | List expenses by category and date |
| `expense_create` | Record a business expense |
| `dashboard_summary` | Get key business metrics for a time period |
| `gst_report` | Get GSTR-1 or GSTR-3B data for a month (pass `report_type: "gstr1"` or `"gstr3b"`) |

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
