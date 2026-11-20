/**
 * RecordPaymentPanel — TDS submit logic.
 *
 * Exercises the production helpers the panel submits through
 * (`@/lib/paymentAllocations` and the shared `suggestTdsAmount`), not a
 * re-implementation of the arithmetic.
 */

import { describe, it, expect } from "vitest";
import { suggestTdsAmount, invoiceTaxableValue, normalizeMoneyInput } from "@hisaabo/shared";
import { allocationsForRequest, buildAllocationPayload } from "@/lib/paymentAllocations";

const NO_TDS = { amount: "", sectionCode: "", rate: "" };

function build(
  allocations: Record<string, string>,
  tds = NO_TDS,
  checked: string[] = Object.keys(allocations),
  isCustomer = true,
) {
  return buildAllocationPayload({ checkedInvoiceIds: checked, allocations, tds, isCustomer });
}

describe("buildAllocationPayload", () => {
  it("sends the gross allocation with TDS metadata for a single invoice", () => {
    const result = build({ "inv-1": "10000.00" }, { amount: "1000.00", sectionCode: "1027", rate: "10" });
    expect(result).toEqual({
      ok: true,
      allocations: [{
        invoiceId: "inv-1",
        amount: "10000.00",
        tdsAmount: "1000.00",
        tdsSectionCode: "1027",
        tdsRate: "10.00",
      }],
    });
  });

  it("does not require TDS to equal rate x gross (TDS on the pre-GST value)", () => {
    // Invoice 10,000 + 18% GST = 11,800; 10% TDS on 10,000 = 1,000, not 1,180.
    const result = build({ "inv-1": "11800.00" }, { amount: "1000.00", sectionCode: "1027", rate: "10" });
    expect(result.ok).toBe(true);
  });

  it("normalises typed amounts to 2dp strings the API regex accepts", () => {
    const result = build(
      { "inv-1": "500.", "inv-2": "12.345" },
      NO_TDS,
    );
    expect(result).toEqual({
      ok: true,
      allocations: [
        { invoiceId: "inv-1", amount: "500.00" },
        { invoiceId: "inv-2", amount: expect.stringMatching(/^\d+\.\d{2}$/) },
      ],
    });
    const withTds = build({ "inv-1": "500." }, { amount: "50.", sectionCode: "1023", rate: "7.345" });
    expect(withTds).toMatchObject({
      ok: true,
      allocations: [{ amount: "500.00", tdsAmount: "50.00", tdsRate: expect.stringMatching(/^\d+\.\d{2}$/) }],
    });
  });

  it("omits TDS fields when no TDS is entered or the party is not a customer", () => {
    expect(build({ "inv-1": "100" })).toEqual({
      ok: true,
      allocations: [{ invoiceId: "inv-1", amount: "100.00" }],
    });
    expect(build({ "inv-1": "100" }, { amount: "10", sectionCode: "1027", rate: "10" }, undefined, false)).toEqual({
      ok: true,
      allocations: [{ invoiceId: "inv-1", amount: "100.00" }],
    });
  });

  it("only includes checked invoices with a positive amount", () => {
    const result = build({ "inv-1": "100", "inv-2": "0", "inv-3": "50" }, NO_TDS, ["inv-1", "inv-2"]);
    expect(result).toEqual({ ok: true, allocations: [{ invoiceId: "inv-1", amount: "100.00" }] });
  });

  it("rejects TDS on multiple invoices", () => {
    const result = build({ "inv-1": "100", "inv-2": "200" }, { amount: "10", sectionCode: "1027", rate: "10" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Multi-invoice") });
  });

  it("rejects TDS above the gross allocation, a missing section/rate, a rate above 100, or no invoice", () => {
    expect(build({ "inv-1": "100" }, { amount: "150", sectionCode: "1027", rate: "10" }))
      .toMatchObject({ ok: false, error: "TDS amount cannot exceed gross allocation" });
    expect(build({ "inv-1": "100" }, { amount: "10", sectionCode: "", rate: "10" }))
      .toMatchObject({ ok: false });
    expect(build({ "inv-1": "100" }, { amount: "10", sectionCode: "1027", rate: "" }))
      .toMatchObject({ ok: false });
    expect(build({ "inv-1": "100" }, { amount: "10", sectionCode: "1027", rate: "101" }))
      .toMatchObject({ ok: false });
    expect(build({}, { amount: "10", sectionCode: "1027", rate: "10" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("Select an invoice") });
  });
});

describe("allocationsForRequest", () => {
  it("edit mode always sends the array so unchecking every invoice clears allocations", () => {
    expect(allocationsForRequest(true, [])).toEqual([]);
    expect(allocationsForRequest(true, [{ invoiceId: "inv-1", amount: "1.00" }]))
      .toEqual([{ invoiceId: "inv-1", amount: "1.00" }]);
  });

  it("create mode omits the array for an advance payment", () => {
    expect(allocationsForRequest(false, [])).toBeUndefined();
    expect(allocationsForRequest(false, [{ invoiceId: "inv-1", amount: "1.00" }]))
      .toEqual([{ invoiceId: "inv-1", amount: "1.00" }]);
  });
});

describe("TDS pre-fill on the taxable value (excluding GST)", () => {
  const invoice = { total: "11800.00", tax: "1800.00" };

  it("derives the taxable value from the invoice total and GST", () => {
    expect(invoiceTaxableValue(invoice.total, invoice.tax)).toBe("10000.00");
    expect(invoiceTaxableValue("100.00", "150.00")).toBe("0.00");
  });

  it("suggests rate x taxable value for a full settlement", () => {
    expect(suggestTdsAmount({
      allocationAmount: "11800.00", invoiceTotal: invoice.total, invoiceTaxAmount: invoice.tax, rate: "10",
    })).toBe("1000.00");
  });

  it("scales the taxable value to a partial allocation", () => {
    expect(suggestTdsAmount({
      allocationAmount: "5900.00", invoiceTotal: invoice.total, invoiceTaxAmount: invoice.tax, rate: "10",
    })).toBe("500.00");
  });

  it("equals rate x gross when the invoice carries no GST", () => {
    expect(suggestTdsAmount({
      allocationAmount: "10000.00", invoiceTotal: "10000.00", invoiceTaxAmount: "0.00", rate: "2",
    })).toBe("200.00");
  });

  it("handles fractional rates and rounds to paise", () => {
    expect(suggestTdsAmount({
      allocationAmount: "1000.00", invoiceTotal: "1000.00", invoiceTaxAmount: "0.00", rate: "0.10",
    })).toBe("1.00");
    expect(suggestTdsAmount({
      allocationAmount: "333.33", invoiceTotal: "333.33", invoiceTaxAmount: "0.00", rate: "10",
    })).toBe("33.33");
  });

  it("returns 0.00 for a non-positive rate or allocation", () => {
    expect(suggestTdsAmount({
      allocationAmount: "100.00", invoiceTotal: "100.00", invoiceTaxAmount: "0.00", rate: "0",
    })).toBe("0.00");
    expect(suggestTdsAmount({
      allocationAmount: "0.00", invoiceTotal: "100.00", invoiceTaxAmount: "0.00", rate: "10",
    })).toBe("0.00");
  });
});

describe("normalizeMoneyInput", () => {
  it("normalises partial and over-precise input", () => {
    expect(normalizeMoneyInput("500.")).toBe("500.00");
    expect(normalizeMoneyInput(" 7 ")).toBe("7.00");
    expect(normalizeMoneyInput("")).toBe("0.00");
    expect(normalizeMoneyInput(undefined)).toBe("0.00");
    expect(normalizeMoneyInput("12.5")).toBe("12.50");
  });
});
