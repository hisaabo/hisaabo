# Analytics Design -- Hisaabo

**Status**: Proposed
**Date**: 2026-03-29
**Author**: Analytics Reporter

---

## Table of Contents

1. [Schema Foundation](#schema-foundation)
2. [Part 1 -- Dashboard Enhancements](#part-1----dashboard-enhancements)
3. [Part 2 -- New Report Types](#part-2----new-report-types)
4. [Part 3 -- Seller Performance Analytics](#part-3----seller-performance-analytics)
5. [Part 4 -- Store Analytics](#part-4----store-analytics)
6. [Part 5 -- API Design: `reports` Router](#part-5----api-design-reports-router)
7. [Part 6 -- Dashboard Widget Enhancements (UI)](#part-6----dashboard-widget-enhancements-ui)
8. [Part 7 -- Implementation Priority Matrix](#part-7----implementation-priority-matrix)
9. [Part 8 -- Role Access Matrix](#part-8----role-access-matrix)
10. [Part 9 -- Technical Notes for Implementation](#part-9----technical-notes-for-implementation)

---

## Schema Foundation

Before designing, a quick map of what data exists and its analytical significance:

| Table | Key analytical columns |
|---|---|
| `invoices` | `type` (sale/purchase), `status`, `invoice_date`, `due_date`, `total_amount`, `amount_paid`, `tax_amount`, `subtotal`, `discount_amount`, `document_type`, `created_by_user_id`, `created_by_name`, `deleted_at` |
| `invoice_items` | `item_id`, `variant_id`, `quantity`, `unit_price`, `tax_percent`, `tax_amount`, `discount_percent`, `total_amount`, `conversion_factor`, `selected_unit` |
| `payments` | `payment_date`, `amount`, `discount`, `mode`, `party_id`, `invoice_id`, `bank_account_id`, `created_by_user_id`, `created_by_name`, `deleted_at` |
| `payment_allocations` | `payment_id`, `invoice_id`, `amount` -- M:N link between payments and invoices |
| `expenses` | `expense_date`, `category`, `description`, `amount`, `mode`, `deleted_at` |
| `parties` | `type` (customer/supplier), `opening_balance`, `credit_period_days`, `credit_limit`, `state_code`, `gstin`, `category` |
| `items` | `item_type` (product/service), `item_mode` (simple/alt_units/variants), `category`, `stock_quantity`, `purchase_price`, `sale_price`, `tax_percent`, `low_stock_alert`, `hsn` |
| `item_variants` | `item_id`, `stock_quantity`, `purchase_price`, `sale_price`, `low_stock_alert`, `attribute_values` (JSONB) |
| `stock_adjustments` | `item_id`, `variant_id`, `quantity` (+/-), `previous_stock`, `new_stock`, `adjustment_date`, `reason` |
| `sales_targets` | `user_id`, `target_type` (order_count/order_value/item_quantity), `target_value`, `period_start`, `period_end`, `item_id` |
| `store_orders` | `status`, `total_amount`, `item_count`, `customer_phone`, `created_at`, `invoice_id` |
| `bank_accounts` | `current_balance`, `opening_balance`, `account_type`, `account_name` |
| `bank_transactions` | `type` (deposit/withdrawal/transfer), `amount`, `transaction_date`, `bank_account_id`, `reference_type`, `reference_id` |

**Hard gaps**: No page-view/session tracking for store analytics. No cost-of-goods-sold (COGS) separate from purchase invoices. No explicit "seller" model -- seller identity is tracked via `created_by_user_id` + `created_by_name` on invoices/payments. No historical inventory snapshots -- `stock_quantity` reflects current state only.

---

## Part 1 -- Dashboard Enhancements

### 1.1 Cash Flow Forecast (Next 30 Days)

**Data sources**: `invoices` (unpaid sale invoices with due dates), `payments` (historical collection timing), `expenses` (recent patterns), `bank_accounts` (current balances)

**Query approach**:
- Bucket unpaid sale invoice balances by how many days until/since due date
- Derive a historical collection rate: for invoices that ARE paid, what fraction were paid within 7 days of due date vs within 30 days
- Apply that rate to the open pipeline to produce an "expected" cash inflow
- Add current bank account balances as the starting position
- Subtract projected expenses based on recent daily average

```ts
// Step 1: Open receivables bucketed by due date proximity
const openReceivables = await db.select({
  bucket: sql<string>`
    CASE
      WHEN due_date IS NULL THEN 'no_due_date'
      WHEN due_date <= NOW() THEN 'overdue'
      WHEN due_date <= NOW() + INTERVAL '7 days' THEN '7d'
      WHEN due_date <= NOW() + INTERVAL '14 days' THEN '14d'
      WHEN due_date <= NOW() + INTERVAL '30 days' THEN '30d'
      ELSE 'beyond_30d'
    END`,
  totalDue: sql<string>`SUM((${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric))::text`,
  invoiceCount: sql<number>`COUNT(*)::int`,
}).from(invoices)
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "sale"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`,
    sql`${invoices.deletedAt} IS NULL`,
  ))
  .groupBy(sql`1`);

// Step 2: Historical collection rate (last 90 days of PAID invoices)
// What % of invoices were paid within 7d / 14d / 30d of due date?
const historicalRates = await db.execute(sql`
  SELECT
    COUNT(*) FILTER (WHERE payment_date <= due_date + INTERVAL '7 days')::numeric
      / NULLIF(COUNT(*), 0) AS rate_7d,
    COUNT(*) FILTER (WHERE payment_date <= due_date + INTERVAL '14 days')::numeric
      / NULLIF(COUNT(*), 0) AS rate_14d,
    COUNT(*) FILTER (WHERE payment_date <= due_date + INTERVAL '30 days')::numeric
      / NULLIF(COUNT(*), 0) AS rate_30d
  FROM invoices i
  JOIN payments p ON p.invoice_id = i.id
  WHERE i.business_id = ${businessId}
    AND i.type = 'sale'
    AND i.status = 'paid'
    AND i.due_date IS NOT NULL
    AND i.deleted_at IS NULL
    AND p.deleted_at IS NULL
    AND i.invoice_date >= NOW() - INTERVAL '90 days'
`);

// Step 3: Fetch total bank balance as current cash position
const [bankBalance] = await db.select({
  total: sql<string>`COALESCE(SUM(${bankAccounts.currentBalance}::numeric), 0)::text`,
}).from(bankAccounts)
  .where(eq(bankAccounts.businessId, businessId));

// Step 4: Average daily expenses (last 30 days)
const [avgDailyExpense] = await db.select({
  avgDaily: sql<string>`(COALESCE(SUM(${expenses.amount}::numeric), 0) / 30)::text`,
}).from(expenses)
  .where(and(
    eq(expenses.businessId, businessId),
    sql`${expenses.deletedAt} IS NULL`,
    gte(expenses.expenseDate, sql`NOW() - INTERVAL '30 days'`),
  ));
```

**tRPC procedure**: `reports.cashFlowForecast`

**Input**:
```ts
z.object({}) // no params -- always forward-looking from today
```

**Output**:
```ts
{
  currentCashPosition: string;            // bank balances total
  avgDailyExpense: string;
  projectedExpenses30d: string;           // avgDailyExpense * 30
  collectionRates: {
    rate7d: string;                       // 0.00 - 1.00
    rate14d: string;
    rate30d: string;
    sampleSize: number;                   // paid invoice count used for rates
  };
  receivableBuckets: Array<{
    bucket: "overdue" | "7d" | "14d" | "30d" | "beyond_30d" | "no_due_date";
    totalDue: string;
    invoiceCount: number;
  }>;
  forecast: Array<{
    day: string;                          // ISO date
    optimistic: string;                   // 100% collection
    expected: string;                     // historical rate applied
    conservative: string;                 // 50% of expected
  }>;
  lowConfidence: boolean;                 // true if < 10 paid invoices with due dates
}
```

**Role**: Admin, Accountant
**Widget type**: Line chart with 3 lines -- "optimistic" (100% collection of due amounts), "expected" (historical rate applied), "conservative" (50% of expected). X-axis: today, +7d, +14d, +30d. Y-axis: cumulative cash position.
**Dashboard position**: Top section, full width -- this is the #1 question for any business owner
**Priority**: High

**Limitations**: Collection rates are estimated from historical invoices; businesses with few paid invoices will have unreliable rates. Show a "low confidence" flag if fewer than 10 paid invoices with due dates exist.

---

### 1.2 Days Sales Outstanding (DSO)

**Data sources**: `invoices` (sale invoices), `payments`

**DSO formula**: (Average receivables / Total credit sales in period) * Days in period

```ts
const dso = await db.execute(sql`
  WITH period_sales AS (
    SELECT
      SUM(total_amount::numeric) AS total_sales,
      -- average receivables = average of (total - paid) across the period
      AVG(total_amount::numeric - amount_paid::numeric) AS avg_receivable
    FROM invoices
    WHERE business_id = ${businessId}
      AND type = 'sale'
      AND document_type = 'invoice'
      AND status NOT IN ('draft', 'cancelled')
      AND deleted_at IS NULL
      AND invoice_date >= ${periodStart}::timestamptz
      AND invoice_date <= ${periodEnd}::timestamptz
  )
  SELECT
    ROUND(
      avg_receivable / NULLIF(total_sales, 0)
        * ${daysInPeriod}::numeric,
      1
    ) AS dso_days,
    total_sales::text,
    avg_receivable::text
  FROM period_sales
`);
```

**tRPC procedure**: `reports.dso`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
})
```

**Output**:
```ts
{
  dsoDays: string;                       // e.g. "23.5"
  totalSales: string;
  avgReceivable: string;
  daysInPeriod: number;
  previousPeriodDso: string | null;       // for trend comparison
  trend: "improving" | "stable" | "worsening";
}
```

**Role**: Admin, Accountant
**Widget type**: Single large number ("23 days") with a trend arrow vs previous period. Benchmark: 30 days is healthy for most Indian SMBs; flag red if > 45 days.
**Dashboard position**: Second row KPI cards
**Priority**: High

---

### 1.3 Collection Efficiency

**Data sources**: `invoices` (sale invoices with `due_date`), `payments` (via `invoice_id`)

**Query approach**: For paid invoices with a due date, compare the last payment date against due date. For unpaid invoices with a past due date, count as 0% collected on time.

```ts
const collectionEfficiency = await db.execute(sql`
  WITH paid_invoices AS (
    SELECT
      i.id,
      i.due_date,
      i.total_amount::numeric AS total,
      i.amount_paid::numeric AS paid,
      MAX(p.payment_date) AS last_payment_date
    FROM invoices i
    LEFT JOIN payments p ON p.invoice_id = i.id
      AND p.business_id = ${businessId}
      AND p.deleted_at IS NULL
    WHERE i.business_id = ${businessId}
      AND i.type = 'sale'
      AND i.document_type = 'invoice'
      AND i.status = 'paid'
      AND i.due_date IS NOT NULL
      AND i.deleted_at IS NULL
      AND i.invoice_date >= ${periodStart}::timestamptz
      AND i.invoice_date <= ${periodEnd}::timestamptz
    GROUP BY i.id, i.due_date, i.total_amount, i.amount_paid
  )
  SELECT
    COUNT(*) AS total_invoices,
    COUNT(*) FILTER (WHERE last_payment_date <= due_date) AS paid_on_time,
    COUNT(*) FILTER (WHERE last_payment_date > due_date) AS paid_late,
    ROUND(
      COUNT(*) FILTER (WHERE last_payment_date <= due_date)::numeric
        / NULLIF(COUNT(*), 0) * 100,
      1
    ) AS on_time_rate,
    ROUND(
      SUM(CASE WHEN last_payment_date <= due_date THEN paid ELSE 0 END)
        / NULLIF(SUM(total), 0) * 100,
      1
    ) AS on_time_amount_pct
  FROM paid_invoices
`);
```

**tRPC procedure**: `reports.collectionEfficiency`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
})
```

**Output**:
```ts
{
  totalInvoices: number;
  paidOnTime: number;
  paidLate: number;
  onTimeRate: string;                    // percentage, e.g. "78.5"
  onTimeAmountPct: string;              // % of total value collected on time
  previousPeriodRate: string | null;
}
```

**Role**: Admin, Accountant
**Widget type**: KPI card with a donut showing on-time vs late %. Secondary metric shows count of invoices in each bucket.
**Dashboard position**: Second row, alongside DSO
**Priority**: High

---

### 1.4 Inventory Turnover

**Data sources**: `invoices` + `invoice_items` (for COGS approximation via purchase invoices), `items` (current stock + `purchase_price`), `item_variants`

**Inventory turnover formula**: COGS / Average Inventory Value

Since purchase invoices exist in the system, COGS can be approximated as total purchase invoice amount for the period. Average inventory value = sum of (`items.stock_quantity` * `items.purchase_price`) plus variant stock.

```ts
// COGS: total purchase invoice amounts in period
const [cogs] = await db.select({
  total: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)::text`,
}).from(invoices)
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "purchase"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, periodStart),
    lte(invoices.invoiceDate, periodEnd),
  ));

// Current inventory value (simple items -- excludes items with item_mode='variants')
const [simpleInvValue] = await db.select({
  total: sql<string>`
    COALESCE(SUM(
      CASE
        WHEN ${items.purchasePrice} IS NOT NULL
        THEN ${items.stockQuantity}::numeric * ${items.purchasePrice}::numeric
        ELSE 0
      END
    ), 0)::text`,
}).from(items)
  .where(and(
    eq(items.businessId, businessId),
    eq(items.itemType, "product"),
    sql`${items.itemMode} != 'variants'`,
  ));

// Variant inventory value
const [variantInvValue] = await db.select({
  total: sql<string>`
    COALESCE(SUM(
      CASE
        WHEN ${itemVariants.purchasePrice} IS NOT NULL
        THEN ${itemVariants.stockQuantity}::numeric * ${itemVariants.purchasePrice}::numeric
        ELSE 0
      END
    ), 0)::text`,
}).from(itemVariants)
  .innerJoin(items, eq(items.id, itemVariants.itemId))
  .where(eq(items.businessId, businessId));

// turnoverRatio = COGS / avgInventoryValue
// For simplicity, use current inventory as "average" (no historical snapshots)
```

**tRPC procedure**: `reports.inventoryTurnover`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
})
```

**Output**:
```ts
{
  cogs: string;
  currentInventoryValue: string;         // simple + variant combined
  turnoverRatio: string;                 // e.g. "4.2"
  daysInInventory: string;               // 365 / turnoverRatio
  previousPeriodRatio: string | null;
}
```

**Role**: Admin, Accountant
**Widget type**: KPI card: "Inventory Turns: 4.2x" with a small bar showing industry benchmark. Only show for businesses with product items (`item_type = 'product'`) and purchase invoices.
**Dashboard position**: Third row, inventory section
**Priority**: Medium -- only relevant for product businesses

**Limitation**: This uses total purchase invoice amount as COGS proxy. A business with services or mixed product/service invoices will see inflated COGS. The widget should only render when the business has product items with purchase prices set.

---

### 1.5 Gross Margin by Item/Category

**Data sources**: `invoice_items` (sale invoices, unit price), `items` (`purchase_price` as cost basis)

**Query approach**: For each item sold, compute (sale revenue - estimated cost) / sale revenue. The `purchase_price` on the `items` table is used as cost basis (most recent purchase price). This is an approximation -- without a proper FIFO/weighted average cost layer, exact margin per sale is not available.

```ts
const itemMargins = await db.select({
  itemId: invoiceItems.itemId,
  itemName: sql<string>`COALESCE(${items.name}, ${invoiceItems.description})`,
  category: items.category,
  totalRevenue: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
  estimatedCost: sql<string>`
    SUM(
      ${invoiceItems.quantity}::numeric
      * COALESCE(${invoiceItems.conversionFactor}::numeric, 1)
      * COALESCE(${items.purchasePrice}::numeric, 0)
    )::text`,
  grossMargin: sql<string>`
    ROUND(
      (SUM(${invoiceItems.totalAmount}::numeric)
        - SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0)))
      / NULLIF(SUM(${invoiceItems.totalAmount}::numeric), 0) * 100,
      1
    )::text`,
  soldQty: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1))::text`,
})
  .from(invoiceItems)
  .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
  .leftJoin(items, eq(items.id, invoiceItems.itemId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "sale"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, periodStart),
    lte(invoices.invoiceDate, periodEnd),
  ))
  .groupBy(invoiceItems.itemId, items.name, items.category, invoiceItems.description)
  .orderBy(sql`SUM(${invoiceItems.totalAmount}::numeric) DESC`)
  .limit(20);
```

**Role**: Admin, Accountant
**Widget type**: Horizontal bar chart, sorted by revenue, with margin % overlaid as a secondary label. Color-code: red < 10%, amber 10-25%, green > 25%.
**Dashboard position**: Third row, expandable panel
**Priority**: Medium

**Caveat displayed to user**: "Margin is estimated using the current purchase price on file. It will be inaccurate if purchase prices have changed over time."

---

### 1.6 Revenue Concentration Risk

**Data sources**: `invoices` + `parties` (sale invoices grouped by customer)

```ts
const revenueConcentration = await db.execute(sql`
  WITH customer_revenue AS (
    SELECT
      p.id AS party_id,
      p.name AS party_name,
      SUM(i.total_amount::numeric) AS revenue,
      COUNT(i.id) AS invoice_count
    FROM invoices i
    JOIN parties p ON p.id = i.party_id
    WHERE i.business_id = ${businessId}
      AND i.type = 'sale'
      AND i.document_type = 'invoice'
      AND i.status NOT IN ('draft', 'cancelled')
      AND i.deleted_at IS NULL
      AND i.invoice_date >= ${periodStart}::timestamptz
      AND i.invoice_date <= ${periodEnd}::timestamptz
    GROUP BY p.id, p.name
  ),
  totals AS (
    SELECT SUM(revenue) AS grand_total FROM customer_revenue
  )
  SELECT
    cr.party_id,
    cr.party_name,
    cr.revenue::text,
    cr.invoice_count::int,
    ROUND(cr.revenue / NULLIF(t.grand_total, 0) * 100, 1) AS revenue_pct,
    ROW_NUMBER() OVER (ORDER BY cr.revenue DESC) AS rank
  FROM customer_revenue cr, totals t
  ORDER BY cr.revenue DESC
  LIMIT 10
`);

// Compute top-3 and top-5 concentration on the API side
const top3Pct = rows.slice(0, 3).reduce((sum, r) => sum + parseFloat(r.revenue_pct), 0);
```

**Role**: Admin
**Widget type**: Stacked donut chart -- top customer, 2nd, 3rd, rest. If top 3 > 60% of revenue, show an amber warning. If > 80%, show red "High concentration risk" badge.
**Dashboard position**: Bottom section, strategic insights panel
**Priority**: Medium

---

## Part 2 -- New Report Types

### 2.1 Daybook / Daily Transaction Register

**Purpose**: One-stop view of everything that happened on a given date -- exactly what an Indian accountant expects to see at end of day.

**Data sources**: `invoices` (all types), `payments`, `expenses`

**tRPC procedure**: `reports.daybook`

**Input**:
```ts
z.object({
  date: z.string().date(),                // YYYY-MM-DD
  typeFilter: z.enum(["all", "invoices", "payments", "expenses"]).default("all"),
})
```

**Query approach**: Three parallel queries filtered by the single date, then merge and sort chronologically.

```ts
const dayStart = new Date(`${input.date}T00:00:00`);
const dayEnd = new Date(`${input.date}T23:59:59.999`);

const [dayInvoices, dayPayments, dayExpenses] = await Promise.all([
  // Invoices created on this date
  input.typeFilter === "payments" || input.typeFilter === "expenses" ? [] :
  ctx.db.select({
    id: invoices.id,
    time: invoices.invoiceDate,
    number: invoices.invoiceNumber,
    type: invoices.type,
    documentType: invoices.documentType,
    partyName: parties.name,
    totalAmount: invoices.totalAmount,
    taxAmount: invoices.taxAmount,
    status: invoices.status,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, ctx.businessId),
      gte(invoices.invoiceDate, dayStart),
      lte(invoices.invoiceDate, dayEnd),
      sql`${invoices.deletedAt} IS NULL`,
    ))
    .orderBy(invoices.invoiceDate),

  // Payments on this date
  input.typeFilter === "invoices" || input.typeFilter === "expenses" ? [] :
  ctx.db.select({
    id: payments.id,
    time: payments.paymentDate,
    number: payments.paymentNumber,
    partyName: parties.name,
    partyType: parties.type,
    amount: payments.amount,
    mode: payments.mode,
  }).from(payments)
    .innerJoin(parties, eq(parties.id, payments.partyId))
    .where(and(
      eq(payments.businessId, ctx.businessId),
      gte(payments.paymentDate, dayStart),
      lte(payments.paymentDate, dayEnd),
      sql`${payments.deletedAt} IS NULL`,
    ))
    .orderBy(payments.paymentDate),

  // Expenses on this date
  input.typeFilter === "invoices" || input.typeFilter === "payments" ? [] :
  ctx.db.select({
    id: expenses.id,
    time: expenses.expenseDate,
    category: expenses.category,
    description: expenses.description,
    amount: expenses.amount,
    mode: expenses.mode,
  }).from(expenses)
    .where(and(
      eq(expenses.businessId, ctx.businessId),
      gte(expenses.expenseDate, dayStart),
      lte(expenses.expenseDate, dayEnd),
      sql`${expenses.deletedAt} IS NULL`,
    ))
    .orderBy(expenses.expenseDate),
]);

// Merge into unified entries, compute day totals
```

**Output**:
```ts
{
  date: string;
  entries: Array<{
    time: string;                        // ISO datetime
    entryType: "sale_invoice" | "purchase_invoice" | "credit_note" | "debit_note"
             | "payment_received" | "payment_made" | "expense";
    documentNumber: string | null;
    partyOrCategory: string;
    debit: string;                       // amount in debit column
    credit: string;                      // amount in credit column
    mode: string | null;                 // payment mode if applicable
    status: string | null;
  }>;
  totals: {
    salesInvoiced: string;
    purchasesInvoiced: string;
    paymentsReceived: string;
    paymentsMade: string;
    expensesTotal: string;
    netCashMovement: string;             // received - made - expenses
  };
}
```

**Summary totals**: Total sales invoiced, total purchases invoiced, total payments received, total payments made, total expenses, net cash movement.

**Export**: CSV (columns: Date, Time, Type, Doc#, Party/Category, Debit, Credit, Mode) + PDF (formatted as a traditional daybook register)

**Role**: Admin, Accountant
**Priority**: High -- Indian accountants use this daily

---

### 2.2 Purchase Register

**Purpose**: All purchase invoices for a period grouped by supplier. Required for GST input tax credit reconciliation.

**Data sources**: `invoices` (type='purchase', document_type='invoice'), `invoice_items`, `parties`

**tRPC procedure**: `reports.purchaseRegister`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  partyId: z.string().uuid().optional(),    // filter by specific supplier
  taxPercent: z.string().optional(),        // filter by specific GST rate
})
```

**Query approach**:

```ts
const purchaseRegister = await db.select({
  invoiceId: invoices.id,
  invoiceDate: invoices.invoiceDate,
  invoiceNumber: invoices.invoiceNumber,
  supplierName: parties.name,
  supplierGstin: parties.gstin,
  subtotal: invoices.subtotal,
  discountAmount: invoices.discountAmount,
  taxAmount: invoices.taxAmount,
  additionalCharges: invoices.additionalCharges,
  roundOff: invoices.roundOff,
  totalAmount: invoices.totalAmount,
  amountPaid: invoices.amountPaid,
  status: invoices.status,
}).from(invoices)
  .innerJoin(parties, eq(parties.id, invoices.partyId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "purchase"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} != 'cancelled'`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
    ...(partyId ? [eq(invoices.partyId, partyId)] : []),
  ))
  .orderBy(invoices.invoiceDate);

// Per-invoice tax rate breakdown (for CGST/SGST/IGST split)
const taxBreakdown = await db.select({
  invoiceId: invoiceItems.invoiceId,
  taxPercent: invoiceItems.taxPercent,
  taxableAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric)::text`,
  taxAmount: sql<string>`SUM(${invoiceItems.taxAmount}::numeric)::text`,
}).from(invoiceItems)
  .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "purchase"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} != 'cancelled'`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
  ))
  .groupBy(invoiceItems.invoiceId, invoiceItems.taxPercent);
```

**Output**:
```ts
{
  invoices: Array<{
    invoiceId: string;
    invoiceDate: string;
    invoiceNumber: string;
    supplierName: string;
    supplierGstin: string | null;
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    amountPaid: string;
    outstanding: string;                 // totalAmount - amountPaid
    status: string;
    taxBreakdown: Array<{
      taxPercent: string;
      taxableAmount: string;
      taxAmount: string;
    }>;
  }>;
  summary: {
    totalInvoices: number;
    totalSubtotal: string;
    totalTax: string;
    totalAmount: string;
    totalPaid: string;
    totalOutstanding: string;
  };
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant
**Priority**: High -- statutory requirement for GST-registered businesses

---

### 2.3 Sales Register

**Purpose**: Mirror of Purchase Register for outward supplies. Used for GST GSTR-1 preparation and revenue analysis.

**Data sources**: `invoices` (type='sale'), `invoice_items`, `parties`, `items` (for HSN)

**tRPC procedure**: `reports.salesRegister`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  partyId: z.string().uuid().optional(),
  documentType: z.enum(["invoice", "credit_note", "debit_note"]).optional(),
})
```

**Query approach**:

```ts
const salesRegister = await db.select({
  invoiceId: invoices.id,
  invoiceDate: invoices.invoiceDate,
  invoiceNumber: invoices.invoiceNumber,
  documentType: invoices.documentType,
  customerName: parties.name,
  customerGstin: parties.gstin,
  customerState: parties.state,
  customerStateCode: parties.stateCode,
  subtotal: invoices.subtotal,
  discountAmount: invoices.discountAmount,
  taxAmount: invoices.taxAmount,
  additionalCharges: invoices.additionalCharges,
  roundOff: invoices.roundOff,
  totalAmount: invoices.totalAmount,
  amountPaid: invoices.amountPaid,
  status: invoices.status,
  createdByName: invoices.createdByName,
}).from(invoices)
  .innerJoin(parties, eq(parties.id, invoices.partyId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "sale"),
    sql`${invoices.documentType} IN ('invoice', 'credit_note', 'debit_note')`,
    sql`${invoices.status} != 'cancelled'`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
    ...(partyId ? [eq(invoices.partyId, partyId)] : []),
    ...(documentType ? [eq(invoices.documentType, documentType)] : []),
  ))
  .orderBy(invoices.invoiceDate);
```

**Output**: Same structure as Purchase Register with additional fields: `customerState`, `customerStateCode`, `documentType`, `createdByName`.

**Export**: CSV + PDF
**Role**: Admin, Accountant, Seller (own customers only -- scoped by `created_by_user_id`)
**Priority**: High

---

### 2.4 Stock Summary Report

**Purpose**: Point-in-time view of all inventory with valuation at cost and at sale price. Used for balance sheet, insurance, and stock audits.

**Data sources**: `items`, `item_variants`

**tRPC procedure**: `reports.stockSummary`

**Input**:
```ts
z.object({
  category: z.string().optional(),
  showZeroStock: z.boolean().default(false),
  sortBy: z.enum(["name", "stock", "value"]).default("name"),
})
```

**Note on historical dates**: The `items.stock_quantity` reflects current stock. Computing historical stock as-of a past date requires replaying all `invoice_items` and `stock_adjustments` since that date, which is expensive. For the initial implementation, only "as of today" is supported.

**Query approach**:

```ts
// Simple items (item_mode != 'variants')
const simpleStock = await db.select({
  itemId: items.id,
  itemName: items.name,
  category: items.category,
  hsn: items.hsn,
  unit: items.unit,
  currentStock: items.stockQuantity,
  purchasePrice: items.purchasePrice,
  salePrice: items.salePrice,
  costValue: sql<string>`
    ROUND(${items.stockQuantity}::numeric * COALESCE(${items.purchasePrice}::numeric, 0), 2)::text`,
  saleValue: sql<string>`
    ROUND(${items.stockQuantity}::numeric * COALESCE(${items.salePrice}::numeric, 0), 2)::text`,
  lowStockAlert: items.lowStockAlert,
  isLowStock: sql<boolean>`
    ${items.lowStockAlert} IS NOT NULL
    AND ${items.stockQuantity}::numeric <= ${items.lowStockAlert}::numeric`,
}).from(items)
  .where(and(
    eq(items.businessId, businessId),
    eq(items.itemType, "product"),
    sql`${items.itemMode} != 'variants'`,
    ...(showZeroStock ? [] : [sql`${items.stockQuantity}::numeric != 0`]),
    ...(category ? [eq(items.category, category)] : []),
  ))
  .orderBy(items.name);

// Variant items -- one row per item, with variant details aggregated via JSON_AGG
const variantStock = await db.select({
  itemId: items.id,
  itemName: items.name,
  category: items.category,
  hsn: items.hsn,
  unit: items.unit,
  variantDetails: sql<string>`
    JSON_AGG(
      JSON_BUILD_OBJECT(
        'variantId', ${itemVariants.id},
        'sku', ${itemVariants.sku},
        'attributes', ${itemVariants.attributeValues},
        'stock', ${itemVariants.stockQuantity},
        'purchasePrice', ${itemVariants.purchasePrice},
        'salePrice', ${itemVariants.salePrice},
        'costValue', ROUND(${itemVariants.stockQuantity}::numeric * COALESCE(${itemVariants.purchasePrice}::numeric, 0), 2),
        'saleValue', ROUND(${itemVariants.stockQuantity}::numeric * COALESCE(${itemVariants.salePrice}::numeric, 0), 2),
        'isLowStock', (${itemVariants.lowStockAlert} IS NOT NULL
          AND ${itemVariants.stockQuantity}::numeric <= ${itemVariants.lowStockAlert}::numeric)
      ) ORDER BY ${itemVariants.createdAt}
    )`,
  totalStock: sql<string>`SUM(${itemVariants.stockQuantity}::numeric)::text`,
  totalCostValue: sql<string>`
    ROUND(SUM(${itemVariants.stockQuantity}::numeric * COALESCE(${itemVariants.purchasePrice}::numeric, 0)), 2)::text`,
  totalSaleValue: sql<string>`
    ROUND(SUM(${itemVariants.stockQuantity}::numeric * COALESCE(${itemVariants.salePrice}::numeric, 0)), 2)::text`,
}).from(items)
  .innerJoin(itemVariants, eq(itemVariants.itemId, items.id))
  .where(and(
    eq(items.businessId, businessId),
    eq(items.itemType, "product"),
    eq(items.itemMode, "variants"),
    ...(category ? [eq(items.category, category)] : []),
  ))
  .groupBy(items.id, items.name, items.category, items.hsn, items.unit)
  .having(showZeroStock ? sql`TRUE` : sql`SUM(${itemVariants.stockQuantity}::numeric) != 0`);
```

**Output**:
```ts
{
  items: Array<{
    itemId: string;
    itemName: string;
    category: string | null;
    hsn: string | null;
    unit: string;
    currentStock: string;
    purchasePrice: string | null;
    salePrice: string | null;
    costValue: string;                   // stock * purchasePrice
    saleValue: string;                   // stock * salePrice
    isLowStock: boolean;
    lowStockAlert: string | null;
    variants?: Array<{                   // only for variant items
      variantId: string;
      sku: string | null;
      attributes: Record<string, string>;
      stock: string;
      purchasePrice: string | null;
      salePrice: string | null;
      costValue: string;
      saleValue: string;
      isLowStock: boolean;
    }>;
  }>;
  categorySummary: Array<{
    category: string;
    itemCount: number;
    totalCostValue: string;
    totalSaleValue: string;
  }>;
  grandTotal: {
    itemCount: number;
    totalCostValue: string;              // total valuation at purchase price
    totalSaleValue: string;              // total valuation at sale price
    lowStockCount: number;               // items below their alert threshold
  };
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant
**Priority**: High

---

### 2.5 Payment Summary

**Purpose**: All payments received/made, grouped by payment mode. Used for bank reconciliation and daily cash counts.

**Data sources**: `payments`, `expenses`, `parties`, `bank_accounts`

**tRPC procedure**: `reports.paymentSummary`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  type: z.enum(["received", "made", "both"]).default("both"),
  mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).optional(),
  bankAccountId: z.string().uuid().optional(),
})
```

**Query approach**:

```ts
// Payment receipts and disbursements grouped by mode
const paymentsByMode = await db.select({
  mode: payments.mode,
  bankAccountId: payments.bankAccountId,
  bankAccountName: bankAccounts.accountName,
  count: sql<number>`COUNT(*)::int`,
  totalAmount: sql<string>`SUM(${payments.amount}::numeric)::text`,
  totalDiscount: sql<string>`SUM(${payments.discount}::numeric)::text`,
  // Breakdown by party type to separate customer (received) vs supplier (made)
  customerPayments: sql<string>`
    SUM(CASE WHEN ${parties.type} = 'customer' THEN ${payments.amount}::numeric ELSE 0 END)::text`,
  supplierPayments: sql<string>`
    SUM(CASE WHEN ${parties.type} = 'supplier' THEN ${payments.amount}::numeric ELSE 0 END)::text`,
}).from(payments)
  .innerJoin(parties, eq(parties.id, payments.partyId))
  .leftJoin(bankAccounts, eq(bankAccounts.id, payments.bankAccountId))
  .where(and(
    eq(payments.businessId, businessId),
    sql`${payments.deletedAt} IS NULL`,
    gte(payments.paymentDate, new Date(fromDate)),
    lte(payments.paymentDate, new Date(toDate)),
    ...(mode ? [eq(payments.mode, mode)] : []),
    ...(bankAccountId ? [eq(payments.bankAccountId, bankAccountId)] : []),
  ))
  .groupBy(payments.mode, payments.bankAccountId, bankAccounts.accountName)
  .orderBy(sql`SUM(${payments.amount}::numeric) DESC`);

// Expense cash outflows (not linked to purchase invoices)
const expensesByMode = await db.select({
  mode: expenses.mode,
  count: sql<number>`COUNT(*)::int`,
  totalAmount: sql<string>`SUM(${expenses.amount}::numeric)::text`,
}).from(expenses)
  .where(and(
    eq(expenses.businessId, businessId),
    sql`${expenses.deletedAt} IS NULL`,
    gte(expenses.expenseDate, new Date(fromDate)),
    lte(expenses.expenseDate, new Date(toDate)),
    ...(mode ? [eq(expenses.mode, mode)] : []),
  ))
  .groupBy(expenses.mode);
```

**Output**:
```ts
{
  payments: Array<{
    mode: string;                        // "cash" | "bank" | "upi" | "cheque" | "other"
    bankAccountName: string | null;
    count: number;
    totalAmount: string;
    totalDiscount: string;
    received: string;                    // customer payments (money in)
    paid: string;                        // supplier payments (money out)
  }>;
  expenses: Array<{
    mode: string;
    count: number;
    totalAmount: string;
  }>;
  summary: {
    totalReceived: string;
    totalPaid: string;
    totalExpenses: string;
    netCashFlow: string;                 // received - paid - expenses
  };
  modeBreakdown: Array<{                // for pie chart
    mode: string;
    amount: string;
    percentage: string;
  }>;
}
```

**Export**: CSV
**Role**: Admin, Accountant
**Priority**: High

---

### 2.6 Party Statement (Ledger)

**Purpose**: Formal account statement for a single party. Shows opening balance, all invoices, all payments, running balance, and closing balance.

**Note**: `party.ledgerReport` already exists. The enhancement needed is:
1. PDF export with business letterhead format suitable for sending to the party
2. Inclusion of opening balance and proper running balance calculation
3. Email/WhatsApp share button on the frontend

**Data sources**: `invoices`, `payments`, `parties`, `businesses` (for letterhead)

**tRPC procedure**: `reports.partyStatement`

**Input**:
```ts
z.object({
  partyId: z.string().uuid(),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
})
```

**Query approach**:

```ts
// Get party details including opening balance
const [party] = await db.select({
  id: parties.id,
  name: parties.name,
  type: parties.type,
  phone: parties.phone,
  email: parties.email,
  billingAddress: parties.billingAddress,
  gstin: parties.gstin,
  openingBalance: parties.openingBalance,
}).from(parties)
  .where(and(
    eq(parties.id, partyId),
    eq(parties.businessId, businessId),
  ));

// All invoices for this party in date range
const partyInvoices = await db.select({
  id: invoices.id,
  date: invoices.invoiceDate,
  invoiceNumber: invoices.invoiceNumber,
  type: invoices.type,
  documentType: invoices.documentType,
  totalAmount: invoices.totalAmount,
  status: invoices.status,
}).from(invoices)
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.partyId, partyId),
    sql`${invoices.deletedAt} IS NULL`,
    sql`${invoices.status} != 'cancelled'`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
  ))
  .orderBy(invoices.invoiceDate);

// All payments for this party in date range
const partyPayments = await db.select({
  id: payments.id,
  date: payments.paymentDate,
  paymentNumber: payments.paymentNumber,
  amount: payments.amount,
  discount: payments.discount,
  mode: payments.mode,
  referenceNumber: payments.referenceNumber,
}).from(payments)
  .where(and(
    eq(payments.businessId, businessId),
    eq(payments.partyId, partyId),
    sql`${payments.deletedAt} IS NULL`,
    gte(payments.paymentDate, new Date(fromDate)),
    lte(payments.paymentDate, new Date(toDate)),
  ))
  .orderBy(payments.paymentDate);

// Compute pre-period balance: opening_balance + invoices before fromDate - payments before fromDate
const [prePeriod] = await db.execute(sql`
  SELECT
    COALESCE((
      SELECT SUM(total_amount::numeric)
      FROM invoices
      WHERE business_id = ${businessId}
        AND party_id = ${partyId}
        AND type = ${party.type === 'customer' ? 'sale' : 'purchase'}
        AND document_type = 'invoice'
        AND status != 'cancelled'
        AND deleted_at IS NULL
        AND invoice_date < ${fromDate}::timestamptz
    ), 0) AS invoiced_before,
    COALESCE((
      SELECT SUM(amount::numeric)
      FROM payments
      WHERE business_id = ${businessId}
        AND party_id = ${partyId}
        AND deleted_at IS NULL
        AND payment_date < ${fromDate}::timestamptz
    ), 0) AS paid_before
`);

// openingBalanceForPeriod = party.openingBalance + invoiced_before - paid_before
// Then merge invoices and payments, sort chronologically, compute running balance
```

**Output**:
```ts
{
  party: {
    id: string;
    name: string;
    type: "customer" | "supplier";
    phone: string | null;
    billingAddress: string | null;
    gstin: string | null;
  };
  openingBalance: string;                // balance at start of period (includes all prior activity)
  entries: Array<{
    date: string;
    entryType: "invoice" | "credit_note" | "debit_note" | "payment";
    documentNumber: string;
    description: string;                 // e.g. "Sale Invoice" / "Payment - UPI"
    debit: string;                       // for customer: invoice = debit, payment = credit
    credit: string;
    runningBalance: string;
  }>;
  closingBalance: string;
  periodSummary: {
    totalInvoiced: string;
    totalPayments: string;
    totalDiscount: string;
  };
}
```

**Export**: PDF with business letterhead
**Role**: Admin, Accountant, Member (own party data)
**Priority**: High -- heavily used in Indian B2B relationships

---

### 2.7 Seller Performance Report

**Purpose**: Orders by seller, total value, target achievement %. Requires `sales_targets` table and invoice creator tracking via `created_by_user_id`.

**Critical assumption**: "Seller" = user who created the invoice (`created_by_user_id`). The app does not have a dedicated sellers table -- users are in the control schema. Seller analytics join on `created_by_user_id` and group by `created_by_name` for display.

**Data sources**: `invoices`, `sales_targets`, `invoice_items`

**tRPC procedure**: `reports.sellerPerformance`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  userId: z.string().uuid().optional(),   // filter to specific seller
  rankBy: z.enum(["revenue", "order_count", "item_quantity"]).default("revenue"),
})
```

**Query approach**:

```ts
// Seller leaderboard
const sellerLeaderboard = await db.select({
  userId: invoices.createdByUserId,
  sellerName: invoices.createdByName,
  totalRevenue: sql<string>`SUM(${invoices.totalAmount}::numeric)::text`,
  orderCount: sql<number>`COUNT(*)::int`,
  uniqueCustomers: sql<number>`COUNT(DISTINCT ${invoices.partyId})::int`,
  avgOrderValue: sql<string>`ROUND(SUM(${invoices.totalAmount}::numeric) / COUNT(*), 2)::text`,
}).from(invoices)
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "sale"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
    sql`${invoices.deletedAt} IS NULL`,
    sql`${invoices.createdByUserId} IS NOT NULL`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
    ...(userId ? [eq(invoices.createdByUserId, userId)] : []),
  ))
  .groupBy(invoices.createdByUserId, invoices.createdByName)
  .orderBy(sql`SUM(${invoices.totalAmount}::numeric) DESC`);

