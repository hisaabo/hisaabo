import { trpc } from "@/lib/trpc";

/**
 * One row from the `pos.catalog` tRPC endpoint. Already fanned out to a
 * single billable tile (simple item, alt_units entry, or variant row).
 */
export interface POSTile {
  tileKey: string;
  itemId: string;
  variantId: string | null;
  displayName: string;
  unit: string;
  unitPrice: string;
  stockQuantity: string;
  taxPercent: string;
  conversionFactor: string;
  itemMode: "simple" | "alt_units" | "variants";
  sku: string | null;
}

interface Props {
  search: string;
  onPick: (tile: POSTile) => void;
}

/**
 * Left-pane tile grid for POS. One tile per billable SKU — an item with
 * alt_units or variants appears as multiple tiles so cashiers tap the
 * exact unit/variant they're ringing up.
 */
export function ItemGrid({ search, onPick }: Props) {
  const { data, isPending, isError } = trpc.pos.catalog.useQuery(
    {
      search: search || null,
      page: 1,
      limit: 120, // variants/alt_units fan out — keep a higher ceiling
    },
    {
      // Keep previous results on screen while a new search request runs so
      // the grid doesn't flash to empty between keystrokes.
      placeholderData: (prev) => prev,
    },
  );

  if (isError) {
    return <div className="p-6 text-sm text-red-500">Couldn't load items.</div>;
  }

  const tiles = data?.tiles ?? [];

  if (!isPending && tiles.length === 0) {
    return (
      <div className="p-6 text-sm text-text-tertiary">
        {search ? `No items match "${search}".` : "No items yet."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 p-2 content-start overflow-y-auto">
      {tiles.map((tile) => (
        <button
          key={tile.tileKey}
          type="button"
          onClick={() => onPick(tile)}
          className="text-left p-3 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[96px]"
        >
          <div className="text-sm font-semibold text-text-primary leading-tight">
            {tile.displayName}
          </div>
          <div className="text-xs text-text-tertiary mt-1 tabular-nums">
            ₹{tile.unitPrice} / {tile.unit}
          </div>
          <div
            className={`text-[11px] mt-1 tabular-nums ${
              parseFloat(tile.stockQuantity) <= 0
                ? "text-red-500"
                : "text-text-tertiary"
            }`}
          >
            {formatStock(tile.stockQuantity)} {tile.unit} in stock
          </div>
        </button>
      ))}
    </div>
  );
}

function formatStock(raw: string): string {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return "0";
  // Drop trailing zeros on decimals so "5000.000" shows as "5000" but
  // "5.250" stays "5.25". Avoids a wall of zeros on whole-number stocks.
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "");
}
