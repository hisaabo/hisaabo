import { useState, useMemo, useEffect } from "react";
import type { StoreItem, StoreImage, CartItem } from "../types";
import { cartItemKey } from "../types";
import { assetUrl } from "../api";

interface ItemDetailProps {
  item: StoreItem;
  cart: CartItem[];
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  currency: string;
  accentColor?: string;
  onClose: () => void;
}

/**
 * Full-screen item view with the complete photo gallery and purchasing UI.
 *
 * Variant alignment: when a specific variant is selected, the gallery narrows
 * to that variant's tagged photos plus the shared (untagged) ones, so each
 * variant shows the right images. With nothing selected we show the whole
 * gallery.
 */
export function ItemDetail({
  item,
  cart,
  onAddToCart,
  onRemoveFromCart,
  currency,
  accentColor,
  onClose,
}: ItemDetailProps) {
  const symbol = currency === "INR" ? "₹" : currency;
  const accent = accentColor || "var(--store-accent)";
  const mode = item.itemMode || "simple";

  const [selectedUnitIndex, setSelectedUnitIndex] = useState(-1);
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>({});
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  // Close on Escape — expected for a modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
            isOutOfStock = true;
            isLowStock = false;
          }
        }
      }

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
        cartEntry = cart.find((c) => cartItemKey(c) === `${item.id}::v::${selectedVariant.id}`);
      }

      return { displayPrice, displayUnit, isOutOfStock, isLowStock, selectedVariant, cartEntry };
    }, [item, cart, mode, selectedUnitIndex, selectedAttrs]);

  // Variant-aware gallery: selected variant's photos + shared (untagged) ones.
  const visibleImages: StoreImage[] = useMemo(() => {
    const all = item.images ?? [];
    if (all.length === 0) return [];
    if (selectedVariant) {
      const matched = all.filter(
        (im) => im.variantId === selectedVariant.id || im.variantId === null,
      );
      return matched.length > 0 ? matched : all;
    }
    return all;
  }, [item.images, selectedVariant]);

  // Keep the active image valid as the visible set changes (variant switch).
  useEffect(() => {
    setActiveImageIdx(0);
  }, [selectedVariant]);

  const activeImage = visibleImages[Math.min(activeImageIdx, visibleImages.length - 1)];
  const qty = cartEntry?.quantity ?? 0;

  const canAdd =
    mode === "simple" ||
    mode === "alt_units" ||
    (mode === "variants" && selectedVariant !== null);

  const variantSelectionIncomplete =
    mode === "variants" &&
    item.variantAttributes &&
    !item.variantAttributes.every((a) => selectedAttrs[a]);

  function handleAdd() {
    if (!canAdd || isOutOfStock) return;
    if (mode === "alt_units" && selectedUnitIndex >= 0 && item.unitVariants?.[selectedUnitIndex]) {
      const uv = item.unitVariants[selectedUnitIndex];
      onAddToCart({ item, selectedUnit: uv.unit, conversionFactor: uv.conversionFactor, effectivePrice: uv.price });
    } else if (mode === "variants" && selectedVariant) {
      onAddToCart({ item, selectedVariantId: selectedVariant.id, effectivePrice: selectedVariant.price });
    } else {
      onAddToCart({ item, effectivePrice: item.price });
    }
  }

  function handleRemove() {
    if (cartEntry) onRemoveFromCart(cartItemKey(cartEntry));
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content" onClick={onClose}>
        <div
          className="w-full max-w-lg max-h-[90dvh] rounded-2xl overflow-hidden flex flex-col animate-scale-in"
          style={{ background: "var(--store-bg)", boxShadow: "var(--store-shadow-xl)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <div className="flex justify-end p-3 pb-0 absolute right-0 z-10">
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full"
              style={{ background: "var(--store-bg-alt)" }}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="overflow-y-auto">
            {/* Gallery */}
            {activeImage ? (
              <div>
                <div
                  className="w-full aspect-square overflow-hidden"
                  style={{ background: "var(--store-bg-secondary)" }}
                >
                  <img
                    key={activeImage.id}
                    src={assetUrl(activeImage.url)}
                    alt={activeImage.alt || item.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                {visibleImages.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
                    {visibleImages.map((im, i) => (
                      <button
                        key={im.id}
                        onClick={() => setActiveImageIdx(i)}
                        className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all"
                        style={{
                          borderColor: i === activeImageIdx ? accent : "transparent",
                        }}
                        aria-label={`Image ${i + 1}`}
                      >
                        <img
                          src={assetUrl(im.url)}
                          alt={im.alt || `${item.name} ${i + 1}`}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-4" />
            )}

            {/* Info */}
            <div className="px-5 pb-5 pt-2">
              {item.category && (
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--store-muted)" }}
                >
                  {item.category}
                </span>
              )}
              <h2
                className="text-[20px] font-bold leading-tight mt-1"
                style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
              >
                {item.name}
              </h2>

              {/* Price */}
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="text-[22px] font-bold tracking-tight" style={{ color: "var(--store-text)" }}>
                  {symbol}{formatPrice(displayPrice)}
                </span>
                <span className="text-[12px]" style={{ color: "var(--store-muted)" }}>
                  per {displayUnit}
                </span>
              </div>

              {item.description && (
                <p
                  className="text-[13px] leading-relaxed mt-3 whitespace-pre-line"
                  style={{ color: "var(--store-text-secondary)" }}
                >
                  {item.description}
                </p>
              )}

              {/* Alt-unit selector */}
              {mode === "alt_units" && item.unitVariants && item.unitVariants.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  <UnitPill
                    label={item.unit}
                    price={`${symbol}${formatPrice(item.price)}`}
                    selected={selectedUnitIndex === -1}
                    accent={accent}
                    onClick={() => setSelectedUnitIndex(-1)}
                  />
                  {item.unitVariants.map((uv, i) => (
                    <UnitPill
                      key={uv.unit}
                      label={uv.unit}
                      price={`${symbol}${formatPrice(uv.price)}`}
                      selected={selectedUnitIndex === i}
                      accent={accent}
                      onClick={() => setSelectedUnitIndex(i)}
                    />
                  ))}
                </div>
              )}

              {/* Variant selectors */}
              {mode === "variants" && item.variantAttributes && item.variants && (
                <div className="mt-4 space-y-3">
                  {item.variantAttributes.map((attr) => {
                    const values = Array.from(
                      new Set(item.variants!.map((v) => v.attributes[attr]).filter(Boolean))
                    );
                    return (
                      <div key={attr}>
                        <span
                          className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5"
                          style={{ color: "var(--store-muted)" }}
                        >
                          {attr}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {values.map((val) => {
                            const isSelected = selectedAttrs[attr] === val;
                            const isAvailable = isValueAvailable(
                              item.variants!, item.variantAttributes!, selectedAttrs, attr, val,
                            );
                            return (
                              <button
                                key={val}
                                onClick={() =>
                                  setSelectedAttrs((prev) => ({
                                    ...prev,
                                    [attr]: prev[attr] === val ? "" : val,
                                  }))
                                }
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
            </div>
          </div>

          {/* Sticky action bar */}
          <div
            className="border-t px-5 py-3.5 flex items-center justify-between gap-3"
            style={{ borderColor: "var(--store-border)", background: "var(--store-bg)" }}
          >
            {isOutOfStock && !variantSelectionIncomplete ? (
              <span className="badge badge-sold-out">Sold out</span>
            ) : variantSelectionIncomplete ? (
              <span className="text-[13px] font-medium" style={{ color: "var(--store-muted)" }}>
                Select options to continue
              </span>
            ) : (
              <span className="text-[13px] font-medium" style={{ color: "var(--store-text-secondary)" }}>
                {isLowStock ? "Only a few left" : "In stock"}
              </span>
            )}

            {!isOutOfStock && !variantSelectionIncomplete && (
              qty === 0 ? (
                <button
                  onClick={handleAdd}
                  className="px-6 py-2.5 rounded-xl text-white font-semibold text-[14px] active:scale-[0.98] transition-transform"
                  style={{ background: accent }}
                >
                  Add to cart
                </button>
              ) : (
                <div className="qty-stepper" style={{ borderColor: accent }}>
                  <button onClick={handleRemove} style={{ color: accent }} aria-label="Remove">
                    <span>&minus;</span>
                  </button>
                  <span className="qty-value" style={{ color: accent }}>{qty}</span>
                  <button onClick={handleAdd} className="qty-add" style={{ background: accent }} aria-label="Add more">
                    +
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UnitPill({
  label, price, selected, accent, onClick,
}: { label: string; price: string; selected: boolean; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="unit-pill"
      style={
        selected
          ? { background: accent, color: "white", borderColor: accent }
          : { background: "var(--store-bg)", color: "var(--store-text-secondary)", borderColor: "var(--store-border)" }
      }
    >
      <span className="text-[11px] font-semibold">{label}</span>
      <span className="text-[11px] font-bold">{price}</span>
    </button>
  );
}

function isValueAvailable(
  variants: NonNullable<StoreItem["variants"]>,
  allAttributes: string[],
  selectedAttrs: Record<string, string>,
  currentAttr: string,
  value: string,
): boolean {
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

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (Number.isInteger(num)) return num.toLocaleString("en-IN");
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      style={{ color: "var(--store-text-secondary)" }}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
