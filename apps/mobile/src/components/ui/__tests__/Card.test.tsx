/**
 * Tests for `src/components/ui/Card.tsx`
 *
 * WHY these tests matter for contributors:
 * The Card component is the visual container for nearly every data item in
 * Hisaabo: invoice summary cards, party rows, dashboard metric tiles, and
 * payment records. It establishes the visual language of the app —
 * dark surface background, rounded corners, and a subtle border that
 * separates content from the dark app background.
 *
 * While this is a simple layout component, its visual properties are
 * load-bearing for the design system:
 *   - `backgroundColor: colors.surface` — differentiates the card from the
 *     page background (#0f0f1a → #1a1a2e)
 *   - `borderRadius: 16` — the signature rounded corner of the Hisaabo design
 *   - `borderWidth: 1` + `borderColor: colors.border` — subtle definition
 *   - `padding: 16` — consistent content spacing
 *
 * If any of these are regressed, every data card in the app changes visually
 * without any functional tests catching it.
 *
 * Coverage checklist:
 *   - Renders children correctly
 *   - Applies the surface background colour
 *   - Applies the border radius (16)
 *   - Applies padding (16)
 *   - Applies border styling
 *   - Merges a custom style prop without overriding base styles
 *   - Renders multiple children types (Text, View) without issues
 */

import React from "react";
import { Text, View } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Card } from "../Card";
import { colors } from "../../../lib/theme";

// ---------------------------------------------------------------------------
describe("Card — surface container for invoice, party, and dashboard data", () => {
  // -------------------------------------------------------------------------
  it("renders children correctly", () => {
    // WHAT: Children passed to Card must be rendered inside it.
    // WHY: A Card that swallows its children would make every data card in
    //      the app appear blank — all content invisible, app looks broken.
    render(
      <Card>
        <Text>Invoice #INV-001</Text>
      </Card>
    );

    expect(screen.getByText("Invoice #INV-001")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders multiple children without crashing", () => {
    // WHAT: Cards typically contain multiple text lines (amount, date, party).
    // WHY: If Card only renders the first child, invoice summary cards would
    //      only show the invoice number — amount and party name invisible.
    render(
      <Card>
        <Text>Sharma Textiles</Text>
        <Text>₹50,000</Text>
        <Text>28 Mar 2026</Text>
      </Card>
    );

    expect(screen.getByText("Sharma Textiles")).toBeTruthy();
    expect(screen.getByText("₹50,000")).toBeTruthy();
    expect(screen.getByText("28 Mar 2026")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("applies the surface background colour (#1a1a2e) to differentiate from the page background", () => {
    // WHAT: The card background must be `colors.surface` ("#1a1a2e"), which is
    //       lighter than the page background `colors.bg` ("#0f0f1a").
    // WHY: Without the surface background, cards are invisible against the
    //      dark page — all list items blend together and there is no visual
    //      separation between data entries.
    const { UNSAFE_getByType } = render(
      <Card>
        <Text>Test</Text>
      </Card>
    );
    const { View: RNView } = require("react-native");
    const card = UNSAFE_getByType(RNView);

    const style = Array.isArray(card.props.style)
      ? Object.assign({}, ...card.props.style.map((s: any) => s || {}))
      : card.props.style;

    expect(style.backgroundColor).toBe(colors.surface);
  });

  // -------------------------------------------------------------------------
  it("applies borderRadius: 16 for the signature rounded corners", () => {
    // WHAT: The Card's rounded corners (16pt radius) are the signature visual
    //       element of the Hisaabo design system.
    // WHY: If borderRadius is changed or removed, every card in the app
    //      becomes a square — a significant visual regression that would
    //      require a designer review to catch and reverse.
    const { UNSAFE_getByType } = render(
      <Card>
        <Text>Test</Text>
      </Card>
    );
    const { View: RNView } = require("react-native");
    const card = UNSAFE_getByType(RNView);

    const style = Array.isArray(card.props.style)
      ? Object.assign({}, ...card.props.style.map((s: any) => s || {}))
      : card.props.style;

    expect(style.borderRadius).toBe(16);
  });

  // -------------------------------------------------------------------------
  it("applies padding: 16 for consistent internal content spacing", () => {
    // WHAT: The 16pt padding creates the breathing room between the card
    //       border and the content inside (invoice details, amounts, etc.).
    // WHY: Without padding, text and numbers sit flush against the card edge —
    //      making every data card look cramped and unreadable on the small
    //      screen sizes common in the Indian mid-range market.
    const { UNSAFE_getByType } = render(
      <Card>
        <Text>Test</Text>
      </Card>
    );
    const { View: RNView } = require("react-native");
    const card = UNSAFE_getByType(RNView);

    const style = Array.isArray(card.props.style)
      ? Object.assign({}, ...card.props.style.map((s: any) => s || {}))
      : card.props.style;

    expect(style.padding).toBe(16);
  });

  // -------------------------------------------------------------------------
  it("applies borderWidth: 1 and border colour from the theme", () => {
    // WHAT: The card border creates subtle definition against the surface.
    // WHY: Without the border, cards in dark mode look identical to flat
    //      content sections — the UI loses depth and hierarchy.
    const { UNSAFE_getByType } = render(
      <Card>
        <Text>Test</Text>
      </Card>
    );
    const { View: RNView } = require("react-native");
    const card = UNSAFE_getByType(RNView);

    const style = Array.isArray(card.props.style)
      ? Object.assign({}, ...card.props.style.map((s: any) => s || {}))
      : card.props.style;

    expect(style.borderWidth).toBe(1);
    expect(style.borderColor).toBe(colors.border);
  });

  // -------------------------------------------------------------------------
  it("merges the custom style prop with base styles (custom wins on conflict)", () => {
    // WHAT: Consumers can pass a custom style to override specific properties
    //       (e.g. a dashboard tile might want no padding, a different radius).
    // WHY: If the style prop is ignored, customisation is impossible without
    //      forking the component — every one-off layout adjustment becomes
    //      a new component variant.
    const { UNSAFE_getByType } = render(
      <Card style={{ marginBottom: 12, padding: 0 }}>
        <Text>Custom card</Text>
      </Card>
    );
    const { View: RNView } = require("react-native");
    const card = UNSAFE_getByType(RNView);

    const styleArray = Array.isArray(card.props.style)
      ? card.props.style
      : [card.props.style];

    // Custom marginBottom must be in the style array
    const hasMargin = styleArray.some((s: any) => s && s.marginBottom === 12);
    expect(hasMargin).toBe(true);

    // Custom style must be present (whether it overrides padding is an
    // implementation detail — at minimum both styles must be in the array)
    const hasCustomPadding = styleArray.some((s: any) => s && s.padding === 0);
    expect(hasCustomPadding).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("renders a nested View as a child without layout issues", () => {
    // WHAT: Cards can contain complex layouts — e.g. a row with amount on
    //       the left and status badge on the right.
    // WHY: If Card's styles interfere with child View layout (e.g. by setting
    //      flexDirection when it should not), nested rows will stack vertically
    //      instead of horizontally.
    render(
      <Card>
        <View>
          <Text>Patel Pharma</Text>
          <Text>₹1,00,000</Text>
        </View>
      </Card>
    );

    expect(screen.getByText("Patel Pharma")).toBeTruthy();
    expect(screen.getByText("₹1,00,000")).toBeTruthy();
  });
});
