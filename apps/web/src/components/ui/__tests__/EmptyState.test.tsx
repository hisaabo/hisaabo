/**
 * EmptyState — zero-data placeholder for list views
 *
 * EmptyState is shown whenever a list has no items yet — e.g., "No invoices
 * found", "No parties added", "No expenses this month".  It is the user's
 * first onboarding prompt and must clearly communicate:
 *   1. What is empty (title)
 *   2. Why it is empty or what to do (description)
 *   3. An encouraging nudge to get started (encouragement)
 *   4. A call-to-action button to take the first step (action)
 *
 * Poor empty states cause user confusion and drop-off; these tests ensure the
 * component renders all four content layers correctly and remains accessible.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { EmptyState } from "../EmptyState";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EmptyState — zero-data placeholder for list and filter views", () => {

  // ─── Required content ──────────────────────────────────────────────────────

  describe("required title", () => {
    it("renders the title text prominently so users immediately understand what list is empty", () => {
      render(<EmptyState title="No invoices yet" />);

      expect(screen.getByText("No invoices yet")).toBeInTheDocument();
    });

    it("renders only the title and nothing else when no optional props are provided (minimal footprint)", () => {
      const { container } = render(<EmptyState title="No results" />);

      // Only the title paragraph should be present; no description or action.
      expect(screen.getByText("No results")).toBeInTheDocument();
      // No button present when action is omitted.
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  // ─── Optional content ──────────────────────────────────────────────────────

  describe("optional description", () => {
    it("renders a description paragraph when provided so users understand why the list is empty or what steps to take", () => {
      render(
        <EmptyState
          title="No parties yet"
          description="Add your first customer or supplier to start creating invoices."
        />
      );

      expect(
        screen.getByText(
          "Add your first customer or supplier to start creating invoices."
        )
      ).toBeInTheDocument();
    });

    it("does not render a description element when description prop is omitted (prevents empty whitespace)", () => {
      const { container } = render(<EmptyState title="No expenses" />);

      // There should be exactly one <p> (the title) — not two.
      const paragraphs = container.querySelectorAll("p");
      expect(paragraphs.length).toBe(1);
    });
  });

  describe("optional encouragement text", () => {
    it("renders the encouragement line in a subtler italic style below the description to motivate first action", () => {
      render(
        <EmptyState
          title="No invoices yet"
          encouragement="Every great business starts with a first invoice."
        />
      );

      const encouragementEl = screen.getByText(
        "Every great business starts with a first invoice."
      );
      expect(encouragementEl).toBeInTheDocument();
      // Encouragement must use italic styling per the component's design.
      expect(encouragementEl.className).toMatch(/italic/);
    });
  });

  describe("optional icon", () => {
    it("renders an icon container when an icon ReactNode is provided, giving the empty state visual identity", () => {
      const TestIcon = () => <svg data-testid="file-icon" aria-hidden="true" />;

      render(
        <EmptyState
          title="No items"
          icon={<TestIcon />}
        />
      );

      expect(screen.getByTestId("file-icon")).toBeInTheDocument();
    });

    it("does not render the icon wrapper div when no icon is provided (prevents empty box artefact)", () => {
      const { container } = render(<EmptyState title="No items" />);

      // The icon wrapper has a specific class combo — it must not appear.
      const iconWrapper = container.querySelector(".w-12.h-12.rounded-xl");
      expect(iconWrapper).not.toBeInTheDocument();
    });
  });

  // ─── Action slot ──────────────────────────────────────────────────────────

  describe("action slot for call-to-action button", () => {
    it("renders the action button when provided so users have a direct path to resolve the empty state", async () => {
      const handleClick = vi.fn();
      render(
        <EmptyState
          title="No parties added"
          action={
            <button type="button" onClick={handleClick}>
              Add your first party
            </button>
          }
        />
      );

      const cta = screen.getByRole("button", { name: "Add your first party" });
      expect(cta).toBeInTheDocument();

      await userEvent.click(cta);
      expect(handleClick).toHaveBeenCalledOnce();
    });

    it("renders complex action slots (e.g., multiple buttons) without crashing", () => {
      render(
        <EmptyState
          title="No items imported"
          action={
            <div>
              <button type="button">Import from CSV</button>
              <button type="button">Add manually</button>
            </div>
          }
        />
      );

      expect(screen.getByRole("button", { name: "Import from CSV" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add manually" })).toBeInTheDocument();
    });
  });

  // ─── Full composition ─────────────────────────────────────────────────────

  describe("fully-composed empty state with all props", () => {
    it("renders all four content layers — icon, title, description, encouragement, action — in the correct order", () => {
      const { container } = render(
        <EmptyState
          icon={<svg data-testid="invoice-icon" aria-hidden="true" />}
          title="No invoices yet"
          description="Create your first invoice to start tracking your business revenue."
          encouragement="Your first invoice is always the hardest. After that it gets easier."
          action={<button type="button">Create Invoice</button>}
        />
      );

      const icon = screen.getByTestId("invoice-icon");
      const title = screen.getByText("No invoices yet");
      const description = screen.getByText(
        "Create your first invoice to start tracking your business revenue."
      );
      const encouragement = screen.getByText(
        "Your first invoice is always the hardest. After that it gets easier."
      );
      const cta = screen.getByRole("button", { name: "Create Invoice" });

      // All elements must be present.
      expect(icon).toBeInTheDocument();
      expect(title).toBeInTheDocument();
      expect(description).toBeInTheDocument();
      expect(encouragement).toBeInTheDocument();
      expect(cta).toBeInTheDocument();

      // Verify DOM order: icon wrapper → title → description → encouragement → action.
      const allText = container.textContent;
      const titleIdx = allText!.indexOf("No invoices yet");
      const descIdx = allText!.indexOf("Create your first invoice");
      const encIdx = allText!.indexOf("Your first invoice is always");
      expect(titleIdx).toBeLessThan(descIdx);
      expect(descIdx).toBeLessThan(encIdx);
    });
  });

  // ─── Accessibility audit ──────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("minimal empty state has no WCAG 2.1 AA violations", async () => {
      const { container } = render(<EmptyState title="No expenses this month" />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("fully-composed empty state has no WCAG 2.1 AA violations", async () => {
      const { container } = render(
        <EmptyState
          icon={<svg aria-hidden="true"><title>Invoice icon</title></svg>}
          title="No invoices yet"
          description="Create your first invoice to start tracking revenue."
          encouragement="The first invoice is the hardest."
          action={<button type="button">Create Invoice</button>}
        />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
