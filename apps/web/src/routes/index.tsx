import { useState, useTransition } from "react";
import { keepPreviousData } from "@tanstack/react-query";
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
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatCurrency, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";

// ─── Milestone banner ─────────────────────────────────────────────────────────

const MILESTONES: Array<{ count: number; message: string }> = [
  { count: 1,   message: "Your first invoice — the beginning of something great." },
  { count: 10,  message: "10 invoices created. You're in the rhythm now." },
  { count: 50,  message: "50 invoices and counting. Solid momentum." },
  { count: 100, message: "100 invoices. Your business is moving." },
  { count: 250, message: "250 invoices. That's impressive consistency." },
  { count: 500, message: "500 invoices. You're running a real operation." },
];

const SALES_MILESTONES: Array<{ amount: number; message: string }> = [
  { amount: 100000,   message: "First \u20b91 lakh in sales — well done." },
  { amount: 500000,   message: "\u20b95 lakhs in sales. You're building something." },
  { amount: 1000000,  message: "\u20b910 lakhs in sales. Keep going." },
  { amount: 5000000,  message: "\u20b950 lakhs in sales. Remarkable progress." },
  { amount: 10000000, message: "\u20b91 crore in sales. That's a milestone worth marking." },
];

function getMilestoneKey(businessId: string, type: "invoices" | "sales", value: number) {
  return `hisaabo_milestone_${businessId}_${type}_${value}`;
}

function checkMilestone(
  businessId: string,
  totalInvoices: number,
  totalSales: number
): { message: string; key: string } | null {
  // Check invoice count milestones (highest crossed, not yet dismissed)
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    const m = MILESTONES[i];
    if (totalInvoices >= m.count) {
      const key = getMilestoneKey(businessId, "invoices", m.count);
      if (!localStorage.getItem(key)) {
        return { message: m.message, key };
      }
      break; // only show highest uncelebrated milestone
    }
  }

  // Check sales amount milestones
  for (let i = SALES_MILESTONES.length - 1; i >= 0; i--) {
    const m = SALES_MILESTONES[i];
    if (totalSales >= m.amount) {
      const key = getMilestoneKey(businessId, "sales", m.amount);
      if (!localStorage.getItem(key)) {
        return { message: m.message, key };
      }
      break;
    }
  }

  return null;
}

