/**
 * Exact quantity arithmetic for stock (NUMERIC(15,3)): decimalToScale, mulToScale, formatScaled.
 * Hand-computed literals; the arithmetic is beside each row.
 */
import { describe, it, expect } from "vitest";
import { decimalToScale, formatScaled, mulToScale } from "../index.js";

describe("decimalToScale", () => {
  it.each([
    ["0.125", 3, 125n],
    ["1", 3, 1000n],
    ["-2.5", 3, -2500n],
    ["0.0005", 3, 1n], // half up
    ["0.0004", 3, 0n],
    ["-0.0005", 3, 0n], // half up is toward +infinity: -0.5 -> 0
    ["12.3456", 2, 1235n], // 1234.56 -> 1235
    ["9999999999.999", 3, 9999999999999n],
  ])("%s at scale %d = %s", (value, scale, expected) => {
    expect(decimalToScale(value, scale)).toBe(expected);
  });

  it("not a plain decimal: null", () => {
    expect(decimalToScale("1e3", 3)).toBeNull();
    expect(decimalToScale("", 3)).toBeNull();
    expect(decimalToScale("abc", 3)).toBeNull();
    expect(decimalToScale(".5", 3)).toBeNull();
  });
});

describe("mulToScale", () => {
  it.each([
    ["0.125", "1000", 3, 125000n], // 0.125 x 1000 = 125.000
    ["1.125", "1000", 3, 1125000n],
    ["10", "0.333", 3, 3330n], // 3.330
    ["0.007", "0.5", 3, 4n], // 0.0035 -> half up 0.004
    ["3", "0.333333", 12, 999999000000n], // 0.999999 at 12 decimals
    ["0.125", "0.125", 3, 16n], // 0.015625 -> 0.016
    ["-1.5", "3", 3, -4500n],
    ["2.5", "0", 3, 0n],
  ])("%s x %s at scale %d = %s", (a, b, scale, expected) => {
    expect(mulToScale(a, b, scale)).toBe(expected);
  });

  it("a number factor is read through its plain decimal form", () => {
    expect(mulToScale("2.375", 4, 3)).toBe(9500n); // 9.500
    expect(mulToScale("10.000", 0.2, 3)).toBe(2000n); // 2.000
  });

  it("an exponent-form number or a non-decimal string is null", () => {
    expect(mulToScale("1", 1e-7, 3)).toBeNull(); // String(1e-7) = "1e-7"
    expect(mulToScale("x", "2", 3)).toBeNull();
  });
});

describe("formatScaled", () => {
  it.each([
    [125n, 3, "0.125"],
    [1125000n, 3, "1125.000"],
    [0n, 3, "0.000"],
    [-4500n, 3, "-4.500"],
    [-1n, 3, "-0.001"],
    [10000000000000n, 3, "10000000000.000"],
    [999999000000n, 12, "0.999999000000"],
    [42n, 0, "42"],
  ])("%s at scale %d = %s", (value, scale, expected) => {
    expect(formatScaled(value, scale)).toBe(expected);
  });

  it("round trip: formatScaled(decimalToScale(x)) keeps every decimal", () => {
    for (let i = 0; i < 20000; i++) {
      const s = `${Math.floor(i / 1000)}.${String(i % 1000).padStart(3, "0")}`;
      expect(formatScaled(decimalToScale(s, 3)!, 3)).toBe(s);
    }
  });
});
