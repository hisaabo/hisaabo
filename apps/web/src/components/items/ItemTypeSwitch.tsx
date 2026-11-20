import type { ItemType } from "@hisaabo/shared";
import { SegmentedControl } from "@/components/ui/Tabs";
import { cn } from "@/lib/utils";

const TYPE_TABS = [
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
];

export const ITEM_TYPE_LOCK_HINT =
  "Type can't be changed because this item already has invoices, documents or stock movements.";

interface ItemTypeSwitchProps {
  value: ItemType;
  onChange: (v: ItemType) => void;
  /** True when the item is referenced by documents / stock movements (see item.getById.hasTransactions). */
  locked?: boolean;
}

/**
 * Product / Service switch. Once an item has history the type is fixed (the
 * API rejects the change too), so the control is shown disabled with a hint.
 */
export function ItemTypeSwitch({ value, onChange, locked = false }: ItemTypeSwitchProps) {
  if (!locked) {
    return <SegmentedControl tabs={TYPE_TABS} value={value} onChange={(v) => onChange(v as ItemType)} />;
  }
  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label="Item type"
        aria-disabled="true"
        className="inline-flex rounded-lg p-0.5 bg-surface-1 border border-border-light opacity-70"
      >
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            disabled
            aria-pressed={tab.value === value}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed",
              tab.value === value ? "bg-surface-0 shadow-sm text-text-primary" : "text-text-tertiary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-text-tertiary">{ITEM_TYPE_LOCK_HINT}</p>
    </div>
  );
}
