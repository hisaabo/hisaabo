import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, getInitials, cn, downloadCSV } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import type { PartyType } from "@hisaabo/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Disclosure } from "@/components/ui/Disclosure";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { Pagination } from "@/components/ui/Pagination";
import { SlideOver } from "@/components/ui/SlideOver";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const Route = createFileRoute("/parties")({
  component: PartiesPage,
});

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "customer", label: "Customers" },
  { value: "supplier", label: "Suppliers" },
];

const PARTIES_PAGE_SIZE = 20;

function countFilled(...values: string[]): number {
  return values.filter((v) => v.trim() !== "").length;
}

function PartiesPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, typeFilter]);

  const { data, isLoading } = trpc.party.list.useQuery({
    search: debouncedSearch || undefined,
    type: typeFilter !== "all" ? (typeFilter as PartyType) : undefined,
    page,
    limit: PARTIES_PAGE_SIZE,
  });

  const utils = trpc.useUtils();

  async function exportPartiesCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.party.list.fetch({
          search: debouncedSearch || undefined,
          type: typeFilter !== "all" ? (typeFilter as PartyType) : undefined,
          page: pg,
          limit: 100,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Name", "Type", "Phone", "Email", "GSTIN", "Opening Balance"];
      const rows = allData.map((p: any) => [
        p.name,
        p.type,
        p.phone || "",
        p.email || "",
        p.gstin || "",
        p.openingBalance || "0",
      ]);

      downloadCSV(`parties_${typeFilter}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  const deleteMutation = trpc.party.delete.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      setDeleteId(null);
      toast.success("Party deleted");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  useHotkeys([
    {
      key: "n",
      handler: () => setShowAddModal(true),
      description: "New party",
      scope: "parties",
    },
  ]);

  function confirmDelete(id: string) {
    setDeleteId(id);
  }

  return (
    <div>
      <PageHeader
        title="Parties"
        description="Manage your customers and suppliers"
        actions={
          <div className="flex items-center gap-2">
            {data && data.total > 0 && (
              <button
                onClick={exportPartiesCSV}
                disabled={exporting}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                {exporting ? (
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                  </svg>
                )}
                {exporting ? "Preparing..." : "Export CSV"}
              </button>
            )}
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => setShowAddModal(true)}
            >
              + Add Party
              <KbdShortcut keys={["N"]} className="opacity-60" />
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name..."
          className="max-w-xs"
        />
        <SegmentedControl
          tabs={TYPE_TABS}
          value={typeFilter}
          onChange={setTypeFilter}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          title="No parties found"
          description="Add your first customer or supplier to get started."
          action={
            <button className="btn-primary" onClick={() => setShowAddModal(true)}>
              + Add Party
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Phone</th>
                <th>GSTIN</th>
                <th className="text-right">Opening Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((party) => (
                <tr
                  key={party.id}
                  className="group cursor-pointer"
                  onClick={() => setSelectedPartyId(party.id)}
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white ${party.type === "customer" ? "bg-emerald-500" : "bg-blue-500"}`}
                      >
                        {getInitials(party.name)}
                      </div>
                      <span className="font-medium">{party.name}</span>
                    </div>
                  </td>
                  <td className="capitalize text-text-secondary">{party.type}</td>
                  <td className="text-text-secondary">{party.phone || "—"}</td>
                  <td className="font-mono text-[13px] text-text-secondary">
                    {party.gstin || "—"}
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    {party.openingBalance && party.openingBalance !== "0"
                      ? formatCurrency(party.openingBalance)
                      : "—"}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                      onClick={() => confirmDelete(party.id)}
                      aria-label="Delete party"
                    >
                      <svg
                        className="w-4 h-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            totalPages={Math.ceil(data.total / PARTIES_PAGE_SIZE)}
            onPageChange={setPage}
            total={data.total}
            pageSize={PARTIES_PAGE_SIZE}
          />
        </div>
      )}

      {/* Add Party Modal */}
      <AddPartyModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete party?"
        description="This action cannot be undone. All data associated with this party will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate({ id: deleteId });
        }}
        onCancel={() => setDeleteId(null)}
      />

      {/* Party Detail SlideOver */}
      {selectedPartyId && (
        <PartyDetailPanel
          partyId={selectedPartyId}
          onClose={() => setSelectedPartyId(null)}
        />
      )}
    </div>
  );
}

