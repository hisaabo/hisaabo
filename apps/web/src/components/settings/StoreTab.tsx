import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { Modal } from "@/components/ui/Modal";
import { PhoneInput } from "./PhoneInput";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IS_DEV = import.meta.env.DEV;
const STORE_PREFIX = IS_DEV ? "localhost:5174/store/" : "store.hisaabo.in/";

function buildStoreUrl(slug: string) {
  const origin = IS_DEV ? "http://localhost:5174" : "https://store.hisaabo.in";
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
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        checked ? "bg-brand-600" : "bg-border-light dark:bg-surface-3",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
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

  // Slug is locked once saved — cannot be changed
  const isSlugLocked = !!settings?.storeSlug;

  // Debounce slug for availability check (only when not locked)
  const debouncedSlug = useDebounce(effectiveSlug, 500);
  const { data: slugCheck, isFetching: slugChecking } = trpc.store.checkSlug.useQuery(
    { slug: debouncedSlug },
    {
      enabled: !isSlugLocked && debouncedSlug.length >= 3,
    },
  );

  const slugStatus: "idle" | "checking" | "available" | "taken" =
    isSlugLocked
      ? "idle"
      : debouncedSlug.length < 3
        ? "idle"
        : slugChecking || slugCheck === undefined
          ? "checking"
          : slugCheck.available
            ? "available"
            : "taken";

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
          <div className="relative flex-1">
            <input
              className={cn(
                "input rounded-l-none w-full",
                isSlugLocked && "bg-surface-1 text-text-tertiary cursor-not-allowed",
              )}
              value={effectiveSlug}
              onChange={(e) => !isSlugLocked && setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="your-business"
              maxLength={50}
              disabled={isSlugLocked}
              readOnly={isSlugLocked}
            />
            {/* Slug status indicator */}
            {!isSlugLocked && slugStatus !== "idle" && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                {slugStatus === "checking" && (
                  <svg className="w-4 h-4 text-text-tertiary animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {slugStatus === "available" && (
                  <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                {slugStatus === "taken" && (
                  <svg className="w-4 h-4 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </span>
            )}
            {isSlugLocked && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="w-4 h-4 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              </span>
            )}
          </div>
        </div>
        {isSlugLocked ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
            Store URL cannot be changed once set
          </p>
        ) : slugStatus === "taken" ? (
          <p className="text-[11px] text-red-500 mt-1">
            This URL is already taken. Please choose a different one.
          </p>
        ) : slugStatus === "available" ? (
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
            This URL is available!
          </p>
        ) : (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
            Choose carefully — this cannot be changed later
          </p>
        )}
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

  const debouncedSearch = useDebounce(search, 300);

  // Server-side filtered items — passes search term to API so results aren't capped at 100 items
  const { data: itemsResponse, isLoading } = trpc.store.listStoreItems.useQuery(
    { limit: 100, page: 1, search: debouncedSearch || undefined },
    { enabled: open },
  );
  const items: any[] = itemsResponse?.data ?? [];

  const toggleMut = trpc.store.bulkToggleItems.useMutation({
    onSuccess: () => {
      utils.store.listStoreItems.invalidate();
    },
    onError: (err) => toast.error("Failed to update items", err.message),
  });

  // Items are already filtered server-side; no client-side filter needed
  const filteredItems = useMemo(() => items, [items]);

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
    // Invalidate ALL store item queries so the parent card refreshes counts + pills
    await utils.store.listStoreItems.invalidate();
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
  const totalCount = itemsResponse?.total ?? items.length; // use server total, not capped array length

  const enabledItems = items.filter((item: any) => item.storeEnabled);
  // For enabled count, also use the total from a filtered query if available
  const { data: enabledResponse } = trpc.store.listStoreItems.useQuery({
    limit: 1,
    page: 1,
    storeEnabled: true,
  });
  const enabledCount = enabledResponse?.total ?? enabledItems.length;

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
