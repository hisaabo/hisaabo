import { useEffect, useId, useState } from "react";
import type { PriceUpdateProposal, PriceUpdateSkip } from "@hisaabo/shared";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

interface Props {
  open: boolean;
  proposals: readonly PriceUpdateProposal[];
  /** Lines that were changed but could not be offered, with the reason. */
  skipped?: readonly PriceUpdateSkip[];
  /** The bill's side: sale bills offer selling prices, purchase bills purchase prices. */
  side: "sale" | "purchase";
  /** [Update item prices]: the bill is saved, then these prices are written. */
  onUpdate: (selected: PriceUpdateProposal[]) => void;
  /** [Just this bill]: the bill is saved, the catalog is left alone. */
  onJustThisBill: () => void;
  /** Esc / backdrop / X: back to the form, nothing saved. */
  onBack: () => void;
}

/**
 * "Update saved prices?" — the ONE confirmation shown on save when the user can
 * update items and changed a rate on a catalog-linked line. Every changed item
 * is listed with a checkbox, checked by default; the bill is saved either way.
 */
export function PriceUpdateDialog({ open, proposals, skipped = [], side, onUpdate, onJustThisBill, onBack }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(proposals.map((p) => p.key)));
  const uid = useId();

  // A new set of proposals (the dialog is reused across saves) starts all-checked.
  useEffect(() => {
    setChecked(new Set(proposals.map((p) => p.key)));
  }, [proposals]);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selected = proposals.filter((p) => checked.has(p.key));
  const priceWord = side === "sale" ? "selling" : "purchase";

  return (
    <Modal open={open} onClose={onBack} title="Update saved prices?" className="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          You changed the {priceWord} price on this bill. Update the item's saved price too, so the next bill starts from it.
        </p>

        <ul className="divide-y divide-border-light rounded-lg border border-border-light" aria-label="Price changes">
          {proposals.map((p) => {
            const id = `${uid}-${p.key}`;
            return (
              <li key={p.key} className="flex items-start gap-3 px-3 py-2.5">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded"
                  checked={checked.has(p.key)}
                  onChange={() => toggle(p.key)}
                />
                <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
                  <span className="block text-sm font-medium text-text-primary truncate">{p.label}</span>
                  <span className="block text-sm tabular-nums text-text-secondary">
                    {p.oldPrice === null ? "No saved price" : formatCurrency(p.oldPrice)}
                    <span aria-hidden="true"> → </span>
                    <span className="sr-only"> to </span>
                    <span className="font-semibold text-text-primary">{formatCurrency(p.newPrice)}</span>
                    {p.priceIncludesTax && <span className="ml-1.5 text-xs text-text-tertiary">incl. GST</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {skipped.length > 0 && (
          <div className="text-xs text-text-tertiary space-y-0.5" role="note">
            <p className="font-medium">Not offered:</p>
            {skipped.map((s, i) => (
              <p key={`${s.itemName}-${i}`}>
                {s.itemName}: {s.reason}.
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border-light">
        <button type="button" className="btn-secondary" onClick={onJustThisBill}>
          Just this bill
        </button>
        <button type="button" className="btn-primary" onClick={() => onUpdate(selected)} disabled={selected.length === 0}>
          Update item prices
        </button>
      </div>
    </Modal>
  );
}