// Target achievement for each seller
const targetAchievement = await db.execute(sql`
  SELECT
    st.id AS target_id,
    st.user_id,
    st.target_type,
    st.target_value::numeric AS target,
    st.period_start,
    st.period_end,
    st.item_id,
    CASE st.target_type
      WHEN 'order_value' THEN
        COALESCE((
          SELECT SUM(total_amount::numeric)
          FROM invoices
          WHERE business_id = ${businessId}
            AND created_by_user_id = st.user_id
            AND type = 'sale'
            AND document_type = 'invoice'
            AND status NOT IN ('draft', 'cancelled')
            AND deleted_at IS NULL
            AND invoice_date >= st.period_start
            AND invoice_date <= st.period_end
        ), 0)
      WHEN 'order_count' THEN
        COALESCE((
          SELECT COUNT(*)::numeric
          FROM invoices
          WHERE business_id = ${businessId}
            AND created_by_user_id = st.user_id
            AND type = 'sale'
            AND document_type = 'invoice'
            AND status NOT IN ('draft', 'cancelled')
            AND deleted_at IS NULL
            AND invoice_date >= st.period_start
            AND invoice_date <= st.period_end
        ), 0)
      WHEN 'item_quantity' THEN
        COALESCE((
          SELECT SUM(ii.quantity::numeric * COALESCE(ii.conversion_factor::numeric, 1))
          FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id
          WHERE i.business_id = ${businessId}
            AND i.created_by_user_id = st.user_id
            AND i.type = 'sale'
            AND i.document_type = 'invoice'
            AND i.status NOT IN ('draft', 'cancelled')
            AND i.deleted_at IS NULL
            AND i.invoice_date >= st.period_start
            AND i.invoice_date <= st.period_end
            AND (st.item_id IS NULL OR ii.item_id = st.item_id)
        ), 0)
    END AS actual_value
  FROM sales_targets st
  WHERE st.business_id = ${businessId}
    AND st.period_start >= ${fromDate}::timestamptz
    AND st.period_end <= ${toDate}::timestamptz
  ORDER BY st.period_start DESC
`);
```

**Output**:
```ts
{
  sellers: Array<{
    userId: string;
    sellerName: string;
    totalRevenue: string;
    orderCount: number;
    uniqueCustomers: number;
    avgOrderValue: string;
    rank: number;
    targets: Array<{
      targetId: string;
      targetType: "order_count" | "order_value" | "item_quantity";
      targetValue: string;
      actualValue: string;
      achievementPct: string;            // (actual / target * 100)
      periodStart: string;
      periodEnd: string;
      status: "exceeded" | "on_track" | "behind";  // >100%, 75-100%, <75%
    }>;
  }>;
  teamSummary: {
    totalRevenue: string;
    totalOrders: number;
    avgAchievement: string;              // average target achievement across all sellers
  };
}
```

**Widget type**: Ranked table with medals for top 3. Bar chart of revenue by seller. Target achievement shown as progress bars.
**Role**: Admin only (sellers should not see peers' performance without explicit opt-in)
**Priority**: Medium

---

### 2.8 Profit & Loss Summary

**Purpose**: Revenue (sales) - COGS (purchases) - Expenses, broken down by month or quarter.

**Note**: `dashboard.profitAndLoss` already computes P&L for a single period. This report adds monthly/quarterly breakdown and comparison between periods.

**Data sources**: `invoices`, `expenses`

**tRPC procedure**: `reports.profitAndLoss`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  granularity: z.enum(["month", "quarter"]).default("month"),
})
```

