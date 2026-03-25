import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";
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

type ReportTab = "gstr1" | "gstr3b" | "pnl" | "aging" | "ledger" | "tally";

function GSTReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTab] = useState<ReportTab>("gstr1");

  const { data: businesses } = trpc.business.list.useQuery();
  const biz = businesses?.[0];

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const isGstRegistered = biz?.gstRegistrationType !== "unregistered" || !!biz?.gstin;

  // Report labels adapt based on GST status
  const reportTitle = isGstRegistered ? "GST Reports" : "Financial Reports";
  const reportDesc = isGstRegistered
    ? "Generate GSTR-1, GSTR-3B, P&L, aging report, party ledger and Tally export"
    : "Sales summary, tax reports, P&L, aging report, party ledger and Tally export";
  const tab1Label = isGstRegistered ? "GSTR-1" : "Sales Report";
  const tab2Label = isGstRegistered ? "GSTR-3B" : "Tax Summary";

  const tabs: Array<{ value: ReportTab; label: string }> = [
    { value: "gstr1", label: tab1Label },
    { value: "gstr3b", label: tab2Label },
    { value: "pnl", label: "Profit & Loss" },
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
      {activeTab === "pnl" && <ProfitAndLossView />}
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
    <div className="card px-5 py-4 border-red-200 bg-red-50">
      <p className="text-sm text-red-700">Failed to load report: {error.message}</p>
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
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Invoice Count</p>
          <p className="text-lg font-bold tabular-nums text-text-primary">{data.invoiceCount}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Taxable Value</p>
          <p className="text-lg font-bold tabular-nums text-text-primary">{fmt(data.totalTaxableValue)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Total Tax</p>
          <p className="text-lg font-bold tabular-nums text-amber-600">{fmt(data.totalTax)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">Total Value</p>
          <p className="text-lg font-bold tabular-nums text-emerald-600">{fmt(data.totalInvoiceValue)}</p>
        </div>
      </div>

      {/* Tax split cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">CGST</p>
          <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.totalCgst)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">SGST</p>
          <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.totalSgst)}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-text-tertiary mb-1">IGST</p>
          <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.totalIgst)}</p>
        </div>
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
    <div className="card px-5 py-4 border-red-200 bg-red-50">
      <p className="text-sm text-red-700">Failed to load report: {error.message}</p>
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
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">ITC — IGST</p>
            <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.itc.igst)}</p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">ITC — CGST</p>
            <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.itc.cgst)}</p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">ITC — SGST</p>
            <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.itc.sgst)}</p>
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Total ITC available</p>
            <p className="text-base font-semibold tabular-nums text-emerald-600">{fmt(data.itc.total)}</p>
          </div>
        </div>
      </div>

      {/* 5. Tax payable */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">5 — Values of exempt, nil-rated and non-GST inward supplies</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 p-4">
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Output IGST</p>
            <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.taxPayable.igst)}</p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Output CGST</p>
            <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.taxPayable.cgst)}</p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Output SGST</p>
            <p className="text-base font-semibold tabular-nums text-text-primary">{fmt(data.taxPayable.sgst)}</p>
          </div>
        </div>
      </div>

      {/* Net tax liability */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Net tax liability (after ITC)</h3>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Net IGST</p>
            <p className="text-base font-semibold tabular-nums text-amber-600">{fmt(data.netTax.igst)}</p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Net CGST</p>
            <p className="text-base font-semibold tabular-nums text-amber-600">{fmt(data.netTax.cgst)}</p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-xs text-text-tertiary mb-1">Net SGST</p>
            <p className="text-base font-semibold tabular-nums text-amber-600">{fmt(data.netTax.sgst)}</p>
          </div>
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
  const { preset, setPreset, fromDate, toDate, customFrom, customTo, setCustomRange } =
    useDateRange("pnl-report", "this-fy");

  const { data, isLoading, error } = trpc.dashboard.profitAndLoss.useQuery({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });

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

      {isLoading && <ReportSkeleton />}

      {error && (
        <div className="card px-5 py-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">Failed to load report: {error.message}</p>
        </div>
      )}

      {data && (
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

  const { data: partiesData } = trpc.party.list.useQuery({ limit: 200, page: 1 });
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
      const res = await fetch(`/api/parties/${partyId}/ledger.pdf?${params}`, {
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

// ── Shared helpers ─────────────────────────────────────────────

function fmt(n: number): string {
  return formatCurrency(n);
}

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
