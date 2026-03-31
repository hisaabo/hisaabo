import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
// ── Built-in delivery methods (always available) ─────────────────────────

const BUILT_IN_METHODS = [
  { id: "self_pickup", label: "Self Pickup", description: "Customer picks up from your location", hasTracking: false },
  { id: "hand_delivery", label: "Self / Driver", description: "Delivered by you or your delivery person", hasTracking: false },
  { id: "bus", label: "Bus / Parcel Service", description: "Sent via bus parcel — no tracking", hasTracking: false },
  { id: "transport", label: "Transport", description: "Goods transport / logistics company", hasTracking: false },
  { id: "courier", label: "Courier", description: "Courier service with tracking", hasTracking: true },
  { id: "post", label: "India Post", description: "Speed Post / Registered Post", hasTracking: true },
] as const;

// ── Known carriers for API integration ───────────────────────────────────

const KNOWN_CARRIERS = [
  { slug: "delhivery", name: "Delhivery", hasApi: true },
  { slug: "bluedart", name: "BlueDart", hasApi: true },
  { slug: "dtdc", name: "DTDC", hasApi: true },
  { slug: "ecom_express", name: "Ecom Express", hasApi: true },
  { slug: "india_post", name: "India Post", hasApi: true },
  { slug: "shadowfax", name: "Shadowfax", hasApi: true },
  { slug: "xpressbees", name: "Xpressbees", hasApi: true },
] as const;

// ── Types ────────────────────────────────────────────────────────────────

interface CustomMethod {
  id: string;
  label: string;
  hasTracking: boolean;
}

interface CarrierCreds {
  apiKey?: string;
  apiSecret?: string;
  accountId?: string;
  enabled: boolean;
}

interface ShippingTabProps {
  biz: {
    id: string;
    customShippingMethods?: CustomMethod[] | null;
    carrierCredentials?: Record<string, CarrierCreds> | null;
  };
}

export function ShippingTab({ biz }: ShippingTabProps) {
  const utils = trpc.useUtils();
  const updateBiz = trpc.business.update.useMutation({
    onSuccess: () => {
      utils.business.list.invalidate();
      toast.success("Shipping settings saved");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Custom methods state ───────────────────────────────────────────────
  const [customMethods, setCustomMethods] = useState<CustomMethod[]>(
    () => biz.customShippingMethods || []
  );
  const [newMethodLabel, setNewMethodLabel] = useState("");
  const [newMethodTracking, setNewMethodTracking] = useState(false);

  function addCustomMethod() {
    const label = newMethodLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (customMethods.some((m) => m.id === id)) {
      toast.error("A method with this name already exists");
      return;
    }
    setCustomMethods([...customMethods, { id, label, hasTracking: newMethodTracking }]);
    setNewMethodLabel("");
    setNewMethodTracking(false);
  }

  function removeCustomMethod(id: string) {
    setCustomMethods(customMethods.filter((m) => m.id !== id));
  }

  // ── Save ───────────────────────────────────────────────────────────────
  function handleSave() {
    updateBiz.mutate({
      customShippingMethods: customMethods.length > 0 ? customMethods : undefined,
    } as any);
  }

  const hasChanges =
    JSON.stringify(customMethods) !== JSON.stringify(biz.customShippingMethods || []);

  return (
    <div className="space-y-8">
      {/* ── Built-in Methods ────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Built-in Delivery Methods</h3>
        <p className="text-xs text-text-tertiary mb-3">
          These are always available when creating invoices. They cannot be removed.
        </p>
        <div className="rounded-xl border border-border-light overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {BUILT_IN_METHODS.map((m) => (
                <tr key={m.id} className="border-b border-border-light last:border-0">
                  <td className="px-4 py-2.5 font-medium text-text-primary">{m.label}</td>
                  <td className="px-4 py-2.5 text-text-tertiary text-xs">{m.description}</td>
                  <td className="px-4 py-2.5 text-right">
                    {m.hasTracking ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 font-medium">
                        Tracking
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-tertiary">No tracking</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Custom Methods ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Custom Delivery Methods</h3>
        <p className="text-xs text-text-tertiary mb-3">
          Add your own shipping channels. These appear alongside built-in methods in the invoice form.
        </p>

        {customMethods.length > 0 && (
          <div className="rounded-xl border border-border-light overflow-hidden mb-3">
            <table className="w-full text-sm">
              <tbody>
                {customMethods.map((m) => (
                  <tr key={m.id} className="border-b border-border-light last:border-0">
                    <td className="px-4 py-2.5 font-medium text-text-primary">{m.label}</td>
                    <td className="px-4 py-2.5 text-xs text-text-tertiary font-mono">{m.id}</td>
                    <td className="px-4 py-2.5">
                      {m.hasTracking ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 font-medium">
                          Tracking
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-tertiary">No tracking</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => removeCustomMethod(m.id)}
                        className="text-red-500 hover:text-red-600 text-xs font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Method name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Dunzo, Porter, Local Tempo"
              value={newMethodLabel}
              onChange={(e) => setNewMethodLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomMethod()}
            />
          </div>
          <label className="flex items-center gap-2 pb-2.5 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={newMethodTracking}
              onChange={(e) => setNewMethodTracking(e.target.checked)}
              className="rounded"
            />
            Has tracking
          </label>
          <button
            onClick={addCustomMethod}
            disabled={!newMethodLabel.trim()}
            className="btn-secondary mb-0.5"
          >
            Add
          </button>
        </div>
      </section>

      {/* ── Carrier API Integration (Coming Soon — SaaS offering) ── */}
      <section className="opacity-60 pointer-events-none select-none">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold text-text-primary">Carrier API Integration</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-2 text-text-tertiary font-medium">Coming Soon</span>
        </div>
        <p className="text-xs text-text-tertiary mb-3">
          Connect carrier accounts for automatic tracking updates and label generation.
          Available as part of Hisaabo Pro.
        </p>
        <div className="space-y-2">
          {KNOWN_CARRIERS.map((carrier) => (
            <div key={carrier.slug} className="rounded-xl border border-border-light px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">{carrier.name}</span>
              <span className="text-[10px] text-text-tertiary">API integration</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Save button ─────────────────────────────────────────────── */}
      {hasChanges && (
        <div className="flex justify-end pt-4 border-t border-border-light">
          <button
            onClick={handleSave}
            disabled={updateBiz.isPending}
            className="btn-primary"
          >
            {updateBiz.isPending ? "Saving..." : "Save Shipping Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
