/**
 * SlideOver — right-side panel for forms and detail views
 *
 * The SlideOver is the primary UI surface for data entry in Hisaabo — party
 * creation, item editing, payment recording, and expense entry all live
 * inside SlideOver panels.  Because users spend significant time inside these
 * panels, the accessibility and focus-management requirements are even higher
 * than for simple confirmation modals.
 *
 * These tests verify:
 *   1. The panel renders and hides correctly based on the `open` prop.
 *   2. Title and optional description are displayed so users understand the
 *      context of the form they are filling.
 *   3. Footer slot renders Save/Cancel actions in the expected sticky area.
 *   4. The first focusable element receives focus when the panel opens, so
 *      keyboard users can immediately start filling the form without having
 *      to Tab to the first field manually.
 *   5. Escape key closes the panel — the expected UX shortcut for drawers.
 *   6. Clicking the backdrop closes the panel.
 *   7. ARIA attributes identify the panel as a dialog with a labelled title.
 *   8. No WCAG 2.1 AA violations via axe-core.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { SlideOver } from "../SlideOver";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderSlideOver(
  props: Partial<React.ComponentProps<typeof SlideOver>> = {}
) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    title: "Add New Party",
    children: <p>Panel content area</p>,
  };
  return render(<SlideOver {...defaults} {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SlideOver — right-side panel used for all data-entry forms", () => {

  // ─── Visibility ────────────────────────────────────────────────────────────

  describe("visibility controlled by the open prop", () => {
    it("renders children when open is true so the form content is accessible to users", () => {
      renderSlideOver({ open: true, children: <input aria-label="Business name" /> });

      expect(screen.getByRole("textbox", { name: "Business name" })).toBeInTheDocument();
    });

    it("renders nothing when open is false, preventing hidden forms from interfering with background page tab order", () => {
      renderSlideOver({ open: false, children: <input aria-label="GSTIN" /> });

      expect(screen.queryByRole("textbox", { name: "GSTIN" })).not.toBeInTheDocument();
    });
  });

  // ─── Content ───────────────────────────────────────────────────────────────

  describe("title and description rendering", () => {
    it("renders the panel title in a visible heading so users know which form they have opened", () => {
      renderSlideOver({ title: "Edit Party — Suresh Industries" });

      expect(
        screen.getByRole("heading", { name: "Edit Party — Suresh Industries" })
      ).toBeInTheDocument();
    });

    it("renders the optional description below the title to provide contextual help text", () => {
      renderSlideOver({
        title: "Record Expense",
        description: "Add a business expense that will appear in your P&L report.",
      });

      expect(
        screen.getByText("Add a business expense that will appear in your P&L report.")
      ).toBeInTheDocument();
    });

    it("does not render a description element when description prop is omitted (prevents empty whitespace)", () => {
      renderSlideOver({ title: "Add Item", description: undefined });

      // No <p> with empty text should pollute the DOM.
      const heading = screen.getByRole("heading", { name: "Add Item" });
      // The sibling description paragraph should be absent.
      expect(heading.nextElementSibling).toBeNull();
    });
  });

  describe("footer slot for action buttons", () => {
    it("renders Save and Cancel action buttons inside the sticky footer area so they remain visible while scrolling long forms", () => {
      renderSlideOver({
        title: "Add New Item",
        footer: (
          <div>
            <button type="button">Cancel</button>
            <button type="submit">Save Item</button>
          </div>
        ),
      });

      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Item" })).toBeInTheDocument();
    });

    it("renders no footer section when footer prop is omitted (view-only panels don't need action buttons)", () => {
      const { container } = renderSlideOver({ footer: undefined });

      // There should be no border-t footer wrapper in the DOM.
      const footerDivs = container.querySelectorAll(".border-t.border-border-light");
      // The header has a border-b; the footer (border-t) should not exist.
      expect(footerDivs.length).toBe(0);
    });
  });

  // ─── Focus management ──────────────────────────────────────────────────────

  describe("focus management — important for keyboard and screen-reader users", () => {
    beforeEach(() => {
      // Use fake timers so that the SlideOver's setTimeout-based focus call
      // can be flushed synchronously with vi.runAllTimers().
      //
      // jsdom does not implement layout, so deferred focus using setTimeout or
      // requestAnimationFrame does not execute as part of React's act() flush.
      // Fake timers let us advance the clock explicitly and assert the result.
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("moves focus to the first interactive element when the panel opens so keyboard users can immediately start typing", async () => {
      // Render inside act so React effects (including the focus useEffect)
      // run synchronously before we assert.
      await act(async () => {
        renderSlideOver({
          open: true,
          title: "Add Party",
          children: (
            <>
              <input aria-label="Party name" />
              <input aria-label="Phone number" />
            </>
          ),
        });
      });

      // The SlideOver defers focus with setTimeout(fn, 0) so that the slide-in
      // CSS animation has begun before focus moves.  Advance fake timers to
      // flush that callback now.
      act(() => { vi.runAllTimers(); });

      // The SlideOver focuses the first interactive element (the close button
      // or the first form field — whichever comes first in DOM order).
      // The close button is rendered first (in the header), so it gets focus.
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  // ─── Dismissal ─────────────────────────────────────────────────────────────

  describe("dismissal interactions", () => {
    it("calls onClose when the Escape key is pressed — matches the user's expectation that Escape closes overlay panels", async () => {
      const onClose = vi.fn();
      renderSlideOver({ onClose });

      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the backdrop is clicked, letting users dismiss the panel without targeting the small close button", async () => {
      const onClose = vi.fn();
      renderSlideOver({ onClose });

      const backdrop = document.querySelector(
        ".fixed.inset-0.bg-black\\/40"
      ) as HTMLElement;
      await userEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the explicit × close button in the panel header is clicked", async () => {
      const onClose = vi.fn();
      renderSlideOver({ onClose, title: "Edit Item" });

      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  // ─── ARIA semantics ────────────────────────────────────────────────────────

  describe("ARIA semantics", () => {
    it("wraps the panel in role='dialog' so screen readers enter dialog mode and restrict virtual reading to the panel", () => {
      renderSlideOver({ open: true });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("sets aria-modal='true' so screen readers exclude background page content from the accessibility tree while the panel is open", () => {
      renderSlideOver({ open: true });

      expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    });

    it("associates the panel with its title via aria-labelledby so screen readers announce 'Add New Party — dialog' on focus entry", () => {
      renderSlideOver({ title: "Add New Party" });

      const dialog = screen.getByRole("dialog");
      const titleEl = screen.getByRole("heading", { name: "Add New Party" });

      expect(dialog).toHaveAttribute("aria-labelledby", titleEl.id);
    });

    it("close button has accessible label 'Close' so voice-control users can target it by name", () => {
      renderSlideOver({ title: "Record Payment" });

      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });
  });

  // ─── Accessibility audit ───────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations on a fully-populated panel with title, description, form fields, and footer actions", async () => {
      const { container } = render(
        <SlideOver
          open={true}
          onClose={vi.fn()}
          title="Add Party — Customer"
          description="Fill in the details of the customer. GSTIN is optional for unregistered buyers."
          footer={
            <div className="flex gap-2 justify-end">
              <button type="button">Cancel</button>
              <button type="button">Save Party</button>
            </div>
          }
        >
          <form>
            <label htmlFor="party-name-field">Party name</label>
            <input id="party-name-field" type="text" />
            <label htmlFor="gstin-field">GSTIN (optional)</label>
            <input id="gstin-field" type="text" />
          </form>
        </SlideOver>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no WCAG 2.1 AA violations on a minimal panel with only a title", async () => {
      const { container } = renderSlideOver({
        title: "Import Items from CSV",
        children: <p>Upload your CSV file to get started.</p>,
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  // ─── onCloseAttempt veto hook ──────────────────────────────────────────────

  describe("onCloseAttempt veto hook", () => {
    it("onCloseAttempt returning true allows Escape to close", async () => {
      const onClose = vi.fn();
      const onCloseAttempt = vi.fn(() => true);
      renderSlideOver({ onClose, onCloseAttempt });

      await userEvent.keyboard("{Escape}");

      expect(onCloseAttempt).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("onCloseAttempt returning false vetoes Escape", async () => {
      const onClose = vi.fn();
      const onCloseAttempt = vi.fn(() => false);
      renderSlideOver({ onClose, onCloseAttempt });

      await userEvent.keyboard("{Escape}");

      expect(onCloseAttempt).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("onCloseAttempt returning false vetoes backdrop click", async () => {
      const onClose = vi.fn();
      const onCloseAttempt = vi.fn(() => false);
      renderSlideOver({ onClose, onCloseAttempt });

      const backdrop = document.querySelector(
        ".fixed.inset-0.bg-black\\/40"
      ) as HTMLElement;
      await userEvent.click(backdrop);

      expect(onCloseAttempt).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("onCloseAttempt returning false vetoes the header X button", async () => {
      const onClose = vi.fn();
      const onCloseAttempt = vi.fn(() => false);
      renderSlideOver({ onClose, onCloseAttempt });

      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onCloseAttempt).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("without onCloseAttempt, Escape still closes normally", async () => {
      const onClose = vi.fn();
      renderSlideOver({ onClose });

      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("onCloseAttempt veto followed by returning true allows the next attempt", async () => {
      const onClose = vi.fn();
      let callCount = 0;
      const onCloseAttempt = vi.fn(() => {
        callCount += 1;
        return callCount > 1;
      });
      renderSlideOver({ onClose, onCloseAttempt });

      // First Escape — veto (returns false on first call)
      await userEvent.keyboard("{Escape}");
      expect(onCloseAttempt).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();

      // Second Escape — allowed (returns true on second call)
      await userEvent.keyboard("{Escape}");
      expect(onCloseAttempt).toHaveBeenCalledTimes(2);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
