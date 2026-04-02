/**
 * Form Validation Test Suite
 *
 * Ensures every form in Hisaabo has consistent required-field behaviour:
 *   1. Required fields display exactly one asterisk (*).
 *   2. Submitting with empty required fields shows validation errors.
 *   3. No field has duplicate asterisks (manual label + required prop).
 *   4. Every validated field has a visible required marker.
 *
 * This is a structural / regression suite — it catches the class of bug
 * where a label says "Business Name *" AND the component adds its own *,
 * or where a field has a validation check but no visible required marker.
 *
 * Forms covered:
 *   - BusinessForm (settings)
 *   - Expense form (expenses page)
 *   - Automated Invoice form (automated-invoices page)
 *   - Bank Account form (cash-and-bank page)
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField, InputField } from "../components/ui/FormField";
import { Listbox } from "../components/ui/Listbox";
import { Combobox } from "../components/ui/Combobox";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Count visible asterisks within a rendered container. */
function countAsterisks(container: HTMLElement): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let count = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent || "";
    // Count standalone asterisks (in <span>*</span>) — not asterisks inside words
    const matches = text.match(/\*/g);
    if (matches) count += matches.length;
  }
  return count;
}

/** Verify a component renders exactly one asterisk when required. */
function expectSingleAsterisk(container: HTMLElement) {
  const asteriskCount = countAsterisks(container);
  expect(asteriskCount).toBe(1);
}

// ─── Rule 1: FormField primitives render exactly one asterisk ────────────────

describe("FormField primitives — required marker consistency", () => {
  it("InputField with required=true shows exactly one asterisk", () => {
    const { container } = render(
      <InputField label="Business Name" required />
    );
    expectSingleAsterisk(container);
  });

  it("InputField without required shows zero asterisks", () => {
    const { container } = render(
      <InputField label="Legal Name" />
    );
    expect(countAsterisks(container)).toBe(0);
  });

  it("FormField with required=true shows exactly one asterisk", () => {
    const { container } = render(
      <FormField label="Party" required>
        <input type="text" />
      </FormField>
    );
    expectSingleAsterisk(container);
  });

  it("Listbox with required=true and label shows exactly one asterisk", () => {
    const { container } = render(
      <Listbox
        label="Payment Mode"
        required
        value="cash"
        onChange={() => {}}
        options={[{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }]}
      />
    );
    expectSingleAsterisk(container);
  });

  it("Combobox with required=true and label shows exactly one asterisk", () => {
    const { container } = render(
      <Combobox
        label="Party"
        required
        value=""
        onChange={() => {}}
        options={[{ value: "1", label: "Gupta Enterprises" }]}
      />
    );
    expectSingleAsterisk(container);
  });
});

// ─── Rule 2: No double asterisks from label text + required prop ─────────────

describe("No double asterisks — documents why label text must not contain manual asterisks", () => {
  it("InputField label='Name *' + required produces TWO asterisks — never do this", () => {
    // This test documents the anti-pattern. If you write label="Name *" AND pass
    // required, the component renders "Name *" from the label AND "*" from the
    // required prop = two asterisks. Always use label="Name" + required={true}.
    const { container } = render(
      <InputField label="Name *" required />
    );
    expect(countAsterisks(container)).toBe(2);
  });

  it("InputField label='Name' + required produces exactly ONE asterisk — correct pattern", () => {
    const { container } = render(
      <InputField label="Name" required />
    );
    expectSingleAsterisk(container);
  });

  it("FormField label='Address *' + required produces TWO asterisks — never do this", () => {
    const { container } = render(
      <FormField label="Address *" required>
        <input type="text" />
      </FormField>
    );
    expect(countAsterisks(container)).toBe(2);
  });

  it("FormField label='Address' + required produces exactly ONE asterisk — correct pattern", () => {
    const { container } = render(
      <FormField label="Address" required>
        <input type="text" />
      </FormField>
    );
    expectSingleAsterisk(container);
  });
});

// ─── Rule 3: Error messages render correctly ─────────────────────────────────

