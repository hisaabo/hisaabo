import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { SlideOver } from "@/components/ui/SlideOver";
import { Combobox } from "@/components/ui/Combobox";
import { toast } from "@/hooks/useToast";
import { calcLineItem, calcInvoiceTotals, money } from "@hisaabo/shared";

// ── Types ────────────────────────────────────────────────────────

export type DocumentType =
  | "invoice"
  | "quotation"
  | "credit_note"
  | "debit_note"
  | "delivery_challan"
  | "proforma"
  | "sales_return"
  | "purchase_return";

export interface DocumentCreatorProps {
  documentType: DocumentType;
  invoiceType: "sale" | "purchase";
  onClose: () => void;
  onSuccess?: () => void;
  // Edit mode: pass existing invoice ID to pre-fill
  editInvoiceId?: string;
}

interface LineItem {
  id: string;
  itemId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

interface Charge {
  label: string;
  amount: string;
}

// ── Helpers ──────────────────────────────────────────────────────

const documentTypeLabels: Record<DocumentType, string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
  delivery_challan: "Delivery Challan",
  proforma: "Proforma Invoice",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
};

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
  const result = calcLineItem({
    quantity: li.quantity || "0",
    unitPrice: li.unitPrice || "0",
    taxPercent: li.taxPercent || "0",
    discountPercent: li.discountPercent || "0",
  });
  return {
    subtotal: money.toNumber(result.subtotal),
    afterDiscount: money.toNumber(result.afterDiscount),
    taxAmt: money.toNumber(result.taxAmount),
    total: money.toNumber(result.total),
  };
}

// ── Component ────────────────────────────────────────────────────

