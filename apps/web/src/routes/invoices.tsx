import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { getBusinessId } from "@/lib/trpc";
import { formatCurrency, formatDate, downloadCSV, cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api-url";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { SegmentedControl } from "@/components/ui/Tabs";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { DetailField } from "@/components/ui/DetailField";
import { LinkButton } from "@/components/ui/LinkButton";
import { SlideOver } from "@/components/ui/SlideOver";
import { DocumentCreator } from "@/components/DocumentCreator";
import { SearchInput } from "@/components/ui/SearchInput";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDateRange } from "@/hooks/useDateRange";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { useCan, useCanModify } from "@/hooks/useCan";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { RecordPaymentPanel } from "@/components/RecordPaymentPanel";

const invoicesSearchSchema = z.object({
  id: z.string().uuid().optional(),
  create: z.string().optional(),
});

export const Route = createFileRoute("/invoices")({
  validateSearch: (search) => invoicesSearchSchema.parse(search),
  component: InvoicesPage,
});

const statusTabs = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "unfulfilled", label: "Unfulfilled" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const typeOptions = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
];

// ── Source chip ──────────────────────────────────────────────────
// Renders a small colored badge for the invoice's origin channel.
// null/undefined source → subtle "Manual" chip so the column never looks
// empty. Values map 1:1 to the invoices.source column values set by
// invoice.create (pos, online_store, webhook) and legacy NULL.

