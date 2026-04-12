import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { SegmentedControl } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DocumentCreator, type DocumentType } from "@/components/DocumentCreator";
import { toast } from "@/hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────

interface Tab {
  value: string;
  label: string;
}

export type TrpcRouterKey =
  | "quotation"
  | "proforma"
  | "deliveryChallan"
  | "salesReturn"
  | "creditNote";

export interface ConvertConfig {
  /** The id of the document currently being converted (null if none) */
  convertingId: string | null;
  onConvert: (id: string) => void;
}

export interface DocumentListPageConfig {
  /** tRPC router namespace — must match the key on the trpc object */
  trpcRouter: TrpcRouterKey;
  /** DocumentCreator's documentType prop */
  documentType: DocumentType;
  /**
   * Fixed invoiceType for routes with no type toggle (quotations, proforma,
   * sales-returns). Ignored when hasTypeFilter is true.
   */
  defaultInvoiceType?: "sale" | "purchase";
  /** Show the sale/purchase SegmentedControl (delivery-challans, credit-notes) */
  hasTypeFilter?: boolean;

  // PageHeader
  title: string;
  description: string;
  /** Label for the "create" button, e.g. "+ New Challan" */
  buttonLabel: string;

  // Status pill-tabs
  statusTabs: Tab[];

  // Empty state copy
  emptyTitle: string;
  /**
   * Receives current type and status filter; returns the description string.
   * Use it to compose contextual copy like "No sales delivery challans with status 'draft'."
   */
  emptyDescription: (type: "sale" | "purchase", status: string) => string;
  /** SVG path d-value for the empty-state icon */
  emptyIconPath: string;

  // Table column 2
  /** Column 2 header label, e.g. "Challan #", "Quotation #" */
  col2Header: string;
  /**
   * Column 4 variant:
   * - "dueDate"    — shows doc.dueDate (delivery-challans, quotations, proforma)
   * - "refInvoice" — shows a "Linked" badge from doc.referenceDocumentId
   *                  (sales-returns, credit-notes)
   */
  col4Variant: "dueDate" | "refInvoice";
  /** Column 4 header label */
  col4Header: string;

  // Row-level actions
  /** Show "Mark Sent" button when doc.status === "draft" */
  markSent?: boolean;
  /** Show "Mark Paid" button when doc.status === "sent" (credit-notes only) */
  markPaid?: boolean;
  /**
   * When provided, a "Convert to Invoice" button is shown for every row.
   * Pass a ConvertConfig from the route wrapper that owns the convert mutation.
   */
  convert?: ConvertConfig;
}

// ── Component ─────────────────────────────────────────────────────

const typeOptions = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
];

interface DocumentListPageProps {
  config: DocumentListPageConfig;
}

export function DocumentListPage({ config }: DocumentListPageProps) {
  const {
    trpcRouter,
    documentType,
    defaultInvoiceType = "sale",
    hasTypeFilter = false,
    title,
    description,
    buttonLabel,
    statusTabs,
    emptyTitle,
    emptyDescription,
    emptyIconPath,
    col2Header,
    col4Variant,
    col4Header,
    markSent = false,
    markPaid = false,
    convert,
  } = config;

  const [type, setType] = useState<"sale" | "purchase">(
    hasTypeFilter ? "sale" : defaultInvoiceType
  );
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");

  const utils = trpc.useUtils();

  // Because trpc is typed as `any` (see lib/trpc.ts), dynamic key access is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = (trpc as any)[trpcRouter];

  const { data, isLoading } = router.list.useQuery({
    type,
    status: (status || undefined) as never,
    page: 1,
    limit: 50,
  });

  const updateStatus = router.updateStatus.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any)[trpcRouter].list.invalidate();
      toast.success("Status updated");
    },
    onError: (err: { message: string }) =>
      toast.error("Failed to update status", err.message),
  });

  const deleteMutation = router.delete.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any)[trpcRouter].list.invalidate();
      toast.success(`Deleted successfully`);
      setDeleteId(null);
    },
    onError: (err: { message: string }) => {
      toast.error("Failed to delete", err.message);
      setDeleteId(null);
    },
  });

  function confirmDelete(id: string, number: string) {
    setDeleteId(id);
    setDeleteNumber(number);
  }

  // Singular form for dialog copy: strip trailing "s" for simple plurals
  const singular = title.replace(/s$/, "");

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            {buttonLabel}
          </button>
        }
      />

      {/* Filters */}
      <div
        className={
          hasTypeFilter
            ? "flex items-center gap-3 mb-4 flex-wrap"
            : "flex items-center gap-3 mb-4"
        }
      >
        {hasTypeFilter && (
          <SegmentedControl
            tabs={typeOptions}
            value={type}
            onChange={(v) => setType(v as "sale" | "purchase")}
          />
        )}
        <div className={hasTypeFilter ? "ml-auto" : undefined}>
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
                d={emptyIconPath}
              />
            </svg>
          }
          title={emptyTitle}
          description={emptyDescription(type, status)}
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              {buttonLabel}
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>{col2Header}</th>
                <th>Date</th>
                <th>{col4Header}</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {data.data.map((doc: any) => (
                <tr key={doc.id} className="group">
                  <td className="font-medium">{doc.partyName}</td>
                  <td className="font-mono text-[13px] text-text-secondary">
                    {doc.invoiceNumber}
                  </td>
                  <td className="text-text-secondary">
                    {formatDate(doc.invoiceDate)}
                  </td>
                  <td className="text-text-secondary">
                    {col4Variant === "dueDate" ? (
                      doc.dueDate ? (
                        formatDate(doc.dueDate)
                      ) : (
                        "—"
                      )
                    ) : doc.referenceDocumentId ? (
                      <span className="font-mono text-[13px] text-brand-600">
                        Linked
                      </span>
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
                      {markSent && doc.status === "draft" && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: doc.id, status: "sent" })
                          }
                          className="text-xs px-2 py-1 rounded font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                        >
                          Mark Sent
                        </button>
                      )}
                      {markPaid && doc.status === "sent" && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({ id: doc.id, status: "paid" })
                          }
                          className="text-xs px-2 py-1 rounded font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
                        >
                          Mark Paid
                        </button>
                      )}
                      {convert && (
                        <button
                          onClick={() => convert.onConvert(doc.id)}
                          disabled={convert.convertingId === doc.id}
                          className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
                        >
                          {convert.convertingId === doc.id
                            ? "Converting…"
                            : "Convert to Invoice"}
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
        title={`Delete ${singular}`}
        description={`Delete ${singular.toLowerCase()} ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      {/* Document creator */}
      {showCreate && (
        <DocumentCreator
          documentType={documentType}
          invoiceType={type}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
