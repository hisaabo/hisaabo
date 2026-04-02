import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { PartyCombobox } from "@/components/ui/PartyCombobox";
import { SearchInput } from "@/components/ui/SearchInput";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export const Route = createFileRoute("/automated-invoices")({
  component: AutomatedInvoicesPage,
});

// ── Constants ──────────────────────────────────────────────────

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

const TYPE_OPTIONS = [
  { value: "sale", label: "Sale" },
  { value: "purchase", label: "Purchase" },
];

const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Every 6 Months" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Every 6 Months",
  yearly: "Yearly",
  custom: "Custom",
};

function frequencyLabel(frequency: string, customDays?: number | null): string {
  if (frequency === "custom" && customDays) {
    return `Custom (${customDays} days)`;
  }
  return FREQUENCY_LABELS[frequency] || frequency;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400";
    case "paused":
      return "bg-amber-600/[0.08] text-amber-700 dark:text-amber-400";
    case "completed":
      return "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400";
    case "expired":
      return "bg-surface-2 text-text-secondary";
    default:
      return "bg-surface-2 text-text-secondary";
  }
}

// ── Form state types ───────────────────────────────────────────

type LineItemForm = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  itemId?: string;
};

type TemplateFormState = {
  name: string;
  partyId: string;
  type: string;
  frequency: string;
  customIntervalDays: string;
  lineItems: LineItemForm[];
  startDate: string;
  endDate: string;
  maxRuns: string;
  notes: string;
  termsAndConditions: string;
};

const EMPTY_LINE_ITEM: LineItemForm = {
  description: "",
  quantity: "1",
  unitPrice: "",
  taxPercent: "0",
  discountPercent: "0",
};

const TODAY_ISO = new Date().toISOString().split("T")[0];

const EMPTY_FORM: TemplateFormState = {
  name: "",
  partyId: "",
  type: "sale",
  frequency: "monthly",
  customIntervalDays: "",
  lineItems: [{ ...EMPTY_LINE_ITEM }],
  startDate: TODAY_ISO,
  endDate: "",
  maxRuns: "",
  notes: "",
  termsAndConditions: "",
};

// ── Main page component ────────────────────────────────────────

function AutomatedInvoicesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [showFormSlideOver, setShowFormSlideOver] = useState(false);
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [detailTemplateId, setDetailTemplateId] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<string, string>>>({});

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  useHotkeys([
    {
      key: "n",
      handler: () => openAdd(),
      description: "New automated invoice",
      scope: "automated-invoices",
    },
  ]);

  // ── Queries ────────────────────────────────────────────────────

  const { data, isFetching, isLoading } = trpc.recurringInvoice.list.useQuery({
    status: (statusFilter || undefined) as "active" | "paused" | "completed" | "expired" | undefined,
    page,
    limit: PAGE_SIZE,
  });

  const templates = data?.data ?? [];
  const total = data?.total ?? 0;

  const { data: planUsage } = trpc.recurringInvoice.planUsage.useQuery();
  const { data: suggestions } = trpc.recurringInvoice.suggestions.useQuery();
  // Party search handled by PartyCombobox component
  const { data: items } = trpc.item.list.useQuery({ page: 1, limit: 500 });

  const utils = trpc.useUtils();

  // ── Mutations ──────────────────────────────────────────────────

  const createMutation = trpc.recurringInvoice.create.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      utils.recurringInvoice.planUsage.invalidate();
      toast.success("Automated invoice template created");
      closeForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.recurringInvoice.update.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      toast.success("Template updated");
      closeForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.recurringInvoice.delete.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      utils.recurringInvoice.planUsage.invalidate();
      toast.success("Template deleted");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const pauseMutation = trpc.recurringInvoice.pause.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      toast.success("Template paused");
    },
    onError: (err) => toast.error(err.message),
  });

  const resumeMutation = trpc.recurringInvoice.resume.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      toast.success("Template resumed");
    },
    onError: (err) => toast.error(err.message),
  });

  const runNowMutation = trpc.recurringInvoice.runNow.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      utils.recurringInvoice.planUsage.invalidate();
      toast.success("Invoice generated successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Form helpers ───────────────────────────────────────────────

  function openAdd() {
    setEditTemplateId(null);
    setForm({ ...EMPTY_FORM, startDate: new Date().toISOString().split("T")[0] });
    setFormErrors({});
    setShowFormSlideOver(true);
  }

  function openEdit(template: any) {
    setEditTemplateId(template.id);
    // Fetch full template details for editing
    utils.recurringInvoice.getById.fetch({ id: template.id }).then((full) => {
      setForm({
        name: full.name || "",
        partyId: full.partyId || "",
        type: full.type || "sale",
        frequency: full.frequency || "monthly",
        customIntervalDays: full.customIntervalDays ? String(full.customIntervalDays) : "",
        lineItems:
          full.lineItems && full.lineItems.length > 0
            ? full.lineItems.map((li: any) => ({
                description: li.description || "",
                quantity: String(li.quantity ?? "1"),
                unitPrice: String(li.unitPrice ?? ""),
                taxPercent: String(li.taxPercent ?? "0"),
                discountPercent: String(li.discountPercent ?? "0"),
                itemId: li.itemId || undefined,
              }))
            : [{ ...EMPTY_LINE_ITEM }],
        startDate: full.startDate ? new Date(full.startDate).toISOString().split("T")[0] : TODAY_ISO,
        endDate: full.endDate ? new Date(full.endDate).toISOString().split("T")[0] : "",
        maxRuns: full.maxRuns ? String(full.maxRuns) : "",
        notes: full.notes || "",
        termsAndConditions: full.termsAndConditions || "",
      });
      setFormErrors({});
      setShowFormSlideOver(true);
    }).catch((err) => toast.error(err.message));
  }

  function closeForm() {
    setShowFormSlideOver(false);
    setEditTemplateId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
  }

  function validateForm(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.partyId) errs.partyId = "Party is required";
    if (!form.type) errs.type = "Type is required";
    if (!form.frequency) errs.frequency = "Frequency is required";
    if (form.frequency === "custom") {
      const days = parseInt(form.customIntervalDays);
      if (!days || days < 1) errs.customIntervalDays = "Valid interval required";
    }
    if (!form.startDate) errs.startDate = "Start date is required";

    // Validate line items
    const hasValidLineItem = form.lineItems.some(
      (li) => li.description.trim() && li.unitPrice && parseFloat(li.unitPrice) > 0
    );
    if (!hasValidLineItem) errs.lineItems = "At least one line item with description and price is required";

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validateForm()) return;

    const lineItems = form.lineItems
      .filter((li) => li.description.trim() || li.unitPrice)
      .map((li) => ({
        description: li.description.trim(),
        quantity: li.quantity ? parseFloat(li.quantity).toString() : "1",
        unitPrice: parseFloat(li.unitPrice).toFixed(2),
        taxPercent: li.taxPercent ? parseFloat(li.taxPercent).toString() : "0",
        discountPercent: li.discountPercent ? parseFloat(li.discountPercent).toString() : "0",
        itemId: li.itemId || undefined,
      }));

    if (editTemplateId) {
      updateMutation.mutate({
        id: editTemplateId,
        data: {
          name: form.name.trim(),
          partyId: form.partyId,
          type: form.type as "sale" | "purchase",
          frequency: form.frequency as any,
          customIntervalDays: form.frequency === "custom" ? parseInt(form.customIntervalDays) : undefined,
          lineItems,
          endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
          maxRuns: form.maxRuns ? parseInt(form.maxRuns) : undefined,
          notes: form.notes.trim() || undefined,
          termsAndConditions: form.termsAndConditions.trim() || undefined,
        },
      });
    } else {
      createMutation.mutate({
        name: form.name.trim(),
        partyId: form.partyId,
        type: form.type as "sale" | "purchase",
        frequency: form.frequency as any,
        customIntervalDays: form.frequency === "custom" ? parseInt(form.customIntervalDays) : undefined,
        lineItems,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
        maxRuns: form.maxRuns ? parseInt(form.maxRuns) : undefined,
        notes: form.notes.trim() || undefined,
        termsAndConditions: form.termsAndConditions.trim() || undefined,
      });
    }
  }

  // ── Line item helpers ──────────────────────────────────────────

  function updateLineItem(index: number, field: keyof LineItemForm, value: string) {
    setForm((f) => {
      const updated = [...f.lineItems];
      updated[index] = { ...updated[index], [field]: value };
      return { ...f, lineItems: updated };
    });
  }

  function addLineItem() {
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { ...EMPTY_LINE_ITEM }] }));
  }

  function removeLineItem(index: number) {
    setForm((f) => {
      if (f.lineItems.length <= 1) return f;
      return { ...f, lineItems: f.lineItems.filter((_, i) => i !== index) };
    });
  }

  // ── Suggestion helper ──────────────────────────────────────────

  function createFromSuggestion(suggestion: any) {
    setEditTemplateId(null);
    setForm({
      ...EMPTY_FORM,
      partyId: suggestion.partyId,
      type: suggestion.type || "sale",
      frequency: suggestion.suggestedFrequency || "monthly",
      name: `${suggestion.partyName} - ${suggestion.type === "purchase" ? "Purchase" : "Sales"} Invoice`,
      startDate: new Date().toISOString().split("T")[0],
      lineItems: [{ ...EMPTY_LINE_ITEM }],
    });
    setFormErrors({});
    setShowFormSlideOver(true);
  }

  // ── Computed ───────────────────────────────────────────────────

  const isSubmitting = createMutation.isPending || updateMutation.isPending;


  const itemOptions = (items?.data ?? []).map((i: any) => ({
    value: i.id,
    label: i.name,
  }));

  // Filter templates by search client-side (name, partyName)
  const filteredTemplates = debouncedSearch
    ? templates.filter(
        (t: any) =>
          t.name?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          t.partyName?.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : templates;

  // ── Pagination ─────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Automated Invoices"
        description="Manage recurring invoice templates"
        actions={
          <button className="btn-primary" onClick={openAdd}>
            + New Template
          </button>
        }
      />

      {/* Plan Usage Bar */}
      {planUsage && (
        <div className="card mb-5 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">
              Automated Runs This Month
            </span>
            <span className="text-sm tabular-nums text-text-secondary">
              {planUsage.runsThisMonth} / 5
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                planUsage.runsThisMonth >= 5
                  ? "bg-red-500"
                  : planUsage.runsThisMonth >= 4
                    ? "bg-amber-500"
                    : "bg-brand-600"
              )}
              style={{ width: `${Math.min(100, (planUsage.runsThisMonth / 5) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-text-tertiary mt-1.5">
            {planUsage.totalTemplates} template{planUsage.totalTemplates !== 1 ? "s" : ""} configured
          </p>
        </div>
      )}

      {/* Suggestions Panel */}
      {suggestions && suggestions.length > 0 && (
        <div className="card mb-5 overflow-hidden">
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between text-left border-b border-border-light hover:bg-surface-1 transition-colors"
            onClick={() => setSuggestionsOpen((o) => !o)}
          >
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-brand-600/10">
                <SuggestionIcon />
              </span>
              <span className="text-sm font-medium text-text-primary">
                Smart Suggestions
              </span>
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400">
                {suggestions.length}
              </span>
            </div>
            <svg
              className={cn("w-4 h-4 text-text-tertiary transition-transform", suggestionsOpen && "rotate-180")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {suggestionsOpen && (
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-text-tertiary mb-2">
                Based on your invoicing patterns, we detected these recurring relationships:
              </p>
              {suggestions.map((s: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface-1 border border-border-light"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {s.partyName}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {s.invoiceCount} invoices &middot; ~{frequencyLabel(s.suggestedFrequency)} &middot; Median {formatCurrency(s.medianAmount)}
                    </p>
                  </div>
                  <button
                    className="btn-primary text-xs px-3 py-1.5 shrink-0"
                    onClick={() => createFromSuggestion(s)}
                  >
                    Create Template
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters + Table */}
      <div className="card mb-5 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-border-light">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search templates..."
            className="max-w-xs"
          />
        </div>

        <div className="px-4 py-2 border-b border-border-light">
          <PillTabs
            tabs={STATUS_TABS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <TemplateTableSkeleton />
        ) : !filteredTemplates.length && !isFetching ? (
          <EmptyState
            title="No automated invoices"
            description={
              search || statusFilter
                ? "No templates match your filters"
                : "Create your first recurring invoice template to automate billing"
            }
            action={
              !search && !statusFilter ? (
                <button className="btn-primary text-sm" onClick={openAdd}>
                  + Create Template
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Party</th>
                    <th>Frequency</th>
                    <th>Status</th>
                    <th>Next Run</th>
                    <th className="text-right">Runs</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTemplates.map((template: any) => (
                    <tr
                      key={template.id}
                      className="group cursor-pointer"
                      onClick={() => setDetailTemplateId(template.id)}
                    >
                      <td className="text-text-primary font-medium max-w-[200px] truncate">
                        {template.name || "Untitled"}
                      </td>
                      <td className="text-text-secondary truncate max-w-[150px]">
                        {template.partyName || "—"}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap text-xs">
                        {frequencyLabel(template.frequency, template.customIntervalDays)}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                            statusColor(template.status)
                          )}
                        >
                          {template.status}
                        </span>
                      </td>
                      <td className="text-text-secondary whitespace-nowrap text-xs">
                        {template.nextRunDate ? formatDate(template.nextRunDate) : "—"}
                      </td>
                      <td className="text-right tabular-nums text-text-secondary text-xs">
                        {template.totalRuns ?? 0}
                        {template.maxRuns ? ` / ${template.maxRuns}` : ""}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {template.status === "active" && (
                            <button
                              onClick={() => pauseMutation.mutate({ id: template.id })}
                              className="p-1.5 rounded-lg text-text-tertiary hover:text-amber-600 hover:bg-amber-600/[0.08] transition-colors"
                              aria-label="Pause template"
                              title="Pause"
                              disabled={pauseMutation.isPending}
                            >
                              <PauseIcon />
                            </button>
                          )}
                          {template.status === "paused" && (
                            <button
                              onClick={() => resumeMutation.mutate({ id: template.id })}
                              className="p-1.5 rounded-lg text-text-tertiary hover:text-emerald-600 hover:bg-emerald-600/[0.08] transition-colors"
                              aria-label="Resume template"
                              title="Resume"
                              disabled={resumeMutation.isPending}
                            >
                              <PlayIcon />
                            </button>
                          )}
                          {(template.status === "active" || template.status === "paused") && (
                            <button
                              onClick={() => runNowMutation.mutate({ id: template.id })}
                              className="p-1.5 rounded-lg text-text-tertiary hover:text-brand-600 hover:bg-brand-600/[0.08] transition-colors"
                              aria-label="Run now"
                              title="Run Now"
                              disabled={runNowMutation.isPending}
                            >
                              <RunNowIcon />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(template)}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
                            aria-label="Edit template"
                            title="Edit"
                          >
                            <EditIcon />
                          </button>
                          <button
                            onClick={() => setDeleteId(template.id)}
                            className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors"
                            aria-label="Delete template"
                            title="Delete"
                          >
                            <DeleteIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="px-4 py-3 border-t border-border-light flex items-center justify-between">
              <p className="text-xs text-text-tertiary">
                {total.toLocaleString()} template{total !== 1 ? "s" : ""}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    className="btn-ghost text-xs px-2 py-1"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-secondary tabular-nums px-2">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="btn-ghost text-xs px-2 py-1"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create / Edit SlideOver */}
      <SlideOver
        open={showFormSlideOver}
        onClose={closeForm}
        title={editTemplateId ? "Edit Template" : "Create Template"}
        description={editTemplateId ? "Update recurring invoice template" : "Set up a new recurring invoice"}
        footer={
          <div className="flex justify-end gap-3">
            <button
              className="btn-secondary"
              onClick={closeForm}
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
                ? editTemplateId
                  ? "Saving..."
                  : "Creating..."
                : editTemplateId
                  ? "Save Changes"
                  : "Create Template"}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Template name */}
          <InputField
            label="Template Name"
            placeholder="e.g. Monthly Website Hosting"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={formErrors.name}
            required
            autoFocus
          />

          {/* Party picker */}
          <PartyCombobox
            value={form.partyId}
            onChange={(val) => setForm((f) => ({ ...f, partyId: val }))}
            required
            error={formErrors.partyId}
          />

          {/* Type + Frequency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Type <span className="text-red-500">*</span>
              </label>
              <Listbox
                value={form.type}
                onChange={(val) => setForm((f) => ({ ...f, type: val }))}
                options={TYPE_OPTIONS}
              />
              {formErrors.type && (
                <p className="mt-1 text-xs text-red-500">{formErrors.type}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Frequency <span className="text-red-500">*</span>
              </label>
              <Listbox
                value={form.frequency}
                onChange={(val) => setForm((f) => ({ ...f, frequency: val }))}
                options={FREQUENCY_OPTIONS}
              />
              {formErrors.frequency && (
                <p className="mt-1 text-xs text-red-500">{formErrors.frequency}</p>
              )}
            </div>
          </div>

          {/* Custom interval days */}
          {form.frequency === "custom" && (
            <InputField
              label="Custom Interval (days)"
              placeholder="e.g. 45"
              type="number"
              min="1"
              value={form.customIntervalDays}
              onChange={(e) => setForm((f) => ({ ...f, customIntervalDays: e.target.value }))}
              error={formErrors.customIntervalDays}
              required
            />
          )}

          {/* Dates + Max Runs */}
          <div className="grid grid-cols-3 gap-4">
            <InputField
              label="Start Date"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              error={formErrors.startDate}
              required
            />
            <InputField
              label="End Date (optional)"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
            <InputField
              label="Max Runs (optional)"
              placeholder="Unlimited"
              type="number"
              min="1"
              value={form.maxRuns}
              onChange={(e) => setForm((f) => ({ ...f, maxRuns: e.target.value }))}
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-text-secondary">
                Line Items <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
                onClick={addLineItem}
              >
                + Add Item
              </button>
            </div>
            {formErrors.lineItems && (
              <p className="text-xs text-red-500 mb-2">{formErrors.lineItems}</p>
            )}
            <div className="space-y-3">
              {form.lineItems.map((li, idx) => (
                <div key={idx} className="p-3 rounded-lg border border-border-light bg-surface-1">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      {/* Item picker (optional) */}
                      {itemOptions.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-medium text-text-tertiary mb-1">
                            Item (optional)
                          </label>
                          <Listbox
                            value={li.itemId || ""}
                            onChange={(val) => {
                              updateLineItem(idx, "itemId", val);
                              // Auto-fill description from item name
                              const item = itemOptions.find((o: any) => o.value === val);
                              if (item) {
                                updateLineItem(idx, "description", item.label);
                              }
                            }}
                            options={[{ value: "", label: "None" }, ...itemOptions]}
                            placeholder="Link to an item..."
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-medium text-text-tertiary mb-1">
                          Description
                        </label>
                        <input
                          className="input text-sm"
                          placeholder="Item description"
                          value={li.description}
                          onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[10px] font-medium text-text-tertiary mb-1">
                            Qty
                          </label>
                          <input
                            className="input text-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="1"
                            value={li.quantity}
                            onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-text-tertiary mb-1">
                            Unit Price
                          </label>
                          <input
                            className="input text-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={li.unitPrice}
                            onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-text-tertiary mb-1">
                            Tax %
                          </label>
                          <input
                            className="input text-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0"
                            value={li.taxPercent}
                            onChange={(e) => updateLineItem(idx, "taxPercent", e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-text-tertiary mb-1">
                            Discount %
                          </label>
                          <input
                            className="input text-sm"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0"
                            value={li.discountPercent}
                            onChange={(e) => updateLineItem(idx, "discountPercent", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    {form.lineItems.length > 1 && (
                      <button
                        type="button"
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors mt-1 shrink-0"
                        onClick={() => removeLineItem(idx)}
                        aria-label="Remove line item"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes + Terms */}
          <TextareaField
            label="Notes (optional)"
            placeholder="Notes visible on the invoice"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
          />
          <TextareaField
            label="Terms & Conditions (optional)"
            placeholder="Payment terms, conditions, etc."
            value={form.termsAndConditions}
            onChange={(e) => setForm((f) => ({ ...f, termsAndConditions: e.target.value }))}
            rows={2}
          />
        </div>
      </SlideOver>

      {/* Detail SlideOver */}
      <TemplateDetailSlideOver
        templateId={detailTemplateId}
        onClose={() => setDetailTemplateId(null)}
        onEdit={(template) => {
          setDetailTemplateId(null);
          openEdit(template);
        }}
        onPause={(id) => pauseMutation.mutate({ id })}
        onResume={(id) => resumeMutation.mutate({ id })}
        onRunNow={(id) => runNowMutation.mutate({ id })}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        title="Delete Template"
        description="This will permanently delete this recurring invoice template and stop all future runs. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ── Detail SlideOver ─────────────────────────────────────────────

function TemplateDetailSlideOver({
  templateId,
  onClose,
  onEdit,
  onPause,
  onResume,
  onRunNow,
}: {
  templateId: string | null;
  onClose: () => void;
  onEdit: (template: any) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");
  const [historyPage, setHistoryPage] = useState(1);

  const { data: template } = trpc.recurringInvoice.getById.useQuery(
    { id: templateId! },
    { enabled: !!templateId }
  );

  const { data: history } = trpc.recurringInvoice.executionHistory.useQuery(
    { templateId: templateId!, page: historyPage, limit: 20 },
    { enabled: !!templateId && activeTab === "history" }
  );

  // Reset tab when opening a new template
  useEffect(() => {
    if (templateId) {
      setActiveTab("details");
      setHistoryPage(1);
    }
  }, [templateId]);

  if (!templateId) return null;

  const detailTabs = [
    { value: "details", label: "Details" },
    { value: "history", label: "Execution History" },
  ];

  return (
    <SlideOver
      open={!!templateId}
      onClose={onClose}
      title={template?.name || "Template Details"}
      description={template ? `${frequencyLabel(template.frequency, template.customIntervalDays)} ${template.type} invoice` : undefined}
      footer={
        template ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {template.status === "active" && (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => onPause(template.id)}
                >
                  Pause
                </button>
              )}
              {template.status === "paused" && (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => onResume(template.id)}
                >
                  Resume
                </button>
              )}
              {(template.status === "active" || template.status === "paused") && (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => onRunNow(template.id)}
                >
                  Run Now
                </button>
              )}
            </div>
            <button
              className="btn-primary text-sm"
              onClick={() => onEdit(template)}
            >
              Edit Template
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-4">
        <PillTabs
          tabs={detailTabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as "details" | "history")}
          size="sm"
        />
      </div>

      {activeTab === "details" && template && (
        <div className="space-y-5">
          {/* Status + Type badges */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium uppercase",
                statusColor(template.status)
              )}
            >
              {template.status}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-surface-2 text-text-secondary uppercase">
              {template.type}
            </span>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <DetailField label="Party" value={template.partyName || "—"} />
            <DetailField label="Frequency" value={frequencyLabel(template.frequency, template.customIntervalDays)} />
            <DetailField label="Start Date" value={formatDate(template.startDate)} />
            <DetailField label="End Date" value={template.endDate ? formatDate(template.endDate) : "No end date"} />
            <DetailField label="Next Run" value={template.nextRunDate ? formatDate(template.nextRunDate) : "—"} />
            <DetailField label="Last Run" value={template.lastRunDate ? formatDate(template.lastRunDate) : "Never"} />
            <DetailField label="Total Runs" value={String(template.totalRuns ?? 0)} />
            <DetailField label="Max Runs" value={template.maxRuns ? String(template.maxRuns) : "Unlimited"} />
          </div>

          {/* Line items table */}
          {template.lineItems && template.lineItems.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-2">Line Items</h4>
              <div className="border border-border-light rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-1">
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Description</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Qty</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Price</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Tax%</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {template.lineItems.map((li: any, idx: number) => {
                      const qty = parseFloat(li.quantity) || 0;
                      const price = parseFloat(li.unitPrice) || 0;
                      const discount = parseFloat(li.discountPercent) || 0;
                      const subtotal = qty * price * (1 - discount / 100);
                      const tax = parseFloat(li.taxPercent) || 0;
                      const total = subtotal * (1 + tax / 100);
                      return (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-text-primary">{li.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{li.quantity}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatCurrency(li.unitPrice)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{li.taxPercent}%</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-text-primary">{formatCurrency(total.toFixed(2))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notes / Terms */}
          {template.notes && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-1">Notes</h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{template.notes}</p>
            </div>
          )}
          {template.termsAndConditions && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-1">Terms & Conditions</h4>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{template.termsAndConditions}</p>
            </div>
          )}

          <div className="text-xs text-text-tertiary">
            Created {formatDate(template.createdAt)}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div>
          {!history?.data?.length ? (
            <EmptyState
              title="No execution history"
              description="This template hasn't been run yet"
            />
          ) : (
            <>
              <div className="border border-border-light rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-1">
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Date</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Invoice #</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Status</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-text-tertiary uppercase">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {history.data.map((exec: any) => (
                      <tr key={exec.id}>
                        <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                          {formatDate(exec.executedAt)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-text-primary">
                          {exec.invoiceNumber || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                              exec.status === "success"
                                ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                                : "bg-red-600/[0.08] text-red-700 dark:text-red-400"
                            )}
                          >
                            {exec.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-red-500 max-w-[200px] truncate">
                          {exec.errorMessage || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* History pagination */}
              {history.total > 20 && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    className="btn-ghost text-xs px-2 py-1"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-secondary tabular-nums">
                    Page {historyPage}
                  </span>
                  <button
                    className="btn-ghost text-xs px-2 py-1"
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={history.data.length < 20}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </SlideOver>
  );
}

// ── Detail field helper ──────────────────────────────────────────

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-text-tertiary uppercase">{label}</dt>
      <dd className="text-sm text-text-primary mt-0.5">{value}</dd>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────

function TemplateTableSkeleton() {
  return (
    <div className="divide-y divide-border-light">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4">
          <div className="h-3.5 w-32 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-24 bg-surface-2 rounded animate-pulse" />
          <div className="h-5 w-16 bg-surface-2 rounded animate-pulse" />
          <div className="h-5 w-14 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-20 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-12 bg-surface-2 rounded animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────

function PauseIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
    </svg>
  );
}

function RunNowIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function SuggestionIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}
