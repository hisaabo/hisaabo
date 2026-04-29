import { useState } from "react";
import JSZip from "jszip";
import { ImportWizard } from "@/components/ImportWizard";
import { trpc } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { toast } from "@/hooks/useToast";
import { Spinner } from "@/components/ui/Spinner";
import { todayISODate } from "@/lib/utils";
import dayjs from "dayjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = dayjs(iso);
  if (!d.isValid()) return "—";
  return d.format("D MMM YYYY, h:mm A");
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

function SpreadsheetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="2" y="4" width="20" height="4" rx="1" />
      <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
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

// ── Section wrapper ───────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card px-6 py-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center text-brand-600 shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="text-sm text-text-tertiary mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Import Section ────────────────────────────────────────────────────────────

function ImportSection({ onOpen }: { onOpen: () => void }) {
  return (
    <SectionCard
      icon={<UploadIcon />}
      title="Import data"
      description="Migrate from myBillBook, Tally, or upload CSV files into the current business."
    >
      <button className="btn-secondary" onClick={onOpen}>
        Start import
      </button>
    </SectionCard>
  );
}

// ── CSV Export Section (current business, spreadsheet-friendly) ──────────────

function CsvExportSection() {
  const exportMut = trpc.business.exportData.useMutation({
    onSuccess: async (data) => {
      const zip = new JSZip();
      zip.file("parties.csv", data.parties);
      zip.file("items.csv", data.items);
      zip.file("invoices.csv", data.invoices);
      zip.file("invoice_line_items.csv", data.lineItems);
      zip.file("payments.csv", data.payments);
      zip.file("expenses.csv", data.expenses);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hisaabo-export-${todayISODate()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported successfully");
    },
    onError: (err) => toast.error("Export failed", err.message),
  });

  return (
    <SectionCard
      icon={<SpreadsheetIcon />}
      title="Export as CSV"
      description="Download the current business as CSV files in a ZIP bundle — ideal for spreadsheets and external tools. Not used for restoring."
    >
      <button
        className="btn-secondary"
        onClick={() => exportMut.mutate()}
        disabled={exportMut.isPending}
      >
        {exportMut.isPending ? "Exporting…" : "Export CSV bundle"}
      </button>
    </SectionCard>
  );
}

// ── Full Backup Section (tenant-wide, restorable) ────────────────────────────

function FullBackupSection({ tenantId }: { tenantId: string }) {
  const exportMut = trpc.selfExport.request.useMutation({
    onSuccess: (data) => {
      // Resolve the URL against VITE_API_URL when the server returns a
      // relative path (split-host deploys: app.hisaabo.in + api.hisaabo.in).
      // Falls through unchanged when the server returns an absolute URL.
      const href = data.url.startsWith("http") ? data.url : apiUrl(data.url);
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
    <SectionCard
      icon={<ArchiveIcon />}
      title="Full backup (restorable)"
      description="Download a complete snapshot of your organization — all businesses, parties, items, invoices, payments, and other records. Re-import into an empty organization to restore."
    >
      <div className="flex items-center gap-2 text-xs text-text-tertiary mb-4 px-0.5">
        <InfoIcon />
        <span>Limit: 2 exports per day. Restore from the onboarding screen of a new organization.</span>
      </div>
      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => exportMut.mutate({ tenantId })}
        disabled={exportMut.isPending}
        aria-label="Export tenant data"
      >
        {exportMut.isPending ? <Spinner size="sm" /> : <DownloadIcon />}
        {exportMut.isPending ? "Preparing backup…" : "Download backup"}
      </button>
    </SectionCard>
  );
}

// ── Main DataTab ──────────────────────────────────────────────────────────────

export function DataTab() {
  const [showImport, setShowImport] = useState(false);
  const { data: session } = trpc.auth.me.useQuery();
  const isOwner = session?.role === "owner" || session?.role === "superadmin";

  return (
    <>
      <div className="space-y-4">
        <ImportSection onOpen={() => setShowImport(true)} />
        <CsvExportSection />
        {isOwner && session?.tenantId && <FullBackupSection tenantId={session.tenantId} />}
      </div>
      <ImportWizard open={showImport} onClose={() => setShowImport(false)} />
    </>
  );
}
