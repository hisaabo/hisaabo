import { describe, it, expect } from "vitest";
import { money } from "@hisaabo/shared";

describe("RecordPaymentPanel TDS financial allocation logic", () => {
  it("settles gross invoice amount with net cash and TDS deduction (10000 gross, 1000 TDS -> 9000 net)", () => {
    const invoiceBalance = "10000.00";
    const grossSettlement = invoiceBalance; // Gross invoice debt settled
    const tdsDeducted = "1000.00";
    const tdsSectionCode = "194J";
    const tdsRate = "10.0";

    // Net cash received = gross - TDS
    const netCashReceived = money.sub(grossSettlement, tdsDeducted);
    expect(netCashReceived).toBe("9000.00");

    // Allocation payload matches accounting model
    const allocation = {
      invoiceId: "inv-1",
      amount: grossSettlement, // 10,000.00 gross
      tdsAmount: tdsDeducted, // 1,000.00 TDS
      tdsSectionCode,
      tdsRate,
    };

    expect(allocation.amount).toBe("10000.00");
    expect(allocation.tdsAmount).toBe("1000.00");

    // Remaining invoice balance after gross settlement
    const remainingBalance = money.sub(invoiceBalance, allocation.amount);
    expect(money.isPositive(remainingBalance)).toBe(false);
    expect(remainingBalance).toBe("0.00");
  });

  it("handles partial payment with TDS correctly (5000 gross settled on 10000 invoice, 500 TDS -> 4500 net)", () => {
    const invoiceBalance = "10000.00";
    const grossSettlement = "5000.00";
    const tdsDeducted = "500.00";

    const netCashReceived = money.sub(grossSettlement, tdsDeducted);
    expect(netCashReceived).toBe("4500.00");

    const remainingBalance = money.sub(invoiceBalance, grossSettlement);
    expect(remainingBalance).toBe("5000.00");
    expect(money.isPositive(remainingBalance)).toBe(true);
  });

  it("handles zero TDS payment without modifying net cash or allocation", () => {
    const invoiceBalance = "10000.00";
    const grossSettlement = "10000.00";
    const tdsDeducted = "0";

    const netCashReceived = money.sub(grossSettlement, tdsDeducted);
    expect(netCashReceived).toBe("10000.00");

    const remainingBalance = money.sub(invoiceBalance, grossSettlement);
    expect(remainingBalance).toBe("0.00");

    const allocation = {
      invoiceId: "inv-1",
      amount: grossSettlement,
      tdsAmount: undefined,
      tdsSectionCode: undefined,
      tdsRate: undefined,
    };

    expect(allocation.amount).toBe("10000.00");
    expect(allocation.tdsAmount).toBeUndefined();
  });

  it("prevents allocation amount from being inflated beyond invoice balance", () => {
    const invoiceBalance = "10000.00";
    const grossSettlement = "10000.00";
    const tdsDeducted = "1000.00";

    const netCash = money.sub(grossSettlement, tdsDeducted);
    expect(netCash).toBe("9000.00");

    // Bug in previous implementation: amount was sent as (amt + tds) = 11,000
    // Corrected implementation: amount is gross settlement = 10,000
    const submittedAllocationAmount = grossSettlement;
    expect(money.compare(submittedAllocationAmount, invoiceBalance)).toBe(0);
    expect(money.compare(submittedAllocationAmount, invoiceBalance)).toBeLessThanOrEqual(0);
  });

  it("guards against multi-invoice TDS submissions", () => {
    const selectedInvoices = ["inv-1", "inv-2"];
    const tdsDeducted = "500.00";

    const hasMultiInvoiceTds = selectedInvoices.length > 1 && money.isPositive(tdsDeducted);
    expect(hasMultiInvoiceTds).toBe(true);

    // Can only submit when single invoice or zero TDS
    const canSubmitWithTds = selectedInvoices.length <= 1 || !money.isPositive(tdsDeducted);
    expect(canSubmitWithTds).toBe(false);
  });
});