// ── Party Detail Panel ──────────────────────────────────────────────

const PARTY_DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "ledger", label: "Ledger" },
  { value: "invoices", label: "Invoices" },
  { value: "top-items", label: "Top Items" },
];

function PartyDetailPanel({ partyId, onClose }: { partyId: string; onClose: () => void }) {
  const [tab, setTab] = useState("overview");
  const [showMerge, setShowMerge] = useState(false);
  const navigate = useNavigate();

  const { data: party } = trpc.party.getById.useQuery({ id: partyId });

  const { data: ledger } = trpc.party.ledger.useQuery(
    { partyId, page: 1, limit: 30 },
    { enabled: tab === "ledger" || tab === "overview" }
  );

  const { data: invoiceList } = trpc.invoice.list.useQuery(
    { partyId, page: 1, limit: 20 },
    { enabled: tab === "invoices" }
  );

  const { data: topItems } = trpc.party.topItems.useQuery(
    { partyId },
    { enabled: tab === "top-items" || tab === "overview" }
  );

  if (!party) return null;

  const balanceNum = parseFloat(party.balance);
  const isPositiveBalance = balanceNum > 0;

  return (
    <>
    <SlideOver
      open={true}
      onClose={onClose}
      title={party.name}
      description={[
        party.type === "customer" ? "Customer" : "Supplier",
        party.phone,
        party.gstin,
      ].filter(Boolean).join(" · ")}
      footer={
        <div className="flex justify-end">
          <button
            onClick={() => setShowMerge(true)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-800 transition-colors"
          >
            Merge
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tabs */}
        <PillTabs tabs={PARTY_DETAIL_TABS} value={tab} onChange={setTab} />

        {/* ── Overview ─────────────────────────────────── */}
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Party info + Balance cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Party Info */}
              <div className="rounded-xl bg-surface-1 border border-border-light p-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Party Info
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                        party.type === "customer"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                      )}
                    >
                      {party.type === "customer" ? "Customer" : "Supplier"}
                    </span>
                  </div>
                  {party.phone && (
                    <p className="text-sm text-text-secondary">{party.phone}</p>
                  )}
                  {party.email && (
                    <p className="text-sm text-text-secondary">{party.email}</p>
                  )}
                  {party.gstin && (
                    <p className="font-mono text-[13px] text-text-secondary">{party.gstin}</p>
                  )}
                  {party.pan && (
                    <p className="font-mono text-[13px] text-text-secondary">PAN: {party.pan}</p>
                  )}
                </div>
              </div>

              {/* Balance */}
              <div className="rounded-xl bg-surface-1 border border-border-light p-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Balance
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    isPositiveBalance ? "text-red-600" : balanceNum < 0 ? "text-emerald-600" : "text-text-primary"
                  )}
                >
                  {formatCurrency(party.balance)}
                </p>
                <p className="text-xs text-text-tertiary">
                  Opening: {formatCurrency(party.openingBalance)}
                </p>
                {(party.creditPeriodDays || party.creditLimit) && (
                  <div className="pt-1 border-t border-border-light space-y-0.5">
                    {party.creditPeriodDays && (
                      <p className="text-xs text-text-secondary">
                        Credit period: <span className="font-medium">{party.creditPeriodDays} days</span>
                      </p>
                    )}
                    {party.creditLimit && (
                      <p className="text-xs text-text-secondary">
                        Credit limit: <span className="font-medium">{formatCurrency(party.creditLimit)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Top Items preview */}
            {topItems && topItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">
                    {party.type === "customer" ? "Items purchased by" : "Items supplied by"} {party.name}
                  </p>
                  <button
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => setTab("top-items")}
                  >
                    View all
                  </button>
                </div>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topItems.map((item, i) => (
                        <tr key={item.itemId ?? i}>
                          <td>
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 text-[11px] font-semibold text-text-tertiary">
                              {i + 1}
                            </span>
                          </td>
                          <td className="font-medium">{item.itemName}</td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {parseFloat(item.totalQuantity).toLocaleString("en-IN")}
                          </td>
                          <td className="text-right tabular-nums font-medium">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="text-right">
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-surface-2 text-text-secondary">
                              {item.invoiceCount}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent ledger preview */}
            {ledger && ledger.data.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">Recent Activity</p>
                  <button
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => setTab("ledger")}
                  >
                    View all
                  </button>
                </div>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Document</th>
                        <th className="text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.data.slice(-5).map((row, i) => (
                        <tr key={i}>
                          <td className="text-text-secondary text-xs">{formatDate(row.date)}</td>
                          <td>
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                                row.type === "payment"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                              )}
                            >
                              {row.type === "payment" ? "Payment" : row.type === "purchase" ? "Purchase" : "Invoice"}
                            </span>
                          </td>
                          <td className="font-mono text-[13px] text-text-secondary">{row.documentNumber}</td>
                          <td className="text-right tabular-nums font-medium text-text-primary">
                            {formatCurrency(row.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Ledger ──────────────────────────────────────── */}
        {tab === "ledger" && (
          <div>
            {!ledger?.data.length ? (
              <EmptyState
                title="No ledger entries"
                description="Invoices and payments for this party will appear here."
              />
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Document #</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((row, i) => {
                      const debitNum = parseFloat(row.debit);
                      const creditNum = parseFloat(row.credit);
                      return (
                        <tr key={i}>
                          <td className="text-text-secondary text-xs">{formatDate(row.date)}</td>
                          <td>
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                                row.type === "payment"
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                              )}
                            >
                              {row.type === "payment" ? "Payment" : row.type === "purchase" ? "Purchase" : "Invoice"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="font-mono text-[13px] text-brand-600 hover:underline"
                              onClick={() => {
                                onClose();
                                navigate({ to: row.type === "payment" ? "/payments" : "/invoices" });
                              }}
                            >
                              {row.documentNumber}
                            </button>
                          </td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {debitNum > 0 ? formatCurrency(row.debit) : "—"}
                          </td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {creditNum > 0 ? formatCurrency(row.credit) : "—"}
                          </td>
                          <td className="text-right tabular-nums font-bold text-text-primary">
                            {formatCurrency(row.runningBalance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ledger.total > ledger.data.length && (
                  <div className="px-4 py-2 text-center text-xs text-text-tertiary bg-surface-1">
                    Showing {ledger.data.length} of {ledger.total}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Invoices ─────────────────────────────────────── */}
        {tab === "invoices" && (
          <div>
            {!invoiceList?.data.length ? (
              <EmptyState
                title="No invoices"
                description="Invoices for this party will appear here."
              />
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceList.data.map((inv) => {
                      const balanceDue = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
                      return (
                        <tr
                          key={inv.id}
                          className="cursor-pointer"
                          onClick={() => {
                            onClose();
                            navigate({ to: "/invoices" });
                          }}
                        >
                          <td className="font-mono text-[13px] text-brand-600 hover:underline">
                            {inv.invoiceNumber}
                          </td>
                          <td className="text-text-secondary text-xs">{formatDate(inv.invoiceDate)}</td>
                          <td><StatusBadge status={inv.status} size="sm" /></td>
                          <td className="text-right tabular-nums font-medium">
                            {formatCurrency(inv.totalAmount)}
                          </td>
                          <td className={cn(
                            "text-right tabular-nums font-medium",
                            balanceDue > 0 ? "text-amber-600" : "text-text-secondary"
                          )}>
                            {balanceDue > 0 ? formatCurrency(balanceDue.toFixed(2)) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {invoiceList.total > invoiceList.data.length && (
                  <div className="px-4 py-2 text-center text-xs text-text-tertiary bg-surface-1">
                    Showing {invoiceList.data.length} of {invoiceList.total}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Top Items ────────────────────────────────────── */}
        {tab === "top-items" && (
          <div>
            {!topItems?.length ? (
              <EmptyState
                title="No items found"
                description="Items will appear here as invoices are created for this party."
              />
            ) : (
              <div>
                <p className="text-xs text-text-tertiary mb-3">
                  {party.type === "customer" ? "Items purchased by" : "Items supplied by"}{" "}
                  <span className="font-medium text-text-secondary">{party.name}</span>
                </p>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item Name</th>
                        <th className="text-right">Total Qty</th>
                        <th className="text-right">Total Amount</th>
                        <th className="text-right">Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topItems.map((item, i) => (
                        <tr key={item.itemId ?? i}>
                          <td>
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 text-[11px] font-semibold text-text-tertiary">
                              {i + 1}
                            </span>
                          </td>
                          <td className="font-medium">{item.itemName}</td>
                          <td className="text-right tabular-nums text-text-secondary">
                            {parseFloat(item.totalQuantity).toLocaleString("en-IN")}
                          </td>
                          <td className="text-right tabular-nums font-medium">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="text-right">
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-surface-2 text-text-secondary">
                              {item.invoiceCount}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOver>
    {showMerge && (
      <MergePartyModal
        sourceId={partyId}
        sourceName={party.name}
        onClose={() => {
          setShowMerge(false);
          onClose();
        }}
      />
    )}
    </>
  );
}

function MergePartyModal({
  sourceId,
  sourceName,
  onClose,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState("");
  const { data: partiesData } = trpc.party.list.useQuery({ page: 1, limit: 500 });
  const utils = trpc.useUtils();

  const mergeMutation = trpc.party.merge.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      toast.success(`"${sourceName}" merged successfully`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const targetOptions = (partiesData?.data || []).filter((p) => p.id !== sourceId);

  return (
    <Modal open={true} onClose={onClose} title={`Merge "${sourceName}"`} className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          All invoices, payments, and data from <strong>{sourceName}</strong> will be transferred to the target party. The source party will be deleted.
        </p>

        <div>
          <label className="text-sm font-medium text-text-primary block mb-1">
            Merge into <span className="text-red-500">*</span>
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="input-field w-full"
          >
            <option value="">Select target party...</option>
            {targetOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-border-light">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-danger"
            onClick={() => mergeMutation.mutate({ sourceId, targetId })}
            disabled={!targetId || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? "Merging..." : "Merge & Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddPartyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [partyType, setPartyType] = useState<PartyType>("customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [category, setCategory] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [creditPeriodDays, setCreditPeriodDays] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");
  const [contactPersonDob, setContactPersonDob] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankName, setBankName] = useState("");

  const utils = trpc.useUtils();

  const createMutation = trpc.party.create.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      toast.success("Party created");
      onClose();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function resetForm() {
    setPartyType("customer");
    setName("");
    setPhone("");
    setEmail("");
    setOpeningBalance("");
    setGstin("");
    setPan("");
    setCategory("");
    setBillingAddress("");
    setShippingAddress("");
    setSameAsBilling(false);
    setCity("");
    setState("");
    setPincode("");
    setCreditPeriodDays("");
    setCreditLimit("");
    setContactPersonName("");
    setContactPersonDob("");
    setBankAccountNumber("");
    setBankIfsc("");
    setBankName("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleCreate() {
    createMutation.mutate({
      type: partyType,
      name,
      phone: phone || undefined,
      email: email || undefined,
      openingBalance: openingBalance || "0",
      gstin: gstin || undefined,
      pan: pan || undefined,
      category: category || undefined,
      billingAddress: billingAddress || undefined,
      shippingAddress: sameAsBilling ? billingAddress || undefined : shippingAddress || undefined,
      city: city || undefined,
      state: state || undefined,
      pincode: pincode || undefined,
      creditPeriodDays: creditPeriodDays ? parseInt(creditPeriodDays, 10) : undefined,
      creditLimit: creditLimit || undefined,
      contactPersonName: contactPersonName || undefined,
      contactPersonDob: contactPersonDob
        ? new Date(contactPersonDob).toISOString()
        : undefined,
      bankAccountNumber: bankAccountNumber || undefined,
      bankIfsc: bankIfsc || undefined,
      bankName: bankName || undefined,
    });
  }

  const _effectiveShipping = sameAsBilling ? billingAddress : shippingAddress;

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Add Party"
      description="Create a new customer or supplier"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? "Creating..." : "Create Party"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Party Type toggle */}
        <SegmentedControl
          tabs={[
            { value: "customer", label: "Customer" },
            { value: "supplier", label: "Supplier" },
          ]}
          value={partyType}
          onChange={(v) => setPartyType(v as PartyType)}
        />

        {/* Base fields — 2 column */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Party Name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name or business name"
          />
          <InputField
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
          />
          <InputField
            label="Opening Balance"
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <InputField
          label="GSTIN"
          value={gstin}
          onChange={(e) => setGstin(e.target.value)}
          placeholder="22AAAAA0000A1Z5"
        />

        {/* Section divider */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
            Additional Details
          </span>
          <div className="flex-1 h-px bg-border-light" />
        </div>

        {/* Disclosure sections */}
        <div className="space-y-1">
          <Disclosure
            label="Tax & Identity"
            count={countFilled(pan, category)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="PAN"
                value={pan}
                onChange={(e) => setPan(e.target.value)}
                placeholder="AAAAA0000A"
              />
              <InputField
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Retail, Wholesale"
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Address"
            count={countFilled(billingAddress, city, state, pincode)}
          >
            <div className="grid grid-cols-2 gap-4">
              <TextareaField
                label="Billing Address"
                rows={3}
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Street, Area..."
              />
              <div className="flex flex-col gap-1">
                <TextareaField
                  label="Shipping Address"
                  rows={3}
                  value={sameAsBilling ? billingAddress : shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder="Leave empty to use billing"
                  disabled={sameAsBilling}
                />
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => setSameAsBilling(e.target.checked)}
                    className="rounded"
                  />
                  Same as billing
                </label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-3">
              <InputField
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
              <InputField
                label="State"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
              <InputField
                label="Pincode"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Credit Terms"
            count={countFilled(creditPeriodDays, creditLimit)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Credit Period (Days)"
                type="number"
                min="0"
                max="365"
                value={creditPeriodDays}
                onChange={(e) => setCreditPeriodDays(e.target.value)}
                placeholder="e.g. 30"
              />
              <InputField
                label="Credit Limit (₹)"
                type="number"
                step="0.01"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Contact Person"
            count={countFilled(contactPersonName, contactPersonDob)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="Contact Name"
                value={contactPersonName}
                onChange={(e) => setContactPersonName(e.target.value)}
                placeholder="Contact person name"
              />
              <InputField
                label="Date of Birth"
                type="date"
                value={contactPersonDob}
                onChange={(e) => setContactPersonDob(e.target.value)}
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Bank Details"
            count={countFilled(bankAccountNumber, bankIfsc, bankName)}
          >
            <div className="grid grid-cols-3 gap-4">
              <InputField
                label="Account Number"
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                placeholder="Account number"
              />
              <InputField
                label="IFSC"
                value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value)}
                placeholder="SBIN0001234"
              />
              <InputField
                label="Bank Name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Bank name"
              />
            </div>
          </Disclosure>
        </div>

      </div>
    </SlideOver>
  );
}
