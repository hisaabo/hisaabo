import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatCurrency, formatDate, downloadCSV } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDebounce } from "@/hooks/useDebounce";
import { useDateRange } from "@/hooks/useDateRange";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { SearchInput } from "@/components/ui/SearchInput";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { RecordPaymentPanel } from "@/components/RecordPaymentPanel";

export const Route = createFileRoute("/payments")({
  component: PaymentsPage,
});

// ── Smart auto-assignment banner ──────────────────────────────────────────────

const SECONDS_PER_MANUAL_ASSIGN = 75;

function getAutoAssignKey(businessId: string) {
  return `hisaabo_autoassign_shown_${businessId}`;
}

function formatTimeSaved(assignedCount: number): string {
  const totalSeconds = assignedCount * SECONDS_PER_MANUAL_ASSIGN;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `~${minutes} minute${minutes !== 1 ? "s" : ""}`;
  const hours = Math.round(minutes / 60);
  return `~${hours} hour${hours !== 1 ? "s" : ""}`;
}

// Maximum payment amount auto-assigned without confirmation (safety guardrail)
const AUTO_ASSIGN_AMOUNT_LIMIT = "50000.00";

type AssignmentMap = {
  mode: "cash" | "upi" | "bank";
  bankAccountId: string;
  accountName: string;
  paymentIds: string[];
};

