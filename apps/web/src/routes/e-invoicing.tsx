import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { InputField } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchInput } from "@/components/ui/SearchInput";

export const Route = createFileRoute("/e-invoicing")({
  component: EInvoicingPage,
});

// ── Types ─────────────────────────────────────────────────────

type EInvoiceTab = "dashboard" | "settings";

const CANCEL_REASONS = [
  { value: "1", label: "Duplicate" },
  { value: "2", label: "Data entry mistake" },
  { value: "3", label: "Order cancelled" },
  { value: "4", label: "Others" },
] as const;

type CancelReason = (typeof CANCEL_REASONS)[number]["value"];

const PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────

function statusColor(status: string | null | undefined): string {
  switch (status) {
    case "generated":
      return badgeColor("emerald");
    case "pending":
      return badgeColor("amber");
    case "failed":
      return badgeColor("red");
    case "cancelled":
      return "bg-surface-2 text-text-tertiary";
    default:
      return badgeColorFallback;
  }
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Dashboard tab ─────────────────────────────────────────────

function DashboardTab() {
  const [tab, setTab] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason>("1");
  const [cancelRemarks, setCancelRemarks] = useState("");

  const { data, isLoading } = trpc.eInvoice.dashboard.useQuery({
    status: (tab as "pending" | "generated" | "failed" | "cancelled") || undefined,
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  }, { placeholderData: (prev) => prev });

  const utils = trpc.useUtils();

  const generateMutation = trpc.eInvoice.generate.useMutation({
    onSuccess: () => {
      toast.success("IRN generated successfully");
      utils.eInvoice.dashboard.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = trpc.eInvoice.cancel.useMutation({
    onSuccess: () => {
      toast.success("IRN cancelled");
      setCancelId(null);
      utils.eInvoice.dashboard.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkRetryMutation = trpc.eInvoice.bulkRetry.useMutation({
    onSuccess: (result) => {
      toast.success(`Retry complete: ${result.succeeded} succeeded, ${result.failed} failed`);
      utils.eInvoice.dashboard.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const counts = data?.counts ?? { generated: 0, pending: 0, failed: 0, cancelled: 0 };
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const statusTabs = [
    { value: "", label: `All (${Object.values(counts).reduce((a, b) => a + b, 0)})` },
    { value: "generated", label: `Generated (${counts.generated})` },
    { value: "pending", label: `Pending (${counts.pending})` },
    { value: "failed", label: `Failed (${counts.failed})` },
    { value: "cancelled", label: `Cancelled (${counts.cancelled})` },
  ];

  const hasFailed = (counts.failed + counts.pending) > 0;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Generated", value: counts.generated, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Pending", value: counts.pending, color: "text-amber-600 dark:text-amber-400" },
          { label: "Failed", value: counts.failed, color: "text-red-600 dark:text-red-400" },
          { label: "Cancelled", value: counts.cancelled, color: "text-text-secondary" },
        ].map((card) => (
          <div key={card.label} className="card p-4">
            <div className={cn("text-2xl font-bold tabular-nums", card.color)}>{card.value}</div>
            <div className="text-xs text-text-tertiary mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Filters + bulk retry */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-border-light">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search invoice # or party..."
            className="max-w-xs"
          />
          {hasFailed && (
            <button
              onClick={() => bulkRetryMutation.mutate()}
              disabled={bulkRetryMutation.isPending}
              className="btn-secondary text-sm ml-auto flex items-center gap-1.5"
            >
              {bulkRetryMutation.isPending && <Spinner size="sm" />}
              Retry All Failed
            </button>
          )}
        </div>

        {/* Status tabs */}
        <div className="px-4 py-2 border-b border-border-light">
          <PillTabs tabs={statusTabs} value={tab} onChange={(v) => { setTab(v); setPage(1); }} />
        </div>

        {/* Table */}
        {isLoading ? (
          <DashboardSkeleton />
        ) : !data?.data.length ? (
          <EmptyState
            title="No e-invoices"
            description={
              tab || search
                ? "No invoices match your filters"
                : "E-invoice status will appear here once invoices are submitted to IRP"
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Party</th>
                  <th>Amount</th>
                  <th>IRN</th>
                  <th>Ack Date</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((inv) => (
                  <tr key={inv.id} className="group">
                    <td className="font-mono text-xs text-text-primary">{inv.invoiceNumber}</td>
                    <td className="text-text-secondary whitespace-nowrap">{formatDate(inv.invoiceDate)}</td>
                    <td className="text-text-primary max-w-[180px] truncate">{inv.partyName}</td>
                    <td className="text-right tabular-nums font-semibold">{formatCurrency(inv.totalAmount)}</td>
                    <td className="font-mono text-[10px] text-text-tertiary max-w-[140px] truncate">
                      {inv.irn ?? "—"}
                    </td>
                    <td className="text-text-secondary whitespace-nowrap text-xs">
                      {inv.irnAckDate ? formatDate(inv.irnAckDate) : "—"}
                    </td>
                    <td>
                      <Badge size="sm" color={statusColor(inv.eInvoiceStatus)} className="uppercase">
                        {statusLabel(inv.eInvoiceStatus)}
                      </Badge>
                      {inv.eInvoiceError && (
                        <span className="ml-1.5 text-[10px] text-red-500" title={inv.eInvoiceError}>
                          ⚠
                        </span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {(inv.eInvoiceStatus === "failed" || inv.eInvoiceStatus === "pending") && (
                          <button
                            onClick={() => generateMutation.mutate({ invoiceId: inv.id })}
                            disabled={generateMutation.isPending}
                            className="text-[11px] px-2 py-0.5 rounded bg-brand-600/[0.08] text-brand-700 dark:text-brand-400 hover:bg-brand-600/[0.14] transition-colors"
                            title="Retry"
                          >
                            Retry
                          </button>
                        )}
                        {inv.eInvoiceStatus === null && (
                          <button
                            onClick={() => generateMutation.mutate({ invoiceId: inv.id })}
                            disabled={generateMutation.isPending}
                            className="text-[11px] px-2 py-0.5 rounded bg-brand-600/[0.08] text-brand-700 dark:text-brand-400 hover:bg-brand-600/[0.14] transition-colors"
                          >
                            Generate
                          </button>
                        )}
                        {inv.eInvoiceStatus === "generated" && inv.irn && (
                          <button
                            onClick={() => {
                              setCancelId(inv.id);
                              setCancelReason("1");
                              setCancelRemarks("");
                            }}
                            className="text-[11px] px-2 py-0.5 rounded bg-red-600/[0.08] text-red-600 dark:text-red-400 hover:bg-red-600/[0.14] transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border-light flex items-center justify-between text-sm text-text-secondary">
            <span>{total} invoices</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-border-light hover:bg-surface-2 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded border border-border-light hover:bg-surface-2 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel IRN modal */}
      <Modal open={cancelId !== null} onClose={() => setCancelId(null)} className="max-w-md">
        <p className="text-sm font-semibold text-text-primary">Cancel IRN</p>
        <p className="text-sm text-text-secondary mt-2">
          This will cancel the IRN on the NIC portal. Cancellation is only allowed within 24 hours
          of generation. This action cannot be undone.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Cancel Reason
            </label>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value as CancelReason)}
              className="input w-full text-sm"
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <InputField
            label="Remarks (optional)"
            value={cancelRemarks}
            onChange={(e) => setCancelRemarks(e.target.value)}
            maxLength={100}
            placeholder="Additional details..."
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border-light">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCancelId(null)}
            disabled={cancelMutation.isPending}
          >
            Close
          </button>
          <button
            type="button"
            className="btn-danger flex items-center gap-1.5"
            onClick={() => {
              if (!cancelId) return;
              cancelMutation.mutate({
                invoiceId: cancelId,
                cancelReason: cancelReason,
                cancelRemarks: cancelRemarks || undefined,
              });
            }}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending && <Spinner size="sm" />}
            Cancel IRN
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────

type ConfigForm = {
  gstin: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  isSandbox: boolean;
  isEnabled: boolean;
  thresholdCrore: string;
};

const EMPTY_CONFIG: ConfigForm = {
  gstin: "",
  clientId: "",
  clientSecret: "",
  username: "",
  password: "",
  isSandbox: true,
  isEnabled: false,
  thresholdCrore: "5",
};

function SettingsTab() {
  const [form, setForm] = useState<ConfigForm>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { isLoading, data: configData } = trpc.eInvoice.getConfig.useQuery(undefined);

  useEffect(() => {
    if (configData && !loaded) {
      setForm({
        gstin: configData.gstin,
        clientId: configData.clientId,
        clientSecret: "", // Don't pre-fill masked values
        username: configData.username,
        password: "", // Don't pre-fill masked values
        isSandbox: configData.isSandbox,
        isEnabled: configData.isEnabled,
        thresholdCrore: String(configData.thresholdCrore ?? "5"),
      });
      setLoaded(true);
    }
  }, [configData, loaded]);

  const utils = trpc.useUtils();

  const saveMutation = trpc.eInvoice.configure.useMutation({
    onSuccess: () => {
      toast.success("E-invoice settings saved");
      utils.eInvoice.getConfig.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = trpc.eInvoice.testConnection.useMutation({
    onSuccess: (result) => {
      setTestResult(result);
    },
    onError: (err) => {
      setTestResult({ success: false, message: err.message });
    },
  });

  function setField<K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveMutation.mutate({
      gstin: form.gstin.trim().toUpperCase(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret.trim(),
      username: form.username.trim(),
      password: form.password,
      isSandbox: form.isSandbox,
      isEnabled: form.isEnabled,
      thresholdCrore: form.thresholdCrore,
    });
  }

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">IRP Credentials</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Credentials issued by NIC (National Informatics Centre) for the Invoice Registration Portal.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="GSTIN"
            value={form.gstin}
            onChange={(e) => setField("gstin", e.target.value.toUpperCase())}
            placeholder="27AABCM1234R1ZM"
            maxLength={15}
          />
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Threshold (crore)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.thresholdCrore}
              onChange={(e) => setField("thresholdCrore", e.target.value)}
              className="input w-full"
            />
            <p className="text-[10px] text-text-tertiary mt-1">
              Annual turnover threshold for mandatory e-invoicing
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Client ID"
            value={form.clientId}
            onChange={(e) => setField("clientId", e.target.value)}
            placeholder="Your IRP client ID"
          />
          <InputField
            label="Client Secret"
            value={form.clientSecret}
            onChange={(e) => setField("clientSecret", e.target.value)}
            type="password"
            placeholder="Enter to update secret"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Username"
            value={form.username}
            onChange={(e) => setField("username", e.target.value)}
            placeholder="Your IRP username"
          />
          <InputField
            label="Password"
            value={form.password}
            onChange={(e) => setField("password", e.target.value)}
            type="password"
            placeholder="Enter to update password"
          />
        </div>

        {/* Toggle options */}
        <div className="flex flex-col gap-3 pt-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isSandbox}
              onChange={(e) => setField("isSandbox", e.target.checked)}
              className="w-4 h-4 rounded border-border-light text-brand-600"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">Use Sandbox (Testing)</span>
              <p className="text-xs text-text-tertiary">
                Connect to NIC sandbox for testing. Disable for production use.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(e) => setField("isEnabled", e.target.checked)}
              className="w-4 h-4 rounded border-border-light text-brand-600"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">Enable E-Invoicing</span>
              <p className="text-xs text-text-tertiary">
                Automatically submit eligible B2B invoices to IRP on creation.
              </p>
            </div>
          </label>
        </div>

        {/* Test connection result */}
        {testResult && (
          <div className={cn(
            "rounded-lg px-4 py-3 text-sm flex items-start gap-2",
            testResult.success
              ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
              : "bg-red-600/[0.08] text-red-700 dark:text-red-400",
          )}>
            <span>{testResult.success ? "✓" : "✗"}</span>
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="btn-primary flex items-center gap-1.5"
          >
            {saveMutation.isPending && <Spinner size="sm" />}
            Save Settings
          </button>
          <button
            onClick={() => { setTestResult(null); testMutation.mutate(); }}
            disabled={testMutation.isPending}
            className="btn-secondary flex items-center gap-1.5"
          >
            {testMutation.isPending && <Spinner size="sm" />}
            Test Connection
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="card p-5 bg-brand-50 dark:bg-brand-950/20 border-brand-200 dark:border-brand-800/40">
        <h4 className="text-sm font-semibold text-brand-800 dark:text-brand-300 mb-2">
          About E-Invoicing
        </h4>
        <ul className="text-xs text-brand-700 dark:text-brand-400 space-y-1 list-disc list-inside">
          <li>Mandatory for businesses with annual turnover above threshold</li>
          <li>B2B invoices (buyer has GSTIN) are eligible for e-invoicing</li>
          <li>IRN can only be cancelled within 24 hours of generation</li>
          <li>Sandbox mode uses NIC test environment (safe for testing)</li>
        </ul>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="divide-y divide-border-light">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
          <div className="h-3 bg-surface-2 rounded w-24" />
          <div className="h-3 bg-surface-2 rounded w-16" />
          <div className="h-3 bg-surface-2 rounded w-32" />
          <div className="h-3 bg-surface-2 rounded w-20 ml-auto" />
          <div className="h-4 bg-surface-2 rounded-full w-16" />
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

const MAIN_TABS: Array<{ value: EInvoiceTab; label: string }> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "settings", label: "Settings" },
];

function EInvoicingPage() {
  const [activeTab, setActiveTab] = useState<EInvoiceTab>("dashboard");

  return (
    <div>
      <PageHeader
        title="E-Invoicing"
        description="Submit invoices to NIC IRP and manage IRN lifecycle"
      />

      <div className="mb-5">
        <PillTabs
          tabs={MAIN_TABS}
          value={activeTab}
          onChange={(v) => setActiveTab(v as EInvoiceTab)}
        />
      </div>

      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "settings" && <SettingsTab />}
    </div>
  );
}
