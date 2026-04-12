import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { Pagination } from "@/components/ui/Pagination";

export const Route = createFileRoute("/bank-reconciliation")({
  component: BankReconciliationPage,
});

// ── Constants ──────────────────────────────────────────────────────────────────

type Tab = "hub" | "upload" | "review" | "summary" | "rules" | "templates";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "hub", label: "Reconciliation Hub" },
  { value: "upload", label: "Upload & Map" },
  { value: "review", label: "Review Matches" },
  { value: "summary", label: "Summary (BRS)" },
  { value: "rules", label: "Rules" },
  { value: "templates", label: "Templates" },
];

const MATCH_STATUS_OPTIONS = [
  { value: "", label: "All Lines" },
  { value: "unmatched", label: "Unmatched" },
  { value: "auto_matched", label: "Auto-Matched" },
  { value: "manual_matched", label: "Manual-Matched" },
  { value: "created", label: "Expense Created" },
  { value: "ignored", label: "Ignored" },
];

const DATE_FORMAT_OPTIONS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (Indian standard)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO)" },
  { value: "DD-MMM-YYYY", label: "DD-MMM-YYYY (01-Jan-2024)" },
];

const PAGE_SIZE = 20;

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: string | number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "string" ? parseFloat(n) || 0 : n;
  return formatCurrency(num);
}

function matchStatusColor(status: string): string {
  switch (status) {
    case "auto_matched":
      return badgeColor("emerald");
    case "manual_matched":
      return badgeColor("blue");
    case "unmatched":
      return badgeColor("red");
    case "created":
      return badgeColor("brand");
    case "ignored":
      return badgeColorFallback;
    default:
      return badgeColorFallback;
  }
}

function matchStatusLabel(status: string): string {
  switch (status) {
    case "auto_matched": return "Auto-matched";
    case "manual_matched": return "Manual";
    case "unmatched": return "Unmatched";
    case "created": return "Expense created";
    case "ignored": return "Ignored";
    default: return status;
  }
}

function importStatusColor(status: string): string {
  switch (status) {
    case "review": return badgeColor("amber");
    case "completed": return badgeColor("emerald");
    case "pending": return badgeColorFallback;
    default: return badgeColorFallback;
  }
}

// ── Main page ──────────────────────────────────────────────────────────────────

function BankReconciliationPage() {
  const [activeTab, setActiveTab] = useState<Tab>("hub");
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  function openReview(importId: string) {
    setSelectedImportId(importId);
    setActiveTab("review");
  }

  function openSummary(accountId: string) {
    setSelectedAccountId(accountId);
    setActiveTab("summary");
  }

  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        description="Match bank statement imports with payments and expenses"
      />

      <div className="mb-5">
        <PillTabs
          tabs={TABS}
          value={activeTab}
          onChange={(v) => setActiveTab(v as Tab)}
        />
      </div>

      {activeTab === "hub" && (
        <HubTab
          onOpenReview={openReview}
          onOpenSummary={openSummary}
          onUpload={() => setActiveTab("upload")}
        />
      )}
      {activeTab === "upload" && (
        <UploadTab
          onSuccess={(importId) => {
            setSelectedImportId(importId);
            setActiveTab("review");
          }}
        />
      )}
      {activeTab === "review" && (
        <ReviewTab importId={selectedImportId} />
      )}
      {activeTab === "summary" && (
        <SummaryTab accountId={selectedAccountId} />
      )}
      {activeTab === "rules" && (
        <RulesTab />
      )}
      {activeTab === "templates" && (
        <TemplatesTab />
      )}
    </div>
  );
}

// ── Hub Tab ────────────────────────────────────────────────────────────────────

