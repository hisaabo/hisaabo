import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { PhoneInput } from "./PhoneInput";

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

      {/* WhatsApp number — uses PhoneInput (+91 prefix, stores as +91XXXXXXXXXX) */}
      <div className="mb-4">
        <PhoneInput
          label="WhatsApp Number"
          value={effectiveWhatsapp}
          onChange={(v) => setWhatsapp(v)}
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
// Store Items modal
// ---------------------------------------------------------------------------

interface StoreItemsModalProps {
  open: boolean;
  onClose: () => void;
}

function StoreItemsModal({ open, onClose }: StoreItemsModalProps) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());

  // Fetch all items — API limit max is 100; fetch page 1 + page 2 if needed.
  // For simplicity we fetch with limit=100 (schema max) which covers most catalogues.
  const { data: itemsResponse, isLoading } = trpc.store.listStoreItems.useQuery(
    { limit: 100, page: 1 },
    { enabled: open },
  );
  const items: any[] = itemsResponse?.data ?? [];

  const toggleMut = trpc.store.bulkToggleItems.useMutation({
    onSuccess: () => {
      utils.store.listStoreItems.invalidate();
    },
    onError: (err) => toast.error("Failed to update items", err.message),
  });

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (item: any) =>
        item.name.toLowerCase().includes(q) ||
        (item.category ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  function getEffectiveEnabled(item: { id: string; storeEnabled: boolean }): boolean {
    return pendingChanges.has(item.id)
      ? pendingChanges.get(item.id)!
      : item.storeEnabled;
  }

  function toggleItem(id: string, currentlyEnabled: boolean) {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id); // undo pending change
      } else {
        next.set(id, !currentlyEnabled);
      }
      return next;
    });
  }

  const changeCount = pendingChanges.size;

  async function applyChanges() {
    const toEnable = [...pendingChanges.entries()]
      .filter(([, v]) => v)
      .map(([id]) => id);
    const toDisable = [...pendingChanges.entries()]
      .filter(([, v]) => !v)
      .map(([id]) => id);

    if (toEnable.length > 0) {
      await toggleMut.mutateAsync({ itemIds: toEnable, storeEnabled: true });
    }
    if (toDisable.length > 0) {
      await toggleMut.mutateAsync({ itemIds: toDisable, storeEnabled: false });
    }

    setPendingChanges(new Map());
    onClose();
  }

  function handleClose() {
    setPendingChanges(new Map());
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Manage Store Items" className="max-w-xl">
      {/* Search */}
      <div className="mb-4">
        <input
          className="input w-full"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Item list */}
      <div className="max-h-[400px] overflow-y-auto -mx-6 px-6 divide-y divide-border-light">
        {isLoading ? (
          <div className="py-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-12 rounded-lg" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-tertiary">
            {search ? "No items match your search" : "No items found"}
          </div>
        ) : (
          filteredItems.map((item: any) => {
            const enabled = getEffectiveEnabled(item);
            const isPending = pendingChanges.has(item.id);
            return (
              <div
                key={item.id}
                onClick={() => toggleItem(item.id, item.storeEnabled)}
                className={cn(
                  "flex items-center gap-3 py-3 cursor-pointer transition-colors",
                  isPending ? "bg-brand-600/5" : "hover:bg-surface-1",
                )}
              >
                {/* Checkbox */}
                <div
                  className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    enabled ? "bg-brand-600 border-brand-600" : "border-border-light",
                  )}
                >
                  {enabled && (
                    <svg
                      className="w-3 h-3 text-white"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
                  <p className="text-xs text-text-tertiary">
                    {item.category || "Uncategorized"} · {formatCurrency(item.salePrice ?? "0")} / {item.unit}
                  </p>
                </div>

                {isPending && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    {enabled ? "Adding" : "Removing"}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border-light">
        <p className="text-xs text-text-tertiary">
          {changeCount > 0
            ? `${changeCount} change${changeCount > 1 ? "s" : ""} pending`
            : "Click items to add or remove"}
        </p>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={applyChanges}
            disabled={changeCount === 0 || toggleMut.isPending}
          >
            {toggleMut.isPending
              ? "Saving..."
              : `Apply ${changeCount} Change${changeCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Store Items card (summary + modal trigger)
// ---------------------------------------------------------------------------

function StoreItemsCard() {
  const [showModal, setShowModal] = useState(false);

  const { data: itemsResponse, isLoading } = trpc.store.listStoreItems.useQuery({
    limit: 100,
    page: 1,
  });
  const items: any[] = itemsResponse?.data ?? [];

  const enabledItems = items.filter((item: any) => item.storeEnabled);
  const enabledCount = enabledItems.length;
  const totalCount = items.length;

  return (
    <>
      <div className="card p-6 mt-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Store Items</h3>
            {isLoading ? (
              <div className="skeleton h-3 w-32 mt-1" />
            ) : (
              <p className="text-xs text-text-tertiary">
                {enabledCount} of {totalCount} items on your store
              </p>
            )}
          </div>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            Manage Items
          </button>
        </div>

        {/* Quick preview: show first 8 enabled items */}
        {enabledItems.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {enabledItems.slice(0, 8).map((item: any) => (
              <span
                key={item.id}
                className="text-xs px-2.5 py-1 rounded-lg bg-brand-600/10 text-brand-700 dark:text-brand-400"
              >
                {item.name}
              </span>
            ))}
            {enabledItems.length > 8 && (
              <span className="text-xs px-2.5 py-1 rounded-lg bg-surface-2 text-text-tertiary">
                +{enabledItems.length - 8} more
              </span>
            )}
          </div>
        )}
      </div>

      <StoreItemsModal open={showModal} onClose={() => setShowModal(false)} />
    </>
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