function SmartAssignBanner({ onAssigned }: { onAssigned: () => void }) {
  const businessId = getBusinessId() ?? "";
  const bannerKey = getAutoAssignKey(businessId);

  // One-time check: has this banner already been shown for this business?
  const alreadyShown = businessId ? !!localStorage.getItem(bannerKey) : true;

  const [bannerState, setBannerState] = useState<
    | { status: "idle" }
    | { status: "assigning" }
    | { status: "done"; assignedCount: number }
    | { status: "dismissed" }
  >({ status: "idle" });

  // Prevent the effect from firing more than once per mount
  const didRunRef = useRef(false);

  const { data: untrackedData, isSuccess: untrackedReady } =
    trpc.payment.untrackedPayments.useQuery(
      { page: 1, limit: 100 },
      { enabled: !alreadyShown && bannerState.status === "idle" }
    );

  const { data: accounts, isSuccess: accountsReady } =
    trpc.bankAccount.list.useQuery(undefined, {
      enabled: !alreadyShown && bannerState.status === "idle",
    });

  const utils = trpc.useUtils();

  const assignMutation = trpc.payment.assignAccount.useMutation({
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (alreadyShown) return;
    if (!untrackedReady || !accountsReady) return;
    if (didRunRef.current) return;
    if (bannerState.status !== "idle") return;

    const payments = untrackedData?.data ?? [];
    const totalUntracked = untrackedData?.total ?? 0;
    if (totalUntracked === 0 || payments.length === 0) return;

    // Build mode-to-account mapping — only for unambiguous (single-account) cases
    const cashAccounts = (accounts ?? []).filter((a) => a.accountType === "cash");
    const upiAccounts = (accounts ?? []).filter((a) => a.accountType === "upi");
    const bankAccounts = (accounts ?? []).filter(
      (a) => a.accountType === "savings" || a.accountType === "current"
    );

    const modeAccountMap: Partial<Record<"cash" | "upi" | "bank", string>> = {};
    if (cashAccounts.length === 1) modeAccountMap.cash = cashAccounts[0].id;
    if (upiAccounts.length === 1) modeAccountMap.upi = upiAccounts[0].id;
    if (bankAccounts.length === 1) modeAccountMap.bank = bankAccounts[0].id;

    if (Object.keys(modeAccountMap).length === 0) return;

    // Group payments by mode, filter to mappable + within amount guardrail
    const groups: AssignmentMap[] = [];
    for (const [mode, accountId] of Object.entries(modeAccountMap) as [
      "cash" | "upi" | "bank",
      string
    ][]) {
      const matchingPayments = payments.filter(
        (p) =>
          p.mode === mode &&
          parseFloat(p.amount) <= parseFloat(AUTO_ASSIGN_AMOUNT_LIMIT)
      );
      if (matchingPayments.length === 0) continue;

      const accountName =
        (accounts ?? []).find((a) => a.id === accountId)?.accountName ?? accountId;

      groups.push({
        mode,
        bankAccountId: accountId,
        accountName,
        paymentIds: matchingPayments.map((p) => p.id),
      });
    }

    if (groups.length === 0) return;

    didRunRef.current = true;

    // Run all assignments in parallel
    setBannerState({ status: "assigning" });

    Promise.all(
      groups.map((g) =>
        assignMutation.mutateAsync({
          paymentIds: g.paymentIds,
          bankAccountId: g.bankAccountId,
        })
      )
    )
      .then((results) => {
        const totalAssigned = results.reduce((sum, r) => sum + r.assigned, 0);
        if (totalAssigned > 0) {
          utils.payment.list.invalidate();
          utils.payment.untrackedPayments.invalidate();
          utils.bankAccount.list.invalidate();
          utils.bankAccount.summary.invalidate();
          setBannerState({ status: "done", assignedCount: totalAssigned });
          onAssigned();
        } else {
          setBannerState({ status: "dismissed" });
        }
      })
      .catch(() => {
        setBannerState({ status: "dismissed" });
      });
  }, [alreadyShown, untrackedReady, accountsReady, untrackedData, accounts]);

  function dismiss() {
    if (businessId) localStorage.setItem(bannerKey, "1");
    setBannerState({ status: "dismissed" });
  }

  if (alreadyShown) return null;
  if (bannerState.status === "idle" || bannerState.status === "assigning") return null;
  if (bannerState.status === "dismissed") return null;
  if (bannerState.status !== "done") return null;

  const { assignedCount } = bannerState;
  const timeSaved = formatTimeSaved(assignedCount);

  return (
    <div className="mb-4 animate-milestone-enter" role="status" aria-live="polite">
      <div className="px-4 py-3.5 rounded-xl border border-brand-200 bg-brand-50 dark:bg-brand-950/20 dark:border-brand-800/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Star icon */}
            <svg
              className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-300 mb-0.5">
                Smart Assignment
              </p>
              <p className="text-sm text-brand-600 dark:text-brand-400 leading-snug">
                We auto-assigned{" "}
                <span className="font-semibold">{assignedCount}</span>{" "}
                {assignedCount === 1 ? "payment" : "payments"} to{" "}
                {assignedCount === 1 ? "its" : "their"} matching bank{" "}
                {assignedCount === 1 ? "account" : "accounts"} based on payment
                mode. That&apos;s{" "}
                <span className="font-semibold">{timeSaved}</span> of manual
                work saved.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 p-1 rounded-lg text-brand-500 hover:text-brand-700 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
            aria-label="Dismiss smart assignment notification"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const modeLabels: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  upi: "UPI",
  cheque: "Cheque",
  other: "Other",
};

const PAYMENTS_PAGE_SIZE = 25;

function PaymentsPage() {
  const [showPanel, setShowPanel] = useState(false);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const dateRange = useDateRange("payments", "this-month");

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, dateRange.fromDate, dateRange.toDate]);

  const loadMore = useCallback(() => setPage((p) => p + 1), []);

  const { data, isFetching, isLoading } = trpc.payment.list.useQuery({
    page,
    limit: PAYMENTS_PAGE_SIZE,
    search: debouncedSearch || undefined,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
  });

  const list = useInfiniteList({
    key: "payments",
    data: data?.data,
    total: data?.total ?? 0,
    page,
    isFetching,
    onLoadMore: loadMore,
    resetDeps: [debouncedSearch, dateRange.fromDate, dateRange.toDate],
  });
  const utils = trpc.useUtils();

  const deleteMutation = trpc.payment.delete.useMutation({
    onSuccess: () => {
      utils.payment.list.invalidate();
      utils.dashboard.summary.invalidate();
      setDeleteId(null);
      toast.success("Payment deleted");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // Keyboard shortcut: N to open panel
  useHotkeys([
    {
      key: "n",
      handler: () => setShowPanel(true),
      description: "Record new payment",
      scope: "payments",
    },
  ]);

  async function exportPaymentsCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.payment.list.fetch({
          page: pg,
          limit: 100,
          search: debouncedSearch || undefined,
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Payment #", "Date", "Party", "Mode", "Reference", "Amount"];
      const rows = allData.map((p: any) => [
        p.paymentNumber || "",
        formatDate(p.paymentDate),
        p.partyName,
        p.mode,
        p.referenceNumber || "",
        p.amount,
      ]);

      downloadCSV(`payments_${dateRange.preset}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Track money in and out"
        actions={
          <button
            className="btn-primary"
            onClick={() => setShowPanel(true)}
          >
            + Record Payment
            <KbdShortcut keys={["N"]} className="ml-2 opacity-70" />
          </button>
        }
      />

      {/* Smart auto-assign banner — one-time per business, shown only when assignments fire */}
      <SmartAssignBanner onAssigned={() => utils.payment.list.invalidate()} />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by party or payment #..."
          className="max-w-xs"
        />
      </div>
      <DateRangeBar
        preset={dateRange.preset}
        onPresetChange={dateRange.setPreset}
        customFrom={dateRange.customFrom}
        customTo={dateRange.customTo}
        onCustomChange={dateRange.setCustomRange}
        onExport={exportPaymentsCSV}
        exporting={exporting}
        className="mb-4"
      />

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : !list.items.length && !isFetching ? (
        <EmptyState
          title="No payments recorded yet"
          description="Record your first payment to start tracking cash flow."
          encouragement="Once you start invoicing, payments will show here."
          action={
            <button className="btn-primary" onClick={() => setShowPanel(true)}>
              + Record Payment
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div
            ref={list.scrollRef}
            onScroll={list.onScroll}
            className="max-h-[600px] overflow-y-auto"
          >
            <table className="data-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Payment #</th>
                  <th>Party</th>
                  <th>Date</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id} className="group cursor-pointer" onClick={() => setSelectedPaymentId(p.id)}>
                    <td className="font-mono text-[13px] text-text-secondary">
                      {p.paymentNumber || "—"}
                    </td>
                    <td className="font-medium">{p.partyName}</td>
                    <td className="text-text-secondary">{formatDate(p.paymentDate)}</td>
                    <td className="text-text-secondary">
                      {modeLabels[p.mode] || p.mode}
                    </td>
                    <td className="text-text-secondary text-xs">
                      {p.referenceNumber || "—"}
                    </td>
                    <td className="text-right tabular-nums font-semibold text-emerald-600">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="text-xs px-2 py-1 rounded font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                          onClick={() => setEditPaymentId(p.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => setDeleteId(p.id)}
                          aria-label="Delete payment"
                        >
                          <svg
                            className="w-4 h-4"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.loadingMore && (
              <div className="flex items-center justify-center py-3 border-t border-border-light">
                <div className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                <span className="ml-2 text-xs text-text-tertiary">Loading more...</span>
              </div>
            )}
            {!list.hasMore && list.items.length > PAYMENTS_PAGE_SIZE && (
              <div className="py-2 text-center text-xs text-text-tertiary border-t border-border-light">
                All {list.total.toLocaleString()} records loaded
              </div>
            )}
          </div>
        </div>
      )}

      {/* Record Payment SlideOver (create) */}
      <RecordPaymentPanel
        open={showPanel}
        onClose={() => setShowPanel(false)}
      />

      {/* Edit Payment SlideOver */}
      <RecordPaymentPanel
        open={editPaymentId !== null}
        onClose={() => setEditPaymentId(null)}
        editPaymentId={editPaymentId ?? undefined}
      />

      {/* Payment Detail */}
      {selectedPaymentId && (
        <PaymentDetailPanel
          paymentId={selectedPaymentId}
          onClose={() => setSelectedPaymentId(null)}
          onEdit={(id) => {
            setSelectedPaymentId(null);
            setEditPaymentId(id);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete payment?"
        description="This action cannot be undone. The payment record will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate({ id: deleteId });
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

// ── Payment Detail Panel ──────────────────────────────────────────

function PaymentDetailPanel({
  paymentId,
  onClose,
  onEdit,
}: {
  paymentId: string;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { data: payment, isLoading } = trpc.payment.getById.useQuery(
    { id: paymentId },
  );

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={isLoading ? "Loading…" : payment ? `Payment ${payment.paymentNumber || ""}` : "Payment"}
      description={payment ? `${payment.partyName} — ${formatDate(payment.paymentDate)}` : undefined}
      footer={
        payment ? (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onEdit(payment.id)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
            >
              Edit Payment
            </button>
          </div>
        ) : null
      }
    >
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-8 rounded-lg" />
          ))}
        </div>
      ) : !payment ? (
        <p className="text-text-tertiary text-sm">Payment not found.</p>
      ) : (
        <div className="space-y-5">
          {/* Payment details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Party</p>
                <p className="text-sm font-semibold text-text-primary">{payment.partyName}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Amount</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600">{formatCurrency(payment.amount)}</p>
              </div>
              {payment.discount && parseFloat(payment.discount) > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Discount</p>
                  <p className="text-sm tabular-nums text-text-primary">{formatCurrency(payment.discount)}</p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Date</p>
                <p className="text-sm text-text-primary">{formatDate(payment.paymentDate)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Mode</p>
                <p className="text-sm text-text-primary capitalize">{payment.mode}</p>
              </div>
              {payment.referenceNumber && (
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Reference</p>
                  <p className="text-sm font-mono text-text-secondary">{payment.referenceNumber}</p>
                </div>
              )}
            </div>
          </div>

          {payment.notes && (
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Notes</p>
              <p className="text-xs text-text-secondary whitespace-pre-wrap">{payment.notes}</p>
            </div>
          )}

          {/* Linked invoices */}
          {payment.linkedInvoices.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Applied to Invoice{payment.linkedInvoices.length > 1 ? "s" : ""}
              </p>
              <div className="card overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-1 border-b border-border-light">
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Invoice</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Status</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Invoice Total</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">This Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {payment.linkedInvoices.map((inv) => (
                      <tr
                        key={inv.invoiceId}
                        className="cursor-pointer hover:bg-surface-1 transition-colors"
                        onClick={() => {
                          onClose();
                          navigate({ to: "/invoices", search: { selected: inv.invoiceId } });
                        }}
                      >
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-[12px] font-medium text-brand-600 hover:underline">
                            {inv.invoiceNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-text-secondary">
                          {formatDate(inv.invoiceDate)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={inv.status} size="sm" />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-text-primary">
                          {formatCurrency(inv.totalAmount)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">
                          {formatCurrency(inv.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {payment.linkedInvoices.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-text-tertiary">This payment is not linked to any invoice</p>
            </div>
          )}
        </div>
      )}
    </SlideOver>
  );
}
