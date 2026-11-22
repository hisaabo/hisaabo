import { useMemo, useState } from "react";
import type { CartItem, StoreItem } from "./types";
import { cartItemKey } from "./types";
import { stockState, type Selection, type StockState } from "./stock";

type Variant = NonNullable<StoreItem["variants"]>[number];

/** Whether some in-stock variant has `value` for `attr` and agrees with the other chosen attributes. */
export function isValueAvailable(
  variants: Variant[],
  allAttributes: string[],
  chosen: Record<string, string>,
  attr: string,
  value: string,
): boolean {
  return variants.some((v) => {
    if (v.attributes[attr] !== value || !v.inStock) return false;
    return allAttributes.every((other) => other === attr || !chosen[other] || v.attributes[other] === chosen[other]);
  });
}

/** Distinct values of a variant attribute, in the order the variants list them. */
export function attributeValues(item: StoreItem, attr: string): string[] {
  return Array.from(new Set((item.variants ?? []).map((v) => v.attributes[attr]).filter(Boolean)));
}

/**
 * What a shopper has chosen on one item (a unit, or one value per variant
 * attribute) and what follows from it: the price, the stock state, the cart
 * line it maps to, and how to add it. Shared by the grid card and the item view.
 */
export function useItemSelection(
  item: StoreItem,
  cart: CartItem[],
  onAddToCart: (entry: Omit<CartItem, "quantity">) => void,
  onRemoveFromCart: (key: string) => void,
) {
  const mode = item.itemMode || "simple";
  const [unitIndex, setUnitIndex] = useState(-1); // -1 = the base unit
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const derived = useMemo(() => {
    let price = item.price;
    let unit = item.unit;
    let variant: Variant | null = null;
    let selection: Selection = { kind: "item" };

    const unitVariant = mode === "alt_units" && unitIndex >= 0 ? item.unitVariants?.[unitIndex] : undefined;
    if (unitVariant) {
      price = unitVariant.price;
      unit = unitVariant.unit;
    }

    if (mode === "variants" && item.variantAttributes && item.variants) {
      const attrs = item.variantAttributes;
      if (attrs.every((a) => chosen[a])) {
        const match = item.variants.find((v) => attrs.every((a) => v.attributes[a] === chosen[a]));
        if (match) {
          variant = match;
          price = match.price;
          selection = { kind: "variant", variant: match };
        } else {
          selection = { kind: "no-match" };
        }
      }
    }

    let key: string | null = null;
    if (mode === "simple") key = item.id;
    else if (mode === "alt_units") key = unitVariant ? `${item.id}::u::${unitVariant.unit}` : item.id;
    else if (variant) key = `${item.id}::v::${variant.id}`;
    const cartEntry = key ? cart.find((c) => cartItemKey(c) === key) : undefined;

    const stock: StockState = stockState(item, selection);
    return { price, unit, variant, unitVariant, selection, stock, cartEntry };
  }, [item, cart, mode, unitIndex, chosen]);

  const optionsIncomplete =
    mode === "variants" && Boolean(item.variantAttributes) && !item.variantAttributes!.every((a) => chosen[a]);

  /** Variants all priced alike: no need to say "from". */
  const uniformPrice = !item.variants || item.variants.every((v) => v.price === item.variants![0].price);

  function add() {
    if (derived.stock.soldOut || optionsIncomplete) return;
    const { unitVariant, variant } = derived;
    if (unitVariant) {
      onAddToCart({
        item,
        selectedUnit: unitVariant.unit,
        conversionFactor: unitVariant.conversionFactor,
        effectivePrice: unitVariant.price,
      });
    } else if (variant) {
      onAddToCart({ item, selectedVariantId: variant.id, effectivePrice: variant.price });
    } else {
      onAddToCart({ item, effectivePrice: item.price });
    }
  }

  function remove() {
    if (derived.cartEntry) onRemoveFromCart(cartItemKey(derived.cartEntry));
  }

  function toggleAttribute(attr: string, value: string) {
    setChosen((prev) => ({ ...prev, [attr]: prev[attr] === value ? "" : value }));
  }

  return {
    mode,
    unitIndex,
    setUnitIndex,
    chosen,
    toggleAttribute,
    ...derived,
    qty: derived.cartEntry?.quantity ?? 0,
    optionsIncomplete,
    showFromPrice: mode === "variants" && !derived.variant && !uniformPrice,
    add,
    remove,
  };
}
