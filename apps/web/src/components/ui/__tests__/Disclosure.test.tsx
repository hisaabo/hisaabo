/**
 * Disclosure — collapsible section with accessible trigger
 *
 * Disclosure is used in Hisaabo's filter panels, invoice detail sidebars,
 * and settings forms to group related fields under a togglable heading.
 * Users need to be able to collapse sections they don't need, reducing
 * cognitive load when working with dense forms.
 *
 * These tests verify:
 *   1. The label text is always visible so users know what section they are
 *      expanding before they commit to opening it.
 *   2. Content is hidden by default (defaultOpen=false) so pages don't load
 *      with every section expanded, which would overwhelm the user.
 *   3. Providing defaultOpen=true shows content immediately for sections that
 *      are commonly needed without an extra click.
 *   4. Clicking the trigger toggles visibility so users can open and close
 *      sections at will.
 *   5. aria-expanded reflects the open state so screen readers announce
 *      "expanded" or "collapsed" when the trigger is focused.
 *   6. aria-controls points to the content region's id so the relationship
 *      between trigger and panel is machine-readable.
 *   7. Enter and Space keys toggle the panel — keyboard users expect both
 *      keys to activate button-like controls per the ARIA APG pattern.
 *   8. The count badge appears only when count > 0, communicating how many
 *      fields in the section have been filled without requiring it to be opened.
 *   9. No WCAG 2.1 AA violations via axe-core.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Disclosure } from "../Disclosure";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders a Disclosure with a single paragraph child so we can assert
 * whether the content region is visible.  Tests override only the props
 * they care about.
 */
function renderDisclosure(
  props: Partial<React.ComponentProps<typeof Disclosure>> = {}
) {
  const defaults: React.ComponentProps<typeof Disclosure> = {
    label: "GST Details",
    children: <p>Content inside the disclosure panel</p>,
  };
  return render(<Disclosure {...defaults} {...props} />);
}

/**
 * Returns the trigger button for the rendered Disclosure.
 * The button has no accessible name beyond its text content, so we find
 * it by role and its visible label text.
 */
function getTrigger(label = "GST Details") {
  return screen.getByRole("button", { name: new RegExp(label, "i") });
}

// ─── Label rendering ──────────────────────────────────────────────────────────

