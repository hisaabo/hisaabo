import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IS_DEV = import.meta.env.DEV;
const STORE_PREFIX = IS_DEV ? "localhost:3000/store/" : "store.hisaabo.in/";

function buildStoreUrl(slug: string) {
  const origin = IS_DEV ? "http://localhost:3000" : "https://store.hisaabo.in";
  return `${origin}/store/${slug}`;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

function ToggleSwitch({ checked, onChange, label, disabled }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        checked ? "bg-brand-600" : "bg-surface-3",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Store Settings card
// ---------------------------------------------------------------------------

function StoreSettingsCard() {
  const utils = trpc.useUtils();

  const { data: settings, isLoading } = trpc.store.getSettings.useQuery();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [minOrder, setMinOrder] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);

  // Use server state as source of truth until the user edits
  const effectiveEnabled = enabled ?? settings?.storeEnabled ?? false;
  const effectiveSlug = slug ?? settings?.storeSlug ?? "";
  const effectiveTagline = tagline ?? settings?.storeTagline ?? "";
  const effectiveWhatsapp = whatsapp ?? settings?.storeWhatsappNumber ?? "";
  const effectiveMinOrder = minOrder ?? settings?.storeMinOrderAmount ?? "";
  const effectiveDeliveryNote = deliveryNote ?? settings?.storeDeliveryNote ?? "";

  const updateMutation = trpc.store.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Store settings saved");
      utils.store.getSettings.invalidate();
    },
    onError: (err) => toast.error("Failed to save settings", err.message),
  });

  function handleSave() {
    updateMutation.mutate({
      storeEnabled: effectiveEnabled,
      storeSlug: effectiveSlug || undefined,
      storeTagline: effectiveTagline || undefined,
      storeWhatsappNumber: effectiveWhatsapp || undefined,
      storeMinOrderAmount: effectiveMinOrder || undefined,
      storeDeliveryNote: effectiveDeliveryNote || undefined,
    });
  }

  if (isLoading) {
    return (
      <div className="card p-6">
        <div className="skeleton h-5 w-36 mb-4" />
        <div className="skeleton h-10 w-full mb-3" />
        <div className="skeleton h-10 w-full mb-3" />
        <div className="skeleton h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Store Settings</h3>

      {/* Enable / disable toggle */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-medium text-text-primary">Online Store</p>
          <p className="text-xs text-text-tertiary">Allow customers to browse and order online</p>
        </div>
        <ToggleSwitch
          checked={effectiveEnabled}
          onChange={setEnabled}
          label="Enable online store"
        />
      </div>

      {/* Store URL */}
      <div className="mb-4">
        <label className="label">Store URL</label>
        <div className="flex items-center gap-0">
          <span className="inline-flex items-center px-3 py-2 rounded-l-lg border border-r-0 border-border-color bg-surface-1 text-text-tertiary text-sm select-none whitespace-nowrap">
            {STORE_PREFIX}
          </span>
          <input
            className="input rounded-l-none"
            value={effectiveSlug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="your-business"
            maxLength={50}
          />
        </div>
        <p className="text-[11px] text-text-tertiary mt-1">This will be your public store URL</p>
      </div>

      {/* Tagline */}
      <div className="mb-4">
        <label className="label">Store Tagline</label>
        <input
          className="input"
          value={effectiveTagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Fresh organic produce delivered daily"
          maxLength={160}
        />
      </div>

      {/* WhatsApp number */}
      <div className="mb-4">
        <label className="label">WhatsApp Number</label>
        <input
          className="input"
          value={effectiveWhatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="+919876543210"
          maxLength={15}
        />
      </div>

      {/* Min order amount */}
      <div className="mb-4">
        <label className="label">Minimum Order Amount</label>
        <input
          className="input"
          value={effectiveMinOrder}
          onChange={(e) => setMinOrder(e.target.value)}
          placeholder="0"
          inputMode="decimal"
        />
      </div>

      {/* Delivery note */}
      <div className="mb-4">
        <label className="label">Delivery Note</label>
        <input
          className="input"
          value={effectiveDeliveryNote}
          onChange={(e) => setDeliveryNote(e.target.value)}
          placeholder="Free delivery above ₹500"
          maxLength={200}
        />
      </div>

      <button
        className="btn-primary mt-2"
        onClick={handleSave}
        disabled={updateMutation.isPending}
      >
        {updateMutation.isPending ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Store Items card
// ---------------------------------------------------------------------------

function StoreItemsCard() {
  const utils = trpc.useUtils();

  const { data: itemsResponse, isLoading } = trpc.store.listStoreItems.useQuery({ limit: 500 });
  const items = itemsResponse?.data ?? [];

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // local storePrice overrides: itemId -> string
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({});

  const toggleItemMutation = trpc.store.bulkToggleItems.useMutation({
    onSuccess: () => {
      utils.store.listStoreItems.invalidate();
    },
    onError: (err) => toast.error("Failed to update items", err.message),
  });

  const updateItemMutation = trpc.store.updateItemStoreSettings.useMutation({
    onSuccess: () => {
      utils.store.listStoreItems.invalidate();
    },
    onError: (err) => toast.error("Failed to update price", err.message),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (item: any) =>
        item.name.toLowerCase().includes(q) ||
        (item.category ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const enabledCount = items.filter((item: any) => item.storeEnabled).length;
  const totalCount = items.length;

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item: any) => selected.has(item.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((item: any) => next.delete(item.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((item: any) => next.add(item.id));
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function enableSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    toggleItemMutation.mutate({ itemIds: ids, storeEnabled: true });
    setSelected(new Set());
  }

  function disableSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    toggleItemMutation.mutate({ itemIds: ids, storeEnabled: false });
    setSelected(new Set());
  }

  function toggleItem(id: string, currentEnabled: boolean) {
    toggleItemMutation.mutate({ itemIds: [id], storeEnabled: !currentEnabled });
  }

  function commitPriceOverride(item: any) {
    const raw = priceOverrides[item.id];
    if (raw === undefined) return;
    const val = raw.trim();
    // empty string = clear override
    updateItemMutation.mutate({
      itemId: item.id,
      storePrice: val === "" ? null : val,
    });
  }

  return (
    <div className="card overflow-hidden mt-6">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border-light flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Store Items</h3>
          <p className="text-xs text-text-tertiary">
            Select which items to show on your online store
          </p>
        </div>
        {!isLoading && (
          <span className="text-xs text-text-tertiary">
            {enabledCount} of {totalCount} items enabled
          </span>
        )}
      </div>

      {/* Search + bulk actions */}
      <div className="px-4 py-3 border-b border-border-light flex items-center gap-3">
        <input
          className="input flex-1"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn-secondary btn-sm"
          onClick={enableSelected}
          disabled={selected.size === 0 || toggleItemMutation.isPending}
        >
          Enable Selected
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={disableSelected}
          disabled={selected.size === 0 || toggleItemMutation.isPending}
        >
          Disable Selected
        </button>
      </div>

      {/* Table header with select-all */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-1 border-b border-border-light">
          <input
            type="checkbox"
            className="rounded border-border-color"
            checked={allFilteredSelected}
            onChange={toggleSelectAll}
            aria-label="Select all visible items"
          />
          <span className="text-xs text-text-tertiary flex-1">
            {selected.size > 0
              ? `${selected.size} selected`
              : `${filtered.length} item${filtered.length !== 1 ? "s" : ""}`}
          </span>
          <span className="text-xs text-text-tertiary w-20 text-right">Store price</span>
          <span className="text-xs text-text-tertiary w-9 text-center">Show</span>
        </div>
      )}

      {/* Item rows */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="px-4 py-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-9 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-tertiary">
            {search ? "No items match your search" : "No items found"}
          </div>
        ) : (
          filtered.map((item: any) => {
            const overrideRaw = priceOverrides[item.id];
            const overrideValue =
              overrideRaw !== undefined ? overrideRaw : item.storePrice ?? "";

            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-border-light hover:bg-surface-1"
              >
                {/* Row checkbox */}
                <input
                  type="checkbox"
                  className="rounded border-border-color shrink-0"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  aria-label={`Select ${item.name}`}
                />

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
                  <p className="text-xs text-text-tertiary">
                    {item.category || "Uncategorized"} ·{" "}
                    {formatCurrency(item.salePrice ?? "0")}
                  </p>
                </div>

                {/* Store price override */}
                <div className="w-20 shrink-0">
                  {item.storeEnabled && (
                    <input
                      className="input py-1 text-xs w-full text-right"
                      placeholder={item.salePrice ?? "price"}
                      value={overrideValue}
                      onChange={(e) =>
                        setPriceOverrides((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      onBlur={() => commitPriceOverride(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitPriceOverride(item);
                      }}
                      title="Override store price (leave blank to use sale price)"
                      inputMode="decimal"
                    />
                  )}
                </div>

                {/* Per-item toggle */}
                <div className="w-9 shrink-0 flex justify-center">
                  <ToggleSwitch
                    checked={item.storeEnabled}
                    onChange={() => toggleItem(item.id, item.storeEnabled)}
                    label={`Toggle ${item.name} on store`}
                    disabled={toggleItemMutation.isPending}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Store Preview link
// ---------------------------------------------------------------------------

function StorePreviewCard({ slug }: { slug: string }) {
  const storeUrl = buildStoreUrl(slug);

  return (
    <div className="card px-6 py-4 mt-6 flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-text-primary">Your Store</p>
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand-600 hover:text-brand-700 transition-colors"
        >
          {storeUrl}
        </a>
      </div>
      <a
        href={storeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary"
      >
        Preview Store
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function StoreTab() {
  const { data: settings } = trpc.store.getSettings.useQuery();

  const storeIsLive = !!settings?.storeEnabled && !!settings?.storeSlug;

  return (
    <div>
      <StoreSettingsCard />
      <StoreItemsCard />
      {storeIsLive && <StorePreviewCard slug={settings.storeSlug!} />}
    </div>
  );
}
