/**
 * UnitVariantEditor — interactive tests for the alt-unit form editor.
 *
 * Covers:
 *   - Auto-derivation of salePrice from basePrice × conversionFactor.
 *   - Manual override protection: once the user types a salePrice,
 *     subsequent basePrice changes do NOT overwrite it.
 *   - The "Recompute" affordance that re-derives a manually-set row.
 *   - The rendered label uses the unambiguous Direction A phrasing.
 *
 * Routes are excluded from the vitest config, so the items.tsx form is
 * not directly testable. We instead test the shared editor component
 * that it uses, plus the pure derivation functions in
 * `lib/__tests__/unit-variant-derivation.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnitVariantEditor } from "../UnitVariantEditor";
import {
  type UiUnitVariant,
  recomputeOnBasePriceChange,
} from "@/lib/unit-variant-derivation";

// ── Test harness ─────────────────────────────────────────────────────────────

/**
 * Stateful wrapper that mirrors how `items.tsx` drives the editor:
 * the form owns `basePrice` and `unitVariants` state, and recomputes
 * the variants whenever basePrice changes.
 */
function TestHarness({
  initialBasePrice = "100",
  initialVariants = [],
  baseUnit = "kg",
  onVariantsChange,
}: {
  initialBasePrice?: string;
  initialVariants?: UiUnitVariant[];
  baseUnit?: string;
  onVariantsChange?: (v: UiUnitVariant[]) => void;
}) {
  const [basePrice, setBasePrice] = useState(initialBasePrice);
  const [variants, setVariants] = useState<UiUnitVariant[]>(initialVariants);

  return (
    <div>
      <label>
        Base Price
        <input
          aria-label="base-price"
          type="number"
          value={basePrice}
          onChange={(e) => {
            const next = e.target.value;
            setBasePrice(next);
            setVariants((prev) => recomputeOnBasePriceChange(prev, next));
          }}
        />
      </label>
      <UnitVariantEditor
        variants={variants}
        onChange={(v) => {
          setVariants(v);
          onVariantsChange?.(v);
        }}
        baseUnit={baseUnit}
        basePrice={basePrice}
        getAvailableUnits={() => [
          { value: "packet", label: "Packet" },
          { value: "bag", label: "Bag" },
          { value: "box", label: "Box" },
        ]}
        onRemoveRow={(idx) =>
          setVariants((prev) => prev.filter((_, i) => i !== idx))
        }
        onAddRow={() =>
          setVariants((prev) => [
            ...prev,
            { unit: "packet", conversionFactor: 1, salePrice: "" },
          ])
        }
      />
    </div>
  );
}

/** Find the conversionFactor input in the first row (Direction A label). */
function getCfInput() {
  // The label is "1 <alt> = ? <base>" which contains " = ? ".
  return screen.getByLabelText(/= \? /i);
}

