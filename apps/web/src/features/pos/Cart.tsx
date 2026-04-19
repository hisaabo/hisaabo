import { POSStore, usePOSSelector, computeCartTotals } from "./state";

interface Props {
  store: POSStore;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/**
 * Right-pane cart view: the running line items for the currently-active
 * parked cart, with qty spinners, per-line remove, and running totals.
 *
 * Keep this component dense — it's glanced at constantly between scans.
 */
export function Cart({ store }: Props) {
  const activeCart = usePOSSelector(store, (s) => s.carts.find((c) => c.id === s.activeCartId));
  if (!activeCart) return null;

  const totals = computeCartTotals(activeCart.lineItems);

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-border">
      <div className="flex-1 overflow-y-auto">
        {activeCart.lineItems.length === 0 ? (
          <div className="p-6 text-sm text-text-tertiary text-center">
            Scan or click an item to start.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeCart.lineItems.map((li) => {
              const qty = parseFloat(li.quantity) || 0;
              const price = parseFloat(li.unitPrice) || 0;
              const lineTotal = qty * price * (1 - (parseFloat(li.discountPercent) || 0) / 100);
              return (
                <li key={li.lineId} className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {li.itemName}
                    </div>
                    <div className="text-xs text-text-tertiary mt-0.5 tabular-nums">
                      ₹{li.unitPrice} × {li.quantity} {li.unit ?? ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="w-7 h-7 rounded bg-surface-2 hover:bg-surface-3 text-base leading-none"
                      onClick={() =>
                        store.updateLine(li.lineId, {
                          quantity: Math.max(1, qty - 1).toString(),
                        })
                      }
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="min-w-[2ch] text-center text-sm tabular-nums">
                      {qty}
                    </span>
                    <button
                      type="button"
                      className="w-7 h-7 rounded bg-surface-2 hover:bg-surface-3 text-base leading-none"
                      onClick={() =>
                        store.updateLine(li.lineId, {
                          quantity: (qty + 1).toString(),
                        })
                      }
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <div className="text-sm font-semibold tabular-nums">
                      ₹{fmt(lineTotal)}
                    </div>
                    <button
                      type="button"
                      className="text-[11px] text-red-500 hover:underline mt-1"
                      onClick={() => store.removeLine(li.lineId)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4 space-y-1.5 bg-surface-0 text-sm">
        <div className="flex items-center justify-between text-text-secondary">
          <span>Subtotal</span>
          <span className="tabular-nums">₹{fmt(totals.subtotal)}</span>
        </div>
        {totals.discount > 0 && (
          <div className="flex items-center justify-between text-text-secondary">
            <span>Discount</span>
            <span className="tabular-nums">−₹{fmt(totals.discount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-text-secondary">
          <span>Tax</span>
          <span className="tabular-nums">₹{fmt(totals.tax)}</span>
        </div>
        <div className="flex items-center justify-between text-base font-semibold text-text-primary pt-1.5 border-t border-border">
          <span>Total</span>
          <span className="tabular-nums">₹{fmt(totals.total)}</span>
        </div>
      </div>
    </div>
  );
}
