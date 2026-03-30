/**
 * Combobox — searchable select with client-side and server-side filtering
 *
 * The Combobox is used wherever the option list is too large to scroll
 * through (hundreds of parties, items, bank accounts, etc.).  It supports
 * two modes:
 *   - Client-side filtering: the component filters `options` locally as the
 *     user types.
 *   - Server-side filtering: `onQueryChange` is provided and the parent
 *     handles fetching; the component shows all provided options without
 *     additional filtering.
 *
 * These tests verify:
 *   1. Initial display: placeholder or selected-option label.
 *   2. Typing filters options in client-side mode.
 *   3. In server-side mode, `onQueryChange` is called with each keystroke
 *      so the parent can debounce and fetch.
 *   4. Option selection via click and keyboard (Enter).
 *   5. Backspace clears the selection when the query is empty.
 *   6. The clear (×) button removes the selection.
 *   7. A loading spinner is shown while `isLoading` is true.
 *   8. An empty-state message appears when no options match.
 *   9. Escape closes the dropdown without selecting.
 *  10. WCAG 2.1 AA compliance via axe-core.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Combobox } from "../Combobox";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Party options matching real Hisaabo data model.
const PARTY_OPTIONS = [
  { value: "p1", label: "Ramesh Traders", description: "GSTIN: 27ABCDE1234F1Z5" },
  { value: "p2", label: "Suresh Industries", description: "GSTIN: 29FGHIJ5678K2Y6" },
  { value: "p3", label: "Anita Enterprises", description: "Unregistered" },
  { value: "p4", label: "Rajesh Electronics", description: "GSTIN: 33LMNOP9012Q3X7" },
];

function renderCombobox(
  props: Partial<React.ComponentProps<typeof Combobox>> = {}
) {
  const defaults: React.ComponentProps<typeof Combobox> = {
    value: "",
    onChange: vi.fn(),
    options: PARTY_OPTIONS,
    placeholder: "Search party…",
  };
  return render(<Combobox {...defaults} {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Combobox — searchable dropdown for large option lists (parties, items, accounts)", () => {

  // ─── Initial display ───────────────────────────────────────────────────────

  describe("initial display", () => {
    it("shows the placeholder text when no value is selected so users know the field is empty", () => {
      renderCombobox({ value: "", placeholder: "Search party…" });

      expect(screen.getByPlaceholderText("Search party…")).toBeInTheDocument();
    });

    it("shows the selected option label in the input when a value is pre-populated (e.g., editing an existing invoice)", () => {
      renderCombobox({ value: "p1" });

      // When an option is selected and the dropdown is closed, the input
      // displays the option label so the user can see what is selected.
      expect(screen.getByRole("combobox")).toHaveValue("Ramesh Traders");
    });

    it("renders the label element when the label prop is provided for form accessibility", () => {
      renderCombobox({ label: "Customer" });

      expect(screen.getByText("Customer")).toBeInTheDocument();
    });
  });

  // ─── Client-side filtering ────────────────────────────────────────────────

  describe("client-side option filtering (no onQueryChange provided)", () => {
    it("shows all options when the dropdown is opened with an empty query", async () => {
      renderCombobox();

      await userEvent.click(screen.getByRole("combobox"));

      for (const opt of PARTY_OPTIONS) {
        expect(screen.getByText(opt.label)).toBeInTheDocument();
      }
    });

    it("filters options as the user types, showing only entries whose label contains the query string", async () => {
      renderCombobox();

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      await userEvent.type(input, "ramesh");

      // Only "Ramesh Traders" should be visible; the others must be hidden.
      expect(screen.getByText("Ramesh Traders")).toBeInTheDocument();
      expect(screen.queryByText("Suresh Industries")).not.toBeInTheDocument();
      expect(screen.queryByText("Anita Enterprises")).not.toBeInTheDocument();
    });

    it("performs case-insensitive filtering so users can type 'anita' or 'ANITA' and find the same party", async () => {
      renderCombobox();

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      await userEvent.type(input, "ANITA");

      expect(screen.getByText("Anita Enterprises")).toBeInTheDocument();
    });

    it("also filters on the description field so users can search by GSTIN to find the right party", async () => {
      renderCombobox();

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      await userEvent.type(input, "27ABCDE");

      expect(screen.getByText("Ramesh Traders")).toBeInTheDocument();
      expect(screen.queryByText("Suresh Industries")).not.toBeInTheDocument();
    });

    it("shows the empty-state message when no options match the query so the user knows the search returned no results", async () => {
      renderCombobox({ emptyMessage: "No party found. Add a new party first." });

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      await userEvent.type(input, "zzznomatch");

      expect(
        screen.getByText("No party found. Add a new party first.")
      ).toBeInTheDocument();
    });
  });

  // ─── Server-side filtering ────────────────────────────────────────────────

  describe("server-side filtering (onQueryChange provided)", () => {
    it("calls onQueryChange with the typed query so the parent component can debounce and fetch matching parties from the API", async () => {
      const onQueryChange = vi.fn();
      renderCombobox({ onQueryChange });

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      await userEvent.type(input, "raj");

      // Each keystroke must trigger onQueryChange so the parent can manage
      // debouncing and API requests.
      expect(onQueryChange).toHaveBeenCalledWith("r");
      expect(onQueryChange).toHaveBeenCalledWith("ra");
      expect(onQueryChange).toHaveBeenCalledWith("raj");
    });

    it("renders all provided options without client-side filtering when onQueryChange is set (server decides what to return)", async () => {
      const onQueryChange = vi.fn();
      const serverOptions = [
        { value: "s1", label: "Rajesh Electronics" },
        { value: "s2", label: "Rajkumar Suppliers" },
      ];

      render(
        <Combobox
          value=""
          onChange={vi.fn()}
          options={serverOptions}
          onQueryChange={onQueryChange}
          placeholder="Search…"
        />
      );

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      // Even though we typed "raj", server returns both options — show them.
      await userEvent.type(input, "raj");

      expect(screen.getByText("Rajesh Electronics")).toBeInTheDocument();
      expect(screen.getByText("Rajkumar Suppliers")).toBeInTheDocument();
    });

    it("shows a loading spinner (and 'Searching…' text) when isLoading=true while the server is fetching results", async () => {
      renderCombobox({ isLoading: true, options: [] });

      const input = screen.getByRole("combobox");
      await userEvent.click(input);

      expect(screen.getByText("Searching...")).toBeInTheDocument();
    });
  });

  // ─── Option selection ─────────────────────────────────────────────────────

  describe("option selection", () => {
    it("calls onChange with the option's value when an option is clicked from the dropdown list", async () => {
      const onChange = vi.fn();
      renderCombobox({ onChange });

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByText("Suresh Industries"));

      expect(onChange).toHaveBeenCalledWith("p2");
    });

    it("closes the dropdown and shows the selected option label in the input after click-selection", async () => {
      const { rerender } = renderCombobox({ value: "" });

      await userEvent.click(screen.getByRole("combobox"));
      await userEvent.click(screen.getByText("Anita Enterprises"));

      // Simulate parent updating the value after onChange fires.
      rerender(
        <Combobox
          value="p3"
          onChange={vi.fn()}
          options={PARTY_OPTIONS}
          placeholder="Search party…"
        />
      );

      expect(screen.getByRole("combobox")).toHaveValue("Anita Enterprises");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("selects the highlighted option on Enter key press — standard keyboard combobox activation", async () => {
      const onChange = vi.fn();
      renderCombobox({ onChange });

      const input = screen.getByRole("combobox");
      await userEvent.click(input);
      // First option is active by default; press Enter to select it.
      await userEvent.keyboard("{Enter}");

      expect(onChange).toHaveBeenCalledOnce();
    });

    it("marks the currently selected option with aria-selected='true' so screen readers can confirm the selection", async () => {
      renderCombobox({ value: "p2" });

      await userEvent.click(screen.getByRole("combobox"));

      const selectedOpt = screen.getByRole("option", { name: /Suresh Industries/ });
      expect(selectedOpt).toHaveAttribute("aria-selected", "true");
    });
  });

  // ─── Clearing selection ───────────────────────────────────────────────────

  describe("clearing the selection", () => {
    it("shows the × clear button only when an option is selected, not on an empty combobox", () => {
      renderCombobox({ value: "p1" });

      expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();
    });

    it("hides the × clear button when no option is selected", () => {
      renderCombobox({ value: "" });

      expect(
        screen.queryByRole("button", { name: "Clear selection" })
      ).not.toBeInTheDocument();
    });

    it("calls onChange('') when the × clear button is clicked so the parent can reset the field", async () => {
      const onChange = vi.fn();
      renderCombobox({ onChange, value: "p1" });

      await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));

      expect(onChange).toHaveBeenCalledWith("");
    });

    it("clears the selection via Backspace when the query input is empty, allowing keyboard-only users to deselect", async () => {
      const onChange = vi.fn();
      renderCombobox({ onChange, value: "p3" });

      const input = screen.getByRole("combobox");
      input.focus();
      await userEvent.keyboard("{Backspace}");

      expect(onChange).toHaveBeenCalledWith("");
    });
  });

  // ─── Escape key ──────────────────────────────────────────────────────────

  describe("Escape key dismissal", () => {
    it("closes the dropdown on Escape without firing onChange, matching standard cancel-without-commit UX", async () => {
      const onChange = vi.fn();
      renderCombobox({ onChange });

      await userEvent.click(screen.getByRole("combobox"));
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ─── Error state ──────────────────────────────────────────────────────────

  describe("error state", () => {
    it("renders the error message below the input when the error prop is set", () => {
      renderCombobox({ error: "Please select a party before creating the invoice" });

      expect(
        screen.getByText("Please select a party before creating the invoice")
      ).toBeInTheDocument();
    });

    it("applies red border styling to the input when an error is present (clear visual feedback for validation failures)", () => {
      renderCombobox({ error: "Required" });

      const input = screen.getByRole("combobox");
      expect(input.className).toMatch(/border-red-500/);
    });
  });

  // ─── Accessibility audit ──────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations in the closed state with a label", async () => {
      const { container } = renderCombobox({
        label: "Customer",
        value: "",
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no WCAG 2.1 AA violations in the open state with options visible", async () => {
      const { container } = renderCombobox({
        label: "Customer",
        value: "p1",
      });

      await userEvent.click(screen.getByRole("combobox"));

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("input has role='combobox' and all required ARIA attributes for assistive technologies", () => {
      renderCombobox({ label: "Supplier" });

      const input = screen.getByRole("combobox");
      expect(input).toHaveAttribute("aria-haspopup", "listbox");
      expect(input).toHaveAttribute("aria-expanded");
      expect(input).toHaveAttribute("aria-autocomplete", "list");
    });
  });
});
