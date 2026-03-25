import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { getBusinessId } from "@/lib/trpc";

interface LineItem {
  id: string;
  itemId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

function newLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "",
    taxPercent: "0",
    discountPercent: "0",
  };
}

function calcLine(li: LineItem) {
  const qty = parseFloat(li.quantity) || 0;
  const price = parseFloat(li.unitPrice) || 0;
  const disc = parseFloat(li.discountPercent) || 0;
  const tax = parseFloat(li.taxPercent) || 0;
  const subtotal = qty * price;
  const afterDiscount = subtotal * (1 - disc / 100);
  const taxAmt = afterDiscount * (tax / 100);
  return { subtotal, afterDiscount, taxAmt, total: afterDiscount + taxAmt };
}

interface Props {
  type: "sale" | "purchase";
  onClose: () => void;
}

export function InvoiceCreator({ type, onClose }: Props) {
  const [partyId, setPartyId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<LineItem[]>([newLineItem()]);

  // Role check: sellers cannot edit tax/discount fields (flow from item)
  const { data: session } = trpc.auth.me.useQuery();
  const isSeller = session?.role === "seller" || session?.role === "member";

  const { data: partiesData } = trpc.party.list.useQuery({
    type: type === "sale" ? "customer" : "supplier",
    page: 1, limit: 200,
  });

  const { data: itemsData } = trpc.item.list.useQuery({ page: 1, limit: 200 });

  const utils = trpc.useUtils();
  const createMutation = trpc.invoice.create.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.item.list.invalidate();
      onClose();
    },
  });

  // Computed totals
  const totals = useMemo(() => {
    let subtotal = 0, taxTotal = 0, discountTotal = 0;
    for (const li of items) {
      const c = calcLine(li);
      subtotal += c.afterDiscount;
      taxTotal += c.taxAmt;
      const disc = (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0) - c.afterDiscount;
      discountTotal += disc;
    }
    return { subtotal, taxTotal, discountTotal, total: subtotal + taxTotal };
  }, [items]);

  function updateItem(id: string, field: keyof LineItem, value: string) {
    setItems((prev) => prev.map((li) => li.id === id ? { ...li, [field]: value } : li));
  }

  function selectProduct(lineId: string, productId: string) {
    const product = itemsData?.data.find((p) => p.id === productId);
    if (!product) return;
    setItems((prev) => prev.map((li) =>
      li.id === lineId ? {
        ...li,
        itemId: product.id,
        description: product.name,
        unitPrice: (type === "sale" ? product.salePrice : product.purchasePrice) || "",
        taxPercent: product.taxPercent,
      } : li
    ));
  }

  function addLine() {
    setItems((prev) => [...prev, newLineItem()]);
  }

  function removeLine(id: string) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((li) => li.id !== id));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((li) => li.description && li.unitPrice);
    if (validItems.length === 0) return;

    createMutation.mutate({
      partyId,
      type,
      invoiceDate: new Date(invoiceDate).toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      notes: notes || undefined,
      termsAndConditions: terms || undefined,
      lineItems: validItems.map((li) => ({
        itemId: li.itemId,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent,
        discountPercent: li.discountPercent,
      })),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl shadow-elevated mx-4"
        style={{ background: "var(--surface-0)", border: "1px solid var(--border-light)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: "var(--border-light)" }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              New {type} invoice
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              Add items, set tax rates, and preview totals
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors" style={{ color: "var(--text-tertiary)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {/* Top row: party, dates */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                  {type === "sale" ? "Customer" : "Supplier"} *
                </label>
                <select
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                >
                  <option value="">Select...</option>
                  {partiesData?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Invoice date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Due date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            {/* Line items table */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
              {/* Table header */}
              <div
                className="grid gap-2 px-3 py-2 text-[11px] font-medium"
                style={{
                  gridTemplateColumns: "1fr 180px 72px 90px 64px 64px 90px 28px",
                  background: "var(--surface-1)",
                  color: "var(--text-tertiary)",
                }}
              >
                <span>Product</span>
                <span>Description</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Price</span>
                <span className="text-right">Tax %</span>
                <span className="text-right">Disc %</span>
                <span className="text-right">Amount</span>
                <span />
              </div>

              {/* Line item rows */}
              <div className="divide-y" style={{ borderColor: "var(--border-light)" }}>
                {items.map((li, _idx) => {
                  const calc = calcLine(li);
                  return (
                    <div
                      key={li.id}
                      className="grid gap-2 px-3 py-2 items-center"
                      style={{ gridTemplateColumns: "1fr 180px 72px 90px 64px 64px 90px 28px" }}
                    >
                      {/* Product selector */}
                      <select
                        value={li.itemId || ""}
                        onChange={(e) => selectProduct(li.id, e.target.value)}
                        className="w-full px-2 py-1.5 rounded text-xs outline-none"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      >
                        <option value="">Custom item</option>
                        {itemsData?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>

                      {/* Description */}
                      <input
                        value={li.description}
                        onChange={(e) => updateItem(li.id, "description", e.target.value)}
                        placeholder="Description *"
                        required
                        className="w-full px-2 py-1.5 rounded text-xs outline-none"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      />

                      {/* Quantity */}
                      <input
                        type="number"
                        value={li.quantity}
                        onChange={(e) => updateItem(li.id, "quantity", e.target.value)}
                        min="0.001"
                        step="any"
                        required
                        className="w-full px-2 py-1.5 rounded text-xs outline-none text-right tabular-nums"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      />

                      {/* Unit price */}
                      <input
                        type="number"
                        value={li.unitPrice}
                        onChange={(e) => updateItem(li.id, "unitPrice", e.target.value)}
                        min="0"
                        step="0.01"
                        required
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 rounded text-xs outline-none text-right tabular-nums"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      />

                      {/* Tax % — disabled for seller role, auto-populated from item */}
                      <input
                        type="number"
                        value={li.taxPercent}
                        onChange={(e) => updateItem(li.id, "taxPercent", e.target.value)}
                        min="0"
                        step="0.01"
                        disabled={isSeller}
                        title={isSeller ? "Tax rate is set from the item. Contact admin to change." : undefined}
                        className="w-full px-2 py-1.5 rounded text-xs outline-none text-right tabular-nums disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      />

                      {/* Discount % — disabled for seller role */}
                      <input
                        type="number"
                        value={li.discountPercent}
                        onChange={(e) => updateItem(li.id, "discountPercent", e.target.value)}
                        min="0"
                        max="100"
                        step="0.01"
                        disabled={isSeller}
                        title={isSeller ? "Discount is managed by admin. Contact admin to change." : undefined}
                        className="w-full px-2 py-1.5 rounded text-xs outline-none text-right tabular-nums disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      />

                      {/* Line total */}
                      <div className="text-right text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {li.unitPrice ? formatCurrency(calc.total) : "—"}
                      </div>

                      {/* Delete row */}
                      <button
                        type="button"
                        onClick={() => removeLine(li.id)}
                        disabled={items.length <= 1}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add row button */}
              <div className="px-3 py-2" style={{ background: "var(--surface-1)" }}>
                <button
                  type="button"
                  onClick={addLine}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                >
                  + Add line item
                </button>
              </div>
            </div>

            {/* Totals summary */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Subtotal</span>
                  <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(totals.subtotal)}
                  </span>
                </div>
                {totals.discountTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span style={{ color: "var(--text-secondary)" }}>Discount</span>
                    <span className="tabular-nums text-emerald-600">-{formatCurrency(totals.discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Tax</span>
                  <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(totals.taxTotal)}</span>
                </div>
                <div className="pt-1.5 border-t flex justify-between" style={{ borderColor: "var(--border-light)" }}>
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Total</span>
                  <span className="text-lg font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>
            </div>

            {/* Notes and terms */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Additional notes for the customer..."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Terms & conditions</label>
                <textarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={3}
                  placeholder="Payment terms, warranty, etc..."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 flex items-center justify-between border-t" style={{ borderColor: "var(--border-light)", background: "var(--surface-1)" }}>
            {createMutation.error && (
              <p className="text-xs text-red-600">{createMutation.error.message}</p>
            )}
            <div className="flex-1" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? "Creating..." : "Create invoice"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Invoice PDF download button ────────────────────────────────

export function DownloadPDFButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const [loading, setLoading] = useState(false);

  async function download(format: "a4" | "thermal") {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf?format=${format}`, {
        credentials: "include",
        headers: {
          "x-business-id": getBusinessId() || "",
        },
      });
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber}_${format}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to download PDF");
    }
    setLoading(false);
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={() => download("a4")}
        disabled={loading}
        className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
      >
        {loading ? "..." : "A4 PDF"}
      </button>
      <button
        onClick={() => download("thermal")}
        disabled={loading}
        className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
      >
        Receipt
      </button>
    </div>
  );
}
