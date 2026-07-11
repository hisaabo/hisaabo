import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn, downloadCSV, todayISODate, toISOString } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { usePermissions } from "@/hooks/usePermissions";
import type { ItemType, ItemMode } from "@hisaabo/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedControl, PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Listbox } from "@/components/ui/Listbox";
import { Combobox } from "@/components/ui/Combobox";
import { Disclosure } from "@/components/ui/Disclosure";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { Pagination } from "@/components/ui/Pagination";
import { UnitVariantEditor } from "@/components/UnitVariantEditor";
import {
  type UiUnitVariant,
  recomputeOnBasePriceChange,
  toPayloadVariant,
} from "@/lib/unit-variant-derivation";

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
  { value: "pkt", label: "Packet (PKT)" },
  { value: "bun", label: "Bunch (BUN)" },
  { value: "pouch", label: "Pouch" },
  { value: "jar", label: "Jar" },
  { value: "btl", label: "Bottle (BTL)" },
  { value: "bag", label: "Bag" },
  { value: "ton", label: "Tonne (TON)" },
  { value: "pack", label: "Pack" },
  { value: "pet", label: "Pet Bottle (PET)" },
  { value: "person", label: "Person" },
  { value: "other", label: "Other" },
];

// Unit categories — used to filter alt unit dropdowns so you don't see "metres" for a "kg" product
const UNIT_CATEGORIES: Record<string, string[]> = {
  weight:    ["kg", "g", "ton"],
  volume:    ["l", "ml"],
  length:    ["m", "cm", "ft", "in"],
  packaging: ["box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "pack", "pet"],
  counting:  ["pcs", "person"],
  other:     ["other"],
};

// Given a base unit, return which UNIT_OPTIONS are valid as alt units:
// same measurement category + packaging (you can always sell weight/volume in boxes, bags, etc.)
function getCompatibleAltUnits(baseUnit: string) {
  const baseCategory = Object.entries(UNIT_CATEGORIES).find(([, units]) => units.includes(baseUnit))?.[0] || "other";
  const compatible = new Set<string>();

  // Same category (e.g., kg → g, ton)
  for (const u of UNIT_CATEGORIES[baseCategory] || []) compatible.add(u);

  // Packaging is always compatible (a "5kg bag" or "250ml bottle" makes sense)
  for (const u of UNIT_CATEGORIES.packaging) compatible.add(u);

  // If base is packaging/counting, also allow weight, volume, and counting
  // (e.g., a "box" of strawberries can also be sold by kg)
  if (baseCategory === "packaging" || baseCategory === "counting") {
    for (const u of UNIT_CATEGORIES.weight) compatible.add(u);
    for (const u of UNIT_CATEGORIES.volume) compatible.add(u);
    for (const u of UNIT_CATEGORIES.counting) compatible.add(u);
  }

  // "other" is always available
  compatible.add("other");

  // Never include the base unit itself
  compatible.delete(baseUnit);

  return UNIT_OPTIONS.filter((o) => compatible.has(o.value));
}

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
  const deleteConfirm = useDeleteConfirmation();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { can } = usePermissions();

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

  async function fetchAllItems() {
    let allData: any[] = [];
    let pg = 1;
    let hasMore = true;
    while (hasMore) {
      const result = await utils.item.list.fetch({
        search: debouncedSearch || undefined,
        lowStock: showLowStock || undefined,
        page: pg,
        limit: 100,
      });
      allData = [...allData, ...result.data];
      hasMore = allData.length < result.total;
      pg++;
    }
    // Apply client-side type filter
    return allData.filter((item: any) => {
      if (typeFilter === "all") return true;
      return item.itemType === typeFilter;
    });
  }

  async function exportItemsCSV(mode: "simple" | "alt_units" | "variants" | "all" = "all") {
    setExporting(true);
    try {
      const filtered = await fetchAllItems();

      if (mode === "all") {
        const headers = ["Name", "Type", "Mode", "SKU", "HSN", "Sale Price", "Purchase Price", "Stock", "Unit", "Category"];
        const rows = filtered.map((item: any) => [
          item.name, item.itemType, item.itemMode || "simple",
          item.sku || "", item.hsn || "",
          item.salePrice || "", item.purchasePrice || "",
          item.itemMode === "variants" ? (item.variantTotalStock || "0") : item.stockQuantity,
          item.unit, item.category || "",
        ]);
        downloadCSV(`items_all`, headers, rows);
      } else if (mode === "simple") {
        const simple = filtered.filter((i: any) => !i.itemMode || i.itemMode === "simple");
        const headers = ["Name", "Type", "SKU", "HSN", "Sale Price", "Purchase Price", "Stock", "Unit", "Category"];
        const rows = simple.map((item: any) => [
          item.name, item.itemType, item.sku || "", item.hsn || "",
          item.salePrice || "", item.purchasePrice || "",
          item.stockQuantity, item.unit, item.category || "",
        ]);
        downloadCSV(`items_simple`, headers, rows);
      } else if (mode === "alt_units") {
        const altItems = filtered.filter((i: any) => i.itemMode === "alt_units");
        const headers = ["Name", "Type", "SKU", "HSN", "Base Unit", "Base Sale Price", "Base Purchase Price",
          "Stock (base)", "Category", "Alt Unit", "Conversion Factor", "Alt Sale Price"];
        const rows: string[][] = [];
        for (const item of altItems) {
          // Base row
          rows.push([
            item.name, item.itemType, item.sku || "", item.hsn || "",
            item.unit, item.salePrice || "", item.purchasePrice || "",
            item.stockQuantity, item.category || "", "", "", "",
          ]);
          // Unit variant sub-rows
          for (const uv of (item.unitVariants || [])) {
            rows.push([
              "", "", "", "", "", "", "", "", "",
              uv.unit, String(uv.conversionFactor), uv.salePrice,
            ]);
          }
        }
        downloadCSV(`items_alt_units`, headers, rows);
      } else if (mode === "variants") {
        // For variant items, we need to fetch each item's variants
        const variantItems = filtered.filter((i: any) => i.itemMode === "variants");
        const allAttrs = new Set<string>();
        const variantDataMap: Record<string, any[]> = {};
        for (const item of variantItems) {
          for (const attr of (item.variantAttributes || [])) allAttrs.add(attr);
          try {
            const variants = await utils.item.listVariants.fetch({ itemId: item.id });
            variantDataMap[item.id] = variants;
          } catch { variantDataMap[item.id] = []; }
        }
        const attrCols = [...allAttrs];
        const headers = ["Parent Item", ...attrCols, "SKU", "Sale Price", "Purchase Price", "Stock", "Category"];
        const rows: string[][] = [];
        for (const item of variantItems) {
          for (const v of (variantDataMap[item.id] || [])) {
            const attrs = v.attributeValues as Record<string, string>;
            rows.push([
              item.name,
              ...attrCols.map((a) => attrs[a] || ""),
              v.sku || "", v.salePrice || item.salePrice || "", v.purchasePrice || item.purchasePrice || "",
              v.stockQuantity || "0", item.category || "",
            ]);
          }
        }
        downloadCSV(`items_variants`, headers, rows);
      }
    } finally {
      setExporting(false);
    }
  }

  const deleteMutation = trpc.item.delete.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      deleteConfirm.cancelDelete();
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
          can("create", "Item") ? (
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => setShowAddModal(true)}
            >
              + Add Item
              <KbdShortcut keys={["N"]} className="opacity-60" />
            </button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
        <div className="ml-auto relative">
          {data && data.total > 0 && (
            <div className="relative group">
              <button
                disabled={exporting}
                className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0"
                onClick={() => exportItemsCSV("all")}
              >
                {exporting ? (
                  <>
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Preparing...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                    </svg>
                    Export CSV
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </>
                )}
              </button>
              <div className="absolute right-0 top-full mt-1 bg-surface-0 border border-border-color rounded-lg shadow-elevated py-1 hidden group-hover:block z-10 min-w-[160px]">
                <button onClick={() => exportItemsCSV("all")} disabled={exporting} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-1 transition-colors">All Items</button>
                <button onClick={() => exportItemsCSV("simple")} disabled={exporting} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-1 transition-colors">Simple Items</button>
                <button onClick={() => exportItemsCSV("alt_units")} disabled={exporting} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-1 transition-colors">Alt Unit Items</button>
                <button onClick={() => exportItemsCSV("variants")} disabled={exporting} className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-1 transition-colors">Variant Items</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <SkeletonRows count={5} height="h-12" />
      ) : !filteredItems.length ? (
        <EmptyState
          title="No items found"
          description="Add products or services to start creating invoices."
          encouragement="Your inventory is empty. Add your first product to start billing."
          action={
            can("create", "Item") ? (
              <button className="btn-primary" onClick={() => setShowAddModal(true)}>
                + Add Item
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Sale Price</th>
                <th className="text-right">Stock</th>
                <th>Unit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const isLow =
                  item.itemMode !== "variants" &&
                  item.lowStockAlert &&
                  parseFloat(item.stockQuantity) <= parseFloat(item.lowStockAlert);
                return (
                  <tr key={item.id} className="group cursor-pointer" onClick={() => setSelectedItemId(item.id)}>
                    <td>
                      <div className="flex items-center gap-2">
                        {item.itemType === "service" && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400 shrink-0">
                            SVC
                          </span>
                        )}
                        {item.itemMode === "variants" && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400 shrink-0">
                            VAR
                          </span>
                        )}
                        <div>
                          <p className="font-medium">{item.name}</p>
                          {item.sku && (
                            <p className="text-xs text-text-tertiary">SKU: {item.sku}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-right tabular-nums">
                      {item.itemMode === "variants" ? (
                        <span className="text-text-secondary text-xs">{(item as any).variantCount ?? 0} variants</span>
                      ) : (
                        item.salePrice ? formatCurrency(item.salePrice) : "—"
                      )}
                    </td>
                    <td
                      className={cn(
                        "text-right tabular-nums font-medium",
                        isLow ? "text-amber-600" : ""
                      )}
                    >
                      {item.itemMode === "variants"
                        ? ((item as any).variantTotalStock ? parseFloat((item as any).variantTotalStock).toLocaleString() : "0")
                        : parseFloat(item.stockQuantity).toLocaleString()
                      }
                    </td>
                    <td className="text-text-secondary text-xs">{item.unit}</td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      {can("delete", "Item") && (
                      <button
                        className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => deleteConfirm.requestDelete(item.id, item.name)}
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
                      )}
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
      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Item"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteConfirm.deleteTarget) deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id });
        }}
        onCancel={deleteConfirm.cancelDelete}
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
  const [unitVariants, setUnitVariants] = useState<UiUnitVariant[]>([]);
  const [variantAttributes, setVariantAttributes] = useState<string[]>([]);
  const [variantRows, setVariantRows] = useState<Array<{ attributeValues: Record<string, string>; sku: string; salePrice: string; purchasePrice: string; stockQuantity: string }>>([]);
  const [newAttrName, setNewAttrName] = useState("");
  const [attrValues, setAttrValues] = useState<Record<string, string[]>>({});
  const [newAttrValue, setNewAttrValue] = useState<Record<string, string>>({});

  // Changing the base price re-derives every non-manual alt-unit row.
  // Manual rows get a "stale base price" marker so the editor can show
  // a recompute affordance instead of silently overwriting the user.
  function handleSalePriceChange(next: string) {
    setSalePrice(next);
    setUnitVariants((prev) => recomputeOnBasePriceChange(prev, next));
  }

  function removeUnitVariant(idx: number) {
    setUnitVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  function addUnitVariant() {
    setUnitVariants((prev) => [
      ...prev,
      { unit: "", conversionFactor: 1, salePrice: "" },
    ]);
  }

  // Variant attribute helpers
  function addAttribute() {
    if (!newAttrName.trim() || variantAttributes.includes(newAttrName.trim())) return;
    setVariantAttributes((p) => [...p, newAttrName.trim()]);
    setNewAttrName("");
  }
  function removeAttribute(attr: string) {
    setVariantAttributes((p) => p.filter((a) => a !== attr));
    setAttrValues((p) => { const c = { ...p }; delete c[attr]; return c; });
    setVariantRows((p) => p.map((r) => {
      const av = { ...r.attributeValues };
      delete av[attr];
      return { ...r, attributeValues: av };
    }));
  }
  function addAttrValue(attr: string) {
    const val = (newAttrValue[attr] || "").trim();
    if (!val || (attrValues[attr] || []).includes(val)) return;
    setAttrValues((p) => ({ ...p, [attr]: [...(p[attr] || []), val] }));
    setNewAttrValue((p) => ({ ...p, [attr]: "" }));
  }
  function removeAttrValue(attr: string, val: string) {
    setAttrValues((p) => ({ ...p, [attr]: (p[attr] || []).filter((v) => v !== val) }));
  }
  function generateVariants() {
    const attrs = variantAttributes.filter((a) => (attrValues[a] || []).length > 0);
    if (attrs.length === 0) return;
    let combos: Record<string, string>[] = [{}];
    for (const attr of attrs) {
      const values = attrValues[attr] || [];
      const next: Record<string, string>[] = [];
      for (const combo of combos) {
        for (const val of values) {
          next.push({ ...combo, [attr]: val });
        }
      }
      combos = next;
    }
    const existing = new Set(variantRows.map((r) => JSON.stringify(r.attributeValues)));
    const newRows = combos
      .filter((c) => !existing.has(JSON.stringify(c)))
      .map((c) => ({ attributeValues: c, sku: "", salePrice: "", purchasePrice: "", stockQuantity: "0" }));
    setVariantRows((p) => [...p, ...newRows]);
  }
  function addManualVariantRow() {
    const emptyAttrs: Record<string, string> = {};
    variantAttributes.forEach((a) => (emptyAttrs[a] = ""));
    setVariantRows((p) => [...p, { attributeValues: emptyAttrs, sku: "", salePrice: "", purchasePrice: "", stockQuantity: "0" }]);
  }
  function updateVariantRow(idx: number, field: string, value: string) {
    setVariantRows((p) => p.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function removeVariantRow(idx: number) {
    setVariantRows((p) => p.filter((_, i) => i !== idx));
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
    setVariantAttributes([]);
    setVariantRows([]);
    setNewAttrName("");
    setAttrValues({});
    setNewAttrValue({});
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  // Derive itemMode from what the user has configured (no explicit selector needed)
  const derivedMode: ItemMode = itemType === "service" ? "simple"
    : variantAttributes.length > 0 ? "variants"
    : unitVariants.some((v) => v.unit && v.salePrice) ? "alt_units"
    : "simple";

  function handleCreate() {
    const validUnitVariants = unitVariants
      .filter((v) => v.unit && v.salePrice)
      .map(toPayloadVariant);
    const effectiveMode = derivedMode;
    createMutation.mutate({
      itemType,
      itemMode: effectiveMode,
      name,
      sku: sku || undefined,
      category: category || undefined,
      hsn: hsn || undefined,
      salePrice: salePrice || undefined,
      purchasePrice: purchasePrice || undefined,
      taxPercent,
      taxInclusive,
      stockQuantity: effectiveMode === "variants" ? "0" : stockQuantity,
      lowStockAlert: lowStockAlert || undefined,
      unit: unit as any,
      unitVariants: effectiveMode === "alt_units" && validUnitVariants.length > 0 ? validUnitVariants : undefined,
      variantAttributes: effectiveMode === "variants" && variantAttributes.length > 0 ? variantAttributes : undefined,
      variants: effectiveMode === "variants" && variantRows.length > 0
        ? variantRows.map((r) => ({
            attributeValues: r.attributeValues,
            sku: r.sku || undefined,
            salePrice: r.salePrice || undefined,
            purchasePrice: r.purchasePrice || undefined,
            stockQuantity: r.stockQuantity || "0",
          }))
        : undefined,
    });
  }

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Add Item"
      description="Add a new product or service"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={handleClose} disabled={createMutation.isPending}>
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
      }
    >
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
            label={derivedMode === "variants" ? "Default Price (₹)" : "Sale Price (₹)"}
            type="number"
            step="0.01"
            min="0"
            value={salePrice}
            onChange={(e) => handleSalePriceChange(e.target.value)}
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

        {/* Unit — hidden for variants (variants don't use unit conversion) */}
        {derivedMode !== "variants" && (
          <Listbox
            label="Unit"
            value={unit}
            onChange={setUnit}
            options={UNIT_OPTIONS}
            placeholder="Select unit"
          />
        )}

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

          {itemType === "product" && derivedMode !== "variants" && (
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

          {itemType === "product" && derivedMode !== "variants" && (
            <Disclosure
              label="Alternate Units"
              count={unitVariants.filter((v) => v.unit && v.salePrice).length}
            >
              <div className="space-y-2">
                <UnitVariantEditor
                  variants={unitVariants}
                  onChange={setUnitVariants}
                  baseUnit={unit}
                  basePrice={salePrice}
                  getAvailableUnits={(rowIndex) => {
                    const usedUnits = new Set(
                      unitVariants.filter((_, j) => j !== rowIndex).map((uv) => uv.unit),
                    );
                    return getCompatibleAltUnits(unit).filter((o) => !usedUnits.has(o.value));
                  }}
                  onRemoveRow={removeUnitVariant}
                  onAddRow={addUnitVariant}
                />
                {unitVariants.some((v) => v.unit && v.salePrice) && (
                  <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-1">
                    Adding alternate units makes this an alt-unit product.
                  </p>
                )}
              </div>
            </Disclosure>
          )}

          {itemType === "product" && derivedMode !== "alt_units" && (
            <>
              <Disclosure label="Product Variants" count={variantAttributes.length}>
                <div className="space-y-4">
                  {/* Defined attributes with their values */}
                  {variantAttributes.map((attr) => (
                    <div key={attr} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-primary">{attr}</span>
                        <button
                          type="button"
                          onClick={() => removeAttribute(attr)}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 transition-colors"
                          aria-label={`Remove ${attr}`}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M4 4l8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(attrValues[attr] || []).map((val) => (
                          <span
                            key={val}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-1 border border-border-light text-xs font-medium text-text-primary"
                          >
                            {val}
                            <button
                              type="button"
                              onClick={() => removeAttrValue(attr, val)}
                              className="text-text-tertiary hover:text-red-500 transition-colors"
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M4 4l8 8M12 4l-8 8" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                        <InputField
                          label=""
                          value={newAttrValue[attr] || ""}
                          onChange={(e) => setNewAttrValue((p) => ({ ...p, [attr]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttrValue(attr); } }}
                          placeholder={`Add ${attr} value and press Enter`}
                        />
                        <button
                          type="button"
                          onClick={() => addAttrValue(attr)}
                          className="px-3 py-2 rounded-lg text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950 dark:hover:bg-brand-900 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add new attribute */}
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <InputField
                      label={variantAttributes.length === 0 ? "Attribute Name" : ""}
                      value={newAttrName}
                      onChange={(e) => setNewAttrName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAttribute(); } }}
                      placeholder="e.g. Size, Color, Material"
                    />
                    <button
                      type="button"
                      onClick={addAttribute}
                      className={cn(
                        "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                        "text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950 dark:hover:bg-brand-900",
                      )}
                    >
                      + Add
                    </button>
                  </div>

                  {variantAttributes.length > 0 && (
                    <p className="text-[11px] text-purple-600 dark:text-purple-400">
                      Adding variant attributes makes this a variant product. Stock and pricing are tracked per variant.
                    </p>
                  )}
                </div>
              </Disclosure>

              {/* Generated variants table */}
              {variantAttributes.length > 0 && Object.values(attrValues).some((v) => v.length > 0) && (
                <Disclosure label="Variants" count={variantRows.length} defaultOpen>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={generateVariants}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950 dark:hover:bg-brand-900 transition-colors"
                    >
                      Generate All Combinations
                    </button>
                    {variantRows.length > 0 && (
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border-light">
                              {variantAttributes.map((a) => (
                                <th key={a} className="text-left px-2 py-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">{a}</th>
                              ))}
                              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">SKU</th>
                              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Price</th>
                              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Stock</th>
                              <th className="w-7"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-light">
                            {variantRows.map((row, i) => (
                              <tr key={i} className="group">
                                {variantAttributes.map((a) => (
                                  <td key={a} className="px-2 py-1.5 text-text-secondary font-medium">{row.attributeValues[a] || "—"}</td>
                                ))}
                                <td className="px-2 py-1.5">
                                  <input
                                    className="input w-20 text-xs"
                                    value={row.sku}
                                    onChange={(e) => updateVariantRow(i, "sku", e.target.value)}
                                    placeholder="SKU"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    className="input w-20 text-xs text-right tabular-nums"
                                    type="number"
                                    step="0.01"
                                    value={row.salePrice}
                                    onChange={(e) => updateVariantRow(i, "salePrice", e.target.value)}
                                    placeholder={salePrice || "0.00"}
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <input
                                    className="input w-16 text-xs text-right tabular-nums"
                                    type="number"
                                    value={row.stockQuantity}
                                    onChange={(e) => updateVariantRow(i, "stockQuantity", e.target.value)}
                                    placeholder="0"
                                  />
                                </td>
                                <td className="px-2 py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => removeVariantRow(i)}
                                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                    aria-label="Remove variant"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                      <path d="M4 4l8 8M12 4l-8 8" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={addManualVariantRow}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                    >
                      + Add variant manually
                    </button>
                    {variantRows.length > 0 && (
                      <p className="text-[11px] text-text-tertiary">
                        {variantRows.length} variant{variantRows.length !== 1 ? "s" : ""} defined. Leave price blank to use the default price above.
                      </p>
                    )}
                  </div>
                </Disclosure>
              )}
            </>
          )}
        </div>

      </div>
    </SlideOver>
  );
}

// ── Edit Item Modal ──────────────────────────────────────────────

function EditItemModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { data: item } = trpc.item.getById.useQuery({ id: itemId });
  const utils = trpc.useUtils();
  const { can } = usePermissions();

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
  const [unitVariants, setUnitVariants] = useState<UiUnitVariant[]>([]);
  const [itemMode, setItemMode] = useState<ItemMode>("simple");
  const [initialized, setInitialized] = useState(false);

  // Variant editing state (for inline editing of existing variants)
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editVariantData, setEditVariantData] = useState<{ sku: string; salePrice: string; purchasePrice: string; stockQuantity: string }>({ sku: "", salePrice: "", purchasePrice: "", stockQuantity: "0" });
  const [newVariantAttrs, setNewVariantAttrs] = useState<Record<string, string>>({});
  const [newVariantSku, setNewVariantSku] = useState("");
  const [newVariantSalePrice, setNewVariantSalePrice] = useState("");
  const [newVariantStock, setNewVariantStock] = useState("0");
  const [showAddVariant, setShowAddVariant] = useState(false);

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
    setItemMode((item.itemMode as ItemMode) ?? "simple");
    setInitialized(true);
  }, [item, initialized]);

  // Changing the base price re-derives every non-manual alt-unit row.
  // Manual rows stay frozen but get a "stale base price" marker so the
  // editor can surface a recompute affordance.
  function handleSalePriceChange(next: string) {
    setSalePrice(next);
    setUnitVariants((prev) => recomputeOnBasePriceChange(prev, next));
  }

  function removeUnitVariant(idx: number) {
    setUnitVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  function addUnitVariant() {
    setUnitVariants((prev) => [
      ...prev,
      { unit: "", conversionFactor: 1, salePrice: "" },
    ]);
  }

  const renameUnitMut = trpc.item.renameUnit.useMutation();

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

  const createVariantMutation = trpc.item.createVariant.useMutation({
    onSuccess: () => {
      utils.item.getById.invalidate({ id: itemId });
      utils.item.list.invalidate();
      toast.success("Variant added");
      setShowAddVariant(false);
      setNewVariantAttrs({});
      setNewVariantSku("");
      setNewVariantSalePrice("");
      setNewVariantStock("0");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateVariantMutation = trpc.item.updateVariant.useMutation({
    onSuccess: () => {
      utils.item.getById.invalidate({ id: itemId });
      utils.item.list.invalidate();
      toast.success("Variant updated");
      setEditingVariantId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteVariantMutation = trpc.item.deleteVariant.useMutation({
    onSuccess: () => {
      utils.item.getById.invalidate({ id: itemId });
      utils.item.list.invalidate();
      toast.success("Variant deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  async function handleSave() {
    if (item) {
      // Cascade unit renames to invoices before updating the item
      const renames: Array<{ oldUnit: string; newUnit: string }> = [];

      // Base unit rename
      if (unit !== item.unit) {
        renames.push({ oldUnit: item.unit, newUnit: unit });
      }

      // Alt unit renames (match by position — user can only change the unit name, not reorder)
      const oldVariants = (item.unitVariants as Array<{ unit: string }>) || [];
      for (let i = 0; i < Math.min(oldVariants.length, unitVariants.length); i++) {
        if (unitVariants[i].unit && oldVariants[i].unit !== unitVariants[i].unit) {
          renames.push({ oldUnit: oldVariants[i].unit, newUnit: unitVariants[i].unit });
        }
      }

      for (const r of renames) {
        try {
          await renameUnitMut.mutateAsync({ id: item.id, oldUnit: r.oldUnit, newUnit: r.newUnit });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to rename unit";
          toast.error("Unit rename failed", message);
          return;
        }
      }
    }

    const validVariants = unitVariants
      .filter((v) => v.unit && v.salePrice)
      .map(toPayloadVariant);
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
        lowStockAlert: lowStockAlert || undefined,
        unit: unit as any,
        unitVariants: itemMode === "alt_units" && validVariants.length > 0 ? validVariants : undefined,
      },
    });
  }

  const variantAttrs = item?.variantAttributes as string[] | null;

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title="Edit Item"
      description="Update product or service details"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={updateMutation.isPending}>
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
      }
    >
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

        {/* Item Mode display (read-only for existing items) */}
        {itemType === "product" && itemMode !== "simple" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">Mode:</span>
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
              itemMode === "variants"
                ? "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400"
                : "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400"
            )}>
              {itemMode === "variants" ? "Variants" : "Alt Units"}
            </span>
          </div>
        )}

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
            label={itemMode === "variants" ? "Default Price (₹)" : "Sale Price (₹)"}
            type="number"
            step="0.01"
            min="0"
            value={salePrice}
            onChange={(e) => handleSalePriceChange(e.target.value)}
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

        {/* Unit — editable; rename cascades to invoices on save */}
        {itemMode !== "variants" && (
          <div>
            <label className="label">Base Unit</label>
            <Combobox
              value={unit}
              onChange={(val) => setUnit(val)}
              options={UNIT_OPTIONS}
              placeholder="Select unit"
            />
            {item && unit !== item.unit && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                Saving will rename {item.unit.toUpperCase()} → {unit.toUpperCase()} on all existing invoices.
              </p>
            )}
          </div>
        )}

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

          {itemType === "product" && itemMode !== "variants" && (
            <Disclosure
              label="Stock"
              count={countFilled(lowStockAlert)}
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Current Stock</label>
                  <div className="input flex items-center text-text-secondary cursor-not-allowed opacity-75 tabular-nums">
                    {parseFloat(stockQuantity).toLocaleString()}
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1">Use "Adjust Stock" in the item detail panel.</p>
                </div>
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

          {itemType === "product" && (itemMode === "alt_units" || itemMode === "simple") && (
            <Disclosure
              label="Alternate Units"
              count={unitVariants.filter((v) => v.unit && v.salePrice).length}
            >
              <UnitVariantEditor
                variants={unitVariants}
                onChange={setUnitVariants}
                baseUnit={unit}
                basePrice={salePrice}
                getAvailableUnits={(rowIndex) => {
                  const usedUnits = new Set(
                    unitVariants.filter((_, j) => j !== rowIndex).map((uv) => uv.unit),
                  );
                  return getCompatibleAltUnits(unit).filter((o) => !usedUnits.has(o.value));
                }}
                onRemoveRow={removeUnitVariant}
                onAddRow={addUnitVariant}
              />
            </Disclosure>
          )}

          {itemType === "product" && (itemMode === "variants") && item?.variants && (
            <Disclosure label="Variants" count={item.variants.length} defaultOpen>
              <div className="space-y-2">
                {item.variants.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {(variantAttrs || []).map((a) => <th key={a} className="text-left p-1">{a}</th>)}
                          <th className="text-left p-1">SKU</th>
                          <th className="text-right p-1">Sale Price</th>
                          <th className="text-right p-1">Stock</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.variants.map((v) => (
                          <tr key={v.id}>
                            {(variantAttrs || []).map((a) => (
                              <td key={a} className="p-1 text-text-secondary">
                                {(v.attributeValues as Record<string, string>)[a] ?? ""}
                              </td>
                            ))}
                            {editingVariantId === v.id ? (
                              <>
                                <td className="p-1">
                                  <input className="input-field text-xs w-20" value={editVariantData.sku} onChange={(e) => setEditVariantData((p) => ({ ...p, sku: e.target.value }))} />
                                </td>
                                <td className="p-1">
                                  <input className="input-field text-xs w-20 text-right" type="number" step="0.01" value={editVariantData.salePrice} onChange={(e) => setEditVariantData((p) => ({ ...p, salePrice: e.target.value }))} />
                                </td>
                                <td className="p-1">
                                  <input className="input-field text-xs w-16 text-right" type="number" value={editVariantData.stockQuantity} onChange={(e) => setEditVariantData((p) => ({ ...p, stockQuantity: e.target.value }))} />
                                </td>
                                <td className="p-1 flex gap-1">
                                  <button
                                    onClick={() => updateVariantMutation.mutate({
                                      variantId: v.id,
                                      data: {
                                        sku: editVariantData.sku || undefined,
                                        salePrice: editVariantData.salePrice || undefined,
                                        purchasePrice: editVariantData.purchasePrice || undefined,
                                        stockQuantity: editVariantData.stockQuantity || "0",
                                      },
                                    })}
                                    className="text-brand-600 text-xs font-medium"
                                    disabled={updateVariantMutation.isPending}
                                  >
                                    Save
                                  </button>
                                  <button onClick={() => setEditingVariantId(null)} className="text-text-tertiary text-xs">Cancel</button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="p-1 text-text-secondary">{v.sku || "—"}</td>
                                <td className="p-1 text-right tabular-nums">{v.salePrice ? formatCurrency(v.salePrice) : "—"}</td>
                                <td className="p-1 text-right tabular-nums">{parseFloat(v.stockQuantity).toLocaleString()}</td>
                                <td className="p-1 flex gap-1">
                                  {can("update", "Item") && (
                                  <button
                                    onClick={() => {
                                      setEditingVariantId(v.id);
                                      setEditVariantData({
                                        sku: v.sku ?? "",
                                        salePrice: v.salePrice ?? "",
                                        purchasePrice: v.purchasePrice ?? "",
                                        stockQuantity: v.stockQuantity ?? "0",
                                      });
                                    }}
                                    className="text-brand-600 text-xs"
                                  >
                                    Edit
                                  </button>
                                  )}
                                  <button
                                    onClick={() => deleteVariantMutation.mutate({ variantId: v.id })}
                                    className="text-red-500 text-xs"
                                    disabled={deleteVariantMutation.isPending}
                                  >
                                    &times;
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-text-tertiary">No variants yet.</p>
                )}

                {showAddVariant ? (
                  <div className="rounded-lg border border-border-light p-3 space-y-2">
                    <p className="text-xs font-medium">New Variant</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(variantAttrs || []).map((a) => (
                        <InputField
                          key={a}
                          label={a}
                          value={newVariantAttrs[a] || ""}
                          onChange={(e) => setNewVariantAttrs((p) => ({ ...p, [a]: e.target.value }))}
                          placeholder={a}
                        />
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <InputField label="SKU" value={newVariantSku} onChange={(e) => setNewVariantSku(e.target.value)} placeholder="SKU" />
                      <InputField label="Sale Price" type="number" step="0.01" value={newVariantSalePrice} onChange={(e) => setNewVariantSalePrice(e.target.value)} placeholder="0.00" />
                      <InputField label="Stock" type="number" value={newVariantStock} onChange={(e) => setNewVariantStock(e.target.value)} placeholder="0" />
                    </div>
                    <div className="flex gap-2">
                      {can("update", "Item") && (
                      <button
                        onClick={() => createVariantMutation.mutate({
                          itemId,
                          variant: {
                            attributeValues: newVariantAttrs,
                            sku: newVariantSku || undefined,
                            salePrice: newVariantSalePrice || undefined,
                            stockQuantity: newVariantStock || "0",
                          },
                        })}
                        className="text-xs font-medium text-brand-600"
                        disabled={createVariantMutation.isPending}
                      >
                        {createVariantMutation.isPending ? "Adding..." : "Add Variant"}
                      </button>
                      )}
                      <button onClick={() => setShowAddVariant(false)} className="text-xs text-text-tertiary">Cancel</button>
                    </div>
                  </div>
                ) : can("update", "Item") ? (
                  <button
                    type="button"
                    onClick={() => setShowAddVariant(true)}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    + Add variant
                  </button>
                ) : null}
              </div>
            </Disclosure>
          )}
        </div>

      </div>
    </SlideOver>
  );
}

// ── Item Detail Panel ────────────────────────────────────────────

// Sub-components for Price History and Stock Movements tabs

type PriceHistoryRow = {
  invoiceId: string;
  invoiceDate: Date | string;
  invoiceNumber: string;
  invoiceType: string;
  unitPrice: string;
  quantity: string;
  taxPercent: string;
  totalAmount: string;
  partyName: string;
  selectedUnit: string | null;
  conversionFactor: string | null;
};

type StockMovementRow = {
  invoiceId: string;
  invoiceDate: Date | string;
  invoiceNumber: string;
  invoiceType: string;
  documentType: string;
  quantity: string;
  partyName: string;
  direction: "in" | "out";
  selectedUnit: string | null;
  conversionFactor: string | null;
};

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

function PriceHistoryTab({
  priceHistory,
  period,
  onPeriodChange,
}: {
  priceHistory: PriceHistoryRow[];
  period: PeriodFilter;
  onPeriodChange: (v: PeriodFilter) => void;
}) {
  const filtered = useMemo(() => filterByPeriod(priceHistory, period), [priceHistory, period]);

  // Build chart data: chronological, sales only, max 10 points if "all"
  const chartData = useMemo(() => {
    const chronological = [...filtered].reverse();
    const limited = period === "all" && chronological.length > 10
      ? chronological.slice(-10)
      : chronological;
    return limited.map((h) => ({
      date: formatDate(h.invoiceDate),
      price: parseFloat(h.unitPrice) / parseFloat(h.conversionFactor || "1"),
      invoiceNumber: h.invoiceNumber,
    }));
  }, [filtered, period]);

  // Price-changed rows: only invoices where unit price differs from the previous entry
  const priceChangedRows = useMemo(() => {
    const chronological = [...filtered].reverse();
    return chronological.filter((h, i) => {
      if (i === 0) return true;
      const basePrice = parseFloat(h.unitPrice) / parseFloat(h.conversionFactor || "1");
      const prevBasePrice = parseFloat(chronological[i - 1].unitPrice) / parseFloat(chronological[i - 1].conversionFactor || "1");
      return Math.abs(basePrice - prevBasePrice) > 0.01;
    }).reverse(); // show newest first
  }, [filtered]);

  if (!priceHistory.length) {
    return (
      <EmptyState
        title="No price history"
        description="Prices will appear here as this item is used in invoices."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-text-secondary">Price Over Time</p>
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </div>

      {chartData.length > 1 ? (
        <div className="rounded-xl border border-border-light bg-surface-0 p-4">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `₹${v}`}
                width={55}
              />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [`₹${Number(value ?? 0).toFixed(2)}`, "Unit Price"]}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#5b5bd6"
                strokeWidth={2}
                dot={{ r: 3, fill: "#5b5bd6", strokeWidth: 0 }}
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

      {priceChangedRows.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-secondary mb-2">Price Changes</p>
          <div className="rounded-xl border border-border-light overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto">
              <table className="data-table w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th style={{ width: "50%" }}>Invoice #</th>
                    <th style={{ width: "50%" }} className="text-right">Unit Price (base)</th>
                  </tr>
                </thead>
                <tbody>
                  {priceChangedRows.map((h, i) => (
                    <tr key={i}>
                      <td className="font-mono text-[13px]">
                        <Link to="/invoices" search={{ id: h.invoiceId }} className="text-brand-600 hover:text-brand-700 hover:underline">
                          {h.invoiceNumber}
                        </Link>
                      </td>
                      <td className="text-right tabular-nums font-medium">
                        {formatCurrency(String(parseFloat(h.unitPrice) / parseFloat(h.conversionFactor || "1")))}
                        {h.selectedUnit && h.conversionFactor && parseFloat(h.conversionFactor) !== 1 && (
                          <span className="text-[10px] text-text-tertiary ml-1">
                            ({formatCurrency(h.unitPrice)}/{h.selectedUnit})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StockMovementsTab({
  stockMovements,
  period,
  onPeriodChange,
  currentStock,
}: {
  stockMovements: StockMovementRow[];
  period: PeriodFilter;
  onPeriodChange: (v: PeriodFilter) => void;
  currentStock: number;
}) {
  const filtered = useMemo(() => filterByPeriod(stockMovements, period), [stockMovements, period]);

  // Build running stock data (oldest first for chart)
  const { chartData, tableRows } = useMemo(() => {
    const chronological = [...filtered].reverse();

    // Compute running balance backwards from current stock
    // Sum all qty changes (+ for in, - for out) in the filtered window
    const totalChange = chronological.reduce((acc, m) => {
      const factor = parseFloat(m.conversionFactor || "1");
      const qty = parseFloat(m.quantity) * factor;
      return acc + (m.direction === "in" ? qty : -qty);
    }, 0);

    // Starting stock = currentStock - totalChange in this window
    let running = currentStock - totalChange;
    const rows: { date: string; invoiceId: string; invoiceNumber: string; documentType: string; qtyChange: number; running: number }[] = [];

    for (const m of chronological) {
      const factor = parseFloat(m.conversionFactor || "1");
      const qty = parseFloat(m.quantity) * factor;
      const delta = m.direction === "in" ? qty : -qty;
      running += delta;
      rows.push({
        date: formatDate(m.invoiceDate),
        invoiceId: m.invoiceId,
        invoiceNumber: m.invoiceNumber,
        documentType: m.documentType,
        qtyChange: delta,
        running,
      });
    }

    // Table shows newest first (reverse of rows)
    const tableRows = [...rows].reverse();

    const chartData = rows.map((r) => ({
      date: r.date,
      stock: r.running,
    }));

    return { chartData, tableRows };
  }, [filtered, currentStock]);

  const { totalIn, totalOut } = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    for (const m of filtered) {
      const factor = parseFloat(m.conversionFactor || "1");
      const qty = parseFloat(m.quantity) * factor;
      if (m.direction === "in") totalIn += qty;
      else totalOut += qty;
    }
    return { totalIn, totalOut };
  }, [filtered]);

  if (!stockMovements.length) {
    return (
      <EmptyState
        title="No stock movements"
        description="Stock changes will appear here as invoices are created."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-text-secondary">Stock Over Time</p>
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 font-medium">
          In: +{totalIn.toLocaleString()}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-lg bg-red-600/10 text-red-700 dark:text-red-400 font-medium">
          Out: -{totalOut.toLocaleString()}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-lg bg-surface-2 text-text-secondary font-medium">
          Net: {(totalIn - totalOut) > 0 ? "+" : ""}{(totalIn - totalOut).toLocaleString()}
        </span>
        <span className="text-xs text-text-tertiary ml-auto">
          {filtered.length} movements
        </span>
      </div>

      {chartData.length > 1 ? (
        <div className="rounded-xl border border-border-light bg-surface-0 p-4">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [Number(value ?? 0).toLocaleString(), "Stock"]}
              />
              <Line
                type="monotone"
                dataKey="stock"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }}
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
        <div className="max-h-[300px] overflow-y-auto">
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
              {tableRows.map((r, i) => (
                <tr key={i}>
                  <td className="text-text-secondary text-xs">{r.date}</td>
                  <td className="font-mono text-[13px]">
                    <Link to={DOC_TYPE_ROUTE[r.documentType] ?? "/invoices"} search={{ id: r.invoiceId }} className="text-brand-600 hover:text-brand-700 hover:underline">
                      {r.invoiceNumber}
                    </Link>
                  </td>
                  <td className={cn(
                    "text-right tabular-nums font-medium",
                    r.qtyChange > 0 ? "text-emerald-600" : "text-red-600"
                  )}>
                    {r.qtyChange > 0 ? "+" : ""}{r.qtyChange.toLocaleString()}
                  </td>
                  <td className="text-right tabular-nums text-text-secondary">{r.running.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "prices", label: "Price History" },
  { value: "stock", label: "Stock Movements" },
];

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface-0)",
    border: "1px solid var(--border-light)",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

type PeriodFilter = "6m" | "1y" | "all";

function filterByPeriod<T extends { invoiceDate: Date | string }>(data: T[], period: PeriodFilter): T[] {
  if (period === "all") return data;
  const now = new Date();
  const cutoff = new Date(now);
  if (period === "6m") cutoff.setMonth(cutoff.getMonth() - 6);
  else cutoff.setFullYear(cutoff.getFullYear() - 1);
  return data.filter((d) => new Date(d.invoiceDate) >= cutoff);
}

function PeriodToggle({ value, onChange }: { value: PeriodFilter; onChange: (v: PeriodFilter) => void }) {
  const opts: { value: PeriodFilter; label: string }[] = [
    { value: "6m", label: "Last 6M" },
    { value: "1y", label: "Last 1Y" },
    { value: "all", label: "All" },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
            value === o.value
              ? "bg-brand-600 text-white"
              : "bg-surface-1 text-text-secondary hover:bg-surface-2 border border-border-light"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ItemDetailPanel({ itemId, onClose, onEdit }: { itemId: string; onClose: () => void; onEdit: (id: string) => void }) {
  const [tab, setTab] = useState("overview");
  const [showMerge, setShowMerge] = useState(false);
  const [showSwitchUnit, setShowSwitchUnit] = useState(false);
  const [showAdjustStock, setShowAdjustStock] = useState(false);
  const [pricePeriod, setPricePeriod] = useState<PeriodFilter>("all");
  const [stockPeriod, setStockPeriod] = useState<PeriodFilter>("all");
  const { can } = usePermissions();

  const { data: item } = trpc.item.getById.useQuery({ id: itemId });
  const { data: priceHistory } = trpc.item.priceHistory.useQuery(
    { id: itemId },
    { enabled: tab === "prices" || tab === "overview" }
  );
  const { data: stockMovements } = trpc.item.stockMovements.useQuery(
    { id: itemId },
    { enabled: tab === "stock" || tab === "overview" }
  );
  // Sales stats are aggregated server-side (no row-limit truncation)
  const { data: salesStats } = trpc.item.salesStats.useQuery({ id: itemId });

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMerge(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-amber-600 hover:bg-amber-600/[0.08] border border-amber-200 dark:border-amber-800 transition-colors"
            >
              Merge
            </button>
            {item.itemType === "product" && (
              <button
                onClick={() => setShowAdjustStock(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
              >
                Adjust Stock
              </button>
            )}
            {item.itemType === "product" && item.itemMode !== "variants" && (
              <button
                onClick={() => setShowSwitchUnit(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
              >
                Switch Unit
              </button>
            )}
          </div>
          {can("update", "Item") && (
          <button
            onClick={() => {
              onClose();
              onEdit(item.id);
            }}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
          >
            Edit Item
          </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tabs */}
        <PillTabs tabs={DETAIL_TABS} value={tab} onChange={setTab} />

        {/* ── Overview ─────────────────────────────────────── */}
        {tab === "overview" && (
          <div className="space-y-4">
            {/* Sales metrics row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Total Sales</p>
                <p className="text-lg font-bold tabular-nums text-text-primary mt-1">
                  {salesStats ? formatCurrency(salesStats.totalSaleAmount) : "—"}
                </p>
              </div>
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Total Qty Sold</p>
                <p className="text-lg font-bold tabular-nums text-text-primary mt-1">
                  {salesStats ? parseFloat(salesStats.totalSaleQty).toLocaleString() : "—"}
                </p>
                {salesStats && <p className="text-[11px] text-text-tertiary">{item.unit}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Avg List Price</p>
                <p className="text-lg font-bold tabular-nums text-text-primary mt-1">
                  {salesStats ? formatCurrency(salesStats.avgGrossPrice) : "—"}
                </p>
                <p className="text-[11px] text-text-tertiary">per {item.unit}, before discount</p>
              </div>
              <div className="rounded-xl bg-surface-1 border border-border-light px-4 py-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Avg Realized Price</p>
                <p className="text-lg font-bold tabular-nums text-text-primary mt-1">
                  {salesStats ? formatCurrency(salesStats.avgNetPrice) : "—"}
                </p>
                <p className="text-[11px] text-text-tertiary">per {item.unit}, after discount, excl. tax</p>
              </div>
            </div>

            {/* Compact item info grid */}
            <div className="rounded-xl border border-border-light overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["Sale Price", item.salePrice ? `${formatCurrency(item.salePrice)}${item.taxInclusive ? " (incl. tax)" : ""}` : "—"],
                    ["Purchase Price", item.purchasePrice ? formatCurrency(item.purchasePrice) : "—"],
                    ...(item.itemMode !== "variants"
                      ? [["Current Stock", `${parseFloat(item.stockQuantity).toLocaleString()} ${item.unit}${isLow ? " ⚠ Low" : ""}`]]
                      : [["Variants", `${item.variants?.length ?? 0} variants`]]
                    ),
                    ["Tax %", `${item.taxPercent}%`],
                    ["Unit", item.unit.toUpperCase()],
                    ...(item.itemMode && item.itemMode !== "simple" ? [["Mode", item.itemMode === "variants" ? "Variants" : "Alt Units"]] : []),
                    ...(item.hsn ? [["HSN / SAC", item.hsn]] : []),
                    ...(item.sku ? [["SKU", item.sku]] : []),
                    ...(item.category ? [["Category", item.category]] : []),
                  ].map(([label, value]) => (
                    <tr key={label} className="border-b border-border-light last:border-0">
                      <td className="px-4 py-2.5 text-text-tertiary font-medium w-36 text-xs">{label}</td>
                      <td className={cn("px-4 py-2.5 text-text-primary text-sm", isLow && label === "Current Stock" ? "text-amber-600 font-medium" : "")}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Variants table */}
            {item.itemMode === "variants" && item.variants && item.variants.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Variants</p>
                  <p className="text-[11px] text-text-tertiary">
                    Total stock: {item.variants.reduce((sum, v) => sum + parseFloat(v.stockQuantity), 0).toLocaleString()} {item.unit}
                  </p>
                </div>
                <div className="rounded-xl border border-border-light overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="data-table w-full">
                      <thead>
                        <tr>
                          {((item.variantAttributes as string[]) || []).map((a) => (
                            <th key={a}>{a}</th>
                          ))}
                          <th>SKU</th>
                          <th className="text-right">Price</th>
                          <th className="text-right">Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.variants.map((v) => (
                          <tr key={v.id}>
                            {((item.variantAttributes as string[]) || []).map((a) => (
                              <td key={a} className="font-medium">
                                {(v.attributeValues as Record<string, string>)[a] ?? "—"}
                              </td>
                            ))}
                            <td className="text-text-secondary text-xs">{v.sku || "—"}</td>
                            <td className="text-right tabular-nums">{v.salePrice ? formatCurrency(v.salePrice) : "—"}</td>
                            <td className="text-right tabular-nums font-medium">{parseFloat(v.stockQuantity).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

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
          </div>
        )}

        {/* ── Price History ─────────────────────────────────── */}
        {tab === "prices" && (
          <PriceHistoryTab
            priceHistory={priceHistory ?? []}
            period={pricePeriod}
            onPeriodChange={setPricePeriod}
          />
        )}

        {/* ── Stock Movements ───────────────────────────────── */}
        {tab === "stock" && (
          <StockMovementsTab
            stockMovements={stockMovements ?? []}
            period={stockPeriod}
            onPeriodChange={setStockPeriod}
            currentStock={parseFloat(item.stockQuantity)}
          />
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
    {showSwitchUnit && (
      <SwitchUnitModal
        itemId={itemId}
        itemName={item.name}
        currentUnit={item.unit}
        unitVariants={item.unitVariants as any[] || []}
        onClose={() => {
          setShowSwitchUnit(false);
          onClose();
        }}
      />
    )}
    {showAdjustStock && (
      <AdjustStockModal
        itemId={itemId}
        itemName={item.name}
        currentStock={item.stockQuantity}
        unit={item.unit}
        isVariantItem={item.itemMode === "variants"}
        variants={item.variants || []}
        onClose={() => setShowAdjustStock(false)}
      />
    )}
    </>
  );
}

// ── Switch Base Unit Modal ──────────────────────────────────────

function SwitchUnitModal({
  itemId,
  itemName,
  currentUnit,
  unitVariants,
  onClose,
}: {
  itemId: string;
  itemName: string;
  currentUnit: string;
  unitVariants: Array<{ unit: string; conversionFactor: number; salePrice: string }>;
  onClose: () => void;
}) {
  // Default to the first alt unit if one exists
  const defaultVariant = unitVariants.length > 0 ? unitVariants[0] : null;
  const [newUnit, setNewUnit] = useState(defaultVariant?.unit || "");
  const [conversionFactor, setConversionFactor] = useState(defaultVariant ? String(defaultVariant.conversionFactor) : "");
  const [isCustom, setIsCustom] = useState(!defaultVariant);
  const utils = trpc.useUtils();

  const switchMutation = trpc.item.switchBaseUnit.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      utils.item.getById.invalidate({ id: itemId });
      toast.success(`Base unit switched to ${newUnit.toUpperCase()}`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  // When selecting an existing variant, pre-fill the conversion factor
  function selectVariant(unit: string) {
    const variant = unitVariants.find((v) => v.unit === unit);
    if (variant) {
      setNewUnit(unit);
      setConversionFactor(String(variant.conversionFactor));
      setIsCustom(false);
    }
  }

  function selectCustom() {
    setNewUnit("");
    setConversionFactor("");
    setIsCustom(true);
  }

  const factor = parseFloat(conversionFactor) || 0;

  return (
    <Modal open={true} onClose={onClose} title="Switch Base Unit" className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Change the base unit of <strong>{itemName}</strong>. Current base: <strong>{currentUnit.toUpperCase()}</strong>.
          Stock and prices will be automatically converted.
        </p>

        {/* Variant options */}
        {unitVariants.length > 0 && (
          <div>
            <p className="label mb-2">Switch to an existing variant</p>
            <div className="space-y-1.5">
              {unitVariants.map((v) => (
                <button
                  key={v.unit}
                  type="button"
                  onClick={() => selectVariant(v.unit)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg border transition-all text-sm",
                    newUnit === v.unit && !isCustom
                      ? "border-brand-500 bg-brand-600/[0.08]"
                      : "border-border-light hover:border-brand-300"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{v.unit.toUpperCase()}</span>
                    <span className="text-xs text-text-tertiary">
                      1 {currentUnit.toUpperCase()} = {v.conversionFactor} {v.unit.toUpperCase()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom option */}
        <div>
          <button
            type="button"
            onClick={selectCustom}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-lg border transition-all text-sm",
              isCustom
                ? "border-brand-500 bg-brand-600/[0.08]"
                : "border-border-light hover:border-brand-300"
            )}
          >
            <span className="font-medium">Custom unit...</span>
          </button>
          {isCustom && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <InputField
                label="New unit name"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="e.g. box, pack"
                autoFocus
              />
              <InputField
                label={`1 ${currentUnit.toUpperCase()} = ? new units`}
                type="number"
                step="any"
                min="0.001"
                value={conversionFactor}
                onChange={(e) => setConversionFactor(e.target.value)}
                placeholder="Conversion factor"
              />
            </div>
          )}
        </div>

        {/* Preview */}
        {newUnit && factor > 0 && (
          <div className="rounded-lg bg-surface-1 border border-border-light px-4 py-3 text-xs space-y-1">
            <p className="font-medium text-text-primary">Preview</p>
            <p className="text-text-secondary">
              1 {currentUnit.toUpperCase()} = {factor} {newUnit.toUpperCase()}
            </p>
            <p className="text-text-secondary">
              Old base ({currentUnit.toUpperCase()}) becomes a unit variant
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-3 border-t border-border-light">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => switchMutation.mutate({
              id: itemId,
              newUnit: newUnit.toLowerCase(),
              conversionFactor: factor,
            })}
            disabled={!newUnit || factor <= 0 || switchMutation.isPending}
          >
            {switchMutation.isPending ? "Switching..." : "Switch Unit"}
          </button>
        </div>
      </div>
    </Modal>
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
  const { data: itemsData } = trpc.item.list.useQuery({ page: 1, limit: 100 });
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

// ── Adjust Stock Modal ────────────────────────────────────────

function AdjustStockModal({
  itemId,
  itemName,
  currentStock,
  unit,
  isVariantItem,
  variants,
  onClose,
}: {
  itemId: string;
  itemName: string;
  currentStock: string;
  unit: string;
  isVariantItem: boolean;
  variants: Array<{ id: string; attributeValues: Record<string, string> | unknown; stockQuantity: string; salePrice: string | null }>;
  onClose: () => void;
}) {
  const [adjustType, setAdjustType] = useState<"add" | "remove">("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState(todayISODate);
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");

  const utils = trpc.useUtils();

  const adjustMutation = trpc.item.adjustStock.useMutation({
    onSuccess: () => {
      utils.item.getById.invalidate({ id: itemId });
      utils.item.list.invalidate();
      utils.item.lowStockCount.invalidate();
      toast.success("Stock adjusted");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: history } = trpc.item.stockAdjustmentHistory.useQuery(
    { itemId, variantId: selectedVariantId || undefined, limit: 10 },
  );

  const resolvedStock = isVariantItem && selectedVariantId
    ? variants.find((v) => v.id === selectedVariantId)?.stockQuantity || "0"
    : currentStock;

  const qty = parseFloat(quantity) || 0;
  const preview = adjustType === "add"
    ? parseFloat(resolvedStock) + qty
    : parseFloat(resolvedStock) - qty;

  function handleSubmit() {
    if (!qty) return;
    const adjustedQty = adjustType === "add" ? qty.toFixed(3) : (-qty).toFixed(3);
    adjustMutation.mutate({
      itemId,
      variantId: isVariantItem ? selectedVariantId || undefined : undefined,
      quantity: adjustedQty,
      reason: reason || undefined,
      adjustmentDate: toISOString(adjustmentDate),
    });
  }

  return (
    <Modal open={true} onClose={onClose} title="Adjust Stock" className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Manually adjust stock for <strong>{itemName}</strong>.
        </p>

        {/* Variant selector (for variant items) */}
        {isVariantItem && (
          <div>
            <label className="label">Variant</label>
            <select
              value={selectedVariantId}
              onChange={(e) => setSelectedVariantId(e.target.value)}
              className="input w-full"
            >
              <option value="">Select variant...</option>
              {variants.map((v) => {
                const attrs = v.attributeValues as Record<string, string>;
                const label = Object.values(attrs).join(" / ");
                return (
                  <option key={v.id} value={v.id}>
                    {label} (stock: {parseFloat(v.stockQuantity).toLocaleString()})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Current stock display */}
        <div className="rounded-lg bg-surface-1 border border-border-light px-4 py-3">
          <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Current Stock</p>
          <p className="text-lg font-bold tabular-nums text-text-primary">
            {parseFloat(resolvedStock).toLocaleString()} <span className="text-sm font-normal text-text-tertiary">{unit}</span>
          </p>
        </div>

        {/* Add / Remove toggle */}
        <SegmentedControl
          tabs={[
            { value: "add", label: "Add Stock" },
            { value: "remove", label: "Remove Stock" },
          ]}
          value={adjustType}
          onChange={(v) => setAdjustType(v as "add" | "remove")}
        />

        {/* Quantity + Date */}
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Quantity"
            type="number"
            min="0.001"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            autoFocus
          />
          <InputField
            label="Adjustment Date"
            type="date"
            value={adjustmentDate}
            onChange={(e) => setAdjustmentDate(e.target.value)}
          />
        </div>

        {/* Reason */}
        <div>
          <label className="label">Reason</label>
          <input
            className="input w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Physical count correction, Damaged goods, Opening stock"
          />
        </div>

        {/* Preview */}
        {qty > 0 && (
          <div className="rounded-lg border border-border-light px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-text-tertiary">New stock will be</span>
            <span className={cn(
              "text-sm font-bold tabular-nums",
              preview < 0 ? "text-red-600" : "text-text-primary"
            )}>
              {preview.toLocaleString()} {unit}
            </span>
          </div>
        )}

        {/* Recent adjustments */}
        {history && history.data.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-2">Recent Adjustments</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {history.data.map((adj) => (
                <div key={adj.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface-1">
                  <div>
                    <span className={cn(
                      "font-medium tabular-nums",
                      parseFloat(adj.quantity) > 0 ? "text-emerald-600" : "text-red-600"
                    )}>
                      {parseFloat(adj.quantity) > 0 ? "+" : ""}{parseFloat(adj.quantity).toLocaleString()}
                    </span>
                    {adj.reason && <span className="text-text-tertiary ml-2">{adj.reason}</span>}
                  </div>
                  <span className="text-text-tertiary">{formatDate(adj.adjustmentDate)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!qty || adjustMutation.isPending || (isVariantItem && !selectedVariantId)}
          >
            {adjustMutation.isPending ? "Adjusting..." : `${adjustType === "add" ? "Add" : "Remove"} Stock`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
