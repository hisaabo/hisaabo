import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { badgeColor } from "@/lib/badge-colors";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";

export const Route = createFileRoute("/gstr2b")({
  component: GSTR2BPage,
});

// ── Constants ─────────────────────────────────────────────────

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type G2BTab = "upload" | "reconciliation" | "missing-books" | "missing-2b" | "history";

// ── Helpers ───────────────────────────────────────────────────

function returnPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function fmt(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return formatCurrency(typeof v === "string" ? parseFloat(v) || 0 : v);
}

function matchBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "matched":
      return { label: "Matched", cls: badgeColor("emerald") };
    case "mismatched":
      return { label: "Mismatch", cls: badgeColor("amber") };
    case "missing_in_books":
      return { label: "Not in Books", cls: badgeColor("red") };
    case "ignored":
      return { label: "Ignored", cls: "bg-surface-2 text-text-tertiary" };
    case "pending":
    default:
      return { label: "Pending", cls: badgeColor("blue") };
  }
}

function mismatchLabel(reason: string): string {
  switch (reason) {
    case "taxable_value_difference": return "Taxable value differs";
    case "cgst_difference":          return "CGST differs";
    case "sgst_difference":          return "SGST differs";
    case "igst_difference":          return "IGST differs";
    case "date_difference":          return "Invoice date mismatch";
    default:                         return reason;
  }
}


// ── Upload Section ────────────────────────────────────────────

function UploadSection({
  year, month,
  onUploadSuccess,
}: {
  year: number;
  month: number;
  onUploadSuccess: (uploadId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const uploadMutation = trpc.gstr2b.upload.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Upload successful",
        description: `${data.totalRecords} records processed — ${data.matchedRecords} matched, ${data.missingInBooks} missing in books.`,
      });
      utils.gstr2b.uploads.invalidate();
      utils.gstr2b.summary.invalidate();
      onUploadSuccess(data.uploadId);
    },
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "error" });
    },
  });

  const processFile = useCallback(
    (file: File) => {
      if (!file) return;
      const ext = file.name.split(".").pop()?.toLowerCase();
      const format = ext === "csv" ? "csv" : "json";

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        uploadMutation.mutate({
          returnPeriod: returnPeriod(year, month),
          content,
          fileName: file.name,
          format,
        });
      };
      reader.readAsText(file);
    },
    [uploadMutation, year, month],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  return (
    <div className="max-w-xl">
      <div className="mb-4">
        <p className="text-sm text-text-secondary">
          Upload the GSTR-2B JSON or CSV file downloaded from the GST portal for{" "}
          <strong>{months[month - 1]} {year}</strong>. Records will be auto-reconciled
          against your purchase invoices.
        </p>
      </div>

      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
            : "border-border-medium hover:border-brand-400 hover:bg-surface-1",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        aria-label="Upload GSTR-2B file"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv"
          className="hidden"
          onChange={handleFileChange}
        />

        {uploadMutation.isPending ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner className="w-8 h-8" />
            <p className="text-sm text-text-secondary">Processing file…</p>
          </div>
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-primary mb-1">
              Drop your GSTR-2B file here
            </p>
            <p className="text-xs text-text-tertiary">JSON or CSV · Max 50 MB</p>
          </>
        )}
      </div>

      {uploadMutation.isError && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{uploadMutation.error.message}</p>
      )}
    </div>
  );
}

// ── Upload History ────────────────────────────────────────────