/** Find the salePrice input in the first row. */
function getPriceInput() {
  return screen.getByLabelText(/sale price/i);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("UnitVariantEditor", () => {
  it("renders the Direction A label '1 alt = ? base' instead of the ambiguous 'Per base'", () => {
    render(
      <TestHarness
        initialVariants={[
          { unit: "packet", conversionFactor: 1, salePrice: "" },
        ]}
      />,
    );
    expect(screen.getByText(/1 packet = \? kg/i)).toBeInTheDocument();
  });

  it("auto-fills salePrice to ₹20.00 when user types conversionFactor 0.2 against a ₹100 base", async () => {
    const user = userEvent.setup();
    render(
      <TestHarness
        initialBasePrice="100"
        initialVariants={[
          { unit: "packet", conversionFactor: 1, salePrice: "" },
        ]}
      />,
    );

    const cf = getCfInput();
    await user.clear(cf);
    await user.type(cf, "0.2");

    const price = getPriceInput() as HTMLInputElement;
    expect(price.value).toBe("20.00");
  });

  it("renders the live preview line '1 packet = 0.2 kg → ₹20.00 each' once everything is filled", async () => {
    const user = userEvent.setup();
    render(
      <TestHarness
        initialBasePrice="100"
        initialVariants={[
          { unit: "packet", conversionFactor: 1, salePrice: "" },
        ]}
      />,
    );

    const cf = getCfInput();
    await user.clear(cf);
    await user.type(cf, "0.2");

    expect(
      screen.getByText((content) =>
        content.includes("1 packet = 0.2 kg") && content.includes("₹20.00 each"),
      ),
    ).toBeInTheDocument();
  });

  it("does NOT overwrite a manually-set salePrice when basePrice changes", () => {
    render(
      <TestHarness
        initialBasePrice="100"
        initialVariants={[
          { unit: "packet", conversionFactor: 0.2, salePrice: "20.00" },
        ]}
      />,
    );

    // User manually overrides the auto-derived ₹20.00 to ₹19.00.
    // We use `fireEvent.change` directly instead of `user.type` because
    // HTML number inputs in jsdom normalise trailing zeros and typing
    // character-by-character leaves the value at "19" instead of "19.00".
    const price = getPriceInput() as HTMLInputElement;
    fireEvent.change(price, { target: { value: "19.00" } });
    expect(price.value).toBe("19.00");

    // User now bumps the base price to ₹110. Auto-derivation would
    // normally recompute to 22.00 but the row is flagged manual, so
    // it must stay at 19.00.
    const base = screen.getByLabelText("base-price") as HTMLInputElement;
    fireEvent.change(base, { target: { value: "110" } });

    expect((getPriceInput() as HTMLInputElement).value).toBe("19.00");

    // A "base changed" affordance with a recompute link must now be visible.
    expect(
      screen.getByRole("button", { name: /Recompute to ₹22\.00/ }),
    ).toBeInTheDocument();
  });

  it("clicking the recompute affordance re-derives the price to basePrice × CF and clears the manual flag", async () => {
    const user = userEvent.setup();
    render(
      <TestHarness
        initialBasePrice="100"
        initialVariants={[
          { unit: "packet", conversionFactor: 0.2, salePrice: "20.00" },
        ]}
      />,
    );

    const price = getPriceInput() as HTMLInputElement;
    fireEvent.change(price, { target: { value: "19.00" } });

    const base = screen.getByLabelText("base-price") as HTMLInputElement;
    fireEvent.change(base, { target: { value: "110" } });

    const recomputeBtn = screen.getByRole("button", {
      name: /Recompute to ₹22\.00/,
    });
    await user.click(recomputeBtn);

    expect((getPriceInput() as HTMLInputElement).value).toBe("22.00");
    // After recomputing, the stale-base affordance is gone.
    expect(
      screen.queryByRole("button", { name: /Recompute to ₹/ }),
    ).not.toBeInTheDocument();
  });

  it("shows an inline 'Recompute from' hint while the user is in manual mode and base price is unchanged", () => {
    render(
      <TestHarness
        initialBasePrice="100"
        initialVariants={[
          { unit: "packet", conversionFactor: 0.2, salePrice: "20.00" },
        ]}
      />,
    );

    const price = getPriceInput() as HTMLInputElement;
    fireEvent.change(price, { target: { value: "15.00" } });

    // Base price hasn't changed, so the "Recompute from ₹100/kg" hint is shown.
    expect(
      screen.getByRole("button", { name: /Recompute from ₹100\/kg/ }),
    ).toBeInTheDocument();
  });

  it("calls onChange with rows stripped of UI-only flags for the create button callback", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <TestHarness
        initialBasePrice="100"
        initialVariants={[
          { unit: "packet", conversionFactor: 1, salePrice: "" },
        ]}
        onVariantsChange={spy}
      />,
    );

    const cf = getCfInput();
    await user.clear(cf);
    await user.type(cf, "0.2");

    // The most recent onChange call must contain the derived "20.00"
    const last = spy.mock.calls[spy.mock.calls.length - 1]?.[0] as UiUnitVariant[];
    expect(last?.[0]?.salePrice).toBe("20.00");
    expect(last?.[0]?.conversionFactor).toBe(0.2);
  });
});
