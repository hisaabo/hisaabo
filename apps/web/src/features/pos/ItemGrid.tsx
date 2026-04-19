import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

export interface POSItemRow {
  id: string;
  name: string;
  salePrice: string | null;
  stockQuantity: string | null;
  unit: string;
  sku: string | null;
  taxPercent: string | null;
}

interface Props {
  search: string;
  onPick: (item: POSItemRow) => void;
}

/**
 * Left-pane item picker for POS. Responds to the shared search state (from
 * SearchBar) and lets the cashier tap / click an item to add it to the
 * active cart. Fetches via the existing `item.list` tRPC endpoint.
 */
export function ItemGrid({ search, onPick }: Props) {
  const { data, isPending, isError } = trpc.item.list.useQuery(
    {
      search: search || null,
      itemType: "product",
      page: 1,
      limit: 60,
    },
    {
      // Keep previous results visible while a new query loads so the grid
      // doesn't flicker to blank between keystrokes.
      placeholderData: (prev) => prev,
    },
  );

  const rows: POSItemRow[] = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map((it: any) => ({
      id: it.id,
      name: it.name,
      salePrice: it.salePrice ?? null,
      stockQuantity: it.stockQuantity ?? null,
      unit: it.unit,
      sku: it.sku ?? null,
      taxPercent: it.taxPercent ?? null,
    }));
  }, [data]);

  if (isError) {
    return <div className="p-6 text-sm text-red-500">Couldn't load items.</div>;
  }

  if (!isPending && rows.length === 0) {
    return (
      <div className="p-6 text-sm text-text-tertiary">
        {search ? `No items match "${search}".` : "No items yet."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 p-2 content-start overflow-y-auto">
      {rows.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onPick(it)}
          className="text-left p-3 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <div className="text-sm font-semibold text-text-primary truncate">
            {it.name}
          </div>
          <div className="text-xs text-text-tertiary mt-1 tabular-nums">
            ₹{it.salePrice ?? "—"} / {it.unit}
          </div>
          {it.stockQuantity !== null && (
            <div
              className={`text-[11px] mt-1 tabular-nums ${
                parseFloat(it.stockQuantity) <= 0
                  ? "text-red-500"
                  : "text-text-tertiary"
              }`}
            >
              {parseFloat(it.stockQuantity).toFixed(0)} in stock
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