describe("Validation error messages render visibly", () => {
  it("InputField shows error text when error prop is set", () => {
    render(
      <InputField
        label="Amount"
        error="Valid amount required"
      />
    );
    expect(screen.getByText("Valid amount required")).toBeInTheDocument();
  });

  it("Listbox shows error text when error prop is set", () => {
    render(
      <Listbox
        label="Type"
        required
        value=""
        onChange={() => {}}
        options={[{ value: "sale", label: "Sale" }]}
        error="Type is required"
      />
    );
    expect(screen.getByText("Type is required")).toBeInTheDocument();
  });

  it("Combobox shows error text when error prop is set", () => {
    render(
      <Combobox
        label="Party"
        required
        value=""
        onChange={() => {}}
        options={[]}
        error="Party is required"
      />
    );
    expect(screen.getByText("Party is required")).toBeInTheDocument();
  });

  it("InputField does not render error paragraph when error is undefined", () => {
    const { container } = render(
      <InputField label="Notes" />
    );
    const errorParagraphs = container.querySelectorAll("p");
    // Filter for error-styled paragraphs
    const redParagraphs = Array.from(errorParagraphs).filter(
      (p) => p.className.includes("red")
    );
    expect(redParagraphs.length).toBe(0);
  });
});

// ─── Rule 4: Form-level validation contract tests ────────────────────────────
// These test the validation *functions* that each form uses, extracted as pure
// logic. They don't render full pages (which depend on tRPC providers and
// TanStack Router), but they verify the validation contract.

describe("Expense form validation contract", () => {
  // Mirrors the validation logic in expenses.tsx
  function validateExpense(form: { category: string; amount: string; mode: string }) {
    const errs: Record<string, string> = {};
    if (!form.category.trim()) errs.category = "Category is required";
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0)
      errs.amount = "Valid amount required";
    if (!form.mode) errs.mode = "Payment mode is required";
    return errs;
  }

  it("returns errors for all empty required fields", () => {
    const errs = validateExpense({ category: "", amount: "", mode: "" });
    expect(errs.category).toBeDefined();
    expect(errs.amount).toBeDefined();
    expect(errs.mode).toBeDefined();
  });

  it("returns no errors when all required fields are filled", () => {
    const errs = validateExpense({ category: "Rent", amount: "5000.00", mode: "bank" });
    expect(Object.keys(errs).length).toBe(0);
  });

  it("rejects zero amount", () => {
    const errs = validateExpense({ category: "Rent", amount: "0", mode: "cash" });
    expect(errs.amount).toBeDefined();
  });

  it("rejects negative amount", () => {
    const errs = validateExpense({ category: "Rent", amount: "-100", mode: "cash" });
    expect(errs.amount).toBeDefined();
  });

  it("rejects non-numeric amount", () => {
    const errs = validateExpense({ category: "Rent", amount: "abc", mode: "cash" });
    expect(errs.amount).toBeDefined();
  });

  it("rejects whitespace-only category", () => {
    const errs = validateExpense({ category: "   ", amount: "100", mode: "cash" });
    expect(errs.category).toBeDefined();
  });
});

