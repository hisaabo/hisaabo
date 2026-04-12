/**
 * Tests for `src/components/LineItemNotesField.tsx`
 *
 * WHY these tests matter for contributors:
 * LineItemNotesField is the mobile-side UI for Bug B. It splits the item
 * name (required, frozen snapshot) from free-text per-line notes (optional)
 * on every document type — invoices, quotations, credit notes, challans,
 * proformas, sales returns, automated templates, and the main invoice edit
 * screen. The component is the one piece of "+ Add notes" UX every create
 * and edit flow shares, so a regression here silently breaks Bug B across
 * every single document creation path.
 *
 * The collapsible-link UX was chosen over an always-visible inline input
 * because 99% of invoice lines will never have notes. If the component
 * accidentally shows the expanded editor by default, every line item gains
 * ~68pt of vertical real estate and mobile screens lose 2-3 visible lines
 * of data. Conversely, if the collapse-on-Done path breaks, the user cannot
 * dismiss the editor once opened — trapping them in a modal-esque state on
 * a scroll-heavy screen.
 *
 * Coverage checklist:
 *   - Default collapsed state renders "+ Add notes"
 *   - Tapping "+ Add notes" opens the inline TextInput
 *   - Typing in the TextInput propagates via onChange
 *   - Tapping "Done" collapses and calls onCommit with the trimmed value
 *   - A non-empty value renders the italic notes display with a pencil icon
 *   - Tapping the displayed notes re-opens edit mode
 *   - Whitespace-only values are treated as empty by onCommit (trimmed)
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { LineItemNotesField } from "../LineItemNotesField";

describe("LineItemNotesField — collapsible per-line notes editor", () => {
  // -------------------------------------------------------------------------
  it("renders the '+ Add notes' link by default when value is empty", () => {
    // WHAT: An empty value must collapse to the muted "+ Add notes" link —
    //       NOT the expanded textarea.
    // WHY: If the default shows the expanded editor, every new line item
    //      eats ~68pt of vertical space — on a 6" screen with 6 line items
    //      the user loses almost an entire screen of form data.
    render(<LineItemNotesField value="" onChange={() => {}} />);

    expect(screen.getByTestId("line-item-notes-add")).toBeTruthy();
    expect(screen.queryByTestId("line-item-notes-input")).toBeNull();
    expect(screen.queryByTestId("line-item-notes-display")).toBeNull();
  });

  // -------------------------------------------------------------------------
  it("opens the inline TextInput when the user taps '+ Add notes'", () => {
    // WHAT: Tapping the add-notes link must toggle the component into edit
    //       mode with a focused TextInput.
    // WHY: This is the entry point for every single notes interaction.
    //      If it breaks, the Bug B feature is effectively dead — the user
    //      can see the link but can never actually enter notes.
    render(<LineItemNotesField value="" onChange={() => {}} />);

    fireEvent.press(screen.getByTestId("line-item-notes-add"));

    expect(screen.getByTestId("line-item-notes-input")).toBeTruthy();
    expect(screen.getByTestId("line-item-notes-done")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("propagates text changes via onChange while typing", () => {
    // WHAT: The TextInput must forward every character to the parent's
    //       onChange handler so React state stays in sync.
    // WHY: If onChange is dropped, submission sends an empty description
    //      despite the user typing something — the notes silently disappear
    //      when the invoice is saved.
    const onChange = jest.fn();
    render(<LineItemNotesField value="" onChange={onChange} />);

    fireEvent.press(screen.getByTestId("line-item-notes-add"));
    fireEvent.changeText(
      screen.getByTestId("line-item-notes-input"),
      "Keep separate from order #42"
    );

    expect(onChange).toHaveBeenCalledWith("Keep separate from order #42");
  });

  // -------------------------------------------------------------------------
  it("collapses to the display state when 'Done' is tapped with a value", () => {
    // WHAT: After the user taps Done, the editor must collapse and the
    //       notes text must be rendered as an italic secondary line.
    // WHY: If collapse fails, the expanded editor stays visible forever —
    //      the Done button effectively does nothing and the user thinks
    //      notes are lost. Worse, the expanded state takes ~100pt of
    //      vertical space so the user scrolls past other line items looking
    //      for a way out.
    const onChange = jest.fn();
    const onCommit = jest.fn();

    // Parent holds value state — re-render with updated value after onChange.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentValue: any = "";
    const handleChange = (next: string) => {
      currentValue = next;
      onChange(next);
    };

    const { rerender } = render(
      <LineItemNotesField value={currentValue} onChange={handleChange} onCommit={onCommit} />
    );

    fireEvent.press(screen.getByTestId("line-item-notes-add"));
    fireEvent.changeText(
      screen.getByTestId("line-item-notes-input"),
      "Keep separate"
    );

    rerender(
      <LineItemNotesField value={currentValue} onChange={handleChange} onCommit={onCommit} />
    );

    fireEvent.press(screen.getByTestId("line-item-notes-done"));

    expect(onCommit).toHaveBeenCalledWith("Keep separate");
    // After Done, the display state should be visible (since value is non-empty)
    expect(screen.getByTestId("line-item-notes-display")).toBeTruthy();
    expect(screen.queryByTestId("line-item-notes-input")).toBeNull();
  });

  // -------------------------------------------------------------------------
  it("renders the notes-display state (italic muted, with edit affordance) when a value is set", () => {
    // WHAT: An already-present value must render via the display
    //       TouchableOpacity — NOT the add link or the editor.
    // WHY: A line with notes shouldn't show "+ Add notes" (that suggests no
    //      notes exist); nor should it auto-expand the editor (the user is
    //      only viewing). The italic display is the "has notes" indicator.
    render(<LineItemNotesField value="Contains fragile items" onChange={() => {}} />);

    expect(screen.getByTestId("line-item-notes-display")).toBeTruthy();
    expect(screen.getByText("Contains fragile items")).toBeTruthy();
    expect(screen.queryByTestId("line-item-notes-add")).toBeNull();
    expect(screen.queryByTestId("line-item-notes-input")).toBeNull();
  });

  // -------------------------------------------------------------------------
  it("re-opens edit mode when the user taps the displayed notes text", () => {
    // WHAT: Tapping the italic notes display must toggle back into edit
    //       mode — the same way tapping a rendered text value in a form
    //       field edits that value.
    // WHY: Without this, there is no way to change a committed note without
    //      deleting and re-entering it. The user experience would feel
    //      frozen — "I typed a note, now why can't I edit it?"
    render(<LineItemNotesField value="Old note" onChange={() => {}} />);

    fireEvent.press(screen.getByTestId("line-item-notes-display"));

    expect(screen.getByTestId("line-item-notes-input")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("treats a whitespace-only value as empty when committing (trims for the wire format)", () => {
    // WHAT: If the user types only spaces and taps Done, the committed
    //       value must be an empty string — matching the wire format
    //       convention that empty notes are omitted from the payload.
    // WHY: The submission mapper converts `notes.trim() || undefined` to
    //      decide whether to send a `description` field. If whitespace isn't
    //      trimmed here, the display state would render an empty italic row
    //      (a thin ghostly line that looks like a rendering bug) even
    //      though the submit payload correctly omits the field.
    const onChange = jest.fn();
    const onCommit = jest.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentValue: any = "";
    const handleChange = (next: string) => {
      currentValue = next;
      onChange(next);
    };

    const { rerender } = render(
      <LineItemNotesField value={currentValue} onChange={handleChange} onCommit={onCommit} />
    );

    fireEvent.press(screen.getByTestId("line-item-notes-add"));
    fireEvent.changeText(screen.getByTestId("line-item-notes-input"), "   ");

    rerender(
      <LineItemNotesField value={currentValue} onChange={handleChange} onCommit={onCommit} />
    );

    fireEvent.press(screen.getByTestId("line-item-notes-done"));

    // onCommit receives the trimmed empty string
    expect(onCommit).toHaveBeenCalledWith("");
    // onChange was also called with the trimmed value so the parent state
    // matches what the wire format sees
    expect(onChange).toHaveBeenCalledWith("");
  });

  // -------------------------------------------------------------------------
  it("shows a character counter inside the editor with the 500-char soft limit", () => {
    // WHAT: The char counter ("0 / 500") must render when the editor is
    //       open so the user has feedback before they hit the hard limit.
    // WHY: The validator max is 500 chars (see
    //      `packages/shared/src/validators.ts::invoiceLineItemSchema`).
    //      Without visible feedback, users can paste a long block, never
    //      see the limit, and hit a generic validation error on submit —
    //      wasting their time and looking unprofessional for a billing app.
    render(<LineItemNotesField value="hello" onChange={() => {}} />);

    // Enter edit mode
    fireEvent.press(screen.getByTestId("line-item-notes-display"));

    expect(screen.getByText("5 / 500")).toBeTruthy();
  });
});