**Query approach**:

```ts
// Monthly/Quarterly breakdown using generate_series
const plBreakdown = await db.execute(sql`
  WITH periods AS (
    SELECT generate_series(
      date_trunc(${granularity}, ${fromDate}::timestamptz),
      date_trunc(${granularity}, ${toDate}::timestamptz),
      ('1 ' || ${granularity})::interval
    ) AS period_start
  )
  SELECT
    p.period_start,
    -- Revenue (sale invoices)
    COALESCE((
      SELECT SUM(total_amount::numeric)
      FROM invoices
      WHERE business_id = ${businessId}
        AND type = 'sale'
        AND document_type = 'invoice'
        AND status != 'cancelled'
        AND deleted_at IS NULL
        AND invoice_date >= p.period_start
        AND invoice_date < p.period_start + ('1 ' || ${granularity})::interval
    ), 0)::text AS revenue,
    -- COGS (purchase invoices)
    COALESCE((
      SELECT SUM(total_amount::numeric)
      FROM invoices
      WHERE business_id = ${businessId}
        AND type = 'purchase'
        AND document_type = 'invoice'
        AND status != 'cancelled'
        AND deleted_at IS NULL
        AND invoice_date >= p.period_start
        AND invoice_date < p.period_start + ('1 ' || ${granularity})::interval
    ), 0)::text AS cogs,
    -- Expenses
    COALESCE((
      SELECT SUM(amount::numeric)
      FROM expenses
      WHERE business_id = ${businessId}
        AND deleted_at IS NULL
        AND expense_date >= p.period_start
        AND expense_date < p.period_start + ('1 ' || ${granularity})::interval
    ), 0)::text AS total_expenses
  FROM periods p
  ORDER BY p.period_start ASC
