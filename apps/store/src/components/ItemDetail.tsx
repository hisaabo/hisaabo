import { useEffect, useId, useMemo, useState } from "react";
import type { StoreItem, StoreImage, CartItem } from "../types";
import { assetUrl } from "../api";
import { formatMoney } from "../money";
import { availabilityText, showLowStockBadge } from "../stock";
import { useItemSelection } from "../useItemSelection";
import { AddControl } from "./AddControl";
import { Dialog } from "./Dialog";
import { ItemOptions } from "./ItemOptions";

interface ItemDetailProps {
  item: StoreItem;
  cart: CartItem[];
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  currency: string;
  onClose: () => void;
}

/**
 * One item in full, with its whole photo gallery and the same purchase
 * controls as the card.
 *
 * Variant alignment: when a specific variant is selected, the gallery narrows
 * to that variant's tagged photos plus the shared (untagged) ones, so each
 * variant shows the right images. With nothing selected we show the whole
 * gallery.
 */
export function ItemDetail({ item, cart, onAddToCart, onRemoveFromCart, currency, onClose }: ItemDetailProps) {
  const titleId = useId();
  const sel = useItemSelection(item, cart, onAddToCart, onRemoveFromCart);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  // Variant-aware gallery: selected variant's photos + shared (untagged) ones.
  const visibleImages: StoreImage[] = useMemo(() => {
    const all = item.images ?? [];
    if (all.length === 0 || !sel.variant) return all;
    const matched = all.filter((im) => im.variantId === sel.variant!.id || im.variantId === null);
    return matched.length > 0 ? matched : all;
  }, [item.images, sel.variant]);

  // Back to the first photo when the variant (and so the photo set) changes.
  useEffect(() => {
    setActiveImageIdx(0);
  }, [sel.variant]);

  const activeImage = visibleImages[Math.min(activeImageIdx, visibleImages.length - 1)];
  const soldOut = sel.stock.soldOut && !sel.optionsIncomplete;
  const lowStock = showLowStockBadge(item, sel.selection);

  return (
    <Dialog
      labelledBy={titleId}
      onClose={onClose}
      closeLabel="Close item"
      flush
      footer={
        <div className="flex items-center justify-between gap-3">
          {soldOut ? (
            <span className="badge badge-sold-out">Sold out</span>
          ) : sel.optionsIncomplete ? (
            <span className="text-sm" style={{ color: "var(--store-muted)" }}>
              Choose options to continue
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--store-text-secondary)" }}>
              {availabilityText(sel.stock)}
              {lowStock && <span className="badge badge-low-stock">Low stock</span>}
            </span>
          )}
          {!soldOut && !sel.optionsIncomplete && (
            <AddControl name={item.name} qty={sel.qty} onAdd={sel.add} onRemove={sel.remove} addLabel="Add to cart" />
          )}
        </div>
      }
    >
      <div>
        {activeImage && (
          <div>
            <div className="aspect-square w-full overflow-hidden" style={{ background: "var(--store-bg-alt)" }}>
              <img
                key={activeImage.id}
                src={assetUrl(activeImage.url)}
                alt={activeImage.alt || item.name}
                className="h-full w-full object-contain"
              />
            </div>
            {visibleImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto px-5 pt-3 scrollbar-hide" role="group" aria-label="Photos">
                {visibleImages.map((im, i) => (
                  <button
                    key={im.id}
                    type="button"
                    onClick={() => setActiveImageIdx(i)}
                    className="h-14 w-14 flex-none overflow-hidden rounded-lg border-2"
                    style={{ borderColor: i === activeImageIdx ? "var(--store-accent-ink)" : "transparent" }}
                    aria-label={`Photo ${i + 1} of ${visibleImages.length}`}
                    aria-pressed={i === activeImageIdx}
                  >
                    <img src={assetUrl(im.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="p-5" style={{ paddingTop: activeImage ? 16 : 56 }}>
          {item.category && (
            <p className="text-sm" style={{ color: "var(--store-muted)" }}>
              {item.category}
            </p>
          )}
          <h2 id={titleId} className="dlg-title" style={{ fontSize: "var(--fs-xl)", marginTop: 2 }}>
            {item.name}
          </h2>

          <p className="price mt-3" style={{ fontSize: "var(--fs-lg)" }}>
            {sel.showFromPrice && <span className="price-pre">From</span>}
            {formatMoney(sel.price, currency)}
            <span className="price-pre" style={{ marginLeft: 6 }}>
              per {sel.unit}
            </span>
          </p>

          {item.description && (
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed" style={{ color: "var(--store-text-secondary)" }}>
              {item.description}
            </p>
          )}

          <div className="mt-5">
            <ItemOptions item={item} currency={currency} sel={sel} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
