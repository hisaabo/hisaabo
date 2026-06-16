import { describe, it, expect } from "vitest";
import {
  formatIndianCurrency,
  formatCompactIndian,
  numberToWordsIndian,
  numberToWordsHindi,
} from "../indian-currency.js";

describe("Indian Currency Formatter", () => {
  describe("formatIndianCurrency", () => {
    it("formats basic amount", () => {
      expect(formatIndianCurrency("1234567.89")).toBe("₹12,34,567.89");
    });

    it("formats crores", () => {
      expect(formatIndianCurrency("12345678.00")).toBe("₹1,23,45,678.00");
    });

    it("formats small amount", () => {
      expect(formatIndianCurrency("500")).toBe("₹500.00");
    });

    it("formats zero", () => {
      expect(formatIndianCurrency("0")).toBe("₹0.00");
    });

    it("handles negative with parentheses", () => {
      expect(formatIndianCurrency("-5000")).toBe("(₹5,000.00)");
    });

    it("formats lakhs correctly", () => {
      expect(formatIndianCurrency("100000")).toBe("₹1,00,000.00");
    });

    it("handles custom symbol", () => {
      expect(formatIndianCurrency("1000", { symbol: "Rs." })).toBe("Rs.1,000.00");
    });

    it("can hide paise", () => {
      expect(formatIndianCurrency("1234.56", { showPaise: false })).toBe("₹1,234");
    });
  });

  describe("formatCompactIndian", () => {
    it("formats crores", () => {
      expect(formatCompactIndian("12500000")).toBe("₹1.25Cr");
    });

    it("formats lakhs", () => {
      expect(formatCompactIndian("350000")).toBe("₹3.5L");
    });

    it("formats thousands", () => {
      expect(formatCompactIndian("5000")).toBe("₹5K");
    });

    it("formats small numbers", () => {
      expect(formatCompactIndian("450")).toBe("₹450");
    });
  });

  describe("numberToWordsIndian", () => {
    it("converts basic amount", () => {
      const result = numberToWordsIndian("12345.67");
      expect(result).toBe("Twelve Thousand Three Hundred and Forty-Five Rupees and Sixty-Seven Paise Only");
    });

    it("converts lakhs", () => {
      const result = numberToWordsIndian("123456");
      expect(result).toBe("One Lakh Twenty-Three Thousand Four Hundred and Fifty-Six Rupees Only");
    });

    it("converts crores", () => {
      const result = numberToWordsIndian("10000000");
      expect(result).toBe("One Crore Rupees Only");
    });

    it("converts zero", () => {
      expect(numberToWordsIndian("0")).toBe("Zero Rupees Only");
    });

    it("converts amount with paise", () => {
      const result = numberToWordsIndian("100.50");
      expect(result).toContain("One Hundred");
      expect(result).toContain("Fifty Paise");
    });

    it("handles large amounts", () => {
      const result = numberToWordsIndian("99999999.99");
      expect(result).toContain("Nine Crore");
      expect(result).toContain("Ninety-Nine Lakh");
      expect(result).toContain("Ninety-Nine Paise");
    });
  });

  describe("numberToWordsHindi", () => {
    it("converts basic amount in Hindi", () => {
      const result = numberToWordsHindi("500");
      expect(result).toContain("पाँच");
      expect(result).toContain("सौ");
      expect(result).toContain("रुपये");
    });

    it("converts zero in Hindi", () => {
      expect(numberToWordsHindi("0")).toBe("शून्य रुपये मात्र");
    });
  });
});