`);

// Expense category breakdown for the full period
const expenseBreakdown = await db.select({
  category: expenses.category,
  total: sql<string>`SUM(${expenses.amount}::numeric)::text`,
}).from(expenses)
  .where(and(
    eq(expenses.businessId, businessId),
    sql`${expenses.deletedAt} IS NULL`,
    gte(expenses.expenseDate, new Date(fromDate)),
    lte(expenses.expenseDate, new Date(toDate)),
  ))
  .groupBy(expenses.category)
  .orderBy(sql`SUM(${expenses.amount}::numeric) DESC`);
```

**Output**:
```ts
{
  periods: Array<{
    periodStart: string;
    periodLabel: string;                 // "Jan 2026" or "Q1 2026"
    revenue: string;
    cogs: string;
    grossProfit: string;                 // revenue - cogs
    grossMarginPct: string;
    totalExpenses: string;
    netProfit: string;                   // grossProfit - totalExpenses
    netMarginPct: string;
  }>;
  expenseBreakdown: Array<{
    category: string;
    total: string;
  }>;
  totals: {
    revenue: string;
    cogs: string;
    grossProfit: string;
    grossMarginPct: string;
    totalExpenses: string;
    netProfit: string;
    netMarginPct: string;
  };
  comparison: {                          // vs same-length previous period
    revenueChange: string;
    revenuePct: string;
    netProfitChange: string;
    netProfitPct: string;
  } | null;
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant
**Priority**: High

---

### 2.9 Cash Flow Statement

**Purpose**: Cash inflows (collections from customers) vs outflows (payments to suppliers + expenses), grouped by period.

**Data sources**: `payments`, `expenses`, `parties` (to distinguish customer vs supplier payments)

**tRPC procedure**: `reports.cashFlowStatement`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  granularity: z.enum(["month", "quarter"]).default("month"),
})
```

