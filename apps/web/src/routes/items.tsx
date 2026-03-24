import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import type { ItemType } from "@hisaabo/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Listbox } from "@/components/ui/Listbox";
import { Disclosure } from "@/components/ui/Disclosure";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { Pagination } from "@/components/ui/Pagination";

export const Route = createFileRoute("/items")({
  component: ItemsPage,
});

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "product", label: "Products" },
  { value: "service", label: "Services" },
];

const UNIT_OPTIONS = [
  { value: "pcs", label: "Pieces (PCS)" },
  { value: "kg", label: "Kilograms (KG)" },
  { value: "g", label: "Grams (G)" },
  { value: "l", label: "Litres (L)" },
  { value: "ml", label: "Millilitres (ML)" },
  { value: "m", label: "Metres (M)" },
  { value: "cm", label: "Centimetres (CM)" },
  { value: "ft", label: "Feet (FT)" },
  { value: "in", label: "Inches (IN)" },
  { value: "box", label: "Box" },
  { value: "dozen", label: "Dozen" },
  { value: "pair", label: "Pair" },
  { value: "set", label: "Set" },
  { value: "other", label: "Other" },
];

const ITEMS_PAGE_SIZE = 20;

function countFilled(...values: string[]): number {
  return values.filter((v) => v.trim() !== "").length;
}

function ItemsPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showLowStock, setShowLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, typeFilter, showLowStock]);

  const { data, isLoading } = trpc.item.list.useQuery({
    search: debouncedSearch || undefined,
    lowStock: showLowStock || undefined,
    page,
    limit: ITEMS_PAGE_SIZE,
  });

  const { data: lowStockCount } = trpc.item.lowStockCount.useQuery();
  const utils = trpc.useUtils();

  const deleteMutation = trpc.item.delete.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      setDeleteId(null);
      toast.success("Item deleted");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  useHotkeys([
    {
      key: "n",
      handler: () => setShowAddModal(true),
      description: "New item",
      scope: "items",
    },
  ]);

  // Client-side filter by item type (the query doesn't have itemType filter)
  const filteredItems =
    data?.data.filter((item) => {
      if (typeFilter === "all") return true;
      return item.itemType === typeFilter;
    }) ?? [];

  return (
    <div>
      <PageHeader
        title="Items"
        description="Products and services inventory"
        actions={
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => setShowAddModal(true)}
          >
            + Add Item
            <KbdShortcut keys={["N"]} className="opacity-60" />
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search items..."
          className="max-w-xs"
        />
        <SegmentedControl
          tabs={TYPE_TABS}
          value={typeFilter}
          onChange={setTypeFilter}
        />
        {(lowStockCount ?? 0) > 0 && (
          <button
            onClick={() => setShowLowStock(!showLowStock)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
              showLowStock
                ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800"
                : "bg-surface-0 text-text-secondary border-border-color hover:bg-surface-1"
            )}
          >
            Low stock ({lowStockCount})
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : !filteredItems.length ? (
        <EmptyState
          title="No items found"
          description="Add products or services to start creating invoices."
          action={
            <button className="btn-primary" onClick={() => setShowAddModal(true)}>
              + Add Item
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>HSN</th>
                <th className="text-right">Sale Price</th>
                <th className="text-right">Stock</th>
                <th>Unit</th>
                <th>Tax %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const isLow =
                  item.lowStockAlert &&
                  parseFloat(item.stockQuantity) <= parseFloat(item.lowStockAlert);
                return (
                  <tr key={item.id} className="group cursor-pointer" onClick={() => setSelectedItemId(item.id)}>
                    <td>
                      <p className="font-medium">{item.name}</p>
                      {item.sku && (
                        <p className="text-xs text-text-tertiary">SKU: {item.sku}</p>
                      )}
                    </td>
                    <td>
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium",
                          item.itemType === "service"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        )}
                      >
                        {item.itemType === "service" ? "Service" : "Product"}
                      </span>
                    </td>
                    <td className="text-text-secondary text-xs">{item.hsn || "—"}</td>
                    <td className="text-right tabular-nums">
                      {item.salePrice ? formatCurrency(item.salePrice) : "—"}
                    </td>
                    <td
                      className={cn(
                        "text-right tabular-nums font-medium",
                        isLow ? "text-amber-600" : ""
                      )}
                    >
                      {parseFloat(item.stockQuantity).toLocaleString()}
                    </td>
                    <td className="text-text-secondary text-xs">{item.unit}</td>
                    <td className="text-text-secondary tabular-nums">
                      {item.taxPercent}%
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => setDeleteId(item.id)}
                        aria-label="Delete item"
                      >
                        <svg
                          className="w-4 h-4"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && (
            <Pagination
              page={page}
              totalPages={Math.ceil(data.total / ITEMS_PAGE_SIZE)}
              onPageChange={setPage}
              total={data.total}
              pageSize={ITEMS_PAGE_SIZE}
            />
          )}
        </div>
      )}

      {/* Add Item Modal */}
      <AddItemModal open={showAddModal} onClose={() => setShowAddModal(false)} />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete item?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate({ id: deleteId });
        }}
        onCancel={() => setDeleteId(null)}
      />

      {/* Item Detail */}
      {selectedItemId && (
        <ItemDetailPanel
          itemId={selectedItemId}
          onClose={() => setSelectedItemId(null)}
          onEdit={(id) => {
            setSelectedItemId(null);
            setEditItemId(id);
          }}
        />
      )}

      {/* Edit Item Modal */}
      {editItemId && (
        <EditItemModal
          itemId={editItemId}
          onClose={() => setEditItemId(null)}
        />
      )}
    </div>
  );
}

function AddItemModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [itemType, setItemType] = useState<ItemType>("product");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [hsn, setHsn] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [stockQuantity, setStockQuantity] = useState("0");
  const [lowStockAlert, setLowStockAlert] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [unitVariants, setUnitVariants] = useState<Array<{ unit: string; conversionFactor: number; salePrice: string; purchasePrice?: string }>>([]);

  function updateVariant(idx: number, field: string, value: string) {
    setUnitVariants((prev) =>
      prev.map((v, i) =>
        i === idx ? { ...v, [field]: field === "conversionFactor" ? parseFloat(value) || 0 : value } : v
      )
    );
  }

  function removeVariant(idx: number) {
    setUnitVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  const utils = trpc.useUtils();

  const createMutation = trpc.item.create.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      toast.success("Item created");
      onClose();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function resetForm() {
    setItemType("product");
    setName("");
    setSku("");
    setCategory("");
    setHsn("");
    setSalePrice("");
    setPurchasePrice("");
    setTaxPercent("0");
    setTaxInclusive(false);
    setStockQuantity("0");
    setLowStockAlert("");
    setUnit("pcs");
    setUnitVariants([]);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleCreate() {
    const validVariants = unitVariants.filter((v) => v.unit && v.salePrice);
    createMutation.mutate({
      itemType,
      name,
      sku: sku || undefined,
      category: category || undefined,
      hsn: hsn || undefined,
      salePrice: salePrice || undefined,
      purchasePrice: purchasePrice || undefined,
      taxPercent,
      taxInclusive,
      stockQuantity,
      lowStockAlert: lowStockAlert || undefined,
      unit: unit as any,
      unitVariants: validVariants.length > 0 ? validVariants : undefined,
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Item" className="max-w-xl">
      <div className="space-y-4">
        {/* Item Type toggle */}
        <SegmentedControl
          tabs={[
            { value: "product", label: "Product" },
            { value: "service", label: "Service" },
          ]}
          value={itemType}
          onChange={(v) => setItemType(v as ItemType)}
        />

        {/* Base fields */}
        <InputField
          label="Item Name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Sale Price (₹)"
            type="number"
            step="0.01"
            min="0"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="0.00"
          />
          <div className="flex flex-col gap-1">
            <InputField
              label="Tax %"
              type="number"
              step="0.01"
              min="0"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
              placeholder="0"
            />
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer mt-0.5">
              <input
                type="checkbox"
                checked={taxInclusive}
                onChange={(e) => setTaxInclusive(e.target.checked)}
                className="rounded"
              />
              Price includes tax
            </label>
          </div>
        </div>

        <Listbox
          label="Unit"
          value={unit}
          onChange={setUnit}
          options={UNIT_OPTIONS}
          placeholder="Select unit"
        />

        {/* Section divider */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
            Additional Details
          </span>
          <div className="flex-1 h-px bg-border-light" />
        </div>

        {/* Disclosure sections */}
        <div className="space-y-1">
          <Disclosure
            label="Identification"
            count={countFilled(sku, hsn, category)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="SKU"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Stock keeping unit"
              />
              <InputField
                label="HSN / SAC Code"
                value={hsn}
                onChange={(e) => setHsn(e.target.value)}
                placeholder="HSN/SAC code"
              />
            </div>
            <div className="mt-3">
              <InputField
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electronics, Food"
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Purchase"
            count={countFilled(purchasePrice)}
          >
            <InputField
              label="Purchase Price (₹)"
              type="number"
              step="0.01"
              min="0"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="0.00"
            />
          </Disclosure>

          {itemType === "product" && (
            <Disclosure
              label="Stock"
              count={countFilled(stockQuantity === "0" ? "" : stockQuantity, lowStockAlert)}
            >
              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="Stock Quantity"
                  type="number"
                  min="0"
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  placeholder="0"
                />
                <InputField
                  label="Low Stock Alert"
                  type="number"
                  min="0"
                  value={lowStockAlert}
                  onChange={(e) => setLowStockAlert(e.target.value)}
                  placeholder="Alert threshold"
                />
              </div>
            </Disclosure>
          )}

          <Disclosure
            label="Unit Variants"
            count={unitVariants.filter((v) => v.unit && v.salePrice).length}
          >
            <div className="space-y-2">
              {unitVariants.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_90px_28px] gap-2 items-end">
                  <InputField
                    label={i === 0 ? "Unit Name" : ""}
                    value={v.unit}
                    onChange={(e) => updateVariant(i, "unit", e.target.value)}
                    placeholder="e.g. pack, box"
                  />
                  <InputField
                    label={i === 0 ? `Per ${unit}` : ""}
                    type="number"
                    min="0.01"
                    step="any"
                    value={String(v.conversionFactor)}
                    onChange={(e) => updateVariant(i, "conversionFactor", e.target.value)}
                    placeholder="e.g. 5"
                  />
                  <InputField
                    label={i === 0 ? "Sale Price (₹)" : ""}
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.salePrice}
                    onChange={(e) => updateVariant(i, "salePrice", e.target.value)}
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    className={cn(
                      "p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 transition-colors",
                      i === 0 ? "mb-0.5" : ""
                    )}
                    aria-label="Remove variant"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setUnitVariants([...unitVariants, { unit: "", conversionFactor: 1, salePrice: "" }])}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                + Add unit variant
              </button>
              {unitVariants.length > 0 && unit && (
                <p className="text-[11px] text-text-tertiary mt-1">
                  Base unit: {unit.toUpperCase()}. Each variant price is per that variant unit.
                </p>
              )}
            </div>
          </Disclosure>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border-light">
          <button className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? "Creating..." : "Create Item"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit Item Modal ──────────────────────────────────────────────

function EditItemModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { data: item } = trpc.item.getById.useQuery({ id: itemId });
  const utils = trpc.useUtils();

  const [itemType, setItemType] = useState<ItemType>("product");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [hsn, setHsn] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [stockQuantity, setStockQuantity] = useState("0");
  const [lowStockAlert, setLowStockAlert] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [unitVariants, setUnitVariants] = useState<Array<{ unit: string; conversionFactor: number; salePrice: string; purchasePrice?: string }>>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!item || initialized) return;
    setItemType(item.itemType ?? "product");
    setName(item.name);
    setSku(item.sku ?? "");
    setCategory(item.category ?? "");
    setHsn(item.hsn ?? "");
    setSalePrice(item.salePrice ?? "");
    setPurchasePrice(item.purchasePrice ?? "");
    setTaxPercent(item.taxPercent ?? "0");
    setTaxInclusive(item.taxInclusive ?? false);
    setStockQuantity(item.stockQuantity ?? "0");
    setLowStockAlert(item.lowStockAlert ?? "");
    setUnit(item.unit ?? "pcs");
    setUnitVariants((item.unitVariants as any[]) ?? []);
    setInitialized(true);
  }, [item, initialized]);

  function updateVariant(idx: number, field: string, value: string) {
    setUnitVariants((prev) =>
      prev.map((v, i) =>
        i === idx ? { ...v, [field]: field === "conversionFactor" ? parseFloat(value) || 0 : value } : v
      )
    );
  }

  function removeVariant(idx: number) {
    setUnitVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  const updateMutation = trpc.item.update.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      utils.item.getById.invalidate({ id: itemId });
      toast.success("Item updated");
      onClose();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function handleSave() {
    const validVariants = unitVariants.filter((v) => v.unit && v.salePrice);
    updateMutation.mutate({
      id: itemId,
      data: {
        itemType,
        name,
        sku: sku || undefined,
        category: category || undefined,
        hsn: hsn || undefined,
        salePrice: salePrice || undefined,
        purchasePrice: purchasePrice || undefined,
        taxPercent,
        taxInclusive,
        stockQuantity,
        lowStockAlert: lowStockAlert || undefined,
        unit: unit as any,
        unitVariants: validVariants.length > 0 ? validVariants : undefined,
      },
    });
  }

  return (
    <Modal open={true} onClose={onClose} title="Edit Item" className="max-w-xl">
      <div className="space-y-4">
        {/* Item Type toggle */}
        <SegmentedControl
          tabs={[
            { value: "product", label: "Product" },
            { value: "service", label: "Service" },
          ]}
          value={itemType}
          onChange={(v) => setItemType(v as ItemType)}
        />

        {/* Base fields */}
        <InputField
          label="Item Name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Sale Price (₹)"
            type="number"
            step="0.01"
            min="0"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="0.00"
          />
          <div className="flex flex-col gap-1">
            <InputField
              label="Tax %"
              type="number"
              step="0.01"
              min="0"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
              placeholder="0"
            />
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer mt-0.5">
              <input
                type="checkbox"
                checked={taxInclusive}
                onChange={(e) => setTaxInclusive(e.target.checked)}
                className="rounded"
              />
              Price includes tax
            </label>
          </div>
        </div>

        <Listbox
          label="Unit"
          value={unit}
          onChange={setUnit}
          options={UNIT_OPTIONS}
          placeholder="Select unit"
        />

        {/* Section divider */}
        <div className="flex items-center gap-3 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
            Additional Details
          </span>
          <div className="flex-1 h-px bg-border-light" />
        </div>

        {/* Disclosure sections */}
        <div className="space-y-1">
          <Disclosure
            label="Identification"
            count={countFilled(sku, hsn, category)}
          >
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label="SKU"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Stock keeping unit"
              />
              <InputField
                label="HSN / SAC Code"
                value={hsn}
                onChange={(e) => setHsn(e.target.value)}
                placeholder="HSN/SAC code"
              />
            </div>
            <div className="mt-3">
              <InputField
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electronics, Food"
              />
            </div>
          </Disclosure>

          <Disclosure
            label="Purchase"
            count={countFilled(purchasePrice)}
          >
            <InputField
              label="Purchase Price (₹)"
              type="number"
              step="0.01"
              min="0"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="0.00"
            />
          </Disclosure>

          {itemType === "product" && (
            <Disclosure
              label="Stock"
              count={countFilled(stockQuantity === "0" ? "" : stockQuantity, lowStockAlert)}
            >
              <div className="grid grid-cols-2 gap-4">
                <InputField
                  label="Stock Quantity"
                  type="number"
                  min="0"
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  placeholder="0"
                />
                <InputField
                  label="Low Stock Alert"
                  type="number"
                  min="0"
                  value={lowStockAlert}
                  onChange={(e) => setLowStockAlert(e.target.value)}
                  placeholder="Alert threshold"
                />
              </div>
            </Disclosure>
          )}

          <Disclosure
            label="Unit Variants"
            count={unitVariants.filter((v) => v.unit && v.salePrice).length}
          >
            <div className="space-y-2">
              {unitVariants.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_90px_28px] gap-2 items-end">
                  <InputField
                    label={i === 0 ? "Unit Name" : ""}
                    value={v.unit}
                    onChange={(e) => updateVariant(i, "unit", e.target.value)}
                    placeholder="e.g. pack, box"
                  />
                  <InputField
                    label={i === 0 ? `Per ${unit}` : ""}
                    type="number"
                    min="0.01"
                    step="any"
                    value={String(v.conversionFactor)}
                    onChange={(e) => updateVariant(i, "conversionFactor", e.target.value)}
                    placeholder="e.g. 5"
                  />
                  <InputField
                    label={i === 0 ? "Sale Price (₹)" : ""}
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.salePrice}
                    onChange={(e) => updateVariant(i, "salePrice", e.target.value)}
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    className={cn(
                      "p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 transition-colors",
                      i === 0 ? "mb-0.5" : ""
                    )}
                    aria-label="Remove variant"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setUnitVariants([...unitVariants, { unit: "", conversionFactor: 1, salePrice: "" }])}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
              >
                + Add unit variant
              </button>
              {unitVariants.length > 0 && unit && (
                <p className="text-[11px] text-text-tertiary mt-1">
                  Base unit: {unit.toUpperCase()}. Each variant price is per that variant unit.
                </p>
              )}
            </div>
          </Disclosure>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border-light">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={updateMutation.isPending || !name.trim()}
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Item Detail Panel ────────────────────────────────────────────

const DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "prices", label: "Price History" },
  { value: "stock", label: "Stock History" },
  { value: "invoices", label: "Invoices" },
  { value: "buyers", label: "Top Buyers" },
];

