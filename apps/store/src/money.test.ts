import { describe, expect, it } from "vitest";
import { cartPaise, formatMoney, formatPaise, groupIndian, linePaise, toPaise } from "./money";

describe("toPaise", () => {
  it("reads decimal strings without floating point", () => {
    expect(toPaise("1570.00")).toBe(157000);
    expect(toPaise("640.50")).toBe(64050);
    expect(toPaise("0.10")).toBe(10);
    expect(toPaise("19.99")).toBe(1999);
    expect(toPaise("1500")).toBe(150000);
    expect(toPaise("0.5")).toBe(50);
  });

  it("rounds a third decimal half up", () => {
    expect(toPaise("10.005")).toBe(1001);
    expect(toPaise("10.004")).toBe(1000);
  });

  it("treats unreadable input as zero", () => {
    expect(toPaise("")).toBe(0);
    expect(toPaise("abc")).toBe(0);
    expect(toPaise(undefined)).toBe(0);
    expect(toPaise(null)).toBe(0);
    expect(toPaise(Number.NaN)).toBe(0);
  });

  it("accepts numbers and negatives", () => {
    expect(toPaise(12.5)).toBe(1250);
    expect(toPaise("-3.25")).toBe(-325);
  });
});

describe("groupIndian", () => {
  it("groups the last three digits, then pairs", () => {
    expect(groupIndian("5")).toBe("5");
    expect(groupIndian("999")).toBe("999");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("100000")).toBe("1,00,000");
    expect(groupIndian("1234567")).toBe("12,34,567");
    expect(groupIndian("123456789")).toBe("12,34,56,789");
  });
});

describe("formatMoney", () => {
  it("uses Indian grouping everywhere, with no paise on whole amounts", () => {
    expect(formatMoney("1500.00")).toBe("₹1,500");
    expect(formatMoney("1570.00")).toBe("₹1,570");
    expect(formatMoney("1570")).toBe("₹1,570");
    expect(formatMoney("123456.00")).toBe("₹1,23,456");
    expect(formatMoney("0")).toBe("₹0");
  });

  it("shows paise only when there are some", () => {
    expect(formatMoney("640.50")).toBe("₹640.50");
    expect(formatMoney("1234.05")).toBe("₹1,234.05");
    expect(formatMoney("0.99")).toBe("₹0.99");
  });

  it("prints the same price the same way on card, cart and checkout", () => {
    // The Jaisa Organics case: cards showed "₹1,500", cart and checkout "₹1500.00".
    const asOnCard = formatMoney("1500.00");
    const asInCart = formatPaise(linePaise("1500.00", 1));
    const asInCheckout = formatPaise(cartPaise([{ effectivePrice: "1500.00", quantity: 1 }]));
    expect(new Set([asOnCard, asInCart, asInCheckout]).size).toBe(1);
  });

  it("formats other currencies with their code and western grouping", () => {
    expect(formatMoney("1500", "USD")).toBe("USD 1,500");
    expect(formatMoney("1234567.5", "USD")).toBe("USD 1,234,567.50");
  });

  it("handles negatives", () => {
    expect(formatPaise(-157000)).toBe("-₹1,570");
  });
});

describe("cart sums", () => {
  it("adds in integer paise, free of float drift", () => {
    // 0.1 + 0.2 style drift: ten lines of 0.10 must be exactly 1.00.
    const lines = Array.from({ length: 10 }, () => ({ effectivePrice: "0.10", quantity: 1 }));
    expect(cartPaise(lines)).toBe(100);
    expect(formatPaise(cartPaise(lines))).toBe("₹1");
  });

  it("multiplies by quantity", () => {
    expect(linePaise("640.50", 3)).toBe(192150);
    expect(cartPaise([
      { effectivePrice: "70.00", quantity: 1 },
      { effectivePrice: "1500.00", quantity: 1 },
    ])).toBe(157000);
  });
});
