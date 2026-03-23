import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useHotkeys } from "@/hooks/useHotkeys";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { RecordPaymentPanel } from "@/components/RecordPaymentPanel";

export const Route = createFileRoute("/payments")({
  component: PaymentsPage,
});

const modeLabels: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  upi: "UPI",
  cheque: "Cheque",
  other: "Other",
};

function PaymentsPage() {
  const [showPanel, setShowPanel] = useState(false);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = trpc.payment.list.useQuery({ page: 1, limit: 50 });
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

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          title="No payments recorded yet"
          description="Record your first payment to start tracking cash flow."
          action={
            <button className="btn-primary" onClick={() => setShowPanel(true)}>
              + Record Payment
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
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
              {data.data.map((p) => (
                <tr key={p.id} className="group">
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
                  <td className="text-right">
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
          {data.total > data.data.length && (
            <div className="px-4 py-2.5 text-xs text-center text-text-tertiary bg-surface-1">
              Showing {data.data.length} of {data.total}
            </div>
          )}
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