**Query approach**:

```ts
const cashFlow = await db.execute(sql`
  WITH periods AS (
    SELECT generate_series(
      date_trunc(${granularity}, ${fromDate}::timestamptz),
      date_trunc(${granularity}, ${toDate}::timestamptz),
      ('1 ' || ${granularity})::interval
    ) AS period_start
  )
  SELECT
    p.period_start,
    -- Cash inflows: payments received from customers
    COALESCE((
      SELECT SUM(pay.amount::numeric)
      FROM payments pay
      JOIN parties par ON par.id = pay.party_id
      WHERE pay.business_id = ${businessId}
        AND par.type = 'customer'
        AND pay.deleted_at IS NULL
        AND pay.payment_date >= p.period_start
        AND pay.payment_date < p.period_start + ('1 ' || ${granularity})::interval
    ), 0)::text AS collections,
    -- Cash outflows: payments made to suppliers
    COALESCE((
      SELECT SUM(pay.amount::numeric)
      FROM payments pay
      JOIN parties par ON par.id = pay.party_id
      WHERE pay.business_id = ${businessId}
        AND par.type = 'supplier'
        AND pay.deleted_at IS NULL
        AND pay.payment_date >= p.period_start
        AND pay.payment_date < p.period_start + ('1 ' || ${granularity})::interval
    ), 0)::text AS supplier_payments,
    -- Cash outflows: expenses
    COALESCE((
      SELECT SUM(amount::numeric)
      FROM expenses
      WHERE business_id = ${businessId}
        AND deleted_at IS NULL
        AND expense_date >= p.period_start
        AND expense_date < p.period_start + ('1 ' || ${granularity})::interval
    ), 0)::text AS expenses
  FROM periods p
  ORDER BY p.period_start ASC
`);
```

**Output**:
```ts
{
  periods: Array<{
    periodStart: string;
    periodLabel: string;
    collections: string;                 // money in from customers
    supplierPayments: string;            // money out to suppliers
    expenses: string;                    // money out for expenses
    totalOutflows: string;               // supplierPayments + expenses
    netCashFlow: string;                 // collections - totalOutflows
  }>;
  totals: {
    totalCollections: string;
    totalSupplierPayments: string;
    totalExpenses: string;
    netCashFlow: string;
  };
  modeBreakdown: Array<{                // payment mode split across all periods
    mode: string;
    inflow: string;
    outflow: string;
  }>;
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant
**Priority**: High

---

### 2.10 Aging Report (Receivables + Payables)

**Purpose**: All unpaid invoices grouped by aging buckets (0-30, 31-60, 61-90, 90+ days), with both receivables and payables.

**Note**: `dashboard.receivablesAging` already covers the receivables side at party level. This report adds:
1. Individual invoice detail rows under each party
2. Payables side (purchase invoices to suppliers)
3. Configurable aging periods

**Data sources**: `invoices`, `parties`

**tRPC procedure**: `reports.agingReport`

**Input**:
```ts
z.object({
  type: z.enum(["receivable", "payable", "both"]).default("receivable"),
  asOfDate: z.string().datetime().optional(),  // defaults to now
  agingBuckets: z.array(z.number().int().positive()).default([30, 60, 90]),
})
```

**Query approach**:

```ts
const asOf = asOfDate ? new Date(asOfDate) : new Date();

const outstandingInvoices = await db.select({
  partyId: parties.id,
  partyName: parties.name,
  partyPhone: parties.phone,
  partyType: parties.type,
  invoiceId: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  invoiceDate: invoices.invoiceDate,
  dueDate: invoices.dueDate,
  totalAmount: invoices.totalAmount,
  amountPaid: invoices.amountPaid,
  outstanding: sql<string>`(${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric)::text`,
  daysOverdue: sql<number>`
    GREATEST(0, EXTRACT(DAY FROM ${asOf}::timestamptz - COALESCE(${invoices.dueDate}, ${invoices.invoiceDate})))::int`,
}).from(invoices)
  .innerJoin(parties, eq(parties.id, invoices.partyId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`,
    sql`${invoices.deletedAt} IS NULL`,
    sql`${invoices.totalAmount}::numeric - ${invoices.amountPaid}::numeric > 0`,
    // Filter by type: sale = receivable, purchase = payable
    ...(type === "receivable" ? [eq(invoices.type, "sale")] : []),
    ...(type === "payable" ? [eq(invoices.type, "purchase")] : []),
  ))
  .orderBy(parties.name, sql`COALESCE(${invoices.dueDate}, ${invoices.invoiceDate}) ASC`);

// Client-side: bucket each invoice into aging periods based on daysOverdue
// Buckets: 0-30, 31-60, 61-90, 90+ (configurable via agingBuckets input)
```

**Output**:
```ts
{
  parties: Array<{
    partyId: string;
    partyName: string;
    partyPhone: string | null;
    partyType: "customer" | "supplier";
    invoices: Array<{
      invoiceId: string;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string | null;
      totalAmount: string;
      amountPaid: string;
      outstanding: string;
      daysOverdue: number;
      bucket: string;                    // "0-30" | "31-60" | "61-90" | "90+"
    }>;
    bucketTotals: Record<string, string>; // e.g. {"0-30": "15000.00", "31-60": "8500.00", ...}
    totalOutstanding: string;
  }>;
  summary: {
    bucketTotals: Record<string, string>;
    grandTotal: string;
    partyCount: number;
    invoiceCount: number;
  };
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant
**Priority**: High

---

### 2.11 Tax Summary

**Purpose**: GST collected on sales and GST paid on purchases, broken down by rate (0%, 5%, 12%, 18%, 28%). For non-GST businesses, shows tax amounts collected/paid generically.

**Note**: GSTR-1 and GSTR-3B already cover this for GST-registered businesses. This report is a simpler internal view that works for all businesses regardless of GST registration status.

**Data sources**: `invoice_items` (`tax_percent`, `tax_amount`), `invoices` (`type`, `invoice_date`)

**tRPC procedure**: `reports.taxSummary`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  type: z.enum(["sales", "purchases", "both"]).default("both"),
})
```

**Query approach**:

```ts
const taxSummary = await db.select({
  invoiceType: invoices.type,
  taxPercent: invoiceItems.taxPercent,
  invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
  taxableAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric - ${invoiceItems.taxAmount}::numeric)::text`,
  taxAmount: sql<string>`SUM(${invoiceItems.taxAmount}::numeric)::text`,
  grossAmount: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
}).from(invoiceItems)
  .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
    ...(type === "sales" ? [eq(invoices.type, "sale")] : []),
    ...(type === "purchases" ? [eq(invoices.type, "purchase")] : []),
  ))
  .groupBy(invoices.type, invoiceItems.taxPercent)
  .orderBy(invoices.type, invoiceItems.taxPercent);
