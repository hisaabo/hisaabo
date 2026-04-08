import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Listbox } from "@/components/ui/Listbox";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";

export const Route = createFileRoute("/itc")({
  component: ITCPage,
});

// ── Constants ─────────────────────────────────────────────────

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ITCTab = "dashboard" | "ledger" | "aging" | "utilization" | "gstr3b-t4";

const itcBlockReasons = [
  "motor_vehicle", "food_beverage", "personal", "membership",
  "travel_benefits", "works_contract", "construction", "telecom",
  "other",
] as const;

type ItcBlockReason = (typeof itcBlockReasons)[number];

const BLOCK_REASONS: Array<{ value: ItcBlockReason; label: string }> = [
  { value: "motor_vehicle", label: "Motor Vehicle" },
  { value: "food_beverage", label: "Food & Beverage" },
  { value: "personal", label: "Personal Use" },
  { value: "membership", label: "Club Membership" },
  { value: "travel_benefits", label: "Travel Benefits" },
  { value: "works_contract", label: "Works Contract" },
  { value: "construction", label: "Construction" },
  { value: "telecom", label: "Telecom" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "available", label: "Available" },
  { value: "utilized", label: "Utilized" },
  { value: "reversed", label: "Reversed" },
  { value: "blocked", label: "Blocked" },
  { value: "reclaimed", label: "Reclaimed" },
];

const LEDGER_PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────

function fmt(n: string | number): string {
  const num = typeof n === "string" ? parseFloat(n) || 0 : n;
  return formatCurrency(num);
}

function returnPeriodString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case "available":
      return "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400";
    case "utilized":
      return "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400";
    case "reversed":
      return "bg-amber-600/[0.08] text-amber-700 dark:text-amber-400";
    case "blocked":
      return "bg-red-600/[0.08] text-red-700 dark:text-red-400";
    case "reclaimed":
      return "bg-teal-600/[0.08] text-teal-700 dark:text-teal-400";
    default:
      return "bg-surface-2 text-text-secondary";
  }
}

function urgencyBadgeColor(urgency: string): string {
  switch (urgency) {
    case "critical":
      return "bg-red-600/[0.08] text-red-700 dark:text-red-400";
    case "warning":
      return "bg-amber-600/[0.08] text-amber-700 dark:text-amber-400";
    default:
      return "bg-surface-2 text-text-secondary";
  }
}

// ── Main Page ─────────────────────────────────────────────────

function ITCPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTabRaw] = useState<ITCTab>(
    () => (localStorage.getItem("hisaabo_itc_tab") as ITCTab) || "dashboard",
  );

  const setActiveTab = (tab: ITCTab) => {
    setActiveTabRaw(tab);
    localStorage.setItem("hisaabo_itc_tab", tab);
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const returnPeriod = returnPeriodString(year, month);

  const tabs: Array<{ value: ITCTab; label: string }> = [
    { value: "dashboard", label: "Dashboard" },
    { value: "ledger", label: "Ledger" },
    { value: "aging", label: "Aging Alerts" },
    { value: "utilization", label: "Utilization" },
    { value: "gstr3b-t4", label: "GSTR-3B Table 4" },
  ];

  return (
    <div>
      <PageHeader
        title="Input Tax Credit"
        description="Track, manage, and utilize ITC across return periods"
      />

      {/* Tab bar */}
      <div className="mb-6">
        <PillTabs
          tabs={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as ITCTab)}
        />
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3 mb-6">
        <select
          className="input w-40"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Select month"
        >
          {months.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          className="input w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Select year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-xs text-text-tertiary ml-2">
          Return period: {months[month - 1]} {year}
        </span>
      </div>

      {activeTab === "dashboard" && (
        <DashboardView returnPeriod={returnPeriod} onNavigateTab={setActiveTab} />
      )}
      {activeTab === "ledger" && <LedgerView returnPeriod={returnPeriod} />}
      {activeTab === "aging" && <AgingAlertsView />}
      {activeTab === "utilization" && (
        <UtilizationView returnPeriod={returnPeriod} year={year} month={month} />
      )}
      {activeTab === "gstr3b-t4" && <GSTR3BTable4View year={year} month={month} />}
    </div>
  );
}

// ── Tab 1: Dashboard ──────────────────────────────────────────

