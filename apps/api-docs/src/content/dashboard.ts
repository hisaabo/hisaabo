import type { EndpointGroup } from "./types";

export const dashboardEndpoints: EndpointGroup = {
  id: "dashboard",
  title: "Dashboard",
  description: "High-level business overview widgets. All endpoints are read-only queries scoped to the active business. The `summary` endpoint is the primary KPI card — all others are secondary widgets for charts and leaderboards.",
  endpoints: [
    {
      id: "dashboard-summary",
      method: "query",
      path: "dashboard.summary",
      title: "Business Summary",
      description: "Core KPI summary for the active business. Defaults to the current financial year (starting April 1 by default, configurable per business). Pass `fromDate`/`toDate` to override the period. Returns sales, purchases, expenses, receivables, payables, estimated cash position, and up to 10 recent invoices.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the summary period. Defaults to the financial year start." },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the summary period. Defaults to now." },
      ],
      output: {
        description: "Financial KPIs for the period plus 10 most recently created invoices.",
        example: {
          totalSales: "485000.00",
          totalPurchases: "210000.00",
          totalExpenses: "45000.00",
          receivable: "92000.00",
          payable: "38000.00",
          cashInHand: "189000.00",
          fyStart: "2026-04-01T00:00:00.000Z",
          recentInvoices: [
            {
              id: "inv-uuid",
              invoiceNumber: "INV-0042",
              partyName: "Sharma Electronics",
              totalAmount: "12500.00",
              status: "unpaid",
              invoiceDate: "2026-03-28T00:00:00.000Z",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.summary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.dashboard.summary.query();
console.log("Sales:", summary.totalSales);
console.log("Receivable:", summary.receivable);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/dashboard.summary",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
summary = resp.json()["result"]["data"]["json"]
print("Sales:", summary["totalSales"])`,
      },
      gotchas: [
        "`receivable` and `payable` are always all-time (not period-scoped) — they represent open balances on non-paid, non-cancelled invoices regardless of the date range. Amounts offset by credit notes or sales returns (`totalAdjusted`) are deducted from the outstanding balance before computing these figures.",
        "`cashInHand` is an estimate: cash received from sales minus cash paid for purchases minus expenses in the selected period. It is NOT the actual bank balance.",
        "The financial year start month is read from the business record each time — if it changes, the default period window shifts accordingly.",
      ],
    },
    {
      id: "dashboard-shipping-summary",
      method: "query",
      path: "dashboard.shippingSummary",
      title: "Shipping Summary",
      description: "Compares shipping charges billed to customers (via invoice charges with labels matching 'shipping', 'freight', 'delivery', or 'courier') against actual shipping expenses recorded in the expense tracker. Returns the net margin on logistics.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Shipping amounts charged, spent, and net margin.",
        example: {
          charged: "18500.00",
          spent: "14200.00",
          net: "4300.00",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.shippingSummary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const shipping = await trpc.dashboard.shippingSummary.query({
  fromDate: "2026-04-01T00:00:00.000Z",
});
console.log("Net shipping margin:", shipping.net);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/dashboard.shippingSummary",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only invoice-level charges (the `charges` JSONB array on invoices) are counted as 'charged'. Per-line-item shipping costs are not included.",
        "Expense matching uses a case-insensitive LOWER() comparison on the category name.",
      ],
    },
    {
      id: "dashboard-sales-trend",
      method: "query",
      path: "dashboard.salesTrend",
      title: "Sales Trend",
      description: "Monthly sales trend showing invoiced amount and actual cash collected per calendar month. Use this for line/bar charts. Specify `months` to control how many months of history to show, or provide explicit `fromDate`/`toDate`.",
      auth: "business",
      input: [
        { name: "months", type: "number", required: false, description: "Number of months of history to return (3–24, default 6). Ignored if fromDate/toDate are provided." },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Override: start of the date range" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "Override: end of the date range" },
      ],
      output: {
        description: "Array of monthly data points ordered by month ascending.",
        example: [
          { month: "2025-10-01T00:00:00.000Z", invoiced: "125000.00", collected: "98000.00" },
          { month: "2025-11-01T00:00:00.000Z", invoiced: "140000.00", collected: "120000.00" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.salesTrend?input=%7B%22json%22%3A%7B%22months%22%3A12%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const trend = await trpc.dashboard.salesTrend.query({ months: 12 });
trend.forEach(({ month, invoiced, collected }) => {
  console.log(new Date(month).toLocaleString("en", { month: "short" }), invoiced, collected);
});`,
        python: `import urllib.parse, json

params = urllib.parse.quote(json.dumps({"json": {"months": 6}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/dashboard.salesTrend?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "dashboard-top-outstanding",
      method: "query",
      path: "dashboard.topOutstanding",
      title: "Top Outstanding Customers",
      description: "Returns the top N customers by total outstanding balance (unpaid sales invoices + opening balance). Useful for a collections priority widget.",
      auth: "business",
      input: [
        { name: "limit", type: "number", required: false, description: "Number of customers to return (3–20, default 5)" },
      ],
      output: {
        description: "List of customers sorted by outstanding balance descending.",
        example: [
          { partyId: "party-uuid", partyName: "Meena Traders", outstanding: "45000.00" },
          { partyId: "party-uuid-2", partyName: "Kapoor Stores", outstanding: "28500.00" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.topOutstanding?input=%7B%22json%22%3A%7B%22limit%22%3A10%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const top = await trpc.dashboard.topOutstanding.query({ limit: 10 });`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"limit": 10}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/dashboard.topOutstanding?input={params}", ...)`,
      },
      gotchas: [
        "Includes the party's `openingBalance` in the outstanding calculation. A party with a large opening balance and no invoices will still appear here.",
        "Only customers (`type = 'customer'`) are considered — not suppliers.",
      ],
    },
    {
      id: "dashboard-top-customers",
      method: "query",
      path: "dashboard.topCustomers",
      title: "Top Customers by Revenue",
      description: "Returns the top N customers ranked by total invoiced amount in the given period. Excludes draft and cancelled invoices.",
      auth: "business",
      input: [
        { name: "limit", type: "number", required: false, description: "Number of customers to return (3–20, default 5)" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Customers ranked by total invoiced amount.",
        example: [
          { partyId: "party-uuid", partyName: "Sharma Electronics", totalAmount: "185000.00", invoiceCount: 14 },
          { partyId: "party-uuid-2", partyName: "Gupta Hardware", totalAmount: "92000.00", invoiceCount: 6 },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.topCustomers?input=%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const customers = await trpc.dashboard.topCustomers.query({ limit: 5 });`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"limit": 5}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/dashboard.topCustomers?input={params}", ...)`,
      },
    },
    {
      id: "dashboard-top-selling-items",
      method: "query",
      path: "dashboard.topSellingItems",
      title: "Top Selling Items",
      description: "Returns the top N items ranked by total revenue from sales invoices in the given period. Optionally filter by item type (product or service). Excludes draft and cancelled invoices.",
      auth: "business",
      input: [
        { name: "limit", type: "number", required: false, description: "Number of items to return (3–20, default 5)" },
        { name: "itemType", type: "'product' | 'service'", required: false, description: "Filter to a specific item type" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Items ranked by total revenue.",
        example: [
          {
            itemId: "item-uuid",
            itemName: "Laptop Battery",
            unit: "pcs",
            totalQty: "45.00",
            totalAmount: "112500.00",
            invoiceCount: 18,
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.topSellingItems?input=%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const items = await trpc.dashboard.topSellingItems.query({
  limit: 5,
  itemType: "product",
});`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"limit": 5, "itemType": "product"}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/dashboard.topSellingItems?input={params}", ...)`,
      },
    },
    {
      id: "dashboard-expenses-by-category",
      method: "query",
      path: "dashboard.expensesByCategory",
      title: "Expenses by Category",
      description: "Returns total expenses grouped by category for the given period, ordered by total amount descending. Use for a pie or bar chart widget.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Array of category totals.",
        example: [
          { category: "Rent", total: "25000.00", count: 1 },
          { category: "Transport", total: "8500.00", count: 34 },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.expensesByCategory" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const breakdown = await trpc.dashboard.expensesByCategory.query();`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/dashboard.expensesByCategory",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "dashboard-invoice-status-breakdown",
      method: "query",
      path: "dashboard.invoiceStatusBreakdown",
      title: "Invoice Status Breakdown",
      description: "Returns a count and total amount of invoices grouped by status (draft, unpaid, partial, paid, overdue, cancelled) for the given period. Useful for a status distribution widget.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "Array of status groups.",
        example: [
          { status: "paid", count: 42, total: "380000.00" },
          { status: "unpaid", count: 8, total: "92000.00" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.invoiceStatusBreakdown" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const breakdown = await trpc.dashboard.invoiceStatusBreakdown.query();`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/dashboard.invoiceStatusBreakdown",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "dashboard-profit-and-loss",
      method: "query",
      path: "dashboard.profitAndLoss",
      title: "Profit & Loss",
      description: "Simple P&L statement: revenue (sales invoices) minus COGS (purchase invoices) minus expenses. Returns gross profit, net profit, and margin percentages. Excludes cancelled invoices.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of the period" },
      ],
      output: {
        description: "P&L summary with expense breakdown by category.",
        example: {
          revenue: "485000.00",
          cogs: "210000.00",
          grossProfit: "275000.00",
          grossMarginPercent: "56.7",
          expenses: [
            { category: "Rent", total: "25000.00" },
            { category: "Transport", total: "8500.00" },
          ],
          totalExpenses: "45000.00",
          netProfit: "230000.00",
          netMarginPercent: "47.4",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.profitAndLoss" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const pl = await trpc.dashboard.profitAndLoss.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
console.log("Net profit:", pl.netProfit, "(" + pl.netMarginPercent + "%)");`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/dashboard.profitAndLoss",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "COGS is calculated as the total of purchase invoices, not the cost price of sold items. This is a simplified model — not a traditional COGS calculation.",
        "Margin percentages are returned as strings like '56.7' (one decimal place).",
      ],
    },
    {
      id: "dashboard-receivables-aging",
      method: "query",
      path: "dashboard.receivablesAging",
      title: "Receivables Aging",
      description: "Buckets all outstanding sale invoices by age (0–30 days, 31–60 days, 61–90 days, 90+ days) per customer. Uses due date if available, otherwise falls back to invoice date. Returns both per-party rows and an aggregate summary.",
      auth: "business",
      input: [],
      output: {
        description: "Per-party aging buckets and aggregate summary totals.",
        example: {
          rows: [
            {
              partyId: "party-uuid",
              partyName: "Meena Traders",
              current: "15000.00",
              days31_60: "8000.00",
              days61_90: "0.00",
              days90Plus: "22000.00",
              total: "45000.00",
            },
          ],
          summary: {
            current: "15000.00",
            days31_60: "8000.00",
            days61_90: "0.00",
            days90Plus: "22000.00",
            total: "45000.00",
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/dashboard.receivablesAging" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const aging = await trpc.dashboard.receivablesAging.query();
const overdue = aging.rows.filter(r => parseFloat(r.days90Plus) > 0);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/dashboard.receivablesAging",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only sale invoices with status NOT IN ('paid', 'cancelled', 'draft', 'adjusted') are included. Invoices fully covered by credit notes or sales returns (`adjusted` status) are excluded from aging.",
        "The aging uses the current server time — results will shift day to day.",
        "For the full outstanding report with payables and filtering, use `reports.outstanding` instead.",
      ],
      relatedEndpoints: ["reports-outstanding"],
    },
  ],
};
