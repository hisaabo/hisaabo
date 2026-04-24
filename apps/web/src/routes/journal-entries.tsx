import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn, todayISODate, toISOString, formatDateInput } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useDateRange } from "@/hooks/useDateRange";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { SegmentedControl } from "@/components/ui/Tabs";

export const Route = createFileRoute("/journal-entries")({
  component: JournalEntriesPage,
});

// ── Types ──────────────────────────────────────────────────────

type JournalLine = {
  accountId: string;
  debit: string;
  credit: string;
  narration: string;
};

type EntryFormState = {
  entryDate: string;
  narration: string;
  lines: JournalLine[];
};

const EMPTY_LINE: JournalLine = {
  accountId: "",
  debit: "",
  credit: "",
  narration: "",
};

const TODAY_ISO = todayISODate();

const EMPTY_FORM: EntryFormState = {
  entryDate: TODAY_ISO,
  narration: "",
  lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
};

const PAGE_TABS = [
  { value: "entries", label: "Entries" },
  { value: "templates", label: "Templates" },
];

// ── Main Page ──────────────────────────────────────────────────

function JournalEntriesPage() {
  const [activeTab, setActiveTab] = useState("entries");
  const [showForm, setShowForm] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [voidEntryId, setVoidEntryId] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [form, setForm] = useState<EntryFormState>({ ...EMPTY_FORM });
  const deleteTemplateConfirm = useDeleteConfirmation();
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [saveAsTemplateEntry, setSaveAsTemplateEntry] = useState<any>(null);

  const dateRange = useDateRange("journal-entries", "this-fy");

  const utils = trpc.useUtils();

  // ── Queries ────────────────────────────────────────────────

  const { data: entries, isLoading } = trpc.journal.list.useQuery(
    {
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
    },
    { placeholderData: (prev) => prev }
  );

  const { data: accounts } = trpc.account.list.useQuery();

  const { data: templates } = trpc.journal.templateList.useQuery(undefined, {
    enabled: activeTab === "templates",
  });

  const { data: expandedEntry, isFetching: isFetchingDetail } =
    trpc.journal.getById.useQuery(
      { id: expandedEntryId! },
      { enabled: !!expandedEntryId }
    );

  // ── Account options for Combobox ───────────────────────────

  const accountOptions: ComboboxOption[] = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.isActive)
        .map((a) => ({
          value: a.id,
          label: `${a.code} - ${a.name}`,
          description: a.accountType,
        })),
    [accounts]
  );

  // ── Mutations ──────────────────────────────────────────────

  const createMutation = trpc.journal.create.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      toast.success("Journal entry created");
      closeForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.journal.update.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      utils.journal.getById.invalidate();
      toast.success("Journal entry updated");
      closeForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const voidMutation = trpc.journal.void.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      utils.journal.getById.invalidate();
      toast.success("Journal entry voided");
      setVoidEntryId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const templateCreateMutation = trpc.journal.templateCreate.useMutation({
    onSuccess: () => {
      utils.journal.templateList.invalidate();
      toast.success("Template saved");
      setShowSaveAsTemplate(false);
      setSaveAsTemplateName("");
      setSaveAsTemplateEntry(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const templateDeleteMutation = trpc.journal.templateDelete.useMutation({
    onSuccess: () => {
      utils.journal.templateList.invalidate();
      toast.success("Template deleted");
      deleteTemplateConfirm.cancelDelete();
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Hotkeys ────────────────────────────────────────────────

  useHotkeys([
    {
      key: "n",
      handler: () => openCreate(),
      description: "New journal entry",
      scope: "journal-entries",
    },
  ]);

  // ── Form helpers ───────────────────────────────────────────

  function openCreate() {
    setEditEntryId(null);
    setForm({
      entryDate: todayISODate(),
      narration: "",
      lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
    });
    setShowForm(true);
  }

  function openEdit(entry: any) {
    if (!expandedEntry) return;
    setEditEntryId(entry.id);
    setForm({
      entryDate: formatDateInput(entry.entryDate),
      narration: entry.narration || "",
      lines: expandedEntry.lines.map((l: any) => ({
        accountId: l.accountId,
        debit: l.debit && parseFloat(l.debit) > 0 ? l.debit : "",
        credit: l.credit && parseFloat(l.credit) > 0 ? l.credit : "",
        narration: l.narration || "",
      })),
    });
    setShowForm(true);
  }

  function openFromTemplate(template: any) {
    setEditEntryId(null);
    setForm({
      entryDate: todayISODate(),
      narration: template.narration || "",
      lines: template.lines.map((l: any) => ({
        accountId: l.accountId,
        debit: l.debit && parseFloat(l.debit) > 0 ? l.debit : "",
        credit: l.credit && parseFloat(l.credit) > 0 ? l.credit : "",
        narration: l.narration || "",
      })),
    });
    setShowForm(true);
    setActiveTab("entries");
  }

  function closeForm() {
    setShowForm(false);
    setEditEntryId(null);
    setForm({ ...EMPTY_FORM });
  }

  function updateLine(index: number, field: keyof JournalLine, value: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
    }));
  }

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }));
  }

  function removeLine(index: number) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((_, i) => i !== index),
    }));
  }

  // ── Totals & validation ────────────────────────────────────

  const totalDebit = form.lines.reduce(
    (sum, l) => sum + (parseFloat(l.debit) || 0),
    0
  );
  const totalCredit = form.lines.reduce(
    (sum, l) => sum + (parseFloat(l.credit) || 0),
    0
  );
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const hasEnoughLines = form.lines.filter((l) => l.accountId).length >= 2;
  const hasTotals = totalDebit > 0 || totalCredit > 0;
  const canSubmit = isBalanced && hasEnoughLines && hasTotals;

  function handleSubmit() {
    if (!canSubmit) return;

    const lines = form.lines
      .filter((l) => l.accountId)
      .map((l) => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit || "0").toFixed(2),
        credit: parseFloat(l.credit || "0").toFixed(2),
        narration: l.narration || undefined,
      }));

    const entryDateISO = toISOString(form.entryDate);
    if (!entryDateISO) return;
    if (editEntryId) {
      updateMutation.mutate({
        id: editEntryId,
        entryDate: entryDateISO,
        narration: form.narration.trim() || undefined,
        lines,
      });
    } else {
      createMutation.mutate({
        entryDate: entryDateISO,
        narration: form.narration.trim() || undefined,
        lines,
      });
    }
  }

  function handleSaveAsTemplate(entry: any) {
    setSaveAsTemplateEntry(entry);
    setSaveAsTemplateName("");
    setShowSaveAsTemplate(true);
  }

  function submitSaveAsTemplate() {
    if (!saveAsTemplateEntry || !saveAsTemplateName.trim()) return;
    if (!expandedEntry) return;

    templateCreateMutation.mutate({
      name: saveAsTemplateName.trim(),
      narration: saveAsTemplateEntry.narration || undefined,
      lines: expandedEntry.lines.map((l: any) => ({
        accountId: l.accountId,
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration || undefined,
      })),
    });
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        description="Double-entry journal for manual accounting adjustments"
        actions={
          <button className="btn-primary" onClick={openCreate}>
            + New Entry
          </button>
        }
      />

      {/* Tab switcher */}
      <div className="mb-5">
        <SegmentedControl
          tabs={PAGE_TABS}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {activeTab === "entries" ? (
        <EntriesTab
          entries={entries}
          isLoading={isLoading}
          dateRange={dateRange}
          expandedEntryId={expandedEntryId}
          expandedEntry={expandedEntry}
          isFetchingDetail={isFetchingDetail}
          onToggleExpand={(id) =>
            setExpandedEntryId((prev) => (prev === id ? null : id))
          }
          onEdit={openEdit}
          onVoid={(id) => setVoidEntryId(id)}
          onSaveAsTemplate={handleSaveAsTemplate}
        />
      ) : (
        <TemplatesTab
          templates={templates}
          onUse={openFromTemplate}
          onDelete={(id, name) => deleteTemplateConfirm.requestDelete(id, name)}
        />
      )}

      {/* Create / Edit SlideOver */}
      <SlideOver
        open={showForm}
        onClose={closeForm}
        title={editEntryId ? "Edit Journal Entry" : "New Journal Entry"}
        description={
          editEntryId
            ? "Update entry details and line items"
            : "Record a manual double-entry journal entry"
        }
        footer={
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {hasTotals && (
                isBalanced ? (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Balanced
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
                    </svg>
                    Unbalanced ({formatCurrency(Math.abs(totalDebit - totalCredit))})
                  </span>
                )
              )}
            </div>
            <div className="flex items-center gap-3">
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
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting
                  ? editEntryId
                    ? "Saving..."
                    : "Creating..."
                  : editEntryId
                    ? "Save Changes"
                    : "Create Entry"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Date"
              type="date"
              value={form.entryDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, entryDate: e.target.value }))
              }
              required
              autoFocus
            />
            <div className="col-span-2">
              <TextareaField
                label="Narration"
                placeholder="Purpose of this journal entry..."
                value={form.narration}
                onChange={(e) =>
                  setForm((f) => ({ ...f, narration: e.target.value }))
                }
                rows={2}
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="label mb-0">Line Items</label>
              <button
                type="button"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                onClick={addLine}
              >
                + Add Row
              </button>
            </div>

            <div className="space-y-3">
              {form.lines.map((line, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border-light p-3 space-y-3 bg-surface-1/50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <Combobox
                        value={line.accountId}
                        onChange={(val) => updateLine(idx, "accountId", val)}
                        options={accountOptions}
                        placeholder="Search account..."
                        label="Account"
                        required
                      />
                    </div>
                    {form.lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="mt-6 p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors shrink-0"
                        aria-label="Remove line"
                      >
                        <svg
                          className="w-3.5 h-3.5"
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
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <InputField
                      label="Debit"
                      placeholder="0.00"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit}
                      onChange={(e) => {
                        updateLine(idx, "debit", e.target.value);
                        if (e.target.value && parseFloat(e.target.value) > 0) {
                          updateLine(idx, "credit", "");
                        }
                      }}
                    />
                    <InputField
                      label="Credit"
                      placeholder="0.00"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit}
                      onChange={(e) => {
                        updateLine(idx, "credit", e.target.value);
                        if (e.target.value && parseFloat(e.target.value) > 0) {
                          updateLine(idx, "debit", "");
                        }
                      }}
                    />
                    <InputField
                      label="Note"
                      placeholder="Optional"
                      value={line.narration}
                      onChange={(e) =>
                        updateLine(idx, "narration", e.target.value)
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Totals bar */}
            <div className="mt-4 rounded-lg border border-border-light bg-surface-1 px-4 py-3">
              <div className="grid grid-cols-3 gap-3 text-sm font-medium">
                <div>
                  <span className="text-text-tertiary text-xs">
                    Total Debit
                  </span>
                  <p className="tabular-nums text-text-primary">
                    {formatCurrency(totalDebit)}
                  </p>
                </div>
                <div>
                  <span className="text-text-tertiary text-xs">
                    Total Credit
                  </span>
                  <p className="tabular-nums text-text-primary">
                    {formatCurrency(totalCredit)}
                  </p>
                </div>
                <div>
                  <span className="text-text-tertiary text-xs">Difference</span>
                  <p
                    className={cn(
                      "tabular-nums",
                      isBalanced
                        ? "text-emerald-600"
                        : "text-red-500 font-semibold"
                    )}
                  >
                    {formatCurrency(Math.abs(totalDebit - totalCredit))}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SlideOver>

      {/* Void confirmation */}
      <ConfirmDialog
        open={!!voidEntryId}
        onCancel={() => setVoidEntryId(null)}
        onConfirm={() => voidEntryId && voidMutation.mutate({ id: voidEntryId })}
        title="Void Journal Entry"
        description="This will create a reversing entry that cancels out this journal entry. This action cannot be undone."
        confirmLabel="Confirm Void"
        variant="danger"
        loading={voidMutation.isPending}
      />

      {/* Save as template dialog with name input */}
      {showSaveAsTemplate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => {
              setShowSaveAsTemplate(false);
              setSaveAsTemplateName("");
              setSaveAsTemplateEntry(null);
            }}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl shadow-modal bg-surface-0 p-6">
            <p className="text-sm font-semibold text-text-primary mb-1">
              Save as Template
            </p>
            <p className="text-sm text-text-secondary mb-4">
              Give this template a name so you can quickly re-use it.
            </p>
            <InputField
              label="Template Name"
              placeholder="e.g. Monthly rent adjustment"
              value={saveAsTemplateName}
              onChange={(e) => setSaveAsTemplateName(e.target.value)}
              required
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border-light">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setShowSaveAsTemplate(false);
                  setSaveAsTemplateName("");
                  setSaveAsTemplateEntry(null);
                }}
                disabled={templateCreateMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submitSaveAsTemplate}
                disabled={
                  !saveAsTemplateName.trim() ||
                  templateCreateMutation.isPending
                }
              >
                {templateCreateMutation.isPending
                  ? "Saving..."
                  : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete template confirmation */}
      <DeleteConfirmDialog
        target={deleteTemplateConfirm.deleteTarget}
        entityName="Template"
        loading={templateDeleteMutation.isPending}
        onConfirm={() =>
          deleteTemplateConfirm.deleteTarget &&
          templateDeleteMutation.mutate({ id: deleteTemplateConfirm.deleteTarget.id })
        }
        onCancel={deleteTemplateConfirm.cancelDelete}
      />
    </div>
  );
}