function DashboardView({
  returnPeriod,
  onNavigateTab,
}: {
  returnPeriod: string;
  onNavigateTab?: (tab: ITCTab) => void;
}) {
  const { data, isLoading, error } = trpc.itc.dashboard.useQuery({ returnPeriod });
  const { data: agingData } = trpc.itc.agingAlerts.useQuery();

  if (isLoading) return <ReportSkeleton />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data) return <EmptyState title="No ITC data" description="No input tax credit data for this period." />;

  const criticalAlerts = (agingData ?? [])
    .filter((a) => a.urgency === "critical")
    .slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Available ITC */}
        <div className="card px-4 py-3 border-l-4 border-emerald-500">
          <p className="text-xs text-text-tertiary mb-1">Available ITC</p>
          <p className="text-lg font-bold tabular-nums text-emerald-600">{fmt(data.summary.available.total)}</p>
          <div className="mt-2 space-y-0.5">
            <p className="text-[11px] text-text-tertiary">CGST: {fmt(data.summary.available.cgst)}</p>
            <p className="text-[11px] text-text-tertiary">SGST: {fmt(data.summary.available.sgst)}</p>
            <p className="text-[11px] text-text-tertiary">IGST: {fmt(data.summary.available.igst)}</p>
          </div>
        </div>

        {/* Utilized */}
        <div className="card px-4 py-3 border-l-4 border-blue-500">
          <p className="text-xs text-text-tertiary mb-1">Utilized</p>
          <p className="text-lg font-bold tabular-nums text-blue-600">{fmt(data.summary.utilized.total)}</p>
          <div className="mt-2 space-y-0.5">
            <p className="text-[11px] text-text-tertiary">CGST: {fmt(data.summary.utilized.cgst)}</p>
            <p className="text-[11px] text-text-tertiary">SGST: {fmt(data.summary.utilized.sgst)}</p>
            <p className="text-[11px] text-text-tertiary">IGST: {fmt(data.summary.utilized.igst)}</p>
          </div>
        </div>

        {/* Reversed */}
        <div className="card px-4 py-3 border-l-4 border-amber-500">
          <p className="text-xs text-text-tertiary mb-1">Reversed</p>
          <p className="text-lg font-bold tabular-nums text-amber-600">{fmt(data.summary.reversed.total)}</p>
          <div className="mt-2 space-y-0.5">
            <p className="text-[11px] text-text-tertiary">CGST: {fmt(data.summary.reversed.cgst)}</p>
            <p className="text-[11px] text-text-tertiary">SGST: {fmt(data.summary.reversed.sgst)}</p>
            <p className="text-[11px] text-text-tertiary">IGST: {fmt(data.summary.reversed.igst)}</p>
          </div>
        </div>

        {/* Blocked */}
        <div className="card px-4 py-3 border-l-4 border-red-500">
          <p className="text-xs text-text-tertiary mb-1">Blocked (Sec 17(5))</p>
          <p className="text-lg font-bold tabular-nums text-red-600">{fmt(data.summary.blocked.total)}</p>
          <div className="mt-2 space-y-0.5">
            <p className="text-[11px] text-text-tertiary">CGST: {fmt(data.summary.blocked.cgst)}</p>
            <p className="text-[11px] text-text-tertiary">SGST: {fmt(data.summary.blocked.sgst)}</p>
            <p className="text-[11px] text-text-tertiary">IGST: {fmt(data.summary.blocked.igst)}</p>
          </div>
        </div>
      </div>

      {/* Aging alerts preview */}
      {criticalAlerts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Critical Aging Alerts</h3>
            <button
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              onClick={() => onNavigateTab?.("aging")}
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-border-light">
            {criticalAlerts.map((alert) => (
              <div
                key={alert.invoiceId}
                className="px-4 py-3 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {alert.invoiceNumber} — {alert.partyName}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {formatDate(alert.invoiceDate)} | {alert.daysOutstanding} days outstanding
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-red-600 whitespace-nowrap">
                  {fmt(alert.itcAmount)}
                </p>
                <span className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase",
                  urgencyBadgeColor(alert.urgency),
                )}>
                  {alert.urgency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Utilization summary if available */}
      {data.utilization && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">Utilization Summary</h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            <div>
              <p className="text-xs text-text-tertiary mb-1">CGST Utilized</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {fmt(data.utilization.cgstUtilized)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-1">SGST Utilized</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {fmt(data.utilization.sgstUtilized)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-1">IGST Utilized (against IGST)</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {fmt(data.utilization.igstUtilizedAgainstIgst)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-1">IGST Utilized (against CGST)</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {fmt(data.utilization.igstUtilizedAgainstCgst)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-1">IGST Utilized (against SGST)</p>
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {fmt(data.utilization.igstUtilizedAgainstSgst)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Ledger ─────────────────────────────────────────────

function LedgerView({ returnPeriod }: { returnPeriod: string }) {
  type LedgerStatus = "available" | "utilized" | "reversed" | "reclaimed" | "blocked";
  const [statusFilter, setStatusFilter] = useState<LedgerStatus | "">("");
  const [page, setPage] = useState(1);
  const [blockTarget, setBlockTarget] = useState<{
    invoiceId: string;
    invoiceNumber: string;
  } | null>(null);
  const [blockReason, setBlockReason] = useState<ItcBlockReason | "">("");
  const [blockNotes, setBlockNotes] = useState("");
  const [unblockTarget, setUnblockTarget] = useState<{
    invoiceId: string;
    invoiceNumber: string;
  } | null>(null);

  const { data, isLoading, error } = trpc.itc.ledger.useQuery({
    returnPeriod,
    status: statusFilter || undefined,
    page,
    limit: LEDGER_PAGE_SIZE,
  }, {
    placeholderData: (prev) => prev,
  });

  const utils = trpc.useUtils();

  const blockMutation = trpc.itc.markBlocked.useMutation({
    onSuccess: () => {
      utils.itc.ledger.invalidate();
      utils.itc.dashboard.invalidate();
      toast.success("ITC blocked successfully");
      setBlockTarget(null);
      setBlockReason("");
      setBlockNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const unblockMutation = trpc.itc.markEligible.useMutation({
    onSuccess: () => {
      utils.itc.ledger.invalidate();
      utils.itc.dashboard.invalidate();
      toast.success("ITC unblocked — marked as available");
      setUnblockTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  function handleBlock() {
    if (!blockTarget || !blockReason) return;
    blockMutation.mutate({
      invoiceId: blockTarget.invoiceId,
      blockReason,
      notes: blockNotes.trim() || undefined,
    });
  }

  const totalPages = data ? Math.ceil(data.pagination.total / LEDGER_PAGE_SIZE) : 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="w-48">
          <Listbox
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v as LedgerStatus | ""); setPage(1); }}
            options={STATUS_OPTIONS}
            placeholder="All Statuses"
          />
        </div>
        {data && (
          <span className="text-xs text-text-tertiary">
            {data.pagination.total} record{data.pagination.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <ReportSkeleton />
      ) : error ? (
        <ErrorCard message={error.message} />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState
          title="No ITC entries"
          description={statusFilter ? "No entries match the selected filter." : "No ITC entries for this period."}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Party</th>
                  <th>Invoice Date</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="text-right">CGST</th>
                  <th className="text-right">SGST</th>
                  <th className="text-right">IGST</th>
                  <th className="text-right">Total</th>
                  <th>RCM</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => {
                  const total =
                    (parseFloat(entry.cgst) || 0) +
                    (parseFloat(entry.sgst) || 0) +
                    (parseFloat(entry.igst) || 0) +
                    (parseFloat(entry.cess) || 0);

                  return (
                    <tr key={entry.id} className="group">
                      <td className="font-mono text-[13px] text-text-secondary whitespace-nowrap">
                        {entry.invoiceNumber}
                      </td>
                      <td className="text-text-primary max-w-[160px] truncate">
                        {entry.partyName}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap text-sm">
                        {entry.invoiceDate ? formatDate(entry.invoiceDate) : "—"}
                      </td>
                      <td className="text-text-tertiary text-sm">
                        {entry.returnPeriod}
                      </td>
                      <td>
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase",
                          statusBadgeColor(entry.status),
                        )}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="text-right tabular-nums text-text-secondary">{fmt(entry.cgst)}</td>
                      <td className="text-right tabular-nums text-text-secondary">{fmt(entry.sgst)}</td>
                      <td className="text-right tabular-nums text-text-secondary">{fmt(entry.igst)}</td>
                      <td className="text-right tabular-nums font-medium text-text-primary whitespace-nowrap">
                        {fmt(total)}
                      </td>
                      <td>
                        {entry.isReverseCharge && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase bg-purple-600/[0.08] text-purple-700 dark:text-purple-400">
                            RCM
                          </span>
                        )}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {entry.status === "available" && entry.invoiceId && (
                            <button
                              onClick={() =>
                                setBlockTarget({
                                  invoiceId: entry.invoiceId!,
                                  invoiceNumber: entry.invoiceNumber ?? "—",
                                })
                              }
                              className="px-2 py-1 rounded text-[11px] font-medium text-red-600 hover:bg-red-600/[0.08] transition-colors"
                              aria-label={`Block ITC for ${entry.invoiceNumber}`}
                            >
                              Block
                            </button>
                          )}
                          {entry.status === "blocked" && entry.invoiceId && (
                            <button
                              onClick={() =>
                                setUnblockTarget({
                                  invoiceId: entry.invoiceId!,
                                  invoiceNumber: entry.invoiceNumber ?? "—",
                                })
                              }
                              className="px-2 py-1 rounded text-[11px] font-medium text-emerald-600 hover:bg-emerald-600/[0.08] transition-colors"
                              aria-label={`Unblock ITC for ${entry.invoiceNumber}`}
                            >
                              Unblock
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border-light">
              <p className="text-xs text-text-tertiary">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Block ITC Dialog */}
      <Modal
        open={!!blockTarget}
        onClose={() => {
          setBlockTarget(null);
          setBlockReason("");
          setBlockNotes("");
        }}
        title="Block ITC — Section 17(5)"
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Block ITC for invoice <span className="font-medium text-text-primary">{blockTarget?.invoiceNumber}</span>.
            This will mark the credit as ineligible under Section 17(5).
          </p>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Block Reason <span className="text-red-500">*</span>
            </label>
            <Listbox
              value={blockReason}
              onChange={(v) => setBlockReason(v as ItcBlockReason)}
              options={BLOCK_REASONS}
              placeholder="Select reason..."
            />
          </div>

          <TextareaField
            label="Notes (optional)"
            placeholder="Additional details about the block..."
            value={blockNotes}
            onChange={(e) => setBlockNotes(e.target.value)}
            rows={3}
          />

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
            <button
              className="btn-ghost"
              onClick={() => {
                setBlockTarget(null);
                setBlockReason("");
                setBlockNotes("");
              }}
              disabled={blockMutation.isPending}
            >
              Cancel
            </button>
            <button
              className="btn-danger"
              onClick={handleBlock}
              disabled={!blockReason || blockMutation.isPending}
            >
              {blockMutation.isPending && <Spinner size="sm" />}
              Block
            </button>
          </div>
        </div>
      </Modal>

      {/* Unblock Confirmation */}
      <ConfirmDialog
        open={!!unblockTarget}
        onCancel={() => setUnblockTarget(null)}
        onConfirm={() =>
          unblockTarget &&
          unblockMutation.mutate({ invoiceId: unblockTarget.invoiceId })
        }
        title="Unblock ITC"
        description={`Mark ITC for invoice ${unblockTarget?.invoiceNumber} as available again? This will reverse the block.`}
        confirmLabel="Unblock"
        loading={unblockMutation.isPending}
      />
    </div>
  );
}

// ── Tab 3: Aging Alerts ───────────────────────────────────────

function AgingAlertsView() {
  const { data, isLoading, error } = trpc.itc.agingAlerts.useQuery();

  if (isLoading) return <ReportSkeleton />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No aging alerts"
        description="All ITC entries are within the safe period. No action needed."
      />
    );
  }

  // Sort: critical first, then by daysOutstanding descending
  const sorted = [...data].sort((a, b) => {
    if (a.urgency === "critical" && b.urgency !== "critical") return -1;
    if (a.urgency !== "critical" && b.urgency === "critical") return 1;
    return b.daysOutstanding - a.daysOutstanding;
  });

  const criticalCount = sorted.filter((a) => a.urgency === "critical").length;
  const totalAtRisk = sorted.reduce(
    (sum, a) => sum + (parseFloat(String(a.itcAmount)) || 0),
    0,
  );

  return (
    <div className="space-y-5">
      {/* Warning banner */}
      {criticalCount > 0 && (
        <div className="card px-4 py-3 border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                {criticalCount} critical alert{criticalCount !== 1 ? "s" : ""} — ITC at risk of expiry
              </p>
              <p className="text-xs text-red-600 dark:text-red-400/80 mt-0.5">
                {fmt(totalAtRisk)} in ITC is at risk. Invoices over 180 days old may lose ITC eligibility.
                Take action to claim these credits before they expire.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Total Alerts</p>
          <p className="text-lg font-bold tabular-nums text-text-primary">{sorted.length}</p>
        </div>
        <div className="card px-4 py-3 border-l-4 border-red-500">
          <p className="text-xs text-text-tertiary mb-1">Critical (&gt;180 days)</p>
          <p className="text-lg font-bold tabular-nums text-red-600">{criticalCount}</p>
        </div>
        <div className="card px-4 py-3 border-l-4 border-amber-500">
          <p className="text-xs text-text-tertiary mb-1">Warning (150–180 days)</p>
          <p className="text-lg font-bold tabular-nums text-amber-600">
            {sorted.length - criticalCount}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">
            Aging Alerts — {sorted.length} invoice{sorted.length !== 1 ? "s" : ""}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Party</th>
                <th>Invoice Date</th>
                <th className="text-right">Days Outstanding</th>
                <th className="text-right">ITC at Risk</th>
                <th>Urgency</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((alert) => (
                <tr key={alert.invoiceId}>
                  <td className="font-mono text-[13px] text-text-secondary whitespace-nowrap">
                    {alert.invoiceNumber}
                  </td>
                  <td className="text-text-primary max-w-[160px] truncate">
                    {alert.partyName}
                  </td>
                  <td className="text-text-secondary whitespace-nowrap text-sm">
                    {formatDate(alert.invoiceDate)}
                  </td>
                  <td className="text-right tabular-nums font-medium text-text-primary">
                    {alert.daysOutstanding}
                  </td>
                  <td className="text-right tabular-nums font-semibold text-red-600 whitespace-nowrap">
                    {fmt(alert.itcAmount)}
                  </td>
                  <td>
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase",
                      urgencyBadgeColor(alert.urgency),
                    )}>
                      {alert.urgency}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab 4: Utilization ────────────────────────────────────────

function UtilizationView({
  returnPeriod,
  year,
  month,
}: {
  returnPeriod: string;
  year: number;
  month: number;
}) {
  const { data: dashboard } = trpc.itc.dashboard.useQuery({ returnPeriod });

  const [cgstUtilized, setCgstUtilized] = useState("");
  const [sgstUtilized, setSgstUtilized] = useState("");
  const [igstVsIgst, setIgstVsIgst] = useState("");
  const [igstVsCgst, setIgstVsCgst] = useState("");
  const [igstVsSgst, setIgstVsSgst] = useState("");
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();

  const utilizationMutation = trpc.itc.recordUtilization.useMutation({
    onSuccess: () => {
      utils.itc.dashboard.invalidate();
      utils.itc.ledger.invalidate();
      toast.success("Utilization recorded successfully");
      setCgstUtilized("");
      setSgstUtilized("");
      setIgstVsIgst("");
      setIgstVsCgst("");
      setIgstVsSgst("");
      setNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSave() {
    utilizationMutation.mutate({
      returnPeriod,
      cgstUtilized: cgstUtilized || "0",
      sgstUtilized: sgstUtilized || "0",
      igstUtilizedAgainstIgst: igstVsIgst || "0",
      igstUtilizedAgainstCgst: igstVsCgst || "0",
      igstUtilizedAgainstSgst: igstVsSgst || "0",
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="space-y-6">
      {/* Available balance (read-only) */}
      {dashboard && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Available ITC Balance — {months[month - 1]} {year}
            </h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
            <div>
              <p className="text-xs text-text-tertiary mb-1">CGST</p>
              <p className="text-base font-semibold tabular-nums text-text-primary">
                {fmt(dashboard.summary.available.cgst)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-1">SGST</p>
              <p className="text-base font-semibold tabular-nums text-text-primary">
                {fmt(dashboard.summary.available.sgst)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-1">IGST</p>
              <p className="text-base font-semibold tabular-nums text-text-primary">
                {fmt(dashboard.summary.available.igst)}
              </p>
            </div>
            <div className="card px-3 py-2 border-2 border-border-color">
              <p className="text-xs text-text-tertiary mb-1 font-medium">Total Available</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">
                {fmt(dashboard.summary.available.total)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Utilization form */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Record Utilization</h3>
        </div>
        <div className="p-4 space-y-4">
          {/* Info text */}
          <div className="card px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-400">
              <span className="font-semibold">Prescribed utilization order:</span>{" "}
              IGST credit must be used first against IGST liability, then CGST, then SGST.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <InputField
              label="CGST Utilized"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={cgstUtilized}
              onChange={(e) => setCgstUtilized(e.target.value)}
            />
            <InputField
              label="SGST Utilized"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={sgstUtilized}
              onChange={(e) => setSgstUtilized(e.target.value)}
            />
            <div className="col-span-2 lg:col-span-1">
              <p className="text-xs font-medium text-text-secondary mb-3">IGST Cross-Utilization</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <InputField
              label="IGST → IGST"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={igstVsIgst}
              onChange={(e) => setIgstVsIgst(e.target.value)}
            />
            <InputField
              label="IGST → CGST"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={igstVsCgst}
              onChange={(e) => setIgstVsCgst(e.target.value)}
            />
            <InputField
              label="IGST → SGST"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={igstVsSgst}
              onChange={(e) => setIgstVsSgst(e.target.value)}
            />
          </div>

          <TextareaField
            label="Notes (optional)"
            placeholder="Any notes about this utilization..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />

          <div className="flex justify-end pt-2">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={utilizationMutation.isPending}
            >
              {utilizationMutation.isPending && <Spinner size="sm" />}
              Save Utilization
            </button>
          </div>
        </div>
      </div>

      {/* Past utilization display */}
      {dashboard?.utilization && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">Current Period Utilization</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Head</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-text-primary">CGST Utilized</td>
                  <td className="text-right tabular-nums font-medium">{fmt(dashboard.utilization.cgstUtilized)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary">SGST Utilized</td>
                  <td className="text-right tabular-nums font-medium">{fmt(dashboard.utilization.sgstUtilized)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary">IGST → IGST</td>
                  <td className="text-right tabular-nums font-medium">{fmt(dashboard.utilization.igstUtilizedAgainstIgst)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary">IGST → CGST</td>
                  <td className="text-right tabular-nums font-medium">{fmt(dashboard.utilization.igstUtilizedAgainstCgst)}</td>
                </tr>
                <tr>
                  <td className="text-text-primary">IGST → SGST</td>
                  <td className="text-right tabular-nums font-medium">{fmt(dashboard.utilization.igstUtilizedAgainstSgst)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 5: GSTR-3B Table 4 ───────────────────────────────────

function GSTR3BTable4View({ year, month }: { year: number; month: number }) {
  const { data, isLoading, error } = trpc.itc.gstr3bTable4.useQuery({ year, month });

  if (isLoading) return <ReportSkeleton />;
  if (error) return <ErrorCard message={error.message} />;
  if (!data) {
    return (
      <EmptyState
        title="No GSTR-3B Table 4 data"
        description="No ITC data available for this period."
      />
    );
  }

  type TaxRow = {
    integratedTax: string;
    centralTax: string;
    stateTax: string;
    cess: string;
  };

  function TaxColumns({ row }: { row: TaxRow }) {
    return (
      <>
        <td className="text-right tabular-nums text-text-secondary">{fmt(row.integratedTax)}</td>
        <td className="text-right tabular-nums text-text-secondary">{fmt(row.centralTax)}</td>
        <td className="text-right tabular-nums text-text-secondary">{fmt(row.stateTax)}</td>
        <td className="text-right tabular-nums text-text-secondary">{fmt(row.cess)}</td>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div className="card px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-400">
          GSTR-3B Table 4 — Eligible ITC for{" "}
          <span className="font-semibold">{months[month - 1]} {year}</span>.
          This table matches the official GSTR-3B format.
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="min-w-[280px]">Details</th>
                <th className="text-right">Integrated Tax</th>
                <th className="text-right">Central Tax</th>
                <th className="text-right">State/UT Tax</th>
                <th className="text-right">Cess</th>
              </tr>
            </thead>
            <tbody>
              {/* 4(A) ITC Available */}
              <tr className="bg-surface-1">
                <td className="font-semibold text-text-primary" colSpan={5}>
                  4(A) ITC Available (whether in full or part)
                </td>
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(1) Import of goods</td>
                <TaxColumns row={data.itcAvailable.importOfGoods} />
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(2) Import of services</td>
                <TaxColumns row={data.itcAvailable.importOfServices} />
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(3) Inward supplies liable to reverse charge</td>
                <TaxColumns row={data.itcAvailable.reverseCharge} />
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(5) All other ITC</td>
                <TaxColumns row={data.itcAvailable.allOther} />
              </tr>
              <tr className="border-t border-border-light bg-surface-1">
                <td className="font-medium text-text-primary pl-6">Total 4(A)</td>
                <td className="text-right tabular-nums font-semibold text-emerald-600">{fmt(data.itcAvailable.total.integratedTax)}</td>
                <td className="text-right tabular-nums font-semibold text-emerald-600">{fmt(data.itcAvailable.total.centralTax)}</td>
                <td className="text-right tabular-nums font-semibold text-emerald-600">{fmt(data.itcAvailable.total.stateTax)}</td>
                <td className="text-right tabular-nums font-semibold text-emerald-600">{fmt(data.itcAvailable.total.cess)}</td>
              </tr>

              {/* 4(B) ITC Reversed */}
              <tr className="bg-surface-1 border-t-2 border-border-color">
                <td className="font-semibold text-text-primary" colSpan={5}>
                  4(B) ITC Reversed
                </td>
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(1) As per Rules 42 & 43 of CGST Rules</td>
                <TaxColumns row={data.itcReversed.rules42_43} />
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(2) Others (Section 17(5))</td>
                <TaxColumns row={data.itcReversed.others} />
              </tr>
              <tr className="border-t border-border-light bg-surface-1">
                <td className="font-medium text-text-primary pl-6">Total 4(B)</td>
                <td className="text-right tabular-nums font-semibold text-amber-600">{fmt(data.itcReversed.total.integratedTax)}</td>
                <td className="text-right tabular-nums font-semibold text-amber-600">{fmt(data.itcReversed.total.centralTax)}</td>
                <td className="text-right tabular-nums font-semibold text-amber-600">{fmt(data.itcReversed.total.stateTax)}</td>
                <td className="text-right tabular-nums font-semibold text-amber-600">{fmt(data.itcReversed.total.cess)}</td>
              </tr>

              {/* 4(C) Net ITC */}
              <tr className="border-t-2 border-border-color bg-surface-1">
                <td className="font-bold text-text-primary">
                  4(C) Net ITC Available (A – B)
                </td>
                <td className="text-right tabular-nums font-bold text-emerald-600">{fmt(data.netItc.integratedTax)}</td>
                <td className="text-right tabular-nums font-bold text-emerald-600">{fmt(data.netItc.centralTax)}</td>
                <td className="text-right tabular-nums font-bold text-emerald-600">{fmt(data.netItc.stateTax)}</td>
                <td className="text-right tabular-nums font-bold text-emerald-600">{fmt(data.netItc.cess)}</td>
              </tr>

              {/* 4(D) Ineligible ITC */}
              <tr className="bg-surface-1 border-t-2 border-border-color">
                <td className="font-semibold text-text-primary" colSpan={5}>
                  4(D) Ineligible ITC
                </td>
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(1) As per Section 17(5)</td>
                <TaxColumns row={data.ineligible.section17_5} />
              </tr>
              <tr>
                <td className="text-text-secondary pl-6">(2) Others</td>
                <TaxColumns row={data.ineligible.others} />
              </tr>
              <tr className="border-t border-border-light bg-surface-1">
                <td className="font-medium text-text-primary pl-6">Total 4(D)</td>
                <td className="text-right tabular-nums font-semibold text-red-600">{fmt(data.ineligible.total.integratedTax)}</td>
                <td className="text-right tabular-nums font-semibold text-red-600">{fmt(data.ineligible.total.centralTax)}</td>
                <td className="text-right tabular-nums font-semibold text-red-600">{fmt(data.ineligible.total.stateTax)}</td>
                <td className="text-right tabular-nums font-semibold text-red-600">{fmt(data.ineligible.total.cess)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-400">Failed to load data: {message}</p>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card px-4 py-3">
            <div className="skeleton h-3 w-20 mb-2" />
            <div className="skeleton h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-light">
          <div className="skeleton h-4 w-32" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 border-b border-border-light last:border-0">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 flex-1" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
