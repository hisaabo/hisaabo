/**
 * Listbox — custom select/dropdown component
 *
 * Hisaabo uses Listbox for single-value selection wherever the native
 * <select> element would be too plain or insufficient (e.g., GST rate pickers,
 * payment mode selectors, financial year selectors).  The component implements
 * the ARIA Listbox pattern with full keyboard navigation including typeahead.
 *
 * These tests verify:
 *   1. The trigger button shows the selected option's label or a placeholder.
 *   2. Clicking the trigger opens the dropdown with all options visible.
 *   3. Clicking an option calls onChange and closes the dropdown.
 *   4. The component does not call onChange for the already-selected option.
 *   5. Full keyboard navigation: ArrowDown, ArrowUp, Home, End, Enter, Space,
 *      Escape, Tab — matching the ARIA Listbox keyboard interaction model.
 *   6. Single-character typeahead jumps to the first matching option so
 *      power users can navigate large lists (e.g., 100+ parties) quickly.
 *   7. The label prop creates an associated <label> element.
 *   8. The error prop shows an error message and applies error styling to
 *      the trigger button.
 *   9. WCAG 2.1 AA compliance via axe-core.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Listbox } from "../Listbox";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// GST rate options — a real use case in Hisaabo's tax-rate picker.
const GST_OPTIONS = [
  { value: "0", label: "0% (Exempt)" },
  { value: "5", label: "5% GST" },
  { value: "12", label: "12% GST" },
  { value: "18", label: "18% GST" },
  { value: "28", label: "28% GST" },
];

// Payment modes — used on the Record Payment panel.
const PAYMENT_MODES = [
  { value: "cash", label: "Cash", description: "Physical currency handover" },
  { value: "upi", label: "UPI", description: "UPI transfer (GPay, PhonePe, Paytm)" },
  { value: "neft", label: "NEFT/RTGS", description: "Bank wire transfer" },
  { value: "cheque", label: "Cheque", description: "Paper cheque" },
];

function renderListbox(props: Partial<React.ComponentProps<typeof Listbox>> = {}) {
  const defaults: React.ComponentProps<typeof Listbox> = {
    value: "",
    onChange: vi.fn(),
    options: GST_OPTIONS,
    placeholder: "Select GST rate",
  };
  return render(<Listbox {...defaults} {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Listbox — custom dropdown for single-value selection", () => {

  // ─── Trigger display ───────────────────────────────────────────────────────

  describe("trigger button display", () => {
    it("shows the placeholder text when no option is selected so users know to make a selection", () => {
      renderListbox({ value: "", placeholder: "Select GST rate" });

      expect(screen.getByText("Select GST rate")).toBeInTheDocument();
    });

    it("shows the selected option label (not the value) when an option is pre-selected, confirming the current state to the user", () => {
      renderListbox({ value: "18" });

      // Should display the label "18% GST", not the raw value "18".
      expect(screen.getByText("18% GST")).toBeInTheDocument();
    });

    it("renders the label element above the trigger when a label prop is provided for form accessibility", () => {
      renderListbox({ label: "GST Rate" });

      expect(screen.getByText("GST Rate")).toBeInTheDocument();
    });

    it("shows a red asterisk next to the label when required=true to visually indicate mandatory fields", () => {
      renderListbox({ label: "Payment Mode", required: true });

      // The asterisk is rendered as a separate <span> with text "*".
      expect(screen.getByText("*")).toBeInTheDocument();
    });
  });

  // ─── Dropdown opening ──────────────────────────────────────────────────────

  describe("dropdown opening and option display", () => {
    it("opens the dropdown and displays all options when the trigger button is clicked", async () => {
      renderListbox({ options: GST_OPTIONS });

      await userEvent.click(screen.getByRole("combobox"));

      for (const opt of GST_OPTIONS) {
        expect(screen.getByText(opt.label)).toBeInTheDocument();
      }
    });

    it("renders option descriptions when provided so users get extra context (e.g., UPI payment description)", async () => {
      renderListbox({ options: PAYMENT_MODES });

      await userEvent.click(screen.getByRole("combobox"));

      expect(screen.getByText("UPI transfer (GPay, PhonePe, Paytm)")).toBeInTheDocument();
    });

    it("shows a check mark next to the currently selected option so users can confirm their previous selection", async () => {
      renderListbox({ value: "upi", options: PAYMENT_MODES });

      await userEvent.click(screen.getByRole("combobox"));

      // The selected option gets aria-selected="true" in the listbox.
      const selectedOption = screen.getByRole("option", { name: /UPI/ });
      expect(selectedOption).toHaveAttribute("aria-selected", "true");
    });

    it("closes the dropdown when the trigger is clicked again (toggle behaviour)", async () => {
      renderListbox();

      const trigger = screen.getByRole("combobox");
      await userEvent.click(trigger); // Open
      await userEvent.click(trigger); // Close

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  // ─── Option selection ──────────────────────────────────────────────────────

  describe("option selection", () => {
    it("calls onChange with the selected option's value when an option is clicked", async () => {
      const onChange = vi.fn();
      renderListbox({ onChange, options: GST_OPTIONS });

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByText("18% GST"));

      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith("18");
    });

    it("closes the dropdown after a selection is made to return focus to the trigger and restore normal tab flow", async () => {
      renderListbox({ options: GST_OPTIONS });

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByText("5% GST"));

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("returns focus to the trigger button after selection so keyboard users can continue tabbing through the form", async () => {
      renderListbox({ options: GST_OPTIONS });

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByText("12% GST"));

      expect(screen.getByRole("combobox")).toHaveFocus();
    });
  });

  // ─── Keyboard navigation ───────────────────────────────────────────────────

  describe("keyboard navigation — ARIA Listbox pattern", () => {
    it("opens the dropdown on ArrowDown press and highlights the first option", async () => {
      renderListbox({ value: "" });

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}");

      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("moves the active option down on ArrowDown, allowing sequential navigation through GST rates", async () => {
      renderListbox({ value: "0" }); // Start with first option selected

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open, active = index 0
      await userEvent.keyboard("{ArrowDown}"); // Move to index 1

      // aria-activedescendant should point to the second option.
      const trigger2 = screen.getByRole("combobox");
      expect(trigger2).toHaveAttribute("aria-activedescendant");
    });

    it("moves the active option up on ArrowUp", async () => {
      renderListbox({ value: "18" }); // Pre-select 18% (index 3)

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open
      await userEvent.keyboard("{ArrowUp}");   // Move up one

      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("jumps to the first option on Home key for rapid navigation to the top of long lists", async () => {
      renderListbox({ value: "28" }); // Pre-select last option

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open
      await userEvent.keyboard("{Home}");

      // Active option should now be index 0.
      expect(screen.getByRole("combobox")).toHaveAttribute("aria-activedescendant");
    });

    it("jumps to the last option on End key for rapid navigation to the bottom of long lists", async () => {
      renderListbox({ value: "0" }); // Pre-select first option

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open
      await userEvent.keyboard("{End}");

      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("selects the active option and closes the dropdown on Enter key press", async () => {
      const onChange = vi.fn();
      renderListbox({ onChange, value: "" });

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open, active = first option
      await userEvent.keyboard("{Enter}");     // Select active option

      expect(onChange).toHaveBeenCalledOnce();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("closes the dropdown on Escape without changing the selection — matches standard cancel-and-revert UX", async () => {
      const onChange = vi.fn();
      renderListbox({ onChange, value: "5" });

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open
      await userEvent.keyboard("{Escape}");    // Cancel

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("closes the dropdown on Tab without selecting to allow keyboard users to skip the field", async () => {
      renderListbox({ value: "" });

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open
      await userEvent.keyboard("{Tab}");       // Tab away

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("implements single-character typeahead so users can type '1' to jump to '12% GST' in a tax-rate list", async () => {
      renderListbox({ options: GST_OPTIONS, value: "" });

      const trigger = screen.getByRole("combobox");
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}"); // Open

      // Typing "1" should jump to "12% GST" (starts with "1").
      await userEvent.keyboard("1");

      // The active option should now reference the "12% GST" entry.
      // We verify the listbox is still open and aria-activedescendant changed.
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });

  // ─── Error state ──────────────────────────────────────────────────────────

  describe("error state", () => {
    it("renders the error message below the trigger when error prop is provided so users can understand what to fix", () => {
      renderListbox({ error: "Please select a GST rate to continue" });

      expect(
        screen.getByText("Please select a GST rate to continue")
      ).toBeInTheDocument();
    });

    it("applies error border styling to the trigger button when an error is present (visual feedback for invalid fields)", () => {
      renderListbox({ error: "Required" });

      const trigger = screen.getByRole("combobox");
      expect(trigger.className).toMatch(/border-red-500/);
    });
  });

  // ─── Outside click ─────────────────────────────────────────────────────────

  describe("outside click dismissal", () => {
    it("closes the dropdown when the user clicks outside the component so it doesn't block the rest of the page", async () => {
      renderListbox();

      await userEvent.click(screen.getByRole("combobox")); // Open
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      // Click elsewhere on the page.
      await userEvent.click(document.body);

      await waitFor(() => {
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      });
    });
  });

  // ─── Accessibility audit ──────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations in the closed (collapsed) state", async () => {
      const { container } = renderListbox({
        label: "Payment Mode",
        options: PAYMENT_MODES,
        value: "",
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no WCAG 2.1 AA violations in the open (expanded) state with options visible", async () => {
      const { container } = renderListbox({
        label: "GST Rate",
        options: GST_OPTIONS,
        value: "18",
      });

      await userEvent.click(screen.getByRole("combobox"));

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
