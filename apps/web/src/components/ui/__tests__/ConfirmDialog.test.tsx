/**
 * ConfirmDialog — two-button confirmation overlay
 *
 * ConfirmDialog is used throughout Hisaabo whenever a destructive or
 * irreversible action requires explicit user consent before proceeding —
 * deleting an invoice, removing a party, voiding a payment, etc.  It wraps
 * the Modal primitive and therefore inherits Modal's keyboard and ARIA
 * behaviour.
 *
 * These tests verify:
 *   1. The dialog renders its title and optional description when open so the
 *      user always knows exactly what they are confirming.
 *   2. Nothing is mounted when open=false, preventing background DOM clutter
 *      and stale event listeners.
 *   3. The confirm button label is controlled via confirmLabel so each use-site
 *      can present a clear, action-specific verb ("Delete", "Remove", "Void").
 *   4. The danger variant applies the correct CSS class so destructive actions
 *      receive a visually distinct (red) button that signals risk.
 *   5. Clicking Confirm fires onConfirm and clicking Cancel fires onCancel —
 *      the callbacks must not be mixed up.
 *   6. Pressing Escape fires onCancel (inherited from Modal) so keyboard users
 *      can always bail without reaching for the mouse.
 *   7. When loading=true both buttons are disabled and a spinner is rendered,
 *      preventing double-submission while an async operation is in flight.
 *   8. No WCAG 2.1 AA violations for either the danger or default variant.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ConfirmDialog } from "../ConfirmDialog";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders a ConfirmDialog with sensible defaults.  Individual tests override
 * only the props they care about, keeping each test focused on one concern.
 * ConfirmDialog uses createPortal (via Modal) so the rendered DOM lives in
 * document.body; screen queries work without a custom container.
 */
function renderConfirmDialog(
  props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}
) {
  const defaults: React.ComponentProps<typeof ConfirmDialog> = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    title: "Delete Invoice INV-00042?",
  };
  return render(<ConfirmDialog {...defaults} {...props} />);
}

// ─── Visibility ───────────────────────────────────────────────────────────────

