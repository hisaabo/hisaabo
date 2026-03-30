import { useState, useMemo } from "react";
import type { StoreItem, CartItem } from "../types";
import { cartItemKey } from "../types";

interface ItemCardProps {
  item: StoreItem;
  cart: CartItem[];
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  currency: string;
  accentColor?: string;
}

export function ItemCard({
  item,
  cart,
  onAddToCart,
  onRemoveFromCart,
  currency,
  accentColor,
}: ItemCardProps) {
  const symbol = currency === "INR" ? "\u20B9" : currency;
  const accent = accentColor || "var(--store-accent)";
  const mode = item.itemMode || "simple";

  // --- Alt units state ---
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(-1); // -1 = base unit

  // --- Variant state ---
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>({});

  // Derive effective price + stock for the current selection
  const { displayPrice, displayUnit, isOutOfStock, isLowStock, selectedVariant, cartEntry } =
    useMemo(() => {
      let displayPrice = item.price;
      let displayUnit = item.unit;
      let isOutOfStock = !item.inStock && !item.lowStock;
      let isLowStock = item.lowStock === true;
      let selectedVariant: NonNullable<StoreItem["variants"]>[number] | null = null;

      if (mode === "alt_units" && selectedUnitIndex >= 0 && item.unitVariants?.[selectedUnitIndex]) {
        const uv = item.unitVariants[selectedUnitIndex];
        displayPrice = uv.price;
        displayUnit = uv.unit;
      }

      if (mode === "variants" && item.variantAttributes && item.variants) {
        const allSelected = item.variantAttributes.every((a) => selectedAttrs[a]);
        if (allSelected) {
          const match = item.variants.find((v) =>
            item.variantAttributes!.every((a) => v.attributes[a] === selectedAttrs[a])
          );
          if (match) {
            selectedVariant = match;
            displayPrice = match.price;
            isOutOfStock = !match.inStock;
            isLowStock = false;
          } else {
            // No matching variant for this combination
            isOutOfStock = true;
            isLowStock = false;
          }
        }
      }

      // Find matching cart entry
      let cartEntry: CartItem | undefined;
      if (mode === "simple") {
        cartEntry = cart.find((c) => cartItemKey(c) === item.id);
      } else if (mode === "alt_units") {
        const unitKey =
          selectedUnitIndex >= 0 && item.unitVariants?.[selectedUnitIndex]
            ? `${item.id}::u::${item.unitVariants[selectedUnitIndex].unit}`
            : item.id;
        cartEntry = cart.find((c) => cartItemKey(c) === unitKey);
      } else if (mode === "variants" && selectedVariant) {
        const variantKey = `${item.id}::v::${selectedVariant.id}`;
        cartEntry = cart.find((c) => cartItemKey(c) === variantKey);
      }

      return { displayPrice, displayUnit, isOutOfStock, isLowStock, selectedVariant, cartEntry };
    }, [item, cart, mode, selectedUnitIndex, selectedAttrs]);

  const qty = cartEntry?.quantity ?? 0;

  // Can the user add to cart?
  const canAdd =
    mode === "simple" ||
    mode === "alt_units" ||
    (mode === "variants" && selectedVariant !== null);

  function handleAdd() {
    if (!canAdd || isOutOfStock) return;

    if (mode === "alt_units" && selectedUnitIndex >= 0 && item.unitVariants?.[selectedUnitIndex]) {
      const uv = item.unitVariants[selectedUnitIndex];
      onAddToCart({
        item,
        selectedUnit: uv.unit,
        conversionFactor: uv.conversionFactor,
        effectivePrice: uv.price,
      });
    } else if (mode === "variants" && selectedVariant) {
      onAddToCart({
        item,
        selectedVariantId: selectedVariant.id,
        effectivePrice: selectedVariant.price,
      });
    } else {
      // Simple or alt_units with base unit selected
      onAddToCart({
        item,
        effectivePrice: item.price,
      });
    }
  }

  function handleRemove() {
    if (cartEntry) {
      onRemoveFromCart(cartItemKey(cartEntry));
    }
  }

  // Determine if variant selection is incomplete
  const variantSelectionIncomplete =
    mode === "variants" &&
    item.variantAttributes &&
    !item.variantAttributes.every((a) => selectedAttrs[a]);

  return (
    <div
      className="product-card"
      style={{ opacity: isOutOfStock && !variantSelectionIncomplete ? 0.55 : 1 }}
    >
      <div className="flex flex-col p-3.5 flex-1">
        {/* Category tag */}
        {item.category && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--store-muted)" }}
          >
            {item.category}
          </span>
        )}

        {/* Item name */}
        <h3
          className="text-[13.5px] font-semibold leading-snug line-clamp-2 mb-0.5"
          style={{ color: "var(--store-text)", letterSpacing: "-0.01em" }}
        >
          {item.name}
        </h3>

        {/* Description */}
        {item.description && (
          <p
            className="text-[11px] leading-relaxed line-clamp-2 mt-0.5"
            style={{ color: "var(--store-muted)" }}
          >
            {item.description}
          </p>
        )}

        {/* Alt-unit selector pills */}
        {mode === "alt_units" && item.unitVariants && item.unitVariants.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <button
              onClick={() => setSelectedUnitIndex(-1)}
              className="unit-pill"
              style={
                selectedUnitIndex === -1
                  ? { background: accent, color: "white", borderColor: accent }
                  : {
                      background: "var(--store-bg)",
                      color: "var(--store-text-secondary)",
                      borderColor: "var(--store-border)",
                    }
              }
            >
              <span className="text-[10px] font-semibold">{item.unit}</span>
              <span className="text-[10px] font-bold">{symbol}{formatPrice(item.price)}</span>
            </button>
            {item.unitVariants.map((uv, i) => (
              <button
                key={uv.unit}
                onClick={() => setSelectedUnitIndex(i)}
                className="unit-pill"
                style={
                  selectedUnitIndex === i
                    ? { background: accent, color: "white", borderColor: accent }
                    : {
                        background: "var(--store-bg)",
                        color: "var(--store-text-secondary)",
                        borderColor: "var(--store-border)",
                      }
                }
              >
                <span className="text-[10px] font-semibold">{uv.unit}</span>
                <span className="text-[10px] font-bold">{symbol}{formatPrice(uv.price)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Variant attribute selectors */}
        {mode === "variants" && item.variantAttributes && item.variants && (
          <div className="mt-2.5 space-y-2">
            {item.variantAttributes.map((attr) => {
              // Get unique values for this attribute
              const values = Array.from(
                new Set(item.variants!.map((v) => v.attributes[attr]).filter(Boolean))
              );
              return (
                <div key={attr}>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider block mb-1"
                    style={{ color: "var(--store-muted)" }}
                  >
                    {attr}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {values.map((val) => {
                      const isSelected = selectedAttrs[attr] === val;
                      // Check if this value is available with current other selections
                      const isAvailable = isValueAvailable(
                        item.variants!,
                        item.variantAttributes!,
                        selectedAttrs,
                        attr,
                        val
                      );
                      return (
                        <button
                          key={val}
                          onClick={() => {
                            setSelectedAttrs((prev) => ({
                              ...prev,
                              [attr]: prev[attr] === val ? "" : val,
                            }));
                          }}
                          className="variant-pill"
                          disabled={!isAvailable}
                          style={
                            isSelected
                              ? { background: accent, color: "white", borderColor: accent }
                              : !isAvailable
                                ? {
                                    background: "var(--store-bg-secondary)",
                                    color: "var(--store-muted)",
                                    borderColor: "var(--store-border-light)",
                                    opacity: 0.5,
                                    cursor: "not-allowed",
                                  }
                                : {
                                    background: "var(--store-bg)",
                                    color: "var(--store-text-secondary)",
                                    borderColor: "var(--store-border)",
                                  }
                          }
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Spacer pushes price + action to bottom */}
        <div className="flex-1 min-h-3" />

        {/* Price row */}
        <div className="flex items-end justify-between gap-2 mt-2">
          <div>
            <p
              className="text-[15px] font-bold tracking-tight leading-tight"
              style={{ color: "var(--store-text)" }}
            >
              {symbol}{formatPrice(displayPrice)}
            </p>
            <p
              className="text-[10px] mt-0.5"
              style={{ color: "var(--store-muted)" }}
            >
              per {displayUnit}
            </p>
          </div>

          {/* Action */}
          {isOutOfStock && !variantSelectionIncomplete ? (
            <span className="badge badge-sold-out">Sold out</span>
          ) : variantSelectionIncomplete ? (
            <span
              className="text-[10px] font-medium"
              style={{ color: "var(--store-muted)" }}
            >
              Select options
            </span>
          ) : isLowStock ? (
            <div className="flex flex-col items-end gap-1">
              <span className="badge badge-low-stock">Low stock</span>
              {qty === 0 ? (
                <button
                  onClick={handleAdd}
                  className="add-btn"
                  style={{ borderColor: accent, color: accent }}
                  aria-label={`Add ${item.name}`}
                >
                  ADD
                </button>
              ) : (
                <QuantityStepper
                  qty={qty}
                  accent={accent}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                />
              )}
            </div>
          ) : qty === 0 ? (
            <button
              onClick={handleAdd}
              className="add-btn"
              style={{ borderColor: accent, color: accent }}
              aria-label={`Add ${item.name}`}
            >
              ADD
            </button>
          ) : (
            <QuantityStepper
              qty={qty}
              accent={accent}
              onAdd={handleAdd}
              onRemove={handleRemove}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Check if a variant attribute value is available given current selections on other attributes */
function isValueAvailable(
  variants: NonNullable<StoreItem["variants"]>,
  allAttributes: string[],
  selectedAttrs: Record<string, string>,
  currentAttr: string,
  value: string
): boolean {
  // A value is available if there exists at least one in-stock variant
  // that matches the current selections for OTHER attributes AND has this value
  return variants.some((v) => {
    if (v.attributes[currentAttr] !== value) return false;
    if (!v.inStock) return false;
    for (const attr of allAttributes) {
      if (attr === currentAttr) continue;
      if (selectedAttrs[attr] && v.attributes[attr] !== selectedAttrs[attr]) return false;
    }
    return true;
  });
}

function QuantityStepper({
  qty,
  accent,
  onAdd,
  onRemove,
}: {
  qty: number;
  accent: string;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="qty-stepper" style={{ borderColor: accent }}>
      <button
        onClick={onRemove}
        style={{ color: accent }}
        aria-label="Remove"
      >
        {qty === 1 ? (
          <TrashIcon size={13} color={accent} />
        ) : (
          <span>&minus;</span>
        )}
      </button>
      <span className="qty-value" style={{ color: accent }}>
        {qty}
      </span>
      <button
        onClick={onAdd}
        className="qty-add"
        style={{ background: accent }}
        aria-label="Add more"
      >
        +
      </button>
    </div>
  );
}

function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (Number.isInteger(num)) return num.toLocaleString("en-IN");
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
