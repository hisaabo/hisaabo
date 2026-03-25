import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { SlideOver } from "@/components/ui/SlideOver";
import { Combobox } from "@/components/ui/Combobox";
import { Disclosure } from "@/components/ui/Disclosure";
import { InputField, TextareaField } from "@/components/ui/FormField";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecordPaymentPanelProps {
  open: boolean;
  onClose: () => void;
  // Optional pre-fill (create mode)
  preSelectedPartyId?: string;
  preSelectedInvoiceId?: string;
  preSelectedAmount?: string;
  // Edit mode: pass an existing payment ID
  editPaymentId?: string;
}

// ── Account type icons ────────────────────────────────────────────────────────

function accountTypeIcon(type: string): string {
  switch (type) {
    case "cash":        return "💵";
    case "current":     return "🏦";
    case "savings":     return "🏦";
    case "upi":         return "📱";
    case "credit_card": return "💳";
    default:            return "💳";
  }
}

function accountTypeLabel(type: string): string {
  switch (type) {
    case "savings":     return "Savings";
    case "current":     return "Current";
    case "cash":        return "Cash";
    case "upi":         return "UPI";
    case "credit_card": return "Credit Card";
    default:            return type;
  }
}

// Map account type to payment mode
function accountTypeToMode(type: string): "cash" | "bank" | "upi" | "cheque" | "other" {
  if (type === "cash") return "cash";
  if (type === "upi") return "upi";
  return "bank";
}


// ── Main Component ────────────────────────────────────────────────────────────

