import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { trpc } from "@/lib/trpc";
import { formatDate, formatQuantity, cn } from "@/lib/utils";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { PeriodToggle, UnitSelect, CHART_TOOLTIP_STYLE, type HistoryPeriod, type UnitVariantLike } from "./history-shared";
import { useCursorPaging } from "./useCursorPaging";

const PAGE_SIZE = 30;

const DOC_TYPE_ROUTE: Record<string, string> = {
  invoice: "/invoices",
  credit_note: "/credit-notes",
  sales_return: "/sales-returns",
  delivery_challan: "/delivery-challans",
  quotation: "/quotations",
  proforma: "/proforma-invoices",
  purchase_return: "/invoices",
  debit_note: "/invoices",
};

interface Props {
  itemId: string;
  baseUnit: string;
  unitVariants: UnitVariantLike[] | null | undefined;
}

export function StockMovementsPanel({ itemId, baseUnit, unitVariants }: Props) {
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [unit, setUnit] = useState(baseUnit);

  // Totals + balance series cover the WHOLE period (series downsampled server
  // side). Quantities/balances are converted to `unit` via conversion factors.
  const { data: summary, isLoading: summaryLoading } = trpc.item.stockSummary.useQuery({
    id: itemId, period, unit,
  });

  const filterKey = `${period}|${unit}`;
  const paging = useCursorPaging(filterKey, PAGE_SIZE);
  const { data: pageData, isFetching } = trpc.item.stockMovementsPage.useQuery({
    id: itemId, period, unit, cursor: paging.cursor, limit: PAGE_SIZE,
  });
  paging.setNextCursor(pageData?.nextCursor);

  const list = useInfiniteList({
    key: `item-stock-${itemId}`,
    data: pageData?.rows,
    total: pageData?.total ?? 0,
    page: paging.page,
    isFetching,
    onLoadMore: paging.loadMore,
    resetDeps: [period, unit],
  });

  const chartData = useMemo(
    () => (summary?.series ?? []).map((p) => ({ date: formatDate(p.date), stock: Number(p.balance) })),
    [summary?.series],
  );

  const shownUnit = summary?.unit ?? unit;
  const stats = summary?.stats;
  const net = Number(stats?.net ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-text-secondary">Stock Over Time</p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>
      <div className="flex justify-end">
        <UnitSelect baseUnit={baseUnit} variants={unitVariants} value={unit} onChange={setUnit} />
      </div>

      {summaryLoading ? (
        <SkeletonRows count={3} />
      ) : !stats || stats.count === 0 ? (
        <EmptyState
          title="No stock movements"
          description="Stock changes will appear here as invoices are created."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 font-medium">
              In: +{formatQuantity(stats.totalIn)} {shownUnit}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-lg bg-red-600/10 text-red-700 dark:text-red-400 font-medium">
              Out: -{formatQuantity(stats.totalOut)} {shownUnit}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-lg bg-surface-2 text-text-secondary font-medium">
              Net: {net > 0 ? "+" : ""}{formatQuantity(stats.net)} {shownUnit}
            </span>
            <span className="text-xs text-text-tertiary ml-auto">{stats.count} movements</span>
          </div>

          {chartData.length > 1 ? (
            <div className="rounded-xl border border-border-light bg-surface-0 p-3 sm:p-4">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                    tickLine={false}
                    axisLine={false}
                    width={45}
                  />
                  <Tooltip
                    {...CHART_TOOLTIP_STYLE}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any) => [`${formatQuantity(Number(value ?? 0))} ${shownUnit}`, "Stock"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="stock"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={chartData.length > 40 ? false : { r: 3, fill: "#10b981", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-border-light bg-surface-1 px-4 py-3 text-xs text-text-tertiary">
              Not enough data points to draw a chart.
            </div>
          )}

          <div className="rounded-xl border border-border-light overflow-hidden">
            <div ref={list.scrollRef} onScroll={list.onScroll} className="max-h-[300px] overflow-y-auto">
              <table className="data-table w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th style={{ width: "30%" }}>Date</th>
                    <th style={{ width: "25%" }}>Invoice #</th>
                    <th style={{ width: "25%" }} className="text-right">Qty Change</th>
                    <th style={{ width: "20%" }} className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => {
                    const change = Number(r.qtyChange);
                    return (
                      <tr key={r.id}>
                        <td className="text-text-secondary text-xs">{formatDate(r.invoiceDate)}</td>
                        <td className="font-mono text-[13px]">
                          <Link to={DOC_TYPE_ROUTE[r.documentType] ?? "/invoices"} search={{ id: r.invoiceId }} className="text-brand-600 hover:text-brand-700 hover:underline">
                            {r.invoiceNumber}
                          </Link>
                        </td>
                        <td className={cn("text-right tabular-nums font-medium", change > 0 ? "text-emerald-600" : "text-red-600")}>
                          {change > 0 ? "+" : ""}{formatQuantity(r.qtyChange)}
                        </td>
                        <td className="text-right tabular-nums text-text-secondary">{formatQuantity(r.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {list.hasMore && (
                <button
                  type="button"
                  onClick={list.loadMore}
                  className="w-full py-2 text-xs font-medium text-brand-600 hover:bg-surface-1"
                >
                  {list.loadingMore ? "Loading..." : `Load more (${list.items.length} of ${list.total})`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
