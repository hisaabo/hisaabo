import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";
import { SegmentedControl } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";

export const Route = createFileRoute("/cash-and-bank")({
  component: CashAndBankPage,
});

function getDatePreset(preset: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  switch (preset) {
    case "this-month": {
      const from = new Date(yyyy, mm, 1);
      const to = new Date(yyyy, mm + 1, 0);
      return { fromDate: from.toISOString(), toDate: to.toISOString() };
    }
    case "last-month": {
      const from = new Date(yyyy, mm - 1, 1);
      const to = new Date(yyyy, mm, 0);
      return { fromDate: from.toISOString(), toDate: to.toISOString() };
    }
    case "last-30": {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { fromDate: from.toISOString(), toDate: now.toISOString() };
    }
    case "this-fy": {
      // Indian FY: April 1 to March 31
      const fyStart = mm >= 3 ? new Date(yyyy, 3, 1) : new Date(yyyy - 1, 3, 1);
      return { fromDate: fyStart.toISOString(), toDate: now.toISOString() };
    }
    default:
      return { fromDate: "", toDate: "" };
  }
}

function CashAndBankPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedUntracked, setSelectedUntracked] = useState<Set<string>>(new Set());
  const [assignAccountId, setAssignAccountId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ fromDate: string; toDate: string }>({
    fromDate: "",
    toDate: "",
  });
  const [datePreset, setDatePreset] = useState("all");

  const { data: accounts, isLoading } = trpc.bankAccount.list.useQuery();
  const { data: summary } = trpc.bankAccount.summary.useQuery();
  const { data: transactions } = trpc.bankAccount.listTransactions.useQuery(
    {
      bankAccountId: selectedAccountId!,
      page: 1,
      limit: 50,
      fromDate: dateRange.fromDate || undefined,
      toDate: dateRange.toDate || undefined,
    },
    { enabled: !!selectedAccountId }
  );
  const { data: untrackedData } = trpc.payment.untrackedPayments.useQuery({ page: 1, limit: 50 });

  const utils = trpc.useUtils();

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
              className="px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--border-light)" }}
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
              <div className="divide-y" style={{ borderColor: "var(--border-light)" }}>
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
                    <button
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(account.id);
                      }}
                    >
                      Delete
                    </button>
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
                className="px-4 py-3 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--border-light)" }}
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
                className="px-4 py-2 flex items-center gap-1 flex-wrap"
                style={{ borderBottom: "1px solid var(--border-light)" }}
              >
                {[
                  { value: "all", label: "All" },
                  { value: "this-month", label: "This Month" },
                  { value: "last-month", label: "Last Month" },
                  { value: "last-30", label: "Last 30 Days" },
                  { value: "this-fy", label: "This FY" },
                  { value: "custom", label: "Custom" },
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

              {!transactions ? (
                <TransactionTableSkeleton />
              ) : transactions.data?.length === 0 ? (
                <EmptyState
                  title="No transactions"
                  description="Record your first transaction"
                />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.data?.map((txn) => (
                      <tr key={txn.id}>
                        <td className="text-text-secondary">
                          {formatDate(txn.transactionDate)}
                        </td>
                        <td className="text-text-primary">{txn.description || "—"}</td>
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
                          className={`text-right tabular-nums font-medium ${
                            txn.type === "deposit"
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

      {/* Untracked Payments */}
      {untrackedData && untrackedData.total > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Untracked Payments
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 text-[11px] font-bold">
                  {untrackedData.total}
                </span>
              </h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                Payments not assigned to any account
              </p>
            </div>
            {selectedUntracked.size > 0 && accounts && accounts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary">
                  {selectedUntracked.size} selected — assign to:
                </span>
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
                    if (assignAccountId) {
                      assignMutation.mutate({
                        paymentIds: Array.from(selectedUntracked),
                        bankAccountId: assignAccountId,
                      });
                    }
                  }}
                >
                  {assignMutation.isPending ? "Assigning..." : "Assign"}
                </button>
              </div>
            )}
          </div>
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={
                        untrackedData.data.length > 0 &&
                        selectedUntracked.size === untrackedData.data.length
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUntracked(new Set(untrackedData.data.map((p) => p.id)));
                        } else {
                          setSelectedUntracked(new Set());
                        }
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
                  <tr key={pmt.id} className="group">
                    <td>
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
                    <td className="font-mono text-[13px] text-text-secondary">
                      {pmt.paymentNumber || "—"}
                    </td>
                    <td className="font-medium">{pmt.partyName}</td>
                    <td className="text-text-secondary">{formatDate(pmt.paymentDate)}</td>
                    <td className="text-text-secondary capitalize">{pmt.mode}</td>
                    <td className="text-right tabular-nums font-semibold text-emerald-600">
                      {formatCurrency(pmt.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("savings");
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
      ifscCode: ifsc || undefined,
      bankName: bankName || undefined,
      openingBalance: openingBalance || "0",
      isDefault,
    });
  }

  return (
    <Modal open onClose={onClose} title="Add Bank Account">
      <div className="space-y-4">
        <InputField
          label="Account Name"
          required
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="e.g. HDFC Savings"
        />
        <SelectField
          label="Account Type"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
        >
          <option value="savings">Savings</option>
          <option value="current">Current</option>
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="credit_card">Credit Card</option>
        </SelectField>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Account Number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Optional"
          />
          <InputField
            label="IFSC Code"
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <InputField
          label="Bank Name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          placeholder="e.g. HDFC Bank"
        />
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
