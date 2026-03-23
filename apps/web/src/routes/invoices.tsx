import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { getBusinessId } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { SegmentedControl } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlideOver } from "@/components/ui/SlideOver";
import { DocumentCreator } from "@/components/DocumentCreator";
import { SearchInput } from "@/components/ui/SearchInput";
import { Pagination } from "@/components/ui/Pagination";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { RecordPaymentPanel } from "@/components/RecordPaymentPanel";

export const Route = createFileRoute("/invoices")({
  component: InvoicesPage,
});

const statusTabs = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const typeOptions = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
];

// ── PDF download button ──────────────────────────────────────────

function DownloadPDFButton({
  invoiceId,
  invoiceNumber,
  invoiceStatus,
  onShared,
}: {
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  onShared?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function download(format: "a4" | "thermal") {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/invoices/${invoiceId}/pdf?format=${format}`,
        {
          credentials: "include",
          headers: { "x-business-id": getBusinessId() || "" },
        }
      );
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber}_${format}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      // Auto-mark as sent on first share
      if (invoiceStatus === "draft") {
        onShared?.();
      }
    } catch {
      toast.error("Failed to download PDF");
    }
    setLoading(false);
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); download("a4"); }}
        disabled={loading}
        className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
      >
        {loading ? "…" : "A4 PDF"}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); download("thermal"); }}
        disabled={loading}
        className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
      >
        Receipt
      </button>
    </div>
  );
}

// ── Invoice Detail Panel ─────────────────────────────────────────

interface InvoiceDetailPanelProps {
  invoiceId: string | null;
  onClose: () => void;
  onRecordPayment: (partyId: string, invoiceId: string, balance: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (invoiceId: string, type: "sale" | "purchase") => void;
}

function InvoiceDetailPanel({
  invoiceId,
  onClose,
  onRecordPayment,
  onStatusChange,
  onEdit,
}: InvoiceDetailPanelProps) {
  const navigate = useNavigate();
  const { data: invoice, isLoading } = trpc.invoice.getById.useQuery(
    { id: invoiceId! },
    { enabled: !!invoiceId }
  );

  const { data: invoicePayments } = trpc.payment.list.useQuery(
    { invoiceId: invoiceId!, page: 1, limit: 50 },
    { enabled: !!invoiceId }
  );

  const utils = trpc.useUtils();

  const updateStatus = trpc.invoice.updateStatus.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      if (invoiceId) utils.invoice.getById.invalidate({ id: invoiceId });
      toast.success("Invoice status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  if (!invoiceId) return null;

  const balance = invoice
    ? parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid)
    : 0;

  const canRecordPayment =
    invoice &&
    invoice.status !== "draft" &&
    invoice.status !== "cancelled" &&
    invoice.status !== "paid";

  return (
    <SlideOver
      open={!!invoiceId}
      onClose={onClose}
      title={isLoading ? "Loading…" : invoice ? `Invoice ${invoice.invoiceNumber}` : "Invoice"}
      description={invoice ? `${invoice.party?.name ?? ""} — ${formatDate(invoice.invoiceDate)}` : undefined}
      footer={
        invoice ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {invoice.status !== "paid" && (
                <button
                  onClick={() => {
                    onClose();
                    onEdit(invoice.id, invoice.type as "sale" | "purchase");
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
                >
                  Edit
                </button>
              )}
              {invoice.status === "draft" && (
                <button
                  onClick={() => updateStatus.mutate({ id: invoice.id, status: "sent" })}
                  disabled={updateStatus.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors disabled:opacity-50"
                >
                  Mark Sent
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <DownloadPDFButton
                invoiceId={invoice.id}
                invoiceNumber={invoice.invoiceNumber}
                invoiceStatus={invoice.status}
                onShared={() => onStatusChange(invoice.id, "sent")}
              />
              {canRecordPayment && (
                <button
                  onClick={() =>
                    onRecordPayment(
                      invoice.partyId,
                      invoice.id,
                      balance.toFixed(2)
                    )
                  }
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 transition-colors"
                >
                  Record Payment
                </button>
              )}
            </div>
          </div>
        ) : null
      }
    >
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-8 rounded-lg" />
          ))}
        </div>
      ) : !invoice ? (
        <p className="text-text-tertiary text-sm">Invoice not found.</p>
      ) : (
        <div className="space-y-5">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Party</p>
                <p className="text-sm font-semibold text-text-primary">{invoice.party?.name ?? "—"}</p>
                {invoice.party?.phone && (
                  <p className="text-xs text-text-tertiary">{invoice.party.phone}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Status</p>
                <StatusBadge status={invoice.status} size="sm" />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Invoice Date</p>
                <p className="text-sm text-text-primary">{formatDate(invoice.invoiceDate)}</p>
              </div>
              {invoice.dueDate && (
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Due Date</p>
                  <p className="text-sm text-text-primary">{formatDate(invoice.dueDate)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div>
            <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">Items</p>
            <div className="card overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-1 border-b border-border-light">
                    <th className="px-3 py-2 text-left font-medium text-text-tertiary">Description</th>
                    <th className="px-3 py-2 text-right font-medium text-text-tertiary">Qty</th>
                    <th className="px-3 py-2 text-left font-medium text-text-tertiary">Unit</th>
                    <th className="px-3 py-2 text-right font-medium text-text-tertiary">Price</th>
                    <th className="px-3 py-2 text-right font-medium text-text-tertiary">Tax%</th>
                    <th className="px-3 py-2 text-right font-medium text-text-tertiary">Disc%</th>
                    <th className="px-3 py-2 text-right font-medium text-text-tertiary">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {invoice.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td className="px-3 py-2 text-text-primary">{li.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{li.quantity}</td>
                      <td className="px-3 py-2 text-text-secondary text-xs">
                        {li.selectedUnit?.toUpperCase() || "—"}
                        {li.conversionFactor && parseFloat(li.conversionFactor) > 1 && (
                          <span className="text-text-tertiary"> (×{li.conversionFactor})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatCurrency(li.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{li.taxPercent}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{li.discountPercent}%</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-text-primary">{formatCurrency(li.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Subtotal</span>
                <span className="tabular-nums text-text-primary">{formatCurrency(invoice.subtotal)}</span>
              </div>
              {parseFloat(invoice.discountAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Discount</span>
                  <span className="tabular-nums text-emerald-600">-{formatCurrency(invoice.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Tax</span>
                <span className="tabular-nums text-text-primary">{formatCurrency(invoice.taxAmount)}</span>
              </div>
              {parseFloat(invoice.additionalCharges ?? "0") > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Additional Charges</span>
                  <span className="tabular-nums text-text-primary">{formatCurrency(invoice.additionalCharges ?? "0")}</span>
                </div>
              )}
              {invoice.roundOff && parseFloat(invoice.roundOff) !== 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Round Off</span>
                  <span className="tabular-nums text-text-primary">{formatCurrency(invoice.roundOff)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-border-light flex justify-between">
                <span className="text-sm font-semibold text-text-primary">Total</span>
                <span className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(invoice.totalAmount)}</span>
              </div>
              {parseFloat(invoice.amountPaid) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Amount Paid</span>
                  <span className="tabular-nums text-emerald-600">{formatCurrency(invoice.amountPaid)}</span>
                </div>
              )}
              {balance > 0 && invoice.status !== "draft" && (
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-amber-600">Balance Due</span>
                  <span className="tabular-nums text-amber-600">{formatCurrency(balance)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes & Terms */}
          {(invoice.notes || invoice.termsAndConditions) && (
            <div className="grid grid-cols-2 gap-4">
              {invoice.notes && (
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-xs text-text-secondary whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              {invoice.termsAndConditions && (
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Terms &amp; Conditions</p>
                  <p className="text-xs text-text-secondary whitespace-pre-wrap">{invoice.termsAndConditions}</p>
                </div>
              )}
            </div>
          )}

          {/* Payments linked to this invoice */}
          {invoicePayments && invoicePayments.data.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Payments ({invoicePayments.data.length})
              </p>
              <div className="card overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-1 border-b border-border-light">
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Payment #</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Mode</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Reference</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {invoicePayments.data.map((pmt) => (
                      <tr
                        key={pmt.id}
                        className="cursor-pointer hover:bg-surface-1 transition-colors"
                        onClick={() => {
                          onClose();
                          navigate({ to: "/payments", search: { selected: pmt.id } });
                        }}
                      >
                        <td className="px-3 py-2">
                          <span className="font-mono text-[12px] font-medium text-brand-600 hover:underline">
                            {pmt.paymentNumber || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {formatDate(pmt.paymentDate)}
                        </td>
                        <td className="px-3 py-2 text-text-secondary capitalize">
                          {pmt.mode}
                        </td>
                        <td className="px-3 py-2 text-text-tertiary">
                          {pmt.referenceNumber || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">
                          {formatCurrency(pmt.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t border-border-light">
                      <td colSpan={4} className="px-3 py-2 text-right text-[11px] font-medium text-text-secondary">
                        Total Paid
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-600">
                        {formatCurrency(invoice.amountPaid)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* No payments yet message for unpaid invoices */}
          {invoicePayments && invoicePayments.data.length === 0 && invoice.status !== "draft" && invoice.status !== "cancelled" && (
            <div className="text-center py-4">
              <p className="text-xs text-text-tertiary">No payments recorded for this invoice</p>
            </div>
          )}
        </div>
      )}
    </SlideOver>
  );
}

// ── Page ─────────────────────────────────────────────────────────

interface PaymentPanelState {
  partyId: string;
  invoiceId: string;
  balance: string;
}

const PAGE_SIZE = 20;

function InvoicesPage() {
  const [type, setType] = useState<"sale" | "purchase">("sale");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");
  const [paymentPanel, setPaymentPanel] = useState<PaymentPanelState | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [editInvoice, setEditInvoice] = useState<{ id: string; type: "sale" | "purchase" } | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [type, status, debouncedSearch]);

  const { data, isLoading } = trpc.invoice.list.useQuery({
    type,
    status: (status || undefined) as any,
    search: debouncedSearch || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const utils = trpc.useUtils();

  const updateStatus = trpc.invoice.updateStatus.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Invoice status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  const deleteMutation = trpc.invoice.delete.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Invoice deleted");
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error("Failed to delete invoice", err.message);
      setDeleteId(null);
    },
  });

  function confirmDelete(id: string, number: string) {
    setDeleteId(id);
    setDeleteNumber(number);
  }

  function openPaymentPanel(partyId: string, invoiceId: string, balance: string) {
    setSelectedInvoiceId(null);
    setPaymentPanel({ partyId, invoiceId, balance });
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Manage sales and purchase invoices"
        actions={
          <button
            className="btn-primary"
            onClick={() => setShowCreate(true)}
          >
            + New Invoice
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search invoices..."
          className="max-w-xs"
        />
        <SegmentedControl
          tabs={typeOptions}
          value={type}
          onChange={(v) => setType(v as "sale" | "purchase")}
        />
        <div className="ml-auto">
          <PillTabs
            tabs={statusTabs}
            value={status}
            onChange={setStatus}
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-14 rounded-lg" />
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={
            <svg
              className="w-6 h-6 text-text-tertiary"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          }
          title="No invoices found"
          description={`No ${type === "sale" ? "sales" : "purchase"} invoices${status ? ` with status "${status}"` : ""}.`}
          action={
            <button
              className="btn-primary"
              onClick={() => setShowCreate(true)}
            >
              + New Invoice
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Due Date</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((inv) => {
                const balance =
                  parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
                return (
                  <tr
                    key={inv.id}
                    className="group cursor-pointer"
                    onClick={() => setSelectedInvoiceId(inv.id)}
                  >
                    <td className="font-medium">{inv.partyName}</td>
                    <td className="font-mono text-[13px] text-text-secondary">
                      {inv.invoiceNumber}
                    </td>
                    <td className="text-text-secondary">
                      {formatDate(inv.invoiceDate)}
                    </td>
                    <td className="text-text-secondary">
                      {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                    </td>
                    <td>
                      <StatusBadge status={inv.status} size="sm" />
                    </td>
                    <td className="text-right tabular-nums font-medium">
                      {formatCurrency(inv.totalAmount)}
                    </td>
                    <td className="text-right tabular-nums font-medium text-amber-600">
                      {balance > 0 && inv.status !== "draft"
                        ? formatCurrency(balance)
                        : "—"}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {/* PDF buttons — always visible */}
                        <DownloadPDFButton
                          invoiceId={inv.id}
                          invoiceNumber={inv.invoiceNumber}
                          invoiceStatus={inv.status}
                          onShared={() =>
                            updateStatus.mutate({ id: inv.id, status: "sent" })
                          }
                        />
                        {/* Hover-only actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {inv.status === "draft" && (
                            <button
                              onClick={() =>
                                updateStatus.mutate({
                                  id: inv.id,
                                  status: "sent",
                                })
                              }
                              className="text-xs px-2 py-1 rounded font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                            >
                              Mark Sent
                            </button>
                          )}
                          {inv.status !== "draft" &&
                            inv.status !== "cancelled" &&
                            inv.status !== "paid" && (
                              <button
                                onClick={() =>
                                  openPaymentPanel(
                                    inv.partyId,
                                    inv.id,
                                    (
                                      parseFloat(inv.totalAmount) -
                                      parseFloat(inv.amountPaid)
                                    ).toFixed(2)
                                  )
                                }
                                className="text-xs px-2 py-1 rounded font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
                              >
                                Record Payment
                              </button>
                            )}
                          {inv.status === "draft" && (
                            <button
                              onClick={() =>
                                confirmDelete(inv.id, inv.invoiceNumber)
                              }
                              className="text-xs px-2 py-1 rounded font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && (
            <Pagination
              page={page}
              totalPages={Math.ceil(data.total / PAGE_SIZE)}
              onPageChange={setPage}
              total={data.total}
              pageSize={PAGE_SIZE}
            />
          )}
        </div>
      )}

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={!!deleteId}
        title="Delete Invoice"
        description={`Delete invoice ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      {/* Document creator — new invoice */}
      {showCreate && (
        <DocumentCreator
          documentType="invoice"
          invoiceType={type}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Document creator — edit invoice */}
      {editInvoice && (
        <DocumentCreator
          documentType="invoice"
          invoiceType={editInvoice.type}
          onClose={() => setEditInvoice(null)}
          editInvoiceId={editInvoice.id}
        />
      )}

      {/* Invoice detail panel */}
      <InvoiceDetailPanel
        invoiceId={selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
        onRecordPayment={(partyId, invoiceId, balance) => {
          setSelectedInvoiceId(null);
          setPaymentPanel({ partyId, invoiceId, balance });
        }}
        onStatusChange={(id, status) =>
          updateStatus.mutate({ id, status: status as any })
        }
        onEdit={(id, invType) => setEditInvoice({ id, type: invType })}
      />

      {/* Record Payment panel — pre-filled from invoice row */}
      <RecordPaymentPanel
        open={paymentPanel !== null}
        onClose={() => setPaymentPanel(null)}
        preSelectedPartyId={paymentPanel?.partyId}
        preSelectedInvoiceId={paymentPanel?.invoiceId}
        preSelectedAmount={paymentPanel?.balance}
      />
    </div>
  );
}
