import { useState } from "react";
import type { StoreItem, CartItem } from "../types";
import { assetUrl } from "../api";
import { formatMoney } from "../money";
import { showLowStockBadge } from "../stock";
import { useItemSelection } from "../useItemSelection";
import { AddControl } from "./AddControl";
import { ImagesIcon } from "./Icons";
import { ItemOptions } from "./ItemOptions";

/**
 * "photo": a gallery card, a square picture on top (a tinted initial when this
 * item has none), for catalogs that are mostly photographed.
 * "compact": a text card, for catalogs that are not. No empty picture area;
 * an item that does have a photo gets a small thumbnail beside its name.
 */
export type CardLayout = "photo" | "compact";

interface ItemCardProps {
  item: StoreItem;
  cart: CartItem[];
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void;
  onRemoveFromCart: (key: string) => void;
  currency: string;
  layout: CardLayout;
  onOpenDetail: (item: StoreItem) => void;
}

export function ItemCard({
  item,
  cart,
  onAddToCart,
  onRemoveFromCart,
  currency,
  layout,
  onOpenDetail,
}: ItemCardProps) {
  const sel = useItemSelection(item, cart, onAddToCart, onRemoveFromCart);
  // A photo that fails to load is dropped: the card then reads as an image-less one.
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? undefined : assetUrl(item.primaryImageUrl);
  const imageCount = item.images?.length ?? 0;
  const photoAlt = item.images?.find((im) => im.isPrimary)?.alt || "";
  const soldOut = sel.stock.soldOut && !sel.optionsIncomplete;
  const lowStock = showLowStockBadge(item, sel.selection);
  const open = () => onOpenDetail(item);

  return (
    <article className="pcard" data-layout={layout} data-soldout={soldOut || undefined}>
      {layout === "photo" && (
        // Not a control of its own: the name's link covers the whole card.
        <div className="pcard-media">
          {photo ? (
            <img src={photo} alt={photoAlt} loading="lazy" decoding="async" onError={() => setPhotoFailed(true)} />
          ) : (
            <span className="monogram" aria-hidden="true">
              {Array.from(item.name.trim())[0]?.toUpperCase() ?? ""}
            </span>
          )}
          {imageCount > 1 && (
            <span className="pcard-count">
              <ImagesIcon size={12} />
              {imageCount}
            </span>
          )}
        </div>
      )}

      <div className="pcard-body">
        <div className="pcard-head">
          {layout === "compact" && photo && (
            <div className="pcard-thumb">
              <img src={photo} alt={photoAlt} loading="lazy" decoding="async" onError={() => setPhotoFailed(true)} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3>
              <button type="button" className="pcard-name" onClick={open}>
                <span className="line-clamp-2">{item.name}</span>
              </button>
            </h3>
            {item.description && <p className="pcard-desc line-clamp-2">{item.description}</p>}
          </div>
        </div>

        <ItemOptions item={item} currency={currency} sel={sel} />

        <div className="pcard-foot">
          <div>
            <p className="price">
              {sel.showFromPrice && <span className="price-pre">From</span>}
              {formatMoney(sel.price, currency)}
              <span className="price-unit">per {sel.unit}</span>
            </p>
            {lowStock && <span className="badge badge-low-stock mt-1.5">Low stock</span>}
          </div>

          {soldOut ? (
            <span className="badge badge-sold-out">Sold out</span>
          ) : sel.optionsIncomplete ? (
            <span className="pcard-hint">Choose options</span>
          ) : (
            <AddControl name={item.name} qty={sel.qty} onAdd={sel.add} onRemove={sel.remove} />
          )}
        </div>
      </div>
    </article>
  );
}
