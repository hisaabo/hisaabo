import type { EndpointGroup } from "./types";

export const reportsEndpoints: EndpointGroup = {
  id: "reports",
  title: "Reports",
  description: "Business intelligence reports. All 11 endpoints are read-only queries under `businessProcedure` — they require an active business context via the `x-business-id` header. All monetary values are returned as NUMERIC strings.",
  endpoints: [
    {
      id: "reports-daybook",
      method: "query",
      path: "reports.daybook",
      title: "Daybook",
      description: "A combined chronological log of all invoices, payments, and expenses for a date range. Each entry is normalised into a debit/credit format. Use `typeFilter` to focus on a single entry type. Returns a daily summary alongside the entries.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (YYYY-MM-DD)", required: true, description: "Start date of the daybook range" },
        { name: "toDate", type: "string (YYYY-MM-DD)", required: true, description: "End date of the daybook range (inclusive)" },
        { name: "typeFilter", type: "'all' | 'invoices' | 'payments' | 'expenses'", required: false, description: "Filter to a single entry type. Defaults to 'all'." },
      ],
      output: {
        description: "Chronological entries plus a summary of totals.",
        example: {
          entries: [
            {
              id: "inv-uuid",
              time: "2026-03-01T09:00:00.000Z",
              entryType: "invoice",
              number: "INV-0042",
              partyOrCategory: "Sharma Electronics",
              debit: "0",
              credit: "12500.00",
              mode: null,
              status: "unpaid",
              meta: { type: "sale", documentType: "invoice" },
            },
          ],
          summary: {
            totalSalesInvoiced: "12500.00",
            totalPurchaseInvoiced: "0.00",
            totalPaymentsReceived: "8000.00",
            totalPaymentsMade: "0.00",
            totalExpenses: "250.00",
            netCashMovement: "7750.00",
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.daybook?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-03-01%22%2C%22toDate%22%3A%222026-03-31%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const daybook = await trpc.reports.daybook.query({
  fromDate: "2026-03-01",
  toDate: "2026-03-31",
  typeFilter: "all",
});
console.log("Net movement:", daybook.summary.netCashMovement);`,
        python: `import urllib.parse, json, httpx

params = urllib.parse.quote(json.dumps({
    "json": {"fromDate": "2026-03-01", "toDate": "2026-03-31"}
}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/reports.daybook?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "`fromDate` and `toDate` accept date-only strings (YYYY-MM-DD), not full ISO datetimes. The range is inclusive of the full end day (toDate T23:59:59.999).",
        "For invoices, sale invoices produce a `credit` entry; purchase invoices produce a `debit` entry. For payments, customer payments produce `credit`; supplier payments produce `debit`.",
        "`netCashMovement` = paymentsReceived - paymentsMade - expenses. It does NOT include invoices (which are not cash until collected).",
      ],
    },
    {
      id: "reports-outstanding",
      method: "query",
      path: "reports.outstanding",
      title: "Outstanding Report",
      description: "Aging analysis of outstanding receivables (unpaid sales) and/or payables (unpaid purchases). Groups invoices per party into aging buckets (0–30, 31–60, 61–90, 90+ days overdue) and returns both per-party detail and aggregate summary.",
      auth: "business",
      input: [
        { name: "type", type: "'receivable' | 'payable' | 'both'", required: false, description: "Which side to compute. Defaults to 'receivable'." },
        { name: "asOfDate", type: "string (ISO datetime)", required: false, description: "Compute aging as of this date. Defaults to now." },
      ],
      output: {
        description: "Receivables and/or payables with per-party aging buckets and aggregate totals.",
        example: {
          receivables: {
            parties: [
              {
                partyId: "party-uuid",
                partyName: "Sharma Electronics",
                partyPhone: "9876543210",
                current: "5000.00",
                days31_60: "7500.00",
                days61_90: "0.00",
                days90Plus: "0.00",
                total: "12500.00",
                invoices: [],
              },
            ],
            summary: { current: "5000.00", days31_60: "7500.00", days61_90: "0.00", days90Plus: "0.00", total: "12500.00" },
          },
          payables: null,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.outstanding?input=%7B%22json%22%3A%7B%22type%22%3A%22both%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { receivables, payables } = await trpc.reports.outstanding.query({ type: "both" });
const totalReceivable = receivables?.summary.total ?? "0";`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"type": "both"}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.outstanding?input={params}", ...)`,
      },
      gotchas: [
        "Only invoices with `status NOT IN ('paid', 'cancelled', 'draft')` and a positive outstanding balance are included.",
        "The `daysOverdue` used for bucketing is based on `dueDate` if set, otherwise `invoiceDate`.",
        "Parties are sorted by `total` descending — the worst debtors appear first.",
      ],
    },
    {
      id: "reports-sales-register",
      method: "query",
      path: "reports.salesRegister",
      title: "Sales Register",
      description: "Full sales register listing all sale invoices, credit notes, and debit notes in a date range. Each row includes customer GSTIN, subtotal, discount, tax, and total. A per-invoice tax breakdown (grouped by tax rate) is attached to each row for GST filing.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Start of the date range" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "End of the date range" },
        { name: "partyId", type: "string (UUID)", required: false, description: "Filter to a specific customer" },
      ],
      output: {
        description: "Rows of invoice data with tax breakdown, plus aggregate summary.",
        example: {
          rows: [
            {
              id: "inv-uuid",
              invoiceDate: "2026-03-01T00:00:00.000Z",
              invoiceNumber: "INV-0042",
              documentType: "invoice",
              customerName: "Sharma Electronics",
              customerGstin: "29ABCDE1234F1Z5",
              customerState: "Karnataka",
              subtotal: "10593.22",
              discountAmount: "0.00",
              taxAmount: "1906.78",
              totalAmount: "12500.00",
              amountPaid: "0.00",
              status: "unpaid",
              taxBreakdown: [{ taxPercent: "18.00", taxableAmount: "10593.22", taxAmount: "1906.78" }],
            },
          ],
          summary: { totalSubtotal: "10593.22", totalTax: "1906.78", totalAmount: "12500.00", count: 1 },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.salesRegister?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222027-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const register = await trpc.reports.salesRegister.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
console.log("Total sales:", register.summary.totalAmount);`,
        python: `params = urllib.parse.quote(json.dumps({
    "json": {"fromDate": "2026-04-01T00:00:00.000Z", "toDate": "2027-03-31T23:59:59.999Z"}
}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.salesRegister?input={params}", ...)`,
      },
      gotchas: [
        "Includes `credit_note` and `debit_note` document types in addition to `invoice`. Filter on `documentType` in your UI if you want only invoices.",
        "Cancelled invoices are excluded. Draft invoices are excluded.",
      ],
    },
    {
      id: "reports-purchase-register",
      method: "query",
      path: "reports.purchaseRegister",
      title: "Purchase Register",
      description: "Full purchase register listing all purchase invoices in a date range. Mirrors the sales register structure but for supplier invoices. Includes supplier GSTIN for input tax credit reconciliation.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Start of the date range" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "End of the date range" },
        { name: "partyId", type: "string (UUID)", required: false, description: "Filter to a specific supplier" },
      ],
      output: {
        description: "Rows of purchase invoice data with tax breakdown, plus aggregate summary.",
        example: {
          rows: [
            {
              id: "inv-uuid",
              invoiceDate: "2026-03-01T00:00:00.000Z",
              invoiceNumber: "BILL-0099",
              supplierName: "Mumbai Wholesale Ltd",
              supplierGstin: "27XYZAB5678C1D2",
              subtotal: "42372.88",
              discountAmount: "0.00",
              taxAmount: "7627.12",
              totalAmount: "50000.00",
              amountPaid: "50000.00",
              status: "paid",
              taxBreakdown: [{ taxPercent: "18.00", taxableAmount: "42372.88", taxAmount: "7627.12" }],
            },
          ],
          summary: { totalSubtotal: "42372.88", totalTax: "7627.12", totalAmount: "50000.00", count: 1 },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.purchaseRegister?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222027-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const register = await trpc.reports.purchaseRegister.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});`,
        python: `params = urllib.parse.quote(json.dumps({
    "json": {"fromDate": "2026-04-01T00:00:00.000Z", "toDate": "2027-03-31T23:59:59.999Z"}
}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.purchaseRegister?input={params}", ...)`,
      },
      gotchas: [
        "Only `documentType = 'invoice'` purchase documents are included (not purchase orders or challans).",
        "Cancelled invoices are excluded.",
      ],
      relatedEndpoints: ["reports-sales-register"],
    },
    {
      id: "reports-tax-summary",
      method: "query",
      path: "reports.taxSummary",
      title: "Tax Summary",
      description: "Summarises GST collected on sales and paid on purchases, grouped by tax rate slab. Returns `netTaxLiability = taxCollected - taxPaid`. Use this for GSTR-3B preparation or quarterly GST working.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Start of the tax period" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "End of the tax period" },
        { name: "type", type: "'sales' | 'purchases' | 'both'", required: false, description: "Which side to include. Defaults to 'both'." },
      ],
      output: {
        description: "Tax breakdown by slab for sales and purchases, plus net liability.",
        example: {
          salesBreakdown: [
            { invoiceType: "sale", taxPercent: "18.00", invoiceCount: 14, taxableAmount: "148305.08", taxAmount: "26694.92", grossAmount: "175000.00" },
          ],
          purchaseBreakdown: [
            { invoiceType: "purchase", taxPercent: "18.00", invoiceCount: 5, taxableAmount: "42372.88", taxAmount: "7627.12", grossAmount: "50000.00" },
          ],
          summary: {
            totalTaxCollected: "26694.92",
            totalTaxPaid: "7627.12",
            netTaxLiability: "19067.80",
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.taxSummary?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-01-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222026-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const tax = await trpc.reports.taxSummary.query({
  fromDate: "2026-01-01T00:00:00.000Z",
  toDate: "2026-03-31T23:59:59.999Z",
});
console.log("GST payable:", tax.summary.netTaxLiability);`,
        python: `params = urllib.parse.quote(json.dumps({
    "json": {
        "fromDate": "2026-01-01T00:00:00.000Z",
        "toDate": "2026-03-31T23:59:59.999Z",
        "type": "both",
    }
}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.taxSummary?input={params}", ...)`,
      },
      gotchas: [
        "Only `documentType = 'invoice'` documents are counted — quotations, challans, and proformas are excluded.",
        "Draft and cancelled invoices are excluded.",
        "For GST return filing helpers (GSTR-1, GSTR-3B), use the dedicated `gst.*` router endpoints instead.",
      ],
    },
    {
      id: "reports-cash-flow-forecast",
      method: "query",
      path: "reports.cashFlowForecast",
      title: "Cash Flow Forecast",
      description: "Forward-looking cash position forecast at +0, +7, +14, and +30 days. Combines current bank balance, open receivables bucketed by due date, and a daily expense burn rate. Historical on-time payment rates (last 90 days) are used to weight the 'expected' scenario. Returns three scenarios: optimistic, expected, and conservative.",
      auth: "business",
      input: [],
      output: {
        description: "Forecast at four time horizons, plus the inputs used.",
        example: {
          forecast: [
            { label: "today", days: 0, optimistic: "250000.00", expected: "245000.00", conservative: "230000.00" },
            { label: "+7d", days: 7, optimistic: "320000.00", expected: "295000.00", conservative: "270000.00" },
            { label: "+14d", days: 14, optimistic: "380000.00", expected: "340000.00", conservative: "300000.00" },
            { label: "+30d", days: 30, optimistic: "440000.00", expected: "390000.00", conservative: "330000.00" },
          ],
          currentBankBalance: "200000.00",
          avgDailyExpenses: "1500.00",
          openReceivables: [
            { bucket: "overdue", totalDue: "30000.00", invoiceCount: 3 },
            { bucket: "7d", totalDue: "45000.00", invoiceCount: 5 },
          ],
          collectionRates: {
            rate7d: "0.720",
            rate14d: "0.850",
            rate30d: "0.920",
            paidInvoiceCount: 45,
            lowConfidence: false,
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.cashFlowForecast" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const forecast = await trpc.reports.cashFlowForecast.query();
const next30 = forecast.forecast.find(f => f.label === "+30d");
console.log("Expected balance in 30 days:", next30?.expected);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/reports.cashFlowForecast",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Bank balance is the sum of `currentBalance` across all `bankAccounts` records — not a live bank API.",
        "If `paidInvoiceCount < 10`, the `lowConfidence` flag is set to `true` — the historical collection rates are unreliable.",
        "Overdue receivables are weighted at 50% collectability in the expected scenario.",
      ],
    },
    {
      id: "reports-collection-efficiency",
      method: "query",
      path: "reports.collectionEfficiency",
      title: "Collection Efficiency & DSO",
      description: "Measures payment collection quality for a period. Returns on-time payment rate (% of invoices paid before the due date) and Days Sales Outstanding (DSO). DSO <= 30 days is considered healthy; > 45 days triggers a warning.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Start of the analysis period" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "End of the analysis period" },
      ],
      output: {
        description: "On-time collection stats and DSO calculation.",
        example: {
          collectionEfficiency: {
            totalInvoices: 32,
            paidOnTime: 24,
            paidLate: 8,
            onTimeRate: "75.0",
          },
          dso: {
            dsoDays: "28.5",
            totalSales: "485000.00",
            avgReceivable: "38100.00",
            daysInPeriod: 365,
            isHealthy: true,
            isWarning: false,
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.collectionEfficiency?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222027-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const eff = await trpc.reports.collectionEfficiency.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
if (eff.dso.isWarning) console.warn("DSO is high:", eff.dso.dsoDays, "days");`,
        python: `params = urllib.parse.quote(json.dumps({
    "json": {"fromDate": "2026-04-01T00:00:00.000Z", "toDate": "2027-03-31T23:59:59.999Z"}
}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.collectionEfficiency?input={params}", ...)`,
      },
      gotchas: [
        "Only invoices with `dueDate` set are counted for on-time rate — invoices without a due date are excluded from the efficiency calculation.",
        "DSO = (avgReceivable / totalSales) * daysInPeriod. A null `dsoDays` means no sales in the period.",
      ],
    },
    {
      id: "reports-item-sales",
      method: "query",
      path: "reports.itemSales",
      title: "Item-wise Sales",
      description: "Per-item sales performance report for a date range. Returns quantity sold, revenue, average unit price, unique customer count, estimated gross margin %, and invoice count per item. Can compare against the equivalent prior period by setting `compareToPrevious: true`.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Start of the analysis period" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "End of the analysis period" },
        { name: "category", type: "string", required: false, description: "Filter to a specific item category" },
        { name: "itemType", type: "'product' | 'service'", required: false, description: "Filter to a specific item type" },
        { name: "sortBy", type: "'revenue' | 'quantity' | 'invoices' | 'margin'", required: false, description: "Sort order. Defaults to 'revenue'." },
        { name: "compareToPrevious", type: "boolean", required: false, description: "If true, attach previous-period stats and % revenue change. Default: false." },
      ],
      output: {
        description: "Per-item performance rows with optional period-over-period comparison.",
        example: {
          rows: [
            {
              itemId: "item-uuid",
              itemName: "Laptop Battery",
              category: "Electronics",
              unit: "pcs",
              soldQty: "45.00",
              totalRevenue: "112500.00",
              avgUnitPrice: "2500.00",
              invoiceCount: 18,
              uniqueCustomers: 12,
              estimatedCost: "67500.00",
              grossMarginPct: "40.0",
              previous: null,
              revenueChange: null,
            },
          ],
          totalRevenue: "112500.00",
          count: 1,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.itemSales?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222027-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const items = await trpc.reports.itemSales.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
  sortBy: "margin",
  compareToPrevious: true,
});
items.rows.forEach(r => {
  if (r.revenueChange && parseFloat(r.revenueChange) < -20) {
    console.warn(r.itemName, "revenue dropped", r.revenueChange + "%");
  }
});`,
        python: `params = urllib.parse.quote(json.dumps({
    "json": {
        "fromDate": "2026-04-01T00:00:00.000Z",
        "toDate": "2027-03-31T23:59:59.999Z",
        "sortBy": "revenue",
        "compareToPrevious": False,
    }
}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.itemSales?input={params}", ...)`,
      },
      gotchas: [
        "`grossMarginPct` uses the item's `purchasePrice` as a cost proxy. If `purchasePrice` is null, cost is treated as zero — making the margin 100%.",
        "`estimatedCost` similarly uses `purchasePrice * soldQty`, not actual purchase invoice data.",
        "When `compareToPrevious` is true, the prior period window is auto-calculated as the same duration immediately before `fromDate`.",
      ],
    },
    {
      id: "reports-stock-summary",
      method: "query",
      path: "reports.stockSummary",
      title: "Stock Summary",
      description: "Current stock position for all product items. Handles both simple items and variant items separately. For variant items, returns a JSON array of per-variant stock. Returns cost value (at purchase price) and sale value (at sale price) for each item, plus aggregate totals and a low-stock alert count.",
      auth: "business",
      input: [
        { name: "category", type: "string", required: false, description: "Filter to a specific item category" },
        { name: "showZeroStock", type: "boolean", required: false, description: "Include items with zero stock. Default: false." },
      ],
      output: {
        description: "Simple items and variant items with per-SKU stock, plus aggregate summary.",
        example: {
          simpleItems: [
            {
              itemId: "item-uuid",
              itemName: "Laptop Battery",
              category: "Electronics",
              hsn: "8507",
              unit: "pcs",
              currentStock: "12.00",
              purchasePrice: "1500.00",
              salePrice: "2500.00",
              stockValue: "18000.00",
              stockValueAtSale: "30000.00",
              lowStockAlert: "5.00",
              isLowStock: false,
            },
          ],
          variantItems: [
            {
              itemId: "item-uuid-2",
              itemName: "T-Shirt",
              totalStock: "48.00",
              totalValue: "14400.00",
              totalValueAtSale: "24000.00",
              variantDetails: [
                { sku: "TSHIRT-RED-M", attributes: { color: "Red", size: "M" }, stock: "12.00", purchasePrice: "300.00", salePrice: "500.00", isLowStock: false },
              ],
            },
          ],
          summary: {
            totalCostValue: "32400.00",
            totalSaleValue: "54000.00",
            totalSkuCount: 2,
            lowStockCount: 0,
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.stockSummary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const stock = await trpc.reports.stockSummary.query({ showZeroStock: false });
const lowStockItems = stock.simpleItems.filter(i => i.isLowStock);
console.log("Low stock alerts:", stock.summary.lowStockCount);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/reports.stockSummary",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only items with `itemType = 'product'` are included — service items have no stock.",
        "Variant items use `itemVariants.stockQuantity` for stock levels. Simple items use `items.stockQuantity`.",
        "`stockValue` and `stockValueAtSale` use stored price fields — they reflect the current prices, not historical purchase costs.",
      ],
    },
    {
      id: "reports-party-statement",
      method: "query",
      path: "reports.partyStatement",
      title: "Party Statement",
      description: "Full ledger statement for a single party showing all invoices and payments in chronological order with a running balance. Starts from the party's `openingBalance`. Returns `null` if the party does not belong to the active business.",
      auth: "business",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "ID of the customer or supplier" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Include entries from this date. No default — all entries included if omitted." },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "Include entries up to this date." },
      ],
      output: {
        description: "Party details, chronological ledger entries with running balance, and closing balance summary.",
        example: {
          party: {
            id: "party-uuid",
            name: "Sharma Electronics",
            type: "customer",
            openingBalance: "5000.00",
            gstin: "29ABCDE1234F1Z5",
            phone: "9876543210",
          },
          entries: [
            {
              date: "2026-03-01T00:00:00.000Z",
              type: "invoice",
              number: "INV-0042",
              description: "Sale Invoice",
              debit: "12500.00",
              credit: "0",
              status: "unpaid",
              documentId: "inv-uuid",
              runningBalance: "17500.00",
            },
            {
              date: "2026-03-10T00:00:00.000Z",
              type: "payment",
              number: "PMT-0018",
              description: "Payment (upi)",
              debit: "0",
              credit: "10000.00",
              status: null,
              documentId: "pmt-uuid",
              runningBalance: "7500.00",
            },
          ],
          summary: {
            totalDebit: "12500.00",
            totalCredit: "10000.00",
            closingBalance: "7500.00",
            isDebit: true,
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.partyStatement?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const statement = await trpc.reports.partyStatement.query({ partyId: "party-uuid" });
if (statement) {
  console.log("Closing balance:", statement.summary.closingBalance);
}`,
        python: `params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid"}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.partyStatement?input={params}", ...)`,
      },
      gotchas: [
        "Returns `null` (not an error) if the party doesn't exist or belongs to a different business.",
        "`isDebit: true` means the party owes money (customer has outstanding balance). For suppliers, `isDebit: true` means you owe them.",
        "The running balance starts from `party.openingBalance` before any dated entries. If you filter by `fromDate`, the opening balance is still applied — only entries are filtered.",
      ],
    },
    {
      id: "reports-payment-summary",
      method: "query",
      path: "reports.paymentSummary",
      title: "Payment Summary",
      description: "Summarises all payments in a date range, grouped by payment mode and bank account. Returns both customer payments received and supplier payments made, broken down by mode (cash, bank, UPI, cheque). Also includes expense cash outflow by mode. Returns up to 200 recent payment records.",
      auth: "business",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: true, description: "Start of the period" },
        { name: "toDate", type: "string (ISO datetime)", required: true, description: "End of the period" },
        { name: "type", type: "'received' | 'made' | 'both'", required: false, description: "Filter to payments received (from customers), made (to suppliers), or both. Default: 'both'." },
        { name: "bankAccountId", type: "string (UUID)", required: false, description: "Filter to a specific bank account" },
      ],
      output: {
        description: "Payment mode breakdown, expense outflow by mode, and recent payment list.",
        example: {
          byMode: [
            {
              mode: "upi",
              bankAccountId: null,
              bankAccountName: null,
              count: 18,
              totalAmount: "142000.00",
              customerPayments: "142000.00",
              supplierPayments: "0.00",
            },
          ],
          expenses: [
            { mode: "cash", count: 12, totalAmount: "15000.00" },
          ],
          recentPayments: [
            {
              id: "pmt-uuid",
              paymentNumber: "PMT-0042",
              date: "2026-03-28T00:00:00.000Z",
              partyName: "Sharma Electronics",
              partyType: "customer",
              amount: "12500.00",
              mode: "upi",
            },
          ],
          summary: {
            totalReceived: "142000.00",
            totalMade: "0.00",
            totalExpenses: "15000.00",
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/reports.paymentSummary?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-03-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222026-03-31T23%3A59%3A59.999Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.reports.paymentSummary.query({
  fromDate: "2026-03-01T00:00:00.000Z",
  toDate: "2026-03-31T23:59:59.999Z",
  type: "received",
});
const cashReceived = summary.byMode.find(m => m.mode === "cash");`,
        python: `params = urllib.parse.quote(json.dumps({
    "json": {
        "fromDate": "2026-03-01T00:00:00.000Z",
        "toDate": "2026-03-31T23:59:59.999Z",
    }
}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/reports.paymentSummary?input={params}", ...)`,
      },
      gotchas: [
        "`recentPayments` is capped at 200 records. For a full export, use `payment.list` with pagination instead.",
        "Expenses are only included in the `expenses` field when `type` is `'made'` or `'both'`. Setting `type: 'received'` excludes expense data.",
        "`byMode` groups by (mode, bankAccountId) — the same mode may appear multiple times if payments were made to different bank accounts.",
      ],
      relatedEndpoints: ["reports-daybook"],
    },
  ],
};
