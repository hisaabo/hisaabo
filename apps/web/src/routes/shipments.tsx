import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, downloadCSV, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DetailField } from "@/components/ui/DetailField";
import { LinkButton } from "@/components/ui/LinkButton";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { PillTabs } from "@/components/ui/Tabs";

export const Route = createFileRoute("/shipments")({
  component: ShipmentsPage,
});

// ── Types ─────────────────────────────────────────────────────────

type ShipmentStatus = "pending" | "shipped" | "in_transit" | "delivered" | "returned";
type _ShipmentMode = "hand_delivery" | "courier" | "transport" | "post";

interface ShipmentRow {
  id: string;
  invoiceId: string | null;
  partyId: string | null;
  carrier: string | null;
  mode: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  cost: string;
  weight: string | null;
  status: ShipmentStatus;
  shipmentDate: Date | null;
  estimatedDelivery: Date | null;
  actualDelivery: Date | null;
  notes: string | null;
  createdAt: Date;
  invoiceNumber: string | null;
  partyName: string | null;
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "shipped", label: "Shipped" },
  { value: "in_transit", label: "In Transit" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
];

const MODE_LABELS: Record<string, string> = {
  hand_delivery: "Self/Driver",
  courier: "Courier",
  transport: "Transport",
  post: "Post",
};

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "hand_delivery", label: "Self/Driver" },
  { value: "courier", label: "Courier" },
  { value: "transport", label: "Transport" },
  { value: "post", label: "Post" },
];

const PAGE_SIZE = 20;

// ── Status badge ──────────────────────────────────────────────────

