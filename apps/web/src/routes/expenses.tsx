import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { SearchInput } from "@/components/ui/SearchInput";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
});

const EXPENSE_PAGE_SIZE = 20;

function getDatePreset(preset: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  switch (preset) {
    case "this-month": {
      const from = new Date(yyyy, mm, 1);
      const to = new Date(yyyy, mm + 1, 0);
      return { fromDate: from.toISOString(), toDate: to.toISOString() };
    }
    case "last-month": {
      const from = new Date(yyyy, mm - 1, 1);
      const to = new Date(yyyy, mm, 0);
      return { fromDate: from.toISOString(), toDate: to.toISOString() };
    }
    case "last-30": {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { fromDate: from.toISOString(), toDate: now.toISOString() };
    }
    case "this-fy": {
      const fyYear = mm >= 3 ? yyyy : yyyy - 1;
      return { fromDate: new Date(fyYear, 3, 1).toISOString(), toDate: now.toISOString() };
    }
    case "last-fy": {
      const lastFyYear = mm >= 3 ? yyyy - 1 : yyyy - 2;
      return {
        fromDate: new Date(lastFyYear, 3, 1).toISOString(),
        toDate: new Date(lastFyYear + 1, 2, 31, 23, 59, 59).toISOString(),
      };
    }
    case "all":
      return { fromDate: "", toDate: "" };
    default:
      return { fromDate: "", toDate: "" };
  }
}

const MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

const DATE_PRESETS = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "last-30", label: "Last 30 Days" },
  { value: "this-fy", label: "This FY" },
  { value: "last-fy", label: "Last FY" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All" },
];

function modeColor(mode: string) {
  switch (mode) {
    case "upi":
      return "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400";
    case "cash":
      return "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400";
    case "bank":
      return "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400";
    case "cheque":
      return "bg-amber-600/[0.08] text-amber-700 dark:text-amber-400";
    default:
      return "bg-surface-2 text-text-secondary";
  }
}

const TODAY_ISO = new Date().toISOString().split("T")[0];

type ExpenseFormState = {
  category: string;
  description: string;
  amount: string;
  mode: string;
  expenseDate: string;
  referenceNumber: string;
};

const EMPTY_FORM: ExpenseFormState = {
  category: "",
  description: "",
  amount: "",
  mode: "cash",
  expenseDate: TODAY_ISO,
  referenceNumber: "",
};

function ExpensesPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [datePreset, setDatePreset] = useState("this-month");
  const [dateRange, setDateRange] = useState(() => getDatePreset("this-month"));
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ExpenseFormState, string>>>({});
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter, dateRange]);

  useHotkeys([
    {
      key: "n",
      handler: () => {
        setEditExpenseId(null);
        setForm({ ...EMPTY_FORM, expenseDate: new Date().toISOString().split("T")[0] });
        setFormErrors({});
        setShowAddModal(true);
      },
      description: "New expense",
      scope: "expenses",
    },
  ]);

  const { data, isLoading } = trpc.expense.list.useQuery({
    page,
    limit: EXPENSE_PAGE_SIZE,
    search: debouncedSearch || undefined,
    category: categoryFilter || undefined,
    fromDate: dateRange.fromDate || undefined,
    toDate: dateRange.toDate || undefined,
  });

  const { data: categories } = trpc.expense.categories.useQuery();

  const utils = trpc.useUtils();

  const createMutation = trpc.expense.create.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.expense.categories.invalidate();
      utils.expense.summary.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Expense added");
      setShowAddModal(false);
      setForm({ ...EMPTY_FORM, expenseDate: new Date().toISOString().split("T")[0] });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.expense.update.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.expense.categories.invalidate();
      utils.expense.summary.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Expense updated");
      setShowAddModal(false);
      setEditExpenseId(null);
      setForm({ ...EMPTY_FORM, expenseDate: new Date().toISOString().split("T")[0] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.expense.delete.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.expense.categories.invalidate();
      utils.expense.summary.invalidate();
      utils.dashboard.summary.invalidate();
      toast.success("Expense deleted");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  function openAdd() {
    setEditExpenseId(null);
    setForm({ ...EMPTY_FORM, expenseDate: new Date().toISOString().split("T")[0] });
    setFormErrors({});
    setShowAddModal(true);
  }

  function openEdit(exp: any) {
    setEditExpenseId(exp.id);
    setForm({
      category: exp.category,
      description: exp.description || "",
      amount: exp.amount,
      mode: exp.mode,
      expenseDate: new Date(exp.expenseDate).toISOString().split("T")[0],
      referenceNumber: exp.referenceNumber || "",
    });
    setFormErrors({});
    setShowAddModal(true);
  }

  function validateForm(): boolean {
    const errs: Partial<Record<keyof ExpenseFormState, string>> = {};
    if (!form.category.trim()) errs.category = "Category is required";
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0)
      errs.amount = "Valid amount required";
    if (!form.mode) errs.mode = "Payment mode is required";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validateForm()) return;
    const payload = {
      category: form.category.trim(),
      description: form.description.trim() || undefined,
      amount: parseFloat(form.amount).toFixed(2),
      mode: form.mode as any,
      expenseDate: form.expenseDate ? new Date(form.expenseDate).toISOString() : undefined,
      referenceNumber: form.referenceNumber.trim() || undefined,
    };
    if (editExpenseId) {
      updateMutation.mutate({ id: editExpenseId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  async function exportExpensesCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.expense.list.fetch({
          page: pg,
          limit,
          search: debouncedSearch || undefined,
          category: categoryFilter || undefined,
          fromDate: dateRange.fromDate || undefined,
          toDate: dateRange.toDate || undefined,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Date", "Category", "Description", "Mode", "Reference", "Amount"];
      const rows = allData.map((exp: any) => [
        formatDate(exp.expenseDate),
        (exp.category || "").replace(/"/g, '""'),
        (exp.description || "").replace(/"/g, '""'),
        exp.mode,
        (exp.referenceNumber || "").replace(/"/g, '""'),
        exp.amount,
      ]);

      const csv = [
        `Period,${datePreset}`,
        `Exported,${new Date().toLocaleDateString("en-IN")}`,
        `Expenses,${allData.length}`,
        "",
        headers.join(","),
        ...rows.map((r) => r.map((cell: any) => `"${String(cell)}"`).join(",")),
      ].join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expenses_${datePreset || "all"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const totalPages = data ? Math.ceil(data.total / EXPENSE_PAGE_SIZE) : 1;

  // Build category pill tabs from fetched categories
  const categoryTabs = [
    { value: "", label: "All" },
    ...(categories?.map((c) => ({ value: c, label: c })) ?? []),
  ];

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Track business expenses and outflows"
        actions={
          <div className="flex items-center gap-2">
            {data && data.total > 0 && (
              <button
                onClick={exportExpensesCSV}
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
            <button className="btn-primary" onClick={openAdd}>
              + New Expense
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="card mb-5 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-border-light">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search category or description..."
            className="max-w-xs"
          />
          <div className="flex items-center gap-1 flex-wrap">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setDatePreset(p.value);
                  if (p.value !== "custom") {
                    setDateRange(getDatePreset(p.value));
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  datePreset === p.value
                    ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
                )}
              >
                {p.label}
              </button>
            ))}
            {datePreset === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={dateRange.fromDate ? dateRange.fromDate.split("T")[0] : ""}
                  onChange={(e) =>
                    setDateRange((prev) => ({
                      ...prev,
                      fromDate: e.target.value ? new Date(e.target.value).toISOString() : "",
                    }))
                  }
                  className="input py-1 text-xs w-32"
                />
                <span className="text-text-tertiary text-xs">to</span>
                <input
                  type="date"
                  value={dateRange.toDate ? dateRange.toDate.split("T")[0] : ""}
                  onChange={(e) =>
                    setDateRange((prev) => ({
                      ...prev,
                      toDate: e.target.value
                        ? new Date(e.target.value + "T23:59:59").toISOString()
                        : "",
                    }))
                  }
                  className="input py-1 text-xs w-32"
                />
              </div>
            )}
          </div>
        </div>

        {categoryTabs.length > 1 && (
          <div className="px-4 py-2 border-b border-border-light">
            <PillTabs
              tabs={categoryTabs}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <ExpenseTableSkeleton />
        ) : !data?.data.length ? (
          <EmptyState
            title="No expenses"
            description={
              search || categoryFilter
                ? "No expenses match your filters"
                : "Add your first expense to get started"
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <th className="text-right">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((exp) => (
                    <tr key={exp.id} className="group">
                      <td className="text-text-secondary whitespace-nowrap">
                        {formatDate(exp.expenseDate)}
                      </td>
                      <td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-surface-2 text-text-secondary">
                          {exp.category}
                        </span>
                      </td>
                      <td className="text-text-primary max-w-[200px] truncate">
                        {exp.description || "—"}
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase", modeColor(exp.mode))}>
                          {exp.mode}
                        </span>
                      </td>
                      <td className="text-text-tertiary font-mono text-xs">
                        {exp.referenceNumber || "—"}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-red-600 whitespace-nowrap">
                        {formatCurrency(exp.amount)}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(exp)}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
                            aria-label="Edit expense"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteId(exp.id)}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors"
                            aria-label="Delete expense"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer: total + pagination */}
            <div className="px-4 py-3 border-t border-border-light flex items-center justify-between">
              <p className="text-xs text-text-tertiary">
                {data.total.toLocaleString()} expense{data.total !== 1 ? "s" : ""}
              </p>
              {totalPages > 1 && (
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditExpenseId(null);
        }}
        title={editExpenseId ? "Edit Expense" : "Add Expense"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <InputField
                label="Category"
                placeholder="e.g. Rent, Utilities, Travel"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                error={formErrors.category}
                required
              />
            </div>
            <InputField
              label="Amount"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              error={formErrors.amount}
              required
            />
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Payment Mode
              </label>
              <Listbox
                value={form.mode}
                onChange={(val) => setForm((f) => ({ ...f, mode: val }))}
                options={MODE_OPTIONS}
              />
              {formErrors.mode && (
                <p className="mt-1 text-xs text-red-500">{formErrors.mode}</p>
              )}
            </div>
            <InputField
              label="Date"
              type="date"
              value={form.expenseDate}
              onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
            />
            <InputField
              label="Reference # (optional)"
              placeholder="e.g. invoice/receipt #"
              value={form.referenceNumber}
              onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
            />
            <div className="col-span-2">
              <InputField
                label="Description (optional)"
                placeholder="Brief note about this expense"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="btn-ghost"
              onClick={() => {
                setShowAddModal(false);
                setEditExpenseId(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? editExpenseId
                  ? "Saving..."
                  : "Adding..."
                : editExpenseId
                  ? "Save Changes"
                  : "Add Expense"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        title="Delete Expense"
        description="This will permanently delete this expense. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────

function ExpenseTableSkeleton() {
  return (
    <div className="divide-y divide-border-light">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4">
          <div className="h-3.5 w-20 bg-surface-2 rounded animate-pulse" />
          <div className="h-5 w-24 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-32 bg-surface-2 rounded animate-pulse flex-1" />
          <div className="h-5 w-12 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-20 bg-surface-2 rounded animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}
