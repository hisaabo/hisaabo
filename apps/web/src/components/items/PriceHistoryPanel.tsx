import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { SegmentedControl } from "@/components/ui/Tabs";
import {
  PeriodToggle, UnitSelect, formatUnitPrice, CHART_TOOLTIP_STYLE,
  type HistoryPeriod, type UnitVariantLike,
} from "./history-shared";
import { useCursorPaging } from "./useCursorPaging";

const PAGE_SIZE = 30;
// Reference-line colours (hex: recharts strokes can't use Tailwind classes).
const MIN_COLOR = "#10b981";
const MAX_COLOR = "#f59e0b";
const AVG_COLOR = "#868e96";

type InvoiceType = "sale" | "purchase";

interface Props {
  itemId: string;
  baseUnit: string;
  unitVariants: UnitVariantLike[] | null | undefined;
}

/** Stat chip under the chart header: label, value, and the matching line colour. */
function Stat({ label, value, color }: { label: string; value: string | null; color?: string }) {
  return (
    <div className="rounded-lg bg-surface-1 px-2.5 py-1.5 min-w-0">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-tertiary">
        {color && <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />}
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums text-text-primary truncate">
        {value === null ? "—" : formatUnitPrice(value)}
      </p>
    </div>
  );
}

export function PriceHistoryPanel({ itemId, baseUnit, unitVariants }: Props) {
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("sale");
  const [unit, setUnit] = useState(baseUnit);

  // Chart + min/max/avg are computed server-side over the WHOLE period (the
  // series is downsampled there), so "All" never depends on how many rows the
  // table has loaded.
  const { data: summary, isLoading: summaryLoading } = trpc.item.priceSummary.useQuery({
    id: itemId, period, invoiceType, unit,
  });

  const filterKey = `${period}|${invoiceType}|${unit}`;
  const paging = useCursorPaging(filterKey, PAGE_SIZE);
  const { data: pageData, isFetching } = trpc.item.priceHistoryPage.useQuery({
    id: itemId, period, invoiceType, unit, cursor: paging.cursor, limit: PAGE_SIZE,
  });
  paging.setNextCursor(pageData?.nextCursor);

  const list = useInfiniteList({
    key: `item-prices-${itemId}`,
    data: pageData?.rows,
    total: pageData?.total ?? 0,
    page: paging.page,
    isFetching,
    onLoadMore: paging.loadMore,
    resetDeps: [period, invoiceType, unit],
  });

  const chartData = useMemo(
    () => (summary?.series ?? []).map((p) => ({
      date: formatDate(p.date),
      price: Number(p.price),
      min: Number(p.min),
      max: Number(p.max),
      count: p.count,
    })),
    [summary?.series],
  );

  const stats = summary?.stats;
  const hasData = (stats?.count ?? 0) > 0;
  const typeLabel = invoiceType === "sale" ? "sale" : "purchase";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-text-secondary">Price Over Time</p>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          tabs={[{ value: "sale", label: "Sales" }, { value: "purchase", label: "Purchases" }]}
          value={invoiceType}
          onChange={(v) => setInvoiceType(v as InvoiceType)}
        />
        <UnitSelect baseUnit={baseUnit} variants={unitVariants} value={unit} onChange={setUnit} />
      </div>

      {summaryLoading ? (
        <SkeletonRows count={3} />
      ) : !hasData ? (
        <EmptyState
          title="No price history"
          description={`No ${typeLabel} prices in this period. Prices appear here as this item is used in invoices.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="price-stats">
            <Stat label="Min" value={stats!.min} color={MIN_COLOR} />
            <Stat label="Avg" value={stats!.avg} color={AVG_COLOR} />
            <Stat label="Max" value={stats!.max} color={MAX_COLOR} />
            <Stat label="Latest" value={stats!.latest} />
          </div>

          {chartData.length > 1 ? (
            <div className="rounded-xl border border-border-light bg-surface-0 p-3 sm:p-4">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                    tickFormatter={(v) => `₹${v}`}
                    width={55}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    {...CHART_TOOLTIP_STYLE}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, _n: any, item: any) => {
                      const p = item?.payload;
                      const range = p && p.count > 1 ? ` (${p.count} sales, ${formatUnitPrice(p.min)}–${formatUnitPrice(p.max)})` : "";
                      return [`${formatUnitPrice(Number(value ?? 0))}${range}`, `Price / ${summary?.unit ?? unit}`];
                    }}
                  />
                  {/* Compact tags only; exact values live in the stat row above (keeps narrow viewports clean). */}
                  <ReferenceLine
                    y={Number(stats!.max)} stroke={MAX_COLOR} strokeDasharray="4 3" ifOverflow="extendDomain"
                    label={{ value: "Max", position: "insideTopRight", fontSize: 10, fill: MAX_COLOR }}
                  />
                  <ReferenceLine
                    y={Number(stats!.avg)} stroke={AVG_COLOR} strokeDasharray="2 3" ifOverflow="extendDomain"
                    label={{ value: "Avg", position: "insideTopRight", fontSize: 10, fill: AVG_COLOR }}
                  />
                  <ReferenceLine
                    y={Number(stats!.min)} stroke={MIN_COLOR} strokeDasharray="4 3" ifOverflow="extendDomain"
                    label={{ value: "Min", position: "insideBottomRight", fontSize: 10, fill: MIN_COLOR }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#5b5bd6"
                    strokeWidth={2}
                    dot={chartData.length > 40 ? false : { r: 3, fill: "#5b5bd6", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[10px] text-text-tertiary">
                {stats!.count} {typeLabel} line{stats!.count === 1 ? "" : "s"} in period
                {summary?.downsampled ? " · chart shows averaged groups; Min/Avg/Max use every line" : ""}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border-light bg-surface-1 px-4 py-3 text-xs text-text-tertiary">
              Not enough data points to draw a chart.
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-text-secondary mb-2">Price Changes</p>
            <div className="rounded-xl border border-border-light overflow-hidden">
              <div ref={list.scrollRef} onScroll={list.onScroll} className="max-h-[300px] overflow-y-auto">
                <table className="data-table w-full">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th style={{ width: "50%" }}>Invoice #</th>
                      <th style={{ width: "50%" }} className="text-right">Unit Price ({summary?.unit ?? unit})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((h) => (
                      <tr key={h.id}>
                        <td className="font-mono text-[13px]">
                          <Link to="/invoices" search={{ id: h.invoiceId }} className="text-brand-600 hover:text-brand-700 hover:underline">
                            {h.invoiceNumber}
                          </Link>
                          <span className="block text-[10px] font-sans text-text-tertiary">{formatDate(h.invoiceDate)}</span>
                        </td>
                        <td className="text-right tabular-nums font-medium">
                          {formatUnitPrice(h.price)}
                          {h.selectedUnit && h.selectedUnit !== (summary?.unit ?? unit) && (
                            <span className="block text-[10px] font-normal text-text-tertiary">
                              billed {formatUnitPrice(h.unitPrice)}/{h.selectedUnit}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
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
          </div>
        </>
      )}
    </div>
  );
}
