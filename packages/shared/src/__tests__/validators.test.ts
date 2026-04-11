/**
 * Tests for packages/shared/src/validators.ts
 *
 * WHY THIS FILE EXISTS:
 * The validators.ts file is the single source of truth for all input validation
 * shared between the API and the web frontend. If a validator is too permissive,
 * invalid data reaches the database. If it is too strict, the UI blocks legitimate
 * user workflows. These tests document the exact shape of every schema so that
 * contributors can safely refactor validators without silently breaking the contract.
 *
 * APPROACH: Each test calls .safeParse() and asserts on the success flag and
 * error paths, rather than relying on thrown exceptions, for precision.
 */

import { describe, it, expect } from "vitest";
import {
  // Auth
  loginSchema,
  registerSchema,
  // Business
  createBusinessSchema,
  // Party
  createPartySchema,
  // Item
  createItemSchema,
  // Invoice
  createInvoiceSchema,
  invoiceLineItemSchema,
  // Payment
  createPaymentSchema,
  // Expense
  createExpenseSchema,
  // Pagination
  paginationSchema,
} from "../validators.js";

// ─────────────────────────────────────────────────────────────────────────────
// loginSchema
// ─────────────────────────────────────────────────────────────────────────────
describe("loginSchema — validates email + password login credentials", () => {
  it("accepts a valid email and password", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "secure123" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email address format", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "secure123" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("email");
  });

  it("rejects a password shorter than 8 characters", () => {
    // Minimum length prevents the most common weak passwords.
    const result = loginSchema.safeParse({ email: "user@example.com", password: "short" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("password");
  });

  it("rejects a password longer than 128 characters", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "a".repeat(129),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("password");
  });

  it("rejects an email longer than 255 characters", () => {
    const longEmail = "a".repeat(250) + "@b.com";
    const result = loginSchema.safeParse({ email: longEmail, password: "secure123" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerSchema
// ─────────────────────────────────────────────────────────────────────────────
describe("registerSchema — validates new user registration input", () => {
  const validInput = {
    email: "rahul@example.in",
    name: "Rahul Sharma",
    password: "mypassword123",
    confirmPassword: "mypassword123",
  };

  it("accepts valid registration data with matching passwords", () => {
    expect(registerSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects when password and confirmPassword do not match", () => {
    const result = registerSchema.safeParse({
      ...validInput,
      confirmPassword: "differentpassword",
    });
    expect(result.success).toBe(false);
    // The refine error should point to the confirmPassword field
    expect(result.error?.issues[0].path).toContain("confirmPassword");
  });

  it("rejects a name shorter than 2 characters", () => {
    // Single-character names are almost certainly data entry errors.
    const result = registerSchema.safeParse({ ...validInput, name: "R" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("name");
  });

  it("rejects a name longer than 100 characters", () => {
    const result = registerSchema.safeParse({ ...validInput, name: "A".repeat(101) });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createBusinessSchema — GSTIN and PAN validation
// ─────────────────────────────────────────────────────────────────────────────
describe("createBusinessSchema — validates Indian business registration with GSTIN/PAN", () => {
  const validBusiness = {
    name: "Mehta Electronics Pvt Ltd",
    pan: "AABCM1234D",
    phone: "9876543210",
    address: "42, MG Road, Bengaluru",
    gstRegistrationType: "regular" as const,
  };

  it("accepts a valid business with required fields", () => {
    expect(createBusinessSchema.safeParse(validBusiness).success).toBe(true);
  });

  it("accepts a valid 15-character GSTIN in the correct format", () => {
    // GST Identification Number format: 2-digit state code + 5-char PAN + 4-digit year +
    // 1-char entity + 1-char Z literal + 1 checksum
    const result = createBusinessSchema.safeParse({
      ...validBusiness,
      gstin: "29AABCM1234D1Z5",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid GSTIN (wrong format)", () => {
    const result = createBusinessSchema.safeParse({
      ...validBusiness,
      gstin: "INVALID-GSTIN",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty string GSTIN (unregistered businesses don't have a GSTIN)", () => {
    const result = createBusinessSchema.safeParse({
      ...validBusiness,
      gstin: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid PAN format", () => {
    // PAN must be exactly 10 chars: AAAAA9999A format.
    const result = createBusinessSchema.safeParse({
      ...validBusiness,
      pan: "INVALID",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a business name that is empty", () => {
    const result = createBusinessSchema.safeParse({ ...validBusiness, name: "" });
    expect(result.success).toBe(false);
  });

  it("defaults invoicePrefix to 'INV' when not provided", () => {
    const result = createBusinessSchema.safeParse(validBusiness);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invoicePrefix).toBe("INV");
    }
  });

  it("defaults currency to 'INR' when not provided", () => {
    const result = createBusinessSchema.safeParse(validBusiness);
    if (result.success) {
      expect(result.data.currency).toBe("INR");
    }
  });

  it("rejects a currency code that is not exactly 3 characters", () => {
    // ISO 4217 codes are always 3 characters (INR, USD, EUR, etc.)
    const result = createBusinessSchema.safeParse({ ...validBusiness, currency: "INRR" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createPartySchema — customer/supplier validation
// ─────────────────────────────────────────────────────────────────────────────
describe("createPartySchema — validates creation of a customer or supplier (party)", () => {
  const validCustomer = {
    type: "customer" as const,
    name: "Priya Patel",
    phone: "9845012345",
  };

  it("accepts a minimal valid customer with only required fields", () => {
    expect(createPartySchema.safeParse(validCustomer).success).toBe(true);
  });

  it("accepts a supplier type", () => {
    expect(createPartySchema.safeParse({ ...validCustomer, type: "supplier" }).success).toBe(true);
  });

  it("rejects an empty party name", () => {
    const result = createPartySchema.safeParse({ ...validCustomer, name: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid GSTIN for a party", () => {
    const result = createPartySchema.safeParse({
      ...validCustomer,
      gstin: "27AAPFU0939F1ZV",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty string GSTIN (unregistered parties)", () => {
    const result = createPartySchema.safeParse({ ...validCustomer, gstin: "" });
    expect(result.success).toBe(true);
  });

  it("rejects a creditPeriodDays value above 365", () => {
    // Credit periods beyond a year are likely a data entry error.
    const result = createPartySchema.safeParse({
      ...validCustomer,
      creditPeriodDays: 400,
    });
    expect(result.success).toBe(false);
  });

  it("accepts creditPeriodDays of 0 (net-due-on-receipt)", () => {
    const result = createPartySchema.safeParse({
      ...validCustomer,
      creditPeriodDays: 0,
    });
    expect(result.success).toBe(true);
  });

  it("defaults openingBalance to '0' when not provided", () => {
    const result = createPartySchema.safeParse(validCustomer);
    if (result.success) {
      expect(result.data.openingBalance).toBe("0");
    }
  });

  it("accepts a negative opening balance (party owes us money from previous system)", () => {
    const result = createPartySchema.safeParse({
      ...validCustomer,
      openingBalance: "-5000.00",
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createItemSchema — product/service item with mode constraints
// ─────────────────────────────────────────────────────────────────────────────
describe("createItemSchema — validates item creation with mode constraints", () => {
  const simpleItem = {
    name: "Basmati Rice 5kg",
    unit: "kg" as const,
  };

  it("accepts a simple item without variants", () => {
    expect(createItemSchema.safeParse(simpleItem).success).toBe(true);
  });

  it("rejects an item with both unitVariants and variantAttributes (mutually exclusive modes)", () => {
    // An item cannot simultaneously be an alt_units item AND a variants item.
    // The refine check ensures the caller doesn't accidentally set both.
    const result = createItemSchema.safeParse({
      ...simpleItem,
      itemMode: "variants",
      // Providing unitVariants on a variants-mode item must be rejected
      unitVariants: [{ unit: "box", conversionFactor: 12, salePrice: "600.00" }],
      variantAttributes: ["Color"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("unit variants");
  });

  it("accepts an alt_units item with unitVariants and no variantAttributes", () => {
    // Example: a rice item sold in both kg and 25-kg sacks.
    const result = createItemSchema.safeParse({
      ...simpleItem,
      itemMode: "alt_units",
      unitVariants: [{ unit: "sack", conversionFactor: 25, salePrice: "1250.00" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an alt_units item that also has variantAttributes", () => {
    // You cannot have unit variants AND product variants at the same time.
    const result = createItemSchema.safeParse({
      ...simpleItem,
      itemMode: "alt_units",
      unitVariants: [{ unit: "box", conversionFactor: 6, salePrice: "300.00" }],
      variantAttributes: ["Size"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a variants item with variantAttributes and no unitVariants", () => {
    // A T-shirt sold in multiple sizes/colors.
    const result = createItemSchema.safeParse({
      name: "Cotton T-Shirt",
      unit: "pcs" as const,
      itemMode: "variants",
      variantAttributes: ["Size", "Color"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a variants item that also has unitVariants", () => {
    const result = createItemSchema.safeParse({
      name: "T-Shirt",
      unit: "pcs" as const,
      itemMode: "variants",
      variantAttributes: ["Size"],
      unitVariants: [{ unit: "dozen", conversionFactor: 12, salePrice: "1200.00" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects variantAttributes array with more than 5 entries (schema max)", () => {
    // The UI renders a table for attributes; more than 5 would break the layout.
    const result = createItemSchema.safeParse({
      name: "Complex Item",
      unit: "pcs" as const,
      itemMode: "variants",
      variantAttributes: ["A", "B", "C", "D", "E", "F"], // 6 entries
    });
    expect(result.success).toBe(false);
  });

  it("rejects a taxPercent in non-standard decimal format (must match regex)", () => {
    // taxPercent must match /^\d+(\.\d{1,2})?$/
    const result = createItemSchema.safeParse({
      ...simpleItem,
      taxPercent: "18.125", // Three decimal places — invalid
    });
    expect(result.success).toBe(false);
  });

  it("defaults itemMode to 'simple' when not provided", () => {
    const result = createItemSchema.safeParse(simpleItem);
    if (result.success) {
      expect(result.data.itemMode).toBe("simple");
    }
  });

  it("defaults itemType to 'product' when not provided", () => {
    const result = createItemSchema.safeParse(simpleItem);
    if (result.success) {
      expect(result.data.itemType).toBe("product");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// invoiceLineItemSchema — individual line item on an invoice
// ─────────────────────────────────────────────────────────────────────────────
describe("invoiceLineItemSchema — validates a single invoice line item", () => {
  // Post Bug B: itemName is the required snapshot of the item name; the
  // description column on invoice_items is now an optional free-text
  // notes field.
  const validLine = {
    itemName: "Organic wheat flour 10kg",
    quantity: "10",
    unitPrice: "85.00",
    taxPercent: "5",
    discountPercent: "0",
  };

  it("accepts a valid line item with all required fields", () => {
    expect(invoiceLineItemSchema.safeParse(validLine).success).toBe(true);
  });

  it("rejects an empty itemName", () => {
    // Blank item names produce unreadable invoices — blocked at the
    // schema level. itemName is required min(1) post Bug B.
    const result = invoiceLineItemSchema.safeParse({ ...validLine, itemName: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("itemName");
  });

  it("rejects a missing itemName", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { itemName: _dropped, ...noName } = validLine as any;
    void _dropped;
    const result = invoiceLineItemSchema.safeParse(noName);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.includes("itemName"))).toBe(true);
  });

  it("accepts an optional description (free-text notes)", () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLine,
      description: "Keep separate from order #42",
    });
    expect(result.success).toBe(true);
  });

  it("accepts description set to null (clears existing notes)", () => {
    const result = invoiceLineItemSchema.safeParse({ ...validLine, description: null });
    expect(result.success).toBe(true);
  });

  it("rejects a description longer than 500 characters", () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLine,
      description: "A".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a quantity of 0 (quantity must be strictly greater than 0)", () => {
    // A zero-quantity line item is meaningless and indicates a bug in the form.
    const result = invoiceLineItemSchema.safeParse({ ...validLine, quantity: "0" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(i => i.path.includes("quantity"))).toBe(true);
  });

  it("rejects a negative quantity", () => {
    const result = invoiceLineItemSchema.safeParse({ ...validLine, quantity: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a taxPercent above 56% (GST maximum + cess can reach ~56%)", () => {
    // The absolute maximum tax rate in India (28% GST + 28% cess) is 56%.
    // Values above this indicate a data entry error.
    const result = invoiceLineItemSchema.safeParse({ ...validLine, taxPercent: "57" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(i => i.path.includes("taxPercent"))).toBe(true);
  });

  it("accepts taxPercent exactly equal to 56% (the maximum valid rate)", () => {
    // The boundary condition: exactly 56% must be allowed.
    const result = invoiceLineItemSchema.safeParse({ ...validLine, taxPercent: "56" });
    expect(result.success).toBe(true);
  });

  it("rejects a discountPercent above 100% (cannot discount more than the full price)", () => {
    const result = invoiceLineItemSchema.safeParse({ ...validLine, discountPercent: "101" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(i => i.path.includes("discountPercent"))).toBe(true);
  });

  it("accepts discountPercent exactly 100% (fully discounted/complimentary item)", () => {
    const result = invoiceLineItemSchema.safeParse({ ...validLine, discountPercent: "100" });
    expect(result.success).toBe(true);
  });

  it("rejects unitPrice in non-decimal format (must match /^\\d+(\\.\\d{1,2})?$/)", () => {
    // Three decimal places in price are not supported — INR uses paise (2dp max).
    const result = invoiceLineItemSchema.safeParse({ ...validLine, unitPrice: "85.123" });
    expect(result.success).toBe(false);
  });

  it("accepts an optional itemId as a valid UUID", () => {
    const result = invoiceLineItemSchema.safeParse({
      ...validLine,
      itemId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts omitted optional fields (itemId, variantId, selectedUnit, conversionFactor)", () => {
    // These are all optional — the bare minimum must parse cleanly.
    const result = invoiceLineItemSchema.safeParse(validLine);
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createInvoiceSchema — full invoice creation
// ─────────────────────────────────────────────────────────────────────────────
describe("createInvoiceSchema — validates invoice creation input", () => {
  // Post Bug B: itemName is the required snapshot; description is the
  // optional free-text notes column.
  const validLineItem = {
    itemName: "Laptop Dell Inspiron 15",
    quantity: "2",
    unitPrice: "55000.00",
    taxPercent: "18",
    discountPercent: "5",
  };

  const validInvoice = {
    partyId: "550e8400-e29b-41d4-a716-446655440000",
    type: "sale" as const,
    lineItems: [validLineItem],
  };

  it("accepts a valid sale invoice with required fields", () => {
    expect(createInvoiceSchema.safeParse(validInvoice).success).toBe(true);
  });

  it("accepts a purchase invoice type", () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, type: "purchase" });
    expect(result.success).toBe(true);
  });

  it("requires at least one line item", () => {
    // An invoice with no line items is invalid — there is nothing being billed.
    const result = createInvoiceSchema.safeParse({ ...validInvoice, lineItems: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(i => i.path.includes("lineItems"))).toBe(true);
  });

  it("rejects an invalid partyId (not a UUID)", () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, partyId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields as undefined (notes, termsAndConditions, dueDate)", () => {
    // These fields are commonly omitted for simple cash invoices.
    const result = createInvoiceSchema.safeParse(validInvoice);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBeUndefined();
      expect(result.data.dueDate).toBeUndefined();
    }
  });

  it("rejects notes longer than 2000 characters", () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      notes: "A".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("defaults documentType to 'invoice' when not provided", () => {
    const result = createInvoiceSchema.safeParse(validInvoice);
    if (result.success) {
      expect(result.data.documentType).toBe("invoice");
    }
  });

  it("accepts an additionalCharges amount in valid decimal format", () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      additionalCharges: "250.00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a roundOff with more than 2 decimal places", () => {
    // Round-off is stored as NUMERIC(15,2) — 3dp would cause a DB error.
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      roundOff: "0.125",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a negative roundOff (rounding down)", () => {
    const result = createInvoiceSchema.safeParse({
      ...validInvoice,
      roundOff: "-0.50",
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createPaymentSchema — payment recording
// ─────────────────────────────────────────────────────────────────────────────
describe("createPaymentSchema — validates payment recording input", () => {
  const validPayment = {
    partyId: "550e8400-e29b-41d4-a716-446655440000",
    amount: "5000.00",
    mode: "upi" as const,
  };

  it("accepts a minimal valid payment (partyId + amount + mode)", () => {
    expect(createPaymentSchema.safeParse(validPayment).success).toBe(true);
  });

  it("accepts all payment modes (cash, bank, upi, cheque, other)", () => {
    const modes = ["cash", "bank", "upi", "cheque", "other"] as const;
    for (const mode of modes) {
      expect(createPaymentSchema.safeParse({ ...validPayment, mode }).success).toBe(true);
    }
  });

  it("rejects an invalid payment mode", () => {
    const result = createPaymentSchema.safeParse({ ...validPayment, mode: "crypto" });
    expect(result.success).toBe(false);
  });

  it("rejects an amount with more than 2 decimal places", () => {
    const result = createPaymentSchema.safeParse({ ...validPayment, amount: "5000.005" });
    expect(result.success).toBe(false);
  });

  it("rejects a referenceNumber longer than 100 characters", () => {
    // UTR numbers and cheque numbers are always shorter than 100 chars.
    const result = createPaymentSchema.safeParse({
      ...validPayment,
      referenceNumber: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("accepts multi-invoice allocations", () => {
    const result = createPaymentSchema.safeParse({
      ...validPayment,
      allocations: [
        { invoiceId: "550e8400-e29b-41d4-a716-446655440001", amount: "3000.00" },
        { invoiceId: "550e8400-e29b-41d4-a716-446655440002", amount: "2000.00" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createExpenseSchema — business expense recording
// ─────────────────────────────────────────────────────────────────────────────
describe("createExpenseSchema — validates expense recording input", () => {
  const validExpense = {
    category: "Office Supplies",
    amount: "1500.00",
    mode: "cash" as const,
  };

  it("accepts a valid expense with required fields", () => {
    expect(createExpenseSchema.safeParse(validExpense).success).toBe(true);
  });

  it("rejects an empty category", () => {
    const result = createExpenseSchema.safeParse({ ...validExpense, category: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a description longer than 500 characters", () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      description: "A".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    // Expenses must be positive amounts — refunds are handled separately.
    const result = createExpenseSchema.safeParse({ ...validExpense, amount: "-100.00" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// paginationSchema — list pagination parameters
// ─────────────────────────────────────────────────────────────────────────────
describe("paginationSchema — validates pagination parameters for list queries", () => {
  it("accepts default values when fields are omitted", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects page 0 (pages are 1-indexed)", () => {
    const result = paginationSchema.safeParse({ page: 0, limit: 20 });
    expect(result.success).toBe(false);
  });

  it("rejects a limit above 100 (prevents abuse via large DB reads)", () => {
    const result = paginationSchema.safeParse({ page: 1, limit: 101 });
    expect(result.success).toBe(false);
  });

  it("accepts the maximum valid limit of 100", () => {
    const result = paginationSchema.safeParse({ page: 1, limit: 100 });
    expect(result.success).toBe(true);
  });
});
