import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";

dayjs.extend(utc);
import { apiUrl } from "@/lib/api-url";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Combobox } from "@/components/ui/Combobox";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { toast } from "@/hooks/useToast";
import { useDateRange } from "@/hooks/useDateRange";

export const Route = createFileRoute("/gst")({
  component: GSTReportsPage,
});

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ReportTab = "gstr1" | "gstr3b" | "gstr9" | "pnl" | "trial-balance" | "balance-sheet" | "aging" | "ledger" | "tally";

function GSTReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTabRaw] = useState<ReportTab>(
    () => (localStorage.getItem("hisaabo_gst_tab") as ReportTab) || "gstr1"
  );
  const setActiveTab = (tab: ReportTab) => {
    setActiveTabRaw(tab);
    localStorage.setItem("hisaabo_gst_tab", tab);
  };

  const { data: businesses } = trpc.business.list.useQuery();
  const biz = businesses?.[0];

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const isGstRegistered = biz?.gstRegistrationType !== "unregistered" || !!biz?.gstin;

  // Report labels adapt based on GST status
  const reportTitle = isGstRegistered ? "GST Returns" : "Tax Reports";
  const reportDesc = isGstRegistered
    ? "Generate GSTR-1, GSTR-3B, P&L, aging report, party ledger and Tally export"
    : "Sales summary, tax reports, P&L, aging report, party ledger and Tally export";
  const tab1Label = isGstRegistered ? "GSTR-1" : "Sales Report";
  const tab2Label = isGstRegistered ? "GSTR-3B" : "Tax Summary";

  const tabs: Array<{ value: ReportTab; label: string }> = [
    { value: "gstr1", label: tab1Label },
    { value: "gstr3b", label: tab2Label },
    { value: "gstr9", label: "GSTR-9" },
    { value: "pnl", label: "Profit & Loss" },
    { value: "trial-balance", label: "Trial Balance" },
    { value: "balance-sheet", label: "Balance Sheet" },
    { value: "aging", label: "Aging Report" },
    { value: "ledger", label: "Party Ledger" },
    { value: "tally", label: "Tally Export" },
  ];

  return (
    <div>
      <PageHeader
        title={reportTitle}
        description={reportDesc}
      />

      {/* Tab bar */}
      <div className="mb-6">
        <PillTabs
          tabs={tabs}
          value={activeTab}
          onChange={(v) => setActiveTab(v as ReportTab)}
        />
      </div>

      {/* Period selector — only shown for GST tabs */}
      {(activeTab === "gstr1" || activeTab === "gstr3b") && (
        <div className="flex items-center gap-3 mb-6">
          <select
            className="input w-40"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {months.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            className="input w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <div className="ml-4">
            <SegmentedControl
              tabs={[
                { value: "gstr1", label: tab1Label },
                { value: "gstr3b", label: tab2Label },
              ]}
              value={activeTab}
              onChange={(v) => setActiveTab(v as ReportTab)}
            />
          </div>
        </div>
      )}

      {activeTab === "gstr1" && <GSTR1View year={year} month={month} />}
      {activeTab === "gstr3b" && <GSTR3BView year={year} month={month} />}
      {activeTab === "gstr9" && <GSTR9View />}
      {activeTab === "pnl" && <ProfitAndLossView />}
      {activeTab === "trial-balance" && <TrialBalanceView />}
      {activeTab === "balance-sheet" && <BalanceSheetView />}
      {activeTab === "aging" && <AgingReportView />}
      {activeTab === "ledger" && <PartyLedgerView />}
      {activeTab === "tally" && <TallyExportView />}
    </div>
  );
}

// ── GSTR-1 View ────────────────────────────────────────────────

