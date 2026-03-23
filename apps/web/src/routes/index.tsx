import { createFileRoute, Link } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/hooks/useToast";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data, isLoading } = trpc.dashboard.summary.useQuery();
  const { data: shippingData } = trpc.dashboard.shippingSummary.useQuery();

  if (isLoading) return <PageSkeleton />;
  if (!data) {
    return (
      <EmptyState
        title="Welcome to Billbook"
        description="Set up your business to start creating invoices and tracking payments."
        action={
          <Link to="/settings" className="btn-primary">
            Set Up Business
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Financial year overview"
        actions={
          <Link to="/invoices" className="btn-primary">
            + New Invoice
          </Link>
        }
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Total Sales</p>
          <p className="text-xl font-bold tabular-nums text-emerald-600">
            {formatCurrency(data.totalSales)}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Total Purchases</p>
          <p className="text-xl font-bold tabular-nums text-blue-600">
            {formatCurrency(data.totalPurchases)}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">You'll Receive</p>
          <p className="text-xl font-bold tabular-nums text-amber-600">
            {formatCurrency(data.receivable)}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">You'll Pay</p>
          <p className="text-xl font-bold tabular-nums text-red-600">
            {formatCurrency(data.payable)}
          </p>
        </div>
      </div>

      {/* Cash position */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Net Cash Position</p>
          <p className="text-xl font-bold tabular-nums text-emerald-600">
            {formatCurrency(data.cashInHand)}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs font-medium text-text-tertiary mb-1">Total Expenses (FY)</p>
          <p className="text-xl font-bold tabular-nums text-text-primary">
            {formatCurrency(data.totalExpenses)}
          </p>
        </div>
      </div>

      {/* Shipping P&L */}
      {shippingData && (parseFloat(shippingData.charged) > 0 || parseFloat(shippingData.spent) > 0) && (
        <div className="card px-4 py-3 mb-6">
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Shipping P&amp;L</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-text-tertiary">Charged</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-600">{formatCurrency(shippingData.charged)}</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary">Expenses</p>
              <p className="text-sm font-semibold tabular-nums text-red-600">{formatCurrency(shippingData.spent)}</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary">Net</p>
              <p className={cn(
                "text-sm font-semibold tabular-nums",
                parseFloat(shippingData.net) >= 0 ? "text-emerald-600" : "text-red-600"
              )}>
                {formatCurrency(shippingData.net)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recent invoices */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-border-light flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Recent Invoices</h3>
          <Link to="/invoices" className="text-xs font-medium text-brand-600 hover:text-brand-700">
            View all
          </Link>
        </div>

        {data.recentInvoices.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-text-tertiary">
            No invoices yet. Create your first invoice to get started.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-medium">{inv.partyName}</td>
                  <td className="font-mono text-[13px] text-text-secondary">{inv.invoiceNumber}</td>
                  <td className="text-text-secondary">{formatDate(inv.invoiceDate)}</td>
                  <td>
                    <StatusBadge status={inv.status} size="sm" />
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    {formatCurrency(inv.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-7 w-40" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
      </div>
      <div className="skeleton h-48 rounded-xl" />
    </div>
  );
}
