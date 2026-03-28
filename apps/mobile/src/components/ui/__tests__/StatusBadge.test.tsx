/**
 * Tests for `src/components/ui/StatusBadge.tsx`
 *
 * WHY these tests matter for contributors:
 * The StatusBadge is rendered on every invoice row in the app — potentially
 * hundreds of times in a single list. It is the primary visual signal that
 * tells a merchant at a glance whether a customer has paid, is overdue, or
 * needs follow-up. Incorrect colours or labels here directly cause merchants
 * to miss overdue collections, which is a core value-proposition failure.
 *
 * The component maps status strings (coming from the API's invoice/order
 * status enums) to colour-coded badges. If the mapping is wrong:
 *   - "overdue" shown in green → merchant misses unpaid invoices
 *   - "paid" shown in red → merchant chases customers who already paid
 *   - unknown status shows the wrong label → confuses merchants about state
 *
 * Colour values tested here match the STATUS_CONFIG in the source file.
 * If you update colours in StatusBadge, update these tests too.
 *
 * Coverage checklist:
 *   - paid → green (#34d399 text)
 *   - overdue → red (#f87171 text)
 *   - draft → gray (#9ca3af text)
 *   - partial → amber (#fbbf24 text)
 *   - sent → blue (#60a5fa text)
 *   - cancelled → muted gray (#6b7280 text)
 *   - unknown status → falls back to draft (gray) gracefully
 *   - label text is uppercase (CSS textTransform)
 */

import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StatusBadge } from "../StatusBadge";

// ---------------------------------------------------------------------------
// StatusBadge does not use any native modules — no mocks required.
// All tests are synchronous render tests.
// ---------------------------------------------------------------------------