function ItemDetailPanel({ itemId, onClose, onEdit }: { itemId: string; onClose: () => void; onEdit: (id: string) => void }) {
  const [tab, setTab] = useState("overview");
  const [showMerge, setShowMerge] = useState(false);
  const navigate = useNavigate();

  const { data: item } = trpc.item.getById.useQuery({ id: itemId });
  const { data: priceHistory } = trpc.item.priceHistory.useQuery(
    { id: itemId },
    { enabled: tab === "prices" || tab === "overview" }
  );
  const { data: stockMovements } = trpc.item.stockMovements.useQuery(
    { id: itemId },
    { enabled: tab === "stock" }
  );
  const { data: relatedInvoices } = trpc.item.relatedInvoices.useQuery(
    { id: itemId, page: 1, limit: 20 },
    { enabled: tab === "invoices" }
  );
  const { data: topBuyers } = trpc.item.topBuyers.useQuery(
    { id: itemId },
    { enabled: tab === "buyers" || tab === "overview" }
  );

  if (!item) return null;

  const isLow = item.lowStockAlert &&
    parseFloat(item.stockQuantity) <= parseFloat(item.lowStockAlert);

  return (
    <>
    <SlideOver
      open={true}
      onClose={onClose}
      title={item.name}
      description={
        [
          item.itemType === "service" ? "Service" : "Product",
          item.sku ? `SKU: ${item.sku}` : null,
          item.hsn ? `HSN: ${item.hsn}` : null,
        ].filter(Boolean).join(" · ")
      }
      footer={
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowMerge(true)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-800 transition-colors"
          >
            Merge
          </button>
          <button
            onClick={() => {
              onClose();
              onEdit(item.id);
            }}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
          >
            Edit Item
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tabs */}
        <PillTabs tabs={DETAIL_TABS} value={tab} onChange={setTab} />

        {/* ── Overview ─────────────────────────────────────── */}
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Key metrics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Sale Price</p>
                <p className="text-lg font-bold tabular-nums text-text-primary mt-1">
                  {item.salePrice ? formatCurrency(item.salePrice) : "—"}
                </p>
                {item.taxInclusive && (
                  <p className="text-[11px] text-text-tertiary">Incl. tax</p>
                )}
              </div>
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Purchase Price</p>
                <p className="text-lg font-bold tabular-nums text-text-primary mt-1">
                  {item.purchasePrice ? formatCurrency(item.purchasePrice) : "—"}
                </p>
              </div>
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Stock</p>
                <p className={cn(
                  "text-lg font-bold tabular-nums mt-1",
                  isLow ? "text-amber-600" : "text-text-primary"
                )}>
                  {parseFloat(item.stockQuantity).toLocaleString()} {item.unit}
                </p>
                {isLow && (
                  <p className="text-[11px] text-amber-600 font-medium">Low stock</p>
                )}
              </div>
            </div>

            {/* Details grid */}
            <div className="rounded-xl border border-border-light overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["Category", item.category || "—"],
                    ["Tax %", `${item.taxPercent}%`],
                    ["Unit", item.unit.toUpperCase()],
                    ["Low Stock Alert", item.lowStockAlert ?? "—"],
                    ["Description", item.description || "—"],
                  ].map(([label, value]) => (
                    <tr key={label} className="border-b border-border-light last:border-0">
                      <td className="px-4 py-2.5 text-text-tertiary font-medium w-40">{label}</td>
                      <td className="px-4 py-2.5 text-text-primary">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Unit Variants */}
            {item.unitVariants && Array.isArray(item.unitVariants) && item.unitVariants.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">Unit Variants</p>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Unit</th>
                        <th className="text-right">Per {item.unit.toUpperCase()}</th>
                        <th className="text-right">Sale Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(item.unitVariants as any[]).map((v: any, i: number) => (
                        <tr key={i}>
                          <td className="font-medium">{v.unit}</td>
                          <td className="text-right tabular-nums text-text-secondary">{v.conversionFactor}</td>
                          <td className="text-right tabular-nums font-medium">{formatCurrency(v.salePrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent price history preview */}
            {priceHistory && priceHistory.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">Recent Prices</p>
                  <button
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => setTab("prices")}
                  >
                    View all
                  </button>
                </div>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Party</th>
                        <th className="text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceHistory.slice(0, 5).map((h, i) => (
                        <tr key={i}>
                          <td className="text-text-secondary text-xs">{formatDate(h.invoiceDate)}</td>
                          <td className="capitalize text-text-secondary text-xs">{h.invoiceType}</td>
                          <td className="text-xs">{h.partyName}</td>
                          <td className="text-right tabular-nums font-medium">{formatCurrency(h.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top buyers preview */}
            {topBuyers && topBuyers.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-secondary">Top Buyers</p>
                  <button
                    className="text-xs text-brand-600 hover:underline"
                    onClick={() => setTab("buyers")}
                  >
                    View all
                  </button>
                </div>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Party</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topBuyers.slice(0, 3).map((b) => (
                        <tr key={b.partyId}>
                          <td className="text-xs font-medium">{b.partyName}</td>
                          <td className="text-right tabular-nums text-text-secondary text-xs">{parseFloat(b.totalQuantity).toLocaleString()}</td>
                          <td className="text-right tabular-nums font-medium text-xs">{formatCurrency(b.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Price History ─────────────────────────────────── */}
        {tab === "prices" && (
          <div>
            {!priceHistory?.length ? (
              <EmptyState
                title="No price history"
                description="Prices will appear here as this item is used in invoices."
              />
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Invoice</th>
                      <th>Type</th>
                      <th>Party</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit</th>
                      <th className="text-right">Unit Price</th>
                      <th className="text-right">Base Price</th>
                      <th className="text-right">Tax %</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map((h, i) => (
                      <tr key={i}>
                        <td className="text-text-secondary text-xs">{formatDate(h.invoiceDate)}</td>
                        <td className="font-mono text-[13px] text-text-secondary">{h.invoiceNumber}</td>
                        <td>
                          <span className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                            h.invoiceType === "sale"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                              : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                          )}>
                            {h.invoiceType === "sale" ? "Sale" : "Purchase"}
                          </span>
                        </td>
                        <td className="text-xs">{h.partyName}</td>
                        <td className="text-right tabular-nums text-text-secondary">{h.quantity}</td>
                        <td className="text-right text-text-secondary text-xs">
                          {h.selectedUnit?.toUpperCase() || item.unit.toUpperCase()}
                        </td>
                        <td className="text-right tabular-nums font-medium">{formatCurrency(h.unitPrice)}</td>
                        <td className="text-right tabular-nums text-text-tertiary text-xs">
                          {h.conversionFactor && parseFloat(h.conversionFactor) > 1
                            ? `₹${(parseFloat(h.unitPrice) / parseFloat(h.conversionFactor)).toFixed(2)}/${item.unit}`
                            : "—"}
                        </td>
                        <td className="text-right tabular-nums text-text-secondary">{h.taxPercent}%</td>
                        <td className="text-right tabular-nums font-medium">{formatCurrency(h.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Stock History ─────────────────────────────────── */}
        {tab === "stock" && (
          <div>
            {!stockMovements?.length ? (
              <EmptyState
                title="No stock movements"
                description="Stock changes will appear here as invoices are created."
              />
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Invoice</th>
                      <th>Party</th>
                      <th>Type</th>
                      <th className="text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockMovements.map((m, i) => (
                      <tr
                        key={i}
                        className="cursor-pointer"
                        onClick={() => {
                          onClose();
                          navigate({ to: "/invoices" });
                        }}
                      >
                        <td className="text-text-secondary text-xs">{formatDate(m.invoiceDate)}</td>
                        <td className="font-mono text-[13px] text-brand-600 hover:underline">{m.invoiceNumber}</td>
                        <td className="text-xs">{m.partyName}</td>
                        <td>
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[11px] font-medium",
                            m.direction === "out" ? "text-red-600" : "text-emerald-600"
                          )}>
                            {m.direction === "out" ? "↓" : "↑"}
                            {m.direction === "out" ? "Out" : "In"}
                          </span>
                        </td>
                        <td className={cn(
                          "text-right tabular-nums font-medium",
                          m.direction === "out" ? "text-red-600" : "text-emerald-600"
                        )}>
                          {m.direction === "out" ? "-" : "+"}{m.quantity}
                          {m.selectedUnit && m.selectedUnit !== item.unit && (
                            <span className="text-text-tertiary text-[10px] ml-1">
                              ({m.selectedUnit})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Invoices ─────────────────────────────────────── */}
        {tab === "invoices" && (
          <div>
            {!relatedInvoices?.data.length ? (
              <EmptyState
                title="No invoices"
                description="This item hasn't been used in any invoices yet."
              />
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th>Party</th>
                      <th>Status</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatedInvoices.data.map((inv) => (
                      <tr
                        key={inv.id}
                        className="cursor-pointer"
                        onClick={() => {
                          onClose();
                          navigate({ to: "/invoices" });
                        }}
                      >
                        <td className="font-mono text-[13px] text-brand-600 hover:underline">{inv.invoiceNumber}</td>
                        <td className="text-text-secondary text-xs">{formatDate(inv.invoiceDate)}</td>
                        <td className="text-xs font-medium">{inv.partyName}</td>
                        <td><StatusBadge status={inv.status} size="sm" /></td>
                        <td className="text-right tabular-nums font-medium">{formatCurrency(inv.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {relatedInvoices.total > relatedInvoices.data.length && (
                  <div className="px-4 py-2 text-center text-xs text-text-tertiary bg-surface-1">
                    Showing {relatedInvoices.data.length} of {relatedInvoices.total}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Top Buyers ───────────────────────────────────── */}
        {tab === "buyers" && (
          <div>
            {!topBuyers?.length ? (
              <EmptyState
                title="No buyers yet"
                description="Buyer data will appear here as this item is used in invoices."
              />
            ) : (
              <div className="rounded-xl border border-border-light overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Party</th>
                      <th>Type</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Invoices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topBuyers.map((b, i) => (
                      <tr
                        key={b.partyId}
                        className="cursor-pointer"
                        onClick={() => {
                          onClose();
                          navigate({ to: "/parties" });
                        }}
                      >
                        <td>
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 text-[10px] font-bold text-text-tertiary">
                            {i + 1}
                          </span>
                        </td>
                        <td className="font-medium">{b.partyName}</td>
                        <td>
                          <span className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                            b.partyType === "customer"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                              : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                          )}>
                            {b.partyType === "customer" ? "Customer" : "Supplier"}
                          </span>
                        </td>
                        <td className="text-right tabular-nums text-text-secondary">
                          {parseFloat(b.totalQuantity).toLocaleString()}
                        </td>
                        <td className="text-right tabular-nums font-medium">
                          {formatCurrency(b.totalAmount)}
                        </td>
                        <td className="text-right">
                          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-surface-2 text-[11px] font-medium text-text-secondary">
                            {b.invoiceCount}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOver>
    {showMerge && (
      <MergeItemModal
        sourceId={itemId}
        sourceName={item.name}
        sourceUnit={item.unit}
        onClose={() => {
          setShowMerge(false);
          onClose();
        }}
      />
    )}
    </>
  );
}

function MergeItemModal({
  sourceId,
  sourceName,
  sourceUnit,
  onClose,
}: {
  sourceId: string;
  sourceName: string;
  sourceUnit: string;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [conversionFactor, setConversionFactor] = useState("1");
  const { data: itemsData } = trpc.item.list.useQuery({ page: 1, limit: 500 });
  const utils = trpc.useUtils();

  const targetItem = itemsData?.data.find((i) => i.id === targetId);
  const needsConversion = !!targetItem && targetItem.unit !== sourceUnit;

  const mergeMutation = trpc.item.merge.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      toast.success(`"${sourceName}" merged successfully`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const targetOptions = (itemsData?.data || []).filter((i) => i.id !== sourceId);

  return (
    <Modal open={true} onClose={onClose} title={`Merge "${sourceName}"`} className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          All invoices and stock from <strong>{sourceName}</strong> ({sourceUnit.toUpperCase()}) will be transferred to the target item. The source item will be deleted.
        </p>

        <div>
          <label className="text-sm font-medium text-text-primary block mb-1">
            Merge into <span className="text-red-500">*</span>
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="input-field w-full"
          >
            <option value="">Select target item...</option>
            {targetOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit.toUpperCase()}{i.salePrice ? ` — ₹${i.salePrice}` : ""})
              </option>
            ))}
          </select>
        </div>

        {needsConversion && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
              Units differ: {sourceName} uses {sourceUnit.toUpperCase()}, target uses {targetItem.unit.toUpperCase()}
            </p>
            <InputField
              label={`1 ${sourceUnit.toUpperCase()} = ? ${targetItem.unit.toUpperCase()}`}
              type="number"
              step="any"
              min="0.001"
              value={conversionFactor}
              onChange={(e) => setConversionFactor(e.target.value)}
              placeholder="Conversion factor"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              Stock and invoice quantities will be converted using this factor.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-border-light">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-danger"
            onClick={() =>
              mergeMutation.mutate({
                sourceId,
                targetId,
                stockConversionFactor: parseFloat(conversionFactor) || 1,
              })
            }
            disabled={!targetId || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? "Merging..." : "Merge & Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
