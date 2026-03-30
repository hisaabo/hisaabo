import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/ui/Modal";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency, formatDate, formatDateInput } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────

type TargetType = "order_count" | "order_value" | "item_quantity";
type PeriodType = "daily" | "weekly" | "monthly" | "quarterly" | "custom";

interface TargetProgress {
  current: number;
  target: number;
  percentage: number;
  remaining: number;
  unit: string;
  onTrack: boolean;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

interface SalesTarget {
  id: string;
  userId: string;
  targetType: string;
  targetValue: string;
  itemId: string | null;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  notes: string | null;
  createdAt: Date;
  progress?: TargetProgress;
}

// ── Option constants ───────────────────────────────────────────

const TARGET_TYPE_OPTIONS = [
  { value: "order_count", label: "Order Count", description: "Number of sale invoices" },
  { value: "order_value", label: "Order Value", description: "Total invoice amount in ₹" },
  { value: "item_quantity", label: "Item Quantity", description: "Units sold for a specific item" },
];

const PERIOD_TYPE_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "custom", label: "Custom range" },
];

// ── Utility helpers ────────────────────────────────────────────

function getDefaultPeriodDates(periodType: PeriodType): { start: string; end: string } {
  const now = new Date();
  const today = formatDateInput(now);

  switch (periodType) {
    case "daily": {
      return { start: today, end: today };
    }
    case "weekly": {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return { start: formatDateInput(startOfWeek), end: formatDateInput(endOfWeek) };
    }
    case "monthly": {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: formatDateInput(startOfMonth), end: formatDateInput(endOfMonth) };
    }
    case "quarterly": {
      const quarter = Math.floor(now.getMonth() / 3);
      const startOfQ = new Date(now.getFullYear(), quarter * 3, 1);
      const endOfQ = new Date(now.getFullYear(), quarter * 3 + 3, 0);
      return { start: formatDateInput(startOfQ), end: formatDateInput(endOfQ) };
    }
    case "custom":
    default:
      return { start: today, end: today };
  }
}

function formatTargetValue(target: SalesTarget): string {
  if (target.targetType === "order_value") {
    return formatCurrency(target.targetValue);
  }
  const suffix = target.targetType === "order_count" ? " orders" : " units";
  return `${parseFloat(target.targetValue).toLocaleString("en-IN")}${suffix}`;
}

function ProgressBar({
  percentage,
  onTrack,
  className,
}: {
  percentage: number;
  onTrack: boolean;
  className?: string;
}) {
  return (
    <div className={cn("h-1.5 bg-surface-3 rounded-full overflow-hidden", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          percentage >= 100
            ? "bg-emerald-500"
            : onTrack
              ? "bg-brand-500"
              : "bg-amber-500",
        )}
        style={{ width: `${Math.min(100, percentage)}%` }}
      />
    </div>
  );
}

// ── Target card ────────────────────────────────────────────────

function TargetCard({
  target,
  memberName,
  onEdit,
  onDelete,
  canManage,
}: {
  target: SalesTarget;
  memberName: string;
  onEdit: (t: SalesTarget) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  const progress = target.progress;
  const isExpired = new Date(target.periodEnd) < new Date();

  return (
    <div className="card px-4 py-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{memberName}</span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium",
                isExpired
                  ? "bg-surface-2 text-text-tertiary"
                  : "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400",
              )}
            >
              {target.periodType}
            </span>
            {isExpired && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-text-tertiary">
                ended
              </span>
            )}
          </div>
          <p className="text-xs text-text-tertiary mt-0.5">
            {TARGET_TYPE_OPTIONS.find((o) => o.value === target.targetType)?.label} &bull;{" "}
            {formatDate(target.periodStart)} – {formatDate(target.periodEnd)}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="btn-icon w-7 h-7"
              title="Edit target"
              onClick={() => onEdit(target)}
            >
              <PencilIcon />
            </button>
            <button
              className="btn-icon w-7 h-7 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Delete target"
              onClick={() => onDelete(target.id)}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>

      {/* Progress section */}
      {progress ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {progress.unit === "₹"
                ? formatCurrency(String(progress.current))
                : `${progress.current.toLocaleString("en-IN")} ${progress.unit}`}{" "}
              <span className="text-text-tertiary">
                / {formatTargetValue(target)}
              </span>
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                progress.percentage >= 100
                  ? "text-emerald-600"
                  : progress.onTrack
                    ? "text-brand-600"
                    : "text-amber-600",
              )}
            >
              {progress.percentage}%
            </span>
          </div>
          <ProgressBar
            percentage={progress.percentage}
            onTrack={progress.onTrack}
          />
          <div className="flex items-center justify-between text-[11px] text-text-tertiary">
            {progress.percentage >= 100 ? (
              <span className="text-emerald-600 font-medium">Target achieved</span>
            ) : (
              <span>
                {progress.unit === "₹"
                  ? formatCurrency(String(progress.remaining))
                  : `${progress.remaining.toLocaleString("en-IN")} ${progress.unit}`}{" "}
                remaining
              </span>
            )}
            {!isExpired && (
              <span>
                {progress.daysRemaining === 0
                  ? "Last day"
                  : `${progress.daysRemaining}d left`}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">Target: {formatTargetValue(target)}</p>
      )}

      {target.notes && (
        <p className="text-xs text-text-secondary border-t border-border-light pt-2">{target.notes}</p>
      )}
    </div>
  );
}

