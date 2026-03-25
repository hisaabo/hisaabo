import { useState } from "react";
import JSZip from "jszip";
import { ImportWizard } from "@/components/ImportWizard";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

export function DataTab() {
  const [showImport, setShowImport] = useState(false);

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
      a.download = `hisaabo-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported successfully");
    },
    onError: (err) => toast.error("Export failed", err.message),
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card px-6 py-5">
          <div className="flex flex-col gap-4 h-full">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Import Data</h3>
              <p className="text-sm text-text-tertiary mt-0.5">
                Migrate from myBillBook, Tally, or import CSV data
              </p>
            </div>
            <div className="mt-auto">
              <button className="btn-secondary" onClick={() => setShowImport(true)}>
                Start Import
              </button>
            </div>
          </div>
        </div>

        <div className="card px-6 py-5">
          <div className="flex flex-col gap-4 h-full">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Export Data</h3>
              <p className="text-sm text-text-tertiary mt-0.5">
                Download all business data as CSV files in a ZIP bundle
              </p>
            </div>
            <div className="mt-auto">
              <button
                className="btn-secondary"
                onClick={() => exportMut.mutate()}
                disabled={exportMut.isPending}
              >
                {exportMut.isPending ? "Exporting…" : "Export All Data"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ImportWizard open={showImport} onClose={() => setShowImport(false)} />
    </>
  );
}