function HubTab({
  onOpenReview,
  onOpenSummary,
  onUpload,
}: {
  onOpenReview: (id: string) => void;
  onOpenSummary: (accountId: string) => void;
  onUpload: () => void;
}) {
  const [page, setPage] = useState(1);
  const { data: accounts } = trpc.bankAccount.list.useQuery();
  const { data: imports, isLoading } = trpc.bankRecon.importList.useQuery({
    page,
    limit: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      {/* Bank accounts overview */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
          Bank Accounts
        </h2>
        {accounts && accounts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((acc) => (
              <div key={acc.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-text-primary">{acc.accountName}</p>
                    <p className="text-sm text-text-secondary mt-0.5">
                      {acc.bankName ?? "Bank"} &middot; {acc.accountType}
                    </p>
                    {acc.accountNumber && (
                      <p className="text-xs text-text-tertiary mt-0.5">
                        ****{acc.accountNumber.slice(-4)}
                      </p>
                    )}
                  </div>
                  <p className="text-lg font-semibold text-text-primary">
                    {fmt(acc.currentBalance)}
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-secondary text-xs py-1"
                    onClick={onUpload}
                  >
                    Import Statement
                  </button>
                  <button
                    className="btn-secondary text-xs py-1"
                    onClick={() => onOpenSummary(acc.id)}
                  >
                    BRS
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No bank accounts"
            description="Add a bank account to start reconciling"
          />
        )}
      </div>

      {/* Import history */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">
          Recent Imports
        </h2>
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : imports && imports.data.length > 0 ? (
          <>
            <div className="card overflow-hidden">
              <table className="table-auto w-full text-sm">
                <thead>
                  <tr className="border-b border-border-light">
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">File</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">Status</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-medium">Lines</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-medium">Matched</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-medium">Unmatched</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">Date</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {imports.data.map((imp) => (
                    <tr key={imp.id} className="border-b border-border-light last:border-0 hover:bg-surface-hover">
                      <td className="px-4 py-3 text-text-primary font-medium">{imp.fileName}</td>
                      <td className="px-4 py-3">
                        <Badge size="md" color={importStatusColor(imp.status)}>
                          {imp.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary">{imp.totalLines}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{imp.matchedLines}</td>
                      <td className="px-4 py-3 text-right text-red-500">{imp.unmatchedLines}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(imp.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                          onClick={() => onOpenReview(imp.id)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {imports.total > PAGE_SIZE && (
              <div className="mt-3">
                <Pagination
                  page={page}
                  total={imports.total}
                  pageSize={PAGE_SIZE}
                  totalPages={Math.ceil(imports.total / PAGE_SIZE)}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title="No imports yet"
            description="Upload a bank statement CSV to get started"
            action={
              <button className="btn-primary" onClick={onUpload}>
                Import Statement
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}

// ── Upload Tab ─────────────────────────────────────────────────────────────────

type MappingState = {
  date: string;
  narration: string;
  debit: string;
  credit: string;
  amount: string;
  type: string;
  reference: string;
  balance: string;
  dateFormat: string;
  skipRows: string;
};

type DetectedTemplate = {
  templateId: string;
  bankSlug: string;
  bankDisplayName: string;
  version: number;
  confidence: number;
  reason: string;
} | null;

function UploadTab({ onSuccess }: { onSuccess: (importId: string) => void }) {
  const [step, setStep] = useState<"upload" | "mapping">("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [importId, setImportId] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [detectedTemplate, setDetectedTemplate] = useState<DetectedTemplate>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [saveTemplateLabel, setSaveTemplateLabel] = useState("");
  const [mapping, setMapping] = useState<MappingState>({
    date: "",
    narration: "",
    debit: "",
    credit: "",
    amount: "",
    type: "",
    reference: "",
    balance: "",
    dateFormat: "DD/MM/YYYY",
    skipRows: "1",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: accounts } = trpc.bankAccount.list.useQuery();
  const { data: templateList } = trpc.bankRecon.templateList.useQuery();
  const utils = trpc.useUtils();

  const uploadMutation = trpc.bankRecon.uploadCSV.useMutation({
    onSuccess: (data) => {
      setImportId(data.importId);
      setHeaders(data.headers);
      setPreviewRows(data.previewRows);
      setDetectedTemplate(data.detectedTemplate ?? null);

      const dm = data.detectedMapping;
      setMapping({
        date: dm.date !== undefined ? String(dm.date) : "",
        narration: dm.narration !== undefined ? String(dm.narration) : "",
        debit: dm.debit !== undefined ? String(dm.debit) : "",
        credit: dm.credit !== undefined ? String(dm.credit) : "",
        amount: dm.amount !== undefined ? String(dm.amount) : "",
        type: dm.type !== undefined ? String(dm.type) : "",
        reference: dm.reference !== undefined ? String(dm.reference) : "",
        balance: dm.balance !== undefined ? String(dm.balance) : "",
        dateFormat: dm.dateFormat ?? "DD/MM/YYYY",
        skipRows: String(dm.skipRows ?? 1),
      });
      setStep("mapping");
    },
    onError: (err) => toast.error(err.message),
  });

  const confirmMutation = trpc.bankRecon.confirmMapping.useMutation({
    onSuccess: (data) => {
      utils.bankRecon.importList.invalidate();
      toast.success(`Parsed ${data.totalLines} lines. ${data.matchedLines} auto-matched, ${data.unmatchedLines} unmatched.`);
      onSuccess(data.importId);
    },
    onError: (err) => toast.error(err.message),
  });

  const saveTemplateMutation = trpc.bankRecon.templateCreate.useMutation({
    onSuccess: () => {
      utils.bankRecon.templateList.invalidate();
      setShowSaveTemplateModal(false);
      setSaveTemplateName("");
      setSaveTemplateLabel("");
      toast.success("Template saved");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please upload a CSV file");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setCsvContent(e.target?.result as string);
    };
    reader.readAsText(file, "UTF-8");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleUpload() {
    if (!csvContent || !selectedAccountId) {
      toast.error("Select a bank account and upload a CSV file");
      return;
    }
    uploadMutation.mutate({
      bankAccountId: selectedAccountId,
      fileName,
      csvContent,
    });
  }

  function handleConfirm(overrideTemplateId?: string) {
    if (!csvContent) return;

    const mapInt = (v: string) => v !== "" ? parseInt(v, 10) : undefined;
    const tmplId = overrideTemplateId ?? selectedTemplateId ?? undefined;
    confirmMutation.mutate({
      importId,
      csvContent,
      templateId: tmplId || undefined,
      columnMapping: {
        date: parseInt(mapping.date, 10),
        narration: parseInt(mapping.narration, 10),
        debit: mapInt(mapping.debit),
        credit: mapInt(mapping.credit),
        amount: mapInt(mapping.amount),
        type: mapInt(mapping.type),
        reference: mapInt(mapping.reference),
        balance: mapInt(mapping.balance),
        dateFormat: mapping.dateFormat,
        skipRows: parseInt(mapping.skipRows, 10),
      },
    });
  }

  function handleSaveTemplate() {
    if (!saveTemplateName.trim()) {
      toast.error("Bank name is required");
      return;
    }
    const mapInt = (v: string) => v !== "" ? parseInt(v, 10) : undefined;
    saveTemplateMutation.mutate({
      bankDisplayName: saveTemplateName.trim(),
      label: saveTemplateLabel.trim() || undefined,
      columnMapping: {
        date: parseInt(mapping.date, 10),
        narration: parseInt(mapping.narration, 10),
        debit: mapInt(mapping.debit),
        credit: mapInt(mapping.credit),
        amount: mapInt(mapping.amount),
        type: mapInt(mapping.type),
        reference: mapInt(mapping.reference),
        balance: mapInt(mapping.balance),
        dateFormat: mapping.dateFormat,
        skipRows: parseInt(mapping.skipRows, 10),
      },
    });
  }

  const colOptions = [
    { value: "", label: "— not mapped —" },
    ...headers.map((h, i) => ({ value: String(i), label: `[${i}] ${h}` })),
  ];

  if (step === "mapping") {
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="text-base font-semibold text-text-primary mb-1">
            Map Columns — {fileName}
          </h2>
          <p className="text-sm text-text-secondary">
            We auto-detected these mappings. Review and adjust if needed.
          </p>
        </div>

        {/* Template detection banner */}
        {detectedTemplate && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-600/[0.08] border border-emerald-500/30">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-600 text-white">
              Detected
            </span>
            <span className="text-sm text-emerald-800 dark:text-emerald-300 font-medium flex-1">
              {detectedTemplate.bankDisplayName} v{detectedTemplate.version}
              <span className="ml-2 text-xs font-normal opacity-75">
                ({Math.round(detectedTemplate.confidence * 100)}% match via {detectedTemplate.reason})
              </span>
            </span>
            <button
              className="btn-primary text-xs py-1 px-3"
              onClick={() => handleConfirm(detectedTemplate.templateId)}
              disabled={confirmMutation.isPending}
            >
              Use Template
            </button>
            <button
              className="btn-secondary text-xs py-1 px-3"
              onClick={() => setDetectedTemplate(null)}
            >
              Manual Mapping
            </button>
          </div>
        )}

        {/* Template selector */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Apply a saved template (optional)</label>
          <Listbox
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            options={[
              { value: "", label: "— no template —" },
              ...(templateList?.map((t) => ({
                value: t.id,
                label: `${t.bankDisplayName} v${t.version}${t.label ? ` — ${t.label}` : ""}${t.isSeeded ? "" : " (custom)"}`,
              })) ?? []),
            ]}
            placeholder="Select template"
          />
        </div>

        {/* Mapping fields */}
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Date Column *</label>
              <Listbox
                value={mapping.date}
                onChange={(v) => setMapping((m) => ({ ...m, date: v }))}
                options={colOptions.filter((o) => o.value !== "")}
                placeholder="Select column"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Narration Column *</label>
              <Listbox
                value={mapping.narration}
                onChange={(v) => setMapping((m) => ({ ...m, narration: v }))}
                options={colOptions.filter((o) => o.value !== "")}
                placeholder="Select column"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Debit Column</label>
              <Listbox
                value={mapping.debit}
                onChange={(v) => setMapping((m) => ({ ...m, debit: v }))}
                options={colOptions}
                placeholder="Not mapped"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Credit Column</label>
              <Listbox
                value={mapping.credit}
                onChange={(v) => setMapping((m) => ({ ...m, credit: v }))}
                options={colOptions}
                placeholder="Not mapped"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Amount Column (if single col)</label>
              <Listbox
                value={mapping.amount}
                onChange={(v) => setMapping((m) => ({ ...m, amount: v }))}
                options={colOptions}
                placeholder="Not mapped"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Type Column (DR/CR)</label>
              <Listbox
                value={mapping.type}
                onChange={(v) => setMapping((m) => ({ ...m, type: v }))}
                options={colOptions}
                placeholder="Not mapped"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Reference / Cheque No Column</label>
              <Listbox
                value={mapping.reference}
                onChange={(v) => setMapping((m) => ({ ...m, reference: v }))}
                options={colOptions}
                placeholder="Not mapped"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Balance Column</label>
              <Listbox
                value={mapping.balance}
                onChange={(v) => setMapping((m) => ({ ...m, balance: v }))}
                options={colOptions}
                placeholder="Not mapped"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Date Format</label>
              <Listbox
                value={mapping.dateFormat}
                onChange={(v) => setMapping((m) => ({ ...m, dateFormat: v }))}
                options={DATE_FORMAT_OPTIONS}
                placeholder="DD/MM/YYYY"
              />
            </div>
            <div>
              <InputField
                label="Skip Rows (header rows)"
                type="number"
                min={0}
                max={10}
                value={mapping.skipRows}
                onChange={(e) => setMapping((m) => ({ ...m, skipRows: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/* Preview table */}
        {previewRows.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-2">Preview (first 5 rows)</h3>
            <div className="card overflow-x-auto">
              <table className="table-auto text-xs">
                <thead>
                  <tr className="border-b border-border-light">
                    {headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-text-secondary font-medium whitespace-nowrap">
                        [{i}] {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border-light last:border-0">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-text-primary whitespace-nowrap max-w-48 truncate">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="btn-secondary"
            onClick={() => setStep("upload")}
          >
            Back
          </button>
          <button
            className="btn-primary"
            onClick={() => handleConfirm()}
            disabled={confirmMutation.isPending || !mapping.date || !mapping.narration}
          >
            {confirmMutation.isPending ? <><Spinner size="sm" /> Processing...</> : "Confirm & Auto-Match"}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowSaveTemplateModal(true)}
          >
            Save as Template
          </button>
        </div>

        {/* Save-as-template modal */}
        <Modal
          open={showSaveTemplateModal}
          title="Save as Template"
          onClose={() => setShowSaveTemplateModal(false)}
        >
          <div className="space-y-4 p-1">
            <p className="text-sm text-text-secondary">
              Save the current column mapping as a reusable template for future imports.
            </p>
            <InputField
              label="Bank Name *"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              placeholder="e.g. HDFC Bank"
            />
            <InputField
              label="Label (optional)"
              value={saveTemplateLabel}
              onChange={(e) => setSaveTemplateLabel(e.target.value)}
              placeholder="e.g. Savings account format"
            />
            <div className="flex gap-3 pt-1">
              <button className="btn-secondary flex-1" onClick={() => setShowSaveTemplateModal(false)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                onClick={handleSaveTemplate}
                disabled={saveTemplateMutation.isPending}
              >
                {saveTemplateMutation.isPending ? <Spinner size="sm" /> : "Save Template"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-1">Upload Bank Statement</h2>
        <p className="text-sm text-text-secondary">
          Upload a CSV exported from your bank's internet banking portal.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Bank Account *</label>
          <Listbox
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            options={accounts?.map((a) => ({ value: a.id, label: `${a.accountName} — ${a.bankName ?? ""}` })) ?? []}
            placeholder="Select account"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">CSV File *</label>
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragging
                ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                : "border-border-light hover:border-brand-400",
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {fileName ? (
              <div>
                <p className="text-sm font-medium text-text-primary">{fileName}</p>
                <p className="text-xs text-text-secondary mt-1">Click to change file</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-text-secondary">
                  Drag & drop a CSV file here, or <span className="text-brand-600 font-medium">browse</span>
                </p>
                <p className="text-xs text-text-tertiary mt-1">
                  Supports CSV exports from HDFC, SBI, ICICI, Axis, Kotak, and most Indian banks
                </p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={handleUpload}
        disabled={uploadMutation.isPending || !csvContent || !selectedAccountId}
      >
        {uploadMutation.isPending ? <><Spinner size="sm" /> Parsing...</> : "Upload & Detect Columns"}
      </button>
    </div>
  );
}

// ── Review Tab ─────────────────────────────────────────────────────────────────

function ReviewTab({ importId }: { importId: string | null }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [manualMatchLine, setManualMatchLine] = useState<any | null>(null);
  const [createExpenseLine, setCreateExpenseLine] = useState<any | null>(null);
  const [confirmUnmatchId, setConfirmUnmatchId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: importDetail } = trpc.bankRecon.importDetail.useQuery(
    { importId: importId! },
    { enabled: !!importId },
  );

  const { data: lines, isLoading } = trpc.bankRecon.lines.useQuery(
    {
      importId: importId!,
      status: statusFilter as any || undefined,
      page,
      limit: PAGE_SIZE,
    },
    { enabled: !!importId },
  );

  const confirmMutation = trpc.bankRecon.confirmMatch.useMutation({
    onSuccess: () => {
      utils.bankRecon.lines.invalidate();
      utils.bankRecon.importDetail.invalidate();
      toast.success("Match confirmed");
    },
    onError: (err) => toast.error(err.message),
  });

  const unmatchMutation = trpc.bankRecon.unmatch.useMutation({
    onSuccess: () => {
      utils.bankRecon.lines.invalidate();
      utils.bankRecon.importDetail.invalidate();
      setConfirmUnmatchId(null);
      toast.success("Match undone");
    },
    onError: (err) => toast.error(err.message),
  });

  const ignoreMutation = trpc.bankRecon.ignoreLine.useMutation({
    onSuccess: () => {
      utils.bankRecon.lines.invalidate();
      utils.bankRecon.importDetail.invalidate();
      toast.success("Line ignored");
    },
    onError: (err) => toast.error(err.message),
  });

  if (!importId) {
    return (
      <EmptyState
        title="No import selected"
        description="Upload a bank statement or select an import from the Reconciliation Hub"
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Import stats bar */}
      {importDetail && (
        <div className="card p-4 flex flex-wrap gap-6 items-center">
          <div>
            <p className="text-xs text-text-secondary">File</p>
            <p className="text-sm font-medium text-text-primary">{importDetail.fileName}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Total Lines</p>
            <p className="text-sm font-semibold text-text-primary">{importDetail.totalLines}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Matched</p>
            <p className="text-sm font-semibold text-emerald-600">{importDetail.matchedLines}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Unmatched</p>
            <p className="text-sm font-semibold text-red-500">{importDetail.unmatchedLines}</p>
          </div>
          {importDetail.statementStartDate && (
            <div>
              <p className="text-xs text-text-secondary">Period</p>
              <p className="text-sm text-text-primary">
                {formatDate(importDetail.statementStartDate)} — {formatDate(importDetail.statementEndDate!)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Filter */}
      <div>
        <PillTabs
          tabs={MATCH_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
        />
      </div>

      {/* Lines table */}
      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : lines && lines.data.length > 0 ? (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-sm">
                <thead>
                  <tr className="border-b border-border-light bg-surface-1">
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">#</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">Narration</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-medium">Debit</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-medium">Credit</th>
                    <th className="text-left px-4 py-3 text-text-secondary font-medium">Status</th>
                    <th className="text-right px-4 py-3 text-text-secondary font-medium">Confidence</th>
                    <th className="px-4 py-3 text-text-secondary font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.data.map((line) => (
                    <tr
                      key={line.id}
                      className="border-b border-border-light last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3 text-text-tertiary text-xs">{line.lineNumber}</td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {formatDate(line.transactionDate)}
                      </td>
                      <td className="px-4 py-3 text-text-primary max-w-xs">
                        <p className="truncate">{line.narration || "—"}</p>
                        {line.referenceNumber && (
                          <p className="text-xs text-text-tertiary truncate">{line.referenceNumber}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {parseFloat(line.debit) > 0 ? (
                          <span className="text-red-500 font-medium">{fmt(line.debit)}</span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {parseFloat(line.credit) > 0 ? (
                          <span className="text-emerald-600 font-medium">{fmt(line.credit)}</span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge size="md" color={matchStatusColor(line.matchStatus)}>
                          {matchStatusLabel(line.matchStatus)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary text-xs">
                        {line.matchConfidence
                          ? `${Math.round(parseFloat(line.matchConfidence) * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end">
                          {line.matchStatus === "auto_matched" && (
                            <>
                              <button
                                className="text-emerald-600 hover:text-emerald-700 text-xs font-medium"
                                onClick={() => confirmMutation.mutate({ lineId: line.id })}
                                disabled={confirmMutation.isPending}
                              >
                                Confirm
                              </button>
                              <button
                                className="text-red-500 hover:text-red-600 text-xs font-medium"
                                onClick={() => setConfirmUnmatchId(line.id)}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {line.matchStatus === "manual_matched" && (
                            <button
                              className="text-red-500 hover:text-red-600 text-xs font-medium"
                              onClick={() => setConfirmUnmatchId(line.id)}
                            >
                              Unmatch
                            </button>
                          )}
                          {line.matchStatus === "unmatched" && (
                            <>
                              <button
                                className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                                onClick={() => setManualMatchLine(line)}
                              >
                                Match
                              </button>
                              {parseFloat(line.debit) > 0 && (
                                <button
                                  className="text-amber-600 hover:text-amber-700 text-xs font-medium"
                                  onClick={() => setCreateExpenseLine(line)}
                                >
                                  + Expense
                                </button>
                              )}
                              <button
                                className="text-text-secondary hover:text-text-primary text-xs font-medium"
                                onClick={() => ignoreMutation.mutate({ lineId: line.id })}
                                disabled={ignoreMutation.isPending}
                              >
                                Ignore
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {lines.total > PAGE_SIZE && (
            <Pagination
              page={page}
              total={lines.total}
              pageSize={PAGE_SIZE}
              totalPages={Math.ceil(lines.total / PAGE_SIZE)}
              onPageChange={setPage}
            />
          )}
        </>
      ) : (
        <EmptyState
          title="No lines"
          description={statusFilter ? "No lines with this status" : "No statement lines found"}
        />
      )}

      {/* Manual match slide-over */}
      {manualMatchLine && (
        <ManualMatchSlideOver
          line={manualMatchLine}
          onClose={() => setManualMatchLine(null)}
          onSuccess={() => {
            setManualMatchLine(null);
            utils.bankRecon.lines.invalidate();
            utils.bankRecon.importDetail.invalidate();
          }}
        />
      )}

      {/* Create expense slide-over */}
      {createExpenseLine && (
        <CreateExpenseFromLineSlideOver
          line={createExpenseLine}
          onClose={() => setCreateExpenseLine(null)}
          onSuccess={() => {
            setCreateExpenseLine(null);
            utils.bankRecon.lines.invalidate();
            utils.bankRecon.importDetail.invalidate();
          }}
        />
      )}

      {/* Unmatch confirm */}
      <ConfirmDialog
        open={!!confirmUnmatchId}
        title="Undo Match"
        description="Are you sure you want to unmatch this line?"
        confirmLabel="Unmatch"
        onConfirm={() => {
          if (confirmUnmatchId) unmatchMutation.mutate({ lineId: confirmUnmatchId });
        }}
        onCancel={() => setConfirmUnmatchId(null)}
      />
    </div>
  );
}

function ManualMatchSlideOver({
  line,
  onClose,
  onSuccess,
}: {
  line: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [paymentId, setPaymentId] = useState("");
  const [expenseId, setExpenseId] = useState("");
  const isCredit = parseFloat(line.credit) > 0;

  const { data: payments } = trpc.payment.list.useQuery(
    { page: 1, limit: 50 },
    { enabled: isCredit },
  );
  const { data: expenseList } = trpc.expense.list.useQuery(
    { page: 1, limit: 50 },
    { enabled: !isCredit },
  );

  const manualMatchMutation = trpc.bankRecon.manualMatch.useMutation({
    onSuccess: () => {
      toast.success("Manually matched");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!paymentId && !expenseId) {
      toast.error("Select a record to match");
      return;
    }
    manualMatchMutation.mutate({
      lineId: line.id,
      paymentId: paymentId || undefined,
      expenseId: expenseId || undefined,
    });
  }

  const amount = isCredit ? line.credit : line.debit;

  return (
    <SlideOver
      open
      title={`Manual Match — ${fmt(amount)} on ${formatDate(line.transactionDate)}`}
      onClose={onClose}
    >
      <div className="space-y-4 p-4">
        <div className="text-sm text-text-secondary">
          <p><span className="font-medium">Narration:</span> {line.narration || "—"}</p>
          {line.referenceNumber && <p><span className="font-medium">Ref:</span> {line.referenceNumber}</p>}
        </div>

        {isCredit ? (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Select Payment</label>
            <Listbox
              value={paymentId}
              onChange={setPaymentId}
              options={[
                { value: "", label: "— select payment —" },
                ...(payments?.data.map((p: any) => ({
                  value: p.id,
                  label: `${fmt(p.amount)} on ${formatDate(p.paymentDate)} — ${p.referenceNumber ?? ""}`,
                })) ?? []),
              ]}
              placeholder="Select payment"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Select Expense</label>
            <Listbox
              value={expenseId}
              onChange={setExpenseId}
              options={[
                { value: "", label: "— select expense —" },
                ...(expenseList?.data.map((e: any) => ({
                  value: e.id,
                  label: `${fmt(e.amount)} — ${e.category} on ${formatDate(e.expenseDate)}`,
                })) ?? []),
              ]}
              placeholder="Select expense"
            />
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary flex-1"
            onClick={handleSubmit}
            disabled={manualMatchMutation.isPending}
          >
            {manualMatchMutation.isPending ? <Spinner size="sm" /> : "Confirm Match"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}

function CreateExpenseFromLineSlideOver({
  line,
  onClose,
  onSuccess,
}: {
  line: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [category, setCategory] = useState(line.autoCategory ?? "");
  const [description, setDescription] = useState(line.narration ?? "");

  const createMutation = trpc.bankRecon.createExpense.useMutation({
    onSuccess: () => {
      toast.success("Expense created and linked");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!category.trim()) {
      toast.error("Category is required");
      return;
    }
    createMutation.mutate({
      lineId: line.id,
      expense: {
        category: category.trim(),
        description: description.trim() || undefined,
        amount: line.debit,
        mode: "bank",
        expenseDate: new Date(line.transactionDate).toISOString(),
        referenceNumber: line.referenceNumber ?? undefined,
      },
    });
  }

  return (
    <SlideOver
      open
      title={`Create Expense — ${fmt(line.debit)}`}
      onClose={onClose}
    >
      <div className="space-y-4 p-4">
        <p className="text-sm text-text-secondary">
          {formatDate(line.transactionDate)} &middot; {line.narration}
        </p>

        <InputField
          label="Category *"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Office Supplies"
        />

        <InputField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary flex-1"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Spinner size="sm" /> : "Create Expense"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}

// ── Summary Tab (BRS) ──────────────────────────────────────────────────────────

function SummaryTab({ accountId }: { accountId: string | null }) {
  const { data: accounts } = trpc.bankAccount.list.useQuery();
  const [selectedId, setSelectedId] = useState<string>(accountId ?? "");

  const { data: summary, isLoading } = trpc.bankRecon.summary.useQuery(
    { bankAccountId: selectedId },
    { enabled: !!selectedId },
  );

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Bank Account</label>
        <Listbox
          value={selectedId}
          onChange={setSelectedId}
          options={accounts?.map((a) => ({ value: a.id, label: `${a.accountName} — ${a.bankName ?? ""}` })) ?? []}
          placeholder="Select account"
        />
      </div>

      {isLoading && <div className="flex justify-center py-8"><Spinner /></div>}

      {summary && (
        <div className="card p-5 space-y-4">
          <h2 className="text-base font-semibold text-text-primary">
            Bank Reconciliation Statement
          </h2>
          <p className="text-sm text-text-secondary">
            {summary.accountName} &middot; {summary.bankName ?? ""}
          </p>

          <div className="divide-y divide-border-light">
            <div className="flex justify-between py-3">
              <span className="text-text-secondary text-sm">Book Balance (Ledger)</span>
              <span className="font-semibold text-text-primary">{fmt(summary.bookBalance)}</span>
            </div>
            <div className="flex justify-between py-3">
              <span className="text-text-secondary text-sm">Statement Balance</span>
              <span className="font-semibold text-text-primary">
                {summary.statementBalance !== null ? fmt(summary.statementBalance) : "—"}
              </span>
            </div>
            {summary.unmatchedDebits && parseFloat(summary.unmatchedDebits) > 0 && (
              <div className="flex justify-between py-3">
                <span className="text-text-secondary text-sm">Unmatched Debits (statement only)</span>
                <span className="text-red-500">− {fmt(summary.unmatchedDebits)}</span>
              </div>
            )}
            {summary.unmatchedCredits && parseFloat(summary.unmatchedCredits) > 0 && (
              <div className="flex justify-between py-3">
                <span className="text-text-secondary text-sm">Unmatched Credits (statement only)</span>
                <span className="text-emerald-600">+ {fmt(summary.unmatchedCredits)}</span>
              </div>
            )}
            {summary.difference !== null && (
              <div className="flex justify-between py-3">
                <span className="font-medium text-text-primary text-sm">Difference</span>
                <span className={cn(
                  "font-semibold",
                  parseFloat(summary.difference) === 0
                    ? "text-emerald-600"
                    : "text-red-500"
                )}>
                  {parseFloat(summary.difference) === 0
                    ? "Reconciled ✓"
                    : fmt(summary.difference)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedId && (
        <EmptyState
          title="Select a bank account"
          description="Choose an account above to view its reconciliation summary"
        />
      )}
    </div>
  );
}

// ── Rules Tab ──────────────────────────────────────────────────────────────────

type RuleForm = {
  matchField: string;
  matchType: string;
  matchValue: string;
  action: string;
  expenseCategory: string;
  priority: string;
};

const EMPTY_RULE_FORM: RuleForm = {
  matchField: "narration",
  matchType: "contains",
  matchValue: "",
  action: "create_expense",
  expenseCategory: "",
  priority: "0",
};

function RulesTab() {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE_FORM);
  const deleteConfirm = useDeleteConfirmation();
  const utils = trpc.useUtils();

  const { data: rules, isLoading } = trpc.bankRecon.ruleList.useQuery();

  const createMutation = trpc.bankRecon.ruleCreate.useMutation({
    onSuccess: () => {
      utils.bankRecon.ruleList.invalidate();
      setShowForm(false);
      setForm(EMPTY_RULE_FORM);
      toast.success("Rule created");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.bankRecon.ruleUpdate.useMutation({
    onSuccess: () => {
      utils.bankRecon.ruleList.invalidate();
      setShowForm(false);
      setEditId(null);
      setForm(EMPTY_RULE_FORM);
      toast.success("Rule updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.bankRecon.ruleDelete.useMutation({
    onSuccess: () => {
      utils.bankRecon.ruleList.invalidate();
      deleteConfirm.cancelDelete();
      toast.success("Rule deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  function openEdit(rule: any) {
    setEditId(rule.id);
    setForm({
      matchField: rule.matchField,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
      action: rule.action,
      expenseCategory: rule.expenseCategory ?? "",
      priority: String(rule.priority),
    });
    setShowForm(true);
  }

  function handleSubmit() {
    const payload = {
      matchField: form.matchField as "narration" | "reference",
      matchType: form.matchType as "contains" | "starts_with" | "exact" | "regex",
      matchValue: form.matchValue.trim(),
      action: form.action as "create_expense" | "ignore" | "tag_party",
      expenseCategory: form.expenseCategory.trim() || undefined,
      priority: parseInt(form.priority, 10) || 0,
    };

    if (!payload.matchValue) {
      toast.error("Match value is required");
      return;
    }

    if (editId) {
      updateMutation.mutate({ id: editId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Categorization Rules</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Automatically categorize unmatched statement lines based on narration patterns.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setEditId(null); setForm(EMPTY_RULE_FORM); setShowForm(true); }}
        >
          + New Rule
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : rules && rules.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="table-auto w-full text-sm">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Match</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Pattern</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Action</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Category</th>
                <th className="text-right px-4 py-3 text-text-secondary font-medium">Priority</th>
                <th className="text-right px-4 py-3 text-text-secondary font-medium">Hits</th>
                <th className="px-4 py-3 text-text-secondary font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border-light last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-3">
                    <span className="text-text-secondary text-xs">{rule.matchField}</span>
                    <span className="mx-1 text-text-tertiary">/</span>
                    <span className="text-text-secondary text-xs">{rule.matchType}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-primary max-w-xs truncate">
                    {rule.matchValue}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                      rule.action === "create_expense"
                        ? "bg-amber-600/[0.08] text-amber-700 dark:text-amber-400"
                        : rule.action === "ignore"
                          ? "bg-surface-2 text-text-secondary"
                          : "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400"
                    )}>
                      {rule.action.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{rule.expenseCategory ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-text-secondary text-xs">{rule.priority}</td>
                  <td className="px-4 py-3 text-right text-text-secondary text-xs">{rule.hitCount}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                      rule.isActive
                        ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                        : "bg-surface-2 text-text-secondary"
                    )}>
                      {rule.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 justify-end">
                      <button
                        className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                        onClick={() => openEdit(rule)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-red-500 hover:text-red-600 text-xs font-medium"
                        onClick={() => deleteConfirm.requestDelete(rule.id, rule.matchValue)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No rules yet"
          description="Create rules to auto-categorize recurring bank transactions"
          action={
            <button className="btn-primary" onClick={() => { setForm(EMPTY_RULE_FORM); setShowForm(true); }}>
              + New Rule
            </button>
          }
        />
      )}

      {/* Rule form modal */}
      <Modal
        open={showForm}
        title={editId ? "Edit Rule" : "New Rule"}
        onClose={() => { setShowForm(false); setEditId(null); }}
      >
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Match Field</label>
              <Listbox
                value={form.matchField}
                onChange={(v) => setForm((f) => ({ ...f, matchField: v }))}
                options={[
                  { value: "narration", label: "Narration" },
                  { value: "reference", label: "Reference No" },
                ]}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Match Type</label>
              <Listbox
                value={form.matchType}
                onChange={(v) => setForm((f) => ({ ...f, matchType: v }))}
                options={[
                  { value: "contains", label: "Contains" },
                  { value: "starts_with", label: "Starts With" },
                  { value: "exact", label: "Exact" },
                  { value: "regex", label: "Regex" },
                ]}
              />
            </div>
          </div>

          <InputField
            label="Match Value *"
            value={form.matchValue}
            onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
            placeholder="e.g. SWIGGY or UPI/.*@ybl"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Action</label>
              <Listbox
                value={form.action}
                onChange={(v) => setForm((f) => ({ ...f, action: v }))}
                options={[
                  { value: "create_expense", label: "Create Expense" },
                  { value: "ignore", label: "Ignore" },
                  { value: "tag_party", label: "Tag Party" },
                ]}
              />
            </div>
            <InputField
              label="Priority"
              type="number"
              min={0}
              max={100}
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            />
          </div>

          {form.action === "create_expense" && (
            <InputField
              label="Expense Category"
              value={form.expenseCategory}
              onChange={(e) => setForm((f) => ({ ...f, expenseCategory: e.target.value }))}
              placeholder="e.g. Food & Beverages"
            />
          )}

          <div className="flex gap-3 pt-1">
            <button
              className="btn-secondary flex-1"
              onClick={() => { setShowForm(false); setEditId(null); }}
            >
              Cancel
            </button>
            <button
              className="btn-primary flex-1"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Spinner size="sm" /> : editId ? "Update Rule" : "Create Rule"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Rule"
        onConfirm={() => { if (deleteConfirm.deleteTarget) deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id }); }}
        onCancel={deleteConfirm.cancelDelete}
      />
    </div>
  );
}

// ── Templates Tab ──────────────────────────────────────────────────────────────

function templateTypeBadge(t: { isSeeded: boolean; forkedFromId: string | null }) {
  if (t.isSeeded) return { label: "Built-in", cls: "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400" };
  if (t.forkedFromId) return { label: "Forked", cls: "bg-amber-600/[0.08] text-amber-700 dark:text-amber-400" };
  return { label: "Custom", cls: "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400" };
}

function TemplatesTab() {
  const deleteConfirm = useDeleteConfirmation();
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();

  const { data: templates, isLoading } = trpc.bankRecon.templateList.useQuery(
    search ? { search } : undefined,
  );

  const forkMutation = trpc.bankRecon.templateFork.useMutation({
    onSuccess: () => {
      utils.bankRecon.templateList.invalidate();
      toast.success("Template forked — you can now edit the copy");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.bankRecon.templateDelete.useMutation({
    onSuccess: () => {
      utils.bankRecon.templateList.invalidate();
      deleteConfirm.cancelDelete();
      toast.success("Template deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-xs">
          <InputField
            label=""
            placeholder="Search by bank name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-text-tertiary">
          Built-in templates cannot be edited — fork them to create a custom copy.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : templates && templates.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="table-auto w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-surface-1">
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Bank</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Version</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Type</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Format</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Label</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const badge = templateTypeBadge(t);
                return (
                  <tr key={t.id} className="border-b border-border-light last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-3 font-medium text-text-primary">{t.bankDisplayName}</td>
                    <td className="px-4 py-3 text-text-secondary">v{t.version}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", badge.cls)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary uppercase text-xs">{t.fileFormat}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs">{t.label ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                        t.isActive
                          ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                          : "bg-surface-2 text-text-secondary",
                      )}>
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 justify-end">
                        {t.isSeeded ? (
                          <button
                            className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                            onClick={() => forkMutation.mutate({ templateId: t.id })}
                            disabled={forkMutation.isPending}
                          >
                            Fork
                          </button>
                        ) : (
                          <button
                            className="text-red-500 hover:text-red-600 text-xs font-medium"
                            onClick={() => deleteConfirm.requestDelete(t.id, t.bankDisplayName)}
                          >
                            Delete
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
      ) : (
        <EmptyState
          title="No templates"
          description="Templates are seeded on first bank statement upload"
        />
      )}

      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Template"
        onConfirm={() => { if (deleteConfirm.deleteTarget) deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id }); }}
        onCancel={deleteConfirm.cancelDelete}
      />
    </div>
  );
}
