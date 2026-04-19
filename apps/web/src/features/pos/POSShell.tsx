import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { POSStore, usePOSSelector } from "./state";
import { useScanner } from "./useScanner";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ItemGrid, type POSItemRow } from "./ItemGrid";
import { Cart } from "./Cart";
import { CustomerPicker } from "./CustomerPicker";
import { PaymentSheet } from "./PaymentSheet";
import { ReceiptPrinter } from "./ReceiptPrinter";

interface Props {
  businessId: string;
  walkInPartyId: string;
}

/**
 * POS fullscreen shell — layout + keyboard + scanner + cross-tab stock
 * broadcast. Owns a single `POSStore` instance for this tab's lifetime.
 */
export function POSShell({ businessId, walkInPartyId }: Props) {
  const navigate = useNavigate();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);

  // Store is tied to businessId — recreate if the active business changes.
  const store = useMemo(
    () => new POSStore(businessId, walkInPartyId),
    [businessId, walkInPartyId],
  );

  const carts = usePOSSelector(store, (s) => s.carts);
  const activeCartId = usePOSSelector(store, (s) => s.activeCartId);
  const activeCart = carts.find((c) => c.id === activeCartId);

  const utils = trpc.useUtils();

  // ── Cross-tab coordination ─────────────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pos:${businessId}`);
    channel.onmessage = (ev) => {
      if (!ev.data) return;
      // Another tab finalised a sale — invalidate stock/listings.
      if (ev.data.type === "invoice:finalized") {
        utils.item.list.invalidate();
      }
    };
    return () => channel.close();
  }, [businessId, utils]);

  const broadcast = (payload: unknown) => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pos:${businessId}`);
    try {
      channel.postMessage(payload);
    } finally {
      channel.close();
    }
  };

  // ── Scanner ────────────────────────────────────────────────────
  const handleScan = async (code: string) => {
    // Resolve barcode → item via item.list search on the scanned code. No
    // dedicated barcode column in v1 — we match against name/SKU.
    try {
      const data = await utils.item.list.fetch({
        search: code,
        page: 1,
        limit: 1,
      });
      const first = data?.data?.[0];
      if (!first) {
        toast.error("No item found", `Scan: ${code}`);
        return;
      }
      store.addOrBumpLine(
        { itemId: first.id, variantId: null },
        {
          itemId: first.id,
          itemName: first.name,
          quantity: "1",
          unit: first.unit,
          unitPrice: first.salePrice ?? "0",
          taxPercent: first.taxPercent ?? "0",
          discountPercent: "0",
        },
      );
    } catch (err) {
      toast.error("Scanner lookup failed", err instanceof Error ? err.message : String(err));
    }
  };
  useScanner(shellRef, handleScan);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  const shortcuts = useMemo(
    () => [
      { combo: "F2", handler: () => searchRef.current?.focus() },
      { combo: "F3", handler: () => setPickerOpen(true) },
      { combo: "F9", handler: () => setPaymentOpen(true) },
      { combo: "F6", handler: () => store.parkActive(walkInPartyId, "Walk-in Customer") },
      { combo: "Escape", handler: () => {
        setPickerOpen(false);
        setPaymentOpen(false);
      }},
      ...[1, 2, 3, 4, 5].map((n) => ({
        combo: `Alt+${n}`,
        handler: () => {
          const target = carts[n - 1];
          if (target) store.resumeCart(target.id);
        },
      })),
    ],
    [carts, store, walkInPartyId],
  );
  useKeyboardShortcuts(shellRef, shortcuts);

  // ── Item pick handler ──────────────────────────────────────────
  const handlePickItem = (item: POSItemRow) => {
    store.addOrBumpLine(
      { itemId: item.id, variantId: null },
      {
        itemId: item.id,
        itemName: item.name,
        quantity: "1",
        unit: item.unit,
        unitPrice: item.salePrice ?? "0",
        taxPercent: item.taxPercent ?? "0",
        discountPercent: "0",
      },
    );
  };

  const handleCustomerPick = (p: { id: string; name: string }) => {
    store.setCustomer(p.id, p.name);
    setPickerOpen(false);
  };

  const handleFinalized = (invoiceId: string) => {
    setPaymentOpen(false);
    // Print receipt (fire-and-forget)
    setPrintInvoiceId(invoiceId);
    // Drop the finalised cart and start a fresh one
    if (activeCart) {
      store.removeCart(activeCart.id, walkInPartyId, "Walk-in Customer");
    }
    // Tell other tabs to invalidate stock
    broadcast({ type: "invoice:finalized", invoiceId });
    toast.success("Sale complete", `Invoice ${invoiceId.slice(0, 8)}`);
  };

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className="fixed inset-0 flex flex-col bg-surface-0 text-text-primary outline-none"
    >
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-1">
        <button
          type="button"
          onClick={() => navigate({ to: "/invoices" })}
          className="text-xs text-text-tertiary hover:text-text-primary"
          aria-label="Exit POS"
        >
          ← Exit
        </button>
        <div className="text-sm font-semibold">POS Register</div>
        <div className="flex-1">
          <input
            ref={searchRef}
            type="search"
            className="w-full max-w-md px-3 py-1.5 rounded border border-border bg-surface-2 text-sm"
            placeholder="Search item — F2, or scan barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="px-3 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-3 text-sm"
          onClick={() => setPickerOpen(true)}
        >
          {activeCart?.partyName ?? "Walk-in"}{" "}
          <span className="text-text-tertiary text-xs ml-1">F3</span>
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-3 text-sm"
          onClick={() => store.parkActive(walkInPartyId, "Walk-in Customer")}
          title="Hold current sale and start a new one (F6)"
        >
          Hold <span className="text-text-tertiary text-xs ml-1">F6</span>
        </button>
      </header>

      {/* Parked tabs strip */}
      {carts.length > 1 && (
        <div className="flex gap-1 px-4 py-2 border-b border-border bg-surface-1 overflow-x-auto">
          {carts.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => store.resumeCart(c.id)}
              className={`px-3 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                c.id === activeCartId
                  ? "bg-brand-600 text-white"
                  : "bg-surface-2 hover:bg-surface-3 text-text-secondary"
              }`}
            >
              <span className="opacity-60 mr-1">Alt+{idx + 1}</span>
              {c.partyName} · {c.lineItems.length}
            </button>
          ))}
        </div>
      )}

      {/* Main two-pane */}
      <main className="flex-1 flex min-h-0">
        <section className="flex-1 min-w-0 overflow-hidden">
          <ItemGrid search={search} onPick={handlePickItem} />
        </section>
        <aside className="w-[360px] flex-shrink-0 flex flex-col min-h-0">
          <Cart store={store} />
        </aside>
      </main>

      {/* Bottom pay bar */}
      <footer className="border-t border-border bg-surface-1 px-4 py-3 flex items-center gap-3">
        <div className="text-xs text-text-tertiary">
          F2 search · F3 customer · F6 hold · F9 pay · Alt+1..5 switch
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="btn-primary px-6 py-2.5 text-base"
          onClick={() => setPaymentOpen(true)}
          disabled={!activeCart || activeCart.lineItems.length === 0}
        >
          Pay · F9
        </button>
      </footer>

      <CustomerPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handleCustomerPick}
        walkIn={{ id: walkInPartyId, name: "Walk-in Customer" }}
      />
      {activeCart && (
        <PaymentSheet
          open={paymentOpen}
          cart={activeCart}
          onClose={() => setPaymentOpen(false)}
          onFinalized={handleFinalized}
        />
      )}
      <ReceiptPrinter
        invoiceId={printInvoiceId}
        onDone={() => setPrintInvoiceId(null)}
      />
    </div>
  );
}