function GSTR1View({ year, month }: { year: number; month: number }) {
  const { data, isLoading, error } = trpc.gst.gstr1.useQuery({ year, month });
  const { data: csvData } = trpc.gst.gstr1CSV.useQuery({ year, month });

  function handleExport() {
    if (!csvData) return;
    const blob = new Blob([csvData.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvData.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("GSTR-1 CSV exported");
  }

  if (isLoading) return <ReportSkeleton />;
  if (error) return (
    <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-400">Failed to load report: {error.message}</p>
    </div>
  );
  if (!data) return (
    <EmptyState
      title="GST not applicable"
      description="Your business is not registered under GST. GST reports are only available for GST-registered businesses."
    />
  );

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Invoice Count" value={data.invoiceCount} />
        <StatCard label="Taxable Value" value={fmt(data.totalTaxableValue)} />
        <StatCard label="Total Tax" value={fmt(data.totalTax)} valueColor="text-amber-600" />
        <StatCard label="Total Value" value={fmt(data.totalInvoiceValue)} valueColor="text-emerald-600" />
      </div>

      {/* Tax split cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="CGST" value={fmt(data.totalCgst)} />
        <StatCard label="SGST" value={fmt(data.totalSgst)} />
        <StatCard label="IGST" value={fmt(data.totalIgst)} />
      </div>

      {/* B2B Table */}
      {data.b2b.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">B2B — Outward supplies to registered persons</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Party GSTIN</th>
                <th>Name</th>
                <th>Invoice #</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
                <th className="text-right">IGST</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.b2b.map((row, i) => (
                <tr key={i}>
                  <td className="font-mono text-[13px] text-text-secondary">{row.partyGstin}</td>
                  <td className="text-text-primary">{row.partyName}</td>
                  <td className="font-mono text-[13px] text-text-secondary">{row.invoiceNumber}</td>
                  <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                  <td className="text-right tabular-nums text-text-secondary">{fmt(row.cgst)}</td>
                  <td className="text-right tabular-nums text-text-secondary">{fmt(row.sgst)}</td>
                  <td className="text-right tabular-nums text-text-secondary">{fmt(row.igst)}</td>
                  <td className="text-right tabular-nums font-medium">{fmt(row.totalInvoiceValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* B2CS Table */}
      {data.b2cSmall.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">B2CS — Outward supplies to unregistered persons</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tax Rate</th>
                <th className="text-right">Taxable Value</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
                <th className="text-right">IGST</th>
              </tr>
            </thead>
            <tbody>
              {data.b2cSmall.map((row, i) => (
                <tr key={i}>
                  <td className="text-text-primary">{row.taxRate}%</td>
                  <td className="text-right tabular-nums">{fmt(row.taxableValue)}</td>
                  <td className="text-right tabular-nums text-text-secondary">{fmt(row.cgst)}</td>
                  <td className="text-right tabular-nums text-text-secondary">{fmt(row.sgst)}</td>
                  <td className="text-right tabular-nums text-text-secondary">{fmt(row.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Export */}
      <div className="flex justify-end">
        <button onClick={handleExport} className="btn-primary">
          Export GSTR-1 CSV
        </button>
      </div>
    </div>
  );
}

// ── GSTR-3B View ───────────────────────────────────────────────

function GSTR3BView({ year, month }: { year: number; month: number }) {
  const { data, isLoading, error } = trpc.gst.gstr3b.useQuery({ year, month });

  if (isLoading) return <ReportSkeleton />;
  if (error) return (
    <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-400">Failed to load report: {error.message}</p>
    </div>
  );
  if (!data) return (
    <EmptyState
      title="GST not applicable"
      description="Your business is not registered under GST. GST reports are only available for GST-registered businesses."
    />
  );

  return (
    <div className="space-y-5">
      {/* 3.1 Outward supplies */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">3.1 — Outward supplies and inward supplies liable to reverse charge</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="text-right">IGST</th>
              <th className="text-right">CGST</th>
              <th className="text-right">SGST</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-text-primary">Taxable outward supplies</td>
              <td className="text-right tabular-nums">{fmt(data.outwardSupplies.taxable.igst)}</td>
              <td className="text-right tabular-nums">{fmt(data.outwardSupplies.taxable.cgst)}</td>
              <td className="text-right tabular-nums">{fmt(data.outwardSupplies.taxable.sgst)}</td>
            </tr>
            <tr>
              <td className="text-text-secondary">Zero-rated supplies</td>
              <td className="text-right tabular-nums text-text-secondary">{fmt(0)}</td>
              <td className="text-right tabular-nums text-text-secondary">{fmt(0)}</td>
              <td className="text-right tabular-nums text-text-secondary">{fmt(0)}</td>
            </tr>
            <tr>
              <td className="text-text-secondary">Exempt supplies</td>
              <td className="text-right tabular-nums text-text-secondary">{fmt(0)}</td>
              <td className="text-right tabular-nums text-text-secondary">{fmt(0)}</td>
              <td className="text-right tabular-nums text-text-secondary">{fmt(0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 4. ITC */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">4 — Eligible input tax credit</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 p-4">
          <StatCard label="ITC — IGST" value={fmt(data.itc.igst)} />
          <StatCard label="ITC — CGST" value={fmt(data.itc.cgst)} />
          <StatCard label="ITC — SGST" value={fmt(data.itc.sgst)} />
        </div>
        <div className="px-4 pb-4">
          <StatCard label="Total ITC available" value={fmt(data.itc.total)} valueColor="text-emerald-600" />
        </div>
      </div>

      {/* 5. Tax payable */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">5 — Values of exempt, nil-rated and non-GST inward supplies</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 p-4">
          <StatCard label="Output IGST" value={fmt(data.taxPayable.igst)} />
          <StatCard label="Output CGST" value={fmt(data.taxPayable.cgst)} />
          <StatCard label="Output SGST" value={fmt(data.taxPayable.sgst)} />
        </div>
      </div>

      {/* Net tax liability */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Net tax liability (after ITC)</h3>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
          <StatCard label="Net IGST" value={fmt(data.netTax.igst)} valueColor="text-amber-600" />
          <StatCard label="Net CGST" value={fmt(data.netTax.cgst)} valueColor="text-amber-600" />
          <StatCard label="Net SGST" value={fmt(data.netTax.sgst)} valueColor="text-amber-600" />
          <div className="card px-4 py-3 border-2 border-border-color">
            <p className="text-xs text-text-tertiary mb-1 font-medium">Total payable</p>
            <p className="text-xl font-bold tabular-nums text-red-600">{fmt(data.netTax.total)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Profit & Loss View ─────────────────────────────────────────

function ProfitAndLossView() {
  const [compareMode, setCompareMode] = useState(false);
  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("pnl-report", "this-fy");

  const curFY = getCurrentFYBounds();
  const prevFY = getPreviousFYBounds();

  const { data, isLoading, error } = trpc.dashboard.profitAndLoss.useQuery(
    { fromDate: fromDate || undefined, toDate: toDate || undefined },
    { enabled: !compareMode },
  );

  const { data: cmpData, isLoading: cmpLoading, error: cmpError } = trpc.reports.comparativeProfitAndLoss.useQuery(
    {
      currentFYStart: curFY.start,
      currentFYEnd: curFY.end,
      previousFYStart: prevFY.start,
      previousFYEnd: prevFY.end,
    },
    { enabled: compareMode },
  );

  const isLoading2 = compareMode ? cmpLoading : isLoading;
  const error2 = compareMode ? cmpError : error;

  return (
    <div className="space-y-5">
      {/* Period selector + compare toggle */}
      <div className="card px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-tertiary font-medium uppercase tracking-wide">Period</p>
          <CompareToggle enabled={compareMode} onToggle={() => setCompareMode((v) => !v)} />
        </div>
        {!compareMode ? (
          <DateRangeBar
            preset={preset}
            onPresetChange={setPreset}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={setCustomRange}
          />
        ) : (
          <p className="text-xs text-text-tertiary">
            Comparing {fyLabel(curFY.year)} (current) vs {fyLabel(prevFY.year)} (previous)
          </p>
        )}
      </div>

      {isLoading2 && <ReportSkeleton />}

      {error2 && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load report: {error2.message}</p>
        </div>
      )}

      {/* Comparative P&L view */}
      {compareMode && cmpData && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Comparative Profit & Loss — {fyLabel(curFY.year)} vs {fyLabel(prevFY.year)}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">{fyLabel(curFY.year)}</th>
                  <th className="text-right">{fyLabel(prevFY.year)}</th>
                  <th className="text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {cmpData.income.length > 0 && (
                  <tr className="bg-surface-1">
                    <td className="font-semibold text-text-primary" colSpan={4}>
                      Income
                    </td>
                  </tr>
                )}
                {cmpData.income.map((row) => (
                  <tr key={row.accountCode}>
                    <td className="pl-4 text-text-primary">{row.accountName}</td>
                    <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtStr(row.currentAmount)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmtStr(row.previousAmount)}</td>
                    <VarianceCell variance={row.variance} variancePercent={row.variancePercent} positiveIsGood={true} />
                  </tr>
                ))}
                <tr className="border-t border-border-light bg-surface-1">
                  <td className="font-semibold text-text-primary">Total Income</td>
                  <td className="text-right tabular-nums font-semibold text-emerald-600">{fmtStr(cmpData.currentTotalIncome)}</td>
                  <td className="text-right tabular-nums font-semibold text-text-secondary">{fmtStr(cmpData.previousTotalIncome)}</td>
                  <VarianceCell
                    variance={computeVarianceDisplay(cmpData.currentTotalIncome, cmpData.previousTotalIncome).variance}
                    variancePercent={computeVarianceDisplay(cmpData.currentTotalIncome, cmpData.previousTotalIncome).variancePercent}
                    positiveIsGood={true}
                  />
                </tr>
                {cmpData.expenses.length > 0 && (
                  <tr className="bg-surface-1">
                    <td className="font-semibold text-text-primary" colSpan={4}>
                      Expenses
                    </td>
                  </tr>
                )}
                {cmpData.expenses.map((row) => (
                  <tr key={row.accountCode}>
                    <td className="pl-4 text-text-primary">{row.accountName}</td>
                    <td className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtStr(row.currentAmount)}</td>
                    <td className="text-right tabular-nums text-text-secondary">{fmtStr(row.previousAmount)}</td>
                    <VarianceCell variance={row.variance} variancePercent={row.variancePercent} positiveIsGood={false} />
                  </tr>
                ))}
                <tr className="border-t border-border-light bg-surface-1">
                  <td className="font-semibold text-text-primary">Total Expenses</td>
                  <td className="text-right tabular-nums font-semibold text-amber-600">{fmtStr(cmpData.currentTotalExpenses)}</td>
                  <td className="text-right tabular-nums font-semibold text-text-secondary">{fmtStr(cmpData.previousTotalExpenses)}</td>
                  <VarianceCell
                    variance={computeVarianceDisplay(cmpData.currentTotalExpenses, cmpData.previousTotalExpenses).variance}
                    variancePercent={computeVarianceDisplay(cmpData.currentTotalExpenses, cmpData.previousTotalExpenses).variancePercent}
                    positiveIsGood={false}
                  />
                </tr>
                <tr className="border-t-2 border-border-color bg-surface-1">
                  <td className="font-bold text-text-primary">Net Profit / (Loss)</td>
                  <td
                    className={`text-right tabular-nums font-bold ${parseFloat(cmpData.currentNetProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {fmtStr(cmpData.currentNetProfit)}
                  </td>
                  <td
                    className={`text-right tabular-nums font-bold ${parseFloat(cmpData.previousNetProfit) >= 0 ? "text-text-secondary" : "text-red-600"}`}
                  >
                    {fmtStr(cmpData.previousNetProfit)}
                  </td>
                  <VarianceCell
                    variance={cmpData.netProfitVariance}
                    variancePercent={cmpData.netProfitVariancePercent}
                    positiveIsGood={true}
                  />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Standard (non-comparative) view */}
      {!compareMode && data && (
        <>
          {/* Top-line summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Revenue</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">{fmtStr(data.revenue)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">COGS (Purchases)</p>
              <p className="text-lg font-bold tabular-nums text-blue-600">{fmtStr(data.cogs)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Gross Profit</p>
              <p className={`text-lg font-bold tabular-nums ${parseFloat(data.grossProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmtStr(data.grossProfit)}
              </p>
              <p className="text-[11px] text-text-tertiary mt-0.5">{data.grossMarginPercent}% margin</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Expenses</p>
              <p className="text-lg font-bold tabular-nums text-amber-600">{fmtStr(data.totalExpenses)}</p>
            </div>
            <div className="card px-4 py-3 border-2 border-border-color">
              <p className="text-xs text-text-tertiary mb-1 font-semibold">Net Profit</p>
              <p className={`text-xl font-bold tabular-nums ${parseFloat(data.netProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {fmtStr(data.netProfit)}
              </p>
              <p className="text-[11px] text-text-tertiary mt-0.5">{data.netMarginPercent}% margin</p>
            </div>
          </div>

          {/* P&L Statement table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light">
              <h3 className="text-sm font-semibold text-text-primary">Profit & Loss Statement</h3>
            </div>
            <table className="data-table">
              <tbody>
                <tr className="bg-surface-1">
                  <td className="font-semibold text-text-primary">Revenue (Sales)</td>
                  <td className="text-right tabular-nums font-semibold text-emerald-600">{fmtStr(data.revenue)}</td>
                </tr>
                <tr>
                  <td className="text-text-secondary pl-6">Less: Cost of Goods Sold (Purchases)</td>
                  <td className="text-right tabular-nums text-text-secondary">({fmtStr(data.cogs)})</td>
                </tr>
                <tr className="border-t border-border-light bg-surface-1">
                  <td className="font-semibold text-text-primary">Gross Profit</td>
                  <td className={`text-right tabular-nums font-semibold ${parseFloat(data.grossProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtStr(data.grossProfit)} <span className="text-[11px] font-normal text-text-tertiary">({data.grossMarginPercent}%)</span>
                  </td>
                </tr>
                {data.expenses.length > 0 && (
                  <tr>
                    <td className="font-medium text-text-primary pt-3 pb-1" colSpan={2}>Operating Expenses</td>
                  </tr>
                )}
                {data.expenses.map((exp) => (
                  <tr key={exp.category}>
                    <td className="text-text-secondary pl-6">{exp.category}</td>
                    <td className="text-right tabular-nums text-text-secondary">({fmtStr(exp.total)})</td>
                  </tr>
                ))}
                <tr className="border-t border-border-light">
                  <td className="text-text-primary pl-6 font-medium">Total Operating Expenses</td>
                  <td className="text-right tabular-nums text-amber-600 font-medium">({fmtStr(data.totalExpenses)})</td>
                </tr>
                <tr className="border-t-2 border-border-color bg-surface-1">
                  <td className="font-bold text-text-primary">Net Profit / (Loss)</td>
                  <td className={`text-right tabular-nums font-bold text-lg ${parseFloat(data.netProfit) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtStr(data.netProfit)} <span className="text-[11px] font-normal text-text-tertiary">({data.netMarginPercent}%)</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── FY date helpers ────────────────────────────────────────────
// All boundaries are UTC — the DB stores UTC timestamps and local-time
// construction in IST would shift April 1 → March 31 UTC, pulling the
// previous March into the current FY.
function getCurrentFYBounds(): { start: string; end: string; year: number } {
  const now = dayjs.utc();
  const mm = now.month();
  const fyYear = mm >= 3 ? now.year() : now.year() - 1;
  return {
    start: dayjs.utc().year(fyYear).month(3).date(1).startOf("day").toISOString(),
    end: now.toISOString(),
    year: fyYear,
  };
}

function getPreviousFYBounds(): { start: string; end: string; year: number } {
  const now = dayjs.utc();
  const mm = now.month();
  const prevFyYear = mm >= 3 ? now.year() - 1 : now.year() - 2;
  return {
    start: dayjs.utc().year(prevFyYear).month(3).date(1).startOf("day").toISOString(),
    end: dayjs.utc().year(prevFyYear + 1).month(2).date(31).endOf("day").toISOString(),
    year: prevFyYear,
  };
}

function fyLabel(year: number): string {
  return `FY ${year}-${String(year + 1).slice(-2)}`;
}

// ── Client-side variance helper ───────────────────────────────
function computeVarianceDisplay(current: string, previous: string): { variance: string; variancePercent: string } {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;
  const v = c - p;
  const prevAbs = Math.abs(p);
  const pct = prevAbs === 0 ? "N/A" : ((v / prevAbs) * 100).toFixed(1);
  return { variance: v.toFixed(2), variancePercent: pct };
}

// ── Variance cell helper ───────────────────────────────────────
function VarianceCell({
  variance,
  variancePercent,
  positiveIsGood = true,
}: {
  variance: string;
  variancePercent: string;
  positiveIsGood?: boolean;
}) {
  const v = parseFloat(variance);
  const isGood = positiveIsGood ? v > 0 : v < 0;
  const isNeutral = v === 0;
  const colorClass = isNeutral
    ? "text-text-tertiary"
    : isGood
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const prefix = v > 0 ? "+" : "";
  return (
    <td className={`text-right tabular-nums ${colorClass}`}>
      {prefix}
      {fmtStr(variance)}
      {variancePercent !== "N/A" && (
        <span className="text-[11px] ml-1 opacity-70">
          ({prefix}
          {variancePercent}%)
        </span>
      )}
    </td>
  );
}

// ── Compare toggle ─────────────────────────────────────────────
function CompareToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-xs text-text-secondary">Compare with previous FY</span>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-border-color"}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}

// ── Trial Balance View ─────────────────────────────────────────

function TrialBalanceView() {
  const [compareMode, setCompareMode] = useState(false);
  const curFY = getCurrentFYBounds();
  const prevFY = getPreviousFYBounds();

  const { data, isLoading, error } = trpc.reports.trialBalance.useQuery(
    { asOfDate: curFY.end },
    { enabled: !compareMode },
  );

  const { data: cmpData, isLoading: cmpLoading, error: cmpError } = trpc.reports.comparativeTrialBalance.useQuery(
    {
      currentFYStart: curFY.start,
      currentFYEnd: curFY.end,
      previousFYStart: prevFY.start,
      previousFYEnd: prevFY.end,
    },
    { enabled: compareMode },
  );

  const loading = compareMode ? cmpLoading : isLoading;
  const err = compareMode ? cmpError : error;

  return (
    <div className="space-y-5">
      <div className="card px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Trial Balance</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            {compareMode ? `${fyLabel(curFY.year)} vs ${fyLabel(prevFY.year)}` : `${fyLabel(curFY.year)} — year to date`}
          </p>
        </div>
        <CompareToggle enabled={compareMode} onToggle={() => setCompareMode((v) => !v)} />
      </div>

      {loading && <ReportSkeleton />}
      {err && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load trial balance: {err.message}</p>
        </div>
      )}

      {!compareMode && data && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.accountCode}>
                    <td className="font-mono text-[13px] text-text-secondary">{a.accountCode}</td>
                    <td className="text-text-primary">{a.accountName}</td>
                    <td className="text-[13px] text-text-secondary capitalize">{a.accountType}</td>
                    <td className="text-right tabular-nums">
                      {parseFloat(a.debit) > 0 ? fmtStr(a.debit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      {parseFloat(a.credit) > 0 ? fmtStr(a.credit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums font-medium">{fmtStr(a.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-color bg-surface-1 font-semibold">
                  <td colSpan={3} className="font-bold text-text-primary">
                    Total
                  </td>
                  <td className="text-right tabular-nums font-bold">{fmtStr(data.totalDebit)}</td>
                  <td className="text-right tabular-nums font-bold">{fmtStr(data.totalCredit)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {compareMode && cmpData && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Comparative Trial Balance — {fyLabel(curFY.year)} vs {fyLabel(prevFY.year)}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Code</th>
                  <th rowSpan={2}>Account</th>
                  <th colSpan={2} className="text-center border-l border-border-light">
                    {fyLabel(curFY.year)}
                  </th>
                  <th colSpan={2} className="text-center border-l border-border-light">
                    {fyLabel(prevFY.year)}
                  </th>
                  <th rowSpan={2} className="text-right border-l border-border-light">
                    Variance
                  </th>
                </tr>
                <tr>
                  <th className="text-right border-l border-border-light">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right border-l border-border-light">Debit</th>
                  <th className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {cmpData.accounts.map((a) => (
                  <tr key={a.accountCode}>
                    <td className="font-mono text-[13px] text-text-secondary">{a.accountCode}</td>
                    <td className="text-text-primary">{a.accountName}</td>
                    <td className="text-right tabular-nums border-l border-border-light">
                      {parseFloat(a.currentDebit) > 0 ? fmtStr(a.currentDebit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      {parseFloat(a.currentCredit) > 0 ? fmtStr(a.currentCredit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums border-l border-border-light text-text-secondary">
                      {parseFloat(a.previousDebit) > 0 ? fmtStr(a.previousDebit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="text-right tabular-nums text-text-secondary">
                      {parseFloat(a.previousCredit) > 0 ? fmtStr(a.previousCredit) : <span className="text-text-tertiary">—</span>}
                    </td>
                    <VarianceCell variance={a.variance} variancePercent={a.variancePercent} positiveIsGood={true} />
                  </tr>
                ))}
                <tr className="border-t-2 border-border-color bg-surface-1">
                  <td colSpan={2} className="font-bold text-text-primary">
                    Total
                  </td>
                  <td className="text-right tabular-nums font-bold border-l border-border-light">{fmtStr(cmpData.currentTotalDebit)}</td>
                  <td className="text-right tabular-nums font-bold">{fmtStr(cmpData.currentTotalCredit)}</td>
                  <td className="text-right tabular-nums font-bold border-l border-border-light text-text-secondary">
                    {fmtStr(cmpData.previousTotalDebit)}
                  </td>
                  <td className="text-right tabular-nums font-bold text-text-secondary">{fmtStr(cmpData.previousTotalCredit)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Balance Sheet View ─────────────────────────────────────────

function BalanceSheetView() {
  const [compareMode, setCompareMode] = useState(false);
  const curFY = getCurrentFYBounds();
  const prevFY = getPreviousFYBounds();

  const { data, isLoading, error } = trpc.reports.balanceSheet.useQuery(
    { asOfDate: curFY.end },
    { enabled: !compareMode },
  );

  const { data: cmpData, isLoading: cmpLoading, error: cmpError } = trpc.reports.comparativeBalanceSheet.useQuery(
    { currentAsOf: curFY.end, previousAsOf: prevFY.end },
    { enabled: compareMode },
  );

  const loading = compareMode ? cmpLoading : isLoading;
  const err = compareMode ? cmpError : error;

  return (
    <div className="space-y-5">
      <div className="card px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Balance Sheet</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            {compareMode ? `${fyLabel(curFY.year)} vs ${fyLabel(prevFY.year)}` : `As of today — ${fyLabel(curFY.year)}`}
          </p>
        </div>
        <CompareToggle enabled={compareMode} onToggle={() => setCompareMode((v) => !v)} />
      </div>

      {loading && <ReportSkeleton />}
      {err && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load balance sheet: {err.message}</p>
        </div>
      )}

      {!compareMode && data && (
        <>
          <BsSection title="Assets" items={data.assets} total={data.totalAssets} />
          <BsSection title="Liabilities" items={data.liabilities} total={data.totalLiabilities} />
          <BsSection title="Equity" items={data.equity} total={data.totalEquity} />
        </>
      )}

      {compareMode && cmpData && (
        <>
          <ComparativeBsSection
            title="Assets"
            items={cmpData.assets}
            currentTotal={cmpData.currentTotalAssets}
            previousTotal={cmpData.previousTotalAssets}
            curFYLabel={fyLabel(curFY.year)}
            prevFYLabel={fyLabel(prevFY.year)}
            positiveIsGood={true}
          />
          <ComparativeBsSection
            title="Liabilities"
            items={cmpData.liabilities}
            currentTotal={cmpData.currentTotalLiabilities}
            previousTotal={cmpData.previousTotalLiabilities}
            curFYLabel={fyLabel(curFY.year)}
            prevFYLabel={fyLabel(prevFY.year)}
            positiveIsGood={false}
          />
          <ComparativeBsSection
            title="Equity"
            items={cmpData.equity}
            currentTotal={cmpData.currentTotalEquity}
            previousTotal={cmpData.previousTotalEquity}
            curFYLabel={fyLabel(curFY.year)}
            prevFYLabel={fyLabel(prevFY.year)}
            positiveIsGood={true}
          />
        </>
      )}
    </div>
  );
}

// ── Balance Sheet sub-components ──────────────────────────────

function BsSection({
  title,
  items,
  total,
}: {
  title: string;
  items: Array<{ accountCode: string; accountName: string; balance: string }>;
  total: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <table className="data-table">
        <tbody>
          {items.map((item) => (
            <tr key={item.accountCode}>
              <td className="font-mono text-[13px] text-text-secondary w-20">{item.accountCode}</td>
              <td className="text-text-primary">{item.accountName}</td>
              <td className="text-right tabular-nums font-medium">{fmtStr(item.balance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-color bg-surface-1">
            <td colSpan={2} className="font-bold text-text-primary">
              Total {title}
            </td>
            <td className="text-right tabular-nums font-bold">{fmtStr(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ComparativeBsSection({
  title,
  items,
  currentTotal,
  previousTotal,
  curFYLabel,
  prevFYLabel,
  positiveIsGood,
}: {
  title: string;
  items: Array<{
    accountCode: string;
    accountName: string;
    currentBalance: string;
    previousBalance: string;
    variance: string;
    variancePercent: string;
  }>;
  currentTotal: string;
  previousTotal: string;
  curFYLabel: string;
  prevFYLabel: string;
  positiveIsGood: boolean;
}) {
  const totals = computeVarianceDisplay(currentTotal, previousTotal);
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border-light">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th className="text-right">{curFYLabel}</th>
              <th className="text-right">{prevFYLabel}</th>
              <th className="text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.accountCode}>
                <td className="font-mono text-[13px] text-text-secondary">{item.accountCode}</td>
                <td className="text-text-primary">{item.accountName}</td>
                <td className="text-right tabular-nums font-medium">{fmtStr(item.currentBalance)}</td>
                <td className="text-right tabular-nums text-text-secondary">{fmtStr(item.previousBalance)}</td>
                <VarianceCell variance={item.variance} variancePercent={item.variancePercent} positiveIsGood={positiveIsGood} />
              </tr>
            ))}
            <tr className="border-t-2 border-border-color bg-surface-1">
              <td colSpan={2} className="font-bold text-text-primary">
                Total {title}
              </td>
              <td className="text-right tabular-nums font-bold">{fmtStr(currentTotal)}</td>
              <td className="text-right tabular-nums font-bold text-text-secondary">{fmtStr(previousTotal)}</td>
              <VarianceCell variance={totals.variance} variancePercent={totals.variancePercent} positiveIsGood={positiveIsGood} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Aging Report View ──────────────────────────────────────────

type AgingSortKey = "partyName" | "current" | "days31_60" | "days61_90" | "days90Plus" | "total";

function AgingReportView() {
  const [sortKey, setSortKey] = useState<AgingSortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, error } = trpc.dashboard.receivablesAging.useQuery();

  function handleSort(key: AgingSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedRows = data?.rows ? [...data.rows].sort((a, b) => {
    let av: string | number = a[sortKey];
    let bv: string | number = b[sortKey];
    if (sortKey !== "partyName") {
      av = parseFloat(av as string);
      bv = parseFloat(bv as string);
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  }) : [];

  function SortIcon({ col }: { col: AgingSortKey }) {
    if (sortKey !== col) return <span className="text-text-tertiary ml-1">↕</span>;
    return <span className="text-text-primary ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div className="space-y-5">
      {/* Info card */}
      <div className="card px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-400">
          Showing all unpaid sale invoices grouped by customer and bucketed by days overdue (based on due date or invoice date).
        </p>
      </div>

      {isLoading && <ReportSkeleton />}

      {error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load aging report: {error.message}</p>
        </div>
      )}

      {data && data.rows.length === 0 && (
        <EmptyState
          title="No outstanding receivables"
          description="All your sale invoices are paid or cancelled."
        />
      )}

      {data && data.rows.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="card px-4 py-3 border-l-4 border-emerald-500">
              <p className="text-xs text-text-tertiary mb-1">Current (0–30 days)</p>
              <p className="text-base font-bold tabular-nums text-emerald-600">{fmtStr(data.summary.current)}</p>
            </div>
            <div className="card px-4 py-3 border-l-4 border-amber-400">
              <p className="text-xs text-text-tertiary mb-1">31–60 days</p>
              <p className="text-base font-bold tabular-nums text-amber-600">{fmtStr(data.summary.days31_60)}</p>
            </div>
            <div className="card px-4 py-3 border-l-4 border-orange-500">
              <p className="text-xs text-text-tertiary mb-1">61–90 days</p>
              <p className="text-base font-bold tabular-nums text-orange-600">{fmtStr(data.summary.days61_90)}</p>
            </div>
            <div className="card px-4 py-3 border-l-4 border-red-500">
              <p className="text-xs text-text-tertiary mb-1">90+ days</p>
              <p className="text-base font-bold tabular-nums text-red-600">{fmtStr(data.summary.days90Plus)}</p>
            </div>
            <div className="card px-4 py-3 border-2 border-border-color">
              <p className="text-xs text-text-tertiary mb-1 font-semibold">Total Outstanding</p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{fmtStr(data.summary.total)}</p>
            </div>
          </div>

          {/* Aging table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light">
              <h3 className="text-sm font-semibold text-text-primary">
                Receivables Aging — {data.rows.length} {data.rows.length === 1 ? "customer" : "customers"}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button className="text-left w-full" onClick={() => handleSort("partyName")}>
                        Party <SortIcon col="partyName" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("current")}>
                        0–30 days <SortIcon col="current" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("days31_60")}>
                        31–60 days <SortIcon col="days31_60" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("days61_90")}>
                        61–90 days <SortIcon col="days61_90" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("days90Plus")}>
                        90+ days <SortIcon col="days90Plus" />
                      </button>
                    </th>
                    <th className="text-right">
                      <button onClick={() => handleSort("total")}>
                        Total <SortIcon col="total" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.partyId}>
                      <td className="font-medium text-text-primary">{row.partyName}</td>
                      <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                        {parseFloat(row.current) > 0 ? fmtStr(row.current) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {parseFloat(row.days31_60) > 0 ? fmtStr(row.days31_60) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-orange-700 dark:text-orange-400">
                        {parseFloat(row.days61_90) > 0 ? fmtStr(row.days61_90) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-red-700 dark:text-red-400">
                        {parseFloat(row.days90Plus) > 0 ? fmtStr(row.days90Plus) : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-text-primary">
                        {fmtStr(row.total)}
                      </td>
                    </tr>
                  ))}
                  {/* Summary row */}
                  <tr className="border-t-2 border-border-color bg-surface-1 font-semibold">
                    <td className="font-bold text-text-primary">Total</td>
                    <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtStr(data.summary.current)}</td>
                    <td className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtStr(data.summary.days31_60)}</td>
                    <td className="text-right tabular-nums text-orange-700 dark:text-orange-400">{fmtStr(data.summary.days61_90)}</td>
                    <td className="text-right tabular-nums text-red-700 dark:text-red-400">{fmtStr(data.summary.days90Plus)}</td>
                    <td className="text-right tabular-nums font-bold text-text-primary">{fmtStr(data.summary.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Party Ledger View ──────────────────────────────────────────

function PartyLedgerView() {
  const [partyId, setPartyId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("ledger-report", "this-fy");

  const { data: partiesData } = trpc.party.list.useQuery({ limit: 100, page: 1 });
  const partyOptions = (partiesData?.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
    description: p.type === "customer" ? "Customer" : "Supplier",
  }));

  const { data, isLoading, error } = trpc.party.ledgerReport.useQuery(
    {
      partyId,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    },
    { enabled: !!partyId }
  );

  const utils = trpc.useUtils();

  async function handleExportCSV() {
    if (!partyId) return;
    setExporting(true);
    try {
      const result = await utils.party.ledgerReportCSV.fetch({
        partyId,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (!result) return;
      const blob = new Blob(["\ufeff" + result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Ledger CSV exported");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPDF() {
    if (!partyId) return;
    setExportingPdf(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const res = await fetch(apiUrl(`/api/parties/${partyId}/ledger.pdf?${params}`), {
        credentials: "include",
        headers: { "x-business-id": getBusinessId() || "" },
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledger-${data?.party.name || "party"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Party selector + date range */}
      <div className="card px-4 py-4 space-y-4">
        <div className="w-full max-w-sm">
          <Combobox
            label="Select Party"
            placeholder="Search parties..."
            value={partyId}
            onChange={setPartyId}
            options={partyOptions}
            emptyMessage="No parties found"
          />
        </div>
        <DateRangeBar
          preset={preset}
          onPresetChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={setCustomRange}
        />
      </div>

      {!partyId && (
        <EmptyState
          title="Select a party"
          description="Choose a customer or supplier above to view their ledger."
        />
      )}

      {partyId && isLoading && <ReportSkeleton />}

      {partyId && error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load ledger: {error.message}</p>
        </div>
      )}

      {partyId && !isLoading && !error && !data && (
        <EmptyState title="Party not found" description="The selected party could not be found." />
      )}

      {data && (
        <>
          {/* Party info + summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card px-4 py-3 col-span-2 lg:col-span-1">
              <p className="text-xs text-text-tertiary mb-1">Party</p>
              <p className="text-base font-bold text-text-primary truncate">{data.party.name}</p>
              <p className="text-xs text-text-secondary capitalize">{data.party.type}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Opening Balance</p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{fmtStr(data.party.openingBalance)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Total Debit</p>
              <p className="text-lg font-bold tabular-nums text-text-primary">{fmtStr(data.summary.totalDebit)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-xs text-text-tertiary mb-1">Closing Balance</p>
              <p className={`text-lg font-bold tabular-nums ${parseFloat(data.summary.closingBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {fmtStr(data.summary.closingBalance)}
              </p>
            </div>
          </div>

          {/* Ledger table */}
          {data.entries.length === 0 ? (
            <EmptyState
              title="No transactions"
              description="No invoices or payments found for this party in the selected period."
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border-light flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">
                  Ledger — {data.entries.length} entries
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportCSV}
                    disabled={exporting}
                    className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                  >
                    {exporting ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <DownloadIcon className="w-3.5 h-3.5" />
                        Export CSV
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleExportPDF}
                    disabled={exportingPdf}
                    className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                  >
                    {exportingPdf ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <DownloadIcon className="w-3.5 h-3.5" />
                        Export PDF
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Document #</th>
                      <th>Description</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening balance row */}
                    <tr className="bg-surface-1">
                      <td className="text-text-tertiary text-xs italic" colSpan={3}>Opening Balance</td>
                      <td className="text-right tabular-nums text-text-tertiary">—</td>
                      <td className="text-right tabular-nums text-text-tertiary">—</td>
                      <td className="text-right tabular-nums font-medium">{fmtStr(data.party.openingBalance)}</td>
                    </tr>
                    {data.entries.map((e, i) => (
                      <tr key={i}>
                        <td className="text-text-secondary text-[13px]">{formatDate(e.date)}</td>
                        <td className="font-mono text-[13px] text-text-secondary">{e.number || "—"}</td>
                        <td className="text-text-primary">{e.description}</td>
                        <td className="text-right tabular-nums">
                          {e.debit !== "0" && e.debit !== "0.00" ? fmtStr(e.debit) : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="text-right tabular-nums">
                          {e.credit !== "0" && e.credit !== "0.00" ? fmtStr(e.credit) : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className={`text-right tabular-nums font-medium ${parseFloat(e.runningBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {fmtStr(e.runningBalance)}
                        </td>
                      </tr>
                    ))}
                    {/* Closing balance row */}
                    <tr className="bg-surface-1 border-t-2 border-border-light">
                      <td className="font-semibold text-text-primary text-xs" colSpan={3}>Closing Balance</td>
                      <td className="text-right tabular-nums font-semibold">{fmtStr(data.summary.totalDebit)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtStr(data.summary.totalCredit)}</td>
                      <td className={`text-right tabular-nums font-bold ${parseFloat(data.summary.closingBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {fmtStr(data.summary.closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tally Export View ──────────────────────────────────────────

function TallyExportView() {
  const [downloading, setDownloading] = useState(false);

  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("tally-export", "this-fy");

  const { data, isLoading } = trpc.party.tallyExport.useQuery({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });

  const utils = trpc.useUtils();

  async function handleDownload() {
    setDownloading(true);
    try {
      const result = await utils.party.tallyExport.fetch({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (!result) return;
      const blob = new Blob(["\ufeff" + result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Tally export downloaded — ${result.rowCount} vouchers`);
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

      {/* Summary + download */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Total Vouchers</p>
          <p className="text-lg font-bold tabular-nums text-text-primary">
            {isLoading ? "—" : (data?.rowCount ?? 0)}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Format</p>
          <p className="text-base font-semibold text-text-primary">Tally CSV</p>
          <p className="text-xs text-text-tertiary">Compatible with Tally ERP 9 / Prime</p>
        </div>
        <div className="card px-4 py-3 flex items-center">
          <button
            onClick={handleDownload}
            disabled={downloading || isLoading}
            className="btn-primary w-full inline-flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <DownloadIcon className="w-4 h-4" />
                Download Tally Export
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preview table */}
      {isLoading && <ReportSkeleton />}

      {data && data.preview.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border-light">
            <h3 className="text-sm font-semibold text-text-primary">
              Preview — first {data.preview.length} of {data.rowCount} vouchers
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vch Type</th>
                  <th>Vch No.</th>
                  <th>Debit Ledger</th>
                  <th>Credit Ledger</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.map((row, i) => (
                  <tr key={i}>
                    <td className="text-text-secondary text-[13px] tabular-nums">{row.date}</td>
                    <td className="text-text-secondary text-[13px]">{row.vchType}</td>
                    <td className="font-mono text-[13px] text-text-secondary">{row.vchNo || "—"}</td>
                    <td className="text-text-primary">{row.debitLedger}</td>
                    <td className="text-text-primary">{row.creditLedger}</td>
                    <td className="text-right tabular-nums font-medium">{fmtStr(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rowCount > 10 && (
            <div className="px-4 py-3 border-t border-border-light">
              <p className="text-xs text-text-tertiary">
                Showing 10 of {data.rowCount} vouchers. Download the full export to see all entries.
              </p>
            </div>
          )}
        </div>
      )}

      {data && data.rowCount === 0 && (
        <EmptyState
          title="No vouchers found"
          description="No invoices, payments or expenses found for the selected period."
        />
      )}
    </div>
  );
}

// ── GSTR-9 View ────────────────────────────────────────────────

const currentFYStart = (() => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
})();

function GSTR9View() {
  const [financialYear, setFinancialYear] = useState(currentFYStart - 1); // Default to last completed FY
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error } = trpc.gst.gstr9.useQuery({ financialYear });
  const utils = trpc.useUtils();

  // FY selector options — last 5 completed financial years
  const fyOptions = Array.from({ length: 5 }, (_, i) => {
    const startYear = currentFYStart - 1 - i;
    return {
      value: startYear,
      label: `FY ${startYear}-${String(startYear + 1).slice(2)}`,
    };
  });

  async function handleDownloadJson() {
    setDownloading(true);
    try {
      const result = await utils.gst.gstr9Json.fetch({ financialYear });
      if (!result) return;
      const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("GSTR-9 portal JSON downloaded");
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* FY selector + info */}
      <div className="card px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <p className="text-xs text-text-tertiary mb-1 font-medium uppercase tracking-wide">Financial Year</p>
          <select
            className="input w-44"
            value={financialYear}
            onChange={(e) => setFinancialYear(Number(e.target.value))}
          >
            {fyOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:ml-auto">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-4 py-2">
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Annual return — April to March. Aggregates 12 months of GSTR-1 and GSTR-3B data.
            </p>
          </div>
        </div>
      </div>

      {isLoading && <ReportSkeleton />}

      {error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-400">Failed to load GSTR-9: {error.message}</p>
        </div>
      )}

      {data && (
        <>
          {/* Business + period header */}
          <div className="card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div>
              <p className="text-sm font-semibold text-text-primary">{data.businessName}</p>
              <p className="text-xs text-text-secondary font-mono">{data.businessGstin || "GSTIN not set"}</p>
            </div>
            <div className="sm:ml-auto text-right">
              <p className="text-sm font-semibold text-text-primary">FY {data.financialYear}</p>
              <p className="text-xs text-text-tertiary">{data.periodStart} — {data.periodEnd}</p>
            </div>
          </div>

          {/* ── Part II: Outward Supplies ── */}
          <div>
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">
              Part II — Outward Supplies
            </h2>

            {/* Table 4 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 4 — Taxable outward supplies</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">Taxable Value</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9TableRow label="4A" desc="Taxable outward supplies to registered (B2B)" row={data.table4.taxableSuppliesB2B} />
                    <GSTR9TableRow label="4B" desc="Taxable outward supplies to unregistered (B2C)" row={data.table4.taxableSuppliesB2C} />
                    <GSTR9TableRow label="4C" desc="Zero-rated supplies (with payment of tax)" row={data.table4.zeroRatedWithTax} />
                    <GSTR9TableRow label="4D" desc="Exempted supplies" row={data.table4.exempted} />
                    <GSTR9TableRow label="4I" desc="Credit notes issued" row={data.table4.creditNotes} muted />
                    <GSTR9TableRow label="4J" desc="Debit notes issued" row={data.table4.debitNotes} />
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t-2 border-border-color font-semibold">
                      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">—</td>
                      <td className="px-4 py-2 text-sm font-bold text-text-primary">Net Outward Supplies (Part II)</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.taxableValue)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.cgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.sgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.igst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{fmtN(data.partIITotals.cess)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Table 5 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 5 — Outward supplies on which tax is NOT payable</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">Taxable Value</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9TableRow label="5A" desc="Zero-rated (without payment of tax)" row={data.table5.zeroRatedWithoutTax} muted />
                    <GSTR9TableRow label="5B" desc="Nil-rated supplies" row={data.table5.nilRated} muted />
                    <GSTR9TableRow label="5D" desc="Non-GST outward supplies" row={data.table5.nonGst} muted />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Part III: ITC ── */}
          <div>
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">
              Part III — Input Tax Credit (ITC)
            </h2>

            {/* Table 6 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 6 — ITC availed during the year</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9ITCRow label="6A" desc="Total ITC as per auto-populated GSTR-3B" row={data.table6.totalItcGstr3B} />
                    <GSTR9ITCRow label="6B" desc="ITC on imports of goods" row={data.table6.itcImports} muted />
                    <GSTR9ITCRow label="6C" desc="ITC on inward supplies from ISD" row={data.table6.itcIsd} muted />
                    <GSTR9ITCRow label="6D" desc="ITC on all other inward supplies (purchases)" row={data.table6.itcOtherInward} />
                    <GSTR9ITCRow label="6E" desc="ITC on inward supplies under reverse charge" row={data.table6.itcReverseCharge} />
                    <GSTR9ITCRow label="6H" desc="ITC reversed (Rules 42/43, Section 17(5))" row={data.table6.itcReversed} muted />
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t-2 border-border-color font-semibold">
                      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">6J</td>
                      <td className="px-4 py-2 text-sm font-bold text-text-primary">Net ITC available (6A minus 6H)</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.igst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.cgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.sgst)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">{fmtN(data.table6.netItc.cess)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Table 7 */}
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 7 — ITC reversed and ineligible</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8">Sl.</th>
                      <th>Description</th>
                      <th className="text-right">IGST</th>
                      <th className="text-right">CGST</th>
                      <th className="text-right">SGST</th>
                      <th className="text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody>
                    <GSTR9ITCRow label="7A" desc="As per Rule 42" row={data.table7.rule42} muted />
                    <GSTR9ITCRow label="7B" desc="As per Rule 43" row={data.table7.rule43} muted />
                    <GSTR9ITCRow label="7H" desc="Other reversals" row={data.table7.other} muted />
                    <GSTR9ITCRow label="—" desc="Total ITC reversed" row={data.table7.total} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Part IV: Tax Paid ── */}
          <div>
            <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">
              Part IV — Tax Paid (Table 9)
            </h2>
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-border-light bg-surface-1">
                <h3 className="text-sm font-semibold text-text-primary">Table 9 — Tax paid as declared in returns during the financial year</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tax Type</th>
                      <th className="text-right">Paid through ITC</th>
                      <th className="text-right">Paid through Cash</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-text-primary font-medium">IGST</td>
                      <td className="text-right tabular-nums text-emerald-600">{fmtN(data.table9.igstThroughITC)}</td>
                      <td className="text-right tabular-nums text-amber-600">{fmtN(data.table9.igstThroughCash)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtN(data.table9.igstThroughITC + data.table9.igstThroughCash)}</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">CGST</td>
                      <td className="text-right tabular-nums text-emerald-600">{fmtN(data.table9.cgstThroughITC)}</td>
                      <td className="text-right tabular-nums text-amber-600">{fmtN(data.table9.cgstThroughCash)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtN(data.table9.cgstThroughITC + data.table9.cgstThroughCash)}</td>
                    </tr>
                    <tr>
                      <td className="text-text-primary font-medium">SGST</td>
                      <td className="text-right tabular-nums text-emerald-600">{fmtN(data.table9.sgstThroughITC)}</td>
                      <td className="text-right tabular-nums text-amber-600">{fmtN(data.table9.sgstThroughCash)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtN(data.table9.sgstThroughITC + data.table9.sgstThroughCash)}</td>
                    </tr>
                    <tr>
                      <td className="text-text-secondary">Cess</td>
                      <td className="text-right tabular-nums text-text-tertiary">{fmtN(data.table9.cessThroughITC)}</td>
                      <td className="text-right tabular-nums text-text-tertiary">{fmtN(data.table9.cessThroughCash)}</td>
                      <td className="text-right tabular-nums text-text-tertiary">{fmtN(data.table9.cessThroughITC + data.table9.cessThroughCash)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-1 border-t-2 border-border-color">
                      <td className="px-4 py-2 font-bold text-text-primary">Total Tax</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-emerald-600">
                        {fmtN(data.table9.igstThroughITC + data.table9.cgstThroughITC + data.table9.sgstThroughITC)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-amber-600">
                        {fmtN(data.table9.igstThroughCash + data.table9.cgstThroughCash + data.table9.sgstThroughCash)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-text-primary">
                        {fmtN(
                          data.table9.igstThroughITC + data.table9.igstThroughCash +
                          data.table9.cgstThroughITC + data.table9.cgstThroughCash +
                          data.table9.sgstThroughITC + data.table9.sgstThroughCash
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* Download JSON */}
          <div className="flex justify-end">
            <button
              onClick={handleDownloadJson}
              disabled={downloading}
              className="btn-primary inline-flex items-center gap-2"
            >
              {downloading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  <DownloadIcon className="w-4 h-4" />
                  Download Portal JSON (GSTN)
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── GSTR-9 row sub-components ──────────────────────────────────

interface TaxRowData {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

function GSTR9TableRow({
  label,
  desc,
  row,
  muted = false,
}: {
  label: string;
  desc: string;
  row: TaxRowData;
  muted?: boolean;
}) {
  const cls = muted ? "text-text-secondary" : "text-text-primary";
  return (
    <tr>
      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">{label}</td>
      <td className={`px-4 py-2 text-sm ${cls}`}>{desc}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : ""}`}>{fmtN(row.taxableValue)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-text-secondary"}`}>{fmtN(row.cgst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-text-secondary"}`}>{fmtN(row.sgst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-text-secondary"}`}>{fmtN(row.igst)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-text-tertiary">{fmtN(row.cess)}</td>
    </tr>
  );
}

function GSTR9ITCRow({
  label,
  desc,
  row,
  muted = false,
}: {
  label: string;
  desc: string;
  row: TaxRowData;
  muted?: boolean;
}) {
  const cls = muted ? "text-text-secondary" : "text-text-primary";
  return (
    <tr>
      <td className="px-4 py-2 text-xs text-text-tertiary font-medium">{label}</td>
      <td className={`px-4 py-2 text-sm ${cls}`}>{desc}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-emerald-600"}`}>{fmtN(row.igst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtN(row.cgst)}</td>
      <td className={`px-4 py-2 text-right tabular-nums ${muted ? "text-text-tertiary" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtN(row.sgst)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-text-tertiary">{fmtN(row.cess)}</td>
    </tr>
  );
}

// ── Shared helpers ─────────────────────────────────────────────

function fmt(n: number): string {
  return formatCurrency(n);
}

// Alias used by GSTR-9 components (number input, same as fmt)
const fmtN = fmt;

function fmtStr(s: string): string {
  return formatCurrency(parseFloat(s) || 0);
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
    </svg>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card px-4 py-3">
            <div className="skeleton h-3 w-20 mb-2" />
            <div className="skeleton h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-light">
          <div className="skeleton h-4 w-32" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 border-b border-border-light last:border-0">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 flex-1" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
