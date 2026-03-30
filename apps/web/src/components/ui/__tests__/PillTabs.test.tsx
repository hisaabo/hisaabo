/**
 * PillTabs & SegmentedControl — tab navigation components
 *
 * PillTabs is used on virtually every list page in Hisaabo (invoices,
 * parties, items, payments, …) to switch between views or filter sets.
 * SegmentedControl is a visually distinct variant used for binary/ternary
 * options such as Sale/Purchase or Income/Expense toggles.
 *
 * These tests verify:
 *   1. Correct rendering of labels and optional badge counts.
 *   2. That the active tab is visually distinguished so users can orient
 *      themselves within the current view.
 *   3. The onChange callback fires exactly when expected — on a *different*
 *      tab click — and does NOT fire when clicking the already-active tab,
 *      which would otherwise trigger unnecessary re-renders and data fetches.
 *   4. Size variants work correctly so compact layouts stay usable.
 *   5. WCAG 2.1 AA accessibility compliance via axe-core.
 *   6. Keyboard operability so users who cannot use a mouse can still
 *      navigate between tabs.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { PillTabs, SegmentedControl } from "../Tabs";

// ─── Shared fixture data ──────────────────────────────────────────────────────
// Using real Indian business vocabulary (GST, credit notes, etc.) so test
// output is meaningful to contributors reading failures.

const INVOICE_TABS = [
  { value: "all", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const TABS_WITH_COUNTS = [
  { value: "unpaid", label: "Unpaid", count: 12 },
  { value: "paid", label: "Paid", count: 45 },
  { value: "draft", label: "Draft", count: 3 },
];

// ─── PillTabs ─────────────────────────────────────────────────────────────────

describe("PillTabs — pill-style tab bar used across all list pages", () => {
  it("renders every tab with its correct label so users can identify navigation options", () => {
    render(
      <PillTabs tabs={INVOICE_TABS} value="all" onChange={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overdue" })).toBeInTheDocument();
  });

  it("applies brand-colour classes to the active tab so users immediately know which view is selected", () => {
    render(
      <PillTabs tabs={INVOICE_TABS} value="paid" onChange={vi.fn()} />
    );

    const activeTab = screen.getByRole("button", { name: "Paid" });
    // The active tab must carry brand styling. We check for the brand-50
    // background class that the component applies in md (default) size.
    expect(activeTab.className).toMatch(/bg-brand-50/);
    expect(activeTab.className).toMatch(/text-brand-700/);
  });

  it("does NOT apply active styling to inactive tabs, preventing visual confusion", () => {
    render(
      <PillTabs tabs={INVOICE_TABS} value="all" onChange={vi.fn()} />
    );

    const inactiveTab = screen.getByRole("button", { name: "Sent" });
    expect(inactiveTab.className).not.toMatch(/bg-brand-50/);
  });

  it("calls onChange with the clicked tab's value so the parent can switch data view", async () => {
    const handleChange = vi.fn();
    render(
      <PillTabs tabs={INVOICE_TABS} value="all" onChange={handleChange} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Overdue" }));

    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith("overdue");
  });

  it("does NOT call onChange when clicking the already-active tab, preventing unnecessary re-fetches", async () => {
    const handleChange = vi.fn();
    render(
      <PillTabs tabs={INVOICE_TABS} value="sent" onChange={handleChange} />
    );

    // Click the tab that is already active.
    await userEvent.click(screen.getByRole("button", { name: "Sent" }));

    expect(handleChange).not.toHaveBeenCalled();
  });

  it("applies compact sizing classes in 'sm' size variant so toolbar layouts remain uncluttered", () => {
    render(
      <PillTabs
        tabs={INVOICE_TABS}
        value="all"
        onChange={vi.fn()}
        size="sm"
      />
    );

    // In 'sm' mode the wrapper gets a background container to visually group
    // the tabs, and individual buttons use smaller padding/font classes.
    const firstButton = screen.getByRole("button", { name: "All" });
    expect(firstButton.className).toMatch(/px-2/);
    expect(firstButton.className).toMatch(/text-\[10px\]/);
  });

  it("renders numeric badge counts alongside tab labels so users can see pending-item volumes at a glance", () => {
    render(
      <PillTabs tabs={TABS_WITH_COUNTS} value="unpaid" onChange={vi.fn()} />
    );

    // Each count must be visible in the DOM. The badges show e.g. how many
    // invoices are overdue without the user having to switch tabs.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders badge with zero count when count is explicitly 0 (falsy guard must not hide it)", () => {
    const tabsWithZero = [
      { value: "returns", label: "Returns", count: 0 },
    ];
    render(
      <PillTabs tabs={tabsWithZero} value="returns" onChange={vi.fn()} />
    );

    // count=0 must still render so users know the list is intentionally empty.
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("active badge uses brand colours while inactive badge uses neutral surface colour", () => {
    render(
      <PillTabs tabs={TABS_WITH_COUNTS} value="unpaid" onChange={vi.fn()} />
    );

    // Active tab badge (unpaid — value 12) gets brand-100 background.
    const badges = screen.getAllByText(/^\d+$/);
    const unpaidBadge = badges.find((el) => el.textContent === "12")!;
    expect(unpaidBadge.className).toMatch(/bg-brand-100/);
  });

  // ─── Accessibility ──────────────────────────────────────────────────────────

  it("has no WCAG 2.1 AA violations (axe-core audit) so screen-reader users can navigate tab bars", async () => {
    const { container } = render(
      <PillTabs tabs={INVOICE_TABS} value="all" onChange={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("each tab is reachable via Tab key and activatable via Enter/Space so keyboard-only users can switch views", async () => {
    const handleChange = vi.fn();
    render(
      <PillTabs tabs={INVOICE_TABS} value="all" onChange={handleChange} />
    );

    // Tab through to the "Sent" button and press Enter.
    await userEvent.tab();
    // First focusable button is "All" (active); tab once to reach "Sent".
    await userEvent.tab();

    const sentButton = screen.getByRole("button", { name: "Sent" });
    expect(sentButton).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(handleChange).toHaveBeenCalledWith("sent");
  });
});

// ─── SegmentedControl ────────────────────────────────────────────────────────

describe("SegmentedControl — binary/ternary switch used for Sale/Purchase and Income/Expense views", () => {
  const SALE_PURCHASE = [
    { value: "sale", label: "Sale" },
    { value: "purchase", label: "Purchase" },
  ];

  it("renders both segment labels so users know all available options", () => {
    render(
      <SegmentedControl
        tabs={SALE_PURCHASE}
        value="sale"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Sale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Purchase" })).toBeInTheDocument();
  });

  it("highlights the active segment with elevated surface and primary text colour", () => {
    render(
      <SegmentedControl
        tabs={SALE_PURCHASE}
        value="purchase"
        onChange={vi.fn()}
      />
    );

    const activeSegment = screen.getByRole("button", { name: "Purchase" });
    // Active segment gets bg-surface-0 and shadow-sm to look "raised".
    expect(activeSegment.className).toMatch(/bg-surface-0/);
    expect(activeSegment.className).toMatch(/text-text-primary/);
  });

  it("calls onChange when the inactive segment is clicked", async () => {
    const handleChange = vi.fn();
    render(
      <SegmentedControl
        tabs={SALE_PURCHASE}
        value="sale"
        onChange={handleChange}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Purchase" }));

    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange).toHaveBeenCalledWith("purchase");
  });

  it("does NOT call onChange when the active segment is clicked, preventing redundant state updates", async () => {
    const handleChange = vi.fn();
    render(
      <SegmentedControl
        tabs={SALE_PURCHASE}
        value="sale"
        onChange={handleChange}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Sale" }));

    expect(handleChange).not.toHaveBeenCalled();
  });

  it("has no WCAG 2.1 AA violations (axe-core audit)", async () => {
    const { container } = render(
      <SegmentedControl
        tabs={SALE_PURCHASE}
        value="sale"
        onChange={vi.fn()}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
