import { useId } from "react";
import type { OpeningBalanceDirection } from "@hisaabo/shared";
import { FormField } from "@/components/ui/FormField";
import { SegmentedControl } from "@/components/ui/Tabs";

interface OpeningBalanceFieldProps {
  /** Unsigned amount as typed. The direction carries the sign. */
  amount: string;
  direction: OpeningBalanceDirection;
  onAmountChange: (amount: string) => void;
  onDirectionChange: (direction: OpeningBalanceDirection) => void;
  /** Party type, only to word the hint ("they owe you" / "you owe them"). */
  partyType?: "customer" | "supplier";
}

/**
 * A party's opening balance as an amount plus a "To receive / To pay" toggle,
 * instead of a bare signed number: the stored value is positive when they owe
 * you and negative when you owe them, and that is easy to get backwards.
 * `composeOpeningBalance` / `splitOpeningBalance` (@hisaabo/shared) turn the pair
 * into the stored value and back.
 */
export function OpeningBalanceField({
  amount,
  direction,
  onAmountChange,
  onDirectionChange,
  partyType,
}: OpeningBalanceFieldProps) {
  const id = useId();
  return (
    <FormField label="Opening Balance" htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          className="input min-w-0 flex-1"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
        />
        <SegmentedControl
          tabs={[
            { value: "receive", label: "To receive" },
            { value: "pay", label: "To pay" },
          ]}
          value={direction}
          onChange={(v) => onDirectionChange(v as OpeningBalanceDirection)}
        />
      </div>
      <p className="text-xs mt-1 text-text-tertiary">
        {direction === "receive"
          ? partyType === "supplier"
            ? "To receive: the supplier owes you (for example an advance you paid)."
            : "To receive: they owe you."
          : partyType === "customer"
            ? "To pay: you owe the customer (for example an advance they paid)."
            : "To pay: you owe them."}
      </p>
    </FormField>
  );
}
