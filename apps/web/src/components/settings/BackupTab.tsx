import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function ShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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

// ── Export Section ────────────────────────────────────────────────────────────

function ExportSection({ tenantId }: { tenantId: string }) {
  const exportMut = trpc.selfExport.request.useMutation({
    onSuccess: (data) => {
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
        <span>Limit: 2 exports per day. To restore a backup, create a new empty organization and use the restore option during setup.</span>
      </div>

      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => exportMut.mutate({ tenantId })}
        disabled={exportMut.isPending}
        aria-label="Export tenant data"
      >
        {exportMut.isPending ? <Spinner size="sm" /> : <DownloadIcon />}
        {exportMut.isPending ? "Preparing export..." : "Export Data"}
      </button>
    </div>
  );
}

// ── Main BackupTab ────────────────────────────────────────────────────────────

export function BackupTab() {
  const { data: session } = trpc.auth.me.useQuery();

  const isOwner = session?.role === "owner" || session?.role === "superadmin";

  if (session !== undefined && !isOwner) {
    return (
      <div className="card px-6 py-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mx-auto mb-3 text-text-tertiary">
          <ShieldIcon />
        </div>
        <p className="text-sm font-medium text-text-primary mb-1">Owner access required</p>
        <p className="text-sm text-text-tertiary">
          Only tenant owners can access backup settings. Contact your organization owner.
        </p>
      </div>
    );
  }

  if (!session?.tenantId) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Backup</h2>
        <p className="text-xs text-text-tertiary">
          Export a full snapshot of your organization's data.
        </p>
      </div>

      <ExportSection tenantId={session.tenantId} />
    </div>
  );
}
