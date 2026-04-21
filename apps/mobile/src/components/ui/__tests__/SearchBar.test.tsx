/**
 * Tests for `src/components/ui/SearchBar.tsx`
 *
 * WHY these tests matter for contributors:
 * The SearchBar is used on every list screen — parties (customers/suppliers),
 * items (products/services), and invoices. Indian merchants manage hundreds of
 * parties with similar names (e.g. "Sharma Textiles", "Sharma Traders",
 * "Sharma & Sons") and rely heavily on fast, accurate search to find the right
 * entry before creating an invoice. A broken SearchBar forces manual scrolling
 * through potentially 500+ party entries.
 *
 * Platform differences matter here:
 *   - iOS: uses `clearButtonMode="while-editing"` (native X button)
 *   - Android: renders a custom TouchableOpacity with close icon because
 *     clearButtonMode is not supported on Android TextInput
 *
 * Coverage checklist:
 *   - Renders the search icon
 *   - Renders with the default "Search..." placeholder
 *   - Renders with a custom placeholder
 *   - Calls onChangeText when text is typed
 *   - Shows the clear button on Android when text is non-empty
 *   - Hides the clear button on Android when text is empty
 *   - Clear button calls onChangeText("") to reset the search
 *   - Does not show custom clear button on iOS (uses native clearButtonMode)
 *   - TextInput has autoCorrect disabled (prevents autocorrect on business names)
 */

