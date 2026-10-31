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
      { amount: "60000.00", tdsAmount: "1000.00", tdsSectionCode: "1001", tdsRate: "2.00" },
      { amount: "40000.00", tdsAmount: "1000.00", tdsSectionCode: "1001", tdsRate: "2.00" },
    ], "98000.00")).not.toThrow();
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
    })).toThrow(/TDS section and rate require a positive TDS amount/);
  });
});