// ── Create / Edit modal ────────────────────────────────────────

function TargetFormModal({
  open,
  onClose,
  editTarget,
  members,
}: {
  open: boolean;
  onClose: () => void;
  editTarget: SalesTarget | null;
  members: Array<{ userId: string; userName: string | null; userEmail: string }>;
}) {
  const utils = trpc.useUtils();

  const [userId, setUserId] = useState(editTarget?.userId ?? "");
  const [targetType, setTargetType] = useState<TargetType>(
    (editTarget?.targetType as TargetType) ?? "order_value",
  );
  const [targetValue, setTargetValue] = useState(
    editTarget ? parseFloat(editTarget.targetValue).toString() : "",
  );
  const [itemId, setItemId] = useState(editTarget?.itemId ?? "");
  const [periodType, setPeriodType] = useState<PeriodType>(
    (editTarget?.periodType as PeriodType) ?? "monthly",
  );
  const defaultDates = getDefaultPeriodDates("monthly");
  const [periodStart, setPeriodStart] = useState(
    editTarget ? formatDateInput(new Date(editTarget.periodStart)) : defaultDates.start,
  );
  const [periodEnd, setPeriodEnd] = useState(
    editTarget ? formatDateInput(new Date(editTarget.periodEnd)) : defaultDates.end,
  );
  const [notes, setNotes] = useState(editTarget?.notes ?? "");

  const { data: items } = trpc.item.list.useQuery(
    { page: 1, limit: 100 },
    { enabled: open && targetType === "item_quantity" },
  );

  const createMutation = trpc.target.create.useMutation({
    onSuccess: () => {
      toast.success("Target created");
      utils.target.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error("Failed to create target", err.message),
  });

  const updateMutation = trpc.target.update.useMutation({
    onSuccess: () => {
      toast.success("Target updated");
      utils.target.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error("Failed to update target", err.message),
  });

  function handlePeriodTypeChange(pt: PeriodType) {
    setPeriodType(pt);
    if (pt !== "custom") {
      const dates = getDefaultPeriodDates(pt);
      setPeriodStart(dates.start);
      setPeriodEnd(dates.end);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!userId) {
      toast.error("Select a seller");
      return;
    }

    const startIso = new Date(periodStart + "T00:00:00").toISOString();
    const endIso = new Date(periodEnd + "T23:59:59").toISOString();

    if (editTarget) {
      updateMutation.mutate({
        id: editTarget.id,
        targetValue,
        itemId: targetType === "item_quantity" && itemId ? itemId : null,
        periodType,
        periodStart: startIso,
        periodEnd: endIso,
        notes: notes || null,
      });
    } else {
      createMutation.mutate({
        userId,
        targetType,
        targetValue,
        itemId: targetType === "item_quantity" && itemId ? itemId : null,
        periodType,
        periodStart: startIso,
        periodEnd: endIso,
        notes: notes || null,
      });
    }
  }

  const memberOptions = members.map((m) => ({
    value: m.userId,
    label: m.userName || m.userEmail,
  }));

  const itemOptions = (items?.data ?? []).map((item) => ({
    value: item.id,
    label: item.name,
    description: item.sku ?? undefined,
  }));

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editTarget ? "Edit Target" : "Set Sales Target"}
    >
      <form onSubmit={handleSubmit} className="space-y-4 py-1">
        {!editTarget && (
          <Listbox
            label="Seller"
            required
            value={userId}
            onChange={setUserId}
            options={memberOptions}
            placeholder="Select seller"
          />
        )}

        {!editTarget && (
          <Listbox
            label="Target type"
            required
            value={targetType}
            onChange={(v) => setTargetType(v as TargetType)}
            options={TARGET_TYPE_OPTIONS}
          />
        )}

        {targetType === "item_quantity" && (
          <Listbox
            label="Item"
            required
            value={itemId}
            onChange={setItemId}
            options={itemOptions}
            placeholder="Select item"
          />
        )}

        <div>
          <label className="label">
            Target value
            {targetType === "order_value" && " (₹)"}
            {targetType === "order_count" && " (orders)"}
            {targetType === "item_quantity" && " (units)"}
            <span className="ml-0.5 text-red-600">*</span>
          </label>
          <input
            type="number"
            className="input"
            required
            min="1"
            step="any"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder={
              targetType === "order_value"
                ? "500000"
                : targetType === "order_count"
                  ? "50"
                  : "1000"
            }
          />
        </div>

        <Listbox
          label="Period"
          required
          value={periodType}
          onChange={(v) => handlePeriodTypeChange(v as PeriodType)}
          options={PERIOD_TYPE_OPTIONS}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">
              Start date <span className="text-red-600">*</span>
            </label>
            <input
              type="date"
              className="input"
              required
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              End date <span className="text-red-600">*</span>
            </label>
            <input
              type="date"
              className="input"
              required
              value={periodEnd}
              min={periodStart}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input resize-none"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Focus on enterprise accounts this quarter"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={isPending}
          >
            {isPending
              ? editTarget
                ? "Saving..."
                : "Creating..."
              : editTarget
                ? "Save Changes"
                : "Create Target"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main tab component ─────────────────────────────────────────

export function SalesTargetsTab() {
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<SalesTarget | null>(null);
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const utils = trpc.useUtils();

  const { data: session } = trpc.auth.me.useQuery();
  const { data: members } = trpc.tenant.members.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });
  const { data: targets, isLoading } = trpc.target.list.useQuery({
    userId: filterUserId !== "all" ? filterUserId : undefined,
    active: showActiveOnly || undefined,
    withProgress: true,
  });

  const deleteMutation = trpc.target.delete.useMutation({
    onSuccess: () => {
      toast.success("Target deleted");
      utils.target.list.invalidate();
    },
    onError: (err) => toast.error("Failed to delete target", err.message),
  });

  const { data: me } = trpc.auth.me.useQuery();
  const callerMember = members?.find((m) => m.userEmail === me?.user?.email);
  const canManage =
    callerMember?.role === "owner" ||
    callerMember?.role === "superadmin" ||
    callerMember?.role === "admin" ||
    callerMember?.role === "seller_manager";

  // Only show sellers and seller managers in the member filter (admins set targets for them)
  const sellerMembers = (members ?? []).filter(
    (m) => m.role === "seller" || m.role === "seller_manager" || m.role === "member",
  );

  function getMemberName(userId: string) {
    const m = members?.find((mb) => mb.userId === userId);
    return m?.userName || m?.userEmail || "Unknown";
  }

  function handleDelete(id: string) {
    if (window.confirm("Delete this target? This cannot be undone.")) {
      deleteMutation.mutate({ id });
    }
  }

  function handleEdit(t: SalesTarget) {
    setEditTarget(t);
    setShowForm(true);
  }

  function handleClose() {
    setShowForm(false);
    setEditTarget(null);
  }

  const memberFilterOptions = [
    { value: "all", label: "All sellers" },
    ...sellerMembers.map((m) => ({
      value: m.userId,
      label: m.userName || m.userEmail,
    })),
  ];

  const typedTargets = (targets ?? []) as SalesTarget[];

  return (
    <>
      <div className="card overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border-light">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Sales Targets</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Set and track performance targets for your sales team
            </p>
          </div>
          {canManage && (
            <button
              className="btn-primary btn-sm"
              onClick={() => {
                setEditTarget(null);
                setShowForm(true);
              }}
            >
              + Set Target
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-border-light flex items-center gap-3 flex-wrap">
          <div className="w-48">
            <Listbox
              value={filterUserId}
              onChange={setFilterUserId}
              options={memberFilterOptions}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded border-border accent-brand-600"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
            />
            <span className="text-xs text-text-secondary">Active only</span>
          </label>
        </div>

        {/* Targets list */}
        <div className="px-6 py-4">
          {isLoading ? (
            <div className="space-y-3">
              <div className="skeleton h-20 rounded-lg" />
              <div className="skeleton h-20 rounded-lg" />
            </div>
          ) : typedTargets.length === 0 ? (
            <div className="py-8 text-center">
              <TargetIcon className="w-8 h-8 mx-auto text-text-tertiary mb-3" />
              <p className="text-sm text-text-secondary">No targets set</p>
              {canManage && (
                <p className="text-xs text-text-tertiary mt-1">
                  Click "Set Target" to assign goals to your sales team
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {typedTargets.map((t) => (
                <TargetCard
                  key={t.id}
                  target={t}
                  memberName={getMemberName(t.userId)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  canManage={canManage}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TargetFormModal
        open={showForm}
        onClose={handleClose}
        editTarget={editTarget}
        members={sellerMembers}
      />
    </>
  );
}

// ── Icons ──────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}

function TargetIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
