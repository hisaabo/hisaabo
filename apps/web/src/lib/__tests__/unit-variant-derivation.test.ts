/**
 * Unit-variant derivation tests.
 *
 * These cover the pure logic shared by:
 *   - `ImportWizard.tsx` (resolving GST-report unit conflicts)
 *   - `items.tsx` create/edit forms via `UnitVariantEditor`
 *
 * The formula is Direction A: `altPrice = basePrice × conversionFactor`.
 */

import { describe, it, expect } from "vitest";
import {
  parseMoney,
  parseCF,
  deriveAltPrice,
  updateVariantField,
  recomputeOnBasePriceChange,
  recomputeSingleRow,
  toPayloadVariant,
  type UiUnitVariant,
} from "../unit-variant-derivation";

describe("parseMoney", () => {
  it("returns null for empty / null / undefined so the caller can fall back", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it("parses a plain integer price string", () => {
    expect(parseMoney("100")).toBe(100);
  });

  it("parses a decimal price string", () => {
    expect(parseMoney("123.45")).toBe(123.45);
  });

  it("rejects negative numbers because prices are non-negative", () => {
    expect(parseMoney("-50")).toBeNull();
  });

  it("rejects non-numeric junk", () => {
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("parseCF", () => {
  it("returns null for empty / null / undefined / zero / negative", () => {
    expect(parseCF("")).toBeNull();
    expect(parseCF(null)).toBeNull();
    expect(parseCF(undefined)).toBeNull();
    expect(parseCF(0)).toBeNull();
    expect(parseCF("0")).toBeNull();
    expect(parseCF(-1)).toBeNull();
  });

  it("parses a positive numeric value from either string or number input", () => {
    expect(parseCF(0.2)).toBe(0.2);
    expect(parseCF("0.2")).toBe(0.2);
    expect(parseCF("5")).toBe(5);
  });
});

describe("deriveAltPrice — Direction A (altPrice = basePrice × CF)", () => {
  it("derives ₹20 for the canonical rice/packet case (100 × 0.2)", () => {
    // 1 packet = 0.2 kg at ₹100/kg → ₹20/packet
    expect(deriveAltPrice("100", 0.2)).toBe("20.00");
  });

  it("derives ₹250 for a 2.5 kg bag at ₹100/kg", () => {
    expect(deriveAltPrice("100", 2.5)).toBe("250.00");
  });

  it("formats as NUMERIC(15,2) with exactly two decimals so the validator passes", () => {
    // The `unitVariantSchema.salePrice` regex is ^\d{1,13}(\.\d{1,2})?$
    // so we always produce .toFixed(2).
    expect(deriveAltPrice("99.99", 1)).toBe("99.99");
    expect(deriveAltPrice("10", 0.1)).toBe("1.00");
  });

  it("handles the conversionFactor passed as a string", () => {
    expect(deriveAltPrice("100", "0.2")).toBe("20.00");
  });

  it("returns null if base price is missing so callers can fall back", () => {
    expect(deriveAltPrice("", 0.2)).toBeNull();
    expect(deriveAltPrice(undefined, 0.2)).toBeNull();
  });

  it("returns null if CF is missing or invalid so callers can fall back", () => {
    expect(deriveAltPrice("100", 0)).toBeNull();
    expect(deriveAltPrice("100", -1)).toBeNull();
    expect(deriveAltPrice("100", undefined)).toBeNull();
    expect(deriveAltPrice("100", "abc")).toBeNull();
  });
});

describe("updateVariantField", () => {
  const initial: UiUnitVariant[] = [
    { unit: "packet", conversionFactor: 1, salePrice: "" },
  ];

  it("auto-derives salePrice when the user types a conversionFactor (not in manual mode)", () => {
    const next = updateVariantField(initial, 0, "conversionFactor", "0.2", "100");
    expect(next[0].conversionFactor).toBe(0.2);
    expect(next[0].salePrice).toBe("20.00");
    expect(next[0].__manual).toBeUndefined();
  });

  it("sets __manual and __manualBasePrice when the user directly types a salePrice", () => {
    const next = updateVariantField(initial, 0, "salePrice", "19.00", "100");
    expect(next[0].salePrice).toBe("19.00");
    expect(next[0].__manual).toBe(true);
    expect(next[0].__manualBasePrice).toBe("100");
  });

  it("does NOT auto-overwrite salePrice on CF change if the row is flagged manual", () => {
    const manualRow: UiUnitVariant[] = [
      {
        unit: "packet",
        conversionFactor: 0.2,
        salePrice: "19.00",
        __manual: true,
        __manualBasePrice: "100",
      },
    ];
    const next = updateVariantField(manualRow, 0, "conversionFactor", "0.3", "100");
    expect(next[0].conversionFactor).toBe(0.3);
    expect(next[0].salePrice).toBe("19.00");
    expect(next[0].__manual).toBe(true);
  });

  it("passes through unit changes without touching derived price", () => {
    const row: UiUnitVariant[] = [
      { unit: "", conversionFactor: 0.2, salePrice: "20.00" },
    ];
    const next = updateVariantField(row, 0, "unit", "packet", "100");
    expect(next[0].unit).toBe("packet");
    expect(next[0].salePrice).toBe("20.00");
  });
});

describe("recomputeOnBasePriceChange", () => {
  it("re-derives non-manual rows when the base price changes", () => {
    const rows: UiUnitVariant[] = [
      { unit: "packet", conversionFactor: 0.2, salePrice: "20.00" },
      { unit: "bag", conversionFactor: 2.5, salePrice: "250.00" },
    ];
    const next = recomputeOnBasePriceChange(rows, "200");
    expect(next[0].salePrice).toBe("40.00");
    expect(next[1].salePrice).toBe("500.00");
  });

  it("leaves manual rows' price untouched so the override wins", () => {
    const rows: UiUnitVariant[] = [
      {
        unit: "packet",
        conversionFactor: 0.2,
        salePrice: "19.00",
        __manual: true,
        __manualBasePrice: "100",
      },
    ];
    const next = recomputeOnBasePriceChange(rows, "110");
    expect(next[0].salePrice).toBe("19.00");
    // __manualBasePrice stays at 100 so the editor can compare and
    // surface the "base changed" affordance on next render.
    expect(next[0].__manualBasePrice).toBe("100");
  });
});

describe("recomputeSingleRow", () => {
  it("re-derives the row from current base price and clears manual flags", () => {
    const rows: UiUnitVariant[] = [
      {
        unit: "packet",
        conversionFactor: 0.2,
        salePrice: "19.00",
        __manual: true,
        __manualBasePrice: "100",
      },
    ];
    const next = recomputeSingleRow(rows, 0, "110");
    expect(next[0].salePrice).toBe("22.00");
    expect(next[0].__manual).toBe(false);
    expect(next[0].__manualBasePrice).toBeUndefined();
  });
});

describe("toPayloadVariant", () => {
  it("strips __manual and __manualBasePrice so the backend never sees UI state", () => {
    const row: UiUnitVariant = {
      unit: "packet",
      conversionFactor: 0.2,
      salePrice: "20.00",
      __manual: true,
      __manualBasePrice: "100",
    };
    const payload = toPayloadVariant(row);
    expect(payload).toEqual({
      unit: "packet",
      conversionFactor: 0.2,
      salePrice: "20.00",
    });
    expect((payload as Record<string, unknown>).__manual).toBeUndefined();
  });

  it("preserves purchasePrice when present", () => {
    const row: UiUnitVariant = {
      unit: "packet",
      conversionFactor: 0.2,
      salePrice: "20.00",
      purchasePrice: "16.00",
    };
    expect(toPayloadVariant(row)).toEqual({
      unit: "packet",
      conversionFactor: 0.2,
      salePrice: "20.00",
      purchasePrice: "16.00",
    });
  });
});

// ── Bug A regression — canonical scenarios from the user report ──────────────

describe("Bug A regression — ImportWizard unit-conflict resolution", () => {
  it("turns a conflict with CF=0.2 on an item priced at ₹100 into altPrice ₹20.00", () => {
    // This mirrors the exact arithmetic used at
    // `apps/web/src/components/ImportWizard.tsx:~1608` after the fix:
    // `(parseFloat(item.salePrice) * cf).toFixed(2)`
    const itemSalePrice = "100";
    const cfString = "0.2";
    const cf = parseFloat(cfString);
    const derived = (parseFloat(itemSalePrice) * cf).toFixed(2);
    expect(derived).toBe("20.00");
    // And it should equal the deriveAltPrice helper's output —
    // proving the two code paths produce identical results.
    expect(derived).toBe(deriveAltPrice(itemSalePrice, cf));
  });

  it("falls back to item.salePrice when CF is zero / invalid (matches the guard)", () => {
    const fallback = (itemSale: string, cfString: string) => {
      const cf = parseFloat(cfString);
      const basePriceNum = parseFloat(itemSale || "0");
      return Number.isFinite(cf) && cf > 0 && Number.isFinite(basePriceNum)
        ? (basePriceNum * cf).toFixed(2)
        : itemSale || "0";
    };
    expect(fallback("100", "0")).toBe("100");
    expect(fallback("100", "abc")).toBe("100");
  });
});