describe("StatusBadge — invoice/order status indicator", () => {
  // -------------------------------------------------------------------------
  it("renders the label 'Paid' for status='paid'", () => {
    // WHAT: The most important badge state — a merchant's paid invoice.
    // WHY: If the paid badge renders with the wrong label, merchants cannot
    //      tell which invoices have been collected at a glance.
    render(<StatusBadge status="paid" />);

    expect(screen.getByText("Paid")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders 'Paid' badge with green text colour (#34d399)", () => {
    // WHAT: Green is the universal indicator of success/completion.
    // WHY: If paid is red or amber, merchants will chase already-paid invoices,
    //      damaging customer relationships and Hisaabo's credibility as a
    //      replacement for manual ledger books.
    render(<StatusBadge status="paid" />);

    const text = screen.getByText("Paid");
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#34d399" })])
    );
  });

  // -------------------------------------------------------------------------
  it("renders 'Overdue' label for status='overdue'", () => {
    // WHAT: An invoice past its due date with no payment recorded.
    // WHY: The overdue badge is what prompts merchants to send payment reminders.
    //      A missing or wrong label breaks the collections workflow.
    render(<StatusBadge status="overdue" />);

    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders 'Overdue' badge with red text colour (#f87171)", () => {
    // WHAT: Red indicates urgency — the merchant needs to act on this invoice.
    // WHY: Overdue invoices in green would blend with paid ones and be missed.
    render(<StatusBadge status="overdue" />);

    const text = screen.getByText("Overdue");
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#f87171" })])
    );
  });

  // -------------------------------------------------------------------------
  it("renders 'Draft' label for status='draft'", () => {
    // WHAT: An invoice that has been created but not yet sent to the customer.
    // WHY: Draft invoices should not be collected on — merchants must not
    //      confuse them with sent invoices awaiting payment.
    render(<StatusBadge status="draft" />);

    expect(screen.getByText("Draft")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders 'Draft' badge with gray text colour (#9ca3af)", () => {
    // WHAT: Gray signals an inactive/pending state — not yet actionable.
    // WHY: A bright colour for drafts would make the invoice list look noisy
    //      and distract from the invoices that actually need attention.
    render(<StatusBadge status="draft" />);

    const text = screen.getByText("Draft");
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#9ca3af" })])
    );
  });

  // -------------------------------------------------------------------------
  it("renders 'Partial' label with amber colour for status='partial'", () => {
    // WHAT: Customer has paid part of the invoice amount (common in wholesale
    //       trade where partial payments against large orders are standard).
    // WHY: Partial payments require follow-up for the remaining balance.
    //      Amber (warning) signals "action needed but not urgent yet."
    render(<StatusBadge status="partial" />);

    expect(screen.getByText("Partial")).toBeTruthy();
    const text = screen.getByText("Partial");
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#fbbf24" })])
    );
  });

  // -------------------------------------------------------------------------
  it("renders 'Sent' label with blue colour for status='sent'", () => {
    // WHAT: Invoice has been sent (WhatsApp/email) to the customer and is
    //       awaiting payment.
    // WHY: Blue (informational) tells the merchant the ball is in the
    //      customer's court — no action needed yet.
    render(<StatusBadge status="sent" />);

    expect(screen.getByText("Sent")).toBeTruthy();
    const text = screen.getByText("Sent");
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#60a5fa" })])
    );
  });

  // -------------------------------------------------------------------------
  it("renders 'Cancelled' label with muted gray for status='cancelled'", () => {
    // WHAT: Invoice was voided — no payment expected, no action needed.
    // WHY: Cancelled invoices must be visually de-emphasised so they don't
    //      clutter the active collections view.
    render(<StatusBadge status="cancelled" />);

    expect(screen.getByText("Cancelled")).toBeTruthy();
    const text = screen.getByText("Cancelled");
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: "#6b7280" })])
    );
  });

  // -------------------------------------------------------------------------
  it("renders 'Pending' label for status='pending' (purchase order state)", () => {
    // WHAT: Used for purchase orders awaiting supplier confirmation.
    render(<StatusBadge status="pending" />);

    expect(screen.getByText("Pending")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders 'Delivered' label for status='delivered' (order fulfillment)", () => {
    // WHAT: Order has been physically delivered to the customer.
    render(<StatusBadge status="delivered" />);

    expect(screen.getByText("Delivered")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("falls back to 'Draft' styling for an unknown status string without crashing", () => {
    // WHAT: The API introduces a new status value ("processing", "on_hold")
    //       that the mobile app has not been updated to handle yet.
    // WHY: The source code uses `STATUS_CONFIG[status] || STATUS_CONFIG.draft`
    //      as the fallback. This test ensures that unknown statuses render
    //      something sensible (Draft gray) instead of crashing with a
    //      "Cannot read properties of undefined" TypeError that would crash
    //      the entire invoice list screen for affected merchants.
    render(<StatusBadge status="some_future_status_not_in_config" />);

    // The fallback label is "Draft"
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  it("renders badge text in UPPERCASE (textTransform: 'uppercase' style)", () => {
    // WHAT: The badge text uses uppercase for visual hierarchy.
    // WHY: Even if React Native's textTransform doesn't affect getByText()
    //      matching, the style prop must be correct so the rendered UI
    //      looks as designed — mixed-case status badges fail design review.
    render(<StatusBadge status="paid" />);

    const text = screen.getByText("Paid");
    expect(text.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ textTransform: "uppercase" }),
      ])
    );
  });

  // -------------------------------------------------------------------------
  it("renders a View wrapper around the Text for background colour application", () => {
    // WHAT: The badge has both a background colour (on the View) and a text
    //       colour (on the Text). The View must be present.
    // WHY: Without the wrapping View, the background pill shape disappears
    //      and the status text floats over the invoice row without the
    //      colour-coded capsule that makes it readable at a glance.
    const { UNSAFE_getByType } = render(<StatusBadge status="paid" />);

    // Check the View exists with a background colour set
    const { View } = require("react-native");
    const view = UNSAFE_getByType(View);
    const flatStyle = Array.isArray(view.props.style)
      ? Object.assign({}, ...view.props.style)
      : view.props.style;

    expect(flatStyle.backgroundColor).toBeDefined();
  });
});
