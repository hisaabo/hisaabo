import { createFileRoute, useNavigate } from "@tanstack/react-router";
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

export const Route = createFileRoute("/proforma-invoices")({
  component: ProformaInvoicesPage,
});

const statusTabs = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "cancelled", label: "Cancelled" },
];

function ProformaInvoicesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const { data, isLoading } = trpc.proforma.list.useQuery({
    type: "sale",
    status: (status || undefined) as any,
    page: 1,
    limit: 50,
  });

  const utils = trpc.useUtils();

  const updateStatus = trpc.proforma.updateStatus.useMutation({
    onSuccess: () => {
      utils.proforma.list.invalidate();
      toast.success("Proforma status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  const deleteMutation = trpc.proforma.delete.useMutation({
    onSuccess: () => {
      utils.proforma.list.invalidate();
      toast.success("Proforma invoice deleted");
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error("Failed to delete proforma invoice", err.message);
      setDeleteId(null);
    },
  });

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: () => {
      toast.success("Converted to invoice");
      utils.invoice.list.invalidate();
      setConvertingId(null);
      navigate({ to: "/invoices" });
    },
    onError: (err) => {
      toast.error("Failed to convert", err.message);
      setConvertingId(null);
    },
  });

  function handleConvert(id: string) {
    setConvertingId(id);
    convertMutation.mutate({ sourceDocumentId: id, targetDocumentType: "invoice" });
  }

  function confirmDelete(id: string, number: string) {
    setDeleteId(id);
    setDeleteNumber(number);
  }

  return (
    <div>
      <PageHeader
        title="Proforma Invoices"
        description="Manage proforma invoices"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New Proforma
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
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          }
          title="No proforma invoices found"
          description={`No proforma invoices${status ? ` with status "${status}"` : ""}.`}
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + New Proforma
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Proforma #</th>
                <th>Date</th>
                <th>Due Date</th>
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
                  <td className="text-text-secondary">
                    {doc.dueDate ? formatDate(doc.dueDate) : "—"}
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
                      <button
                        onClick={() => handleConvert(doc.id)}
                        disabled={convertingId === doc.id}
                        className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
                      >
                        {convertingId === doc.id ? "Converting…" : "Convert to Invoice"}
                      </button>
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
        title="Delete Proforma Invoice"
        description={`Delete proforma invoice ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      {/* Document creator */}
      {showCreate && (
        <DocumentCreator
          documentType="proforma"
          invoiceType="sale"
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
