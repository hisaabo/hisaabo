import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DocumentCreator } from "@/components/DocumentCreator";
import { toast } from "@/hooks/useToast";

export const Route = createFileRoute("/sales-returns")({
  component: SalesReturnsPage,
});

const statusTabs = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "cancelled", label: "Cancelled" },
];

function SalesReturnsPage() {
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");

  const { data, isLoading } = trpc.salesReturn.list.useQuery({
    type: "sale",
    status: (status || undefined) as any,
    page: 1,
    limit: 50,
  });

  const utils = trpc.useUtils();

  const updateStatus = trpc.salesReturn.updateStatus.useMutation({
    onSuccess: () => {
      utils.salesReturn.list.invalidate();
      toast.success("Sales return status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  const deleteMutation = trpc.salesReturn.delete.useMutation({
    onSuccess: () => {
      utils.salesReturn.list.invalidate();
      toast.success("Sales return deleted");
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error("Failed to delete sales return", err.message);
      setDeleteId(null);
    },
  });

  function confirmDelete(id: string, number: string) {
    setDeleteId(id);
    setDeleteNumber(number);
  }

  return (
    <div>
      <PageHeader
        title="Sales Returns"
        description="Manage returned goods from customers"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New Sales Return
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <PillTabs tabs={statusTabs} value={status} onChange={setStatus} />
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
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
          }
          title="No sales returns found"
          description={`No sales returns${status ? ` with status "${status}"` : ""}.`}
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + New Sales Return
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Return #</th>
                <th>Date</th>
                <th>Ref. Invoice</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((doc) => (
                <tr key={doc.id} className="group">
                  <td className="font-medium">{doc.partyName}</td>
                  <td className="font-mono text-[13px] text-text-secondary">
                    {doc.invoiceNumber}
                  </td>
                  <td className="text-text-secondary">
                    {formatDate(doc.invoiceDate)}
                  </td>
                  <td className="text-text-secondary font-mono text-[13px]">
                    {doc.referenceDocumentId ? (
                      <span className="text-brand-600">Linked</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <StatusBadge status={doc.status} size="sm" />
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    {formatCurrency(doc.totalAmount)}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {doc.status === "draft" && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: doc.id, status: "sent" })
                          }
                          className="text-xs px-2 py-1 rounded font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                        >
                          Mark Sent
                        </button>
                      )}
                      {doc.status === "draft" && (
                        <button
                          onClick={() =>
                            confirmDelete(doc.id, doc.invoiceNumber)
                          }
                          className="text-xs px-2 py-1 rounded font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                        >
                          Delete
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

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={!!deleteId}
        title="Delete Sales Return"
        description={`Delete sales return ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      {/* Document creator */}
      {showCreate && (
        <DocumentCreator
          documentType="sales_return"
          invoiceType="sale"
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
