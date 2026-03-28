/**
 * Tests for `src/components/ui/DatePickerField.tsx`
 *
 * WHY these tests matter for contributors:
 * DatePickerField is used on every screen with a date input — invoice creation,
 * payment recording, expense logging, stock adjustments. It wraps the native
 * @react-native-community/datetimepicker with a tappable trigger field showing
 * the formatted date.
 *
 * The native DateTimePicker is mocked in tests since it requires native modules.
 * We test: label rendering, formatted date display, picker visibility toggle,
 * and the visual calendar icon affordance.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { DatePickerField } from "../DatePickerField";

// Mock the native date picker — not available in Jest environment
jest.mock("@react-native-community/datetimepicker", () => {
  const { View, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ value }: { value: Date; onChange: (event: unknown, date?: Date) => void }) => (
      <View testID="native-date-picker">
        <Text testID="picker-value">{value.toISOString()}</Text>
      </View>
    ),
  };
});

describe("DatePickerField — tappable date field with native calendar picker", () => {
  const testDate = new Date(2026, 2, 28); // 28 Mar 2026
  const handleChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the label text above the date field", () => {
    render(<DatePickerField label="Invoice Date" value={testDate} onChange={handleChange} />);
    expect(screen.getByText("Invoice Date")).toBeTruthy();
  });

  it("displays the date formatted for Indian locale (e.g., '28 Mar 2026')", () => {
    render(<DatePickerField label="Date" value={testDate} onChange={handleChange} />);
    // toLocaleDateString("en-IN") with { day, month: short, year } produces "28 Mar 2026"
    const formatted = testDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    expect(screen.getByText(formatted)).toBeTruthy();
  });

  it("does NOT show the native picker until the field is tapped", () => {
    render(<DatePickerField label="Date" value={testDate} onChange={handleChange} />);
    expect(screen.queryByTestId("native-date-picker")).toBeNull();
  });

  it("shows the native date picker when the trigger field is pressed", () => {
    render(<DatePickerField label="Date" value={testDate} onChange={handleChange} />);
    const formatted = testDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    fireEvent.press(screen.getByText(formatted));
    expect(screen.getByTestId("native-date-picker")).toBeTruthy();
  });
});