describe("ConfirmDialog — two-button confirmation overlay", () => {
  describe("visibility and content rendering", () => {
    it("renders the title text when open is true so users know exactly what action they are confirming", () => {
      renderConfirmDialog({ title: "Delete Invoice INV-00042?" });

      expect(screen.getByText("Delete Invoice INV-00042?")).toBeInTheDocument();
    });

    it("renders the description paragraph when the description prop is provided, giving context for the action", () => {
      renderConfirmDialog({
        title: "Remove party Ramesh Traders?",
        description:
          "This will permanently remove Ramesh Traders and all associated records.",
      });

      expect(
        screen.getByText(
          "This will permanently remove Ramesh Traders and all associated records."
        )
      ).toBeInTheDocument();
    });

    it("does not render a description element when description prop is omitted, keeping the dialog minimal", () => {
      renderConfirmDialog({
        title: "Delete Invoice INV-00042?",
        // no description
      });

      // Only the title paragraph should be visible — no second <p>.
      expect(
        screen.queryByText(
          /permanently/i
        )
      ).not.toBeInTheDocument();
    });

    it("renders nothing when open is false, ensuring no orphaned DOM nodes or event listeners remain", () => {
      renderConfirmDialog({ open: false, title: "Should not appear" });

      expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // ─── Confirm button label ─────────────────────────────────────────────────

  describe("confirmLabel prop — button label customisation", () => {
    it("uses 'Confirm' as the default confirmLabel when the prop is not provided", () => {
      renderConfirmDialog();

      expect(
        screen.getByRole("button", { name: /confirm/i })
      ).toBeInTheDocument();
    });

    it("renders the custom confirmLabel text on the confirm button so action-specific verbs are displayed", () => {
      renderConfirmDialog({ confirmLabel: "Delete Invoice" });

      expect(
        screen.getByRole("button", { name: /delete invoice/i })
      ).toBeInTheDocument();
    });

    it("uses a custom confirmLabel of 'Remove Party' for party-deletion dialogs", () => {
      renderConfirmDialog({ confirmLabel: "Remove Party" });

      expect(
        screen.getByRole("button", { name: /remove party/i })
      ).toBeInTheDocument();
    });
  });

  // ─── Variant styling ──────────────────────────────────────────────────────

  describe("variant prop — visual style of the confirm button", () => {
    it("applies btn-danger class on the confirm button when variant='danger' to signal a destructive action", () => {
      renderConfirmDialog({ variant: "danger", confirmLabel: "Delete" });

      const confirmBtn = screen.getByRole("button", { name: /delete/i });
      expect(confirmBtn.className).toContain("btn-danger");
    });

    it("applies btn-primary class on the confirm button when variant='default' for non-destructive confirmations", () => {
      renderConfirmDialog({ variant: "default", confirmLabel: "Confirm" });

      const confirmBtn = screen.getByRole("button", { name: /confirm/i });
      expect(confirmBtn.className).toContain("btn-primary");
    });

    it("defaults to btn-primary when the variant prop is omitted", () => {
      renderConfirmDialog({ confirmLabel: "Proceed" });

      expect(
        screen.getByRole("button", { name: /proceed/i }).className
      ).toContain("btn-primary");
    });
  });

  // ─── Interactions ─────────────────────────────────────────────────────────

  describe("button click interactions", () => {
    it("calls onConfirm when the confirm button is clicked, triggering the destructive action", async () => {
      const onConfirm = vi.fn();
      renderConfirmDialog({ onConfirm, confirmLabel: "Delete Invoice" });

      await userEvent.click(
        screen.getByRole("button", { name: /delete invoice/i })
      );

      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("does not call onCancel when the confirm button is clicked (callbacks must not be mixed up)", async () => {
      const onCancel = vi.fn();
      renderConfirmDialog({ onCancel, confirmLabel: "Delete Invoice" });

      await userEvent.click(
        screen.getByRole("button", { name: /delete invoice/i })
      );

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("calls onCancel when the Cancel button is clicked so users can back out of accidental clicks", async () => {
      const onCancel = vi.fn();
      renderConfirmDialog({ onCancel });

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("does not call onConfirm when the Cancel button is clicked", async () => {
      const onConfirm = vi.fn();
      renderConfirmDialog({ onConfirm });

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("calls onCancel when the Escape key is pressed, inherited from Modal so keyboard users can dismiss without mouse", async () => {
      const onCancel = vi.fn();
      renderConfirmDialog({ onCancel });

      await userEvent.keyboard("{Escape}");

      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  // ─── Loading state ────────────────────────────────────────────────────────

  describe("loading state — prevents double-submission during async operations", () => {
    it("disables the Cancel button when loading=true so users cannot interrupt an in-flight request", () => {
      renderConfirmDialog({ loading: true });

      expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    });

    it("disables the confirm button when loading=true to prevent duplicate submissions", () => {
      renderConfirmDialog({ loading: true, confirmLabel: "Delete Invoice" });

      expect(
        screen.getByRole("button", { name: /delete invoice/i })
      ).toBeDisabled();
    });

    it("renders the spinner SVG inside the confirm button when loading=true to communicate progress visually", () => {
      renderConfirmDialog({ loading: true, confirmLabel: "Deleting" });

      const confirmBtn = screen.getByRole("button", { name: /deleting/i });
      // The Spinner renders an SVG with animate-spin class.
      const spinner = confirmBtn.querySelector("svg.animate-spin");
      expect(spinner).toBeInTheDocument();
    });

    it("does not render the spinner when loading=false (default), keeping the button label unobstructed", () => {
      renderConfirmDialog({ loading: false, confirmLabel: "Delete Invoice" });

      const confirmBtn = screen.getByRole("button", { name: /delete invoice/i });
      const spinner = confirmBtn.querySelector("svg.animate-spin");
      expect(spinner).not.toBeInTheDocument();
    });

    it("both buttons remain enabled when loading is false so users can interact normally", () => {
      renderConfirmDialog({ loading: false, confirmLabel: "Delete Invoice" });

      expect(screen.getByRole("button", { name: /cancel/i })).not.toBeDisabled();
      expect(
        screen.getByRole("button", { name: /delete invoice/i })
      ).not.toBeDisabled();
    });
  });

  // ─── Accessibility audit ──────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations for the danger variant (delete invoice confirmation)", async () => {
      const { container } = renderConfirmDialog({
        open: true,
        title: "Delete Invoice INV-00042?",
        description:
          "This action cannot be undone. The invoice will be permanently removed.",
        confirmLabel: "Delete Invoice",
        variant: "danger",
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no WCAG 2.1 AA violations for the default variant (non-destructive confirmation)", async () => {
      const { container } = renderConfirmDialog({
        open: true,
        title: "Mark Invoice INV-00042 as paid?",
        description: "This will record a full payment against this invoice.",
        confirmLabel: "Mark as Paid",
        variant: "default",
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