// ── Entries Tab ─────────────────────────────────────────────────

function EntriesTab({
  entries,
  isLoading,
  dateRange,
  expandedEntryId,
  expandedEntry,
  isFetchingDetail,
  onToggleExpand,
  onEdit,
  onVoid,
  onSaveAsTemplate,
}: {
  entries: any;
  isLoading: boolean;
  dateRange: ReturnType<typeof useDateRange>;
  expandedEntryId: string | null;
  expandedEntry: any;
  isFetchingDetail: boolean;
  onToggleExpand: (id: string) => void;
  onEdit: (entry: any) => void;
  onVoid: (id: string) => void;
  onSaveAsTemplate: (entry: any) => void;
}) {
  return (
    <div className="card mb-5 overflow-hidden">
      {/* Date filters */}
      <div className="px-4 py-3 border-b border-border-light">
        <DateRangeBar
          preset={dateRange.preset}
          onPresetChange={dateRange.setPreset}
          customFrom={dateRange.customFrom}
          customTo={dateRange.customTo}
          onCustomChange={dateRange.setCustomRange}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <JournalTableSkeleton />
      ) : !entries?.length ? (
        <EmptyState
          title="No journal entries"
          description="Create your first journal entry to record manual accounting adjustments"
        />
      ) : (
        <>
          <div className="max-h-[600px] overflow-y-auto overflow-x-auto">
            <table className="data-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8"></th>
                  <th>Entry #</th>
                  <th>Date</th>
                  <th>Narration</th>
                  <th className="text-right">Amount</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry: any) => {
                  const isExpanded = expandedEntryId === entry.id;
                  const isVoided = entry.isVoided;
                  const isManual = entry.source === "manual";

                  return (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={isExpanded}
                      isVoided={isVoided}
                      isManual={isManual}
                      expandedEntry={expandedEntry}
                      isFetchingDetail={isFetchingDetail}
                      onToggleExpand={() => onToggleExpand(entry.id)}
                      onEdit={() => onEdit(entry)}
                      onVoid={() => onVoid(entry.id)}
                      onSaveAsTemplate={() => onSaveAsTemplate(entry)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-border-light">
            <p className="text-xs text-text-tertiary">
              {entries.length.toLocaleString()} entr
              {entries.length !== 1 ? "ies" : "y"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Entry Row (with expandable detail) ─────────────────────────

function EntryRow({
  entry,
  isExpanded,
  isVoided,
  isManual,
  expandedEntry,
  isFetchingDetail,
  onToggleExpand,
  onEdit,
  onVoid,
  onSaveAsTemplate,
}: {
  entry: any;
  isExpanded: boolean;
  isVoided: boolean;
  isManual: boolean;
  expandedEntry: any;
  isFetchingDetail: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onVoid: () => void;
  onSaveAsTemplate: () => void;
}) {
  return (
    <>
      <tr
        className={cn(
          "group cursor-pointer transition-colors hover:bg-surface-1",
          isVoided && "opacity-60",
          isExpanded && "bg-surface-1"
        )}
        onClick={onToggleExpand}
      >
        {/* Expand chevron */}
        <td className="w-8 text-center">
          <svg
            className={cn(
              "w-3.5 h-3.5 text-text-tertiary transition-transform inline-block",
              isExpanded && "rotate-90"
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </td>

        {/* Entry number */}
        <td
          className={cn(
            "font-mono text-xs whitespace-nowrap",
            isVoided ? "line-through text-text-tertiary" : "text-text-primary"
          )}
        >
          {entry.entryNumber}
        </td>

        {/* Date */}
        <td className="text-text-secondary whitespace-nowrap">
          {formatDate(entry.entryDate)}
        </td>

        {/* Narration */}
        <td
          className={cn(
            "max-w-[250px] truncate",
            isVoided
              ? "line-through text-text-tertiary"
              : "text-text-primary"
          )}
        >
          {entry.narration || "--"}
        </td>

        {/* Amount */}
        <td className="text-right tabular-nums font-semibold whitespace-nowrap text-text-primary">
          {formatCurrency(entry.totalAmount)}
        </td>

        {/* Source badge */}
        <td>
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
              isManual
                ? "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400"
                : "bg-surface-2 text-text-secondary"
            )}
          >
            {isManual ? "Manual" : "System"}
          </span>
        </td>

        {/* Status */}
        <td>
          {isVoided ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-600/[0.08] text-red-600 dark:text-red-400">
              Voided
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400">
              Active
            </span>
          )}
        </td>

        {/* Actions */}
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          {isManual && !isVoided && (
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={onEdit}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
                aria-label="Edit entry"
                title="Edit"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>
              <button
                onClick={onVoid}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors"
                aria-label="Void entry"
                title="Void"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              </button>
              <button
                onClick={onSaveAsTemplate}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
                aria-label="Save as template"
                title="Save as template"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                  />
                </svg>
              </button>
            </div>
          )}
        </td>
      </tr>

      {/* Expanded detail rows */}
      {isExpanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="bg-surface-1/50 border-y border-border-light px-6 py-4">
              {isFetchingDetail ? (
                <div className="flex items-center gap-2 text-sm text-text-tertiary py-2">
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Loading details...
                </div>
              ) : expandedEntry ? (
                <div>
                  <div className="flex items-center gap-4 mb-3">
                    <p className="text-xs font-medium text-text-secondary">
                      {expandedEntry.lines?.length ?? 0} line items
                    </p>
                    {entry.createdByName && (
                      <p className="text-xs text-text-tertiary">
                        Created by {entry.createdByName}
                      </p>
                    )}
                    {entry.voidedByEntryId && (
                      <p className="text-xs text-red-500">
                        Voided by entry #{entry.voidedByEntryId}
                      </p>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-text-tertiary">
                        <th className="text-left pb-2 font-medium">Account</th>
                        <th className="text-right pb-2 font-medium">Debit</th>
                        <th className="text-right pb-2 font-medium">Credit</th>
                        <th className="text-left pb-2 font-medium pl-4">
                          Note
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {expandedEntry.lines?.map((line: any) => (
                        <tr
                          key={line.id}
                          className="border-t border-border-light/50"
                        >
                          <td className="py-2 text-text-primary">
                            <span className="font-mono text-xs text-text-tertiary mr-2">
                              {line.accountCode}
                            </span>
                            {line.accountName}
                          </td>
                          <td className="py-2 text-right tabular-nums text-text-primary">
                            {parseFloat(line.debit) > 0
                              ? formatCurrency(line.debit)
                              : "--"}
                          </td>
                          <td className="py-2 text-right tabular-nums text-text-primary">
                            {parseFloat(line.credit) > 0
                              ? formatCurrency(line.credit)
                              : "--"}
                          </td>
                          <td className="py-2 pl-4 text-text-tertiary text-xs">
                            {line.narration || "--"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Templates Tab ──────────────────────────────────────────────

function TemplatesTab({
  templates,
  onUse,
  onDelete,
}: {
  templates: any;
  onUse: (template: any) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (!templates) {
    return (
      <div className="card p-8">
        <div className="flex items-center justify-center gap-2 text-sm text-text-tertiary">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Loading templates...
        </div>
      </div>
    );
  }

  if (!templates.length) {
    return (
      <div className="card">
        <EmptyState
          title="No templates"
          description='Save frequently used journal entries as templates. Use "Save as Template" from any manual entry.'
        />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Narration</th>
            <th>Lines</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((tpl: any) => (
            <tr key={tpl.id} className="group">
              <td className="font-medium text-text-primary">{tpl.name}</td>
              <td className="text-text-secondary max-w-[250px] truncate">
                {tpl.narration || "--"}
              </td>
              <td className="text-text-tertiary text-xs">
                {tpl.lines?.length ?? 0} lines
              </td>
              <td className="text-right">
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onUse(tpl)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/20 transition-colors"
                  >
                    Use
                  </button>
                  <button
                    onClick={() => onDelete(tpl.id, tpl.name)}
                    className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors"
                    aria-label="Delete template"
                  >
                    <svg
                      className="w-3.5 h-3.5"
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
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────

function JournalTableSkeleton() {
  return (
    <div className="divide-y divide-border-light">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4">
          <div className="h-3 w-4 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-16 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-20 bg-surface-2 rounded animate-pulse" />
          <div className="h-3.5 w-40 bg-surface-2 rounded animate-pulse flex-1" />
          <div className="h-3.5 w-20 bg-surface-2 rounded animate-pulse" />
          <div className="h-5 w-14 bg-surface-2 rounded animate-pulse" />
          <div className="h-5 w-14 bg-surface-2 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}