import React from "react";
import { Platform } from "react-native";
import { screen, fireEvent } from "@testing-library/react-native";
import { renderWithTheme as render } from "../../../test-utils";
import { SearchBar } from "../SearchBar";

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
describe("SearchBar — text search for parties, items, and invoices", () => {
  // -------------------------------------------------------------------------
  it("renders without crashing with required props", () => {
    // WHAT: Basic smoke test — ensures the component mounts with only the
    //       required value and onChangeText props.
    // WHY: A JSX error here crashes every list screen simultaneously, since
    //      SearchBar is used identically in all four major list views.
    expect(() =>
      render(<SearchBar value="" onChangeText={() => {}} />)
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  it("renders the search icon (search-outline) as a visual affordance", () => {
    // WHAT: Verify the magnifying glass icon is rendered inside the search bar.
    // WHY: Without the icon, the input field looks like a plain text field with
    //      no hint of its purpose — users may not realise it is searchable,
    //      reducing discoverability of the search feature.
    render(<SearchBar value="" onChangeText={() => {}} />);

    expect(screen.getByTestId("icon-search-outline")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders with the default 'Search...' placeholder when no placeholder prop is given", () => {
    // WHAT: The default placeholder text shown when the input is empty.
    // WHY: A missing placeholder makes the search bar look broken/empty to
    //      users who have never seen a search bar in a list before.
    render(<SearchBar value="" onChangeText={() => {}} />);

    const input = screen.getByPlaceholderText("Search...");
    expect(input).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders with a custom placeholder when one is provided", () => {
    // WHAT: Screens pass a contextual placeholder like "Search parties..." or
    //       "Search by item name or HSN code...".
    // WHY: Context-specific placeholders improve discoverability on each screen.
    //      If the placeholder prop is ignored, all four search bars show the
    //      generic "Search..." instead of helping users understand what to type.
    render(
      <SearchBar
        value=""
        onChangeText={() => {}}
        placeholder="Search parties..."
      />
    );

    expect(screen.getByPlaceholderText("Search parties...")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("calls onChangeText with the new text when the user types", () => {
    // WHAT: Core functionality — typing in the search bar must fire onChangeText
    //       so the parent component can filter the list.
    // WHY: If onChangeText is not fired, typing in the search bar does nothing
    //      and the list never filters. This is a total feature failure for search.
    const mockOnChange = jest.fn();
    render(<SearchBar value="" onChangeText={mockOnChange} />);

    const input = screen.getByPlaceholderText("Search...");
    fireEvent.changeText(input, "Sharma");

    expect(mockOnChange).toHaveBeenCalledWith("Sharma");
  });

  // -------------------------------------------------------------------------
  it("reflects the controlled value prop in the TextInput", () => {
    // WHAT: The SearchBar is a controlled component — its displayed text is
    //       entirely driven by the `value` prop.
    // WHY: If the value prop is ignored, the input shows stale text after the
    //      parent clears it (e.g. when switching tabs), breaking the controlled
    //      input pattern and causing search to get stuck on the last query.
    render(<SearchBar value="Gupta" onChangeText={() => {}} />);

    const input = screen.getByDisplayValue("Gupta");
    expect(input).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("has autoCorrect disabled to prevent autocorrect on business/party names", () => {
    // WHAT: The TextInput must have `autoCorrect={false}`.
    // WHY: iOS autocorrect turns "Patel Pharma" into "Patrol Pharmacy" and
    //      "Ratan Tata" into "Rattan Data". For an app used to search real
    //      business names, autocorrect is actively harmful.
    render(<SearchBar value="" onChangeText={() => {}} />);

    const input = screen.getByPlaceholderText("Search...");
    expect(input.props.autoCorrect).toBe(false);
  });

  // -------------------------------------------------------------------------
  it("shows a clear (close-circle) button on Android when the search text is non-empty", () => {
    // WHAT: Android does not support `clearButtonMode`, so the component
    //       renders a custom close button when value.length > 0 on Android.
    // WHY: Without a visible clear button, Android users must manually select
    //      all text and delete it — a multi-step gesture for a one-tap task.
    //      The feature parity with iOS is important for the Android-heavy
    //      Indian market (Android accounts for ~95% of Indian smartphone users).
    //
    // NOTE ON MOCKING Platform.OS:
    //      `jest.spyOn(Platform, "OS", "get")` only works when Platform.OS is
    //      defined as an accessor (get/set) property. In the React Native test
    //      environment Platform.OS is a plain data property ("ios"), so we must
    //      use Object.defineProperty to temporarily install a getter instead.
    Object.defineProperty(Platform, "OS", {
      get: () => "android",
      configurable: true,
    });

    render(<SearchBar value="Sharma" onChangeText={() => {}} />);

    // The close-circle icon should be present
    expect(screen.getByTestId("icon-close-circle")).toBeTruthy();

    // Restore the original iOS value so this test does not pollute others.
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });

  // -------------------------------------------------------------------------
  it("hides the clear button on Android when the search text is empty", () => {
    // WHAT: The clear button should only be shown when there is something to
    //       clear (value.length > 0).
    // WHY: A persistent close button when no text is present is confusing and
    //      wastes touch target space in a compact search bar.
    //
    // NOTE ON MOCKING Platform.OS: see explanation in the test above.
    Object.defineProperty(Platform, "OS", {
      get: () => "android",
      configurable: true,
    });

    render(<SearchBar value="" onChangeText={() => {}} />);

    expect(screen.queryByTestId("icon-close-circle")).toBeNull();

    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });

  // -------------------------------------------------------------------------
  it("calls onChangeText('') when the Android clear button is pressed", () => {
    // WHAT: Tapping the close-circle button on Android should clear the search.
    // WHY: If the clear button does not call onChangeText(""), the text input
    //      clears visually but the parent's filter state remains stale —
    //      the list looks empty but the state still has the old query.
    //
    // NOTE ON MOCKING Platform.OS: see explanation in the "shows a clear" test above.
    Object.defineProperty(Platform, "OS", {
      get: () => "android",
      configurable: true,
    });

    const mockOnChange = jest.fn();
    render(<SearchBar value="Sharma" onChangeText={mockOnChange} />);

    const clearButton = screen.getByTestId("icon-close-circle");
    // The close-circle is inside a TouchableOpacity — press the parent
    fireEvent.press(clearButton.parent as any);

    expect(mockOnChange).toHaveBeenCalledWith("");

    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });

  // -------------------------------------------------------------------------
  it("does not render the custom clear button on iOS (uses native clearButtonMode)", () => {
    // WHAT: On iOS, the custom clear button must NOT be rendered because the
    //       native `clearButtonMode="while-editing"` provides this behaviour.
    // WHY: Rendering both the native and custom clear buttons on iOS would
    //      show two X icons side-by-side — a visual regression that breaks
    //      the iOS design review checklist.
    //
    // NOTE ON MOCKING Platform.OS: see explanation in the "shows a clear" test above.
    // The jest-expo preset runs with platform: 'ios' already, but we set it
    // explicitly here to document the intent and make this test self-describing.
    Object.defineProperty(Platform, "OS", {
      get: () => "ios",
      configurable: true,
    });

    render(<SearchBar value="some text" onChangeText={() => {}} />);

    // Custom close button must not be rendered on iOS
    expect(screen.queryByTestId("icon-close-circle")).toBeNull();

    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });

  // -------------------------------------------------------------------------
  it("has returnKeyType='search' for the iOS keyboard search button", () => {
    // WHAT: The keyboard's return key should show "Search" instead of "Return"
    //       or "Done" when inside the search bar.
    // WHY: This is a standard iOS UX convention. Without it, users see "Return"
    //      on the keyboard and are unsure whether pressing it submits the search
    //      or dismisses the keyboard — leading to confusion in user testing.
    render(<SearchBar value="" onChangeText={() => {}} />);

    const input = screen.getByPlaceholderText("Search...");
    expect(input.props.returnKeyType).toBe("search");
  });
});
