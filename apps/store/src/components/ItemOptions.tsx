import type { StoreItem } from "../types";
import { formatMoney } from "../money";
import { attributeValues, isValueAvailable, type useItemSelection } from "../useItemSelection";

type Selection = ReturnType<typeof useItemSelection>;

interface ItemOptionsProps {
  item: StoreItem;
  currency: string;
  sel: Selection;
}

/** The unit chips of an item sold by more than one unit, or the attribute chips of a variant item. */
export function ItemOptions({ item, currency, sel }: ItemOptionsProps) {
  if (sel.mode === "alt_units" && item.unitVariants && item.unitVariants.length > 0) {
    const units = [{ unit: item.unit, price: item.price }, ...item.unitVariants];
    return (
      <div role="group" aria-label={`${item.name}, choose a unit`} className="opt-row">
        {units.map((u, i) => (
          <button
            key={u.unit}
            type="button"
            className="opt"
            aria-pressed={sel.unitIndex === i - 1}
            onClick={() => sel.setUnitIndex(i - 1)}
          >
            <span>{u.unit}</span>
            <span className="opt-price">{formatMoney(u.price, currency)}</span>
          </button>
        ))}
      </div>
    );
  }

  if (sel.mode === "variants" && item.variantAttributes && item.variants) {
    return (
      <div className="pcard-opts">
        {item.variantAttributes.map((attr) => (
          <div key={attr} role="group" aria-label={`${item.name}, choose ${attr.toLowerCase()}`}>
            <span className="opt-label" aria-hidden="true">
              {attr}
            </span>
            <div className="opt-row">
              {attributeValues(item, attr).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="opt"
                  aria-pressed={sel.chosen[attr] === value}
                  disabled={!isValueAvailable(item.variants!, item.variantAttributes!, sel.chosen, attr, value)}
                  onClick={() => sel.toggleAttribute(attr, value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
