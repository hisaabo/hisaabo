import { useEffect, useRef, type Ref } from "react";
import { MinusIcon, PlusIcon, TrashIcon } from "./Icons";

interface StepperProps {
  /** The item's name, for the buttons' accessible names. */
  name: string;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
  plusRef?: Ref<HTMLButtonElement>;
}

/** − qty + for something already in the cart. At 1 the minus becomes a bin: it removes the line. */
export function Stepper({ name, qty, onAdd, onRemove, plusRef }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label={`${name}, quantity`}>
      <button
        type="button"
        className="stepper-btn"
        onClick={onRemove}
        aria-label={qty === 1 ? `Remove ${name}` : `Remove one ${name}`}
      >
        {qty === 1 ? <TrashIcon size={16} /> : <MinusIcon size={16} />}
      </button>
      <span className="stepper-value" aria-live="polite" aria-atomic="true">
        {qty}
      </span>
      <button
        ref={plusRef}
        type="button"
        className="stepper-btn stepper-plus"
        onClick={onAdd}
        aria-label={`Add one more ${name}`}
      >
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

interface AddControlProps {
  name: string;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
  /** Visible text of the first-add button. */
  addLabel?: string;
}

/**
 * "Add" until the item is in the cart, then a stepper. The two are different
 * elements, so keyboard focus is carried across the swap: after Add it lands on
 * the stepper's plus, after removing the last one it lands back on Add. Without
 * that, focus would drop to the page and a keyboard user would start over.
 */
export function AddControl({ name, qty, onAdd, onRemove, addLabel = "Add" }: AddControlProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const carryFocusTo = useRef<"plus" | "add" | null>(null);

  useEffect(() => {
    if (carryFocusTo.current === "plus" && qty > 0) plusRef.current?.focus({ preventScroll: true });
    if (carryFocusTo.current === "add" && qty === 0) addRef.current?.focus({ preventScroll: true });
    carryFocusTo.current = null;
  }, [qty]);

  if (qty === 0) {
    return (
      <button
        ref={addRef}
        type="button"
        className="btn btn-outline btn-sm btn-add"
        aria-label={`Add ${name}`}
        onClick={() => {
          carryFocusTo.current = "plus";
          onAdd();
        }}
      >
        {addLabel}
      </button>
    );
  }

  return (
    <Stepper
      name={name}
      qty={qty}
      plusRef={plusRef}
      onAdd={onAdd}
      onRemove={() => {
        if (qty === 1) carryFocusTo.current = "add";
        onRemove();
      }}
    />
  );
}