function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const cfg: Record<ShipmentStatus, string> = {
    pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    shipped: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    in_transit: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
    delivered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    returned: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  };
  const labels: Record<ShipmentStatus, string> = {
    pending: "Pending",
    shipped: "Shipped",
    in_transit: "In Transit",
    delivered: "Delivered",
    returned: "Returned",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", cfg[status])}>
      {labels[status]}
    </span>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────

interface ShipmentDetailPanelProps {
  shipmentId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

function ShipmentDetailPanel({ shipmentId, onClose, onUpdated }: ShipmentDetailPanelProps) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Editable fields
  const [editCarrier, setEditCarrier] = useState("");
  const [editMode, setEditMode] = useState("");
  const [editTracking, setEditTracking] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editEstDelivery, setEditEstDelivery] = useState("");

  const utils = trpc.useUtils();

  const { data: shipment, isLoading } = trpc.shipment.getById.useQuery(
    { id: shipmentId! },
    { enabled: !!shipmentId }
  );

  // Populate edit fields when shipment loads or the panel switches to a different record
  useEffect(() => {
    if (shipment) {
      setEditCarrier(shipment.carrier ?? "");
      setEditMode(shipment.mode ?? "");
      setEditTracking(shipment.trackingNumber ?? "");
      setEditNotes(shipment.notes ?? "");
      setEditEstDelivery(
        shipment.estimatedDelivery
          ? new Date(shipment.estimatedDelivery).toISOString().split("T")[0]
          : ""
      );
    }
  }, [shipment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = trpc.shipment.update.useMutation({
    onSuccess: () => {
      utils.shipment.list.invalidate();
      if (shipmentId) utils.shipment.getById.invalidate({ id: shipmentId });
      toast.success("Shipment updated");
      setEditing(false);
      onUpdated();
    },
    onError: (err) => toast.error("Failed to update shipment", err.message),
  });

  const deleteMutation = trpc.shipment.delete.useMutation({
    onSuccess: () => {
      utils.shipment.list.invalidate();
      toast.success("Shipment deleted");
      setDeleteOpen(false);
      onClose();
      onUpdated();
    },
    onError: (err) => toast.error("Failed to delete shipment", err.message),
  });

  function saveEdit() {
    if (!shipmentId) return;
    updateMutation.mutate({
      id: shipmentId,
      carrier: editCarrier || undefined,
      mode: editMode || undefined,
      trackingNumber: editTracking || undefined,
      notes: editNotes || undefined,
      estimatedDelivery: editEstDelivery
        ? new Date(editEstDelivery).toISOString()
        : undefined,
    });
  }

  function markStatus(newStatus: ShipmentStatus) {
    if (!shipmentId) return;
    const extra: { shipmentDate?: string; actualDelivery?: string } = {};
    if (newStatus === "shipped" || newStatus === "in_transit") {
      extra.shipmentDate = new Date().toISOString();
    }
    if (newStatus === "delivered") {
      extra.actualDelivery = new Date().toISOString();
    }
    updateMutation.mutate({ id: shipmentId, status: newStatus, ...extra });
  }

  if (!shipmentId) return null;

  const s = shipment as (ShipmentRow & { businessId: string; shippingAddress: string | null; shippingCity: string | null; shippingPincode: string | null; updatedAt: Date }) | null | undefined;

  return (
    <>
      <SlideOver
        open={!!shipmentId}
        onClose={onClose}
        title={isLoading ? "Loading…" : s ? `Shipment` : "Shipment"}
        description={s ? `${s.partyName ?? ""} — ${s.invoiceNumber ?? ""}` : undefined}
        footer={
          s ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={saveEdit}
                      disabled={updateMutation.isPending}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
                    >
                      {updateMutation.isPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 border border-red-200 dark:border-red-800 transition-colors"
                >
                  Delete
                </button>
              </div>
              <div className="flex gap-2">
                {s.status === "pending" && (
                  <button
                    onClick={() => markStatus("shipped")}
                    disabled={updateMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 border border-blue-200 dark:border-blue-800 transition-colors disabled:opacity-50"
                  >
                    Mark Shipped
                  </button>
                )}
                {s.status === "shipped" && (
                  <button
                    onClick={() => markStatus("in_transit")}
                    disabled={updateMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950 border border-purple-200 dark:border-purple-800 transition-colors disabled:opacity-50"
                  >
                    Mark In Transit
                  </button>
                )}
                {(s.status === "shipped" || s.status === "in_transit") && (
                  <button
                    onClick={() => markStatus("delivered")}
                    disabled={updateMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 transition-colors disabled:opacity-50"
                  >
                    Mark Delivered
                  </button>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {isLoading ? (
          <SkeletonRows count={6} height="h-8" className="space-y-3 animate-pulse" />
        ) : !s ? (
          <p className="text-text-tertiary text-sm">Shipment not found.</p>
        ) : (
          <div className="space-y-5">
            {/* Status + Invoice link */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <DetailField label="Status">
                  <ShipmentStatusBadge status={s.status} />
                </DetailField>
                <DetailField label="Party">
                  <p className="font-semibold text-text-primary">{s.partyName ?? "—"}</p>
                </DetailField>
              </div>
              <div className="space-y-3">
                <DetailField label="Invoice">
                  {s.invoiceNumber ? (
                    <LinkButton
                      className="font-mono"
                      onClick={() => {
                        onClose();
                        navigate({ to: "/invoices", search: { selected: s.invoiceId! } } as any);
                      }}
                    >
                      {s.invoiceNumber}
                    </LinkButton>
                  ) : (
                    <p className="text-text-tertiary">—</p>
                  )}
                </DetailField>
                <DetailField label="Date">
                  <p>{formatDate(s.shipmentDate ?? s.createdAt)}</p>
                </DetailField>
              </div>
            </div>

            {/* Carrier / Mode / Tracking */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">Shipping Details</p>
              <div className="card rounded-xl border border-border-light bg-surface-1 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] text-text-tertiary mb-1">Carrier</p>
                    {editing ? (
                      <input
                        type="text"
                        value={editCarrier}
                        onChange={(e) => setEditCarrier(e.target.value)}
                        placeholder="e.g. delhivery"
                        className="w-full text-sm border border-border-light rounded-lg px-2.5 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    ) : (
                      <p className="text-sm text-text-primary capitalize">{s.carrier?.replace(/_/g, " ") ?? "—"}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] text-text-tertiary mb-1">Mode</p>
                    {editing ? (
                      <select
                        value={editMode}
                        onChange={(e) => setEditMode(e.target.value)}
                        className="w-full text-sm border border-border-light rounded-lg px-2.5 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="">Select mode</option>
                        {MODE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm text-text-primary">{MODE_LABELS[s.mode ?? ""] ?? s.mode ?? "—"}</p>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-text-tertiary mb-1">Tracking Number</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editTracking}
                      onChange={(e) => setEditTracking(e.target.value)}
                      placeholder="Tracking number"
                      className="w-full text-sm border border-border-light rounded-lg px-2.5 py-1.5 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  ) : s.trackingUrl ? (
                    <a
                      href={s.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-mono text-brand-600 hover:underline"
                    >
                      {s.trackingNumber ?? "—"}
                    </a>
                  ) : (
                    <p className="text-sm font-mono text-text-primary">{s.trackingNumber ?? "—"}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Dates */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">Dates</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] text-text-tertiary mb-1">Shipped</p>
                  <p className="text-sm text-text-primary">{s.shipmentDate ? formatDate(s.shipmentDate) : "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-tertiary mb-1">Est. Delivery</p>
                  {editing ? (
                    <input
                      type="date"
                      value={editEstDelivery}
                      onChange={(e) => setEditEstDelivery(e.target.value)}
                      className="w-full text-xs border border-border-light rounded-lg px-2 py-1 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  ) : (
                    <p className="text-sm text-text-primary">{s.estimatedDelivery ? formatDate(s.estimatedDelivery) : "—"}</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-text-tertiary mb-1">Delivered</p>
                  <p className="text-sm text-text-primary">{s.actualDelivery ? formatDate(s.actualDelivery) : "—"}</p>
                </div>
              </div>
            </div>

            {/* Cost + Weight */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Shipping Cost</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">{formatCurrency(s.cost)}</p>
              </div>
              {s.weight && (
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-0.5">Weight</p>
                  <p className="text-sm text-text-primary">{s.weight} kg</p>
                </div>
              )}
            </div>

            {/* Shipping address */}
            {(s.shippingAddress || s.shippingCity || s.shippingPincode) && (
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Shipping Address</p>
                <p className="text-sm text-text-secondary">
                  {[s.shippingAddress, s.shippingCity, s.shippingPincode].filter(Boolean).join(", ")}
                </p>
              </div>
            )}

            {/* Notes */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Notes</p>
              {editing ? (
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes about this shipment"
                  className="w-full text-sm border border-border-light rounded-lg px-2.5 py-2 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                />
              ) : (
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{s.notes || "—"}</p>
              )}
            </div>
          </div>
        )}
      </SlideOver>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete Shipment"
        description="Delete this shipment record? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => shipmentId && deleteMutation.mutate({ id: shipmentId })}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────

function ShipmentsPage() {
  const [status, setStatus] = useState<ShipmentStatus | "">("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useHotkeys([]);

  const utils = trpc.useUtils();

  const loadMore = useCallback(() => setPage((p) => p + 1), []);

  const { data, isFetching, isLoading } = trpc.shipment.list.useQuery({
    status: (status || undefined) as ShipmentStatus | undefined,
    page,
    limit: PAGE_SIZE,
  }, {
    placeholderData: (prev) => prev,
  });

  const list = useInfiniteList({
    key: "shipments",
    data: data?.data as ShipmentRow[] | undefined,
    total: data?.total ?? 0,
    page,
    isFetching,
    onLoadMore: loadMore,
    resetDeps: [status],
  });

  async function exportCSV() {
    setExporting(true);
    try {
      let all: ShipmentRow[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.shipment.list.fetch({
          status: (status || undefined) as ShipmentStatus | undefined,
          page: pg,
          limit: 100,
        });
        all = [...all, ...(result.data as ShipmentRow[])];
        hasMore = all.length < result.total;
        pg++;
      }

      const headers = ["Date", "Invoice #", "Party", "Mode", "Carrier", "Tracking #", "Cost", "Status"];
      const rows = all.map((s) => [
        formatDate(s.shipmentDate ?? s.createdAt),
        s.invoiceNumber ?? "",
        s.partyName ?? "",
        MODE_LABELS[s.mode ?? ""] ?? s.mode ?? "",
        s.carrier ?? "",
        s.trackingNumber ?? "",
        s.cost,
        s.status,
      ]);

      downloadCSV("shipments", headers, rows);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Shipments"
        description="Track and manage your outgoing shipments"
        actions={
          <button
            onClick={exportCSV}
            disabled={exporting}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
      />

      {/* Status filter */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <PillTabs
          tabs={STATUS_TABS}
          value={status}
          onChange={(v) => { setStatus(v as ShipmentStatus | ""); setPage(1); }}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <SkeletonRows count={6} height="h-14" />
      ) : !list.items.length && !isFetching ? (
        <EmptyState
          icon={
            <svg className="w-6 h-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
            </svg>
          }
          title="No shipments found"
          description={status ? `No shipments with status "${status}".` : "No shipments have been created yet."}
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
                  <th className="whitespace-nowrap">Date</th>
                  <th className="whitespace-nowrap">Invoice #</th>
                  <th>Party</th>
                  <th>Mode</th>
                  <th>Carrier</th>
                  <th>Tracking #</th>
                  <th className="text-right whitespace-nowrap">Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((s) => (
                  <tr
                    key={s.id}
                    className="group cursor-pointer"
                    onClick={() => setSelectedId(s.id)}
                  >
                    <td className="text-text-secondary whitespace-nowrap text-xs">
                      {formatDate(s.shipmentDate ?? s.createdAt)}
                    </td>
                    <td className="font-mono text-[13px] text-text-secondary whitespace-nowrap">
                      {s.invoiceNumber ?? "—"}
                    </td>
                    <td className="font-medium">
                      <span className="block truncate max-w-[200px]">{s.partyName ?? "—"}</span>
                    </td>
                    <td className="text-text-secondary text-xs">
                      {MODE_LABELS[s.mode ?? ""] ?? s.mode ?? "—"}
                    </td>
                    <td className="text-text-secondary text-xs capitalize">
                      {s.carrier?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="text-xs" onClick={(e) => e.stopPropagation()}>
                      {s.trackingUrl ? (
                        <a
                          href={s.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-brand-600 hover:underline"
                        >
                          {s.trackingNumber ?? "—"}
                        </a>
                      ) : (
                        <span className="font-mono text-text-secondary">{s.trackingNumber ?? "—"}</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatCurrency(s.cost)}
                    </td>
                    <td className="whitespace-nowrap">
                      <ShipmentStatusBadge status={s.status} />
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

      {/* Detail panel */}
      <ShipmentDetailPanel
        shipmentId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={() => {
          utils.shipment.list.invalidate();
        }}
      />
    </div>
  );
}