export function DocumentCreator({
  documentType,
  invoiceType,
  onClose,
  onSuccess,
  editInvoiceId,
}: DocumentCreatorProps) {
  const [partyId, setPartyId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<LineItem[]>([newLineItem()]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [roundOff, setRoundOff] = useState("0");

  const { data: partiesData } = trpc.party.list.useQuery({
    type: invoiceType === "sale" ? "customer" : "supplier",
    page: 1,
    limit: 100,
  });

  const { data: itemsData } = trpc.item.list.useQuery({ page: 1, limit: 100 });

  const utils = trpc.useUtils();

  const { data: editData } = trpc.invoice.getById.useQuery(
    { id: editInvoiceId! },
    { enabled: !!editInvoiceId }
  );

  useEffect(() => {
    if (!editData) return;
    setPartyId(editData.partyId);
    setInvoiceDate(new Date(editData.invoiceDate).toISOString().split("T")[0]);
    if (editData.dueDate) setDueDate(new Date(editData.dueDate).toISOString().split("T")[0]);
    setNotes(editData.notes || "");
    setTerms(editData.termsAndConditions || "");
    setRoundOff(editData.roundOff || "0");

    // Map charges from JSONB
    if (editData.charges && Array.isArray(editData.charges)) {
      setCharges(editData.charges.map((c: any) => ({ label: c.label, amount: c.amount })));
    }

    // Map line items
    if (editData.lineItems?.length) {
      setItems(editData.lineItems.map((li: any) => ({
        id: crypto.randomUUID(),
        itemId: li.itemId || undefined,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })));
    }
  }, [editData]);

  const isEditing = !!editInvoiceId;

  function handleSuccess() {
    utils.invoice.list.invalidate();
    utils.quotation.list.invalidate();
    utils.creditNote.list.invalidate();
    utils.debitNote.list.invalidate();
    utils.deliveryChallan.list.invalidate();
    utils.proforma.list.invalidate();
    utils.salesReturn.list.invalidate();
    utils.purchaseReturn.list.invalidate();
    utils.dashboard.summary.invalidate();
    utils.dashboard.shippingSummary.invalidate();
    utils.item.list.invalidate();
    if (editInvoiceId) {
      utils.invoice.getById.invalidate({ id: editInvoiceId });
    }
    toast.success(isEditing ? `${documentTypeLabels[documentType]} updated` : `${documentTypeLabels[documentType]} created`);
    onSuccess?.();
    onClose();
  }

  function handleError(err: { message: string }) {
    toast.error(isEditing ? "Failed to update document" : "Failed to create document", err.message);
  }

  // All mutation hooks called unconditionally (React rules)
  const invoiceMutation = trpc.invoice.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const quotationMutation = trpc.quotation.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const creditNoteMutation = trpc.creditNote.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const debitNoteMutation = trpc.debitNote.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const deliveryChallanMutation = trpc.deliveryChallan.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const proformaMutation = trpc.proforma.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const salesReturnMutation = trpc.salesReturn.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const purchaseReturnMutation = trpc.purchaseReturn.create.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const updateMutation = trpc.invoice.update.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const mutationMap: Record<DocumentType, { mutate: (input: any) => void; isPending: boolean }> = {
    invoice: invoiceMutation,
    quotation: quotationMutation,
    credit_note: creditNoteMutation,
    debit_note: debitNoteMutation,
    delivery_challan: deliveryChallanMutation,
    proforma: proformaMutation,
    sales_return: salesReturnMutation,
    purchase_return: purchaseReturnMutation,
  };

  const createMutation = mutationMap[documentType];
  const activeMutation = isEditing ? updateMutation : createMutation;

  // Computed totals using fixed-point arithmetic
  const totals = useMemo(() => {
    const activeCharges = charges.filter((c) => c.amount && parseFloat(c.amount) > 0);
    const result = calcInvoiceTotals({
      lineItems: items.map((li) => ({
        quantity: li.quantity || "0",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
      charges: activeCharges.map((c) => ({ amount: c.amount })),
      roundOff: roundOff || "0",
    });
    return {
      subtotal: money.toNumber(result.subtotal),
      taxTotal: money.toNumber(result.taxTotal),
      discountTotal: money.toNumber(result.discountTotal),
      chargesTotal: money.toNumber(result.chargesTotal),
      total: money.toNumber(result.total),
    };
  }, [items, charges, roundOff]);

  function updateItem(id: string, field: keyof LineItem, value: string) {
    setItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li))
    );
  }

  function selectProduct(lineId: string, productId: string) {
    const product = itemsData?.data.find((p) => p.id === productId);
    if (!product) return;
    setItems((prev) =>
      prev.map((li) =>
        li.id === lineId
          ? {
              ...li,
              itemId: product.id,
              description: product.name,
              unitPrice:
                (invoiceType === "sale"
                  ? product.salePrice
                  : product.purchasePrice) || "",
              taxPercent: product.taxPercent,
            }
          : li
      )
    );
  }

  function addLine() {
    setItems((prev) => [...prev, newLineItem()]);
  }

  function removeLine(id: string) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((li) => li.id !== id));
  }

  function handleSubmit() {
    const validItems = items.filter((li) => li.description && li.unitPrice);
    if (validItems.length === 0) {
      toast.error("Add at least one line item with a description and price");
      return;
    }
    if (!partyId) {
      toast.error(
        `Select a ${invoiceType === "sale" ? "customer" : "supplier"}`
      );
      return;
    }

    const lineItemsPayload = validItems.map((li) => ({
      itemId: li.itemId,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      discountPercent: li.discountPercent,
    }));

    const chargesPayload = charges
      .filter((c) => c.label && c.amount && parseFloat(c.amount) > 0)
      .map((c) => ({ label: c.label, amount: parseFloat(c.amount).toFixed(2) }));

    if (isEditing) {
      updateMutation.mutate({
        id: editInvoiceId!,
        partyId,
        invoiceDate: new Date(invoiceDate).toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes || null,
        termsAndConditions: terms || null,
        charges: chargesPayload,
        roundOff: roundOff || "0",
        lineItems: lineItemsPayload,
      });
    } else {
      createMutation.mutate({
        partyId,
        type: invoiceType,
        invoiceDate: new Date(invoiceDate).toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        notes: notes || undefined,
        termsAndConditions: terms || undefined,
        charges: chargesPayload,
        roundOff: roundOff || undefined,
        lineItems: lineItemsPayload,
      });
    }
  }

  const label = documentTypeLabels[documentType];
  const partyLabel = invoiceType === "sale" ? "Customer" : "Supplier";

  const partyOptions =
    partiesData?.data.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.type === "customer" ? "Customer" : "Supplier",
    })) ?? [];

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={isEditing ? `Edit ${label}` : `New ${label}`}
      description={isEditing ? `Edit ${invoiceType} ${label.toLowerCase()}` : `Create a new ${invoiceType} ${label.toLowerCase()}`}
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={activeMutation.isPending}
          >
            {activeMutation.isPending
              ? isEditing ? "Saving..." : "Creating..."
              : isEditing ? "Save Changes" : `Create ${label}`}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Top row: party, dates */}
        <div className="grid grid-cols-3 gap-4">
          <Combobox
            label={partyLabel}
            required
            value={partyId}
            onChange={setPartyId}
            options={partyOptions}
            placeholder={`Search ${partyLabel.toLowerCase()}...`}
            emptyMessage={`No ${partyLabel.toLowerCase()}s found`}
          />
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Due date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input"
            />
          </div>
        </div>

        {/* Line items table */}
        <div className="card overflow-hidden min-w-0">
          {/* Table header */}
          <div className="grid gap-2 px-3 py-2 text-[11px] font-medium text-text-tertiary bg-surface-1 border-b border-border-light [grid-template-columns:1fr_200px_72px_90px_64px_64px_90px_28px]">
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
          <div className="divide-y divide-border-light">
            {items.map((li) => {
              const calc = calcLine(li);
              return (
                <div
                  key={li.id}
                  className="grid gap-2 px-3 py-2 items-center min-w-0 [grid-template-columns:1fr_200px_72px_90px_64px_64px_90px_28px]"
                >
                  {/* Product selector */}
                  <select
                    value={li.itemId || ""}
                    onChange={(e) => selectProduct(li.id, e.target.value)}
                    className="input py-1.5 text-xs"
                  >
                    <option value="">Custom item</option>
                    {itemsData?.data.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {/* Description */}
                  <input
                    value={li.description}
                    onChange={(e) =>
                      updateItem(li.id, "description", e.target.value)
                    }
                    placeholder="Description *"
                    required
                    className="input py-1.5 text-xs"
                  />

                  {/* Quantity */}
                  <input
                    type="number"
                    value={li.quantity}
                    onChange={(e) =>
                      updateItem(li.id, "quantity", e.target.value)
                    }
                    min="0.001"
                    step="any"
                    required
                    className="input py-1.5 text-xs text-right tabular-nums"
                  />

                  {/* Unit price */}
                  <input
                    type="number"
                    value={li.unitPrice}
                    onChange={(e) =>
                      updateItem(li.id, "unitPrice", e.target.value)
                    }
                    min="0"
                    step="0.01"
                    required
                    placeholder="0.00"
                    className="input py-1.5 text-xs text-right tabular-nums"
                  />

                  {/* Tax % */}
                  <input
                    type="number"
                    value={li.taxPercent}
                    onChange={(e) =>
                      updateItem(li.id, "taxPercent", e.target.value)
                    }
                    min="0"
                    step="0.01"
                    className="input py-1.5 text-xs text-right tabular-nums"
                  />

                  {/* Discount % */}
                  <input
                    type="number"
                    value={li.discountPercent}
                    onChange={(e) =>
                      updateItem(li.id, "discountPercent", e.target.value)
                    }
                    min="0"
                    max="100"
                    step="0.01"
                    className="input py-1.5 text-xs text-right tabular-nums"
                  />

                  {/* Line total */}
                  <div className="text-right text-xs font-semibold tabular-nums text-text-primary">
                    {li.unitPrice ? formatCurrency(calc.total) : "—"}
                  </div>

                  {/* Delete row */}
                  <button
                    type="button"
                    onClick={() => removeLine(li.id)}
                    disabled={items.length <= 1}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    aria-label="Remove line"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add row button */}
          <div className="px-3 py-2 bg-surface-1">
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
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Subtotal</span>
              <span className="tabular-nums font-medium text-text-primary">
                {formatCurrency(totals.subtotal)}
              </span>
            </div>
            {totals.discountTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Discount</span>
                <span className="tabular-nums text-emerald-600">
                  -{formatCurrency(totals.discountTotal)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Tax</span>
              <span className="tabular-nums text-text-primary">
                {formatCurrency(totals.taxTotal)}
              </span>
            </div>

            {/* Charges section */}
            <div className="pt-1">
              {charges.map((charge, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm mb-1.5">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input
                      value={charge.label}
                      onChange={(e) => {
                        const next = [...charges];
                        next[idx] = { ...next[idx], label: e.target.value };
                        setCharges(next);
                      }}
                      className="input py-1 text-xs w-28"
                      placeholder="Label"
                    />
                    <button
                      type="button"
                      onClick={() => setCharges(charges.filter((_, i) => i !== idx))}
                      className="text-text-tertiary hover:text-red-500 transition-colors p-0.5"
                      aria-label="Remove charge"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>
                  <input
                    type="number"
                    value={charge.amount}
                    onChange={(e) => {
                      const next = [...charges];
                      next[idx] = { ...next[idx], amount: e.target.value };
                      setCharges(next);
                    }}
                    className="input w-28 text-right tabular-nums py-1 text-xs"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
              ))}

              {/* Quick-add buttons */}
              <div className="flex items-center gap-1.5 mt-1">
                {!charges.some((c) => c.label.toLowerCase() === "shipping") && (
                  <button
                    type="button"
                    onClick={() => setCharges([...charges, { label: "Shipping", amount: "" }])}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors border border-dashed border-border-light"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M1.5 10h8V4H1.5v6z" />
                      <path d="M9.5 6h2.5l2 2.5V10h-4.5V6z" />
                      <circle cx="4" cy="11.5" r="1" />
                      <circle cx="11.5" cy="11.5" r="1" />
                    </svg>
                    Shipping
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCharges([...charges, { label: "", amount: "" }])}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  + Add charge
                </button>
              </div>
            </div>

            {totals.chargesTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">
                  Charges ({charges.filter((c) => parseFloat(c.amount) > 0).length})
                </span>
                <span className="tabular-nums text-text-primary">
                  {formatCurrency(totals.chargesTotal)}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center text-sm">
              <span className="text-text-secondary">Round Off</span>
              <input
                type="number"
                className="input w-32 text-right tabular-nums"
                value={roundOff}
                onChange={(e) => setRoundOff(e.target.value)}
                step="0.01"
              />
            </div>
            <div className="pt-2 border-t border-border-light flex justify-between">
              <span className="text-sm font-semibold text-text-primary">
                Total
              </span>
              <span className="text-lg font-bold tabular-nums text-text-primary">
                {formatCurrency(totals.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes and terms */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Additional notes for the customer…"
              className="input resize-none"
            />
          </div>
          <div>
            <label className="label">Terms &amp; conditions</label>
            <textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={3}
              placeholder="Payment terms, warranty, etc…"
              className="input resize-none"
            />
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