describe("Disclosure — collapsible section with accessible trigger", () => {
  describe("label rendering", () => {
    it("renders the label text on the trigger button so users know what section they are expanding", () => {
      renderDisclosure({ label: "GST Details" });

      expect(screen.getByText("GST Details")).toBeInTheDocument();
    });

    it("renders an updated label when the label prop changes, keeping the trigger text current", () => {
      renderDisclosure({ label: "Party Filters" });

      expect(screen.getByText("Party Filters")).toBeInTheDocument();
    });
  });

  // ─── Default visibility ───────────────────────────────────────────────────

  describe("default visibility controlled by defaultOpen prop", () => {
    it("hides the content by default (defaultOpen=false) so pages load with sections collapsed", () => {
      renderDisclosure({ defaultOpen: false });

      // The panel uses CSS grid-template-rows to collapse — the content node
      // is in the DOM but the row height is 0fr (effectively invisible).
      // We assert via the region's inline style.
      const region = screen.getByRole("region");
      expect(region).toHaveStyle({ gridTemplateRows: "0fr" });
    });

    it("shows content immediately when defaultOpen=true for sections that are commonly needed", () => {
      renderDisclosure({ defaultOpen: true });

      const region = screen.getByRole("region");
      expect(region).toHaveStyle({ gridTemplateRows: "1fr" });
    });
  });

  // ─── Toggle interaction ───────────────────────────────────────────────────

  describe("click toggle interaction", () => {
    it("expands the content region when the trigger is clicked while closed", async () => {
      renderDisclosure({ defaultOpen: false, label: "GST Details" });

      await userEvent.click(getTrigger("GST Details"));

      const region = screen.getByRole("region");
      expect(region).toHaveStyle({ gridTemplateRows: "1fr" });
    });

    it("collapses the content region when the trigger is clicked while open", async () => {
      renderDisclosure({ defaultOpen: true, label: "GST Details" });

      await userEvent.click(getTrigger("GST Details"));

      const region = screen.getByRole("region");
      expect(region).toHaveStyle({ gridTemplateRows: "0fr" });
    });

    it("toggles open then closed with two successive clicks, returning to the initial collapsed state", async () => {
      renderDisclosure({ defaultOpen: false, label: "GST Details" });

      const trigger = getTrigger("GST Details");
      await userEvent.click(trigger);
      await userEvent.click(trigger);

      const region = screen.getByRole("region");
      expect(region).toHaveStyle({ gridTemplateRows: "0fr" });
    });
  });

  // ─── ARIA attributes ──────────────────────────────────────────────────────

  describe("ARIA attributes — machine-readable open state for assistive technologies", () => {
    it("trigger has aria-expanded='false' when the panel is closed so screen readers announce 'collapsed'", () => {
      renderDisclosure({ defaultOpen: false, label: "GST Details" });

      expect(getTrigger("GST Details")).toHaveAttribute("aria-expanded", "false");
    });

    it("trigger has aria-expanded='true' when the panel is open so screen readers announce 'expanded'", () => {
      renderDisclosure({ defaultOpen: true, label: "GST Details" });

      expect(getTrigger("GST Details")).toHaveAttribute("aria-expanded", "true");
    });

    it("aria-expanded updates to 'true' after the user opens the section by clicking", async () => {
      renderDisclosure({ defaultOpen: false, label: "GST Details" });

      await userEvent.click(getTrigger("GST Details"));

      expect(getTrigger("GST Details")).toHaveAttribute("aria-expanded", "true");
    });

    it("aria-expanded updates to 'false' after the user closes the section by clicking", async () => {
      renderDisclosure({ defaultOpen: true, label: "GST Details" });

      await userEvent.click(getTrigger("GST Details"));

      expect(getTrigger("GST Details")).toHaveAttribute("aria-expanded", "false");
    });

    it("trigger's aria-controls matches the content region's id, establishing the programmatic relationship", () => {
      renderDisclosure({ label: "GST Details" });

      const trigger = getTrigger("GST Details");
      const region = screen.getByRole("region");

      // The trigger's aria-controls must point to the region's id.
      expect(trigger).toHaveAttribute("aria-controls", region.id);
      expect(region.id).toBeTruthy();
    });
  });

  // ─── Keyboard interactions ────────────────────────────────────────────────

  describe("keyboard interactions — Enter and Space must activate the trigger per ARIA APG", () => {
    it("pressing Enter on the trigger opens a closed panel, matching the expected button keyboard behavior", async () => {
      renderDisclosure({ defaultOpen: false, label: "GST Details" });

      getTrigger("GST Details").focus();
      await userEvent.keyboard("{Enter}");

      expect(screen.getByRole("region")).toHaveStyle({
        gridTemplateRows: "1fr",
      });
    });

    it("pressing Space on the trigger opens a closed panel, because both Enter and Space activate buttons", async () => {
      renderDisclosure({ defaultOpen: false, label: "GST Details" });

      getTrigger("GST Details").focus();
      await userEvent.keyboard(" ");

      expect(screen.getByRole("region")).toHaveStyle({
        gridTemplateRows: "1fr",
      });
    });

    it("pressing Enter on the trigger closes an open panel", async () => {
      renderDisclosure({ defaultOpen: true, label: "GST Details" });

      getTrigger("GST Details").focus();
      await userEvent.keyboard("{Enter}");

      expect(screen.getByRole("region")).toHaveStyle({
        gridTemplateRows: "0fr",
      });
    });

    it("pressing Space on the trigger closes an open panel", async () => {
      renderDisclosure({ defaultOpen: true, label: "GST Details" });

      getTrigger("GST Details").focus();
      await userEvent.keyboard(" ");

      expect(screen.getByRole("region")).toHaveStyle({
        gridTemplateRows: "0fr",
      });
    });
  });

  // ─── Count badge ──────────────────────────────────────────────────────────

  describe("count badge — communicates filled fields without requiring the section to be opened", () => {
    it("renders the count badge when count is greater than zero, showing the user has filled some fields", () => {
      renderDisclosure({ label: "GST Details", count: 3 });

      expect(screen.getByText("3 filled")).toBeInTheDocument();
    });

    it("does not render the count badge when count is zero", () => {
      renderDisclosure({ label: "GST Details", count: 0 });

      expect(screen.queryByText(/filled/i)).not.toBeInTheDocument();
    });

    it("does not render the count badge when count prop is omitted", () => {
      renderDisclosure({ label: "GST Details" });

      expect(screen.queryByText(/filled/i)).not.toBeInTheDocument();
    });

    it("renders the correct number in the count badge, e.g. '5 filled' for count=5", () => {
      renderDisclosure({ label: "Line Items", count: 5 });

      expect(screen.getByText("5 filled")).toBeInTheDocument();
    });

    it("renders the filled indicator dot alongside the count badge when count > 0", () => {
      const { container } = renderDisclosure({ label: "GST Details", count: 2 });

      // The indicator dot is a span with aria-hidden="true" and the brand-500 bg class.
      const dot = container.querySelector(
        "span[aria-hidden='true'].bg-brand-500"
      );
      expect(dot).toBeInTheDocument();
    });

    it("does not render the filled indicator dot when count is 0 or omitted", () => {
      const { container } = renderDisclosure({ label: "GST Details", count: 0 });

      const dot = container.querySelector("span[aria-hidden='true'].bg-brand-500");
      expect(dot).not.toBeInTheDocument();
    });
  });

  // ─── Icon slot ────────────────────────────────────────────────────────────

  describe("icon slot — optional leading icon in the trigger", () => {
    it("renders the icon node when the icon prop is provided", () => {
      renderDisclosure({
        label: "Party Details",
        icon: <svg data-testid="party-icon" aria-hidden="true" />,
      });

      expect(screen.getByTestId("party-icon")).toBeInTheDocument();
    });

    it("does not render an icon wrapper when the icon prop is omitted", () => {
      const { container } = renderDisclosure({ label: "GST Details" });

      // When no icon is provided the icon span must not exist.
      expect(container.querySelector("[data-testid]")).not.toBeInTheDocument();
    });
  });

  // ─── Accessibility audit ──────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations when closed with no count (default state)", async () => {
      const { container } = renderDisclosure({
        label: "GST Details",
        children: (
          <form>
            <label htmlFor="gstin-field">GSTIN</label>
            <input id="gstin-field" type="text" />
          </form>
        ),
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no WCAG 2.1 AA violations when open with a count badge", async () => {
      const { container } = renderDisclosure({
        label: "Line Items",
        defaultOpen: true,
        count: 4,
        children: (
          <ul>
            <li>Item 1 — Laptop x2</li>
            <li>Item 2 — Printer x1</li>
          </ul>
        ),
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
