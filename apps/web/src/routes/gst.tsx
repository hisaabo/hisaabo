import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/Tabs";
import { toast } from "@/hooks/useToast";

export const Route = createFileRoute("/gst")({
  component: GSTReportsPage,
});

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function GSTReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeTab, setActiveTab] = useState<"gstr1" | "gstr3b">("gstr1");

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div>
      <PageHeader
        title="GST Reports"
        description="Generate GSTR-1 and GSTR-3B reports"
      />

      {/* Period selector + tab toggle */}
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
              { value: "gstr1", label: "GSTR-1" },
              { value: "gstr3b", label: "GSTR-3B" },
            ]}
            value={activeTab}
            onChange={(v) => setActiveTab(v as "gstr1" | "gstr3b")}
          />
        </div>
      </div>

      {activeTab === "gstr1" ? (
        <GSTR1View year={year} month={month} />
      ) : (
        <GSTR3BView year={year} month={month} />
      )}
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
  if (!data) return null;

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
  if (!data) return null;

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

// ── Shared helpers ─────────────────────────────────────────────

function fmt(n: number): string {
  return formatCurrency(n);
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
