/**
 * Modal — dialog overlay component
 *
 * The Modal is used throughout Hisaabo for confirmations, quick-entry forms,
 * and detail views that don't warrant a full page navigation.  Accessibility
 * correctness is critical here: a poorly implemented modal will leave
 * keyboard-only and screen-reader users unable to dismiss it or interact
 * with its content.
 *
 * These tests verify:
 *   1. Content visibility is toggled exclusively by the `open` prop — no
 *      hidden-but-interactive traps.
 *   2. Clicking the backdrop closes the modal so users who missed the close
 *      button can still dismiss it.
 *   3. Pressing Escape closes the modal — the universally expected keyboard
 *      shortcut for dismissing overlays per ARIA Authoring Practices Guide.
 *   4. Focus is trapped within the modal while it is open, preventing the
 *      confusion of keyboard focus escaping to background content.
 *   5. The dialog has the required ARIA attributes (`role="dialog"`,
 *      `aria-modal="true"`) so assistive technologies announce it correctly.
 *   6. When a title is provided it is associated via `aria-labelledby` so
 *      screen readers announce the dialog's purpose on focus entry.
 *   7. The close button has an accessible label so it can be activated by
 *      voice control and screen readers.
 *   8. No WCAG 2.1 AA violations via axe-core.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Modal } from "../Modal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders a Modal in jsdom. The Modal uses createPortal to render into
 * document.body, so we pass document.body as the query root where needed.
 */
function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    children: <p>Modal body content</p>,
  };
  return render(<Modal {...defaults} {...props} />);
}

// ─── Visibility ───────────────────────────────────────────────────────────────

describe("Modal — dialog overlay component", () => {
  describe("visibility controlled by the open prop", () => {
    it("renders children when open is true so users can interact with the dialog content", () => {
      renderModal({ open: true, children: <p>Payment recorded successfully</p> });

      expect(screen.getByText("Payment recorded successfully")).toBeInTheDocument();
    });

    it("renders nothing when open is false, ensuring no background DOM clutter or tab-order interference", () => {
      renderModal({ open: false, children: <p>Should not appear</p> });

      expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
    });

    it("renders the title in a visible heading element when title prop is provided", () => {
      renderModal({ open: true, title: "Delete Invoice INV-0042" });

      // The heading must be present so users know the context of the dialog.
      expect(
        screen.getByRole("heading", { name: "Delete Invoice INV-0042" })
      ).toBeInTheDocument();
    });

    it("does not render a heading element when no title is provided (title is optional for content-only dialogs)", () => {
      renderModal({ open: true });

      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });
  });

  // ─── Dismissal ───────────────────────────────────────────────────────────────

  describe("dismissal interactions", () => {
    it("calls onClose when the backdrop (semi-transparent overlay behind the dialog) is clicked, giving users an easy escape", async () => {
      const onClose = vi.fn();
      renderModal({ onClose });

      // The backdrop is the fixed full-screen div that sits behind the dialog
      // panel. It is identified by its black/40 opacity class.
      const backdrop = document
        .querySelector(".fixed.inset-0.bg-black\\/40") as HTMLElement;
      await userEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the Escape key is pressed — the standard keyboard shortcut to close dialogs per ARIA APG", async () => {
      const onClose = vi.fn();
      renderModal({ onClose });

      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the explicit close (×) button is clicked", async () => {
      const onClose = vi.fn();
      renderModal({ onClose, title: "Record Payment" });

      await userEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does NOT propagate clicks inside the dialog panel to the backdrop, preventing accidental dismissal while interacting with content", async () => {
      const onClose = vi.fn();
      renderModal({
        onClose,
        children: <button>Pay ₹15,000</button>,
      });

      // Click on a button inside the modal — this must not trigger onClose.
      await userEvent.click(screen.getByRole("button", { name: "Pay ₹15,000" }));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ─── Focus management ────────────────────────────────────────────────────────

  describe("focus trapping — keeps keyboard focus inside the dialog to prevent background interaction", () => {
    it("traps Tab focus so pressing Tab from the last focusable element wraps back to the first", async () => {
      renderModal({
        title: "Confirm Delete",
        children: (
          <>
            <p>Delete party Ramesh Traders? This action cannot be undone.</p>
            <button>Cancel</button>
            <button>Delete</button>
          </>
        ),
      });

      // Focus the close button (first focusable element in the modal).
      const closeButton = screen.getByRole("button", { name: "Close" });
      closeButton.focus();

      // Tab through all focusable elements: Close → Cancel → Delete.
      await userEvent.tab();
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

      await userEvent.tab();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

      // One more Tab from the last element must wrap back to the first.
      await userEvent.tab();
      expect(closeButton).toHaveFocus();
    });

    it("traps Shift+Tab focus so pressing Shift+Tab from the first element wraps to the last", async () => {
      renderModal({
        title: "Edit Party",
        children: (
          <>
            <input aria-label="Party name" />
            <button>Save</button>
          </>
        ),
      });

      const closeButton = screen.getByRole("button", { name: "Close" });
      closeButton.focus();

      // Shift+Tab from the first focusable element must wrap to the last.
      await userEvent.tab({ shift: true });
      expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    });
  });

  // ─── ARIA semantics ──────────────────────────────────────────────────────────

  describe("ARIA semantics — required for correct screen-reader announcement", () => {
    it("has role='dialog' so assistive technologies enter dialog mode and announce it to the user", () => {
      renderModal({ open: true });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("has aria-modal='true' so screen readers hide the background content from the accessibility tree", () => {
      renderModal({ open: true });

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("associates the dialog title with aria-labelledby so screen readers announce the dialog purpose on entry", () => {
      renderModal({ open: true, title: "Add New Item" });

      const dialog = screen.getByRole("dialog");
      const titleHeading = screen.getByRole("heading", { name: "Add New Item" });

      // The dialog must reference the heading's id.
      expect(dialog).toHaveAttribute("aria-labelledby", titleHeading.id);
    });

    it("close button has aria-label='Close' so voice-control users can say 'Click Close' to dismiss the dialog", () => {
      renderModal({ open: true, title: "GST Report" });

      expect(
        screen.getByRole("button", { name: "Close" })
      ).toBeInTheDocument();
    });
  });

  // ─── Accessibility audit ─────────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations when open with a title (axe-core full audit)", async () => {
      const { container } = renderModal({
        open: true,
        title: "Record Payment — Ramesh Traders",
        children: (
          <form>
            <label htmlFor="amount-field">Amount (₹)</label>
            <input id="amount-field" type="number" defaultValue={15000} />
          </form>
        ),
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no WCAG 2.1 AA violations when open without a title (content-only modals must also be accessible)", async () => {
      const { container } = renderModal({
        open: true,
        children: <p>Loading your invoice data…</p>,
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