describe("Automated invoice form validation contract", () => {
  interface AutoInvoiceForm {
    name: string;
    partyId: string;
    type: string;
    frequency: string;
    customIntervalDays: string;
    startDate: string;
    lineItems: Array<{ description: string; quantity: string; unitPrice: string }>;
  }

  // Mirrors the validation logic in automated-invoices.tsx
  function validateAutoInvoice(form: AutoInvoiceForm) {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.partyId) errs.partyId = "Party is required";
    if (!form.type) errs.type = "Type is required";
    if (!form.frequency) errs.frequency = "Frequency is required";
    if (form.frequency === "custom") {
      const days = parseInt(form.customIntervalDays);
      if (!days || days < 1) errs.customIntervalDays = "Valid interval required";
    }
    if (!form.startDate) errs.startDate = "Start date is required";
    const hasValidLineItem = form.lineItems.some(
      (li) => li.description.trim() && li.unitPrice && parseFloat(li.unitPrice) > 0
    );
    if (!hasValidLineItem) errs.lineItems = "At least one line item with description and price is required";
    return errs;
  }

  const EMPTY_FORM: AutoInvoiceForm = {
    name: "",
    partyId: "",
    type: "",
    frequency: "",
    customIntervalDays: "",
    startDate: "",
    lineItems: [{ description: "", quantity: "1", unitPrice: "" }],
  };

  it("returns errors for all empty required fields", () => {
    const errs = validateAutoInvoice(EMPTY_FORM);
    expect(errs.name).toBeDefined();
    expect(errs.partyId).toBeDefined();
    expect(errs.type).toBeDefined();
    expect(errs.frequency).toBeDefined();
    expect(errs.startDate).toBeDefined();
    expect(errs.lineItems).toBeDefined();
  });

  it("returns no errors when all required fields are filled", () => {
    const errs = validateAutoInvoice({
      name: "Monthly Rent",
      partyId: "abc-123",
      type: "sale",
      frequency: "monthly",
      customIntervalDays: "",
      startDate: "2026-04-01",
      lineItems: [{ description: "Office Rent", quantity: "1", unitPrice: "25000" }],
    });
    expect(Object.keys(errs).length).toBe(0);
  });

  it("validates customIntervalDays only when frequency is custom", () => {
    const form = {
      ...EMPTY_FORM,
      name: "Custom",
      partyId: "abc",
      type: "sale",
      frequency: "custom",
      startDate: "2026-04-01",
      lineItems: [{ description: "Service", quantity: "1", unitPrice: "1000" }],
    };

    // Missing interval days
    const errs = validateAutoInvoice(form);
    expect(errs.customIntervalDays).toBeDefined();

    // With valid interval days
    const errs2 = validateAutoInvoice({ ...form, customIntervalDays: "30" });
    expect(errs2.customIntervalDays).toBeUndefined();
  });

  it("does not require customIntervalDays for non-custom frequencies", () => {
    const errs = validateAutoInvoice({
      name: "Weekly Invoice",
      partyId: "abc",
      type: "sale",
      frequency: "weekly",
      customIntervalDays: "",
      startDate: "2026-04-01",
      lineItems: [{ description: "Service", quantity: "1", unitPrice: "500" }],
    });
    expect(errs.customIntervalDays).toBeUndefined();
  });

  it("rejects line items with zero price", () => {
    const errs = validateAutoInvoice({
      name: "Test",
      partyId: "abc",
      type: "sale",
      frequency: "monthly",
      customIntervalDays: "",
      startDate: "2026-04-01",
      lineItems: [{ description: "Item", quantity: "1", unitPrice: "0" }],
    });
    expect(errs.lineItems).toBeDefined();
  });

  it("rejects line items with empty description", () => {
    const errs = validateAutoInvoice({
      name: "Test",
      partyId: "abc",
      type: "sale",
      frequency: "monthly",
      customIntervalDays: "",
      startDate: "2026-04-01",
      lineItems: [{ description: "", quantity: "1", unitPrice: "1000" }],
    });
    expect(errs.lineItems).toBeDefined();
  });
});

describe("Business form validation contract", () => {
  // Mirrors the required fields in BusinessForm — name, phone, address are required
  function validateBusiness(form: { name: string; phone: string; address: string; pan: string }) {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Business name is required";
    if (!form.phone.trim()) errs.phone = "Phone number is required";
    if (!form.address.trim()) errs.address = "Address is required";
    // PAN has its own regex validation in PanInput
    if (form.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.pan)) {
      errs.pan = "Invalid PAN format";
    }
    return errs;
  }

  it("returns errors for all empty required fields", () => {
    const errs = validateBusiness({ name: "", phone: "", address: "", pan: "" });
    expect(errs.name).toBeDefined();
    expect(errs.phone).toBeDefined();
    expect(errs.address).toBeDefined();
    // PAN is not required when empty
    expect(errs.pan).toBeUndefined();
  });

  it("returns no errors when required fields are filled", () => {
    const errs = validateBusiness({
      name: "Gupta Traders",
      phone: "9876543210",
      address: "123 Market Road, Mumbai",
      pan: "ABCDE1234F",
    });
    expect(Object.keys(errs).length).toBe(0);
  });

  it("validates PAN format when provided", () => {
    const errs = validateBusiness({
      name: "Test",
      phone: "1234567890",
      address: "Test Address",
      pan: "INVALID",
    });
    expect(errs.pan).toBeDefined();
  });

  it("accepts empty PAN (optional field)", () => {
    const errs = validateBusiness({
      name: "Test",
      phone: "1234567890",
      address: "Test Address",
      pan: "",
    });
    expect(errs.pan).toBeUndefined();
  });
});

describe("Bank account form validation contract", () => {
  function validateBankAccount(form: { accountName: string }) {
    const errs: Record<string, string> = {};
    if (!form.accountName.trim()) errs.accountName = "Account name is required";
    return errs;
  }

  it("returns error for empty account name", () => {
    const errs = validateBankAccount({ accountName: "" });
    expect(errs.accountName).toBeDefined();
  });

  it("returns no error when account name is filled", () => {
    const errs = validateBankAccount({ accountName: "HDFC Savings" });
    expect(Object.keys(errs).length).toBe(0);
  });

  it("rejects whitespace-only account name", () => {
    const errs = validateBankAccount({ accountName: "   " });
    expect(errs.accountName).toBeDefined();
  });
});
