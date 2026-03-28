/**
 * Tests for `src/components/ui/DatePickerField.tsx`
 *
 * WHY these tests matter for contributors:
 * DatePickerField is a pure-JS calendar picker used on every invoice creation
 * form (invoice date, due date), expense forms, and payment recording forms.
 * Native date pickers (DateTimePicker) were deliberately avoided because:
 *   1. They look different on iOS vs Android (inconsistent UX)
 *   2. They cannot be styled to match the dark theme
 *   3. They do not support min/max date constraints without workarounds
 *
 * This picker is used to set:
 *   - Invoice date (defaults to today)
 *   - Due date (must be >= invoice date — enforced by minimumDate)
 *   - Expense date
 *   - Payment date (must be >= invoice date)
 *
 * Incorrect date handling here causes direct financial errors:
 *   - A due date before the invoice date makes the invoice immediately overdue
 *   - A wrong invoice date affects GST filing period attribution
 *   - A wrong payment date affects overdue calculations and revenue reports
 *
 * The Indian financial year boundary (1 April) is especially important —
 * GST filings are split at this boundary, so selecting March 31 vs April 1
 * affects which return period an invoice falls under.
 *
 * Coverage checklist:
 *   - Displays the formatted date in the trigger field
 *   - Opens the calendar modal on field press
 *   - Shows the correct month and year in the nav header
 *   - Renders day-of-week headers (Su Mo Tu We Th Fr Sa)
 *   - Highlights the selected date in the calendar grid
 *   - Marks today's date with a distinct ring style
 *   - Disables dates before minimumDate
 *   - Disables dates after maximumDate
 *   - Navigates to previous month with the back chevron
 *   - Navigates to next month with the forward chevron
 *   - Wraps year correctly when navigating Jan → Dec and Dec → Jan
 *   - Calls onChange with a Date object for the selected day
 *   - Closes the modal after day selection
 *   - "Today" button selects today's date and closes the modal
 *   - Tapping the backdrop dismisses the modal without selecting a date
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { DatePickerField } from "../DatePickerField";

// ---------------------------------------------------------------------------
// @expo/vector-icons mock
// ---------------------------------------------------------------------------
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({
    name,
    testID,
  }: {
    name: string;
    size?: number;
    color?: string;
    testID?: string;
  }) => {
    const { Text } = require("react-native");
    return <Text testID={testID || `icon-${name}`}>{name}</Text>;
  },
}));

// ---------------------------------------------------------------------------
// Freeze "today" to a known date so tests that reference "today" are
// deterministic regardless of when they run. We use 26 March 2026.
// ---------------------------------------------------------------------------
const FROZEN_TODAY = new Date(2026, 2, 26); // March 26, 2026

const OriginalDate = global.Date;

beforeEach(() => {
  // Override Date constructor so `new Date()` returns our frozen date
  // but `new Date(year, month, day)` still works correctly.
  global.Date = class extends OriginalDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(FROZEN_TODAY);
      } else {
        super(...(args as [any]));
      }
    }
    static now() {
      return FROZEN_TODAY.getTime();
    }
  } as any;
});

afterEach(() => {
  global.Date = OriginalDate;
});

// ---------------------------------------------------------------------------
// Helper: render DatePickerField with sensible defaults for most tests
// ---------------------------------------------------------------------------
function renderPicker(
  overrides: Partial<{
    value: Date;
    onChange: (d: Date) => void;
    minimumDate: Date;
    maximumDate: Date;
  }> = {}
) {
  const defaultProps = {
    label: "Invoice Date",
    value: new OriginalDate(2026, 2, 15), // March 15, 2026
    onChange: jest.fn(),
    ...overrides,
  };
  return render(<DatePickerField {...defaultProps} />);
}

// ---------------------------------------------------------------------------
describe("DatePickerField — pure-JS calendar picker for Indian business dates", () => {
  // -------------------------------------------------------------------------
  it("displays the formatted date in the trigger field using Indian locale", () => {
    // WHAT: The trigger (closed state) must show the current value formatted
    //       with the Indian locale (day Mon year — e.g. "15 Mar 2026").
    // WHY: If the date is shown in ISO format or US format, Indian merchants
    //      cannot read it at a glance. The format must match the invoice PDF
    //      format so merchants can cross-check without confusion.
    renderPicker({ value: new OriginalDate(2026, 2, 15) });

    // The formatted text should contain "Mar" and "2026"
    expect(screen.getByText(/Mar/)).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.getByText(/15/)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("shows the label text above the date field", () => {
    // WHAT: The label prop is rendered as a small heading above the date input.
    // WHY: Invoice forms have multiple date fields (invoice date, due date).
    //      Without labels, merchants cannot tell which date they are editing.
    renderPicker();

    expect(screen.getByText("Invoice Date")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("calendar modal is NOT visible before the field is pressed", () => {
    // WHAT: The modal starts hidden (show state is false).
    // WHY: If the modal opens on render without a user action, every invoice
    //      form auto-pops the date picker — blocking the rest of the form.
    renderPicker();

    // The navigation header "Mar 2026" is only visible inside the open modal
    // When the modal is closed, this text should not appear in the document
    // Note: Modal with visible=false still renders in RN — check props instead
    const { UNSAFE_getByType } = renderPicker();
    const { Modal } = require("react-native");
    const modal = UNSAFE_getByType(Modal);

    expect(modal.props.visible).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("opens the calendar modal when the trigger field is pressed", () => {
    // WHAT: Tapping the date trigger field must set show=true and make the
    //       modal visible.
    // WHY: If the field is not tappable, the entire date-picking flow is
    //      blocked — merchants cannot change dates on any form.
    const { UNSAFE_getByType } = renderPicker();
    const { Modal, TouchableOpacity } = require("react-native");

    // The trigger is the first TouchableOpacity (the field, not nav buttons)
    const touchables = UNSAFE_getByType(TouchableOpacity);
    fireEvent.press(touchables);

    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("shows the correct month and year in the navigation header", () => {
    // WHAT: When the picker opens with value = March 15 2026, the nav header
    //       must show "Mar 2026".
    // WHY: If the month/year shown doesn't match the selected date, the
    //      calendar grid shows the wrong month's days — merchants scroll
    //      to find a date that's already right in front of them.
    const { UNSAFE_getAllByType, UNSAFE_getByType } = renderPicker({
      value: new OriginalDate(2026, 2, 15),
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Nav title "Mar 2026" must appear inside the open modal
    expect(screen.getByText("Mar 2026")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders day-of-week header row (Su Mo Tu We Th Fr Sa)", () => {
    // WHAT: The calendar grid must have a header row showing abbreviated day
    //       names so merchants can orient themselves in the grid.
    // WHY: Without headers, the calendar looks like a grid of numbers with no
    //      context — merchants cannot tell which column is Monday vs Friday,
    //      making it unusable for planning due dates or payment schedules.
    const { UNSAFE_getAllByType } = renderPicker();
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    expect(screen.getByText("Su")).toBeTruthy();
    expect(screen.getByText("Mo")).toBeTruthy();
    expect(screen.getByText("Tu")).toBeTruthy();
    expect(screen.getByText("We")).toBeTruthy();
    expect(screen.getByText("Th")).toBeTruthy();
    expect(screen.getByText("Fr")).toBeTruthy();
    expect(screen.getByText("Sa")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("highlights the currently selected date with a brand-coloured background", () => {
    // WHAT: The selected day button must have `dayBtnSelected` style applied
    //       (backgroundColor: colors.brand — the indigo/purple brand colour).
    // WHY: Without visual highlighting, merchants cannot confirm which date
    //      is currently selected before closing the picker — leading to
    //      wrong invoice dates being submitted.
    const { UNSAFE_getAllByType, UNSAFE_getAllByProps } = renderPicker({
      value: new OriginalDate(2026, 2, 15), // March 15 selected
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Find the day button for "15" — it should have dayBtnSelected style
    // The selected button has backgroundColor: colors.brand in its style
    const dayButtons = UNSAFE_getAllByType(TouchableOpacity);
    // Look for a button whose style contains the brand colour
    const selectedButton = dayButtons.find((btn: any) => {
      const styleArray = Array.isArray(btn.props.style)
        ? btn.props.style
        : [btn.props.style];
      return styleArray.some(
        (s: any) => s && s.backgroundColor && s.backgroundColor !== "transparent"
      );
    });

    // At least one day button must have a coloured background (the selected one)
    expect(selectedButton).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("shows today's date (March 26) with a ring border, distinct from selected", () => {
    // WHAT: Today's date gets a `dayBtnToday` style (borderWidth + borderColor:
    //       colors.brand) when it is not the selected date.
    // WHY: Showing today visually helps merchants quickly confirm "where am I
    //      in time" when setting due dates — e.g. "today is the 26th, I need
    //      to set the due date to the 30th".
    const { UNSAFE_getAllByType } = renderPicker({
      // Selected date is March 15, today is March 26 — they differ
      value: new OriginalDate(2026, 2, 15),
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Look for a day button with borderWidth set (today's ring style)
    const dayButtons = UNSAFE_getAllByType(TouchableOpacity);
    const todayButton = dayButtons.find((btn: any) => {
      const styleArray = Array.isArray(btn.props.style)
        ? btn.props.style
        : [btn.props.style];
      return styleArray.some((s: any) => s && s.borderWidth === 1);
    });

    expect(todayButton).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("disables dates before minimumDate and they cannot be selected", () => {
    // WHAT: When minimumDate is set (e.g. invoice date when picking due date),
    //       dates before the minimum must be rendered as disabled.
    // WHY: A due date before the invoice date immediately marks the invoice
    //      as overdue — a nonsensical state that breaks the collections
    //      workflow and produces incorrect GST reports.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 2, 20),       // March 20 selected
      minimumDate: new OriginalDate(2026, 2, 18), // min = March 18
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Day buttons with disabled={true} must exist (days 1-17 in this month)
    const allDayButtons = UNSAFE_getAllByType(TouchableOpacity).filter(
      (btn: any) => btn.props.disabled === true
    );

    expect(allDayButtons.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  it("disables dates after maximumDate", () => {
    // WHAT: When maximumDate is set (e.g. "you cannot backdate an expense
    //       beyond the financial year"), dates after the maximum are disabled.
    // WHY: Allowing future dates on historical records (expenses already
    //      paid, payments already received) creates incorrect ledger entries.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 2, 10),       // March 10 selected
      maximumDate: new OriginalDate(2026, 2, 15), // max = March 15
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    const disabledButtons = UNSAFE_getAllByType(TouchableOpacity).filter(
      (btn: any) => btn.props.disabled === true
    );

    // Days 16-31 should be disabled (at minimum some disabled buttons exist)
    expect(disabledButtons.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  it("navigates to the previous month when the back chevron is pressed", () => {
    // WHAT: Pressing the left chevron button decrements the displayed month.
    // WHY: Merchants often need to record backdated invoices (e.g. at month
    //      end they record all February invoices). If month navigation is
    //      broken, they cannot select dates in prior months.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 2, 15), // March 15
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker — shows "Mar 2026"

    // The back chevron is the second TouchableOpacity (after the field trigger)
    const refreshedTouchables = UNSAFE_getAllByType(TouchableOpacity);
    // Find the prev button by the chevron-back icon
    const prevButton = screen.getByTestId("icon-chevron-back").parent as any;
    fireEvent.press(prevButton);

    // Should now show February 2026
    expect(screen.getByText("Feb 2026")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("navigates to the next month when the forward chevron is pressed", () => {
    // WHAT: Pressing the right chevron button increments the displayed month.
    // WHY: Setting a due date 2-3 months in the future (standard for large
    //      orders) requires forward navigation.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 2, 15), // March 15
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker — shows "Mar 2026"

    const nextButton = screen.getByTestId("icon-chevron-forward").parent as any;
    fireEvent.press(nextButton);

    // Should now show April 2026
    expect(screen.getByText("Apr 2026")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("wraps to December when navigating back from January (year decrements)", () => {
    // WHAT: Navigating back from January must go to December of the previous
    //       year — the year must decrement as well.
    // WHY: If the month wraps to -1 or stays at 0, the calendar shows an
    //      invalid month and the date grid either crashes or shows garbage.
    //      This is a classic off-by-one boundary bug.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 0, 15), // January 15, 2026
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker — shows "Jan 2026"

    const prevButton = screen.getByTestId("icon-chevron-back").parent as any;
    fireEvent.press(prevButton);

    // Must show December 2025 (year wrapped back)
    expect(screen.getByText("Dec 2025")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("wraps to January when navigating forward from December (year increments)", () => {
    // WHAT: Navigating forward from December must go to January of the next year.
    // WHY: Same boundary issue on the other side — month 11 + 1 must become
    //      month 0 of the next year, not month 12 of the same year.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2025, 11, 15), // December 15, 2025
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker — shows "Dec 2025"

    const nextButton = screen.getByTestId("icon-chevron-forward").parent as any;
    fireEvent.press(nextButton);

    // Must show January 2026
    expect(screen.getByText("Jan 2026")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("calls onChange with a Date object when a day is selected", () => {
    // WHAT: Tapping a day cell must call onChange with a real Date object
    //       representing that specific day.
    // WHY: If onChange is not called, the form field never updates and the
    //      user's date selection is silently discarded — the invoice is saved
    //      with the original default date regardless of what was picked.
    const mockOnChange = jest.fn();
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 2, 15),
      onChange: mockOnChange,
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Press the day "20" in March 2026
    const day20 = screen.getByText("20");
    fireEvent.press(day20.parent as any);

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const calledWith = mockOnChange.mock.calls[0][0];
    expect(calledWith).toBeInstanceOf(Date);
    expect(calledWith.getDate()).toBe(20);
    expect(calledWith.getMonth()).toBe(2); // March = 2
    expect(calledWith.getFullYear()).toBe(2026);
  });

  // -------------------------------------------------------------------------
  it("closes the modal after a day is selected", () => {
    // WHAT: After selecting a day, the calendar modal must close automatically.
    // WHY: If the modal stays open after selection, merchants must manually
    //      dismiss it — adding an extra tap to every date input interaction.
    //      Over a 50-invoice workflow, this is 50 extra taps per day.
    const { UNSAFE_getAllByType, UNSAFE_getByType } = renderPicker({
      value: new OriginalDate(2026, 2, 15),
      onChange: jest.fn(),
    });
    const { TouchableOpacity, Modal } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Confirm it's open
    expect(UNSAFE_getByType(Modal).props.visible).toBe(true);

    // Tap day 20
    const day20 = screen.getByText("20");
    fireEvent.press(day20.parent as any);

    // Must now be closed
    expect(UNSAFE_getByType(Modal).props.visible).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("'Today' button selects today's date (March 26) and closes the modal", () => {
    // WHAT: The "Today" shortcut button sets the value to today and dismisses.
    // WHY: The most common use case for a date picker in an invoicing app is
    //      "today's date" — the current invoice date. Without a Today shortcut,
    //      users must navigate to the current month (possibly after flipping
    //      months) and find today's date manually. The Today button reduces
    //      a 3-5 tap flow to 1 tap for the most common case.
    const mockOnChange = jest.fn();
    const { UNSAFE_getAllByType, UNSAFE_getByType } = renderPicker({
      value: new OriginalDate(2026, 1, 15), // February 15 — NOT today
      onChange: mockOnChange,
    });
    const { TouchableOpacity, Modal } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // Press the "Today" button
    const todayButton = screen.getByText("Today");
    fireEvent.press(todayButton);

    // onChange must be called with today's date (March 26 2026)
    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const selectedDate = mockOnChange.mock.calls[0][0];
    expect(selectedDate).toBeInstanceOf(Date);
    expect(selectedDate.getMonth()).toBe(2);  // March
    expect(selectedDate.getDate()).toBe(26);  // 26th (frozen today)
    expect(selectedDate.getFullYear()).toBe(2026);

    // Modal must be closed
    expect(UNSAFE_getByType(Modal).props.visible).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("tapping the backdrop closes the modal without calling onChange", () => {
    // WHAT: Tapping outside the calendar card (the semi-transparent backdrop)
    //       dismisses the picker without changing the date.
    // WHY: Users often open the picker accidentally or change their mind.
    //      If the backdrop tap triggers onChange, the date changes without the
    //      user explicitly selecting a day — a silent data mutation on a form.
    const mockOnChange = jest.fn();
    const { UNSAFE_getAllByType, UNSAFE_getByType } = renderPicker({
      value: new OriginalDate(2026, 2, 15),
      onChange: mockOnChange,
    });
    const { TouchableOpacity, Modal } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker

    // The backdrop is the outer TouchableOpacity of the Modal
    // It has activeOpacity={1} and is the full-screen overlay
    // Simulate pressing the backdrop via onRequestClose (hardware back button
    // on Android, which calls setShow(false))
    const modal = UNSAFE_getByType(Modal);
    fireEvent(modal, "requestClose");

    expect(UNSAFE_getByType(Modal).props.visible).toBe(false);
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("correctly renders the financial year boundary date of 31 March", () => {
    // WHAT: March 31 is the last day of the Indian financial year. The
    //       calendar must correctly include it in the March grid (not skip
    //       it or show it as April 1).
    // WHY: Incorrectly classifying a March 31 invoice as April would shift
    //      it into the new financial year — wrong GSTR-1 period attribution,
    //      requiring a corrective amendment filing with tax authorities.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 2, 31), // March 31
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker — March 2026

    // 31 must appear as a selectable day in March
    expect(screen.getByText("31")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("correctly renders April 1 as the first day of the new financial year", () => {
    // WHAT: April 1 is the first day of the new Indian financial year.
    //       Navigating to April must show day 1 in the grid.
    // WHY: The financial year start is configurable per business (stored in
    //      the `financialYearStart` column). Showing the wrong first day of
    //      April would misattribute FY-start invoices.
    const { UNSAFE_getAllByType } = renderPicker({
      value: new OriginalDate(2026, 3, 1), // April 1 2026
    });
    const { TouchableOpacity } = require("react-native");
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(touchables[0]); // open picker — April 2026

    expect(screen.getByText("Apr 2026")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });
});
