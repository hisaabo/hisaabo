import { describe, it, expect } from "vitest";
import {
  validateGstin,
  getStateFromGstin,
  determineGstType,
  splitGstComponents,
  validatePan,
} from "../gstin.js";

describe("GSTIN Validator", () => {
  describe("validateGstin", () => {
    it("validates a correct GSTIN (Karnataka)", () => {
      // 29AABCU9603R1ZM — a well-known example
      const result = validateGstin("29AABCU9603R1ZM");
      expect(result.isValid).toBe(true);
      expect(result.stateCode).toBe("29");
      expect(result.stateName).toBe("Karnataka");
      expect(result.pan).toBe("AABCU9603R");
    });

    it("rejects GSTIN with invalid state code", () => {
      const result = validateGstin("99AABCU9603R1ZM");
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("state code"))).toBe(true);
    });

    it("rejects GSTIN with wrong length", () => {
      const result = validateGstin("29AABCU9603R1Z");
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain("15 characters");
    });

    it("rejects GSTIN with invalid check digit", () => {
      const result = validateGstin("29AABCU9603R1ZX"); // Wrong check digit
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("Check digit"))).toBe(true);
    });

    it("rejects GSTIN where position 14 is not Z", () => {
      const result = validateGstin("29AABCU9603R1AM");
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("Position 14"))).toBe(true);
    });

    it("handles empty and null input", () => {
      expect(validateGstin("").isValid).toBe(false);
      expect(validateGstin(null as any).isValid).toBe(false);
    });

    it("validates Maharashtra GSTIN", () => {
      const result = validateGstin("27AAPFU0939F1ZV");
      expect(result.stateCode).toBe("27");
      expect(result.stateName).toBe("Maharashtra");
    });

    it("detects Delhi state", () => {
      const result = getStateFromGstin("07AAACW6874Q1ZR");
      expect(result?.code).toBe("07");
      expect(result?.name).toBe("Delhi");
    });
  });

  describe("determineGstType", () => {
    it("returns intra for same state", () => {
      expect(determineGstType("29", "29")).toBe("intra");
    });

    it("returns inter for different states", () => {
      expect(determineGstType("29", "27")).toBe("inter");
    });

    it("returns inter for empty state code", () => {
      expect(determineGstType("", "29")).toBe("inter");
    });
  });

  describe("splitGstComponents", () => {
    it("splits intra-state: full to CGST+SGST equally", () => {
      const result = splitGstComponents("180.00", "intra");
      expect(result.igst).toBe("0.00");
      expect(result.cgst).toBe("90.00");
      expect(result.sgst).toBe("90.00");
    });

    it("assigns full to IGST for inter-state", () => {
      const result = splitGstComponents("180.00", "inter");
      expect(result.igst).toBe("180.00");
      expect(result.cgst).toBe("0.00");
      expect(result.sgst).toBe("0.00");
    });

    it("handles odd paise split correctly", () => {
      const result = splitGstComponents("9.01", "intra");
      // 9.01 / 2 = 4.505 → CGST=4.50, SGST=4.51 (remainder goes to SGST)
      const total = parseFloat(result.cgst) + parseFloat(result.sgst);
      expect(total.toFixed(2)).toBe("9.01");
    });
  });

  describe("validatePan", () => {
    it("validates correct PAN", () => {
      const result = validatePan("AABCU9603R");
      expect(result.isValid).toBe(true);
      expect(result.entityType).toBe("Company"); // 4th char 'C'
    });

    it("rejects PAN with invalid format", () => {
      const result = validatePan("12345ABCDE");
      expect(result.isValid).toBe(false);
    });

    it("detects Individual PAN", () => {
      const result = validatePan("ABCPK1234A");
      expect(result.isValid).toBe(true);
      expect(result.entityType).toBe("Individual");
    });
  });
});
