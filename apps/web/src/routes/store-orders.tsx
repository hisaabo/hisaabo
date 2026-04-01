import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PillTabs } from "@/components/ui/Tabs";

export const Route = createFileRoute("/store-orders")({
  component: StoreOrdersPage,
});

// ── Types ─────────────────────────────────────────────────────────

type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

interface LineItem {
  id: string;
  itemName: string;
  quantity: string | number;
  unitPrice: string;
  amount: string;
  unit?: string | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  status: OrderStatus;
  totalAmount: string;
  createdAt: Date;
  notes: string | null;
  cancelReason: string | null;
  lineItems: LineItem[];
  invoiceId: string | null;
  invoiceNumber: string | null;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  itemCount: number;
  totalAmount: string;
  status: OrderStatus;
  createdAt: Date;
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "preparing", label: "Preparing" },
  { value: "ready", label: "Ready" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; classes: string }
> = {
  pending: {
    label: "Pending",
    classes:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  },
  confirmed: {
    label: "Confirmed",
    classes:
      "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  },
  preparing: {
    label: "Preparing",
    classes:
      "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  },
  ready: {
    label: "Ready",
    classes:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  delivered: {
    label: "Delivered",
    classes:
      "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  },
  cancelled: {
    label: "Cancelled",
    classes:
      "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
};

// ── Status Badge ──────────────────────────────────────────────────

function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
        cfg.classes
      )}
    >
      {cfg.label}
    </span>
  );
}

// ── Status Timeline ───────────────────────────────────────────────

const TIMELINE_STEPS: Array<{ status: OrderStatus; label: string }> = [
  { status: "pending", label: "Order Placed" },
  { status: "confirmed", label: "Confirmed" },
  { status: "preparing", label: "Preparing" },
  { status: "ready", label: "Ready for Pickup" },
  { status: "delivered", label: "Delivered" },
];

function StatusTimeline({ current }: { current: OrderStatus }) {
  if (current === "cancelled") {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
        <span className="text-sm text-red-600 dark:text-red-400 font-medium">
          Order Cancelled
        </span>
      </div>
    );
  }

  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.status === current);

  return (
    <div className="relative">
      <div className="flex items-start gap-0">
        {TIMELINE_STEPS.map((step, idx) => {
          const isDone = idx < currentIndex;
          const isActive = idx === currentIndex;
          const isPending = idx > currentIndex;
          return (
            <div key={step.status} className="flex-1 flex flex-col items-center">
              <div className="relative flex items-center w-full">
                {/* Connector line before */}
                {idx > 0 && (
                  <div
                    className={cn(
                      "absolute left-0 right-1/2 top-1/2 -translate-y-1/2 h-0.5",
                      isDone || isActive
                        ? "bg-brand-500"
                        : "bg-border-light"
                    )}
                  />
                )}
                {/* Connector line after */}
                {idx < TIMELINE_STEPS.length - 1 && (
                  <div
                    className={cn(
                      "absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-0.5",
                      isDone ? "bg-brand-500" : "bg-border-light"
                    )}
                  />
                )}
                {/* Dot */}
                <div className="relative mx-auto z-10">
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full border-2",
                      isDone
                        ? "bg-brand-500 border-brand-500"
                        : isActive
                          ? "bg-white dark:bg-surface-0 border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900"
                          : "bg-surface-1 border-border-light"
                    )}
                  />
                </div>
              </div>
              <p
                className={cn(
                  "text-[10px] mt-1.5 text-center leading-tight",
                  isDone
                    ? "text-brand-600 dark:text-brand-400 font-medium"
                    : isActive
                      ? "text-text-primary font-semibold"
                      : "text-text-tertiary"
                )}
              >
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Order Detail Panel ────────────────────────────────────────────

interface OrderDetailPanelProps {
  orderId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

function OrderDetailPanel({ orderId, onClose, onUpdated }: OrderDetailPanelProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const utils = trpc.useUtils();

  const { data: order, isLoading } = trpc.store.getOrder.useQuery(
    { id: orderId! },
    { enabled: !!orderId }
  );

  const confirmOrder = trpc.store.confirmOrder.useMutation({
    onSuccess: () => {
      utils.store.listOrders.invalidate();
      if (orderId) utils.store.getOrder.invalidate({ id: orderId });
      toast.success("Order confirmed");
      onUpdated();
    },
    onError: (err) => toast.error("Failed to confirm order", err.message),
  });

  const updateStatus = trpc.store.updateOrderStatus.useMutation({
    onSuccess: () => {
      utils.store.listOrders.invalidate();
      if (orderId) utils.store.getOrder.invalidate({ id: orderId });
      toast.success("Order status updated");
      onUpdated();
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  const cancelOrder = trpc.store.cancelOrder.useMutation({
    onSuccess: () => {
      utils.store.listOrders.invalidate();
      if (orderId) utils.store.getOrder.invalidate({ id: orderId });
      toast.success("Order cancelled");
      setCancelOpen(false);
      setCancelReason("");
      onUpdated();
    },
    onError: (err) => toast.error("Failed to cancel order", err.message),
  });

  if (!orderId) return null;

  const o = order as OrderDetail | null | undefined;
  const isMutating =
    confirmOrder.isPending || updateStatus.isPending || cancelOrder.isPending;

  const nextStatusTransition: Partial<
    Record<OrderStatus, { label: string; status: "preparing" | "ready" | "delivered"; color: string }>
  > = {
    confirmed: {
      label: "Mark Preparing",
      status: "preparing",
      color:
        "text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 border-indigo-200 dark:border-indigo-800",
    },
    preparing: {
      label: "Mark Ready",
      status: "ready",
      color:
        "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border-emerald-200 dark:border-emerald-800",
    },
    ready: {
      label: "Mark Delivered",
      status: "delivered",
      color:
        "text-green-600 hover:bg-green-50 dark:hover:bg-green-950 border-green-200 dark:border-green-800",
    },
  };

  return (
    <>
      <SlideOver
        open={!!orderId}
        onClose={onClose}
        title={isLoading ? "Loading…" : o ? `Order ${o.orderNumber}` : "Order"}
        description={o ? `${o.customerName}${o.customerPhone ? ` · ${o.customerPhone}` : ""}` : undefined}
        footer={
          o && o.status !== "delivered" && o.status !== "cancelled" ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setCancelOpen(true)}
                  disabled={isMutating}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 border border-red-200 dark:border-red-800 transition-colors disabled:opacity-50"
                >
                  Cancel Order
                </button>
              </div>
              <div className="flex gap-2">
                {o.status === "pending" && (
                  <button
                    onClick={() => confirmOrder.mutate({ orderId: o.id })}
                    disabled={isMutating}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    {confirmOrder.isPending ? "Confirming…" : "Confirm Order"}
                  </button>
                )}
                {nextStatusTransition[o.status] && (
                  <button
                    onClick={() =>
                      updateStatus.mutate({
                        orderId: o.id,
                        status: nextStatusTransition[o.status]!.status,
                      })
                    }
                    disabled={isMutating}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors disabled:opacity-50",
                      nextStatusTransition[o.status]!.color
                    )}
                  >
                    {updateStatus.isPending
                      ? "Updating…"
                      : nextStatusTransition[o.status]!.label}
                  </button>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="skeleton h-8 rounded-lg" />
            ))}
          </div>
        ) : !o ? (
          <p className="text-text-tertiary text-sm">Order not found.</p>
        ) : (
          <div className="space-y-5">
            {/* Status timeline */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-3">
                Order Progress
              </p>
              <StatusTimeline current={o.status} />
              {o.status === "cancelled" && o.cancelReason && (
                <p className="mt-2 text-xs text-text-tertiary">
                  Reason: {o.cancelReason}
                </p>
              )}
            </div>

            {/* Customer info */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Customer
              </p>
              <div className="card rounded-xl border border-border-light bg-surface-1 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-text-primary">
                    {o.customerName}
                  </p>
                  <OrderStatusBadge status={o.status} />
                </div>
                {o.customerPhone && (
                  <p className="text-sm text-text-secondary font-mono">
                    {o.customerPhone}
                  </p>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-border-light">
                  <span className="text-[11px] text-text-tertiary">Order Date</span>
                  <span className="text-xs text-text-secondary">
                    {formatDate(o.createdAt)}
                  </span>
                </div>
                {o.invoiceNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">Invoice</span>
                    <span className="text-xs font-mono text-brand-600">
                      {o.invoiceNumber}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Line items */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Items
              </p>
              <div className="card rounded-xl border border-border-light bg-surface-1 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-light bg-surface-2">
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide">
                        Item
                      </th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-medium text-text-tertiary uppercase tracking-wide">
                        Qty
                      </th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-medium text-text-tertiary uppercase tracking-wide">
                        Price
                      </th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-medium text-text-tertiary uppercase tracking-wide">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.lineItems.map((item) => (
                      <tr key={item.id} className="border-b border-border-light last:border-0">
                        <td className="px-4 py-3 font-medium text-text-primary">
                          {item.itemName}
                        </td>
                        <td className="px-4 py-3 text-center text-text-secondary tabular-nums">
                          {item.quantity}
                          {item.unit ? (
                            <span className="text-text-tertiary ml-0.5 text-[11px]">
                              {item.unit}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right text-text-secondary tabular-nums">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border-light bg-surface-2">
                      <td
                        colSpan={3}
                        className="px-4 py-3 text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wide"
                      >
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-text-primary tabular-nums">
                        {formatCurrency(o.totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Notes */}
            {o.notes && (
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">
                  Notes
                </p>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">
                  {o.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </SlideOver>

      {/* Cancel confirm dialog */}
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel Order"
        description={`Cancel order ${o?.orderNumber ?? ""}? This action cannot be undone.`}
        confirmLabel="Cancel Order"
        variant="danger"
        loading={cancelOrder.isPending}
        onConfirm={() =>
          orderId &&
          cancelOrder.mutate({
            orderId,
            reason: cancelReason.trim() || undefined,
          })
        }
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason("");
        }}
      >
        <div className="mt-3">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Reason (optional)
          </label>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={2}
            placeholder="e.g. Customer requested cancellation"
            className="w-full text-sm border border-border-light rounded-lg px-2.5 py-2 bg-surface-0 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
          />
        </div>
      </ConfirmDialog>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

function StoreOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inlineConfirmId, setInlineConfirmId] = useState<string | null>(null);
  const [inlineCancelId, setInlineCancelId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.store.listOrders.useQuery({
    status: (status || undefined) as OrderStatus | undefined,
    search: search.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const orders = (data?.data ?? []) as OrderRow[];

  const confirmOrder = trpc.store.confirmOrder.useMutation({
    onSuccess: () => {
      utils.store.listOrders.invalidate();
      toast.success("Order confirmed");
      setInlineConfirmId(null);
    },
    onError: (err) => {
      toast.error("Failed to confirm order", err.message);
      setInlineConfirmId(null);
    },
  });

  const cancelOrder = trpc.store.cancelOrder.useMutation({
    onSuccess: () => {
      utils.store.listOrders.invalidate();
      toast.success("Order cancelled");
      setInlineCancelId(null);
    },
    onError: (err) => {
      toast.error("Failed to cancel order", err.message);
      setInlineCancelId(null);
    },
  });

  const updateStatus = trpc.store.updateOrderStatus.useMutation({
    onSuccess: () => {
      utils.store.listOrders.invalidate();
      toast.success("Order status updated");
    },
    onError: (err) => toast.error("Failed to update status", err.message),
  });

  return (
    <div>
      <PageHeader
        title="Store Orders"
        description="Manage and track customer orders from your store"
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <PillTabs
          tabs={STATUS_TABS}
          value={status}
          onChange={(v) => {
            setStatus(v as OrderStatus | "");
            setPage(1);
          }}
        />
        <div className="ml-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search customer, order #…"
            className="h-8 rounded-lg border border-border-light bg-surface-0 px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-500 w-52"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton h-14 rounded-lg" />
          ))}
        </div>
      ) : !orders.length ? (
        <EmptyState
          icon={
            <svg
              className="w-6 h-6 text-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"
              />
            </svg>
          }
          title="No orders found"
          description={
            status
              ? `No ${STATUS_CONFIG[status as OrderStatus]?.label.toLowerCase() ?? status} orders${search ? ` matching "${search}"` : ""}.`
              : search
                ? `No orders matching "${search}".`
                : "No store orders have been placed yet."
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th className="whitespace-nowrap">Order #</th>
                <th>Customer</th>
                <th className="whitespace-nowrap">Phone</th>
                <th className="text-center">Items</th>
                <th className="text-right whitespace-nowrap">Total</th>
                <th>Status</th>
                <th className="whitespace-nowrap">Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="group cursor-pointer"
                  onClick={() => setSelectedId(order.id)}
                >
                  <td className="font-mono text-[13px] text-text-secondary whitespace-nowrap">
                    {order.orderNumber}
                  </td>
                  <td className="font-medium">
                    <span className="block truncate max-w-[180px]">
                      {order.customerName}
                    </span>
                  </td>
                  <td className="text-text-secondary font-mono text-[13px] whitespace-nowrap">
                    {order.customerPhone ?? "—"}
                  </td>
                  <td className="text-center tabular-nums text-text-secondary">
                    {order.itemCount}
                  </td>
                  <td className="text-right tabular-nums font-medium whitespace-nowrap">
                    {formatCurrency(order.totalAmount)}
                  </td>
                  <td className="whitespace-nowrap">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="text-text-secondary text-xs whitespace-nowrap">
                    {formatDate(order.createdAt)}
                  </td>
                  <td
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {order.status === "pending" && (
                        <button
                          onClick={() => setInlineConfirmId(order.id)}
                          className="text-xs px-2 py-1 rounded font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                        >
                          Confirm
                        </button>
                      )}
                      {order.status === "confirmed" && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({
                              orderId: order.id,
                              status: "preparing",
                            })
                          }
                          disabled={updateStatus.isPending}
                          className="text-xs px-2 py-1 rounded font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors disabled:opacity-50"
                        >
                          Preparing
                        </button>
                      )}
                      {order.status === "preparing" && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({
                              orderId: order.id,
                              status: "ready",
                            })
                          }
                          disabled={updateStatus.isPending}
                          className="text-xs px-2 py-1 rounded font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors disabled:opacity-50"
                        >
                          Ready
                        </button>
                      )}
                      {order.status === "ready" && (
                        <button
                          onClick={() =>
                            updateStatus.mutate({
                              orderId: order.id,
                              status: "delivered",
                            })
                          }
                          disabled={updateStatus.isPending}
                          className="text-xs px-2 py-1 rounded font-medium text-green-600 hover:bg-green-50 dark:hover:bg-green-950 transition-colors disabled:opacity-50"
                        >
                          Delivered
                        </button>
                      )}
                      {order.status !== "delivered" &&
                        order.status !== "cancelled" && (
                          <button
                            onClick={() => setInlineCancelId(order.id)}
                            className="text-xs px-2 py-1 rounded font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      <button
                        onClick={() => setSelectedId(order.id)}
                        className="text-xs px-2 py-1 rounded font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {data && data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border-light">
              <p className="text-xs text-text-tertiary">
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, data.total)} of{" "}
                {data.total.toLocaleString()} orders
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-xs px-2.5 py-1 rounded-lg border border-border-light text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * PAGE_SIZE >= data.total}
                  className="text-xs px-2.5 py-1 rounded-lg border border-border-light text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail panel */}
      <OrderDetailPanel
        orderId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={() => utils.store.listOrders.invalidate()}
      />

      {/* Inline confirm dialog */}
      <ConfirmDialog
        open={!!inlineConfirmId}
        title="Confirm Order"
        description="Confirm this order? The customer will be notified."
        confirmLabel="Confirm Order"
        variant="default"
        loading={confirmOrder.isPending}
        onConfirm={() =>
          inlineConfirmId &&
          confirmOrder.mutate({ orderId: inlineConfirmId })
        }
        onCancel={() => setInlineConfirmId(null)}
      />

      {/* Inline cancel dialog */}
      <ConfirmDialog
        open={!!inlineCancelId}
        title="Cancel Order"
        description="Cancel this order? This action cannot be undone."
        confirmLabel="Cancel Order"
        variant="danger"
        loading={cancelOrder.isPending}
        onConfirm={() =>
          inlineCancelId &&
          cancelOrder.mutate({ orderId: inlineCancelId })
        }
        onCancel={() => setInlineCancelId(null)}
      />
    </div>
  );
}
