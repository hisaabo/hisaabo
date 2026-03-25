import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

// ─── Period helpers ───────────────────────────────────────────────────────────

const PERIODS = [
  { id: "this-month", label: "This Month" },
  { id: "this-quarter", label: "This Quarter" },
  { id: "this-fy", label: "This FY" },
  { id: "last-fy", label: "Last FY" },
  { id: "all", label: "All Time" },
] as const;

type PeriodId = (typeof PERIODS)[number]["id"];

function getPeriodDates(period: PeriodId): { from?: string; to?: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  switch (period) {
    case "this-month": {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "this-quarter": {
      const qStart = Math.floor(month / 3) * 3;
      return {
        from: new Date(year, qStart, 1).toISOString(),
        to: new Date(year, qStart + 3, 0, 23, 59, 59).toISOString(),
      };
    }
    case "this-fy": {
      // Indian FY: April 1 – March 31
      const fyYear = month < 3 ? year - 1 : year;
      return {
        from: new Date(fyYear, 3, 1).toISOString(),
        to: new Date(fyYear + 1, 2, 31, 23, 59, 59).toISOString(),
      };
    }
    case "last-fy": {
      const fyYear = month < 3 ? year - 2 : year - 1;
      return {
        from: new Date(fyYear, 3, 1).toISOString(),
        to: new Date(fyYear + 1, 2, 31, 23, 59, 59).toISOString(),
      };
    }
    case "all":
    default:
      return {};
  }
}

// ─── Tooltip style ────────────────────────────────────────────────────────────

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-0)",
    border: "1px solid var(--border-light)",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

// ─── Colour palettes ──────────────────────────────────────────────────────────

const INVOICE_STATUS_COLORS: Record<string, string> = {
  paid: "#10b981",
  partial: "#f59e0b",
  sent: "#5b5bd6",
  overdue: "#ef4444",
  draft: "#94a3b8",
  cancelled: "#d1d5db",
};

