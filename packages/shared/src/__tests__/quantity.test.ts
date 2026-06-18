/**
 * Tests for packages/shared/src/quantity.ts
 *
 * WHY THIS FILE EXISTS:
 * Quantities are stored as fixed-precision strings ("2.000") but must render
 * the way a person writes them. formatQuantity is the single source of truth
 * for that across web, mobile, desktop and the PDF layer, so its rounding and
 * trailing-zero behaviour is locked down here.
 */

import { describe, it, expect } from "vitest";
import { formatQuantity } from "../quantity.js";

describe("formatQuantity", () => {
  it("drops decimals for whole numbers", () => {
    expect(formatQuantity("2.000")).toBe("2");
    expect(formatQuantity("2")).toBe("2");
    expect(formatQuantity(5)).toBe("5");
    expect(formatQuantity("0.000")).toBe("0");
  });

  it("trims trailing zeros on fractional quantities", () => {
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(formatQuantity("2.50")).toBe("2.5");
    expect(formatQuantity("0.250")).toBe("0.25");
  });

  it("keeps up to three decimal places", () => {
    expect(formatQuantity("0.125")).toBe("0.125");
    expect(formatQuantity("2.001")).toBe("2.001");
  });

  it("rounds anything beyond three decimals to three", () => {
    expect(formatQuantity("2.1256")).toBe("2.126");
    expect(formatQuantity("2.0005")).toBe("2.001");
  });

  it("groups large quantities in the Indian style", () => {
    expect(formatQuantity("10000")).toBe("10,000");
    expect(formatQuantity("100000.5")).toBe("1,00,000.5");
  });

  it("falls back to '0' for malformed or missing input", () => {
    expect(formatQuantity("")).toBe("0");
    expect(formatQuantity("abc")).toBe("0");
    expect(formatQuantity(NaN)).toBe("0");
  });
});
