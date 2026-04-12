import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDate, cn } from "@/lib/utils";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Listbox } from "@/components/ui/Listbox";
import { InputField } from "@/components/ui/FormField";
import { Spinner } from "@/components/ui/Spinner";

export const Route = createFileRoute("/eway-bills")({
  component: EWayBillsPage,
});

// ── Types & Constants ─────────────────────────────────────────────────────────

type EWBTab = "dashboard" | "expiring";

type EWBRow = {
  id: string;
  ewbNumber: string | null;
  ewbDate: string | Date | null;
  validUpto: string | Date | null;
  status: string;
  transportMode: string | null;
  vehicleNumber: string | null;
  distance: number | null;
  fromState?: string | null;
  toState?: string | null;
  cancelReason?: string | null;
  createdAt?: string | Date | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate?: string | Date | null;
  partyName: string | null;
};

type DashboardData = {
  data: EWBRow[];
  total: number;
  page: number;
  limit: number;
  summary: Record<string, number>;
};

const TRANSPORT_MODE_OPTIONS = [
  { value: "road", label: "Road" },
  { value: "rail", label: "Rail" },
  { value: "air", label: "Air" },
  { value: "ship", label: "Ship" },
];

const VEHICLE_TYPE_OPTIONS = [
  { value: "regular", label: "Regular" },
  { value: "over_dimensional", label: "Over Dimensional Cargo" },
];

const CANCEL_REASON_OPTIONS = [
  { value: "Data Entry Mistake", label: "Data Entry Mistake" },
  { value: "Order Cancelled", label: "Order Cancelled" },
  { value: "Others", label: "Others" },
];

