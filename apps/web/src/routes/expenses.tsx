import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, downloadCSV } from "@/lib/utils";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDateRange } from "@/hooks/useDateRange";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { SearchInput } from "@/components/ui/SearchInput";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
});

const EXPENSE_PAGE_SIZE = 25;

const MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

function modeColor(mode: string) {
  switch (mode) {
    case "upi":
      return badgeColor("brand");
    case "cash":
      return badgeColor("emerald");
    case "bank":
      return badgeColor("blue");
    case "cheque":
      return badgeColor("amber");
    default:
      return badgeColorFallback;
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
  const dateRange = useDateRange("expenses", "this-month");
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const deleteConfirm = useDeleteConfirmation();
  const [form, setForm] = useState<ExpenseFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ExpenseFormState, string>>>({});
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter, dateRange.fromDate, dateRange.toDate]);

  const loadMore = useCallback(() => setPage((p) => p + 1), []);

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

  const { data, isFetching, isLoading } = trpc.expense.list.useQuery({
    page,
    limit: EXPENSE_PAGE_SIZE,
    search: debouncedSearch || undefined,
    category: categoryFilter || undefined,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
  }, {
    placeholderData: (prev) => prev,
  });

  const list = useInfiniteList({
    key: "expenses",
    data: data?.data,
    total: data?.total ?? 0,
    page,
    isFetching,
    onLoadMore: loadMore,
    resetDeps: [debouncedSearch, categoryFilter, dateRange.fromDate, dateRange.toDate],
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
      deleteConfirm.cancelDelete();
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
      let hasMore = true;
      while (hasMore) {
        const result = await utils.expense.list.fetch({
          page: pg,
          limit: 100,
          search: debouncedSearch || undefined,
          category: categoryFilter || undefined,
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Date", "Category", "Description", "Mode", "Reference", "Amount"];
      const rows = allData.map((exp: any) => [
        formatDate(exp.expenseDate),
        exp.category || "",
        exp.description || "",
        exp.mode,
        exp.referenceNumber || "",
        exp.amount,
      ]);

      downloadCSV(`expenses_${dateRange.preset}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

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
          <button className="btn-primary" onClick={openAdd}>
            + New Expense
          </button>
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
          <DateRangeBar
            preset={dateRange.preset}
            onPresetChange={dateRange.setPreset}
            customFrom={dateRange.customFrom}
            customTo={dateRange.customTo}
            onCustomChange={dateRange.setCustomRange}
            onExport={exportExpensesCSV}
            exporting={exporting}
            className="flex-1"
          />
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
        ) : !list.items.length && !isFetching ? (
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
            <div
              ref={list.scrollRef}
              onScroll={list.onScroll}
              className="max-h-[600px] overflow-y-auto overflow-x-auto"
            >
              <table className="data-table">
                <thead className="sticky top-0 z-10">
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
                  {list.items.map((exp) => (
                    <tr key={exp.id} className="group">
                      <td className="text-text-secondary whitespace-nowrap">
                        {formatDate(exp.expenseDate)}
                      </td>
                      <td>
                        <Badge size="md" color="bg-surface-2 text-text-secondary">
                          {exp.category}
                        </Badge>
                      </td>
                      <td className="text-text-primary max-w-[200px] truncate">
                        {exp.description || "—"}
                      </td>
                      <td>
                        <Badge size="sm" color={modeColor(exp.mode)} className="uppercase">
                          {exp.mode}
                        </Badge>
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
                            onClick={() => deleteConfirm.requestDelete(exp.id, exp.description || exp.category)}
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
              {!list.hasMore && list.items.length > EXPENSE_PAGE_SIZE && (
                <div className="py-2 text-center text-xs text-text-tertiary border-t border-border-light">
                  All {list.total.toLocaleString()} records loaded
                </div>
              )}
            </div>

            {/* Footer: total count */}
            <div className="px-4 py-3 border-t border-border-light">
              <p className="text-xs text-text-tertiary">
                {list.total.toLocaleString()} expense{list.total !== 1 ? "s" : ""}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Add / Edit SlideOver */}
      <SlideOver
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditExpenseId(null);
        }}
        title={editExpenseId ? "Edit Expense" : "Add Expense"}
        description={editExpenseId ? "Update expense details" : "Record a new business expense"}
        footer={
          <div className="flex justify-end gap-3">
            <button
              className="btn-secondary"
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
        }
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
                autoFocus
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
        </div>
      </SlideOver>

      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Expense"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteConfirm.deleteTarget && deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id })}
        onCancel={deleteConfirm.cancelDelete}
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
