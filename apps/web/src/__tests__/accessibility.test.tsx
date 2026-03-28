/**
 * ACCESSIBILITY — WCAG 2.1 AA compliance audit tests
 *
 * This file contains cross-cutting accessibility tests that cover:
 *   1. Utility function correctness (formatCurrency, formatDate, etc.)
 *   2. Landmark and structural patterns used across all pages.
 *   3. Keyboard navigation contracts for interactive composites.
 *   4. Screen-reader requirements (ARIA labels, live regions, roles).
 *   5. axe-core audits of fully-composed UI surfaces.
 *
 * WHY these tests matter for Hisaabo:
 *   Hisaabo targets Indian small business owners who may use basic mobile
 *   devices, assistive technologies, or keyboard-only navigation.  Every
 *   WCAG violation we ship makes the app unusable for some users.  These
 *   tests serve as a regression guard — a previously-passing accessibility
 *   test that starts failing means we have introduced an accessibility
 *   regression that must be fixed before merging.
 *
 * WCAG 2.1 AA covers:
 *   - 1.4.3 Contrast (Minimum): text ≥ 4.5:1 ratio for normal text
 *   - 1.4.4 Resize Text: up to 200% without loss of content
 *   - 2.1.1 Keyboard: all functionality operable by keyboard
 *   - 2.4.3 Focus Order: focus order preserves meaning and operability
 *   - 2.4.7 Focus Visible: keyboard focus indicator is visible
 *   - 3.3.1 Error Identification: errors are described in text
 *   - 3.3.2 Labels or Instructions: inputs have associated labels
 *   - 4.1.2 Name, Role, Value: UI components have accessible names and roles
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";

// ─── Utility tests ────────────────────────────────────────────────────────────
// formatCurrency and formatDate format monetary values and dates displayed
// throughout the app. Their output must be screen-reader friendly.

import { formatCurrency, formatDate, getInitials, getStatusColor } from "@/lib/utils";

describe("ACCESSIBILITY — utility functions", () => {
  describe("formatCurrency — used for every monetary value in the app", () => {
    it("formats ₹1,50,000 in Indian numbering (lakh notation) so users familiar with Indian financial conventions can read it", () => {
      const result = formatCurrency(150000);
      // Indian locale uses 1,50,000 not 150,000.
      expect(result).toMatch(/1,50,000/);
    });

    it("formats the rupee symbol correctly so screen readers announce '₹' as 'Indian Rupee'", () => {
      const result = formatCurrency(500);
      expect(result).toContain("₹");
    });

    it("always renders two decimal places so amounts like ₹15,000.50 are never truncated to ₹15,000.5", () => {
      expect(formatCurrency("15000.50")).toMatch(/15,000\.50/);
      expect(formatCurrency(1000)).toMatch(/1,000\.00/);
    });

    it("handles string input (as stored in the database as NUMERIC) without crashing", () => {
      // The API returns monetary values as strings to preserve precision.
      expect(() => formatCurrency("99999.99")).not.toThrow();
    });

    it("handles zero without crashing or displaying negative zero", () => {
      expect(formatCurrency(0)).toMatch(/0\.00/);
      expect(formatCurrency("0")).toMatch(/0\.00/);
    });

    it("handles large crore-level amounts (1 crore = ₹1,00,00,000) correctly", () => {
      const result = formatCurrency(10000000);
      // 1 crore = 1,00,00,000 in Indian notation.
      expect(result).toMatch(/1,00,00,000\.00/);
    });
  });

  describe("formatDate — used for invoice dates, due dates, and expense dates", () => {
    it("formats dates in Indian English locale (DD MMM YYYY) which is familiar to Indian users", () => {
      const result = formatDate("2025-03-31");
      // Should look like "31 Mar 2025".
      expect(result).toMatch(/31/);
      expect(result).toMatch(/Mar|2025/);
    });

    it("accepts Date objects in addition to ISO strings so callers don't need to pre-convert", () => {
      const date = new Date("2025-01-15");
      expect(() => formatDate(date)).not.toThrow();
    });
  });

  describe("getInitials — used in avatar/badge components", () => {
    it("returns up to two initials from a full name so avatars stay compact in list rows", () => {
      expect(getInitials("Ramesh Kumar Sharma")).toBe("RK");
    });

    it("handles single-word names without crashing", () => {
      expect(getInitials("Anita")).toBe("A");
    });

    it("returns uppercase initials so they display consistently regardless of input casing", () => {
      expect(getInitials("suresh industries")).toBe("SI");
    });
  });

  describe("getStatusColor — determines Tailwind classes for status badges", () => {
    it("returns a non-empty class string for all known statuses so badges always have colour", () => {
      const knownStatuses = ["paid", "sent", "draft", "partial", "overdue", "cancelled"];
      for (const status of knownStatuses) {
        const classes = getStatusColor(status);
        expect(classes.length).toBeGreaterThan(0);
      }
    });

    it("returns a fallback class string for unknown statuses rather than an empty string that would render unstyled", () => {
      const classes = getStatusColor("unknown_future_status");
      expect(classes.length).toBeGreaterThan(0);
    });
  });
});

// ─── Screen-reader landmark and structure tests ───────────────────────────────
// These tests verify that composed UI surfaces expose the correct ARIA
// landmarks and structural elements that screen readers use to navigate.

import { Modal } from "@/components/ui/Modal";
import { SlideOver } from "@/components/ui/SlideOver";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillTabs } from "@/components/ui/Tabs";
import { SearchInput } from "@/components/ui/SearchInput";

describe("ACCESSIBILITY — screen reader landmarks and roles", () => {
  describe("dialog components expose correct ARIA roles", () => {
    it("Modal has role='dialog' and aria-modal='true' so screen readers enter dialog mode and restrict virtual cursor to the dialog", () => {
      render(
        <Modal open={true} onClose={vi.fn()} title="Confirm Delete">
          <p>Are you sure?</p>
        </Modal>
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("SlideOver has role='dialog' so assistive technologies recognise it as a dialog panel requiring user interaction", () => {
      render(
        <SlideOver open={true} onClose={vi.fn()} title="Edit Party">
          <p>Form content</p>
        </SlideOver>
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("status badges convey state through text, not colour alone (colour-blind users)", () => {
    it("StatusBadge includes the status label as visible text so colour-blind users can read the status", () => {
      const statuses = ["paid", "overdue", "partial", "sent", "draft", "cancelled", "unfulfilled"];

      for (const status of statuses) {
        const { unmount } = render(<StatusBadge status={status} />);
        // The capitalised label must be present in the DOM.
        const expectedLabel = status.charAt(0).toUpperCase() + status.slice(1);
        expect(screen.getByText(expectedLabel)).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe("interactive components have accessible names", () => {
    it("Modal close button has aria-label='Close' so voice-control users can say 'Click Close' to dismiss", () => {
      render(
        <Modal open={true} onClose={vi.fn()} title="Payment Details">
          <p>₹15,000 received</p>
        </Modal>
      );

      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("SlideOver close button has aria-label='Close'", () => {
      render(
        <SlideOver open={true} onClose={vi.fn()} title="Add Expense">
          <p>Form here</p>
        </SlideOver>
      );

      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("SearchInput clear button has aria-label='Clear search' so keyboard users can identify it without seeing the × icon", () => {
      render(<SearchInput value="Ramesh" onChange={vi.fn()} />);

      expect(
        screen.getByRole("button", { name: "Clear search" })
      ).toBeInTheDocument();
    });

    it("SearchInput does not render a clear button when the query is empty (no phantom interactive elements)", () => {
      render(<SearchInput value="" onChange={vi.fn()} />);

      expect(
        screen.queryByRole("button", { name: "Clear search" })
      ).not.toBeInTheDocument();
    });
  });

  describe("EmptyState is readable by screen readers without visible headings that might disrupt page heading hierarchy", () => {
    it("EmptyState title is rendered as a paragraph (not a heading) so it doesn't incorrectly affect the page's heading hierarchy", () => {
      render(
        <EmptyState
          title="No invoices yet"
          description="Create your first invoice to start tracking revenue."
        />
      );

      // Title is a <p> element, not an <h1>/<h2> which would disrupt the
      // page's heading structure defined by the route-level PageHeader.
      const title = screen.getByText("No invoices yet");
      expect(title.tagName).toBe("P");
    });
  });
});

// ─── Keyboard navigation ──────────────────────────────────────────────────────

describe("ACCESSIBILITY — keyboard navigation", () => {
  describe("PillTabs — all tabs reachable and activatable by keyboard", () => {
    it("all tab buttons are focusable via Tab key so keyboard-only users can reach every tab", async () => {
      const tabs = [
        { value: "all", label: "All" },
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" },
      ];

      render(<PillTabs tabs={tabs} value="all" onChange={vi.fn()} />);

      // Tab to the first button.
      await userEvent.tab();
      expect(screen.getByRole("button", { name: "All" })).toHaveFocus();

      // Tab to the second button.
      await userEvent.tab();
      expect(screen.getByRole("button", { name: "Active" })).toHaveFocus();

      // Tab to the third button.
      await userEvent.tab();
      expect(screen.getByRole("button", { name: "Archived" })).toHaveFocus();
    });

    it("pressing Enter on a focused tab calls onChange so keyboard users can switch views", async () => {
      const handleChange = vi.fn();
      render(
        <PillTabs
          tabs={[
            { value: "sale", label: "Sale" },
            { value: "purchase", label: "Purchase" },
          ]}
          value="sale"
          onChange={handleChange}
        />
      );

      await userEvent.tab(); // Focus "Sale"
      await userEvent.tab(); // Focus "Purchase"
      await userEvent.keyboard("{Enter}");

      expect(handleChange).toHaveBeenCalledWith("purchase");
    });
  });

  describe("Modal — focus is trapped inside the dialog when open", () => {
    it("pressing Tab inside a modal does not move focus to elements outside the dialog, preventing background interaction", async () => {
      render(
        <div>
          <button>Outside button — must not receive focus while modal is open</button>
          <Modal open={true} onClose={vi.fn()} title="Confirm Action">
            <button>Inside button</button>
          </Modal>
        </div>
      );

      const insideButton = screen.getByRole("button", { name: "Inside button" });
      insideButton.focus();

      // Tab should cycle within the modal, not escape to the outside button.
      await userEvent.tab();

      const outsideButton = screen.getByRole("button", {
        name: "Outside button — must not receive focus while modal is open",
      });
      expect(outsideButton).not.toHaveFocus();
    });
  });

  describe("SearchInput — clear button is keyboard operable", () => {
    it("clear button can be reached by Tab and activated by Enter/Space so keyboard users can reset the search", async () => {
      const handleChange = vi.fn();
      render(<SearchInput value="test query" onChange={handleChange} />);

      // Tab to the input first, then to the clear button.
      await userEvent.tab(); // Focus input
      await userEvent.tab(); // Focus clear button

      expect(
        screen.getByRole("button", { name: "Clear search" })
      ).toHaveFocus();

      await userEvent.keyboard("{Enter}");
      expect(handleChange).toHaveBeenCalledWith("");
    });
  });
});

// ─── axe-core full audits of composed surfaces ────────────────────────────────

describe("ACCESSIBILITY — axe-core WCAG 2.1 AA audits of composed UI surfaces", () => {
  it("SearchInput in its idle state (no query) has no violations", async () => {
    const { container } = render(
      <SearchInput value="" onChange={vi.fn()} placeholder="Search invoices…" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SearchInput in its active state (with query and clear button) has no violations", async () => {
    const { container } = render(
      <SearchInput value="Ramesh Traders" onChange={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("PillTabs with badge counts has no violations — badge elements must not introduce role or contrast problems", async () => {
    const { container } = render(
      <PillTabs
        tabs={[
          { value: "unpaid", label: "Unpaid", count: 8 },
          { value: "paid", label: "Paid", count: 32 },
          { value: "draft", label: "Draft", count: 0 },
        ]}
        value="unpaid"
        onChange={vi.fn()}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("EmptyState with all content layers has no violations — encouragement italic text must still meet contrast", async () => {
    const { container } = render(
      <EmptyState
        icon={<svg aria-hidden="true"><rect width="24" height="24" /></svg>}
        title="No expenses this month"
        description="Record business expenses to track your costs and generate accurate P&L reports."
        encouragement="Good financial hygiene starts with every receipt."
        action={<button type="button">Add Expense</button>}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Modal with a form inside has no violations — labels must be associated and the dialog container must be correct", async () => {
    const { container } = render(
      <Modal open={true} onClose={vi.fn()} title="Record Payment">
        <form aria-label="Record payment form">
          <label htmlFor="payment-amount">Amount (₹)</label>
          <input id="payment-amount" type="number" defaultValue={25000} />
          <label htmlFor="payment-mode">Payment mode</label>
          <select id="payment-mode" defaultValue="upi">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="neft">NEFT/RTGS</option>
          </select>
        </form>
      </Modal>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SlideOver with a realistic party-creation form has no violations", async () => {
    const { container } = render(
      <SlideOver
        open={true}
        onClose={vi.fn()}
        title="Add Party"
        description="Add a customer or supplier to your party list."
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button">Cancel</button>
            <button type="button">Save Party</button>
          </div>
        }
      >
        <form aria-label="Add party form">
          <div>
            <label htmlFor="party-name">Party name *</label>
            <input id="party-name" type="text" required />
          </div>
          <div>
            <label htmlFor="party-phone">Phone</label>
            <input id="party-phone" type="tel" />
          </div>
          <div>
            <label htmlFor="party-gstin">GSTIN</label>
            <input id="party-gstin" type="text" placeholder="22AAAAA0000A1Z5" />
          </div>
          <div>
            <label htmlFor="party-state">State</label>
            <select id="party-state">
              <option value="">Select state…</option>
              <option value="MH">Maharashtra</option>
              <option value="KA">Karnataka</option>
              <option value="TN">Tamil Nadu</option>
            </select>
          </div>
        </form>
      </SlideOver>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  describe("all StatusBadge variants pass axe-core (colour contrast matters for status communication)", () => {
    const statuses = [
      "paid",
      "sent",
      "draft",
      "partial",
      "overdue",
      "cancelled",
      "unfulfilled",
    ] as const;

    for (const status of statuses) {
      it(`StatusBadge status="${status}" has no WCAG 2.1 AA violations`, async () => {
        const { container } = render(<StatusBadge status={status} />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
      });
    }
  });
});