function MilestoneBanner({
  message,
  milestoneKey,
}: {
  message: string;
  milestoneKey: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(milestoneKey, "1");
    setDismissed(true);
  }

  return (
    <div className="mb-4 animate-milestone-enter">
      <div className="px-4 py-3 rounded-xl border border-brand-200 bg-brand-50 dark:bg-brand-950/20 dark:border-brand-800/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <svg
            className="w-4 h-4 text-brand-600 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          <p className="text-sm text-brand-700 dark:text-brand-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded-lg text-brand-500 hover:text-brand-700 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

// ─── Sales target types (mirrors target.myTargets API shape) ─────────────────

interface TargetProgressData {
  current: number;
  target: number;
  percentage: number;
  remaining: number;
  unit: string;
  onTrack: boolean;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

interface TargetProgress {
  id: string;
  targetType: string; // "order_count" | "order_value" | "item_quantity"
  targetValue: string;
  itemId?: string | null;
  periodEnd: string | Date;
  notes?: string | null;
  progress: TargetProgressData;
  // itemName is not yet returned by the API but will be present when available
  itemName?: string;
}

// ─── Target helpers ───────────────────────────────────────────────────────────

function getDaysRemaining(periodEnd: string | Date): number {
  const end = new Date(periodEnd);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function getTargetLabel(t: TargetProgress): string {
  if (t.targetType === "order_value") return "Sales Value";
  if (t.targetType === "order_count") return "Orders";
  return t.itemName ? `${t.itemName} (qty)` : "Item Quantity";
}

function formatTargetValue(t: TargetProgress, val: number): string {
  if (t.targetType === "order_value") {
    // Compact Indian number format
    if (val >= 10_00_000) return `\u20b9${(val / 10_00_000).toFixed(1)}Cr`;
    if (val >= 1_00_000) return `\u20b9${(val / 1_00_000).toFixed(1)}L`;
    if (val >= 1_000) return `\u20b9${(val / 1_000).toFixed(0)}K`;
    return `\u20b9${val.toFixed(0)}`;
  }
  return String(Math.round(val));
}

type TargetTier = "seed" | "growing" | "fire" | "close" | "near" | "achieved";

function getTier(pct: number): TargetTier {
  if (pct >= 100) return "achieved";
  if (pct >= 90)  return "near";
  if (pct >= 75)  return "close";
  if (pct >= 50)  return "fire";
  if (pct >= 25)  return "growing";
  return "seed";
}

const TIER_META: Record<TargetTier, { icon: string; message: string }> = {
  seed:     { icon: "\uD83C\uDF31", message: "Just getting started" },
  growing:  { icon: "\uD83D\uDCC8", message: "Building momentum" },
  fire:     { icon: "\uD83D\uDD25", message: "On fire!" },
  close:    { icon: "\u2B50",       message: "Almost there!" },
  near:     { icon: "\uD83D\uDE80", message: "So close!" },
  achieved: { icon: "\uD83C\uDFC6", message: "Target achieved!" },
};

function getBarFillClass(tier: TargetTier): string {
  if (tier === "achieved") return "target-progress-fill--achieved";
  if (tier === "near")     return "target-progress-fill--near";
  return "target-progress-fill";
}

function getBarColor(tier: TargetTier): string {
  if (tier === "achieved" || tier === "near") return "bg-emerald-500";
  if (tier === "fire" || tier === "close")    return "bg-amber-500";
  return "bg-brand-600";
}

function getMessageColor(tier: TargetTier): string {
  if (tier === "achieved")             return "text-emerald-600 dark:text-emerald-400";
  if (tier === "near" || tier === "close") return "text-amber-600 dark:text-amber-400";
  return "text-text-tertiary";
}

function getAchievementKey(targetId: string): string {
  return `target_achieved_${targetId}`;
}

// ─── Achievement banner ───────────────────────────────────────────────────────

function TargetAchievementBanner({ target }: { target: TargetProgress }) {
  const key = getAchievementKey(target.id);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(key));

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(key, "1");
    setDismissed(true);
  }

  const targetNum = parseFloat(target.targetValue);
  const formatted = formatTargetValue(target, targetNum);

  return (
    <div className="mb-3 target-achieve-banner">
      <div className="px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/50 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="text-lg leading-none shrink-0" role="img" aria-label="Trophy">
            {"\uD83C\uDFC6"}
          </span>
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Target Achieved!
            </p>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70 mt-0.5">
              You hit your {getTargetLabel(target)} target of {formatted}. Great work!
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          aria-label="Dismiss achievement notification"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Single target row ────────────────────────────────────────────────────────

function TargetRow({ target }: { target: TargetProgress }) {
  const { progress } = target;
  const pct = Math.min(progress.percentage, 100);
  const tier = getTier(progress.percentage);
  const meta = TIER_META[tier];
  const daysLeft = progress.daysRemaining ?? getDaysRemaining(target.periodEnd);
  const targetNum = parseFloat(target.targetValue);

  const currentFormatted = formatTargetValue(target, progress.current);
  const targetFormatted  = formatTargetValue(target, targetNum);

  const barFillClass = getBarFillClass(tier);
  const barColor     = getBarColor(tier);
  const msgColor     = getMessageColor(tier);

  return (
    <div>
      {/* Label row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-text-primary">
          {getTargetLabel(target)}
        </span>
        <span className="text-[11px] tabular-nums text-text-tertiary">
          {currentFormatted} / {targetFormatted}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(progress.percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${getTargetLabel(target)}: ${Math.round(progress.percentage)}% complete`}
      >
        <div
          className={cn("h-full rounded-full", barColor, barFillClass)}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-text-tertiary">
          {daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining`}
        </span>
        <span className={cn("text-[11px] font-medium", msgColor)}>
          <span aria-hidden="true">{meta.icon} </span>
          {meta.message}
        </span>
      </div>
    </div>
  );
}

// ─── Target widget ────────────────────────────────────────────────────────────

function TargetsWidget({ targets }: { targets: TargetProgress[] }) {
  if (targets.length === 0) return null;

  // Show achievement banners for newly completed targets (one-time per target)
  const newlyAchieved = targets.filter(
    (t) => t.progress.percentage >= 100 && !localStorage.getItem(getAchievementKey(t.id))
  );

  return (
    <div className="mb-4">
      {/* Achievement banners sit above the widget */}
      {newlyAchieved.map((t) => (
        <TargetAchievementBanner key={t.id} target={t} />
      ))}

      <div className="card px-4 py-4">
        {/* Widget header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-base leading-none" role="img" aria-label="Target">
            {"\uD83C\uDFAF"}
          </span>
          <h3 className="text-sm font-semibold text-text-primary">Your Targets</h3>
        </div>

        {/* Target rows */}
        <div className="space-y-4">
          {targets.map((t) => (
            <TargetRow key={t.id} target={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

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

const INVOICE_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  partial: "Partial",
  sent: "Unpaid",
  overdue: "Overdue",
  draft: "Draft",
  cancelled: "Cancelled",
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

// Recharts ResponsiveContainer types are incompatible with React 19's stricter ReactNode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderResponsive(children: React.ReactElement, width: string, height: string) {
  return <ResponsiveContainer width={width as any} height={height as any}>{children as any}</ResponsiveContainer>;
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title,
  height = 260,
  children,
  responsive = true,
}: {
  title: string;
  height?: number;
  children: React.ReactElement;
  responsive?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="px-4 py-4" style={{ height }}>
        {responsive
          ? renderResponsive(children, "100%", "100%")
          : children}
      </div>
    </div>
  );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function SalesTrendChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  // For "all time" (no dates), fetch 24 months of history
  const { data: raw } = trpc.dashboard.salesTrend.useQuery({
    months: fromDate ? 12 : 24,
    fromDate,
    toDate,
  }, { placeholderData: keepPreviousData });

  // If data spans > 12 months, aggregate by FY (Apr-Mar) instead of monthly
  const data = (() => {
    if (!raw || raw.length === 0) return undefined;

    if (raw.length > 12) {
      // Aggregate by financial year
      const fyMap = new Map<string, { invoiced: number; collected: number }>();
      for (const r of raw) {
        const d = new Date(r.month);
        const m = d.getMonth();
        const fyStart = m < 3 ? d.getFullYear() - 1 : d.getFullYear();
        const label = `FY ${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        const existing = fyMap.get(label) || { invoiced: 0, collected: 0 };
        existing.invoiced += parseFloat(r.invoiced);
        existing.collected += parseFloat(r.collected);
        fyMap.set(label, existing);
      }
      return [...fyMap.entries()].map(([month, v]) => ({ month, ...v }));
    }

    return raw.map((r) => ({
      month: new Date(r.month).toLocaleString("en-IN", { month: "short", year: "2-digit" }),
      invoiced: parseFloat(r.invoiced),
      collected: parseFloat(r.collected),
    }));
  })();

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
  }, { placeholderData: keepPreviousData });

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
                  data={data.map(d => ({ ...d, label: INVOICE_STATUS_LABELS[d.status] || d.status }))}
                  dataKey="count"
                  nameKey="label"
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
                {INVOICE_STATUS_LABELS[entry.status] || entry.status} ({entry.count})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TopSellingChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const [itemType, setItemType] = useState("all");
  const { data: raw } = trpc.dashboard.topSellingItems.useQuery({
    limit: 5,
    itemType: itemType === "all" ? undefined : itemType as "product" | "service",
    fromDate,
    toDate,
  }, { placeholderData: keepPreviousData });

  if (!raw || raw.length === 0) {
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-border-light flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Top Selling</h3>
          <PillTabs tabs={TOP_SELLING_TABS} value={itemType} onChange={setItemType} size="sm" />
        </div>
        <div className="px-4 py-4" style={{ height: 260 }}>
          <ChartEmpty />
        </div>
      </div>
    );
  }

  const data = raw.map((r) => ({
    name: r.itemName,
    amount: parseFloat(r.totalAmount),
    qty: parseFloat(r.totalQty),
    unit: r.unit || "pcs",
    invoices: r.invoiceCount,
  }));

  const chartData = [...data].reverse(); // bottom-to-top for horizontal bar
  const barColor = itemType === "service" ? "#8b5cf6" : "#6366f1"; // purple for services, indigo for products/all

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Top Selling</h3>
        <PillTabs tabs={TOP_SELLING_TABS} value={itemType} onChange={setItemType} size="sm" />
      </div>
      <div className="px-4 py-4" style={{ height: 260 }}>
        {renderResponsive(
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + "…" : v}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(value: any, _name: any, props: any) => {
                const item = data.find((d) => d.name === props.payload.name);
                return [formatCurrency(String(value)) + (item ? ` (${item.qty.toLocaleString()} ${item.unit})` : ""), "Revenue"];
              }}
            />
            <Bar dataKey="amount" name="Revenue" fill={barColor} radius={[0, 3, 3, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }} />
          </BarChart>,
          "100%", "100%"
        )}
      </div>
    </div>
  );
}

const TOP_SELLING_TABS = [
  { value: "all", label: "All" },
  { value: "product", label: "Products" },
  { value: "service", label: "Services" },
];

function TopCustomersChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data: raw } = trpc.dashboard.topCustomers.useQuery(
    { limit: 5, fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!raw || raw.length === 0) {
    return (
      <ChartCard title="Top Customers" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const data = raw.map((r) => ({
    name: r.partyName,
    revenue: parseFloat(r.totalAmount),
    invoices: r.invoiceCount,
  }));

  const chartData = [...data].reverse();

  return (
    <ChartCard title="Top Customers" height={260}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: any, _name: any, props: any) => {
            const customer = data.find((d) => d.name === props.payload.name);
            return [formatCurrency(String(value)) + (customer ? ` (${customer.invoices} invoices)` : ""), "Revenue"];
          }}
        />
        <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[0, 3, 3, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }} />
      </BarChart>
    </ChartCard>
  );
}

function ChartEmpty() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
      No data for this period
    </div>
  );
}

// ─── Payment mode breakdown ───────────────────────────────────────────────────

const PAYMENT_MODE_COLORS: Record<string, string> = {
  cash:   "#10b981",
  bank:   "#5b5bd6",
  upi:    "#f59e0b",
  cheque: "#8b5cf6",
  other:  "#94a3b8",
};
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash:   "Cash",
  bank:   "Bank Transfer",
  upi:    "UPI",
  cheque: "Cheque",
  other:  "Other",
};

function PaymentModeWidget({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.paymentModeBreakdown.useQuery(
    { fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Payment Modes" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const grandTotal = data.reduce((s, d) => s + parseFloat(d.total), 0);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">Payment Modes</h3>
      </div>
      <div className="px-4 py-4" style={{ height: 260 }}>
        <div className="flex flex-col h-full">
          {/* Donut */}
          <div className="relative flex-1">
            {renderResponsive(
              <PieChart>
                <Pie
                  data={data.map((d) => ({
                    ...d,
                    name: PAYMENT_MODE_LABELS[d.mode] ?? d.mode,
                    value: parseFloat(d.total),
                  }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={76}
                  paddingAngle={2}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.mode}
                      fill={PAYMENT_MODE_COLORS[entry.mode] ?? "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: any) => formatCurrency(String(value))}
                />
              </PieChart>,
              "100%", "100%"
            )}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <span className="block text-xs font-bold tabular-nums text-text-primary">{formatCurrency(String(grandTotal))}</span>
                <span className="block text-[10px] text-text-tertiary">total</span>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pb-1">
            {data.map((entry) => {
              const pct = grandTotal > 0 ? Math.round((parseFloat(entry.total) / grandTotal) * 100) : 0;
              return (
                <span key={entry.mode} className="flex items-center gap-1 text-[11px] text-text-secondary">
                  <span
                    className="inline-block rounded-full shrink-0"
                    style={{ width: 8, height: 8, background: PAYMENT_MODE_COLORS[entry.mode] ?? "#94a3b8" }}
                  />
                  {PAYMENT_MODE_LABELS[entry.mode] ?? entry.mode} ({pct}%)
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Collection efficiency ────────────────────────────────────────────────────

function CollectionEfficiencyWidget({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.collectionEfficiency.useQuery(
    { fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!data || data.invoiceCount === 0) {
    return (
      <div className="card px-5 py-4">
        <p className="text-[11px] font-medium text-text-tertiary mb-1">Collection Efficiency</p>
        <p className="text-sm text-text-tertiary mt-2">No invoices for this period</p>
      </div>
    );
  }

  const pct = data.efficiencyPct;
  const prevPct = data.prevEfficiencyPct;
  const delta = prevPct !== null ? pct - prevPct : null;
  const isUp = delta !== null && delta >= 0;

  let barColor = "bg-emerald-500";
  if (pct < 50) barColor = "bg-red-500";
  else if (pct < 80) barColor = "bg-amber-500";

  return (
    <div className="card px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-text-tertiary">Collection Efficiency</p>
        {delta !== null && (
          <span className={cn(
            "flex items-center gap-0.5 text-[11px] font-medium tabular-nums shrink-0",
            isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          )}>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={isUp ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
            </svg>
            {Math.abs(delta)}pp vs prev
          </span>
        )}
      </div>
      <div>
        <span className={cn(
          "text-3xl font-bold tabular-nums",
          pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600"
        )}>
          {pct}%
        </span>
        <span className="ml-1.5 text-xs text-text-tertiary">collected</span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-text-tertiary">
        <span>{formatCurrency(data.totalCollected)} collected</span>
        <span>{formatCurrency(data.totalInvoiced)} invoiced</span>
      </div>
    </div>
  );
}

// ─── Expense category breakdown ───────────────────────────────────────────────

function ExpenseCategoryWidget({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.expenseCategoryBreakdown.useQuery(
    { fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!data || data.categories.length === 0) {
    return (
      <ChartCard title="Expenses by Category" responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const grandTotal = parseFloat(data.grandTotal);
  const chartData = [...data.categories].reverse(); // bottom-to-top for horizontal bar

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Expenses by Category</h3>
        <span className="text-[11px] text-text-tertiary tabular-nums">{formatCurrency(data.grandTotal)} total</span>
      </div>
      <div className="px-4 py-4" style={{ height: 260 }}>
        {renderResponsive(
          <BarChart
            layout="vertical"
            data={chartData.map((d) => ({
              name: d.category || "Uncategorised",
              amount: parseFloat(d.total),
              pct: grandTotal > 0 ? Math.round((parseFloat(d.total) / grandTotal) * 100) : 0,
            }))}
            margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + "…" : v}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(value: any, _name: any, props: any) => [
                `${formatCurrency(String(value))} (${props.payload.pct}%)`,
                "Amount",
              ]}
            />
            <Bar
              dataKey="amount"
              name="Amount"
              radius={[0, 3, 3, 0]}
              maxBarSize={18}
              label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>,
          "100%", "100%"
        )}
      </div>
    </div>
  );
}

// ─── Monthly comparison ───────────────────────────────────────────────────────

function MonthlyComparisonWidget() {
  const { data } = trpc.dashboard.monthlyComparison.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, placeholderData: keepPreviousData }
  );

  if (!data) return null;

  function DeltaBadge({ pct }: { pct: number | null }) {
    if (pct === null) return <span className="text-[11px] text-text-tertiary">—</span>;
    const isUp = pct >= 0;
    return (
      <span className={cn(
        "flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
        isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      )}>
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={isUp ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
        </svg>
        {Math.abs(pct)}%
      </span>
    );
  }

  const rows = [
    { label: "Sales",     curr: data.sales.curr,     prev: data.sales.prev,     pct: data.sales.pctChange,     color: "text-emerald-600" },
    { label: "Purchases", curr: data.purchases.curr, prev: data.purchases.prev, pct: data.purchases.pctChange, color: "text-blue-600" },
    { label: "Expenses",  curr: data.expenses.curr,  prev: data.expenses.prev,  pct: data.expenses.pctChange,  color: "text-text-primary" },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">Month on Month</h3>
      </div>
      <div className="px-4 py-3">
        {/* Header row */}
        <div className="grid grid-cols-4 gap-2 mb-2 text-[11px] font-medium text-text-tertiary">
          <span />
          <span className="text-right">{data.prevMonth}</span>
          <span className="text-right">{data.currMonth}</span>
          <span className="text-right">Change</span>
        </div>
        {/* Data rows */}
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-4 gap-2 items-center">
              <span className="text-xs font-medium text-text-secondary truncate">{row.label}</span>
              <span className="text-right text-xs tabular-nums text-text-tertiary">
                {formatCurrency(row.prev)}
              </span>
              <span className={cn("text-right text-xs font-semibold tabular-nums", row.color)}>
                {formatCurrency(row.curr)}
              </span>
              <div className="flex justify-end">
                <DeltaBadge pct={row.pct} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Period selector ──────────────────────────────────────────────────────────

const PERIOD_TABS = PERIODS.map((p) => ({ value: p.id, label: p.label }));

// ─── Summary cards ────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<PeriodId, string> = {
  "this-month": "This Month",
  "this-quarter": "This Quarter",
  "this-fy": "This Financial Year",
  "last-fy": "Last Financial Year",
  "all": "All Time",
};

function SummaryCards({
  data,
  period,
}: {
  data: {
    totalSales: string;
    totalPurchases: string;
    receivable: string;
    payable: string;
    cashInHand: string;
    totalExpenses: string;
    fyStart: string;
  };
  period: PeriodId;
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
    <div className="mb-6">
      <p className="text-[11px] font-medium text-text-tertiary mb-2">{PERIOD_LABELS[period]} — Receivable & Payable are current totals</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card px-4 py-3">
            <p className="text-[11px] font-medium text-text-tertiary mb-1 truncate">{c.label}</p>
            <p className={`text-base font-bold tabular-nums truncate ${c.color}`}>
              {formatCurrency(c.value)}
            </p>
          </div>
        ))}
      </div>
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
  const [isPending, startTransition] = useTransition();
  const { from, to } = getPeriodDates(period);

  function handlePeriodChange(p: PeriodId) {
    startTransition(() => setPeriod(p));
  }

  const { data, isLoading } = trpc.dashboard.summary.useQuery(
    from || to ? { fromDate: from, toDate: to } : undefined,
    { placeholderData: keepPreviousData }
  );

  const { data: statusBreakdown } = trpc.dashboard.invoiceStatusBreakdown.useQuery(
    from || to ? { fromDate: from, toDate: to } : {},
    { placeholderData: keepPreviousData }
  );

  // All-time stats for milestone checks — fetched once, independent of period
  const { data: allTimeBreakdown } = trpc.dashboard.invoiceStatusBreakdown.useQuery(
    {},
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: allTimeSummary } = trpc.dashboard.summary.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  );

  // Session — needed to gate the targets widget to sellers only
  const { data: session } = trpc.auth.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const isSellerRole =
    session?.role === "seller" || session?.role === "seller_manager";

  // Sales targets — only fetched for sellers and seller managers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: myTargetsRaw } = (trpc as any).target.myTargets.useQuery(
    undefined,
    { enabled: isSellerRole, staleTime: 2 * 60 * 1000 }
  );

  const myTargets: TargetProgress[] = myTargetsRaw ?? [];

  const businessId = getBusinessId() ?? "default";
  const totalAllTimeInvoices = allTimeBreakdown
    ? allTimeBreakdown.reduce((sum, s) => sum + s.count, 0)
    : 0;
  const totalAllTimeSales = allTimeSummary ? parseFloat(allTimeSummary.totalSales) : 0;
  const milestone = allTimeBreakdown && allTimeSummary
    ? checkMilestone(businessId, totalAllTimeInvoices, totalAllTimeSales)
    : null;

  if (isLoading && !data) return <PageSkeleton />;

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

  // Compute gross & net profit from summary data
  const grossProfit = parseFloat(data.totalSales) - parseFloat(data.totalPurchases);
  const netProfit = grossProfit - parseFloat(data.totalExpenses);

  // Find overdue invoices from status breakdown
  const overdueEntry = statusBreakdown?.find((s) => s.status === "overdue");
  const overdueCount = overdueEntry?.count ?? 0;
  const overdueAmount = overdueEntry?.total ?? "0";

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <div className="flex items-center gap-3">
            <PillTabs tabs={PERIOD_TABS} value={period} onChange={(v) => handlePeriodChange(v as PeriodId)} size="sm" />
            <Link to="/invoices" className="btn-primary">
              + New Invoice
            </Link>
          </div>
        }
      />

      <div style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s ease" }}>
      {milestone && (
        <MilestoneBanner message={milestone.message} milestoneKey={milestone.key} />
      )}

      {/* Sales target widget — only visible to sellers and seller managers */}
      {isSellerRole && myTargets.length > 0 && (
        <TargetsWidget targets={myTargets} />
      )}

      <SummaryCards data={data} period={period} />

      {/* Profit indicator cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card px-4 py-3">
          <p className="text-[11px] font-medium text-text-tertiary mb-1">Gross Profit</p>
          <p className={cn(
            "text-lg font-bold tabular-nums",
            grossProfit >= 0 ? "text-emerald-600" : "text-red-600"
          )}>
            {formatCurrency(String(grossProfit))}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-medium text-text-tertiary mb-1">Net Profit</p>
          <p className={cn(
            "text-lg font-bold tabular-nums",
            netProfit >= 0 ? "text-emerald-600" : "text-red-600"
          )}>
            {formatCurrency(String(netProfit))}
          </p>
        </div>
      </div>

      {/* Overdue invoices alert */}
      {overdueCount > 0 && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""} totaling {formatCurrency(overdueAmount)}
              </p>
              <p className="text-xs text-red-600/70 dark:text-red-400/60">Past due date with outstanding balance</p>
            </div>
          </div>
          <Link to="/invoices" className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0">
            View →
          </Link>
        </div>
      )}

      {/* Charts grid — all charts respect the selected period */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SalesTrendChart fromDate={from} toDate={to} />
        <InvoiceStatusChart fromDate={from} toDate={to} />
        <TopSellingChart fromDate={from} toDate={to} />
        <TopCustomersChart fromDate={from} toDate={to} />
      </div>

      {/* Analytics widgets — period-scoped */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <PaymentModeWidget fromDate={from} toDate={to} />
        <ExpenseCategoryWidget fromDate={from} toDate={to} />
      </div>

      {/* Efficiency + comparison row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <CollectionEfficiencyWidget fromDate={from} toDate={to} />
        <MonthlyComparisonWidget />
      </div>
      </div>
    </div>
  );
}