export function RecordPaymentPanel({
  open,
  onClose,
  preSelectedPartyId,
  preSelectedInvoiceId,
  preSelectedAmount,
  editPaymentId,
}: RecordPaymentPanelProps) {
  const isEditMode = !!editPaymentId;
  const [partyId, setPartyId] = useState(preSelectedPartyId ?? "");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [checkedInvoices, setCheckedInvoices] = useState<Set<string>>(new Set());
  const [manualAmount, setManualAmount] = useState("");
  const [amountOverridden, setAmountOverridden] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();

  // ── Data fetching ───────────────────────────────────────────────────────────

  const { data: partiesData } = trpc.party.list.useQuery(
    { page: 1, limit: 100 },
    { enabled: open }
  );

  const { data: bankAccountsData } = trpc.bankAccount.list.useQuery(
    undefined,
    { enabled: open }
  );

  const { data: defaultAccountData } = trpc.payment.defaultAccount.useQuery(
    undefined,
    { enabled: open && !isEditMode }
  );

  const { data: unpaidInvoices, isLoading: loadingInvoices } =
    trpc.payment.unpaidInvoices.useQuery(
      { partyId },
      { enabled: open && !!partyId }
    );

  // Fetch existing payment when editing
  const { data: editData } = trpc.payment.getById.useQuery(
    { id: editPaymentId! },
    { enabled: open && isEditMode }
  );

  // ── Pre-fill logic ──────────────────────────────────────────────────────────

  // When panel opens, reset state (or populate from editData)
  useEffect(() => {
    if (!open) return;

    if (isEditMode && editData) {
      setPartyId(editData.partyId);
      setManualAmount(editData.amount);
      setAmountOverridden(true);
      setSelectedAccountId(editData.bankAccountId ?? null);
      setReferenceNumber(editData.referenceNumber ?? "");
      setPaymentDate(
        editData.paymentDate
          ? new Date(editData.paymentDate).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0]
      );
      setNotes(editData.notes ?? "");
      // Pre-check the linked invoices
      if (editData.linkedInvoices.length > 0) {
        const checked = new Set(editData.linkedInvoices.map((li) => li.invoiceId));
        const allocs: Record<string, string> = {};
        for (const li of editData.linkedInvoices) {
          allocs[li.invoiceId] = li.amount;
        }
        setCheckedInvoices(checked);
        setAllocations(allocs);
      } else {
        setCheckedInvoices(new Set());
        setAllocations({});
      }
    } else if (!isEditMode) {
      setPartyId(preSelectedPartyId ?? "");
      setAllocations({});
      setCheckedInvoices(new Set());
      setManualAmount("");
      setAmountOverridden(false);
      setReferenceNumber("");
      setPaymentDate(new Date().toISOString().split("T")[0]);
      setNotes("");
    }
  }, [open, isEditMode, editData, preSelectedPartyId]);

  // Pre-select invoice once unpaid invoices load (when coming from "Record Payment" on an invoice)
  useEffect(() => {
    if (
      preSelectedInvoiceId &&
      unpaidInvoices &&
      !checkedInvoices.has(preSelectedInvoiceId)
    ) {
      const target = unpaidInvoices.find((inv) => inv.id === preSelectedInvoiceId);
      if (target) {
        const balanceAmt = preSelectedAmount ?? target.balance;
        setCheckedInvoices(new Set([preSelectedInvoiceId]));
        setAllocations({ [preSelectedInvoiceId]: balanceAmt });
      }
    }
  }, [preSelectedInvoiceId, unpaidInvoices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set default account once loaded
  useEffect(() => {
    if (defaultAccountData && !selectedAccountId) {
      setSelectedAccountId(defaultAccountData.id);
    } else if (bankAccountsData && bankAccountsData.length > 0 && !selectedAccountId) {
      setSelectedAccountId(bankAccountsData[0].id);
    }
  }, [defaultAccountData, bankAccountsData, selectedAccountId]);

  // ── Amount calculation ──────────────────────────────────────────────────────

  const allocatedTotal = Object.entries(allocations)
    .filter(([id]) => checkedInvoices.has(id))
    .reduce((sum, [, amt]) => sum + (parseFloat(amt) || 0), 0);

  const displayAmount = amountOverridden ? manualAmount : allocatedTotal.toFixed(2);

  // When allocations change and user hasn't manually overridden, sync amount
  useEffect(() => {
    if (!amountOverridden) {
      setManualAmount(allocatedTotal > 0 ? allocatedTotal.toFixed(2) : "");
    }
  }, [allocatedTotal, amountOverridden]);

  // ── Checkbox/allocation handlers ────────────────────────────────────────────

  const handleToggleInvoice = useCallback(
    (invoiceId: string, balance: string) => {
      setCheckedInvoices((prev) => {
        const next = new Set(prev);
        if (next.has(invoiceId)) {
          next.delete(invoiceId);
        } else {
          next.add(invoiceId);
          // Auto-fill balance if not already set
          setAllocations((a) => ({
            ...a,
            [invoiceId]: a[invoiceId] ?? balance,
          }));
        }
        return next;
      });
      setAmountOverridden(false);
    },
    []
  );

  const handleAllocationChange = useCallback(
    (invoiceId: string, value: string) => {
      setAllocations((a) => ({ ...a, [invoiceId]: value }));
      setAmountOverridden(false);
    },
    []
  );

  const handleAmountChange = (value: string) => {
    setManualAmount(value);
    setAmountOverridden(true);

    // Auto-select invoices oldest-first until the amount is consumed
    const target = parseFloat(value) || 0;
    if (target > 0 && unpaidInvoices?.length) {
      let remaining = target;
      const nextChecked = new Set<string>();
      const nextAllocations: Record<string, string> = {};

      for (const inv of unpaidInvoices) {
        if (remaining <= 0) break;
        const balance = parseFloat(inv.balance);
        if (balance <= 0) continue;

        nextChecked.add(inv.id);
        const allocAmt = Math.min(remaining, balance);
        nextAllocations[inv.id] = allocAmt.toFixed(2);
        remaining -= allocAmt;
      }

      setCheckedInvoices(nextChecked);
      setAllocations(nextAllocations);
    } else {
      setCheckedInvoices(new Set());
      setAllocations({});
    }
  };

  // ── Party change ────────────────────────────────────────────────────────────

  const handlePartyChange = (newPartyId: string) => {
    setPartyId(newPartyId);
    setAllocations({});
    setCheckedInvoices(new Set());
    setAmountOverridden(false);
    setManualAmount("");
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const invalidateAll = () => {
    utils.payment.list.invalidate();
    utils.payment.getById.invalidate();
    utils.payment.unpaidInvoices.invalidate();
    utils.payment.defaultAccount.invalidate();
    utils.invoice.list.invalidate();
    utils.invoice.getById.invalidate();
    utils.dashboard.summary.invalidate();
    utils.bankAccount.list.invalidate();
    utils.bankAccount.summary.invalidate();
  };

  const createMutation = trpc.payment.create.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success("Payment recorded");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.payment.update.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success("Payment updated");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const activeMutation = isEditMode ? updateMutation : createMutation;

  const selectedAccount = bankAccountsData?.find((a) => a.id === selectedAccountId) ?? null;

  function handleSubmit() {
    if (!partyId || !displayAmount) return;

    const allocationList: { invoiceId: string; amount: string }[] = [];
    for (const id of checkedInvoices) {
      const amt = allocations[id];
      if (amt && parseFloat(amt) > 0) {
        allocationList.push({ invoiceId: id, amount: parseFloat(amt).toFixed(2) });
      }
    }

    const mode = selectedAccount
      ? accountTypeToMode(selectedAccount.accountType)
      : "cash";

    const paymentDateISO = new Date(paymentDate + "T00:00:00").toISOString();

    if (isEditMode) {
      updateMutation.mutate({
        id: editPaymentId!,
        amount: parseFloat(displayAmount).toFixed(2),
        mode,
        bankAccountId: selectedAccountId ?? null,
        referenceNumber: referenceNumber || null,
        paymentDate: paymentDateISO,
        notes: notes || null,
        allocations: allocationList.length > 0 ? allocationList : undefined,
      });
    } else {
      createMutation.mutate({
        partyId,
        amount: parseFloat(displayAmount).toFixed(2),
        discount: "0",
        mode,
        bankAccountId: selectedAccountId ?? undefined,
        referenceNumber: referenceNumber || undefined,
        paymentDate: paymentDateISO,
        notes: notes || undefined,
        allocations: allocationList.length > 0 ? allocationList : undefined,
      });
    }
  }

  // ── Party options for Combobox ──────────────────────────────────────────────

  const partyOptions =
    partiesData?.data.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.type === "customer" ? "Customer" : "Supplier",
    })) ?? [];

  // ── Disclosure: count filled optional fields ────────────────────────────────

  const disclosureFilledCount = [referenceNumber, notes].filter(Boolean).length;

  // ── Render ──────────────────────────────────────────────────────────────────

  const canSubmit =
    !!partyId &&
    !!displayAmount &&
    parseFloat(displayAmount) > 0 &&
    !activeMutation.isPending;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEditMode ? "Edit Payment" : "Record Payment"}
      description={isEditMode ? "Update payment details and invoice allocations" : "Allocate payment to outstanding invoices"}
      footer={
        <div className="flex items-center justify-between">
          <div className="text-sm text-text-secondary">
            {checkedInvoices.size > 0 && (
              <span>
                {checkedInvoices.size} invoice{checkedInvoices.size > 1 ? "s" : ""} selected
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              type="button"
            >
              {activeMutation.isPending
                ? (isEditMode ? "Saving..." : "Recording...")
                : displayAmount && parseFloat(displayAmount) > 0
                  ? `${isEditMode ? "Save" : "Record"} ${formatCurrency(displayAmount)}`
                  : (isEditMode ? "Save Payment" : "Record Payment")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── Party selector ─────────────────────────────────────────────── */}
        <Combobox
          label="Party"
          required
          value={partyId}
          onChange={handlePartyChange}
          options={partyOptions}
          placeholder="Search party..."
          emptyMessage="No parties found"
        />

        {/* ── Unpaid Invoices ─────────────────────────────────────────────── */}
        {partyId && (
          <div>
            <p className="label mb-2">Unpaid Invoices</p>
            <div className="rounded-xl border border-border-light overflow-hidden bg-surface-0">
              {loadingInvoices ? (
                <div className="p-4 space-y-3 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="skeleton h-4 w-4 rounded" />
                      <div className="skeleton h-4 flex-1 rounded" />
                      <div className="skeleton h-4 w-20 rounded" />
                    </div>
                  ))}
                </div>
              ) : !unpaidInvoices?.length ? (
                <div className="px-4 py-5 text-center">
                  <p className="text-sm text-text-tertiary">
                    No unpaid invoices for this party
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border-light">
                  {unpaidInvoices.map((inv) => {
                    const isChecked = checkedInvoices.has(inv.id);
                    const allocAmt = isChecked ? (parseFloat(allocations[inv.id] ?? inv.balance) || 0) : 0;
                    const balance = parseFloat(inv.balance);
                    const remainingBal = isChecked ? Math.max(balance - allocAmt, 0) : balance;
                    const isFullyPaid = isChecked && allocAmt >= balance;
                    const isPartial = isChecked && !isFullyPaid;

                    // Projected progress: existing paid + this allocation
                    const existingPaid = parseFloat(inv.amountPaid);
                    const totalAmt = parseFloat(inv.totalAmount);
                    const projectedPaid = isChecked ? existingPaid + allocAmt : existingPaid;

                    return (
                      <div
                        key={inv.id}
                        className={cn(
                          "px-4 py-3 transition-colors cursor-pointer",
                          isChecked ? "bg-brand-600/[0.06]" : "hover:bg-surface-1"
                        )}
                        onClick={() => handleToggleInvoice(inv.id, inv.balance)}
                      >
                        <div className="flex items-start gap-3">
                          {/* Tri-state checkbox */}
                          <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isFullyPaid ? "true" : isPartial ? "mixed" : "false"}
                              aria-label={`Select invoice ${inv.invoiceNumber}`}
                              onClick={() => handleToggleInvoice(inv.id, inv.balance)}
                              className={cn(
                                "w-[18px] h-[18px] rounded border-[1.5px] flex items-center justify-center transition-all",
                                isFullyPaid
                                  ? "bg-brand-600 border-brand-600"
                                  : isPartial
                                    ? "bg-brand-600/20 border-brand-600"
                                    : "border-text-tertiary/40 hover:border-brand-500"
                              )}
                            >
                              {isFullyPaid && (
                                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-white">
                                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                              {isPartial && (
                                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-brand-600">
                                  <path d="M3 6H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              )}
                            </button>
                          </div>

                          {/* Invoice info */}
                          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between gap-2">
                              <div
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={() => handleToggleInvoice(inv.id, inv.balance)}
                              >
                                <span className="font-mono text-[13px] font-medium text-text-primary">
                                  {inv.invoiceNumber}
                                </span>
                                <span className="text-xs text-text-tertiary">
                                  {formatDate(inv.invoiceDate)}
                                </span>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs text-text-tertiary">
                                  Total: {formatCurrency(inv.totalAmount)}
                                </p>
                                <p className={cn(
                                  "text-sm font-semibold tabular-nums transition-colors",
                                  isFullyPaid
                                    ? "text-emerald-600"
                                    : isPartial
                                      ? "text-amber-600"
                                      : "text-amber-600"
                                )}>
                                  Bal: {isChecked
                                    ? (isFullyPaid ? "₹0.00" : formatCurrency(remainingBal))
                                    : formatCurrency(inv.balance)}
                                </p>
                              </div>
                            </div>

                            {/* Progress bar — live preview of projected payment */}
                            <div className="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-300",
                                  isFullyPaid || projectedPaid >= totalAmt
                                    ? "bg-emerald-500"
                                    : projectedPaid > 0
                                      ? "bg-amber-400"
                                      : "bg-transparent"
                                )}
                                style={{ width: `${Math.min((projectedPaid / totalAmt) * 100, 100)}%` }}
                              />
                            </div>

                            {/* Allocation amount input when checked */}
                            {isChecked && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-xs text-text-tertiary shrink-0">
                                  Paying:
                                </span>
                                <div className="relative flex-1 max-w-[160px]">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-text-tertiary pointer-events-none">
                                    ₹
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max={inv.balance}
                                    value={allocations[inv.id] ?? inv.balance}
                                    onChange={(e) =>
                                      handleAllocationChange(inv.id, e.target.value)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                      "input pl-6 py-1.5 text-sm h-8 tabular-nums",
                                      isFullyPaid && "border-emerald-300 focus:border-emerald-500"
                                    )}
                                    placeholder="0.00"
                                  />
                                </div>
                                {isFullyPaid && (
                                  <span className="text-[11px] font-medium text-emerald-600">Full</span>
                                )}
                                {isPartial && (
                                  <span className="text-[11px] font-medium text-amber-600">Partial</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {unpaidInvoices.length > 0 && (
                    <div className="px-4 py-2 text-center text-xs text-text-tertiary bg-surface-1">
                      {unpaidInvoices.length} unpaid invoice
                      {unpaidInvoices.length > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Payment Amount ──────────────────────────────────────────────── */}
        <div>
          <InputField
            label="Payment Amount (₹)"
            required
            type="number"
            step="0.01"
            min="0.01"
            value={displayAmount}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0.00"
          />
          {!amountOverridden && allocatedTotal > 0 && (
            <p className="mt-1 text-xs text-text-tertiary">
              Auto-calculated from selected invoices
            </p>
          )}
        </div>

        {/* ── Receive Into (Account Selector) ────────────────────────────── */}
        <div>
          <p className="label mb-2">Receive into</p>
          {!bankAccountsData?.length ? (
            <div
              className="rounded-xl border border-dashed border-border-light px-4 py-4 text-center"
            >
              <p className="text-sm text-text-tertiary">
                No accounts set up yet.{" "}
                <a
                  href="/cash-and-bank"
                  className="text-brand-600 hover:underline"
                >
                  Add an account
                </a>{" "}
                to track where payments land.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {bankAccountsData.map((account) => {
                const isSelected = selectedAccountId === account.id;
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setSelectedAccountId(account.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-xl border-2 p-3 cursor-pointer transition-all text-left min-w-[110px] max-w-[150px]",
                      isSelected
                        ? "border-brand-500 bg-brand-600/[0.06]"
                        : "border-border-light hover:border-brand-300 hover:bg-surface-1"
                    )}
                    aria-pressed={isSelected}
                  >
                    <span className="text-base leading-none" aria-hidden="true">
                      {accountTypeIcon(account.accountType)}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-semibold mt-1 truncate w-full",
                        isSelected ? "text-brand-700 dark:text-brand-400" : "text-text-primary"
                      )}
                    >
                      {account.accountName}
                    </span>
                    <span className="text-[11px] text-text-tertiary">
                      {accountTypeLabel(account.accountType)}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-medium tabular-nums mt-0.5",
                        isSelected ? "text-brand-600" : "text-text-secondary"
                      )}
                    >
                      {formatCurrency(account.currentBalance)}
                    </span>
                    {account.isDefault && (
                      <span className="text-[10px] text-brand-500 font-medium">
                        Default
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Date ───────────────────────────────────────────────────────── */}
        <InputField
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />

        {/* ── Reference & Notes Disclosure ───────────────────────────────── */}
        <div
          className="rounded-xl border border-border-light"
        >
          <Disclosure
            label="Reference & Notes"
            count={disclosureFilledCount}
          >
            <div className="space-y-3 px-1">
              <InputField
                label="Reference #"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Transaction ID, cheque number..."
              />
              <TextareaField
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes..."
              />
            </div>
          </Disclosure>
        </div>
      </div>
    </SlideOver>
  );
}
