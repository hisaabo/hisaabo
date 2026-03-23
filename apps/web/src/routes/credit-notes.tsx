import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { SegmentedControl } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DocumentCreator } from "@/components/DocumentCreator";
import { toast } from "@/hooks/useToast";

export const Route = createFileRoute("/credit-notes")({
  component: CreditNotesPage,
});

const statusTabs = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const typeOptions = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
];

function CreditNotesPage() {
  const [type, setType] = useState<"sale" | "purchase">("sale");
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");

  const { data, isLoading } = trpc.creditNote.list.useQuery({
    type,
    status: (status || undefined) as any,
    page: 1,
    limit: 50,
  });

  const utils = trpc.useUtils();

  const updateStatus = trpc.creditNote.updateStatus.useMutation({
    onSuccess: () => {
      utils.creditNote.list.invalidate();
      toast.success("Credit note status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  const deleteMutation = trpc.creditNote.delete.useMutation({
    onSuccess: () => {
      utils.creditNote.list.invalidate();
      toast.success("Credit note deleted");
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error("Failed to delete credit note", err.message);
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
        title="Credit Notes"
        description="Manage sales and purchase credit notes"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New Credit Note
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <SegmentedControl
          tabs={typeOptions}
          value={type}
          onChange={(v) => setType(v as "sale" | "purchase")}
        />
        <div className="ml-auto">
          <PillTabs tabs={statusTabs} value={status} onChange={setStatus} />
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
          title="No credit notes found"
          description={`No ${type === "sale" ? "sales" : "purchase"} credit notes${status ? ` with status "${status}"` : ""}.`}
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + New Credit Note
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Credit Note #</th>
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
                      {(doc.status === "sent") && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: doc.id, status: "paid" })
                          }
                          className="text-xs px-2 py-1 rounded font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
                        >
                          Mark Paid
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
        title="Delete Credit Note"
        description={`Delete credit note ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      {/* Document creator */}
      {showCreate && (
        <DocumentCreator
          documentType="credit_note"
          invoiceType={type}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
