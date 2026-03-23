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

export const Route = createFileRoute("/delivery-challans")({
  component: DeliveryChallansPage,
});

const statusTabs = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "cancelled", label: "Cancelled" },
];

const typeOptions = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
];

function DeliveryChallansPage() {
  const [type, setType] = useState<"sale" | "purchase">("sale");
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");

  const { data, isLoading } = trpc.deliveryChallan.list.useQuery({
    type,
    status: (status || undefined) as any,
    page: 1,
    limit: 50,
  });

  const utils = trpc.useUtils();

  const updateStatus = trpc.deliveryChallan.updateStatus.useMutation({
    onSuccess: () => {
      utils.deliveryChallan.list.invalidate();
      toast.success("Delivery challan status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  const deleteMutation = trpc.deliveryChallan.delete.useMutation({
    onSuccess: () => {
      utils.deliveryChallan.list.invalidate();
      toast.success("Delivery challan deleted");
      setDeleteId(null);
    },
    onError: (err) => {
      toast.error("Failed to delete delivery challan", err.message);
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
        title="Delivery Challans"
        description="Manage delivery challans and dispatch notes"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New Challan
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
                d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V8l-4-4H8zm0 0v4h4M8 12h8M8 16h4"
              />
            </svg>
          }
          title="No delivery challans found"
          description={`No ${type === "sale" ? "sales" : "purchase"} delivery challans${status ? ` with status "${status}"` : ""}.`}
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + New Challan
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Challan #</th>
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
        title="Delete Delivery Challan"
        description={`Delete delivery challan ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      {/* Document creator */}
      {showCreate && (
        <DocumentCreator
          documentType="delivery_challan"
          invoiceType={type}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