```

**Output**:
```ts
{
  sales: Array<{
    taxPercent: string;
    invoiceCount: number;
    taxableAmount: string;
    taxAmount: string;
    grossAmount: string;
  }>;
  purchases: Array<{
    taxPercent: string;
    invoiceCount: number;
    taxableAmount: string;
    taxAmount: string;
    grossAmount: string;
  }>;
  totals: {
    totalTaxCollected: string;           // sum of sales tax
    totalTaxPaid: string;                // sum of purchase tax
    netTaxPayable: string;               // collected - paid (ITC offset)
  };
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant
**Priority**: High -- monthly requirement for all businesses

---

### 2.12 Item-wise Sales Report

**Purpose**: Revenue, quantity sold, and margin per item across periods. Core merchandising report for product businesses.

**Data sources**: `invoice_items`, `invoices`, `items`

**tRPC procedure**: `reports.itemWiseSales`

**Input**:
```ts
z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  compareToPrevious: z.boolean().default(false),
  category: z.string().optional(),
  itemType: z.enum(["product", "service"]).optional(),
  sortBy: z.enum(["revenue", "quantity", "invoices", "margin"]).default("revenue"),
  limit: z.number().int().min(10).max(200).default(50),
})
```

**Query approach**:

```ts
const sortOrderMap = {
  revenue: sql`SUM(${invoiceItems.totalAmount}::numeric) DESC`,
  quantity: sql`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1)) DESC`,
  invoices: sql`COUNT(DISTINCT ${invoices.id}) DESC`,
  margin: sql`(SUM(${invoiceItems.totalAmount}::numeric) - SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0))) / NULLIF(SUM(${invoiceItems.totalAmount}::numeric), 0) DESC`,
};

const itemSalesReport = await db.select({
  itemId: invoiceItems.itemId,
  itemName: sql<string>`COALESCE(${items.name}, ${invoiceItems.description})`,
  category: items.category,
  unit: items.unit,
  soldQty: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1))::text`,
  totalRevenue: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
  avgUnitPrice: sql<string>`ROUND(SUM(${invoiceItems.totalAmount}::numeric) / NULLIF(SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1)), 0), 2)::text`,
  invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
  uniqueCustomers: sql<number>`COUNT(DISTINCT ${invoices.partyId})::int`,
  estimatedCost: sql<string>`SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0))::text`,
  grossMarginPct: sql<string>`
    ROUND(
      (SUM(${invoiceItems.totalAmount}::numeric) - SUM(${invoiceItems.quantity}::numeric * COALESCE(${invoiceItems.conversionFactor}::numeric, 1) * COALESCE(${items.purchasePrice}::numeric, 0)))
      / NULLIF(SUM(${invoiceItems.totalAmount}::numeric), 0) * 100,
      1
    )::text`,
}).from(invoiceItems)
  .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
  .leftJoin(items, eq(items.id, invoiceItems.itemId))
  .where(and(
    eq(invoices.businessId, businessId),
    eq(invoices.type, "sale"),
    eq(invoices.documentType, "invoice"),
    sql`${invoices.status} NOT IN ('draft', 'cancelled')`,
    sql`${invoices.deletedAt} IS NULL`,
    gte(invoices.invoiceDate, new Date(fromDate)),
    lte(invoices.invoiceDate, new Date(toDate)),
    ...(category ? [eq(items.category, category)] : []),
    ...(itemType ? [eq(items.itemType, itemType)] : []),
  ))
  .groupBy(invoiceItems.itemId, items.name, items.category, items.unit, invoiceItems.description)
  .orderBy(sortOrderMap[sortBy])
  .limit(limit);

// If compareToPrevious = true, run the same query for previous period
// Previous period: same length, ending at fromDate - 1 day
```

**Output**:
```ts
{
  items: Array<{
    itemId: string | null;
    itemName: string;
    category: string | null;
    unit: string | null;
    soldQty: string;
    totalRevenue: string;
    avgUnitPrice: string;
    invoiceCount: number;
    uniqueCustomers: number;
    estimatedCost: string;
    grossMarginPct: string;
    previousPeriod?: {                   // only if compareToPrevious = true
      soldQty: string;
      totalRevenue: string;
      qtyChangePct: string;
      revenueChangePct: string;
    };
  }>;
  totals: {
    totalQty: string;
    totalRevenue: string;
    totalCost: string;
    overallMarginPct: string;
  };
}
```

**Export**: CSV + PDF
**Role**: Admin, Accountant, Seller (own sales only)
**Priority**: High

---

### 2.13 Outstanding Report (Enhanced)

**Purpose**: All unpaid invoices, grouped by party, with aging detail. Different from `dashboard.receivablesAging` in that it shows individual invoice lines, includes both receivables AND payables, and supports configurable aging buckets.

This is effectively the aging report (2.10) with a different emphasis: party-first view with contact details for follow-up.

**Note**: Consider merging with 2.10 as a single report with a `viewMode` parameter ("by_party" vs "by_aging_bucket").

---

## Part 3 -- Seller Performance Analytics

### 3.1 Peak Selling Hours/Days

**Data sources**: `invoices.invoice_date` grouped by hour and day of week

```ts
const peakTimes = await db.execute(sql`
  SELECT
    created_by_user_id,
    created_by_name,
    EXTRACT(DOW FROM invoice_date AT TIME ZONE 'Asia/Kolkata') AS day_of_week,
    EXTRACT(HOUR FROM invoice_date AT TIME ZONE 'Asia/Kolkata') AS hour_of_day,
    COUNT(*) AS invoice_count,
    SUM(total_amount::numeric)::text AS total_amount
  FROM invoices
  WHERE business_id = ${businessId}
    AND type = 'sale'
    AND document_type = 'invoice'
    AND status NOT IN ('draft', 'cancelled')
    AND deleted_at IS NULL
    AND invoice_date >= ${fromDate}::timestamptz
    AND created_by_user_id IS NOT NULL
  GROUP BY created_by_user_id, created_by_name, day_of_week, hour_of_day
  ORDER BY invoice_count DESC
`);
```

**Output**: Heatmap grid (days of week on X, hours of day on Y). Darker = more invoices. Per-seller filter.
**Role**: Admin
**Priority**: Low

---

### 3.2 Average Order Value Trend by Seller

```ts
const aovTrend = await db.execute(sql`
  SELECT
    DATE_TRUNC('month', invoice_date) AS month,
    created_by_user_id,
    created_by_name,
    ROUND(AVG(total_amount::numeric), 2)::text AS avg_order_value,
    COUNT(*)::int AS order_count
  FROM invoices
  WHERE business_id = ${businessId}
    AND type = 'sale'
    AND document_type = 'invoice'
    AND status NOT IN ('draft', 'cancelled')
    AND deleted_at IS NULL
    AND invoice_date >= ${fromDate}::timestamptz
    AND created_by_user_id IS NOT NULL
  GROUP BY month, created_by_user_id, created_by_name
  ORDER BY month, created_by_user_id
`);
```

**Output**: Line chart with one line per seller.
**Role**: Admin
**Priority**: Low

---

### 3.3 Party Retention by Seller

**Purpose**: Do customers who first bought from a specific seller come back?

```ts
const sellerRetention = await db.execute(sql`
  WITH first_sale AS (
    SELECT DISTINCT ON (party_id)
      party_id,
      created_by_user_id AS acquiring_seller_id,
      created_by_name AS acquiring_seller_name,
      invoice_date AS first_sale_date
    FROM invoices
    WHERE business_id = ${businessId}
      AND type = 'sale'
      AND document_type = 'invoice'
      AND status NOT IN ('draft', 'cancelled')
      AND deleted_at IS NULL
    ORDER BY party_id, invoice_date ASC
  ),
  customer_orders AS (
    SELECT
      party_id,
      COUNT(*) AS total_orders
    FROM invoices
    WHERE business_id = ${businessId}
      AND type = 'sale'
      AND document_type = 'invoice'
      AND status NOT IN ('draft', 'cancelled')
      AND deleted_at IS NULL
    GROUP BY party_id
  )
  SELECT
    fs.acquiring_seller_id,
    fs.acquiring_seller_name,
    COUNT(DISTINCT fs.party_id)::int AS customers_acquired,
    COUNT(DISTINCT fs.party_id) FILTER (WHERE co.total_orders > 1)::int AS repeat_customers,
    ROUND(
      COUNT(DISTINCT fs.party_id) FILTER (WHERE co.total_orders > 1)::numeric
        / NULLIF(COUNT(DISTINCT fs.party_id), 0) * 100,
      1
    )::text AS retention_rate
  FROM first_sale fs
  JOIN customer_orders co ON co.party_id = fs.party_id
  GROUP BY fs.acquiring_seller_id, fs.acquiring_seller_name
  ORDER BY repeat_customers DESC
`);
```

**Output**: Table with columns: Seller, Customers Acquired, Repeat Customers, Retention %.
**Role**: Admin
**Priority**: Low

---

## Part 4 -- Store Analytics

The `store_orders` table exists and contains order lifecycle data. However, the data available is limited to completed/attempted orders -- there is no page view or cart tracking currently.

### 4.1 Store Order Volume and Revenue

```ts
const storeMetrics = await db.select({
  status: storeOrders.status,
  count: sql<number>`COUNT(*)::int`,
  totalAmount: sql<string>`SUM(${storeOrders.totalAmount}::numeric)::text`,
  avgOrderValue: sql<string>`ROUND(AVG(${storeOrders.totalAmount}::numeric), 2)::text`,
}).from(storeOrders)
  .where(and(
    eq(storeOrders.businessId, businessId),
    gte(storeOrders.createdAt, new Date(fromDate)),
    lte(storeOrders.createdAt, new Date(toDate)),
  ))
  .groupBy(storeOrders.status);
