import { describe, it, expect } from "vitest";
import { calculateTds, calculateSalaryTds, TDS_SECTIONS } from "../tds.js";

describe("TDS Calculator", () => {
  describe("calculateTds", () => {
    it("calculates 194J(b) professional fees at 10%", () => {
      const result = calculateTds({
        section: "194J(b)",
        grossAmount: "50000",
        cumulativePaidThisFy: "0",
        hasPan: true,
        isNonFiler: false,
      });
      expect(result.tdsApplicable).toBe(true);
      expect(result.effectiveRate).toBe("10");
      expect(result.tdsAmount).toBe("5000.00");
      expect(result.netPayable).toBe("45000.00");
    });

    it("does not deduct when below threshold", () => {
      const result = calculateTds({
        section: "194J(b)",
        grossAmount: "20000",
        cumulativePaidThisFy: "0",
        hasPan: true,
      });
      expect(result.tdsApplicable).toBe(false);
      expect(result.tdsAmount).toBe("0.00");
      expect(result.exemptionReason).toContain("Below threshold");
    });

    it("applies 20% for no-PAN (Section 206AA)", () => {
      const result = calculateTds({
        section: "194J(b)",
        grossAmount: "50000",
        cumulativePaidThisFy: "0",
        hasPan: false,
      });
      expect(result.effectiveRate).toBe("20");
      expect(result.tdsAmount).toBe("10000.00");
    });

    it("applies higher rate for non-filers (Section 206AB)", () => {
      const result = calculateTds({
        section: "194J(b)",
        grossAmount: "50000",
        cumulativePaidThisFy: "0",
        hasPan: true,
        isNonFiler: true,
      });
      // 206AB: higher of twice section rate (20%) or 5%
      expect(result.effectiveRate).toBe("20");
    });

    it("applies lower deduction certificate rate", () => {
      const result = calculateTds({
        section: "194J(b)",
        grossAmount: "100000",
        cumulativePaidThisFy: "0",
        hasPan: true,
        hasLowerDeductionCert: true,
        lowerDeductionRate: "2",
      });
      expect(result.effectiveRate).toBe("2");
      expect(result.tdsAmount).toBe("2000.00");
    });

    it("handles 194C — Individual at 1%", () => {
      const result = calculateTds({
        section: "194C",
        grossAmount: "50000",
        hasPan: true,
        isIndividualHuf: true,
      });
      expect(result.tdsApplicable).toBe(true);
      expect(result.effectiveRate).toBe("1");
      expect(result.tdsAmount).toBe("500.00");
    });

    it("handles 194C — Company at 2%", () => {
      const result = calculateTds({
        section: "194C",
        grossAmount: "50000",
        hasPan: true,
        isIndividualHuf: false,
      });
      expect(result.effectiveRate).toBe("2");
      expect(result.tdsAmount).toBe("1000.00");
    });

    it("handles 194I(b) rent with cumulative threshold", () => {
      const result = calculateTds({
        section: "194I(b)",
        grossAmount: "30000",
        cumulativePaidThisFy: "220000", // 220000 + 30000 = 250000 > 240000
        hasPan: true,
      });
      expect(result.tdsApplicable).toBe(true);
      expect(result.effectiveRate).toBe("10");
    });
  });

  describe("calculateSalaryTds", () => {
    it("calculates TDS for new regime salary", () => {
      const result = calculateSalaryTds({
        monthlySalary: "100000",
        monthsRemaining: 12,
        paidSalaryThisFy: "0",
        tdsPaidThisFy: "0",
        deductions80C: "0",
        deductions80D: "0",
        deductionsOther: "0",
        hraExemption: "0",
        regime: "new",
      });
      // Annual: 12L, Std ded: 75K, Taxable: 11,25,000
      // Tax calc: 0-3L=0, 3-7L=20K, 7-10L=30K, 10-11.25L=18,750 = 68,750
      expect(parseFloat(result.taxableIncome)).toBe(1125000);
      expect(parseFloat(result.monthlyTds)).toBeGreaterThan(0);
    });

    it("applies rebate u/s 87A for new regime under 7L", () => {
      const result = calculateSalaryTds({
        monthlySalary: "55000",
        monthsRemaining: 12,
        paidSalaryThisFy: "0",
        tdsPaidThisFy: "0",
        deductions80C: "0",
        deductions80D: "0",
        deductionsOther: "0",
        hraExemption: "0",
        regime: "new",
      });
      // Annual: 6.6L, Std ded: 75K = 5.85L taxable
      // Under 7L → Rebate → zero tax
      expect(result.monthlyTds).toBe("0.00");
    });
  });

  describe("TDS_SECTIONS", () => {
    it("has all major sections defined", () => {
      expect(TDS_SECTIONS.length).toBeGreaterThanOrEqual(14);
      expect(TDS_SECTIONS.find(s => s.section === "194C")).toBeDefined();
      expect(TDS_SECTIONS.find(s => s.section === "194J(b)")).toBeDefined();
      expect(TDS_SECTIONS.find(s => s.section === "194I(b)")).toBeDefined();
    });
  });
});
