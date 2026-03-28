/**
 * FormField, InputField, SelectField, TextareaField — form primitives
 *
 * These are the atomic building blocks of all forms in Hisaabo.  Every
 * data-entry panel (party creation, item editing, expense recording, settings)
 * is composed of these primitives.  Getting their accessibility right ensures
 * every form in the app inherits correct label associations, error
 * announcements, and keyboard behaviour without needing per-form fixes.
 *
 * These tests verify:
 *   1. Label text is visible and correctly associated with its control.
 *   2. The red asterisk appears for required fields.
 *   3. Error messages are rendered when validation fails.
 *   4. Native HTML elements are used (input, select, textarea) so browsers
 *      provide built-in keyboard and AT support for free.
 *   5. WCAG 2.1 AA compliance via axe-core.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { FormField, InputField, SelectField, TextareaField } from "../FormField";

// ─── FormField (wrapper) ──────────────────────────────────────────────────────

describe("FormField — label wrapper used for custom controls (Listbox, Combobox, etc.)", () => {
  it("renders the label text so users understand what value the field expects", () => {
    render(
      <FormField label="GSTIN">
        <input id="gstin" type="text" />
      </FormField>
    );

    expect(screen.getByText("GSTIN")).toBeInTheDocument();
  });

  it("renders a red asterisk when required=true so users know the field must be filled before submitting", () => {
    render(
      <FormField label="Business name" required>
        <input type="text" />
      </FormField>
    );

    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders the error message below the field when error prop is provided so users know what to correct", () => {
    render(
      <FormField label="PAN Number" error="PAN number must be 10 characters">
        <input type="text" />
      </FormField>
    );

    expect(
      screen.getByText("PAN number must be 10 characters")
    ).toBeInTheDocument();
  });

  it("does not render an error paragraph when error is undefined, preventing empty DOM noise", () => {
    const { container } = render(
      <FormField label="Phone">
        <input type="tel" />
      </FormField>
    );

    // No error paragraph should exist.
    const errorParagraphs = container.querySelectorAll("p.text-red-500");
    expect(errorParagraphs.length).toBe(0);
  });

  it("renders children inside the wrapper so any custom control can be used", () => {
    render(
      <FormField label="Tax Rate">
        <button type="button">Select tax rate</button>
      </FormField>
    );

    expect(screen.getByRole("button", { name: "Select tax rate" })).toBeInTheDocument();
  });
});

// ─── InputField ───────────────────────────────────────────────────────────────

describe("InputField — labelled text/number/date input field", () => {
  it("renders a text input with an associated label so screen readers announce the field name when focused", () => {
    render(<InputField label="Party name" />);

    // The label must be present (InputField uses FormField which renders a <label>).
    expect(screen.getByText("Party name")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("passes additional HTML input attributes through so callers can set type, placeholder, defaultValue, etc.", () => {
    render(
      <InputField
        label="Invoice amount"
        type="number"
        placeholder="Enter amount in ₹"
        defaultValue={15000}
      />
    );

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("placeholder", "Enter amount in ₹");
    expect(input).toHaveValue(15000);
  });

  it("shows the error message below the input when validation fails", () => {
    render(
      <InputField
        label="Email"
        type="email"
        error="Please enter a valid email address"
      />
    );

    expect(
      screen.getByText("Please enter a valid email address")
    ).toBeInTheDocument();
  });

  it("has no WCAG 2.1 AA violations", async () => {
    const { container } = render(
      <InputField
        label="Business GSTIN"
        type="text"
        placeholder="22AAAAA0000A1Z5"
        required
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── SelectField ──────────────────────────────────────────────────────────────

describe("SelectField — labelled native <select> element", () => {
  it("renders a select element with the provided label so screen readers announce the field name", () => {
    render(
      <SelectField label="State" name="state">
        <option value="">Select state…</option>
        <option value="MH">Maharashtra</option>
        <option value="KA">Karnataka</option>
        <option value="TN">Tamil Nadu</option>
      </SelectField>
    );

    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders all provided option children inside the select", () => {
    render(
      <SelectField label="Financial year">
        <option value="2024-25">2024-25</option>
        <option value="2025-26">2025-26</option>
      </SelectField>
    );

    expect(screen.getByRole("option", { name: "2024-25" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2025-26" })).toBeInTheDocument();
  });

  it("has no WCAG 2.1 AA violations", async () => {
    const { container } = render(
      <SelectField label="GST treatment" required>
        <option value="">Select…</option>
        <option value="registered">Registered business</option>
        <option value="unregistered">Unregistered</option>
        <option value="consumer">Consumer</option>
      </SelectField>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── TextareaField ────────────────────────────────────────────────────────────

describe("TextareaField — labelled multi-line text area for notes and terms", () => {
  it("renders a textarea with an associated label so screen readers can announce it correctly", () => {
    render(<TextareaField label="Terms and Conditions" />);

    expect(screen.getByText("Terms and Conditions")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("passes rows, placeholder, and other textarea attributes through to the underlying element", () => {
    render(
      <TextareaField
        label="Payment notes"
        rows={4}
        placeholder="Any special payment instructions…"
      />
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("rows", "4");
    expect(textarea).toHaveAttribute(
      "placeholder",
      "Any special payment instructions…"
    );
  });

  it("has no WCAG 2.1 AA violations", async () => {
    const { container } = render(
      <TextareaField
        label="Notes"
        placeholder="Add any notes for this invoice…"
        rows={3}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
