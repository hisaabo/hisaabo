import { describe, it, expect } from "vitest";
import { composeOpeningBalance, splitOpeningBalance } from "../party-opening.js";

describe("composeOpeningBalance", () => {
  it("To receive stores a positive number: they owe you", () => {
    expect(composeOpeningBalance("5000", "receive")).toBe("5000.00");
    expect(composeOpeningBalance("1200.5", "receive")).toBe("1200.50");
  });

  it("To pay stores a negative number: you owe them", () => {
    expect(composeOpeningBalance("12000", "pay")).toBe("-12000.00");
    expect(composeOpeningBalance("0.07", "pay")).toBe("-0.07");
  });

  it("blank, zero and junk are '0', never '-0'", () => {
    for (const direction of ["receive", "pay"] as const) {
      expect(composeOpeningBalance("", direction)).toBe("0");
      expect(composeOpeningBalance("   ", direction)).toBe("0");
      expect(composeOpeningBalance("0", direction)).toBe("0");
      expect(composeOpeningBalance("0.00", direction)).toBe("0");
      expect(composeOpeningBalance(undefined, direction)).toBe("0");
      expect(composeOpeningBalance("abc", direction)).toBe("0");
    }
  });

  it("a sign typed into the amount is ignored: the direction owns it", () => {
    expect(composeOpeningBalance("-300", "receive")).toBe("300.00");
    expect(composeOpeningBalance("-300", "pay")).toBe("-300.00");
    expect(composeOpeningBalance("+300", "pay")).toBe("-300.00");
  });

  it("the result always satisfies the API's opening-balance format", () => {
    for (const [amount, dir] of [["1", "pay"], ["99999999999.99", "receive"], ["0.5", "pay"]] as const) {
      expect(composeOpeningBalance(amount, dir)).toMatch(/^-?\d{1,13}(\.\d{1,2})?$/);
    }
  });
});

describe("splitOpeningBalance", () => {
  it("a positive stored value is an amount To receive", () => {
    expect(splitOpeningBalance("5000.00")).toEqual({ amount: "5000.00", direction: "receive" });
  });

  it("a negative stored value is an amount To pay", () => {
    expect(splitOpeningBalance("-12000.00")).toEqual({ amount: "12000.00", direction: "pay" });
    expect(splitOpeningBalance("-12000")).toEqual({ amount: "12000.00", direction: "pay" });
  });

  it("zero or nothing is an empty amount, To receive", () => {
    expect(splitOpeningBalance("0")).toEqual({ amount: "", direction: "receive" });
    expect(splitOpeningBalance("0.00")).toEqual({ amount: "", direction: "receive" });
    expect(splitOpeningBalance(null)).toEqual({ amount: "", direction: "receive" });
    expect(splitOpeningBalance(undefined)).toEqual({ amount: "", direction: "receive" });
  });

  it("round-trips", () => {
    for (const stored of ["5000.00", "-12000.00", "0.01", "-0.01"]) {
      const { amount, direction } = splitOpeningBalance(stored);
      expect(composeOpeningBalance(amount, direction)).toBe(stored);
    }
  });
});
