/**
 * Tally Export tab of Reports (GST / Tax Reports page).
 *
 * Downloads Tally Prime XML (`reports.tallyExport`): ledger masters plus every
 * invoice, payment, expense and journal entry in the period, which Tally imports
 * through Gateway of Tally > Import. Nothing is fetched until the user clicks
 * Download: the XML covers the whole period, so it is too big to build just to
 * show a preview.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { useDateRange } from "@/hooks/useDateRange";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { countTallyVouchers, resolveTallyRange, tallyXmlBlob } from "@/lib/tally-export";

export function TallyExportPanel() {
  const [downloading, setDownloading] = useState(false);

  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("tally-export", "this-fy");

  const utils = trpc.useUtils();

  async function handleDownload() {
    setDownloading(true);
    try {
      const result = await utils.reports.tallyExport.fetch(resolveTallyRange({ fromDate, toDate }));
      if (!result) return;

      const vouchers = countTallyVouchers(result.xml);
      if (vouchers === 0) {
        toast.info("No vouchers found", "There are no invoices, payments, expenses or journal entries in the selected period.");
        return;
      }

      const url = URL.createObjectURL(tallyXmlBlob(result.xml));
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Tally export downloaded — ${vouchers} ${vouchers === 1 ? "voucher" : "vouchers"}`);
    } catch {
      toast.error("Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="card px-4 py-4">
        <p className="text-xs text-text-tertiary mb-3 font-medium uppercase tracking-wide">Period</p>
        <DateRangeBar
          preset={preset}
          onPresetChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={setCustomRange}
        />
      </div>

      {/* Format + download */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Format</p>
          <p className="text-base font-semibold text-text-primary">Tally Prime XML</p>
          <p className="text-xs text-text-tertiary">Imports directly into Tally Prime</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Includes</p>
          <p className="text-base font-semibold text-text-primary">Ledgers and vouchers</p>
          <p className="text-xs text-text-tertiary">
            Invoices, payments, expenses and journal entries for the period
          </p>
        </div>
        <div className="card px-4 py-3 flex items-center">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="btn-primary w-full inline-flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                </svg>
                Download Tally XML
              </>
            )}
          </button>
        </div>
      </div>

      <div className="card px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Importing into Tally Prime</h3>
        <p className="text-xs text-text-secondary">
          Open Tally Prime, go to Gateway of Tally, choose Import, then Data, and select the downloaded
          XML file. Ledger masters are created first, then the vouchers.
        </p>
      </div>
    </div>
  );
}