const UPDATE_REASON_OPTIONS = [
  { value: "breakdown", label: "Breakdown" },
  { value: "transshipment", label: "Transshipment" },
  { value: "first_time", label: "First Time" },
  { value: "others", label: "Others" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "generated", label: "Generated" },
  { value: "active", label: "Active" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadgeColor(status: string): string {
  switch (status) {
    case "generated":
      return badgeColor("blue");
    case "active":
      return badgeColor("emerald");
    case "cancelled":
      return badgeColor("red");
    case "expired":
      return badgeColor("amber");
    default:
      return badgeColorFallback;
  }
}

function transportModeLabel(mode: string | null): string {
  switch (mode) {
    case "road": return "Road";
    case "rail": return "Rail";
    case "air":  return "Air";
    case "ship": return "Ship";
    default:     return mode ?? "—";
  }
}

/**
 * Returns how many hours remain until `validUpto`.
 * Negative means already expired.
 */
function hoursUntil(date: Date): number {
  return (date.getTime() - Date.now()) / (1000 * 60 * 60);
}

function validityColor(validUpto: Date | null | string | undefined): string {
  if (!validUpto) return "";
  const d = validUpto instanceof Date ? validUpto : new Date(validUpto);
  const h = hoursUntil(d);
  if (h < 0) return "text-red-600";
  if (h < 24) return "text-amber-600";
  return "text-emerald-600";
}

// ── Generate EWB form state ───────────────────────────────────────────────────

type GenerateFormState = {
  invoiceId: string;
  vehicleNumber: string;
  vehicleType: string;
  transportMode: string;
  distance: string;
  transporterId: string;
  transporterName: string;
  fromAddress: string;
  fromPincode: string;
  toAddress: string;
  toPincode: string;
};

const EMPTY_GENERATE_FORM: GenerateFormState = {
  invoiceId: "",
  vehicleNumber: "",
  vehicleType: "regular",
  transportMode: "road",
  distance: "",
  transporterId: "",
  transporterName: "",
  fromAddress: "",
  fromPincode: "",
  toAddress: "",
  toPincode: "",
};

// ── Update vehicle form state ─────────────────────────────────────────────────

type UpdateVehicleFormState = {
  vehicleNumber: string;
  fromPlace: string;
  reason: string;
};

const EMPTY_UPDATE_FORM: UpdateVehicleFormState = {
  vehicleNumber: "",
  fromPlace: "",
  reason: "others",
};

// ── Main Page ─────────────────────────────────────────────────────────────────

function EWayBillsPage() {
  const [activeTab, setActiveTab] = useState<EWBTab>("dashboard");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  // Modals
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState<GenerateFormState>(EMPTY_GENERATE_FORM);
  const [generateErrors, setGenerateErrors] = useState<Partial<GenerateFormState>>({});

  const [updateVehicleEwbId, setUpdateVehicleEwbId] = useState<string | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateVehicleFormState>(EMPTY_UPDATE_FORM);
  const [updateErrors, setUpdateErrors] = useState<Partial<UpdateVehicleFormState>>({});

  const [cancelEwbId, setCancelEwbId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("Data Entry Mistake");

  const [detailEwbId, setDetailEwbId] = useState<string | null>(null);

  const tabs: Array<{ value: EWBTab; label: string }> = [
    { value: "dashboard", label: "All E-Way Bills" },
    { value: "expiring", label: "Expiring Soon" },
  ];

  const utils = trpc.useUtils();

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: dashboardData, isLoading: dashLoading } = trpc.ewayBill.dashboard.useQuery({
    status: (statusFilter || undefined) as "generated" | "active" | "cancelled" | "expired" | undefined,
    page,
    limit: 20,
  }, { placeholderData: (prev) => prev });

  const { data: expiringData, isLoading: expiringLoading } = trpc.ewayBill.expiringList.useQuery();

  // ── Mutations ──────────────────────────────────────────────────────────────

  const generateMutation = trpc.ewayBill.generate.useMutation({
    onSuccess: () => {
      utils.ewayBill.dashboard.invalidate();
      utils.ewayBill.expiringList.invalidate();
      toast.success("E-Way Bill generated successfully");
      setShowGenerateModal(false);
      setGenerateForm(EMPTY_GENERATE_FORM);
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = trpc.ewayBill.cancel.useMutation({
    onSuccess: () => {
      utils.ewayBill.dashboard.invalidate();
      utils.ewayBill.expiringList.invalidate();
      toast.success("E-Way Bill cancelled");
      setCancelEwbId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateVehicleMutation = trpc.ewayBill.updateVehicle.useMutation({
    onSuccess: () => {
      utils.ewayBill.dashboard.invalidate();
      utils.ewayBill.expiringList.invalidate();
      toast.success("Vehicle updated successfully");
      setUpdateVehicleEwbId(null);
      setUpdateForm(EMPTY_UPDATE_FORM);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  function validateGenerate(): boolean {
    const errs: Partial<GenerateFormState> = {};
    if (!generateForm.invoiceId.trim()) errs.invoiceId = "Invoice ID is required";
    if (!generateForm.vehicleNumber.trim()) errs.vehicleNumber = "Vehicle number is required";
    if (!generateForm.distance || isNaN(parseInt(generateForm.distance)) || parseInt(generateForm.distance) < 1) {
      errs.distance = "Valid distance in km is required";
    }
    setGenerateErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateUpdateVehicle(): boolean {
    const errs: Partial<UpdateVehicleFormState> = {};
    if (!updateForm.vehicleNumber.trim()) errs.vehicleNumber = "Vehicle number is required";
    setUpdateErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleGenerate() {
    if (!validateGenerate()) return;
    generateMutation.mutate({
      invoiceId: generateForm.invoiceId.trim(),
      vehicleNumber: generateForm.vehicleNumber.trim().toUpperCase(),
      vehicleType: generateForm.vehicleType as "regular" | "over_dimensional",
      transportMode: generateForm.transportMode as "road" | "rail" | "air" | "ship",
      distance: parseInt(generateForm.distance),
      transporterId: generateForm.transporterId.trim() || undefined,
      transporterName: generateForm.transporterName.trim() || undefined,
      fromAddress: generateForm.fromAddress.trim() || undefined,
      fromPincode: generateForm.fromPincode.trim() || undefined,
      toAddress: generateForm.toAddress.trim() || undefined,
      toPincode: generateForm.toPincode.trim() || undefined,
    });
  }

  function handleUpdateVehicle() {
    if (!updateVehicleEwbId || !validateUpdateVehicle()) return;
    updateVehicleMutation.mutate({
      ewayBillId: updateVehicleEwbId,
      vehicleNumber: updateForm.vehicleNumber.trim().toUpperCase(),
      fromPlace: updateForm.fromPlace.trim() || undefined,
      reason: updateForm.reason as "breakdown" | "transshipment" | "first_time" | "others",
    });
  }

  // ── Summary counts ─────────────────────────────────────────────────────────

  const summary = dashboardData?.summary ?? {};
  const generatedCount = summary["generated"] ?? 0;
  const activeCount    = summary["active"] ?? 0;
  const expiredCount   = summary["expired"] ?? 0;
  const _cancelledCount = summary["cancelled"] ?? 0;
  const expiringCount  = (expiringData ?? []).length;

  return (
    <div>
      <PageHeader
        title="E-Way Bills"
        description="Generate and manage E-Way Bills for goods movement above ₹50,000"
        actions={
          <button
            className="btn-primary"
            onClick={() => {
              setGenerateForm(EMPTY_GENERATE_FORM);
              setGenerateErrors({});
              setShowGenerateModal(true);
            }}
          >
            + Generate EWB
          </button>
        }
      />

      {/* Status summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          label="Generated"
          count={generatedCount}
          color="blue"
          onClick={() => { setStatusFilter("generated"); setPage(1); setActiveTab("dashboard"); }}
        />
        <SummaryCard
          label="Active"
          count={activeCount}
          color="green"
          onClick={() => { setStatusFilter("active"); setPage(1); setActiveTab("dashboard"); }}
        />
        <SummaryCard
          label="Expiring Soon"
          count={expiringCount}
          color="amber"
          onClick={() => setActiveTab("expiring")}
        />
        <SummaryCard
          label="Expired"
          count={expiredCount}
          color="red"
          onClick={() => { setStatusFilter("expired"); setPage(1); setActiveTab("dashboard"); }}
        />
      </div>

      {/* Tab bar */}
      <div className="mb-5">
        <PillTabs
          tabs={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as EWBTab)}
        />
      </div>

      {activeTab === "dashboard" && (
        <DashboardTab
          data={dashboardData}
          isLoading={dashLoading}
          statusFilter={statusFilter}
          onStatusFilterChange={(v) => { setStatusFilter(v); setPage(1); }}
          page={page}
          onPageChange={setPage}
          onUpdateVehicle={(ewbId) => {
            setUpdateVehicleEwbId(ewbId);
            setUpdateForm(EMPTY_UPDATE_FORM);
            setUpdateErrors({});
          }}
          onCancel={(ewbId) => { setCancelEwbId(ewbId); setCancelReason("Data Entry Mistake"); }}
          onViewDetail={(ewbId) => setDetailEwbId(ewbId)}
        />
      )}

      {activeTab === "expiring" && (
        <ExpiringTab
          data={expiringData}
          isLoading={expiringLoading}
          onUpdateVehicle={(ewbId) => {
            setUpdateVehicleEwbId(ewbId);
            setUpdateForm(EMPTY_UPDATE_FORM);
            setUpdateErrors({});
          }}
        />
      )}

      {/* ── Generate EWB Modal ── */}
      <Modal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="Generate E-Way Bill"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Provide transport details to generate an EWB for a goods invoice above ₹50,000
          </p>
          <InputField
            label="Invoice ID"
            placeholder="Paste the invoice UUID"
            value={generateForm.invoiceId}
            onChange={(e) => setGenerateForm((f) => ({ ...f, invoiceId: e.target.value }))}
            error={generateErrors.invoiceId}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Vehicle Number"
              placeholder="e.g. MH12AB1234"
              value={generateForm.vehicleNumber}
              onChange={(e) => setGenerateForm((f) => ({ ...f, vehicleNumber: e.target.value.toUpperCase() }))}
              error={generateErrors.vehicleNumber}
              required
            />
            <InputField
              label="Distance (km)"
              type="number"
              min="1"
              max="4000"
              placeholder="e.g. 250"
              value={generateForm.distance}
              onChange={(e) => setGenerateForm((f) => ({ ...f, distance: e.target.value }))}
              error={generateErrors.distance}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Transport Mode
              </label>
              <Listbox
                value={generateForm.transportMode}
                onChange={(v) => setGenerateForm((f) => ({ ...f, transportMode: v }))}
                options={TRANSPORT_MODE_OPTIONS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Vehicle Type
              </label>
              <Listbox
                value={generateForm.vehicleType}
                onChange={(v) => setGenerateForm((f) => ({ ...f, vehicleType: v }))}
                options={VEHICLE_TYPE_OPTIONS}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Transporter ID (optional)"
              placeholder="GSTIN of transporter"
              value={generateForm.transporterId}
              onChange={(e) => setGenerateForm((f) => ({ ...f, transporterId: e.target.value }))}
            />
            <InputField
              label="Transporter Name (optional)"
              placeholder="Name of transporter"
              value={generateForm.transporterName}
              onChange={(e) => setGenerateForm((f) => ({ ...f, transporterName: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="From Pincode (optional)"
              placeholder="6-digit pincode"
              maxLength={6}
              value={generateForm.fromPincode}
              onChange={(e) => setGenerateForm((f) => ({ ...f, fromPincode: e.target.value }))}
            />
            <InputField
              label="To Pincode (optional)"
              placeholder="6-digit pincode"
              maxLength={6}
              value={generateForm.toPincode}
              onChange={(e) => setGenerateForm((f) => ({ ...f, toPincode: e.target.value }))}
            />
          </div>
          <p className="text-xs text-text-tertiary">
            The EWB will be generated for invoices with goods above ₹50,000. Services-only invoices are not eligible.
          </p>
          <div className="flex justify-end gap-3 pt-2 border-t border-border-light">
            <button
              className="btn-secondary"
              onClick={() => setShowGenerateModal(false)}
              disabled={generateMutation.isPending}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? "Generating..." : "Generate EWB"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Update Vehicle Modal ── */}
      <Modal
        open={!!updateVehicleEwbId}
        onClose={() => setUpdateVehicleEwbId(null)}
        title="Update Vehicle (Part-B)"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Update vehicle details for transshipment, breakdown, or route change
          </p>
          <InputField
            label="New Vehicle Number"
            placeholder="e.g. MH14CD5678"
            value={updateForm.vehicleNumber}
            onChange={(e) => setUpdateForm((f) => ({ ...f, vehicleNumber: e.target.value.toUpperCase() }))}
            error={updateErrors.vehicleNumber}
            required
          />
          <InputField
            label="From Place (optional)"
            placeholder="City / location where vehicle was updated"
            value={updateForm.fromPlace}
            onChange={(e) => setUpdateForm((f) => ({ ...f, fromPlace: e.target.value }))}
          />
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Reason
            </label>
            <Listbox
              value={updateForm.reason}
              onChange={(v) => setUpdateForm((f) => ({ ...f, reason: v }))}
              options={UPDATE_REASON_OPTIONS}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-border-light">
            <button
              className="btn-secondary"
              onClick={() => setUpdateVehicleEwbId(null)}
              disabled={updateVehicleMutation.isPending}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleUpdateVehicle}
              disabled={updateVehicleMutation.isPending}
            >
              {updateVehicleMutation.isPending ? "Updating..." : "Update Vehicle"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Cancel Confirm Dialog ── */}
      <Modal
        open={!!cancelEwbId}
        onClose={() => setCancelEwbId(null)}
        title="Cancel E-Way Bill"
        className="max-w-sm"
      >
        <div className="pb-2 space-y-3">
          <p className="text-sm text-text-secondary">
            E-Way Bills can only be cancelled within 24 hours of generation. This action cannot be undone.
          </p>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Cancellation Reason
            </label>
            <Listbox
              value={cancelReason}
              onChange={setCancelReason}
              options={CANCEL_REASON_OPTIONS}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCancelEwbId(null)}
            disabled={cancelMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger flex items-center gap-1.5"
            onClick={() => {
              if (!cancelEwbId) return;
              cancelMutation.mutate({ ewayBillId: cancelEwbId, cancelReason });
            }}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending && <Spinner size="sm" />}
            Cancel EWB
          </button>
        </div>
      </Modal>

      {/* ── EWB Detail Modal ── */}
      {detailEwbId && (
        <EWBDetailModal
          invoiceId={detailEwbId}
          onClose={() => setDetailEwbId(null)}
        />
      )}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab({
  data,
  isLoading,
  statusFilter,
  onStatusFilterChange,
  page,
  onPageChange,
  onUpdateVehicle,
  onCancel,
  onViewDetail,
}: {
  data: DashboardData | undefined;
  isLoading: boolean;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  page: number;
  onPageChange: (p: number) => void;
  onUpdateVehicle: (ewbId: string) => void;
  onCancel: (ewbId: string) => void;
  onViewDetail: (invoiceId: string) => void;
}) {
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 20;

  const statusTabs = STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light">
        <PillTabs
          tabs={statusTabs}
          value={statusFilter}
          onChange={onStatusFilterChange}
        />
      </div>

      {isLoading ? (
        <EWBTableSkeleton />
      ) : !rows.length ? (
        <EmptyState
          title="No E-Way Bills"
          description={statusFilter ? `No ${statusFilter} E-Way Bills found` : "Generate your first E-Way Bill to get started"}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>EWB Number</th>
                  <th>Invoice</th>
                  <th>Party</th>
                  <th>Mode</th>
                  <th>Vehicle</th>
                  <th>Generated</th>
                  <th>Valid Upto</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const validUpto = row.validUpto ? new Date(row.validUpto) : null;
                  const canCancel = row.status !== "cancelled" && row.status !== "expired" && row.ewbDate
                    ? (Date.now() - new Date(row.ewbDate).getTime()) < 24 * 60 * 60 * 1000
                    : false;
                  const canUpdate = row.status === "generated" || row.status === "active";

                  return (
                    <tr key={row.id} className="group">
                      <td className="font-mono text-xs text-text-primary">
                        {row.ewbNumber ?? "—"}
                      </td>
                      <td className="text-text-secondary text-xs">
                        {row.invoiceNumber ?? "—"}
                      </td>
                      <td className="text-text-primary max-w-[140px] truncate">
                        {row.partyName ?? "—"}
                      </td>
                      <td className="text-text-secondary text-xs">
                        {transportModeLabel(row.transportMode)}
                      </td>
                      <td className="font-mono text-xs">
                        {row.vehicleNumber ?? "—"}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap text-xs">
                        {row.ewbDate ? formatDate(row.ewbDate) : "—"}
                      </td>
                      <td className={cn("whitespace-nowrap text-xs font-medium", validityColor(validUpto))}>
                        {validUpto ? formatDate(validUpto) : "—"}
                        {validUpto && hoursUntil(validUpto) < 24 && hoursUntil(validUpto) > 0 && (
                          <span className="ml-1 text-amber-600 font-semibold">
                            ({Math.floor(hoursUntil(validUpto))}h left)
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge size="sm" color={statusBadgeColor(row.status)} className="uppercase">
                          {row.status}
                        </Badge>
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {row.invoiceId && (
                            <button
                              className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors text-xs"
                              onClick={() => onViewDetail(row.invoiceId!)}
                              title="View details"
                            >
                              View
                            </button>
                          )}
                          {canUpdate && (
                            <button
                              className="p-1.5 rounded text-text-tertiary hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/20 transition-colors text-xs"
                              onClick={() => onUpdateVehicle(row.id)}
                              title="Update vehicle"
                            >
                              Update
                            </button>
                          )}
                          {canCancel && (
                            <button
                              className="p-1.5 rounded text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors text-xs"
                              onClick={() => onCancel(row.id)}
                              title="Cancel EWB"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="px-4 py-3 border-t border-border-light flex items-center justify-between">
              <p className="text-xs text-text-tertiary">
                Page {page} of {Math.ceil(total / limit)} ({total.toLocaleString()} records)
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-secondary text-xs px-2 py-1"
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="btn-secondary text-xs px-2 py-1"
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= Math.ceil(total / limit)}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          <div className="px-4 py-2.5 border-t border-border-light">
            <p className="text-xs text-text-tertiary">
              {total.toLocaleString()} E-Way Bill{total !== 1 ? "s" : ""}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Expiring Tab ──────────────────────────────────────────────────────────────

function ExpiringTab({
  data,
  isLoading,
  onUpdateVehicle,
}: {
  data: EWBRow[] | undefined;
  isLoading: boolean;
  onUpdateVehicle: (ewbId: string) => void;
}) {
  if (isLoading) return <EWBTableSkeleton />;

  const rows = data ?? [];

  if (!rows.length) {
    return (
      <EmptyState
        title="No expiring E-Way Bills"
        description="All E-Way Bills have more than 24 hours of validity remaining"
      />
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-sm font-medium text-text-primary">
          {rows.length} E-Way Bill{rows.length !== 1 ? "s" : ""} expiring within 24 hours
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>EWB Number</th>
              <th>Invoice</th>
              <th>Party</th>
              <th>Mode</th>
              <th>Vehicle</th>
              <th>Expires</th>
              <th>Time Left</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const validUpto = row.validUpto ? new Date(row.validUpto) : null;
              const hours = validUpto ? hoursUntil(validUpto) : null;
              const urgent = hours !== null && hours < 8;

              return (
                <tr key={row.id} className={cn("group", urgent && "bg-red-600/[0.02]")}>
                  <td className="font-mono text-xs">{row.ewbNumber ?? "—"}</td>
                  <td className="text-text-secondary text-xs">{row.invoiceNumber ?? "—"}</td>
                  <td className="max-w-[140px] truncate">{row.partyName ?? "—"}</td>
                  <td className="text-xs">{transportModeLabel(row.transportMode)}</td>
                  <td className="font-mono text-xs">{row.vehicleNumber ?? "—"}</td>
                  <td className={cn("whitespace-nowrap text-xs font-medium", urgent ? "text-red-600" : "text-amber-600")}>
                    {validUpto ? formatDate(validUpto) : "—"}
                  </td>
                  <td>
                    {hours !== null ? (
                      <Badge
                        size="sm"
                        color={urgent ? badgeColor("red") : badgeColor("amber")}
                        className="font-semibold"
                      >
                        {hours < 1 ? `${Math.floor(hours * 60)}m` : `${Math.floor(hours)}h`} left
                      </Badge>
                    ) : "—"}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="px-2 py-1 rounded text-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/20 transition-colors"
                        onClick={() => onUpdateVehicle(row.id)}
                      >
                        Update Vehicle
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EWB Detail Modal ──────────────────────────────────────────────────────────

function EWBDetailModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = trpc.ewayBill.getByInvoice.useQuery({ invoiceId });

  return (
    <Modal
      open
      onClose={onClose}
      title="E-Way Bill Details"
    >
      <div className="space-y-5">
        <p className="text-sm text-text-secondary">Full details and vehicle update history</p>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !data ? (
          <EmptyState title="No EWB" description="No E-Way Bill found for this invoice" />
        ) : (
          <div className="space-y-5">
            {/* Core details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <DetailRow label="EWB Number" value={data.ewbNumber ?? "—"} mono />
              <DetailRow label="Status">
                <Badge size="sm" color={statusBadgeColor(data.status)} className="uppercase">
                  {data.status}
                </Badge>
              </DetailRow>
              <DetailRow label="Generated On" value={data.ewbDate ? formatDate(data.ewbDate) : "—"} />
              <DetailRow
                label="Valid Upto"
                value={data.validUpto ? formatDate(data.validUpto) : "—"}
                className={validityColor(data.validUpto)}
              />
              <DetailRow label="Transport Mode" value={transportModeLabel(data.transportMode)} />
              <DetailRow label="Vehicle Number" value={data.vehicleNumber ?? "—"} mono />
              <DetailRow label="Distance" value={data.distance ? `${data.distance} km` : "—"} />
              <DetailRow label="From State" value={data.fromState ?? "—"} />
              <DetailRow label="To State" value={data.toState ?? "—"} />
              {data.cancelReason && (
                <DetailRow label="Cancel Reason" value={data.cancelReason} className="col-span-2" />
              )}
            </div>

            {/* Vehicle update history */}
            {data.vehicleHistory && data.vehicleHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-text-primary mb-2">
                  Vehicle Update History
                </h4>
                <div className="space-y-2">
                  {data.vehicleHistory.map((vh) => (
                    <div
                      key={vh.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-surface-1 text-xs"
                    >
                      <div className="mt-0.5 w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium">{vh.vehicleNumber}</span>
                          <span className="text-text-tertiary whitespace-nowrap">
                            {formatDate(vh.updatedAt)}
                          </span>
                        </div>
                        {vh.fromPlace && (
                          <p className="text-text-secondary mt-0.5">From: {vh.fromPlace}</p>
                        )}
                        {vh.reason && (
                          <p className="text-text-tertiary capitalize mt-0.5">
                            Reason: {vh.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end pt-2 border-t border-border-light">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  count,
  color,
  onClick,
}: {
  label: string;
  count: number;
  color: "blue" | "green" | "amber" | "red";
  onClick?: () => void;
}) {
  const colorMap = {
    blue:  "bg-blue-600/[0.06] border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300",
    green: "bg-emerald-600/[0.06] border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-600/[0.06] border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300",
    red:   "bg-red-600/[0.06] border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card p-4 text-left border transition-all hover:shadow-sm hover:-translate-y-0.5",
        colorMap[color],
      )}
    >
      <p className="text-2xl font-bold tabular-nums">{count.toLocaleString()}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </button>
  );
}

// ── Detail row helper ─────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  mono = false,
  className,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p className="text-xs text-text-tertiary">{label}</p>
      {children ?? (
        <p className={cn("text-sm font-medium text-text-primary mt-0.5", mono && "font-mono")}>
          {value}
        </p>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function EWBTableSkeleton() {
  return (
    <div className="divide-y divide-border-light">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4">
          <div className="h-3 w-24 bg-surface-2 rounded animate-pulse" />
          <div className="h-3 w-16 bg-surface-2 rounded animate-pulse" />
          <div className="h-3 w-28 bg-surface-2 rounded animate-pulse flex-1" />
          <div className="h-3 w-14 bg-surface-2 rounded animate-pulse" />
          <div className="h-5 w-16 bg-surface-2 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
