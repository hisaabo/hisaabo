/**
 * UnitVariantEditor — shared UI for editing alternate-unit rows.
 *
 * Used by both the "Add Item" and "Edit Item" slide-overs in
 * `apps/web/src/routes/items.tsx`. Both modes have identical editing
 * semantics for alt-unit rows, so the JSX lives here to keep the two
 * screens from drifting over time.
 *
 * The editor is purely controlled: it receives the variants array and
 * calls `onChange` with the next array. All derivation logic lives in
 * `apps/web/src/lib/unit-variant-derivation.ts` so it can be unit-
 * tested without a DOM.
 *
 * Conversion direction is Direction A — conversionFactor means
 * "base units per 1 alt unit". See the derivation module for the
 * rationale.
 */

import { Combobox } from "@/components/ui/Combobox";
import { InputField } from "@/components/ui/FormField";
import { cn } from "@/lib/utils";
import {
  type UiUnitVariant,
  recomputeSingleRow,
  updateVariantField,
  deriveAltPrice,
} from "@/lib/unit-variant-derivation";

export interface UnitVariantEditorProps {
  /** Current array of variant rows (UI state including __manual flags). */
  variants: UiUnitVariant[];
  /** Setter for the variant rows — receives the new array. */
  onChange: (next: UiUnitVariant[]) => void;
  /** Base unit label used for hints ("1 packet = ? kg"). */
  baseUnit: string;
  /** Current base sale price as a string — used to derive alt prices. */
  basePrice: string;
  /**
   * Compatible unit options for each alt-unit row, filtered to exclude
   * units already in use by other rows. The caller supplies this so
   * the parent retains full control of which units are selectable.
   */
  getAvailableUnits: (rowIndex: number) => Array<{ value: string; label: string }>;
  /** Remove a variant row at `idx`. */
  onRemoveRow: (idx: number) => void;
  /** Append a new blank variant row. */
  onAddRow: () => void;
}

export function UnitVariantEditor({
  variants,
  onChange,
  baseUnit,
  basePrice,
  getAvailableUnits,
  onRemoveRow,
  onAddRow,
}: UnitVariantEditorProps) {
  function update(idx: number, field: string, value: string) {
    onChange(updateVariantField(variants, idx, field, value, basePrice));
  }

  function recompute(idx: number) {
    onChange(recomputeSingleRow(variants, idx, basePrice));
  }

  return (
    <div className="space-y-2">
      {variants.map((v, i) => {
        const availableUnits = getAvailableUnits(i);
        const altLabel = v.unit || "alt";
        const showPreview = Boolean(v.unit && v.conversionFactor > 0 && v.salePrice);
        // A manual row is "stale" when the base price has changed
        // since the override was typed. We compare against the
        // snapshot we took at override time.
        const isStale =
          v.__manual && v.__manualBasePrice != null && v.__manualBasePrice !== basePrice;
        const staleDerived = isStale ? deriveAltPrice(basePrice, v.conversionFactor) : null;

        return (
          <div key={i} className="space-y-1">
            <div className="grid grid-cols-[1fr_80px_90px_28px] gap-2 items-end">
              <Combobox
                label={i === 0 ? "Unit" : ""}
                value={v.unit}
                onChange={(val) => update(i, "unit", val)}
                options={availableUnits}
                placeholder="Search unit"
              />
              <InputField
                label={i === 0 ? `1 ${altLabel} = ? ${baseUnit}` : ""}
                type="number"
                min="0.01"
                step="any"
                value={String(v.conversionFactor)}
                onChange={(e) => update(i, "conversionFactor", e.target.value)}
                placeholder="e.g. 0.2"
                title={i === 0 ? `How many ${baseUnit} is in one ${altLabel}?` : undefined}
              />
              <InputField
                label={i === 0 ? "Sale Price (₹)" : ""}
                type="number"
                step="0.01"
                min="0"
                value={v.salePrice}
                onChange={(e) => update(i, "salePrice", e.target.value)}
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={() => onRemoveRow(i)}
                className={cn(
                  "p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 transition-colors",
                  i === 0 ? "mb-0.5" : "",
                )}
                aria-label="Remove alternate unit"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {showPreview && (
              <p className="text-[11px] text-text-tertiary pl-0.5">
                1 {v.unit} = {v.conversionFactor} {baseUnit} → ₹{v.salePrice} each
                {v.__manual && !staleDerived && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => recompute(i)}
                      className="text-brand-600 hover:text-brand-700 underline"
                    >
                      Recompute from ₹{basePrice || "0"}/{baseUnit}
                    </button>
                  </>
                )}
                {staleDerived && (
                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                    {" · "}
                    <span aria-hidden="true">⚠</span> base changed ·{" "}
                    <button
                      type="button"
                      onClick={() => recompute(i)}
                      className="underline hover:text-amber-700 dark:hover:text-amber-300"
                    >
                      Recompute to ₹{staleDerived}
                    </button>
                  </span>
                )}
              </p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAddRow}
        className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
      >
        + Add alternate unit
      </button>

      {variants.length > 0 && baseUnit && (
        <p className="text-[11px] text-text-tertiary mt-1">
          Base: {baseUnit.toUpperCase()}. Enter how many {baseUnit} fit in 1 of each alt unit — prices auto-compute.
        </p>
      )}
    </div>
  );
}
