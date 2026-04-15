import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// ── Import result type ────────────────────────────────────────────────────────

interface ImportResult {
  status: string;
  rowsInserted: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

// ── Export Section ────────────────────────────────────────────────────────────

interface ExportSectionProps {
  tenantId: string;
}

function ExportSection({ tenantId }: ExportSectionProps) {
  const exportMut = trpc.selfExport.request.useMutation({
    onSuccess: (data) => {
      // Trigger browser download — use the URL returned by the server.
      // The URL may be absolute (from APP_URL env) or relative; normalise it.
      const href = data.url.startsWith("http")
        ? data.url
        : `${window.location.origin}${data.url}`;
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast.success("Download started", `Token valid until ${formatDateTime(data.expiresAt)}`);
    },
    onError: (err) => {
      const code = (err as { data?: { code?: string } }).data?.code;
      if (code === "FORBIDDEN") {
        toast.error("You must be a tenant owner to export data.");
      } else if (code === "TOO_MANY_REQUESTS") {
        toast.error("Export limit reached", "You've reached the 2-per-day export limit. Try again tomorrow.");
      } else {
        toast.error("Failed to start export. Please try again.", err.message);
      }
    },
  });

  return (
    <div className="card px-6 py-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center text-brand-600 shrink-0 mt-0.5">
          <DownloadIcon />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Export your data</h3>
          <p className="text-sm text-text-tertiary mt-0.5">
            Download a complete backup of your tenant data. The file includes all businesses, parties,
            items, invoices, payments, and other records. You can re-import it into an empty tenant to restore.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-tertiary mb-5 px-1">
        <InfoIcon />
        <span>Limit: 2 exports per day.</span>
      </div>

      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => exportMut.mutate({ tenantId })}
        disabled={exportMut.isPending}
        aria-label="Export tenant data"
      >
        {exportMut.isPending ? <Spinner size="sm" /> : <DownloadIcon />}
        {exportMut.isPending ? "Preparing export…" : "Export Data"}
      </button>
    </div>
  );
}

// ── Restore Section ───────────────────────────────────────────────────────────

interface RestoreSectionProps {
  tenantId: string;
  tenantSlug: string;
  isTenantEmpty: boolean;
}