```

### 4.2 Cancellation Rate

```ts
const cancellationRate = await db.execute(sql`
  SELECT
    COUNT(*)::int AS total_orders,
    COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
    ROUND(
      COUNT(*) FILTER (WHERE status = 'cancelled')::numeric
        / NULLIF(COUNT(*), 0) * 100,
      1
    )::text AS cancellation_rate
  FROM store_orders
  WHERE business_id = ${businessId}
    AND created_at >= ${fromDate}::timestamptz
    AND created_at <= ${toDate}::timestamptz
`);
```

### 4.3 Repeat Customer Rate (by phone)

Since store customers are anonymous (no `party_id`), repeat purchase identification is by `customer_phone`.

```ts
const repeatCustomers = await db.execute(sql`
  WITH customer_orders AS (
    SELECT
      customer_phone,
      COUNT(*) AS order_count,
      SUM(total_amount::numeric) AS total_spent
    FROM store_orders
    WHERE business_id = ${businessId}
      AND status NOT IN ('cancelled')
      AND created_at >= ${fromDate}::timestamptz
    GROUP BY customer_phone
  )
  SELECT
    COUNT(*)::int AS total_customers,
    COUNT(*) FILTER (WHERE order_count > 1)::int AS repeat_customers,
    ROUND(
      COUNT(*) FILTER (WHERE order_count > 1)::numeric
        / NULLIF(COUNT(*), 0) * 100,
      1
    )::text AS repeat_rate,
    ROUND(AVG(total_spent), 2)::text AS avg_ltv
  FROM customer_orders
`);
```

### 4.4 Popular Store Items

```ts
const popularStoreItems = await db.select({
  itemId: invoiceItems.itemId,
  itemName: sql<string>`COALESCE(${items.name}, ${invoiceItems.description})`,
  orderCount: sql<number>`COUNT(DISTINCT ${storeOrders.id})::int`,
  totalQtySold: sql<string>`SUM(${invoiceItems.quantity}::numeric)::text`,
  totalRevenue: sql<string>`SUM(${invoiceItems.totalAmount}::numeric)::text`,
}).from(storeOrders)
  .innerJoin(invoices, eq(invoices.id, storeOrders.invoiceId))
  .innerJoin(invoiceItems, eq(invoiceItems.invoiceId, invoices.id))
  .leftJoin(items, eq(items.id, invoiceItems.itemId))
  .where(and(
    eq(storeOrders.businessId, businessId),
    sql`${storeOrders.status} NOT IN ('cancelled')`,
    gte(storeOrders.createdAt, new Date(fromDate)),
  ))
  .groupBy(invoiceItems.itemId, items.name, invoiceItems.description)
  .orderBy(sql`COUNT(DISTINCT ${storeOrders.id}) DESC`)
  .limit(20);
```

### What CANNOT be computed today (new tracking required)

**Conversion Funnel, Cart Abandonment, Page Views**: These require client-side event tracking that does not currently exist. To enable these metrics, two new tables would be needed:

1. `store_sessions` -- anonymous session tracking with fields for `session_token`, `customer_phone`, `page_views`, `reached_checkout`, `order_id`, UTM parameters
2. `store_item_views` -- per-item view tracking with `session_token`, `item_id`, `variant_id`, `viewed_at`

With these two tables, the following become computable: conversion funnel (sessions -> checkout -> order), cart abandonment rate, most viewed vs most ordered, traffic by source. These are deferred to a future phase.

---

## Part 5 -- API Design: `reports` Router

All reports live under a new tRPC router: `reportsRouter`.

### Router Registration

In `packages/api/src/router.ts`:

```ts
import { reportsRouter } from "./routers/reports.js";

export const appRouter = router({
  // ... existing routers ...
  reports: reportsRouter,
});
```

### Router Structure

File: `packages/api/src/routers/reports.ts`

```ts
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";

