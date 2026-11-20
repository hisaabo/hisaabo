import { describe, expect, it } from "vitest";
import { createPaymentSchema } from "@hisaabo/shared";
import { assertAllocationsFitPayment } from "../routers/payment.js";

describe("TDS payment allocation validation", () => {
  it("accepts gross settlement of 100000 from 98000 cash and 2000 TDS", () => {
    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "2000.00",
      tdsSectionCode: "1001",
      tdsRate: "2.00",
    }], "98000.00")).not.toThrow();
  });

  it("supports TDS across multiple allocations", () => {
    expect(() => assertAllocationsFitPayment([
      { amount: "60000.00", tdsAmount: "600.00", tdsSectionCode: "1001", tdsRate: "1.00" },
      { amount: "40000.00", tdsAmount: "800.00", tdsSectionCode: "1001", tdsRate: "2.00" },
    ], "98600.00")).not.toThrow();
  });

  it("rejects missing section or rate and rejects metadata without TDS", () => {
    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "2000.00",
      tdsSectionCode: "1001",
    }], "98000.00")).toThrow();
    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "0.00",
      tdsSectionCode: "1001",
      tdsRate: "2.00",
    }], "100000.00")).toThrow();
  });

  it("rejects mismatched gross/net totals and negative TDS input", () => {
    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "2000.00",
      tdsSectionCode: "1001",
      tdsRate: "2.00",
    }], "97000.00")).toThrow();
    expect(() => createPaymentSchema.parse({
      partyId: "00000000-0000-0000-0000-000000000000",
      amount: "100.00",
      allocations: [{
        invoiceId: "00000000-0000-0000-0000-000000000001",
        amount: "100.00",
        tdsAmount: "-1.00",
      }],
    })).toThrow();
  });

  it("rejects TDS greater than an individual gross allocation", () => {
    expect(() => assertAllocationsFitPayment([
      { amount: "100.00", tdsAmount: "150.00", tdsSectionCode: "1001", tdsRate: "2.00" },
      { amount: "99900.00", tdsAmount: "1850.00", tdsSectionCode: "1001", tdsRate: "2.00" },
    ], "98000.00")).toThrow("TDS amount cannot exceed gross allocation");
  });

  it("rejects a positive TDS amount with a zero rate", () => {
    expect(() => createPaymentSchema.parse({
      partyId: "00000000-0000-0000-0000-000000000000",
      amount: "98000.00",
      allocations: [{
        invoiceId: "00000000-0000-0000-0000-000000000001",
        amount: "100000.00",
        tdsAmount: "2000.00",
        tdsSectionCode: "1001",
        tdsRate: "0.00",
      }],
    })).toThrow(/TDS rate must be greater than zero/);

    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "2000.00",
      tdsSectionCode: "1001",
      tdsRate: "0.00",
    }], "98000.00")).toThrow("TDS amount requires section code and rate");
  });

  it("rejects positive TDS amount without section code", () => {
    expect(() => createPaymentSchema.parse({
      partyId: "00000000-0000-0000-0000-000000000000",
      amount: "98000.00",
      allocations: [{
        invoiceId: "00000000-0000-0000-0000-000000000001",
        amount: "100000.00",
        tdsAmount: "2000.00",
        tdsRate: "2.00",
      }],
    })).toThrow(/TDS section code is required when TDS amount is positive/);
  });

  it("accepts TDS computed on the pre-GST taxable value (no rate x gross equality)", () => {
    // Invoice 10,000 + 18% GST = 11,800 gross; 10% TDS on 10,000 = 1,000 (not 1,180).
    expect(() => assertAllocationsFitPayment([{
      amount: "11800.00",
      tdsAmount: "1000.00",
      tdsSectionCode: "1023",
      tdsRate: "10.00",
    }], "10800.00")).not.toThrow();
  });

  it("treats the rate as metadata: any amount within (0, gross] is accepted", () => {
    // Customer withheld 9,999 on a 100,000 invoice while quoting 1%: bound-only
    // validation does not second-guess the deducted amount.
    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "9999.00",
      tdsSectionCode: "1023",
      tdsRate: "1.00",
    }], "90001.00")).not.toThrow();
    expect(() => assertAllocationsFitPayment([{
      amount: "100000.00",
      tdsAmount: "2000.02",
      tdsSectionCode: "1023",
      tdsRate: "2.00",
    }], "97999.98")).not.toThrow();
  });

  it("allows TDS equal to the whole gross allocation", () => {
    expect(() => assertAllocationsFitPayment([{
      amount: "100.00",
      tdsAmount: "100.00",
      tdsSectionCode: "1023",
      tdsRate: "100.00",
    }], "0.00")).not.toThrow();
  });

  it("rejects a rate above 100 on the server even if the schema is bypassed", () => {
    expect(() => assertAllocationsFitPayment([{
      amount: "100.00",
      tdsAmount: "10.00",
      tdsSectionCode: "1023",
      tdsRate: "100.01",
    }], "90.00")).toThrow("TDS rate must be between 0 and 100");
  });

  it("supports decimal and 100 percent rates", () => {
    expect(() => assertAllocationsFitPayment([{
      amount: "1000.00",
      tdsAmount: "1.00",
      tdsSectionCode: "1023",
      tdsRate: "0.10",
    }], "999.00")).not.toThrow();
    expect(() => assertAllocationsFitPayment([{
      amount: "100.00",
      tdsAmount: "100.00",
      tdsSectionCode: "1023",
      tdsRate: "100.00",
    }], "0.00")).not.toThrow();
  });

  it("rejects zero TDS with a zero rate in both schema and server validation", () => {
    expect(() => createPaymentSchema.parse({
      partyId: "00000000-0000-0000-0000-000000000000",
      amount: "100.00",
      allocations: [{
        invoiceId: "00000000-0000-0000-0000-000000000001",
        amount: "100.00",
        tdsAmount: "0.00",
        tdsRate: "0.00",
      }],
    })).toThrow(/TDS section and rate must be omitted when TDS amount is zero/);
    expect(() => assertAllocationsFitPayment([{
      amount: "100.00",
      tdsAmount: "0.00",
      tdsRate: "0.00",
    }], "100.00")).toThrow("TDS section and rate require a positive TDS amount");
  });

  it("rejects TDS amount exceeding gross allocation in schema", () => {
    expect(() => createPaymentSchema.parse({
      partyId: "00000000-0000-0000-0000-000000000000",
      amount: "50.00",
      allocations: [{
        invoiceId: "00000000-0000-0000-0000-000000000001",
        amount: "100.00",
        tdsAmount: "150.00",
        tdsSectionCode: "1001",
        tdsRate: "10.00",
      }],
    })).toThrow(/TDS amount cannot exceed gross allocation/);
  });

  it("rejects TDS section or rate when TDS amount is zero", () => {
    expect(() => createPaymentSchema.parse({
      partyId: "00000000-0000-0000-0000-000000000000",
      amount: "100.00",
      allocations: [{
        invoiceId: "00000000-0000-0000-0000-000000000001",
        amount: "100.00",
        tdsAmount: "0.00",
        tdsSectionCode: "1001",
      }],
    })).toThrow(/TDS section and rate must be omitted when TDS amount is zero/);
  });
});
