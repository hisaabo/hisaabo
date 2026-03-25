import { useState } from "react";
import { ImportWizard } from "@/components/ImportWizard";

export function DataTab() {
  const [showImport, setShowImport] = useState(false);

  return (
    <>
      <div className="card px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Import Data</h3>
            <p className="text-sm text-text-tertiary mt-0.5">
              Migrate from myBillBook, Tally, or import CSV data
            </p>
          </div>
          <button className="btn-secondary" onClick={() => setShowImport(true)}>
            Start Import
          </button>
        </div>
      </div>
      <ImportWizard open={showImport} onClose={() => setShowImport(false)} />
    </>
  );
}
