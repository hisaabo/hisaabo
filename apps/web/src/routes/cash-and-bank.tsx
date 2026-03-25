import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Listbox } from "@/components/ui/Listbox";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/useToast";
import { getDatePreset } from "@/hooks/useDateRange";

export const Route = createFileRoute("/cash-and-bank")({
  component: CashAndBankPage,
});

function CashAndBankPage() {
  const navigate = useNavigate();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedUntracked, setSelectedUntracked] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false); // true = all across ALL pages
  const [assignAccountId, setAssignAccountId] = useState<string | null>(null);
  const [untrackedSearch, setUntrackedSearch] = useState("");
  const [untrackedMode, setUntrackedMode] = useState("");
  const [untrackedPage, setUntrackedPage] = useState(1);
  const debouncedUntrackedSearch = useDebounce(untrackedSearch, 300);

  // Reset page and selection when filters change
  useEffect(() => {
    setUntrackedPage(1);
    setSelectedUntracked(new Set());
    setSelectAllMatching(false);
  }, [debouncedUntrackedSearch, untrackedMode]);
  const [datePreset, setDatePreset] = useState<string | null>(null); // null = no preset selected yet
  const [dateRange, setDateRange] = useState<{ fromDate: string; toDate: string }>({ fromDate: "", toDate: "" });
  const [exporting, setExporting] = useState(false);

  // Combine list + summary into parallel fetch (both are lightweight single-query endpoints)
  const { data: accounts, isLoading } = trpc.bankAccount.list.useQuery();
  const { data: summary } = trpc.bankAccount.summary.useQuery(undefined, {
    staleTime: 60_000, // cache for 1 min — summary changes slowly
  });
  // Infinite scroll for transactions
  const TXN_PAGE_SIZE = 50;
  const [txnPage, setTxnPage] = useState(1);
  const [allTxns, setAllTxns] = useState<any[]>([]);
  const [txnTotal, setTxnTotal] = useState(0);
  const txnScrollRef = useRef<HTMLDivElement>(null);

  const { data: transactions, isFetching: txnFetching } = trpc.bankAccount.listTransactions.useQuery(
    {
      bankAccountId: selectedAccountId!,
      page: txnPage,
      limit: TXN_PAGE_SIZE,
      fromDate: dateRange.fromDate || undefined,
      toDate: dateRange.toDate || undefined,
    },
    { enabled: !!selectedAccountId && datePreset !== null }
  );

  // Reset accumulated transactions when account or date range changes
  useEffect(() => {
    setAllTxns([]);
    setTxnPage(1);
    setTxnTotal(0);
  }, [selectedAccountId, dateRange.fromDate, dateRange.toDate]);

  // Accumulate pages as they load
  useEffect(() => {
    if (transactions?.data) {
      setAllTxns(prev => {
        if (txnPage === 1) return transactions.data;
        // Append new page, dedup by id
        const existingIds = new Set(prev.map((t: any) => t.id));
        const newItems = transactions.data.filter((t: any) => !existingIds.has(t.id));
        return [...prev, ...newItems];
      });
      setTxnTotal(transactions.total);
    }
  }, [transactions, txnPage]);

  const hasMoreTxns = allTxns.length < txnTotal;

  // Scroll handler for infinite scroll
  const handleTxnScroll = useCallback(() => {
    const el = txnScrollRef.current;
    if (!el || txnFetching || !hasMoreTxns) return;
    // Load more when scrolled within 100px of bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      setTxnPage(p => p + 1);
    }
  }, [txnFetching, hasMoreTxns]);
  const UNTRACKED_PAGE_SIZE = 25;
  // Lazy-load untracked payments — delay initial fetch to prioritize account list rendering
  const [untrackedEnabled, setUntrackedEnabled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setUntrackedEnabled(true), 500);
    return () => clearTimeout(timer);
  }, []);
  const { data: untrackedData, isFetching: untrackedFetching } = trpc.payment.untrackedPayments.useQuery({
    page: untrackedPage,
    limit: UNTRACKED_PAGE_SIZE,
    search: debouncedUntrackedSearch || undefined,
    mode: (untrackedMode || undefined) as any,
  }, { enabled: untrackedEnabled });
  // Track if we've ever seen untracked payments — prevents section from vanishing on refetch
  // Only hide when there are truly 0 untracked (no filters applied, query finished, total is 0)
  const [hadUntracked, setHadUntracked] = useState(false);
  useEffect(() => {
    if (untrackedData && untrackedData.total > 0) setHadUntracked(true);
    // Only hide if no filters are active AND query returned 0
    const hasFilters = !!debouncedUntrackedSearch || !!untrackedMode;
    if (untrackedData && untrackedData.total === 0 && !untrackedFetching && !hasFilters) {
      setHadUntracked(false);
    }
  }, [untrackedData, untrackedFetching, debouncedUntrackedSearch, untrackedMode]);

  // Auto-pick best matching account when untracked selection changes
  useEffect(() => {
    if (selectedUntracked.size === 0 || !accounts?.length) return;

    // Count payment modes among selected items
    const modeCounts = new Map<string, number>();
    for (const id of selectedUntracked) {
      const pmt = untrackedData?.data?.find((p) => p.id === id);
      if (pmt?.mode) modeCounts.set(pmt.mode, (modeCounts.get(pmt.mode) || 0) + 1);
    }

    // Find dominant mode
    let dominantMode = "";
    let maxCount = 0;
    for (const [mode, count] of modeCounts) {
      if (count > maxCount) { dominantMode = mode; maxCount = count; }
    }

    // Match dominant mode to best account
    let bestAccount = accounts.find((a) => a.isDefault);
    if (dominantMode === "cash") {
      bestAccount = accounts.find((a) => a.accountType === "cash") || bestAccount;
    } else if (dominantMode === "upi") {
      bestAccount = accounts.find((a) => a.accountType === "upi") || bestAccount;
    } else if (dominantMode === "bank") {
      bestAccount = accounts.find((a) => a.accountType === "savings" || a.accountType === "current") || bestAccount;
    }

    if (bestAccount) setAssignAccountId(bestAccount.id);
  }, [selectedUntracked.size]); // re-run when selection size changes

  const utils = trpc.useUtils();

  async function exportTransactionsCSV() {
    if (!selectedAccountId || datePreset === null) return;
    const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);
    setExporting(true);
    try {
      let allData: any[] = [];
      let page = 1;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.bankAccount.listTransactions.fetch({
          bankAccountId: selectedAccountId,
          page,
          limit,
          fromDate: dateRange.fromDate || undefined,
          toDate: dateRange.toDate || undefined,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        page++;
      }

      const headers = ["Date", "Description", "Type", "Amount", "Balance After"];
      const rows = allData.map((txn: any) => [
        formatDate(txn.transactionDate),
        (txn.description || "").replace(/"/g, '""'),
        txn.type,
        txn.type === "deposit" ? txn.amount : `-${txn.amount}`,
        txn.balanceAfter,
      ]);

      const csv = [
        `Account,${selectedAccount?.accountName || ""}`,
        `Period,${datePreset}`,
        `Exported,${new Date().toLocaleDateString("en-IN")}`,
        `Transactions,${allData.length}`,
        "",
        headers.join(","),
        ...rows.map((r) => r.map((cell: any) => `"${String(cell)}"`).join(",")),
      ].join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedAccount?.accountName || "transactions"}_${datePreset || "all"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const deleteAccountMutation = trpc.bankAccount.delete.useMutation({
    onSuccess: () => {
      toast.success("Account deleted");
      setDeleteConfirm(null);
      if (selectedAccountId === deleteConfirm) setSelectedAccountId(null);
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const assignMutation = trpc.payment.assignAccount.useMutation({
    onSuccess: (result) => {
      utils.payment.untrackedPayments.invalidate();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
      setSelectedUntracked(new Set());
      setSelectAllMatching(false);
      toast.success(`${result.assigned} payment(s) assigned`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Cash & Bank"
        description="Manage your bank accounts and track transactions"
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setShowTransfer(true)}>
              Transfer
            </button>
            <button className="btn-primary" onClick={() => setShowAddAccount(true)}>
              + Add Account
            </button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Total Balance</p>
          <p className="text-xl font-bold tabular-nums text-text-primary">
            {formatCurrency(summary?.totalBalance || "0")}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Cash in Hand</p>
          <p className="text-xl font-bold tabular-nums text-emerald-600">
            {formatCurrency(summary?.cashInHand || "0")}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Bank Balance</p>
          <p className="text-xl font-bold tabular-nums text-text-primary">
            {formatCurrency(summary?.bankBalance || "0")}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Account list */}
        <div className="col-span-4">
          <div className="card overflow-hidden">
            <div
              className="px-4 py-3 flex items-center justify-between border-b border-border-light"
            >
              <h3 className="text-sm font-semibold text-text-primary">Accounts</h3>
              <button
                className="btn-ghost text-xs"
                onClick={() => setShowAddAccount(true)}
              >
                + Add
              </button>
            </div>

            {isLoading ? (
              <AccountListSkeleton />
            ) : !accounts?.length ? (
              <EmptyState
                title="No accounts"
                description="Add a bank account to track transactions"
              />
            ) : (
              <div className="divide-y divide-border-light">
                {accounts.map((account) => (
                  <div key={account.id} className="relative group">
                    <button
                      className={cn(
                        "w-full px-4 py-3 text-left transition-colors",
                        selectedAccountId === account.id
                          ? "bg-brand-600/[0.08] border-l-2 border-brand-600"
                          : "hover:bg-surface-1"
                      )}
                      onClick={() => setSelectedAccountId(account.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {account.accountName}
                          </p>
                          <p className="text-xs text-text-tertiary mt-0.5">
                            {account.bankName || account.accountType}
                            {account.isDefault && (
                              <span className="ml-1 text-brand-600">• Default</span>
                            )}
                          </p>
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-text-primary flex-shrink-0">
                          {formatCurrency(account.currentBalance)}
                        </p>
                      </div>
                    </button>
                    {/* Only show delete if no transactions (balance is 0 and it's not the selected account with transactions) */}
                    {parseFloat(account.currentBalance) === 0 && account.id !== selectedAccountId && (
                      <button
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(account.id);
                        }}
                        aria-label="Delete account"
                      >
                        <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Transactions */}
        <div className="col-span-8">
          {selectedAccountId ? (
            <div className="card overflow-hidden">
              <div
                className="px-4 py-3 flex items-center justify-between border-b border-border-light"
              >
                <h3 className="text-sm font-semibold text-text-primary">Transactions</h3>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setShowTransfer(true)}
                  >
                    Transfer
                  </button>
                  <button
                    className="btn-primary text-xs py-1.5 px-3"
                    onClick={() => setShowAddTransaction(true)}
                  >
                    + Add Transaction
                  </button>
                </div>
              </div>

              {/* Date range filter bar */}
              <div
                className="px-4 py-2 flex items-center gap-1 flex-wrap border-b border-border-light"
              >
                <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                {[
                  { value: "this-month", label: "This Month" },
                  { value: "last-month", label: "Last Month" },
                  { value: "last-30", label: "Last 30 Days" },
                  { value: "this-fy", label: "This FY" },
                  { value: "last-fy", label: "Last FY" },
                  { value: "custom", label: "Custom" },
                  { value: "all", label: "All" },
                ].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setDatePreset(p.value);
                      if (p.value !== "custom") {
                        setDateRange(getDatePreset(p.value));
                      }
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      datePreset === p.value
                        ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
                        : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
                    )}
                  >
                    {p.label}
                  </button>
                ))}

                {datePreset === "custom" && (
                  <div className="flex items-center gap-2 ml-2">
                    <input
                      type="date"
                      value={dateRange.fromDate ? dateRange.fromDate.split("T")[0] : ""}
                      onChange={(e) =>
                        setDateRange((prev) => ({
                          ...prev,
                          fromDate: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : "",
                        }))
                      }
                      className="input py-1 text-xs w-32"
                    />
                    <span className="text-text-tertiary text-xs">to</span>
                    <input
                      type="date"
                      value={dateRange.toDate ? dateRange.toDate.split("T")[0] : ""}
                      onChange={(e) =>
                        setDateRange((prev) => ({
                          ...prev,
                          toDate: e.target.value
                            ? new Date(e.target.value + "T23:59:59").toISOString()
                            : "",
                        }))
                      }
                      className="input py-1 text-xs w-32"
                    />
                  </div>
                )}
                </div>
                {allTxns.length > 0 && (
                  <button
                    onClick={exportTransactionsCSV}
                    disabled={exporting}
                    className="btn-secondary text-xs px-3 py-1.5 ml-auto shrink-0 flex items-center gap-1.5"
                  >
                    {exporting ? (
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                      </svg>
                    )}
                    {exporting ? "Preparing..." : "Export CSV"}
                  </button>
                )}
              </div>

              {datePreset === null ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-text-tertiary">Select a time period above to load transactions</p>
                </div>
              ) : allTxns.length === 0 && !txnFetching ? (
                <EmptyState
                  title="No transactions"
                  description="No transactions in this period"
                />
              ) : allTxns.length === 0 && txnFetching ? (
                <TransactionTableSkeleton />
              ) : (
                <div
                  ref={txnScrollRef}
                  onScroll={handleTxnScroll}
                  className="max-h-[480px] overflow-y-auto"
                >
                  <table className="data-table">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTxns.map((txn: any) => (
                        <tr
                          key={txn.id}
                          className={txn.referenceType === "payment" ? "cursor-pointer hover:bg-surface-1" : ""}
                          onClick={() => {
                            if (txn.referenceType === "payment" && txn.referenceId) {
                              navigate({ to: "/payments", search: { q: txn.description?.match(/Payment (\S+)/)?.[1] || "" } as any });
                            }
                          }}
                        >
                          <td className="text-text-secondary">
                            {formatDate(txn.transactionDate)}
                          </td>
                          <td className={txn.referenceType === "payment" ? "text-brand-600 dark:text-brand-400 hover:underline" : "text-text-primary"}>
                            {txn.description || "—"}
                          </td>
                          <td>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
                                txn.type === "deposit"
                                  ? "bg-emerald-600/[0.08] text-emerald-600 dark:text-emerald-400"
                                  : txn.type === "withdrawal"
                                    ? "bg-red-600/[0.08] text-red-600 dark:text-red-400"
                                    : "bg-blue-600/[0.08] text-blue-600 dark:text-blue-400"
                              )}
                            >
                              {txn.type}
                            </span>
                          </td>
                          <td
                            className={`text-right tabular-nums font-medium ${txn.type === "deposit"
                              ? "text-emerald-600"
                              : "text-red-600"
                              }`}
                          >
                            {txn.type === "deposit" ? "+" : "-"}
                            {formatCurrency(txn.amount)}
                          </td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {formatCurrency(txn.balanceAfter)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Infinite scroll loading indicator */}
                  {txnFetching && allTxns.length > 0 && (
                    <div className="flex items-center justify-center py-3 border-t border-border-light">
                      <div className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                      <span className="ml-2 text-xs text-text-tertiary">Loading more...</span>
                    </div>
                  )}
                  {!hasMoreTxns && allTxns.length > TXN_PAGE_SIZE && (
                    <div className="py-2 text-center text-xs text-text-tertiary border-t border-border-light">
                      All {txnTotal.toLocaleString()} transactions loaded
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <EmptyState
                title="Select an account"
                description="Choose a bank account from the left to view its transactions"
              />
            </div>
          )}
        </div>
      </div>

      {/* Untracked Payments — stays visible during refetch after assignment */}
      {(hadUntracked || (untrackedData && untrackedData.total > 0)) && (
        <div className="mt-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Untracked Payments
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-600/[0.08] text-amber-700 dark:text-amber-400 text-[11px] font-bold">
                  {untrackedData?.total ?? 0}
                </span>
              </h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                Payments not assigned to any account — filter, select, and assign in bulk
              </p>
            </div>
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <SearchInput
              value={untrackedSearch}
              onChange={setUntrackedSearch}
              placeholder="Search party or payment #..."
              className="max-w-xs"
            />
            <PillTabs
              tabs={[
                { value: "cash", label: "Cash" },
                { value: "upi", label: "UPI" },
                { value: "bank", label: "Bank" },
                { value: "cheque", label: "Cheque" },
                { value: "other", label: "Other" },
                { value: "", label: "All" },
              ]}
              value={untrackedMode}
              onChange={setUntrackedMode}
            />
          </div>

          {/* Bulk assign toolbar — appears when items are selected */}
          {(selectedUntracked.size > 0 || selectAllMatching) && accounts && accounts.length > 0 && (
            <div className="mb-3 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-600/[0.05]">
              {/* Selection info + "select all matching" upgrade */}
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="text-xs">
                  {selectAllMatching ? (
                    <span className="font-medium text-brand-700 dark:text-brand-400">
                      All {untrackedData?.total.toLocaleString()} matching payments selected
                    </span>
                  ) : (
                    <span className="font-medium text-brand-700 dark:text-brand-400">
                      {selectedUntracked.size} payment{selectedUntracked.size !== 1 ? "s" : ""} on this page selected
                    </span>
                  )}
                  {/* Offer to select all matching if current page is fully selected but there are more */}
                  {!selectAllMatching &&
                    untrackedData &&
                    untrackedData.data.length > 0 &&
                    untrackedData.data.every((p) => selectedUntracked.has(p.id)) &&
                    untrackedData.total > untrackedData.data.length && (
                      <button
                        className="ml-2 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                        onClick={() => setSelectAllMatching(true)}
                      >
                        Select all {untrackedData.total.toLocaleString()} matching
                      </button>
                    )}
                </div>
                <button
                  className="btn-ghost text-xs px-2 py-1"
                  onClick={() => { setSelectedUntracked(new Set()); setSelectAllMatching(false); }}
                >
                  Clear
                </button>
              </div>
              {/* Assign controls */}
              <div className="px-4 py-2.5 flex items-center gap-2 border-t border-brand-200/50 dark:border-brand-800/50">
                <span className="text-xs text-text-secondary shrink-0">Assign to:</span>
                <Listbox
                  value={assignAccountId || ""}
                  onChange={setAssignAccountId}
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.accountName} (${a.accountType})`,
                  }))}
                  placeholder="Select account"
                  className="w-48"
                />
                <button
                  className="btn-primary text-xs px-3 py-1.5"
                  disabled={!assignAccountId || assignMutation.isPending}
                  onClick={() => {
                    if (!assignAccountId) return;
                    if (selectAllMatching) {
                      // Assign ALL matching via server-side filter
                      assignMutation.mutate({
                        allMatching: true,
                        search: debouncedUntrackedSearch || undefined,
                        mode: (untrackedMode || undefined) as any,
                        bankAccountId: assignAccountId,
                      });
                    } else {
                      // Assign selected IDs
                      assignMutation.mutate({
                        paymentIds: Array.from(selectedUntracked),
                        bankAccountId: assignAccountId,
                      });
                    }
                  }}
                >
                  {assignMutation.isPending
                    ? "Assigning..."
                    : selectAllMatching
                      ? `Assign all ${untrackedData?.total.toLocaleString()}`
                      : `Assign ${selectedUntracked.size}`}
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          {untrackedFetching && !untrackedData && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-10 rounded-lg" />
              ))}
            </div>
          )}
          {untrackedData && untrackedData.data.length === 0 && (
            <div className="card px-4 py-8 text-center">
              <p className="text-sm text-text-tertiary">
                {untrackedMode || debouncedUntrackedSearch
                  ? "No untracked payments match this filter"
                  : "All payments are assigned to accounts"}
              </p>
            </div>
          )}
          {untrackedData && untrackedData.data.length > 0 && (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={
                          untrackedData.data.length > 0 &&
                          untrackedData.data.every((p) => selectedUntracked.has(p.id))
                        }
                        onChange={(e) => {
                          const next = new Set(selectedUntracked);
                          if (e.target.checked) {
                            untrackedData.data.forEach((p) => next.add(p.id));
                          } else {
                            untrackedData.data.forEach((p) => next.delete(p.id));
                          }
                          setSelectedUntracked(next);
                        }}
                        className="w-4 h-4 rounded"
                      />
                    </th>
                    <th>Payment #</th>
                    <th>Party</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {untrackedData.data.map((pmt) => (
                    <tr
                      key={pmt.id}
                      className="group cursor-pointer"
                      onClick={() => navigate({ to: "/payments", search: { q: pmt.paymentNumber || pmt.partyName } as any })}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedUntracked.has(pmt.id)}
                          onChange={(e) => {
                            const next = new Set(selectedUntracked);
                            if (e.target.checked) next.add(pmt.id);
                            else next.delete(pmt.id);
                            setSelectedUntracked(next);
                          }}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="font-mono text-[13px] text-brand-600 dark:text-brand-400 hover:underline">
                        {pmt.paymentNumber || "—"}
                      </td>
                      <td className="font-medium">{pmt.partyName}</td>
                      <td className="text-text-secondary">{formatDate(pmt.paymentDate)}</td>
                      <td>
                        <span className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                          pmt.mode === "upi" ? "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400" :
                            pmt.mode === "cash" ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400" :
                              pmt.mode === "bank" ? "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400" :
                                "bg-surface-2 text-text-secondary"
                        )}>
                          {pmt.mode.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-right tabular-nums font-semibold text-emerald-600">
                        {formatCurrency(pmt.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={untrackedPage}
                totalPages={Math.ceil(untrackedData.total / UNTRACKED_PAGE_SIZE)}
                onPageChange={setUntrackedPage}
                total={untrackedData.total}
                pageSize={UNTRACKED_PAGE_SIZE}
              />
            </div>
          )}
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <AddAccountModal
          onClose={() => setShowAddAccount(false)}
        />
      )}

      {/* Add Transaction Modal */}
      {showAddTransaction && selectedAccountId && (
        <AddTransactionModal
          bankAccountId={selectedAccountId}
          onClose={() => setShowAddTransaction(false)}
        />
      )}

      {/* Transfer Modal */}
      {showTransfer && (
        <TransferModal
          accounts={accounts ?? []}
          defaultFromId={selectedAccountId}
          onClose={() => setShowTransfer(false)}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="Delete Account"
        description="This will permanently delete this bank account and all its transactions."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteAccountMutation.isPending}
        onConfirm={() =>
          deleteConfirm && deleteAccountMutation.mutate({ id: deleteConfirm })
        }
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ─── Add Account Modal ────────────────────────────────────────────────────────

const ACCOUNT_TYPE_OPTIONS = [
  { value: "savings", label: "Savings Account" },
  { value: "current", label: "Current Account" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "credit_card", label: "Credit Card" },
];

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("current");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const utils = trpc.useUtils();

  const createAccountMutation = trpc.bankAccount.create.useMutation({
    onSuccess: () => {
      toast.success("Account created");
      onClose();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate() {
    if (!accountName.trim()) return;
    createAccountMutation.mutate({
      accountName: accountName.trim(),
      accountType: accountType as "savings" | "current" | "cash" | "upi" | "credit_card",
      accountNumber: accountNumber || undefined,
      ifsc: ifsc || undefined,
      bankName: bankName || undefined,
      openingBalance: openingBalance || "0",
      isDefault,
    });
  }

  const showAccountNumber = accountType === "savings" || accountType === "current" || accountType === "credit_card";
  const showUpiId = accountType === "upi";
  const showIfsc = accountType === "savings" || accountType === "current";
  const showBankName = accountType === "savings" || accountType === "current" || accountType === "credit_card";

  const accountNamePlaceholder =
    accountType === "cash" ? "e.g. Cash in Hand" :
    accountType === "upi" ? "e.g. PhonePe" :
    accountType === "credit_card" ? "e.g. HDFC Credit Card" :
    "e.g. HDFC Current";

  const accountNumberLabel = accountType === "credit_card" ? "Last 4 Digits" : "Account Number";
  const accountNumberPlaceholder = accountType === "credit_card" ? "1234" : "Optional";

  return (
    <Modal open onClose={onClose} title="Add Bank Account">
      <div className="space-y-4">
        <div>
          <p className="label">Account Type</p>
          <Listbox
            value={accountType}
            onChange={(val) => setAccountType(val)}
            options={ACCOUNT_TYPE_OPTIONS}
            className="w-full"
          />
        </div>
        <InputField
          label="Account Name"
          required
          autoFocus
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder={accountNamePlaceholder}
        />
        {showAccountNumber && showIfsc && (
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label={accountNumberLabel}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={accountNumberPlaceholder}
            />
            <InputField
              label="IFSC Code"
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value)}
              placeholder="Optional"
            />
          </div>
        )}
        {showAccountNumber && !showIfsc && (
          <InputField
            label={accountNumberLabel}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder={accountNumberPlaceholder}
          />
        )}
        {showUpiId && (
          <InputField
            label="UPI ID"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="e.g. business@upi"
          />
        )}
        {showBankName && (
          <InputField
            label="Bank Name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. HDFC Bank"
          />
        )}
        <InputField
          label="Opening Balance (₹)"
          type="number"
          step="0.01"
          min="0"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          placeholder="0.00"
        />
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="rounded"
          />
          Set as default account
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={createAccountMutation.isPending || !accountName.trim()}
          >
            {createAccountMutation.isPending ? "Creating..." : "Create Account"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Add Transaction Modal ────────────────────────────────────────────────────

function AddTransactionModal({
  bankAccountId,
  onClose,
}: {
  bankAccountId: string;
  onClose: () => void;
}) {
  const [txnType, setTxnType] = useState("deposit");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnDescription, setTxnDescription] = useState("");
  const [txnDate, setTxnDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const utils = trpc.useUtils();

  const addTxnMutation = trpc.bankAccount.addTransaction.useMutation({
    onSuccess: () => {
      toast.success("Transaction recorded");
      onClose();
      utils.bankAccount.listTransactions.invalidate();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleAdd() {
    if (!txnAmount) return;
    addTxnMutation.mutate({
      bankAccountId,
      type: txnType as "deposit" | "withdrawal",
      amount: txnAmount,
      description: txnDescription || undefined,
      transactionDate: txnDate,
    });
  }

  return (
    <Modal open onClose={onClose} title="Add Transaction">
      <div className="space-y-4">
        <div>
          <p className="label">Transaction Type</p>
          <SegmentedControl
            tabs={[
              { value: "deposit", label: "Deposit" },
              { value: "withdrawal", label: "Withdrawal" },
            ]}
            value={txnType}
            onChange={setTxnType}
          />
        </div>
        <InputField
          label="Amount (₹)"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={txnAmount}
          onChange={(e) => setTxnAmount(e.target.value)}
          placeholder="0.00"
        />
        <InputField
          label="Description"
          value={txnDescription}
          onChange={(e) => setTxnDescription(e.target.value)}
          placeholder="Optional note"
        />
        <InputField
          label="Date"
          type="date"
          value={txnDate}
          onChange={(e) => setTxnDate(e.target.value)}
        />
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleAdd}
            disabled={addTxnMutation.isPending || !txnAmount}
          >
            {addTxnMutation.isPending ? "Adding..." : "Add Transaction"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Transfer Modal ───────────────────────────────────────────────────────────

interface BankAccountItem {
  id: string;
  accountName: string;
  currentBalance: string;
}

function TransferModal({
  accounts,
  defaultFromId,
  onClose,
}: {
  accounts: BankAccountItem[];
  defaultFromId: string | null;
  onClose: () => void;
}) {
  const [transferFrom, setTransferFrom] = useState(defaultFromId ?? "");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDescription, setTransferDescription] = useState("");

  const utils = trpc.useUtils();

  const transferMutation = trpc.bankAccount.transfer.useMutation({
    onSuccess: () => {
      toast.success("Transfer completed");
      onClose();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.listTransactions.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleTransfer() {
    if (!transferFrom || !transferTo || !transferAmount) return;
    transferMutation.mutate({
      fromAccountId: transferFrom,
      toAccountId: transferTo,
      amount: transferAmount,
      description: transferDescription || undefined,
    });
  }

  return (
    <Modal open onClose={onClose} title="Transfer Money">
      <div className="space-y-4">
        <SelectField
          label="From Account"
          required
          value={transferFrom}
          onChange={(e) => setTransferFrom(e.target.value)}
        >
          <option value="">Select account</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.accountName} ({formatCurrency(acc.currentBalance)})
            </option>
          ))}
        </SelectField>
        <SelectField
          label="To Account"
          required
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
        >
          <option value="">Select account</option>
          {accounts
            .filter((a) => a.id !== transferFrom)
            .map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.accountName} ({formatCurrency(acc.currentBalance)})
              </option>
            ))}
        </SelectField>
        <InputField
          label="Amount (₹)"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
          placeholder="0.00"
        />
        <InputField
          label="Description"
          value={transferDescription}
          onChange={(e) => setTransferDescription(e.target.value)}
          placeholder="e.g. Fund transfer"
        />
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleTransfer}
            disabled={
              transferMutation.isPending ||
              !transferFrom ||
              !transferTo ||
              !transferAmount
            }
          >
            {transferMutation.isPending ? "Transferring..." : "Transfer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function AccountListSkeleton() {
  return (
    <div className="p-4 space-y-3 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="space-y-1.5 flex-1">
            <div className="skeleton h-3.5 w-32 rounded" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
          <div className="skeleton h-4 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

function TransactionTableSkeleton() {
  return (
    <div className="p-4 space-y-3 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="skeleton h-3.5 w-20 rounded" />
          <div className="skeleton h-3.5 flex-1 rounded" />
          <div className="skeleton h-5 w-16 rounded-full" />
          <div className="skeleton h-3.5 w-20 rounded ml-auto" />
          <div className="skeleton h-3.5 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}