function UploadHistorySection({ onSelectUpload }: { onSelectUpload: (id: string) => void }) {
  const { data, isLoading } = trpc.gstr2b.uploads.useQuery({ page: 1, limit: 20 });

  if (isLoading) return <div className="py-8 flex justify-center"><Spinner /></div>;

  if (!data?.uploads.length) {
    return (
      <EmptyState
        title="No uploads yet"
        description="Upload a GSTR-2B file to get started with reconciliation."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border-light overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-light bg-surface-1">
            <th className="px-4 py-3 text-left font-medium text-text-secondary">Period</th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary">File</th>
            <th className="px-4 py-3 text-right font-medium text-text-secondary">Total</th>
            <th className="px-4 py-3 text-right font-medium text-text-secondary">Matched</th>
            <th className="px-4 py-3 text-right font-medium text-text-secondary">Mismatch</th>
            <th className="px-4 py-3 text-right font-medium text-text-secondary">Not in Books</th>
            <th className="px-4 py-3 text-left font-medium text-text-secondary">Uploaded</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {data.uploads.map((u) => (
            <tr key={u.id} className="border-b border-border-light last:border-0 hover:bg-surface-1 transition-colors">
              <td className="px-4 py-3 font-medium text-text-primary">{u.returnPeriod}</td>
              <td className="px-4 py-3 text-text-secondary max-w-[180px] truncate">{u.fileName}</td>
              <td className="px-4 py-3 text-right text-text-primary">{u.totalRecords}</td>
              <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">{u.matchedRecords}</td>
              <td className="px-4 py-3 text-right text-amber-700 dark:text-amber-400">{u.unmatchedRecords}</td>
              <td className="px-4 py-3 text-right text-red-700 dark:text-red-400">{u.newRecords}</td>
              <td className="px-4 py-3 text-text-tertiary text-xs">{u.uploadedAt ? formatDate(u.uploadedAt) : "—"}</td>
              <td className="px-4 py-3">
                <button
                  className="btn-ghost text-xs px-2 py-1"
                  onClick={() => onSelectUpload(u.id)}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Reconciliation Records Table ───────────────────────────────

function ReconciliationSection({
  year, month,
}: {
  year: number;
  month: number;
}) {
  const period = returnPeriod(year, month);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: summary } = trpc.gstr2b.summary.useQuery({ returnPeriod: period });

  // Find latest upload for this period to show records
  const [uploadId] = useState<string | null>(null);

  // Use summary to get the upload ID
  const resolvedUploadId = uploadId ?? summary?.uploadId ?? null;

  const { data: records, isLoading } = trpc.gstr2b.records.useQuery(
    {
      uploadId: resolvedUploadId!,
      matchStatus: statusFilter as "matched" | "mismatched" | "missing_in_books" | "pending" | "ignored" | undefined || undefined,
      page,
      limit: 25,
    },
    { enabled: !!resolvedUploadId },
  );

  const utils = trpc.useUtils();

  const ignoreMutation = trpc.gstr2b.ignoreRecord.useMutation({
    onSuccess: () => {
      toast({ title: "Record ignored" });
      utils.gstr2b.records.invalidate();
      utils.gstr2b.summary.invalidate();
    },
  });

  if (!summary?.hasData) {
    return (
      <EmptyState
        title="No GSTR-2B data for this period"
        description={`Upload a GSTR-2B file for ${months[month - 1]} ${year} to begin reconciliation.`}
      />
    );
  }

  const STATUS_OPTIONS = [
    { value: "", label: "All records" },
    { value: "matched", label: "Matched" },
    { value: "mismatched", label: "Mismatched" },
    { value: "missing_in_books", label: "Not in Books" },
    { value: "pending", label: "Pending" },
    { value: "ignored", label: "Ignored" },
  ];

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          size="lg"
          label="Matched"
          value={summary.matched}
          labelColor="text-emerald-700 dark:text-emerald-400"
          className="bg-surface-0 border-border-light"
        />
        <StatCard
          size="lg"
          label="Mismatched"
          value={summary.mismatched}
          labelColor="text-amber-700 dark:text-amber-400"
          className="bg-surface-0 border-border-light"
        />
        <StatCard
          size="lg"
          label="Not in Books"
          value={summary.missingInBooks}
          labelColor="text-red-700 dark:text-red-400"
          note={summary.itcAtRisk?.total ? `ITC at risk: ${fmt(summary.itcAtRisk.total)}` : undefined}
          className="bg-surface-0 border-border-light"
        />
        <StatCard
          size="lg"
          label="ITC Available"
          value={summary.matched + summary.pending}
          labelColor="text-blue-700 dark:text-blue-400"
          note={summary.itcAvailable?.total ? fmt(summary.itcAvailable.total) : undefined}
          className="bg-surface-0 border-border-light"
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-4">
        <select
          className="input w-44 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          aria-label="Filter by match status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {isLoading && <div className="py-8 flex justify-center"><Spinner /></div>}

      {!isLoading && !records?.records.length && (
        <EmptyState title="No records" description="No records match the current filter." />
      )}

      {!isLoading && !!records?.records.length && (
        <>
          <div className="rounded-xl border border-border-light overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-light bg-surface-1">
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier GSTIN</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Invoice #</th>
                  <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
                  <th className="px-4 py-3 text-right font-medium text-text-secondary">Taxable</th>
                  <th className="px-4 py-3 text-right font-medium text-text-secondary">CGST</th>
                  <th className="px-4 py-3 text-right font-medium text-text-secondary">SGST</th>
                  <th className="px-4 py-3 text-right font-medium text-text-secondary">IGST</th>
                  <th className="px-4 py-3 text-center font-medium text-text-secondary">ITC</th>
                  <th className="px-4 py-3 text-center font-medium text-text-secondary">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {records.records.map((r) => {
                  const badge = matchBadge(r.matchStatus);
                  const expanded = expandedId === r.id;
                  return (
                    <>
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-border-light last:border-0 transition-colors",
                          expanded ? "bg-surface-1" : "hover:bg-surface-1",
                        )}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">{r.supplierGstin}</td>
                        <td className="px-4 py-3 text-text-primary max-w-[140px] truncate">{r.supplierName ?? "—"}</td>
                        <td className="px-4 py-3 text-text-primary font-medium">{r.invoiceNumber}</td>
                        <td className="px-4 py-3 text-text-secondary text-xs">
                          {r.invoiceDate ? formatDate(r.invoiceDate) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-text-primary">{fmt(r.taxableValue)}</td>
                        <td className="px-4 py-3 text-right text-text-secondary">{fmt(r.cgst)}</td>
                        <td className="px-4 py-3 text-right text-text-secondary">{fmt(r.sgst)}</td>
                        <td className="px-4 py-3 text-right text-text-secondary">{fmt(r.igst)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-xs font-medium",
                            r.itcAvailable === "Y"
                              ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                              : "bg-surface-2 text-text-tertiary",
                          )}>
                            {r.itcAvailable === "Y" ? "Yes" : r.itcAvailable === "N" ? "No" : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", badge.cls)}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {(r.matchStatus === "mismatched" || r.mismatchReasons) && (
                              <button
                                className="btn-ghost text-xs px-2 py-0.5"
                                onClick={() => setExpandedId(expanded ? null : r.id)}
                                aria-label="Show details"
                              >
                                {expanded ? "Hide" : "Details"}
                              </button>
                            )}
                            {r.matchStatus !== "ignored" && (
                              <button
                                className="btn-ghost text-xs px-2 py-0.5 text-text-tertiary"
                                onClick={() => ignoreMutation.mutate({ recordId: r.id })}
                                disabled={ignoreMutation.isPending}
                                aria-label="Ignore this record"
                              >
                                Ignore
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Mismatch detail expansion */}
                      {expanded && r.mismatchReasons && r.mismatchReasons.length > 0 && (
                        <tr key={`${r.id}-detail`} className="bg-amber-50/40 dark:bg-amber-950/20">
                          <td colSpan={11} className="px-4 py-3">
                            <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                              Mismatch details:
                            </div>
                            <ul className="list-disc list-inside space-y-0.5">
                              {r.mismatchReasons.map((reason) => (
                                <li key={reason} className="text-xs text-amber-700 dark:text-amber-400">
                                  {mismatchLabel(reason)}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {records.total > 25 && (
            <div className="flex items-center justify-between mt-4 text-sm text-text-secondary">
              <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, records.total)} of {records.total}</span>
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-3 py-1"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <button
                  className="btn-ghost px-3 py-1"
                  disabled={page * 25 >= records.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Missing in Books ──────────────────────────────────────────

function MissingInBooksSection({ year, month }: { year: number; month: number }) {
  const period = returnPeriod(year, month);
  const [page, setPage] = useState(1);

  const { data: summary } = trpc.gstr2b.summary.useQuery({ returnPeriod: period });
  const resolvedUploadId = summary?.uploadId ?? null;

  const { data, isLoading } = trpc.gstr2b.missingInBooks.useQuery(
    { uploadId: resolvedUploadId!, page, limit: 25 },
    { enabled: !!resolvedUploadId },
  );

  if (!summary?.hasData) {
    return (
      <EmptyState
        title="No GSTR-2B data for this period"
        description="Upload a GSTR-2B file first."
      />
    );
  }

  if (isLoading) return <div className="py-8 flex justify-center"><Spinner /></div>;

  if (!data?.records.length) {
    return (
      <EmptyState
        title="All suppliers accounted for"
        description="No invoices found in GSTR-2B that are missing from your purchase records."
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-text-secondary mb-4">
        These invoices are reported in the GSTR-2B by your suppliers but are absent from your purchase records.
        Create a purchase invoice to claim the ITC.
      </p>

      <div className="rounded-xl border border-border-light overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light bg-surface-1">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier GSTIN</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Invoice #</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
              <th className="px-4 py-3 text-right font-medium text-text-secondary">Taxable</th>
              <th className="px-4 py-3 text-right font-medium text-text-secondary">CGST</th>
              <th className="px-4 py-3 text-right font-medium text-text-secondary">SGST</th>
              <th className="px-4 py-3 text-right font-medium text-text-secondary">IGST</th>
              <th className="px-4 py-3 text-center font-medium text-text-secondary">ITC</th>
            </tr>
          </thead>
          <tbody>
            {data.records.map((r) => (
              <tr key={r.id} className="border-b border-border-light last:border-0 hover:bg-surface-1 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">{r.supplierGstin}</td>
                <td className="px-4 py-3 text-text-primary">{r.supplierName ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-text-primary">{r.invoiceNumber}</td>
                <td className="px-4 py-3 text-text-secondary text-xs">
                  {r.invoiceDate ? formatDate(r.invoiceDate) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-text-primary">{fmt(r.taxableValue)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fmt(r.cgst)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fmt(r.sgst)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fmt(r.igst)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-medium",
                    r.itcAvailable === "Y"
                      ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                      : "bg-surface-2 text-text-tertiary",
                  )}>
                    {r.itcAvailable === "Y" ? "Available" : r.itcAvailable === "N" ? "Blocked" : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-text-secondary">
          <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total}</span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-ghost px-3 py-1" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Missing in 2B ─────────────────────────────────────────────

function MissingIn2BSection({ year, month }: { year: number; month: number }) {
  const period = returnPeriod(year, month);
  const [page, setPage] = useState(1);

  const { data, isLoading } = trpc.gstr2b.missingIn2B.useQuery({ returnPeriod: period, page, limit: 25 });

  if (isLoading) return <div className="py-8 flex justify-center"><Spinner /></div>;

  if (!data?.records.length) {
    return (
      <EmptyState
        title="All purchase invoices accounted for"
        description="All your purchase invoices with a supplier GSTIN appear in the GSTR-2B."
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-text-secondary mb-4">
        These purchase invoices are in your books but not in the GSTR-2B. Follow up with the
        supplier to ensure they file their return correctly.
      </p>

      <div className="rounded-xl border border-border-light overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light bg-surface-1">
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier GSTIN</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Invoice #</th>
              <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
              <th className="px-4 py-3 text-right font-medium text-text-secondary">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.records.map((r) => (
              <tr key={r.id} className="border-b border-border-light last:border-0 hover:bg-surface-1 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">{r.partyGstin ?? "—"}</td>
                <td className="px-4 py-3 text-text-primary">{r.partyName ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-text-primary">{r.invoiceNumber}</td>
                <td className="px-4 py-3 text-text-secondary text-xs">
                  {r.invoiceDate ? formatDate(r.invoiceDate) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-text-primary">{fmt(r.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-text-secondary">
          <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total}</span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-ghost px-3 py-1" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

function GSTR2BPage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTabRaw] = useState<G2BTab>(
    () => (localStorage.getItem("hisaabo_gstr2b_tab") as G2BTab) || "upload",
  );

  const setActiveTab = (tab: G2BTab) => {
    setActiveTabRaw(tab);
    localStorage.setItem("hisaabo_gstr2b_tab", tab);
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const tabs: Array<{ value: G2BTab; label: string }> = [
    { value: "upload",         label: "Upload" },
    { value: "reconciliation", label: "Reconciliation" },
    { value: "missing-books",  label: "Not in Books" },
    { value: "missing-2b",     label: "Not in 2B" },
    { value: "history",        label: "Upload History" },
  ];

  return (
    <div>
      <PageHeader
        title="GSTR-2B Reconciliation"
        description="Reconcile supplier-reported inward supplies against your purchase records to verify ITC"
      />

      {/* Tab bar */}
      <div className="mb-6">
        <PillTabs
          tabs={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as G2BTab)}
        />
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3 mb-6">
        <select
          className="input w-40"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Select month"
        >
          {months.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          className="input w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Select year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-xs text-text-tertiary ml-2">
          Return period: {months[month - 1]} {year}
        </span>
      </div>

      {activeTab === "upload" && (
        <UploadSection
          year={year}
          month={month}
          onUploadSuccess={() => setActiveTab("reconciliation")}
        />
      )}
      {activeTab === "reconciliation" && (
        <ReconciliationSection year={year} month={month} />
      )}
      {activeTab === "missing-books" && (
        <MissingInBooksSection year={year} month={month} />
      )}
      {activeTab === "missing-2b" && (
        <MissingIn2BSection year={year} month={month} />
      )}
      {activeTab === "history" && (
        <UploadHistorySection onSelectUpload={() => setActiveTab("reconciliation")} />
      )}
    </div>
  );
}
