import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { apiUrl } from "@/lib/api-url";
import { getBusinessId } from "@/lib/trpc";

interface LineItem {
  id: string;
  itemId?: string;
  variantId?: string;
  selectedUnit?: string;
  conversionFactor?: string;
  /** Primary bold text on the invoice — frozen at create time. */
  itemName: string;
  /** Free-text line notes (optional). Sent as `description` on the wire. */
  notes: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

function newLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    itemName: "",
    notes: "",
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
    page: 1, limit: 100,
  });

  const { data: itemsData } = trpc.item.list.useQuery({ page: 1, limit: 100 });

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
        variantId: undefined,
        selectedUnit: undefined,
        conversionFactor: undefined,
        // itemName is the frozen snapshot; notes stay blank on fresh pick.
        itemName: product.name,
        notes: "",
        unitPrice: (type === "sale" ? product.salePrice : product.purchasePrice) || "",
        taxPercent: product.taxPercent,
      } : li
    ));
  }

  function selectVariantFromData(lineId: string, variant: { id: string; attributeValues: Record<string, string>; salePrice: string | null; purchasePrice: string | null }) {
    const li = items.find((l) => l.id === lineId);
    if (!li?.itemId) return;
    const product = itemsData?.data.find((p) => p.id === li.itemId);
    if (!product) return;
    const label = Object.values(variant.attributeValues).join(" / ");
    setItems((prev) => prev.map((l) =>
      l.id === lineId ? {
        ...l,
        variantId: variant.id,
        itemName: `${product.name} - ${label}`,
        unitPrice: (type === "sale"
          ? (variant.salePrice || product.salePrice)
          : (variant.purchasePrice || product.purchasePrice)) || "",
      } : l
    ));
  }

  function selectUnit(lineId: string, unitKey: string) {
    const li = items.find((l) => l.id === lineId);
    if (!li?.itemId) return;
    const product = itemsData?.data.find((p) => p.id === li.itemId);
    if (!product) return;

    if (unitKey === "__base__") {
      // Back to base unit
      setItems((prev) => prev.map((l) =>
        l.id === lineId ? {
          ...l,
          selectedUnit: undefined,
          conversionFactor: undefined,
          unitPrice: (type === "sale" ? product.salePrice : product.purchasePrice) || "",
          itemName: product.name,
        } : l
      ));
      return;
    }

    const uv = (product.unitVariants as any[])?.find((v: any) => v.unit === unitKey);
    if (!uv) return;
    setItems((prev) => prev.map((l) =>
      l.id === lineId ? {
        ...l,
        selectedUnit: uv.unit,
        conversionFactor: String(uv.conversionFactor),
        unitPrice: (type === "sale" ? uv.salePrice : (uv.purchasePrice || uv.salePrice)) || "",
        itemName: `${product.name} (${uv.unit})`,
      } : l
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
    const validItems = items.filter((li) => li.itemName.trim() && li.unitPrice);
    if (validItems.length === 0) return;

    createMutation.mutate({
      partyId,
      type,
      invoiceDate: new Date(invoiceDate).toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      notes: notes || undefined,
      termsAndConditions: terms || undefined,
      // Bug B: itemName is the required frozen snapshot; description carries
      // the optional free-text notes. Empty notes become `undefined` so the
      // validator keeps the stored column NULL rather than persisting "".
      lineItems: validItems.map((li) => {
        const trimmedNotes = li.notes.trim();
        return {
          itemId: li.itemId,
          itemName: li.itemName.trim(),
          description: trimmedNotes.length > 0 ? trimmedNotes : undefined,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
          variantId: li.variantId || undefined,
          selectedUnit: li.selectedUnit || undefined,
          conversionFactor: li.conversionFactor || undefined,
        };
      }),
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
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors" style={{ color: "var(--text-tertiary)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} aria-label={`New ${type} invoice`}>
          <div className="px-6 py-4 space-y-4">
            {/* Top row: party, dates */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="invoice-party-select"
                  className="block text-xs font-medium mb-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {type === "sale" ? "Customer" : "Supplier"} *
                </label>
                <select
                  id="invoice-party-select"
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
                <label htmlFor="invoice-date" className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Invoice date</label>
                <input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label htmlFor="invoice-due-date" className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Due date</label>
                <input id="invoice-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
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
                <span>Item name</span>
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
                  const selectedProduct = li.itemId ? itemsData?.data.find((p) => p.id === li.itemId) : null;
                  const isVariantProduct = selectedProduct?.itemMode === "variants";
                  const isAltUnitProduct = selectedProduct?.itemMode === "alt_units";
                  return (
                    <div key={li.id}>
                    <div
                      className="grid gap-2 px-3 py-2 items-center"
                      style={{ gridTemplateColumns: "1fr 180px 72px 90px 64px 64px 90px 28px" }}
                    >
                      {/* Product selector */}
                      <select
                        value={li.itemId || ""}
                        onChange={(e) => selectProduct(li.id, e.target.value)}
                        aria-label="Product"
                        className="w-full px-2 py-1.5 rounded text-xs outline-none"
                        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      >
                        <option value="">Custom item</option>
                        {itemsData?.data.map((p) => <option key={p.id} value={p.id}>{p.name}{p.itemMode === "variants" ? " (variants)" : p.itemMode === "alt_units" ? ` (${p.unit})` : ""}</option>)}
                      </select>

                      {/* Item name (primary bold line on the invoice) */}
                      <input
                        value={li.itemName}
                        onChange={(e) => updateItem(li.id, "itemName", e.target.value)}
                        placeholder="Item name *"
                        aria-label="Item name"
                        required
                        maxLength={200}
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
                        aria-label="Quantity"
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
                        aria-label="Unit price"
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
                        aria-label="Tax percent"
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
                        aria-label="Discount percent"
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
                        aria-label="Remove line item"
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </div>

                    {/* Variant sub-selector */}
                    {isVariantProduct && (
                      <div className="px-3 pb-2">
                        <VariantSelector
                          itemId={li.itemId!}
                          selectedVariantId={li.variantId}
                          onSelect={(variant) => selectVariantFromData(li.id, variant)}
                        />
                      </div>
                    )}

                    {/* Line notes (free-text). Stored on the backend as
                        invoice_items.description and rendered as italic
                        secondary text under the item name on the PDF. */}
                    <div className="px-3 pb-2">
                      <div className="relative">
                        <textarea
                          value={li.notes}
                          onChange={(e) => updateItem(li.id, "notes", e.target.value)}
                          placeholder="Notes for this line (optional)"
                          aria-label="Line notes"
                          rows={2}
                          maxLength={500}
                          className="w-full px-2 py-1.5 rounded text-xs outline-none resize-y min-h-[2.25rem]"
                          style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                        />
                        {li.notes.length > 400 && (
                          <p
                            className={`absolute right-2 bottom-1 text-[10px] tabular-nums pointer-events-none ${
                              li.notes.length > 500 ? "text-red-500" : "text-text-tertiary"
                            }`}
                            aria-live="polite"
                          >
                            {li.notes.length} / 500
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Alt unit sub-selector */}
                    {isAltUnitProduct && (selectedProduct?.unitVariants as any[])?.length > 0 && (
                      <div className="px-3 pb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>Unit:</span>
                          <div className="flex gap-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => selectUnit(li.id, "__base__")}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                !li.selectedUnit
                                  ? "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-400"
                                  : "bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                              }`}
                              style={{ border: "1px solid var(--border-light)" }}
                            >
                              {selectedProduct.unit} {selectedProduct.salePrice ? `- ${formatCurrency(selectedProduct.salePrice)}` : ""}
                            </button>
                            {(selectedProduct.unitVariants as any[]).map((uv: any) => (
                              <button
                                key={uv.unit}
                                type="button"
                                onClick={() => selectUnit(li.id, uv.unit)}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                  li.selectedUnit === uv.unit
                                    ? "bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-400"
                                    : "bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                                }`}
                                style={{ border: "1px solid var(--border-light)" }}
                              >
                                {uv.unit} - {formatCurrency(uv.salePrice)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
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
                <label htmlFor="invoice-notes" className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Notes</label>
                <textarea
                  id="invoice-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Additional notes for the customer..."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label htmlFor="invoice-terms" className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Terms & conditions</label>
                <textarea
                  id="invoice-terms"
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
                disabled={createMutation.isPending || !partyId || !items.some((li) => li.itemName.trim() && li.unitPrice)}
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

// ── Variant Selector (for InvoiceCreator line items) ──────────

function VariantSelector({ itemId, selectedVariantId, onSelect }: {
  itemId: string;
  selectedVariantId?: string;
  onSelect: (variant: { id: string; attributeValues: Record<string, string>; salePrice: string | null; purchasePrice: string | null }) => void;
}) {
  const { data: variants, isLoading } = trpc.item.listVariants.useQuery({ itemId });

  if (isLoading) return <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>Loading variants...</span>;
  if (!variants || variants.length === 0) return <span className="text-[10px] text-amber-600">No variants defined</span>;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>Variant:</span>
      <select
        value={selectedVariantId || ""}
        onChange={(e) => {
          const v = variants.find((v) => v.id === e.target.value);
          if (v) onSelect({ id: v.id, attributeValues: v.attributeValues as Record<string, string>, salePrice: v.salePrice, purchasePrice: v.purchasePrice });
        }}
        className="px-2 py-0.5 rounded text-[10px] outline-none"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
      >
        <option value="">Select variant...</option>
        {variants.map((v) => {
          const label = Object.values(v.attributeValues as Record<string, string>).join(" / ");
          return (
            <option key={v.id} value={v.id}>
              {label}{v.salePrice ? ` - ${formatCurrency(v.salePrice)}` : ""}
            </option>
          );
        })}
      </select>
      {!selectedVariantId && (
        <span className="text-[10px] text-amber-600">Please select a variant</span>
      )}
    </div>
  );
}

// ── Invoice PDF download button ────────────────────────────────

export function DownloadPDFButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const { data: businesses } = trpc.business.list.useQuery();
  const activeId = getBusinessId();
  const activeBusiness = businesses?.find((b) => b.id === activeId);
  const hasGstin = !!(activeBusiness?.gstin && activeBusiness.gstRegistrationType !== "unregistered");

  // Format options: GST businesses get A4 + A5 + Thermal; non-GST get A5 + Thermal
  type Format = "a4" | "a5" | "thermal";
  const options: { format: Format; label: string }[] = hasGstin
    ? [
        { format: "a4", label: "GST Invoice (A4)" },
        { format: "a5", label: "Simple Invoice (A5)" },
        { format: "thermal", label: "Thermal Receipt" },
      ]
    : [
        { format: "a5", label: "Invoice (A5)" },
        { format: "thermal", label: "Thermal Receipt" },
      ];

  async function download(format: Format) {
    setOpen(false);
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/invoices/${invoiceId}/pdf?format=${format}`), {
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
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50 border border-brand-200 dark:border-brand-800"
      >
        {loading ? (
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        )}
        PDF
        <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 min-w-[160px] rounded-lg border border-border-light bg-surface-1 shadow-lg py-1">
            {options.map((opt) => (
              <button
                key={opt.format}
                onClick={() => download(opt.format)}
                className="w-full text-left text-xs px-3 py-2 text-text-primary hover:bg-surface-2 transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
