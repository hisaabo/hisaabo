/**
 * Regression tests for invoice integrity rules: totals sanity checks,
 * status transitions, the shared delete rule, and input normalisation.
 */

import { describe, it, expect } from "vitest";
import { validateInvoiceTotals, calcInvoiceTotals } from "../calc.js";
import { checkInvoiceStatusTransition } from "../invoice-status.js";
import { checkInvoiceDeleteAllowed, INVOICE_DELETE_WINDOW_MS } from "../permissions.js";
import { createInvoiceSchema, createBusinessSchema, loginSchema, registerSchema } from "../validators.js";

const line = { quantity: "1", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" };

describe("validateInvoiceTotals", () => {
  it("accepts a normal invoice", () => {
    expect(validateInvoiceTotals({ lineItems: [line], invoiceDiscount: "100", roundOff: "-0.50" })).toBeNull();
  });

  it("rejects a percent discount above 100", () => {
    expect(validateInvoiceTotals({ lineItems: [line], invoiceDiscount: "101", invoiceDiscountType: "percent" }))
      .toMatch(/100%/);
  });

  it("accepts a 100% discount (total becomes the tax-only remainder of zero)", () => {
    const err = validateInvoiceTotals({ lineItems: [line], invoiceDiscount: "100", invoiceDiscountType: "percent" });
    // 100% of subtotal leaves the tax: still non-negative
    expect(err).toBeNull();
  });

  it("rejects an amount discount larger than subtotal + tax", () => {
    expect(validateInvoiceTotals({ lineItems: [line], invoiceDiscount: "1180.01" })).toMatch(/subtotal plus tax/);
    expect(validateInvoiceTotals({ lineItems: [line], invoiceDiscount: "1180.00" })).toBeNull();
  });

  it("rejects negative discounts", () => {
    expect(validateInvoiceTotals({ lineItems: [line], invoiceDiscount: "-5" })).toMatch(/negative/);
  });

  it("rejects round-off beyond +/- 1.00", () => {
    expect(validateInvoiceTotals({ lineItems: [line], roundOff: "-1.01" })).toMatch(/Round off/);
    expect(validateInvoiceTotals({ lineItems: [line], roundOff: "1.01" })).toMatch(/Round off/);
    expect(validateInvoiceTotals({ lineItems: [line], roundOff: "-1.00" })).toBeNull();
    expect(validateInvoiceTotals({ lineItems: [line], roundOff: "1.00" })).toBeNull();
  });

  it("rejects a huge negative round-off that would zero the total", () => {
    expect(validateInvoiceTotals({ lineItems: [line], roundOff: "-100000" })).not.toBeNull();
  });

  it("never lets total go negative on a zero-value invoice with negative round-off", () => {
    const zero = { quantity: "1", unitPrice: "0.00", taxPercent: "0", discountPercent: "0" };
    expect(validateInvoiceTotals({ lineItems: [zero], roundOff: "-0.50" })).toMatch(/negative/);
  });

  it("does not change calcInvoiceTotals output", () => {
    expect(calcInvoiceTotals({ lineItems: [line], roundOff: "-0.50" }).total).toBe("1179.50");
  });
});

describe("createInvoiceSchema totals enforcement", () => {
  const base = {
    partyId: "11111111-1111-4111-8111-111111111111",
    type: "sale" as const,
    lineItems: [{ itemName: "Widget", quantity: "1", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" }],
  };

  it("accepts a valid payload", () => {
    expect(createInvoiceSchema.safeParse(base).success).toBe(true);
  });

  it("rejects percent discount over 100, oversized discount and oversized round-off", () => {
    expect(createInvoiceSchema.safeParse({ ...base, invoiceDiscount: "150", invoiceDiscountType: "percent" }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, invoiceDiscount: "999999" }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, roundOff: "-5000" }).success).toBe(false);
  });
});

describe("checkInvoiceStatusTransition", () => {
  const unpaid = { totalAmount: "100.00", amountPaid: "0.00" };
  const covered = { totalAmount: "100.00", amountPaid: "100.00" };
  const part = { totalAmount: "100.00", amountPaid: "40.00" };

  it("allows the documented manual moves", () => {
    expect(checkInvoiceStatusTransition("draft", "sent", unpaid)).toBeNull();
    expect(checkInvoiceStatusTransition("sent", "overdue", unpaid)).toBeNull();
    expect(checkInvoiceStatusTransition("overdue", "sent", unpaid)).toBeNull();
    expect(checkInvoiceStatusTransition("sent", "cancelled", unpaid)).toBeNull();
    expect(checkInvoiceStatusTransition("sent", "sent", unpaid)).toBeNull();
  });

  it("blocks manual paid unless payments cover the total", () => {
    expect(checkInvoiceStatusTransition("sent", "paid", unpaid)).toMatch(/payments/);
    expect(checkInvoiceStatusTransition("partial", "paid", part)).toMatch(/payments/);
    expect(checkInvoiceStatusTransition("sent", "paid", covered)).toBeNull();
  });

  it("never allows manually setting partial", () => {
    expect(checkInvoiceStatusTransition("sent", "partial", part)).not.toBeNull();
  });

  it("makes paid, cancelled and adjusted terminal", () => {
    expect(checkInvoiceStatusTransition("paid", "draft", covered)).not.toBeNull();
    expect(checkInvoiceStatusTransition("paid", "sent", covered)).not.toBeNull();
    expect(checkInvoiceStatusTransition("cancelled", "sent", unpaid)).not.toBeNull();
    expect(checkInvoiceStatusTransition("adjusted", "sent", unpaid)).not.toBeNull();
  });

  it("blocks draft and cancelled while payments are allocated", () => {
    expect(checkInvoiceStatusTransition("partial", "cancelled", part)).toMatch(/payments/);
    expect(checkInvoiceStatusTransition("sent", "draft", part)).toMatch(/payments/);
  });
});

describe("checkInvoiceDeleteAllowed (shared by invoice and document routers)", () => {
  const now = Date.now();
  const fresh = { status: "sent", createdAt: new Date(now - 60_000) };

  it("allows admins unconditionally", () => {
    const old = { status: "paid", createdAt: new Date(now - 10 * INVOICE_DELETE_WINDOW_MS) };
    expect(checkInvoiceDeleteAllowed("admin", old, now).allowed).toBe(true);
    expect(checkInvoiceDeleteAllowed("owner", old, now).allowed).toBe(true);
  });

  it("limits seller_manager to unpaid invoices within 2 hours", () => {
    expect(checkInvoiceDeleteAllowed("seller_manager", fresh, now).allowed).toBe(true);
    expect(checkInvoiceDeleteAllowed("seller_manager", { ...fresh, status: "paid" }, now))
      .toMatchObject({ allowed: false, reason: "invoice-paid" });
    expect(checkInvoiceDeleteAllowed("seller_manager", { ...fresh, createdAt: new Date(now - INVOICE_DELETE_WINDOW_MS - 1) }, now))
      .toMatchObject({ allowed: false, reason: "window-expired" });
  });

  it("denies roles without delete permission", () => {
    expect(checkInvoiceDeleteAllowed("seller", fresh, now)).toMatchObject({ allowed: false, reason: "no-permission" });
    expect(checkInvoiceDeleteAllowed("accountant", fresh, now).allowed).toBe(false);
    expect(checkInvoiceDeleteAllowed(undefined, fresh, now).allowed).toBe(false);
  });
});

describe("input normalisation", () => {
  it("lowercases and trims auth emails", () => {
    expect(loginSchema.parse({ email: "  User@Example.COM ", password: "secure123" }).email).toBe("user@example.com");
    expect(registerSchema.parse({
      email: "A@B.com", name: "Rahul", password: "secure123", confirmPassword: "secure123",
    }).email).toBe("a@b.com");
  });

  const biz = { name: "Shop", pan: "ABCDE1234F", phone: "9999999999", address: "Street" };

  it("restricts invoicePrefix to [A-Za-z0-9_-]", () => {
    expect(createBusinessSchema.safeParse({ ...biz, invoicePrefix: "INV-2_a" }).success).toBe(true);
    expect(createBusinessSchema.safeParse({ ...biz, invoicePrefix: "INV/1" }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...biz, invoicePrefix: "IN V" }).success).toBe(false);
    expect(createBusinessSchema.safeParse({ ...biz, invoicePrefix: "<b>" }).success).toBe(false);
  });
});
