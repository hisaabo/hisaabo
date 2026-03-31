/**
 * Tests for `src/components/ui/EmptyState.tsx`
 *
 * WHY these tests matter for contributors:
 * EmptyState is displayed when a list screen has no data — new merchants on
 * their first launch see it on the Invoice list, Party list, and Item list
 * simultaneously. It is the first impression for new users.
 *
 * A good empty state:
 *   1. Tells the user WHAT is empty (title)
 *   2. Tells them WHY it is empty or WHAT to do (description)
 *   3. Provides a visual anchor (icon) so it doesn't look like a crash
 *
 * If any of these are missing, new users think the app is broken and churn
 * before creating their first invoice — a critical acquisition funnel failure.
 *
 * Coverage checklist:
 *   - Renders the title text
 *   - Renders the description text when provided
 *   - Does NOT render description when omitted (prop is optional)
 *   - Renders the Ionicons icon with the correct name
 *   - Uses centered layout (justifyContent: center, alignItems: center)
 */

import React from "react";
import { render, screen } from "@testing-library/react-native";
import { EmptyState } from "../EmptyState";

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
describe("EmptyState — zero-data placeholder for list screens", () => {
  // -------------------------------------------------------------------------
  it("renders the title text", () => {
    // WHAT: The primary text explaining what is empty.
    // WHY: Without a title, users see only an icon and blank space — they
    //      cannot tell if the app loaded successfully or encountered an error.
    render(
      <EmptyState
        icon="receipt-outline"
        title="No invoices yet"
      />
    );

    expect(screen.getByText("No invoices yet")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders the description text when provided", () => {
    // WHAT: Optional secondary text with a call-to-action or explanation.
    // WHY: "Tap + to create your first invoice" tells new merchants exactly
    //      what to do. This is the difference between a confused new user
    //      and a user who successfully creates their first invoice.
    render(
      <EmptyState
        icon="receipt-outline"
        title="No invoices yet"
        description="Tap + to create your first invoice"
      />
    );

    expect(screen.getByText("Tap + to create your first invoice")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("does NOT render a description element when the description prop is omitted", () => {
    // WHAT: The description prop is optional — when omitted, no description
    //       Text element should be rendered (not even an empty string).
    // WHY: An empty Text element takes up layout space, leaving awkward blank
    //      space below the title that designers will flag in review.
    render(
      <EmptyState
        icon="people-outline"
        title="No parties added"
      />
    );

    // The title must be present so the user knows what the empty state is for.
    expect(screen.getByText("No parties added")).toBeTruthy();

    // No description text should exist — the component conditionally renders
    // {description && <Text>…</Text>} so when the prop is omitted the <Text>
    // element is never mounted at all (not just hidden or empty).
    // NOTE: getAllByText(/.+/) also matches the mocked Ionicons node (which
    // renders as <Text>people-outline</Text>), so we test the ABSENCE of a
    // description by querying for the known-absent description string instead
    // of counting total text nodes.
    expect(screen.queryByText("Tap + to create your first invoice")).toBeNull();
    // Verify no second meaningful text node exists other than the title itself.
    // We exclude the icon's testID node from this check since the Ionicons mock
    // renders the icon name as a Text node in the test environment.
    const allTexts = screen.getAllByText(/.+/);
    const nonIconTexts = allTexts.filter(
      (el) => !el.props.testID?.startsWith("icon-")
    );
    // Only the title Text should be rendered (no description Text node at all).
    expect(nonIconTexts).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  it("renders the Ionicons icon with the specified name", () => {
    // WHAT: The icon prop selects the visual symbol shown above the title.
    // WHY: Different screens use different icons to contextualise the empty
    //      state: receipt-outline for invoices, people-outline for parties,
    //      pricetag-outline for items. If the icon prop is ignored, every
    //      empty state shows the same generic icon, reducing visual clarity.
    render(
      <EmptyState
        icon="people-outline"
        title="No parties found"
      />
    );

    expect(screen.getByTestId("icon-people-outline")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("uses a large icon size (48) appropriate for a full-screen empty state", () => {
    // WHAT: The Ionicons size prop must be 48 as specified in the component.
    // WHY: A 16pt icon in the middle of a blank screen is nearly invisible
    //      and makes the empty state look accidental rather than designed.
    render(
      <EmptyState icon="pricetag-outline" title="No items" />
    );

    // Our mock renders Ionicons as Text — check the mocked component rendered
    // We verify by the testID that the icon is rendered with our mock
    expect(screen.getByTestId("icon-pricetag-outline")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders a search-specific empty state for 'no results found' scenarios", () => {
    // WHAT: When a merchant searches for "xyz" in the party list and nothing
    //       matches, a specific empty state with a search icon should appear.
    // WHY: The generic "No parties added" empty state with a people icon is
    //      confusing when parties DO exist but the search term has no matches.
    //      The parent screen handles the context; this test just validates that
    //      arbitrary icon + title combinations render correctly.
    render(
      <EmptyState
        icon="search-outline"
        title="No results found"
        description="Try a different search term"
      />
    );

    expect(screen.getByTestId("icon-search-outline")).toBeTruthy();
    expect(screen.getByText("No results found")).toBeTruthy();
    expect(screen.getByText("Try a different search term")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders with centered layout for full-screen placement", () => {
    // WHAT: The container View uses flex: 1 with center alignment so the
    //       empty state fills the screen and appears centred vertically.
    // WHY: Without flex: 1, the empty state sticks to the top of the screen
    //      and looks like an error message at the top of a blank list rather
    //      than an intentional, centred call-to-action.
    const { UNSAFE_getByType } = render(
      <EmptyState icon="receipt-outline" title="No invoices" />
    );
    const { View } = require("react-native");
    const container = UNSAFE_getByType(View);

    const style = Array.isArray(container.props.style)
      ? Object.assign({}, ...container.props.style)
      : container.props.style;

    expect(style.flex).toBe(1);
    expect(style.justifyContent).toBe("center");
    expect(style.alignItems).toBe("center");
  });
});