const EXPENSE_COLORS = [
  "#5b5bd6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title,
  height = 260,
  children,
  responsive = true,
}: {
  title: string;
  height?: number;
  children: React.ReactNode;
  responsive?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="px-4 py-4" style={{ height }}>
        {responsive ? (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        ) : children}
      </div>
    </div>
  );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function SalesTrendChart() {
  const { data: raw } = trpc.dashboard.salesTrend.useQuery({ months: 6 });

  const data = raw?.map((r) => ({
    month: new Date(r.month).toLocaleString("en-IN", { month: "short" }),
    invoiced: parseFloat(r.invoiced),
    collected: parseFloat(r.collected),
  }));

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Sales & Collections" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Sales & Collections">
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${(v / 100000).toFixed(1)}L`}
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: any) => formatCurrency(String(value))}
        />
        <Bar dataKey="invoiced" name="Invoiced" fill="#5b5bd6" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartCard>
  );
}

function InvoiceStatusChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.invoiceStatusBreakdown.useQuery({
    fromDate,
    toDate,
  });

  const total = data ? data.reduce((sum, d) => sum + d.count, 0) : 0;

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Invoice Status" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">Invoice Status</h3>
      </div>
      <div className="px-4 py-4" style={{ height: 260 }}>
        <div className="flex flex-col h-full">
          {/* Donut with center label */}
          <div className="relative flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={76}
                  paddingAngle={2}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={INVOICE_STATUS_COLORS[entry.status] ?? "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: any, name: any) => [value, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <span className="block text-lg font-bold tabular-nums text-text-primary">{total}</span>
                <span className="block text-[10px] text-text-tertiary">invoices</span>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pb-1">
            {data.map((entry) => (
              <span key={entry.status} className="flex items-center gap-1 text-[11px] text-text-secondary">
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: INVOICE_STATUS_COLORS[entry.status] ?? "#94a3b8",
                  }}
                />
                {entry.status} ({entry.count})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TopOutstandingChart() {
  const { data: raw } = trpc.dashboard.topOutstanding.useQuery({ limit: 5 });

  if (!raw || raw.length === 0) {
    return (
      <ChartCard title="Top Outstanding" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const data = raw.map((r) => ({
    partyName: r.partyName,
    outstanding: parseFloat(r.outstanding),
  }));

  const chartData = [...data].reverse(); // bottom-to-top for horizontal bar

  return (
    <ChartCard title="Top Outstanding" height={260}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => `${(v / 100000).toFixed(1)}L`}
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="partyName"
          tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: any) => formatCurrency(String(value))}
        />
        <Bar dataKey="outstanding" name="Outstanding" fill="#f59e0b" radius={[0, 3, 3, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => `${(Number(v) / 1000).toFixed(0)}K` }} />
      </BarChart>
    </ChartCard>
  );
}

function ExpensesByCategoryChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data: raw } = trpc.dashboard.expensesByCategory.useQuery({ fromDate, toDate });

  const data = raw?.map((r) => ({
    category: r.category,
    amount: parseFloat(r.total),
  }));

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Expenses by Category" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">Expenses by Category</h3>
      </div>
      <div className="px-4 py-4" style={{ height: 260 }}>
        <div className="flex flex-col h-full">
          <div className="relative flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={76}
                  paddingAngle={2}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={entry.category}
                      fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: any) => formatCurrency(String(value))}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pb-1">
            {data.map((entry, index) => (
              <span key={entry.category} className="flex items-center gap-1 text-[11px] text-text-secondary">
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
                  }}
                />
                {entry.category}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
      No data for this period
    </div>
  );
}

// ─── Period selector ──────────────────────────────────────────────────────────

function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodId;
  onChange: (p: PeriodId) => void;
}) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-1 border border-border-light">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={
            p.id === value
              ? "px-3 py-1 rounded-md text-xs font-semibold bg-surface-0 text-text-primary shadow-sm transition-all"
              : "px-3 py-1 rounded-md text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
          }
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({
  data,
}: {
  data: {
    totalSales: string;
    totalPurchases: string;
    receivable: string;
    payable: string;
    cashInHand: string;
    totalExpenses: string;
  };
}) {
  const cards = [
    { label: "Sales", value: data.totalSales, color: "text-emerald-600" },
    { label: "Purchases", value: data.totalPurchases, color: "text-blue-600" },
    { label: "Receivable", value: data.receivable, color: "text-amber-600" },
    { label: "Payable", value: data.payable, color: "text-red-600" },
    { label: "Cash Position", value: data.cashInHand, color: "text-emerald-600" },
    { label: "Expenses", value: data.totalExpenses, color: "text-text-primary" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="card px-4 py-3">
          <p className="text-[11px] font-medium text-text-tertiary mb-1 truncate">{c.label}</p>
          <p className={`text-base font-bold tabular-nums truncate ${c.color}`}>
            {formatCurrency(c.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-7 w-40" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[292px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const [period, setPeriod] = useState<PeriodId>("this-fy");
  const { from, to } = getPeriodDates(period);

  const { data, isLoading } = trpc.dashboard.summary.useQuery();

  if (isLoading) return <PageSkeleton />;

  if (!data) {
    return (
      <EmptyState
        title="Welcome to Hisaabo"
        description="Set up your business to start creating invoices and tracking payments."
        action={
          <Link to="/settings" className="btn-primary">
            Set Up Business
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <div className="flex items-center gap-3">
            <PeriodSelector value={period} onChange={setPeriod} />
            <Link to="/invoices" className="btn-primary">
              + New Invoice
            </Link>
          </div>
        }
      />

      {/* Summary cards — always This FY via the summary query */}
      <SummaryCards data={data} />

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SalesTrendChart />
        <InvoiceStatusChart fromDate={from} toDate={to} />
        <TopOutstandingChart />
        <ExpensesByCategoryChart fromDate={from} toDate={to} />
      </div>
    </div>
  );
}