export const reportsRouter = router({
  // Dashboard widget procedures
  cashFlowForecast: viewerProcedure
    .input(z.object({}))
    .query(async ({ ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  dso: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  collectionEfficiency: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  inventoryTurnover: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  // Full report procedures
  daybook: viewerProcedure
    .input(z.object({
      date: z.string().date(),
      typeFilter: z.enum(["all", "invoices", "payments", "expenses"]).default("all"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  purchaseRegister: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      partyId: z.string().uuid().optional(),
      taxPercent: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  salesRegister: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      partyId: z.string().uuid().optional(),
      documentType: z.enum(["invoice", "credit_note", "debit_note"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  stockSummary: viewerProcedure
    .input(z.object({
      category: z.string().optional(),
      showZeroStock: z.boolean().default(false),
      sortBy: z.enum(["name", "stock", "value"]).default("name"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  paymentSummary: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      type: z.enum(["received", "made", "both"]).default("both"),
      mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).optional(),
      bankAccountId: z.string().uuid().optional(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  partyStatement: viewerProcedure
    .input(z.object({
      partyId: z.string().uuid(),
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  sellerPerformance: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      userId: z.string().uuid().optional(),
      rankBy: z.enum(["revenue", "order_count", "item_quantity"]).default("revenue"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // Seller performance is admin-only beyond the permission check
      // ... implementation
    }),

  profitAndLoss: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      granularity: z.enum(["month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  cashFlowStatement: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      granularity: z.enum(["month", "quarter"]).default("month"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  agingReport: viewerProcedure
    .input(z.object({
      type: z.enum(["receivable", "payable", "both"]).default("receivable"),
      asOfDate: z.string().datetime().optional(),
      agingBuckets: z.array(z.number().int().positive()).default([30, 60, 90]),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  taxSummary: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      type: z.enum(["sales", "purchases", "both"]).default("both"),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),

  itemWiseSales: viewerProcedure
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      compareToPrevious: z.boolean().default(false),
      category: z.string().optional(),
      itemType: z.enum(["product", "service"]).optional(),
      sortBy: z.enum(["revenue", "quantity", "invoices", "margin"]).default("revenue"),
      limit: z.number().int().min(10).max(200).default(50),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Report");
      // ... implementation
    }),
});
```

### Shared Validators (add to `packages/shared/src/validators.ts`)

```ts
// ── Reports ──────────────────────────────────────────────────
export const reportDateRangeSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
});

export const reportGranularitySchema = z.enum(["month", "quarter"]);

export const agingBucketsSchema = z.array(z.number().int().positive()).default([30, 60, 90]);
```

### Shared Utility: Financial Year Computation

The pattern from `dashboard.summary` (computing `fyStart` dynamically) should be extracted to a shared utility:

```ts
// packages/api/src/lib/financial-year.ts

export function computeFinancialYear(fyStartMonth: number /* 1-indexed */): {
  fyStart: Date;
  fyEnd: Date;
  fyLabel: string;
} {
  const zeroIndexed = fyStartMonth - 1;
  const now = new Date();
  const fyYear = now.getMonth() < zeroIndexed ? now.getFullYear() - 1 : now.getFullYear();
  const fyStart = new Date(fyYear, zeroIndexed, 1);
  const fyEnd = new Date(fyYear + 1, zeroIndexed, 0, 23, 59, 59, 999);
  const fyLabel = `FY ${fyYear}-${(fyYear + 1) % 100}`;
  return { fyStart, fyEnd, fyLabel };
}

export function computeDaysInPeriod(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
```

---

## Part 6 -- Dashboard Widget Enhancements (UI)

### 6.1 Comparison Cards (Current vs Previous Period)

Every existing summary card (Total Sales, Total Purchases, Total Expenses, Receivable, Payable, Cash In Hand) should show a comparison indicator:

- **Delta value**: e.g. "+12,500" or "-3,200"
- **Percentage change**: e.g. "+8.5%"
- **Trend arrow**: green up arrow for favorable changes, red down arrow for unfavorable
- **Favorable direction**: Sales/Cash up = green; Expenses/Payable up = red

**Data approach**: The `dashboard.summary` procedure already accepts `fromDate`/`toDate`. The frontend computes the equivalent previous period and makes two calls, then computes deltas client-side.

### 6.2 Sparkline Charts on Summary Cards

Each summary card should include a 6-point sparkline showing monthly trend:

- **Sales sparkline**: last 6 months of sale invoice totals (from `dashboard.salesTrend`)
- **Expenses sparkline**: last 6 months of expense totals (from `dashboard.expensesByCategory` aggregated by month)
- **Receivable sparkline**: requires a new query for month-end receivable snapshots

**Implementation**: Add a `dashboard.monthlyTrend` procedure that returns monthly totals for sales, purchases, expenses, and receivables for the last 6 months.

```ts
monthlyTrend: viewerProcedure
  .input(z.object({ months: z.number().int().min(3).max(12).default(6) }))
  .query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Report");
    const results = await ctx.db.execute(sql`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', NOW()) - (${input.months - 1} || ' months')::interval,
          date_trunc('month', NOW()),
          '1 month'::interval
        ) AS month_start
      )
      SELECT
        m.month_start,
        -- Sales
        COALESCE((
          SELECT SUM(total_amount::numeric)
          FROM invoices
          WHERE business_id = ${ctx.businessId}
            AND type = 'sale' AND document_type = 'invoice'
            AND status NOT IN ('draft', 'cancelled') AND deleted_at IS NULL
            AND invoice_date >= m.month_start
            AND invoice_date < m.month_start + '1 month'::interval
        ), 0)::text AS sales,
        -- Purchases
        COALESCE((
          SELECT SUM(total_amount::numeric)
          FROM invoices
          WHERE business_id = ${ctx.businessId}
            AND type = 'purchase' AND document_type = 'invoice'
            AND status NOT IN ('draft', 'cancelled') AND deleted_at IS NULL
            AND invoice_date >= m.month_start
            AND invoice_date < m.month_start + '1 month'::interval
        ), 0)::text AS purchases,
        -- Expenses
        COALESCE((
          SELECT SUM(amount::numeric)
          FROM expenses
          WHERE business_id = ${ctx.businessId}
            AND deleted_at IS NULL
            AND expense_date >= m.month_start
            AND expense_date < m.month_start + '1 month'::interval
        ), 0)::text AS expenses,
        -- Collections (payments received from customers)
        COALESCE((
          SELECT SUM(pay.amount::numeric)
          FROM payments pay
          JOIN parties par ON par.id = pay.party_id
          WHERE pay.business_id = ${ctx.businessId}
            AND par.type = 'customer'
            AND pay.deleted_at IS NULL
            AND pay.payment_date >= m.month_start
            AND pay.payment_date < m.month_start + '1 month'::interval
        ), 0)::text AS collections
      FROM months m
      ORDER BY m.month_start ASC
    `);
    return results;
  }),
```

### 6.3 Payment Mode Breakdown Pie Chart

**Data source**: `dashboard.paymentModeBreakdown` (new procedure or extend existing `paymentSummary`)

```ts
paymentModeBreakdown: viewerProcedure
  .input(z.object({
    fromDate: z.string().datetime().optional(),
    toDate: z.string().datetime().optional(),
  }))
  .query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Report");
    const conditions = [
      eq(payments.businessId, ctx.businessId),
      sql`${payments.deletedAt} IS NULL`,
    ];
    if (input.fromDate) conditions.push(gte(payments.paymentDate, new Date(input.fromDate)));
    if (input.toDate) conditions.push(lte(payments.paymentDate, new Date(input.toDate)));

    return ctx.db.select({
      mode: payments.mode,
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`SUM(${payments.amount}::numeric)::text`,
    }).from(payments)
      .where(and(...conditions))
      .groupBy(payments.mode)
      .orderBy(sql`SUM(${payments.amount}::numeric) DESC`);
  }),
```

**Widget type**: Donut/pie chart. Color-coded by mode (Cash = green, UPI = purple, Bank = blue, Cheque = amber, Other = grey).
**Dashboard position**: Third row, alongside expense breakdown.
**Priority**: Medium

### 6.4 Expense Category Breakdown

Already exists as `dashboard.expensesByCategory`. Widget enhancement:
- Show as donut chart instead of table
- Add percentage labels
- Click-through to filtered expense list

### 6.5 Monthly Comparison Card

A side-by-side comparison card showing current month vs previous month for key metrics:

| Metric | This Month | Last Month | Change |
|---|---|---|---|
| Revenue | 4,52,000 | 3,89,000 | +16.2% |
| Expenses | 45,000 | 52,000 | -13.5% |
| Net Profit | 2,15,000 | 1,78,000 | +20.8% |
| Orders | 127 | 98 | +29.6% |

**Implementation**: Computed client-side from two `dashboard.summary` calls with different date ranges.

### 6.6 Trend Indicators on All Widgets

Every numeric widget should show:
- **Arrow direction**: Up/down/flat based on comparison to previous period
- **Color coding**: Green for favorable, red for unfavorable, grey for neutral
- **Tooltip**: "Compared to previous [period length]"

The definition of "favorable" depends on the metric:
- Sales, collections, cash in hand, gross margin: up = green
- Expenses, payable, DSO: down = green
- Receivable: down = green (means customers are paying)

---

## Part 7 -- Implementation Priority Matrix

| # | Report/Widget | Business Impact | Data Availability | Implementation Effort | Priority |
|---|---|---|---|---|---|
| 1 | Daybook | High | Full | Low | **P0** |
| 2 | Aging Report (enhanced) | High | Full | Low | **P0** |
| 3 | Sales Register | High | Full | Low | **P0** |
| 4 | Purchase Register | High | Full | Low | **P0** |
| 5 | Tax Summary | High | Full | Low | **P0** |
| 6 | Cash Flow Forecast | High | Partial (needs rate calc) | Medium | **P1** |
| 7 | Collection Efficiency + DSO | High | Full | Low | **P1** |
| 8 | Item-wise Sales Report | High | Full | Medium | **P1** |
| 9 | Stock Summary | High | Full | Low | **P1** |
| 10 | Profit & Loss (monthly) | High | Full | Low | **P1** |
| 11 | Cash Flow Statement | High | Full | Low | **P1** |
| 12 | Party Statement PDF | Medium | Full | Medium | **P2** |
| 13 | Payment Summary | Medium | Full | Low | **P2** |
| 14 | Dashboard sparklines | Medium | Full | Low | **P2** |
| 15 | Payment mode pie chart | Medium | Full | Low | **P2** |
| 16 | Comparison cards | Medium | Full | Low | **P2** |
| 17 | Gross Margin by Item | Medium | Partial (uses current cost) | Low | **P2** |
| 18 | Revenue Concentration | Medium | Full | Low | **P2** |
| 19 | Inventory Turnover | Low | Partial | Low | **P3** |
| 20 | Seller Performance + Targets | Medium | Partial (needs user info) | Medium | **P3** |
| 21 | Store Order Analytics | Medium | Full | Low | **P3** |
| 22 | Peak Selling Hours | Low | Full | Low | **P3** |
| 23 | Party Retention by Seller | Low | Full | Medium | **P3** |
| 24 | Store Conversion Funnel | High | Not available | High | **Future** |

---

## Part 8 -- Role Access Matrix

| Report | Admin | Accountant | Member/Seller | Notes |
|---|---|---|---|---|
| Dashboard widgets (all new) | Yes | Yes | No | Financial data |
| Daybook | Yes | Yes | No | |
| Sales Register | Yes | Yes | Own only | Filter by `created_by_user_id` |
| Purchase Register | Yes | Yes | No | |
| Stock Summary | Yes | Yes | No | |
| Party Statement | Yes | Yes | Yes | Any party in business |
| Outstanding/Aging Report | Yes | Yes | No | |
| Payment Summary | Yes | Yes | No | |
| Tax Summary | Yes | Yes | No | |
| Item-wise Sales Report | Yes | Yes | Own only | |
| P&L (monthly) | Yes | Yes | No | |
| Cash Flow Statement | Yes | Yes | No | |
| Seller Leaderboard | Yes | No | No | Competitive data |
| Target Achievement | Yes | No | Own only | |
| Peak Hours | Yes | No | No | |
| Store Analytics | Yes | Yes | No | |

All procedures use `viewerProcedure` (which includes `isAuthenticated` + `hasTenantAccess` + `hasBusinessAccess` + `withPermissions`). Endpoint-level access control is enforced via `requireCan(ctx.ability, "read", "Report")`. Row-level scoping (e.g. seller sees own data only) is applied inside the query logic by filtering on `created_by_user_id = ctx.user.id` when `ctx.role !== 'admin' && ctx.role !== 'accountant'`.

---

## Part 9 -- Technical Notes for Implementation

### Query Performance

The highest-risk queries for performance are:

1. **Daybook** -- three parallel queries with date range scans. All tables have `business_id + date` composite indexes (`invoices_date_idx`, `payments_date_idx`, `expenses_date_idx`). Should be fast.
2. **Stock Summary with variants** -- `JSON_AGG` on variants per item. For businesses with thousands of variants this could be slow. Add a `LIMIT` on variants per item or paginate.
3. **Cash Flow Forecast with historical rates** -- the correlated subquery for rates scans all paid invoices. Cache this calculation for 1 hour using a server-side in-memory store or add a materialized view.
4. **Target Achievement** -- the correlated subquery per target can be expensive if there are many targets. Batch by rewriting as a lateral join or a single aggregation with FILTER.
5. **P&L monthly breakdown** -- the `generate_series` with correlated subqueries per period is O(periods * table_size). For most SMBs (< 100k invoices), this is fine. Add a timeout guard.

### Existing Indexes Relevant to New Reports

```
invoices_business_idx: (business_id)
invoices_date_idx: (business_id, invoice_date)         -- covers date range reports
invoices_status_idx: (business_id, status)              -- covers outstanding/aging
invoices_party_date_idx: (business_id, party_id, invoice_date) -- party statement
invoices_number_idx: (business_id, invoice_number)      -- unique, covers lookups
invoices_doc_type_idx: (business_id, document_type)
payments_date_idx: (business_id, payment_date)          -- daybook, payment summary
payments_party_date_idx: (business_id, party_id, payment_date)
expenses_date_idx: (business_id, expense_date)          -- daybook, P&L
expenses_category_idx: (business_id, category)          -- expense breakdown
invoice_items_invoice_idx: (invoice_id)                 -- tax summary, item reports
invoice_items_item_idx: (item_id)
invoice_items_variant_idx: (variant_id)
items_business_idx: (business_id)
item_variants_item_idx: (item_id)
stock_adj_date_idx: (business_id, adjustment_date)
sales_targets_period_idx: (business_id, period_start, period_end)
sales_targets_user_idx: (business_id, user_id)
bank_txn_date_idx: (bank_account_id, transaction_date)
```

**Recommended new indexes** for report performance:

```sql
-- Seller analytics: queries group by created_by_user_id with date filter
CREATE INDEX invoices_seller_date_idx
  ON invoices (business_id, created_by_user_id, invoice_date)
  WHERE deleted_at IS NULL;

-- Tax summary: group by tax_percent within each invoice
CREATE INDEX invoice_items_tax_idx
  ON invoice_items (invoice_id, tax_percent);

-- Payment summary: group by mode with date filter
CREATE INDEX payments_mode_date_idx
  ON payments (business_id, mode, payment_date)
  WHERE deleted_at IS NULL;
```

### Soft Deletes

All three main transaction tables have `deleted_at` columns (`invoices.deletedAt`, `payments.deletedAt`, `expenses.deletedAt`). **Every new report query must include `AND deleted_at IS NULL` in its WHERE clause.** The existing dashboard queries do this via status exclusion for invoices in some cases, but payment and expense queries need explicit null checks. The recommended new partial indexes (above) include `WHERE deleted_at IS NULL` for optimal performance.

### Financial Year Awareness

The `businesses.financialYearStart` month (1-indexed, default 4 = April) should be respected in any report that defaults to "current period." Extract the pattern from `dashboard.summary` into `packages/api/src/lib/financial-year.ts` (see Part 5) and reuse in all report routers.

### Money Arithmetic

Per project rules: all monetary values are stored as `NUMERIC(15,2)`. All SQL aggregations must cast to `::numeric` before arithmetic. Return values as text strings (never JS floats). Use the existing `money` module from `@hisaabo/shared` for any server-side arithmetic after fetching from the database. The `money.sub()`, `money.add()`, and `money.toNumber()` functions handle paise-level precision correctly.

### Export Architecture

Reports support CSV and PDF export. The pattern from `gst-reports.ts` (`gstr1ToCSV`) should be followed:

1. **CSV**: Pure function that takes the report data and returns a string. No DB access. Lives in `packages/api/src/lib/report-exports.ts`.
2. **PDF**: Use PDFKit (already a dependency for invoice PDF generation in `packages/api/src/lib/invoice-pdf.ts`). Each report gets a corresponding PDF function.
3. **tRPC exposure**: Each export is a separate procedure (e.g. `reports.salesRegisterCSV`) that calls the report query + the export function. This avoids duplicating query logic.

```ts
// Example pattern (following gst router)
salesRegisterCSV: viewerProcedure
  .input(salesRegisterInput)
  .query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Report");
    const data = await generateSalesRegister(ctx.db, ctx.businessId, input);
    return {
      csv: salesRegisterToCSV(data),
      filename: `Sales_Register_${input.fromDate}_to_${input.toDate}.csv`,
    };
  }),
```
