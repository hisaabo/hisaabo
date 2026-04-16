import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function WarningIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

interface ImportResult {
  status: string;
  rowsInserted: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

interface RestoreOnboardingProps {
  tenantId: string;
  onBack: () => void;
}

export function RestoreOnboarding({ tenantId, onBack }: RestoreOnboardingProps) {
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

  const canRestore = !!selectedFile && !isUploading && !importResult;

  // After successful restore, show a success card with a reload button
  if (importResult) {
    return (
      <div className="max-w-lg">
        <div className="card px-6 py-5">
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 mb-4">
            <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
              <ShieldIcon />
              <div className="text-xs">
                <p className="font-semibold mb-1">Restore complete</p>
                <p>{importResult.rowsInserted.toLocaleString()} rows imported in {(importResult.durationMs / 1000).toFixed(1)}s.</p>
                {importResult.warnings.length > 0 && (
                  <p className="mt-1 text-amber-600 dark:text-amber-400">{importResult.warnings.length} warning(s) — check server logs for details.</p>
                )}
              </div>
            </div>
          </div>
          <button
            className="btn-primary w-full"
            onClick={() => window.location.reload()}
          >
            Reload to see your data
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <button
        className="btn-ghost text-xs mb-4"
        onClick={onBack}
        disabled={isUploading}
      >
        &larr; Back to options
      </button>

      <div className="card px-6 py-5">
        {/* Warning box */}
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 mb-5">
          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
            <WarningIcon />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold">Upload a .tar.gz backup</span> previously exported from Hisaabo.
              All data will be imported preserving original IDs. This action cannot be undone.
            </div>
          </div>
        </div>

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
            disabled={isUploading}
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
              <span>Uploading... do not close this tab</span>
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

        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => setShowConfirm(true)}
          disabled={!canRestore}
          aria-label="Restore from backup"
        >
          {isUploading ? <Spinner size="sm" /> : <UploadIcon />}
          {isUploading ? "Restoring..." : "Restore from backup"}
        </button>

        <ConfirmDialog
          open={showConfirm}
          title="Confirm restore"
          description={`This will import all data from "${selectedFile?.name}" into your organization. This cannot be undone. Continue?`}
          confirmLabel="Restore"
          variant="danger"
          loading={isUploading}
          onConfirm={handleRestore}
          onCancel={() => setShowConfirm(false)}
        />
      </div>
    </div>
  );
}