function RestoreSection({ tenantId, tenantSlug, isTenantEmpty }: RestoreSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importMut = trpc.selfImport.request.useMutation();
  const utils = trpc.useUtils();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setImportResult(null);
    setImportError(null);
  }

  async function handleRestore() {
    if (!selectedFile) return;
    setShowConfirm(false);
    setIsUploading(true);
    setUploadProgress(0);
    setImportError(null);
    setImportResult(null);

    try {
      const { url } = await importMut.mutateAsync({ tenantId });
      const uploadUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;

      const result = await new Promise<ImportResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        xhr.setRequestHeader("Content-Type", "application/gzip");
        xhr.withCredentials = true;

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as ImportResult);
            } catch {
              reject(new Error("Invalid response from server"));
            }
          } else {
            let msg = `Server error (${xhr.status})`;
            try {
              const body = JSON.parse(xhr.responseText) as { message?: string };
              if (body.message) msg = body.message;
            } catch {
              // ignore parse error
            }
            reject(new Error(msg));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.send(selectedFile);
      });

      setImportResult(result);

      // Invalidate all queries so the UI reflects imported data
      await utils.invalidate();
      toast.success("Restore complete", `${result.rowsInserted.toLocaleString()} rows imported in ${(result.durationMs / 1000).toFixed(1)}s`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("TARGET_NOT_EMPTY")) {
        setImportError("This tenant already has data. Restore is only allowed to an empty tenant.");
      } else {
        setImportError(msg);
      }
      toast.error("Restore failed", msg);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }

  const canRestore = isTenantEmpty && !!selectedFile && !isUploading;

  return (
    <div className="card px-6 py-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950 flex items-center justify-center text-amber-600 shrink-0 mt-0.5">
          <UploadIcon />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Restore from backup</h3>
          <p className="text-sm text-text-tertiary mt-0.5">
            Import a previously exported backup file into this tenant.
          </p>
        </div>
      </div>

      {/* Warning box */}
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 mb-5">
        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
          <WarningIcon />
          <div className="text-xs leading-relaxed">
            <span className="font-semibold">Restore only works on an empty tenant</span> (no businesses
            created). All backup data will be imported preserving original IDs. This action cannot be undone.
          </div>
        </div>
      </div>

      {/* Tenant not empty blocker */}
      {!isTenantEmpty && (
        <div className="rounded-lg border border-border-light bg-surface-2 px-4 py-3 mb-5">
          <div className="flex items-start gap-2 text-text-secondary">
            <InfoIcon />
            <p className="text-xs">
              This tenant already has data. Create a new empty tenant to restore a backup.
            </p>
          </div>
        </div>
      )}

      {/* File picker */}
      <div className="mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".gz,.tar.gz"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Select backup file"
        />
        <button
          type="button"
          className="btn-secondary flex items-center gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={!isTenantEmpty || isUploading}
        >
          <UploadIcon />
          {selectedFile ? "Change file" : "Select backup file (.gz)"}
        </button>
        {selectedFile && (
          <p className="mt-2 text-xs text-text-secondary">
            <span className="font-medium">{selectedFile.name}</span>
            {" "}({formatFileSize(selectedFile.size)})
          </p>
        )}
      </div>

      {/* Progress bar during upload */}
      {isUploading && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-text-tertiary mb-1">
            <span>Uploading… do not close this tab</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error banner */}
      {importError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 mb-4">
          <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
            <WarningIcon />
            <p className="text-xs">{importError}</p>
          </div>
        </div>
      )}

      {/* Success summary */}
      {importResult && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 mb-4">
          <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
            <ShieldIcon />
            <div className="text-xs">
              <p className="font-semibold mb-1">Restore complete</p>
              <p>{importResult.rowsInserted.toLocaleString()} rows imported in {(importResult.durationMs / 1000).toFixed(1)}s.</p>
              {importResult.warnings.length > 0 && (
                <p className="mt-1 text-amber-600 dark:text-amber-400">{importResult.warnings.length} warning(s) — check server logs for details.</p>
              )}
              <p className="mt-1">Reload the page to see your restored data.</p>
            </div>
          </div>
        </div>
      )}

      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => setShowConfirm(true)}
        disabled={!canRestore}
        aria-label="Restore from backup"
      >
        {isUploading ? <Spinner size="sm" /> : <UploadIcon />}
        {isUploading ? "Restoring…" : "Restore from backup"}
      </button>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm restore"
        description={`This will import all data from "${selectedFile?.name}" into tenant "${tenantSlug}". This cannot be undone. Continue?`}
        confirmLabel="Restore"
        variant="danger"
        loading={isUploading}
        onConfirm={handleRestore}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}

// ── Main BackupTab ────────────────────────────────────────────────────────────

export function BackupTab() {
  const { data: session } = trpc.auth.me.useQuery();
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });

  const isOwner = session?.role === "owner" || session?.role === "superadmin";

  // Not-owner gate
  if (session !== undefined && !isOwner) {
    return (
      <div className="card px-6 py-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mx-auto mb-3 text-text-tertiary">
          <ShieldIcon />
        </div>
        <p className="text-sm font-medium text-text-primary mb-1">Owner access required</p>
        <p className="text-sm text-text-tertiary">
          Only tenant owners can access backup and restore. Contact your organization owner.
        </p>
      </div>
    );
  }

  if (!session?.tenantId) return null;

  // business.list is a businessProcedure — only returns data once a business is selected.
  // An empty tenant has zero businesses, so null/undefined means "not yet loaded" and
  // an empty array means confirmed empty.
  const isTenantEmpty = Array.isArray(businesses) && businesses.length === 0;

  // Derive a display slug from the tenantId (just the first segment)
  const tenantSlug = session.tenantId.split("-")[0] ?? session.tenantId;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Backup &amp; Restore</h2>
        <p className="text-xs text-text-tertiary">
          Export a full snapshot of your tenant or restore from a previous backup.
        </p>
      </div>

      <ExportSection tenantId={session.tenantId} />
      <RestoreSection
        tenantId={session.tenantId}
        tenantSlug={tenantSlug}
        isTenantEmpty={isTenantEmpty}
      />
    </div>
  );
}