function SourceChip({ source }: { source: string | null | undefined }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    pos: { label: "POS", cls: "bg-brand-600/10 text-brand-700 dark:text-brand-400" },
    online_store: { label: "Store", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
    webhook: { label: "API", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  };
  const entry = source ? cfg[source] : null;
  if (!entry) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-text-tertiary">
        Manual
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

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
  const [open, setOpen] = useState(false);

  const { data: businesses } = trpc.business.list.useQuery();
  const activeId = getBusinessId();
  const activeBusiness = businesses?.find((b) => b.id === activeId);
  const hasGstin = !!(activeBusiness?.gstin && activeBusiness.gstRegistrationType !== "unregistered");

  type Format = "a4" | "a5" | "thermal";
  const options: { format: Format; label: string }[] = hasGstin
    ? [
        { format: "a4", label: "GST Invoice (A4)" },
        { format: "a5", label: "Simple Invoice (A5)" },
        { format: "thermal", label: "Thermal Receipt" },
      ]
    : [
        { format: "a5", label: "Invoice (A5)" },
        { format: "thermal", label: "Thermal Receipt" },
      ];

  async function download(format: Format) {
    setOpen(false);
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/api/invoices/${invoiceId}/pdf?format=${format}`),
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
      if (invoiceStatus === "draft") {
        onShared?.();
      }
    } catch {
      toast.error("Failed to download PDF");
    }
    setLoading(false);
  }

  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        title="Download PDF"
        className="p-1.5 rounded-lg text-text-tertiary hover:text-brand-600 hover:bg-brand-600/[0.08] transition-colors disabled:opacity-50"
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[172px] rounded-lg border border-border-light bg-surface-1 shadow-lg py-1">
            {options.map((opt) => (
              <button
                key={opt.format}
                onClick={() => download(opt.format)}
                className="w-full text-left text-xs px-3 py-2 text-text-primary hover:bg-surface-2 transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Shipment helpers (reused from shipments page) ─────────────────

type ShipmentStatus = "pending" | "shipped" | "in_transit" | "delivered" | "returned";

const SHIPMENT_STATUS_CFG: Record<ShipmentStatus, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  shipped: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  in_transit: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  delivered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  returned: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: "Pending",
  shipped: "Shipped",
  in_transit: "In Transit",
  delivered: "Delivered",
  returned: "Returned",
};

const INVOICE_MODE_LABELS: Record<string, string> = {
  hand_delivery: "Self/Driver",
  courier: "Courier",
  transport: "Transport",
  post: "Post",
};

function InvoiceShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", SHIPMENT_STATUS_CFG[status])}>
      {SHIPMENT_STATUS_LABELS[status]}
    </span>
  );
}

// ── Inline create shipment form ───────────────────────────────────

function CreateShipmentForm({ invoiceId, partyId, onCreated }: { invoiceId: string; partyId: string; onCreated: () => void }) {
  const [mode, setMode] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [cost, setCost] = useState("");

  const utils = trpc.useUtils();

  const createMutation = trpc.shipment.create.useMutation({
    onSuccess: () => {
      utils.shipment.list.invalidate();
      utils.invoice.getById.invalidate({ id: invoiceId });
      toast.success("Shipment created");
      onCreated();
    },
    onError: (err) => toast.error("Failed to create shipment", err.message),
  });

  return (
    <div className="mt-2 p-3 rounded-lg border border-border-light bg-surface-1 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="text-xs border border-border-light rounded-lg px-2 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Mode (optional)</option>
          <option value="hand_delivery">Self/Driver</option>
          <option value="courier">Courier</option>
          <option value="transport">Transport</option>
          <option value="post">Post</option>
        </select>
        <input
          type="text"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          placeholder="Carrier (optional)"
          className="text-xs border border-border-light rounded-lg px-2 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder="Tracking number (optional)"
          className="text-xs border border-border-light rounded-lg px-2 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <input
          type="number"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="Shipping cost (₹)"
          min="0"
          step="0.01"
          className="text-xs border border-border-light rounded-lg px-2 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500 tabular-nums"
        />
      </div>
      <button
        onClick={() =>
          createMutation.mutate({
            invoiceId,
            partyId,
            mode: mode || undefined,
            carrier: carrier || undefined,
            trackingNumber: tracking || undefined,
            cost: cost || "0",
            status: "pending",
          })
        }
        disabled={createMutation.isPending}
        className="w-full text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
      >
        {createMutation.isPending ? "Creating…" : "Create Shipment"}
      </button>
    </div>
  );
}

// ── Shipment card inside invoice detail ───────────────────────────

function InvoiceShipmentCard({ invoiceId, partyId, invoiceStatus }: { invoiceId: string; partyId: string; invoiceStatus: string }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showTrackingForm, setShowTrackingForm] = useState(false);
  const [trackingInput, setTrackingInput] = useState("");

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.shipment.list.useQuery(
    { invoiceId, limit: 1, page: 1 },
    { enabled: true }
  );

  const shipment = data?.data?.[0];

  const updateMutation = trpc.shipment.update.useMutation({
    onSuccess: () => {
      utils.shipment.list.invalidate();
      toast.success("Shipment updated");
      setShowTrackingForm(false);
    },
    onError: (err) => toast.error("Failed to update shipment", err.message),
  });

  function markStatus(newStatus: ShipmentStatus) {
    if (!shipment) return;
    const extra: { shipmentDate?: string; actualDelivery?: string } = {};
    if (newStatus === "shipped" || newStatus === "in_transit") extra.shipmentDate = new Date().toISOString();
    if (newStatus === "delivered") extra.actualDelivery = new Date().toISOString();
    updateMutation.mutate({ id: shipment.id, status: newStatus, ...extra });
  }

  function saveTracking() {
    if (!shipment || !trackingInput.trim()) return;
    updateMutation.mutate({ id: shipment.id, trackingNumber: trackingInput.trim() });
  }

  if (isLoading) return null;

  return (
    <div>
      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">Shipment</p>

      {!shipment ? (
        <div>
          {invoiceStatus === "paid" || invoiceStatus === "adjusted" ? (
            <p className="text-xs text-text-tertiary">
              {invoiceStatus === "adjusted" ? "Invoice is adjusted — shipment cannot be added." : "Invoice is paid — shipment cannot be added."}
            </p>
          ) : !showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
            >
              + Create Shipment
            </button>
          ) : (
            <CreateShipmentForm
              invoiceId={invoiceId}
              partyId={partyId}
              onCreated={() => {
                setShowCreate(false);
                utils.shipment.list.invalidate();
              }}
            />
          )}
        </div>
      ) : (
        <div className="card rounded-xl border border-border-light bg-surface-1 p-3 space-y-3">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <InvoiceShipmentStatusBadge status={shipment.status as ShipmentStatus} />
            <div className="flex gap-1.5">
              {shipment.status === "pending" && (
                <button
                  onClick={() => markStatus("shipped")}
                  disabled={updateMutation.isPending}
                  className="text-[11px] px-2 py-1 rounded-md font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 border border-blue-200 dark:border-blue-800 transition-colors disabled:opacity-50"
                >
                  Mark Shipped
                </button>
              )}
              {(shipment.status === "shipped" || shipment.status === "in_transit") && (
                <button
                  onClick={() => markStatus("delivered")}
                  disabled={updateMutation.isPending}
                  className="text-[11px] px-2 py-1 rounded-md font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 transition-colors disabled:opacity-50"
                >
                  Mark Delivered
                </button>
              )}
            </div>
          </div>

          {/* Mode + Carrier */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-text-tertiary mb-0.5">Mode</p>
              <p className="text-text-secondary">{INVOICE_MODE_LABELS[shipment.mode ?? ""] ?? shipment.mode ?? "—"}</p>
            </div>
            <div>
              <p className="text-text-tertiary mb-0.5">Carrier</p>
              <p className="text-text-secondary capitalize">{shipment.carrier?.replace(/_/g, " ") ?? "—"}</p>
            </div>
          </div>

          {/* Tracking */}
          <div className="text-xs">
            <p className="text-text-tertiary mb-0.5">Tracking</p>
            {shipment.trackingUrl ? (
              <a
                href={shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-brand-600 hover:underline"
              >
                {shipment.trackingNumber}
              </a>
            ) : shipment.trackingNumber ? (
              <span className="font-mono text-text-primary">{shipment.trackingNumber}</span>
            ) : showTrackingForm ? (
              <div className="flex gap-1.5 mt-1">
                <input
                  type="text"
                  value={trackingInput}
                  onChange={(e) => setTrackingInput(e.target.value)}
                  placeholder="Tracking number"
                  className="flex-1 border border-border-light rounded-md px-2 py-1 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <button
                  onClick={saveTracking}
                  disabled={updateMutation.isPending || !trackingInput.trim()}
                  className="px-2 py-1 rounded-md text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            ) : (
              <LinkButton
                onClick={() => setShowTrackingForm(true)}
              >
                Add tracking
              </LinkButton>
            )}
          </div>

          {/* Cost */}
          {parseFloat(shipment.cost) > 0 && (
            <div className="text-xs">
              <p className="text-text-tertiary mb-0.5">Shipping Cost</p>
              <p className="font-semibold text-text-primary tabular-nums">{formatCurrency(shipment.cost)}</p>
            </div>
          )}
        </div>
      )}
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
  onIssueCN?: (id: string, type: "sale" | "purchase") => void;
  onCreateSR?: (id: string, type: "sale" | "purchase") => void;
}

function InvoiceDetailPanel({
  invoiceId,
  onClose,
  onRecordPayment,
  onStatusChange,
  onEdit,
  onIssueCN,
  onCreateSR,
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

  // Compute how much has been credited/returned against this invoice (combined limit)
  const relatedCNs = invoice?.relatedDocuments?.filter((d: any) => d.documentType === "credit_note") ?? [];
  const relatedSRs = invoice?.relatedDocuments?.filter((d: any) => d.documentType === "sales_return") ?? [];
  const allRelated = [...relatedCNs, ...relatedSRs];
  const totalAdjusted = allRelated.reduce((sum: number, d: any) => sum + parseFloat(d.totalAmount), 0);
  const invoiceTotal = invoice ? parseFloat(invoice.totalAmount) : 0;
  const fullyAdjusted = totalAdjusted >= invoiceTotal;

  const canConvert =
    invoice &&
    invoice.status !== "draft" &&
    invoice.status !== "cancelled" &&
    !fullyAdjusted;

  const balance = invoice
    ? parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid) - parseFloat(invoice.totalAdjusted || "0")
    : 0;

  const canRecordPayment =
    invoice &&
    invoice.status !== "draft" &&
    invoice.status !== "cancelled" &&
    invoice.status !== "paid" &&
    invoice.status !== "adjusted" &&
    balance > 0.01;

  const isDraftLike = invoice?.status === "draft" || invoice?.status === "unfulfilled";

  // Edit affordance respects both role permission AND the 2-hour seller window.
  // The API enforces both; we surface them so sellers see the disabled state
  // and tooltip immediately rather than discovering it on submit.
  const editAffordance = useCanModify("update", "Invoice", invoice ? { createdAt: invoice.createdAt as any } : undefined);

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
              {invoice.status !== "paid" && editAffordance.allowed && (
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
              {invoice.status !== "paid" && !editAffordance.allowed && editAffordance.reason === "window-expired" && (
                <button
                  type="button"
                  disabled
                  title="The 2-hour edit window for this invoice has expired"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-tertiary border border-border-light opacity-60 cursor-not-allowed"
                >
                  Edit
                </button>
              )}
              {isDraftLike && (
                <button
                  onClick={() => updateStatus.mutate({ id: invoice.id, status: "sent" })}
                  disabled={updateStatus.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors disabled:opacity-50"
                >
                  {invoice.status === "unfulfilled" ? "Mark Fulfilled" : "Mark Sent"}
                </button>
              )}
              {/* Existing CN/SR links */}
              {relatedCNs.map((cn: any) => (
                <a
                  key={cn.id}
                  href={`/credit-notes?id=${cn.id}`}
                  className="inline-flex items-center text-xs px-2.5 py-1.5 rounded font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
                >
                  See {cn.invoiceNumber}
                </a>
              ))}
              {relatedSRs.map((sr: any) => (
                <a
                  key={sr.id}
                  href={`/sales-returns?id=${sr.id}`}
                  className="inline-flex items-center text-xs px-2.5 py-1.5 rounded font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
                >
                  See {sr.invoiceNumber}
                </a>
              ))}
              {/* Create buttons — only when not fully adjusted */}
              {canConvert && (
                <>
                  <button
                    onClick={() => { onClose(); onIssueCN?.(invoice.id, invoice.type as "sale" | "purchase"); }}
                    className="inline-flex items-center text-xs px-2.5 py-1.5 rounded font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
                  >
                    Issue Credit Note
                  </button>
                  <button
                    onClick={() => { onClose(); onCreateSR?.(invoice.id, invoice.type as "sale" | "purchase"); }}
                    className="inline-flex items-center text-xs px-2.5 py-1.5 rounded font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
                  >
                    Create Sales Return
                  </button>
                </>
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
        <SkeletonRows count={5} height="h-8" className="space-y-3 animate-pulse" />
      ) : !invoice ? (
        <p className="text-text-tertiary text-sm">Invoice not found.</p>
      ) : (
        <div className="space-y-5">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <DetailField label="Party">
                <p className="font-semibold text-text-primary">{invoice.party?.name ?? "—"}</p>
                {invoice.party?.phone && (
                  <p className="text-xs text-text-tertiary">{invoice.party.phone}</p>
                )}
              </DetailField>
              <DetailField label="Status">
                <StatusBadge status={invoice.status} size="sm" />
              </DetailField>
            </div>
            <div className="space-y-3">
              <DetailField label="Invoice Date">
                <p>{formatDate(invoice.invoiceDate)}</p>
              </DetailField>
              {invoice.dueDate && (
                <DetailField label="Due Date">
                  <p>{formatDate(invoice.dueDate)}</p>
                </DetailField>
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
                    <th className="px-3 py-2 text-left font-medium text-text-tertiary">Item</th>
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
                      <td className="px-3 py-2">
                        {/* Primary: frozen item name snapshot. Secondary:
                            optional italic notes — collapses with no
                            placeholder gap when description is null/empty. */}
                        <p className="font-medium text-text-primary">{li.itemName}</p>
                        {li.description && (
                          <p className="text-[11px] italic text-text-secondary mt-0.5 whitespace-pre-wrap">
                            {li.description}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary align-top">{li.quantity}</td>
                      <td className="px-3 py-2 text-text-secondary text-xs align-top">
                        {(li.selectedUnit || li.itemUnit)?.toUpperCase() || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary align-top">{formatCurrency(li.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary align-top">{li.taxPercent}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary align-top">{li.discountPercent}%</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-text-primary align-top">{formatCurrency(li.totalAmount)}</td>
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
              {parseFloat(invoice.totalAdjusted || "0") > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">CN/SR Adjusted</span>
                  <span className="tabular-nums text-purple-600">-{formatCurrency(invoice.totalAdjusted)}</span>
                </div>
              )}
              {parseFloat(invoice.amountPaid) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Amount Paid</span>
                  <span className="tabular-nums text-emerald-600">{formatCurrency(invoice.amountPaid)}</span>
                </div>
              )}
              {balance > 0.01 && !isDraftLike && (
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
                          navigate({ to: "/payments", search: { id: pmt.id } });
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

          {/* No payments yet message — but not when settled via CN/SR */}
          {invoicePayments && invoicePayments.data.length === 0 && !isDraftLike && invoice.status !== "cancelled" && invoice.status !== "adjusted" && (
            <div className="text-center py-4">
              <p className="text-xs text-text-tertiary">No payments recorded for this invoice</p>
            </div>
          )}
          {invoice.status === "adjusted" && invoicePayments?.data.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-text-tertiary">This invoice has been settled via credit note / sales return</p>
            </div>
          )}

          {/* Shipment card — sale invoices only */}
          {invoice.type === "sale" && (
            <InvoiceShipmentCard invoiceId={invoice.id} partyId={invoice.partyId} invoiceStatus={invoice.status} />
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

const PAGE_SIZE = 25;

function InvoicesPage() {
  const [type, setType] = useState<"sale" | "purchase">("sale");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "amount" | "number">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  // Show the "Switch to POS" entry button when the active business has POS
  // mode enabled. Sourced via the existing business.list query that powers
  // the PDF-download button — no extra network hit.
  const { data: bizRows } = trpc.business.list.useQuery();
  const posEnabled = !!bizRows?.find((b) => b.id === getBusinessId())?.posEnabled;
  // Tracks the partyId of the last-created invoice so "Create another" can pre-fill it
  const [lastCreatedPartyId, setLastCreatedPartyId] = useState<string | undefined>(undefined);
  const deleteConfirm = useDeleteConfirmation();
  const [paymentPanel, setPaymentPanel] = useState<PaymentPanelState | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [editInvoice, setEditInvoice] = useState<{ id: string; type: "sale" | "purchase" } | null>(null);
  const [cnSource, setCnSource] = useState<{ id: string; type: "sale" | "purchase" } | null>(null);
  const [srSource, setSrSource] = useState<{ id: string; type: "sale" | "purchase" } | null>(null);
  const [exporting, setExporting] = useState(false);
  const dateRange = useDateRange("invoices", "this-month");
  const canCreate = useCan("create", "Invoice");
  const canDelete = useCan("delete", "Invoice");

  // Open the invoice detail panel when navigated here with ?id=<invoiceId>
  // or open the create slider when navigated here with ?create=1 (used by
  // the Dashboard "+ New Invoice" CTA so users land directly in the form
  // rather than just on the list).
  const { id: idFromSearch, create: createFromSearch } = useSearch({ from: "/invoices" });
  useEffect(() => {
    if (idFromSearch) {
      setSelectedInvoiceId(idFromSearch);
    }
  }, [idFromSearch]);
  useEffect(() => {
    if (createFromSearch) {
      setShowCreate(true);
    }
  }, [createFromSearch]);

  const debouncedSearch = useDebounce(search, 300);

  // Keyboard shortcut: N to create new invoice
  useHotkeys([
    { key: "n", handler: () => setShowCreate(true), description: "New invoice", scope: "invoices" },
  ]);

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [type, status, debouncedSearch, dateRange.fromDate, dateRange.toDate, sortBy, sortDir]);

  const loadMore = useCallback(() => setPage((p) => p + 1), []);

  const { data, isFetching, isLoading } = trpc.invoice.list.useQuery({
    type,
    status: (status || undefined) as any,
    search: debouncedSearch || undefined,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    sortBy,
    sortDir,
    page,
    limit: PAGE_SIZE,
  }, {
    // Keep previous page data visible while next page loads —
    // prevents flash-to-empty that causes scroll position to reset.
    placeholderData: (prev) => prev,
  });

  const list = useInfiniteList({
    key: "invoices",
    data: data?.data,
    total: data?.total ?? 0,
    page,
    isFetching,
    onLoadMore: loadMore,
    resetDeps: [type, status, debouncedSearch, dateRange.fromDate, dateRange.toDate, sortBy, sortDir],
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
      // Optimistically remove from infinite list immediately
      if (deleteConfirm.deleteTarget) list.removeItem(deleteConfirm.deleteTarget.id);
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Invoice deleted");
      deleteConfirm.cancelDelete();
    },
    onError: (err) => {
      toast.error("Failed to delete invoice", err.message);
      deleteConfirm.cancelDelete();
    },
  });

  function confirmDelete(id: string, number: string) {
    deleteConfirm.requestDelete(id, number);
  }

  function openPaymentPanel(partyId: string, invoiceId: string, balance: string) {
    setSelectedInvoiceId(null);
    setPaymentPanel({ partyId, invoiceId, balance });
  }

  async function exportInvoicesCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.invoice.list.fetch({
          type,
          status: (status || undefined) as any,
          search: debouncedSearch || undefined,
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
          page: pg,
          limit: 100,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Invoice #", "Date", "Party", "Status", "Total", "Paid", "Balance"];
      const rows = allData.map((inv: any) => [
        inv.invoiceNumber,
        formatDate(inv.invoiceDate),
        inv.partyName,
        inv.status,
        inv.totalAmount,
        inv.amountPaid,
        (parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid)).toFixed(2),
      ]);

      downloadCSV(`invoices_${dateRange.preset}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Manage sales and purchase invoices"
        actions={
          <div className="flex items-center gap-2">
            {posEnabled && (
              <a
                href="/pos"
                className="btn-secondary inline-flex items-center gap-2"
                title="Open the fullscreen cashier register in this tab"
              >
                <span aria-hidden="true">⚡</span>
                Switch to POS
              </a>
            )}
            {canCreate && (
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => setShowCreate(true)}
            >
              + New Invoice
              <KbdShortcut keys={["N"]} className="opacity-60" />
            </button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
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
      <DateRangeBar
        preset={dateRange.preset}
        onPresetChange={dateRange.setPreset}
        customFrom={dateRange.customFrom}
        customTo={dateRange.customTo}
        onCustomChange={dateRange.setCustomRange}
        onExport={exportInvoicesCSV}
        exporting={exporting}
        className="mb-4"
      />

      {/* Content */}
      {isLoading ? (
        <SkeletonRows count={6} height="h-14" />
      ) : !list.items.length && !isFetching ? (
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
          encouragement={!search && !status ? "Create your first invoice — it only takes a minute." : undefined}
          action={
            canCreate ? (
              <button
                className="btn-primary"
                onClick={() => setShowCreate(true)}
              >
                + New Invoice
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div
            ref={list.scrollRef}
            onScroll={list.onScroll}
            className="max-h-[600px] overflow-y-auto"
          >
            <table className="data-table w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Party</th>
                  <th
                    className="whitespace-nowrap cursor-pointer select-none hover:text-text-primary transition-colors"
                    onClick={() => {
                      if (sortBy === "number" && sortDir === "desc") setSortDir("asc");
                      else if (sortBy === "number" && sortDir === "asc") { setSortBy("date"); setSortDir("desc"); }
                      else { setSortBy("number"); setSortDir("desc"); }
                    }}
                  >
                    Invoice # {sortBy === "number" && <span className="text-brand-600">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                  <th className="whitespace-nowrap">Date</th>
                  <th className="whitespace-nowrap">Source</th>
                  <th className="whitespace-nowrap">Seller</th>
                  <th
                    className="text-right whitespace-nowrap cursor-pointer select-none hover:text-text-primary transition-colors"
                    onClick={() => {
                      if (sortBy === "amount" && sortDir === "desc") setSortDir("asc");
                      else if (sortBy === "amount" && sortDir === "asc") { setSortBy("date"); setSortDir("desc"); }
                      else { setSortBy("amount"); setSortDir("desc"); }
                    }}
                  >
                    Amount {sortBy === "amount" && <span className="text-brand-600">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                  <th>Status</th>
                  <th className="w-28"></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((inv) => (
                    <tr
                      key={inv.id}
                      className="group cursor-pointer"
                      onClick={() => setSelectedInvoiceId(inv.id)}
                    >
                      <td className="font-medium"><span className="block truncate max-w-[250px]">{inv.partyName}</span></td>
                      <td className="font-mono text-[13px] text-text-secondary whitespace-nowrap">
                        {inv.invoiceNumber}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap">
                        {formatDate(inv.invoiceDate)}
                      </td>
                      <td className="whitespace-nowrap">
                        <SourceChip source={(inv as { source?: string | null }).source ?? null} />
                      </td>
                      <td className="text-text-secondary whitespace-nowrap">
                        <span className="block truncate max-w-[140px]" title={inv.createdByName ?? ""}>
                          {inv.createdByName ?? "—"}
                        </span>
                      </td>
                      <td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {formatCurrency(inv.totalAmount)}
                      </td>
                      <td className="whitespace-nowrap">
                        <StatusBadge status={inv.status} size="sm" />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-0.5">
                          {/* PDF buttons — always visible, LEFT aligned */}
                          <DownloadPDFButton
                            invoiceId={inv.id}
                            invoiceNumber={inv.invoiceNumber}
                            invoiceStatus={inv.status}
                            onShared={() =>
                              updateStatus.mutate({ id: inv.id, status: "sent" })
                            }
                          />
                          {/* Context actions — always visible at reduced opacity, full on hover */}
                          <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
                            {(inv.status === "draft" || inv.status === "unfulfilled") && (
                              <button
                                onClick={() =>
                                  updateStatus.mutate({ id: inv.id, status: "sent" })
                                }
                                title={inv.status === "unfulfilled" ? "Mark fulfilled" : "Mark as sent"}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                                </svg>
                              </button>
                            )}
                            {inv.status !== "draft" &&
                              inv.status !== "cancelled" &&
                              inv.status !== "paid" &&
                              inv.status !== "adjusted" &&
                              (parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid) - parseFloat(inv.totalAdjusted || "0")) > 0.01 && (
                                <button
                                  onClick={() =>
                                    openPaymentPanel(
                                      inv.partyId,
                                      inv.id,
                                      (parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid) - parseFloat(inv.totalAdjusted || "0")).toFixed(2)
                                    )
                                  }
                                  title="Record payment"
                                  className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-600/[0.08] transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                                  </svg>
                                </button>
                              )}
                            {canDelete && (inv.status === "draft" || inv.status === "unfulfilled") && (
                              <button
                                onClick={() =>
                                  confirmDelete(inv.id, inv.invoiceNumber)
                                }
                                title="Delete invoice"
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
            {list.loadingMore && (
              <div className="border-t border-border-light">
                <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
                  <div className="h-3 bg-surface-2 rounded w-32" />
                  <div className="h-3 bg-surface-2 rounded w-20" />
                  <div className="h-3 bg-surface-2 rounded w-24" />
                  <div className="h-3 bg-surface-2 rounded w-16 ml-auto" />
                </div>
              </div>
            )}
            {list.hasMore && !list.loadingMore && (
              <button
                type="button"
                onClick={list.loadMore}
                className="w-full py-2.5 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:hover:bg-brand-950/20 border-t border-border-light transition-colors"
              >
                Load more
              </button>
            )}
            {!list.hasMore && list.items.length > PAGE_SIZE && (
              <div className="py-2 text-center text-xs text-text-tertiary border-t border-border-light">
                All {list.total.toLocaleString()} records loaded
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Invoice"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteConfirm.deleteTarget && deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id })}
        onCancel={deleteConfirm.cancelDelete}
      />

      {/* Document creator — new invoice.
          initialPartyId pre-fills the party picker when reopened after a creation,
          enabling quick "create another for the same customer" workflow. */}
      {showCreate && (
        <DocumentCreator
          documentType="invoice"
          invoiceType={type}
          initialPartyId={lastCreatedPartyId}
          onClose={() => setShowCreate(false)}
          onSuccess={(partyId) => setLastCreatedPartyId(partyId)}
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
        onIssueCN={(id, invType) => setCnSource({ id, type: invType })}
        onCreateSR={(id, invType) => setSrSource({ id, type: invType })}
      />

      {/* DocumentCreator pre-filled from source invoice for Credit Note */}
      {cnSource && (
        <DocumentCreator
          documentType="credit_note"
          invoiceType={cnSource.type}
          prefillFromInvoiceId={cnSource.id}
          onClose={() => setCnSource(null)}
        />
      )}

      {/* DocumentCreator pre-filled from source invoice for Sales Return */}
      {srSource && (
        <DocumentCreator
          documentType="sales_return"
          invoiceType={srSource.type}
          prefillFromInvoiceId={srSource.id}
          onClose={() => setSrSource(null)}
        />
      )}

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
