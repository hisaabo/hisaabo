import { describe, it, expect } from "vitest";
import { calculateItcUtilization, checkItcAging } from "../itc.js";

describe("ITC Utilization Calculator", () => {
  describe("calculateItcUtilization", () => {
    it("utilizes IGST credit against IGST liability first", () => {
      const result = calculateItcUtilization(
        { igst: "50000.00", cgst: "0.00", sgst: "0.00" },
        { igst: "30000.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
      );
      expect(result.remainingCredit.igst).toBe("20000.00");
      expect(result.cashPaymentRequired.igst).toBe("0.00");
      expect(result.cashPaymentRequired.total).toBe("0.00");
    });

    it("cross-utilizes IGST credit against CGST then SGST", () => {
      const result = calculateItcUtilization(
        { igst: "100000.00", cgst: "0.00", sgst: "0.00" },
        { igst: "30000.00", cgst: "40000.00", sgst: "40000.00", cess: "0.00" },
      );
      expect(result.cashPaymentRequired.igst).toBe("0.00");
      expect(result.cashPaymentRequired.cgst).toBe("0.00");
      expect(result.cashPaymentRequired.sgst).toBe("10000.00");
      expect(result.remainingCredit.igst).toBe("0.00");
    });

    it("never uses CGST credit against SGST liability", () => {
      const result = calculateItcUtilization(
        { igst: "0.00", cgst: "50000.00", sgst: "0.00" },
        { igst: "0.00", cgst: "20000.00", sgst: "30000.00", cess: "0.00" },
      );
      // CGST can go to CGST (20K) and IGST (0), NOT to SGST
      expect(result.remainingCredit.cgst).toBe("30000.00");
      expect(result.cashPaymentRequired.sgst).toBe("30000.00");
    });

    it("never uses SGST credit against CGST liability", () => {
      const result = calculateItcUtilization(
        { igst: "0.00", cgst: "0.00", sgst: "50000.00" },
        { igst: "0.00", cgst: "30000.00", sgst: "20000.00", cess: "0.00" },
      );
      // SGST can go to SGST (20K) and IGST (0), NOT to CGST
      expect(result.remainingCredit.sgst).toBe("30000.00");
      expect(result.cashPaymentRequired.cgst).toBe("30000.00");
    });

    it("handles complex scenario with all three credits", () => {
      const result = calculateItcUtilization(
        { igst: "50000.00", cgst: "30000.00", sgst: "20000.00" },
        { igst: "40000.00", cgst: "35000.00", sgst: "25000.00", cess: "5000.00" },
      );
      // Step 1: IGST 50K → IGST 40K (used 40K, remaining IGST credit 10K)
      // Step 2: IGST 10K → CGST 35K (used 10K, CGST liability remaining 25K)
      // Step 3: IGST 0K → SGST (nothing)
      // Step 4: CGST 30K → CGST 25K (used 25K, CGST credit remaining 5K)
      // Step 5: CGST 5K → IGST 0K (nothing to apply)
      // Step 6: SGST 20K → SGST 25K (used 20K, SGST liability remaining 5K)
      // Step 7: SGST 0K → IGST (nothing)
      // Cash: IGST=0, CGST=0, SGST=5K, Cess=5K
      expect(result.cashPaymentRequired.igst).toBe("0.00");
      expect(result.cashPaymentRequired.cgst).toBe("0.00");
      expect(result.cashPaymentRequired.sgst).toBe("5000.00");
      expect(result.cashPaymentRequired.cess).toBe("5000.00");
    });

    it("records step-by-step utilization trail", () => {
      const result = calculateItcUtilization(
        { igst: "10000.00", cgst: "5000.00", sgst: "5000.00" },
        { igst: "5000.00", cgst: "5000.00", sgst: "5000.00", cess: "0.00" },
      );
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.steps[0].step).toBe(1);
      expect(result.steps[0].creditType).toBe("igst");
      expect(result.steps[0].appliedAgainst).toBe("igst");
    });
  });

  describe("checkItcAging", () => {
    it("marks invoice within 180 days as safe", () => {
      const today = new Date();
      const recent = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = checkItcAging(recent.toISOString().split("T")[0], today.toISOString().split("T")[0]);
      expect(result.mustReverse).toBe(false);
      expect(result.daysElapsed).toBe(30);
      expect(result.daysRemaining).toBe(150);
    });

    it("marks invoice at 150+ days as nearing expiry", () => {
      const today = new Date();
      const old = new Date(today.getTime() - 160 * 24 * 60 * 60 * 1000);
      const result = checkItcAging(old.toISOString().split("T")[0], today.toISOString().split("T")[0]);
      expect(result.isNearingExpiry).toBe(true);
      expect(result.mustReverse).toBe(false);
    });

    it("marks invoice at 180+ days for mandatory reversal", () => {
      const today = new Date();
      const old = new Date(today.getTime() - 200 * 24 * 60 * 60 * 1000);
      const result = checkItcAging(old.toISOString().split("T")[0], today.toISOString().split("T")[0]);
      expect(result.mustReverse).toBe(true);
      expect(result.daysRemaining).toBe(0);
    });
  });
});
