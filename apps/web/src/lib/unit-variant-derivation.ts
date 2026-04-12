/**
 * Unit variant price derivation helpers.
 *
 * Hisaabo standardises on Direction A for alternate-unit conversions:
 *   conversionFactor = "base units per 1 alt unit"
 * so for rice priced at ₹100/kg with 1 packet = 0.2 kg:
 *   - user types 0.2 as the conversion factor
 *   - derived alt price = basePrice × CF = 100 × 0.2 = 20
 *
 * This matches:
 *   - `packages/api/src/lib/document-router-factory.ts` stock formula
 *     (baseDecrement = altQty × CF)
 *   - `apps/web/src/components/ImportWizard.tsx` unit-conflict prompt
 *     ("1 {alt} = ? {base}")
 *
 * All money values in the UI layer are strings matching the
 * `NUMERIC(15,2)` database format. Derived prices are produced with
 * `.toFixed(2)` so they validate against `unitVariantSchema.salePrice`
 * (`^\d{1,13}(\.\d{1,2})?$`).
 */

/** Shape stored by the form for each alternate-unit row. */
export interface UiUnitVariant {
  unit: string;
  conversionFactor: number;
  salePrice: string;
  purchasePrice?: string;
  /**
   * UI-only: `true` once the user has manually typed into `salePrice`,
   * meaning we must not auto-overwrite it from base-price changes.
   * Stripped before sending to the backend.
   */
  __manual?: boolean;
  /**
   * UI-only: captures the base price at the moment the user typed
   * their manual override. The editor compares this against the
   * current base price — if they differ, the row is "stale" and a
   * "Recompute" affordance is shown.
   * Stripped before sending to the backend.
   */
  __manualBasePrice?: string;
}

/**
 * Parse a money string into a finite non-negative number, or `null`
 * when the input is empty or invalid. Never throws.
 */
export function parseMoney(value: string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Parse a conversion factor into a strictly-positive finite number,
 * or `null` otherwise. Conversion factors of 0 are treated as invalid
 * because they would produce `altPrice = 0` regardless of base price.
 */
export function parseCF(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Derive the alt-unit sale price from the base price and conversion
 * factor, returning a `NUMERIC(15,2)`-compatible string.
 *
 * Formula: `altPrice = basePrice × conversionFactor`
 *
 * Returns `null` if either input is missing or invalid so the caller
 * can fall back to existing state instead of writing a bogus value.
 */
export function deriveAltPrice(
  basePrice: string | undefined | null,
  conversionFactor: number | string | undefined | null,
): string | null {
  const base = parseMoney(basePrice);
  const cf = parseCF(conversionFactor);
  if (base == null || cf == null) return null;
  return (base * cf).toFixed(2);
}

/**
 * Strip UI-only fields (`__manual`, `__manualBasePrice`) from a
 * variant row before sending it to the backend. The server only
 * accepts `{ unit, conversionFactor, salePrice, purchasePrice? }` and
 * rejects unknown keys via `unitVariantSchema`.
 */
export function toPayloadVariant(v: UiUnitVariant): {
  unit: string;
  conversionFactor: number;
  salePrice: string;
  purchasePrice?: string;
} {
  const payload: {
    unit: string;
    conversionFactor: number;
    salePrice: string;
    purchasePrice?: string;
  } = {
    unit: v.unit,
    conversionFactor: v.conversionFactor,
    salePrice: v.salePrice,
  };
  if (v.purchasePrice != null && v.purchasePrice !== "") {
    payload.purchasePrice = v.purchasePrice;
  }
  return payload;
}

/**
 * Apply a field update to a variant row at `idx`, auto-deriving
 * `salePrice` from `basePrice × conversionFactor` when the user
 * changes `conversionFactor` and has not manually overridden the
 * price for that row.
 *
 * Flags:
 *   - When `field === "salePrice"` the user is typing directly into
 *     the price input, so we mark `__manual = true` and stamp
 *     `__manualBasePrice` with the current base so the editor can
 *     later detect a stale override if the base changes.
 *   - When `field === "conversionFactor"` and the row is NOT in
 *     manual mode, we recompute `salePrice` from the current
 *     `basePrice`. If the row IS in manual mode we leave the price
 *     untouched — the user's override wins.
 *   - Any other field (e.g. `unit`, `purchasePrice`) passes
 *     straight through.
 */
export function updateVariantField(
  variants: UiUnitVariant[],
  idx: number,
  field: string,
  value: string,
  basePrice: string,
): UiUnitVariant[] {
  return variants.map((v, i) => {
    if (i !== idx) return v;

    if (field === "conversionFactor") {
      const nextCf = parseFloat(value);
      const normalizedCf = Number.isFinite(nextCf) ? nextCf : 0;
      const next: UiUnitVariant = { ...v, conversionFactor: normalizedCf };
      if (!v.__manual) {
        const derived = deriveAltPrice(basePrice, normalizedCf);
        if (derived != null) next.salePrice = derived;
      }
      return next;
    }

    if (field === "salePrice") {
      return {
        ...v,
        salePrice: value,
        __manual: true,
        __manualBasePrice: basePrice,
      };
    }

    if (field === "unit" || field === "purchasePrice") {
      return { ...v, [field]: value };
    }

    return { ...v, [field]: value };
  });
}

/**
 * Recompute all non-manual variant salePrices when the base price
 * changes. Manual rows are left untouched — the editor detects the
 * mismatch between the current `basePrice` and the row's
 * `__manualBasePrice` to render a "base changed · Recompute" hint.
 */
export function recomputeOnBasePriceChange(
  variants: UiUnitVariant[],
  newBasePrice: string,
): UiUnitVariant[] {
  return variants.map((v) => {
    if (v.__manual) return v;
    const derived = deriveAltPrice(newBasePrice, v.conversionFactor);
    if (derived == null) return v;
    return { ...v, salePrice: derived };
  });
}

/**
 * Explicitly re-sync a single variant row: derive the price from the
 * current base price and clear the manual flags. Invoked when the
 * user clicks the "Recompute" affordance.
 */
export function recomputeSingleRow(
  variants: UiUnitVariant[],
  idx: number,
  basePrice: string,
): UiUnitVariant[] {
  return variants.map((v, i) => {
    if (i !== idx) return v;
    const derived = deriveAltPrice(basePrice, v.conversionFactor);
    return {
      ...v,
      salePrice: derived ?? v.salePrice,
      __manual: false,
      __manualBasePrice: undefined,
    };
  });
}
