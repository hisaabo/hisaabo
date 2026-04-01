/**
 * Pagination — prev/next navigation bar for paginated lists
 *
 * Pagination appears at the bottom of every paginated list in Hisaabo —
 * invoices, parties, items, expenses.  Correctness here directly impacts
 * usability: a disabled Prev button on page 1 prevents navigating to a
 * non-existent page 0; a disabled Next on the last page prevents an empty
 * results fetch.  The "Showing X-Y of Z" summary helps the user understand
 * where they are in the full dataset without having to count pages.
 *
 * These tests verify:
 *   1. The component renders null when totalPages <= 1 so single-page lists
 *      don't show unnecessary navigation chrome.
 *   2. The "Showing X-Y of Z" text is computed correctly from page, pageSize
 *      and total, including boundary conditions (last page with a partial
 *      page of results).
 *   3. The Prev button is disabled on page 1 to prevent navigating to page 0.
 *   4. The Next button is disabled on the last page to prevent overfetch.
 *   5. Clicking Prev calls onPageChange(page - 1), decrementing the page.
 *   6. Clicking Next calls onPageChange(page + 1), incrementing the page.
 *   7. The page indicator text shows "X / Y" so users always know their
 *      current position relative to the total page count.
 *   8. Neither button is disabled on a middle page, allowing free navigation.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "../Pagination";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders a Pagination component.  Defaults represent a common scenario:
 * 50 invoices, 20 per page (3 pages), currently on page 2.
 * Individual tests override only the props they need.
 */
function renderPagination(
  props: Partial<React.ComponentProps<typeof Pagination>> = {}
) {
  const defaults: React.ComponentProps<typeof Pagination> = {
    page: 2,
    totalPages: 3,
    total: 50,
    pageSize: 20,
    onPageChange: vi.fn(),
  };
  return render(<Pagination {...defaults} {...props} />);
}

// ─── Null rendering ───────────────────────────────────────────────────────────

describe("Pagination — prev/next navigation bar for paginated lists", () => {
  describe("null rendering when pagination is unnecessary", () => {
    it("returns null when totalPages is 1, avoiding navigation chrome for single-page results", () => {
      const { container } = renderPagination({
        page: 1,
        totalPages: 1,
        total: 8,
        pageSize: 20,
      });

      expect(container.firstChild).toBeNull();
    });

    it("returns null when totalPages is 0 (empty dataset), so empty lists show no pagination bar", () => {
      const { container } = renderPagination({
        page: 1,
        totalPages: 0,
        total: 0,
        pageSize: 20,
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders the component when totalPages is 2, since navigation is meaningful with more than one page", () => {
      renderPagination({ page: 1, totalPages: 2, total: 25, pageSize: 20 });

      // At least one of the nav buttons must be present.
      expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    });
  });

  // ─── Showing X-Y of Z text ────────────────────────────────────────────────

  describe("'Showing X-Y of Z' summary text", () => {
    it("shows the correct range for the first page: Showing 1-20 of 50", () => {
      renderPagination({ page: 1, totalPages: 3, total: 50, pageSize: 20 });

      // The component renders an en-dash (–) between start and end.
      expect(screen.getByText(/showing 1/i)).toBeInTheDocument();
      expect(screen.getByText(/of 50/i)).toBeInTheDocument();
    });

    it("shows the correct range for a middle page: Showing 21-40 of 50", () => {
      renderPagination({ page: 2, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByText(/21/)).toBeInTheDocument();
      expect(screen.getByText(/40/)).toBeInTheDocument();
    });

    it("caps the end value at total on the last partial page: Showing 41-50 of 50 (not 41-60)", () => {
      renderPagination({ page: 3, totalPages: 3, total: 50, pageSize: 20 });

      // The last page has only 10 items, so end should be 50, not 60.
      const summaryText = screen.getByText(/showing/i).textContent;
      expect(summaryText).toMatch(/41/);
      expect(summaryText).toMatch(/50/);
      // Ensure 60 does not appear — that would indicate Math.min was not applied.
      expect(summaryText).not.toMatch(/60/);
    });

    it("shows Showing 1-10 of 10 when all results fit on one page and totalPages is exactly 2 (edge case)", () => {
      // 15 items, pageSize 10: page 1 shows 1-10, page 2 shows 11-15.
      renderPagination({ page: 1, totalPages: 2, total: 15, pageSize: 10 });

      const summaryText = screen.getByText(/showing/i).textContent;
      expect(summaryText).toMatch(/1/);
      expect(summaryText).toMatch(/10/);
      expect(summaryText).toMatch(/15/);
    });
  });

  // ─── Prev button disabled state ───────────────────────────────────────────

  describe("Prev button disabled state", () => {
    it("disables the Prev button on page 1 to prevent navigating to a non-existent page 0", () => {
      renderPagination({ page: 1, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
    });

    it("enables the Prev button on page 2 so the user can navigate back to page 1", () => {
      renderPagination({ page: 2, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
    });

    it("enables the Prev button on the last page so the user can navigate backwards freely", () => {
      renderPagination({ page: 3, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
    });
  });

  // ─── Next button disabled state ───────────────────────────────────────────

  describe("Next button disabled state", () => {
    it("disables the Next button on the last page to prevent fetching an empty page beyond the dataset", () => {
      renderPagination({ page: 3, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    });

    it("enables the Next button on page 1 so the user can advance to page 2", () => {
      renderPagination({ page: 1, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
    });

    it("enables the Next button on a middle page so the user can continue navigating forward", () => {
      renderPagination({ page: 2, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
    });
  });

  // ─── Neither button disabled on middle pages ──────────────────────────────

  describe("middle page — both buttons enabled for free navigation", () => {
    it("neither Prev nor Next is disabled on a middle page (page 2 of 4), allowing movement in both directions", () => {
      renderPagination({ page: 2, totalPages: 4, total: 80, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
    });
  });

  // ─── onPageChange callbacks ───────────────────────────────────────────────

  describe("onPageChange callbacks triggered by button clicks", () => {
    it("calls onPageChange with page-1 when Prev is clicked, decrementing the current page", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 2,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /prev/i }));

      expect(onPageChange).toHaveBeenCalledOnce();
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it("calls onPageChange with page+1 when Next is clicked, advancing to the next page", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 2,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(onPageChange).toHaveBeenCalledOnce();
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it("does not call onPageChange when the disabled Prev button is clicked on page 1", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 1,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      // userEvent respects the disabled attribute — click should not fire the handler.
      await userEvent.click(screen.getByRole("button", { name: /prev/i }));

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("does not call onPageChange when the disabled Next button is clicked on the last page", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 3,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("passes the correct page number from page 3 going back: onPageChange(2)", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 3,
        totalPages: 5,
        total: 100,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /prev/i }));

      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });

  // ─── Page indicator text ──────────────────────────────────────────────────

  describe("page indicator text — current position relative to total pages", () => {
    it("shows '2 / 3' on page 2 of 3 so users know their exact position in the page sequence", () => {
      renderPagination({ page: 2, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByText("2 / 3")).toBeInTheDocument();
    });

    it("shows '1 / 5' on page 1 of 5", () => {
      renderPagination({ page: 1, totalPages: 5, total: 100, pageSize: 20 });

      expect(screen.getByText("1 / 5")).toBeInTheDocument();
    });

    it("shows '5 / 5' on the last page of 5", () => {
      renderPagination({ page: 5, totalPages: 5, total: 100, pageSize: 20 });

      expect(screen.getByText("5 / 5")).toBeInTheDocument();
    });

    it("shows '2 / 2' on a two-page list when on the second page", () => {
      renderPagination({ page: 2, totalPages: 2, total: 25, pageSize: 20 });

      expect(screen.getByText("2 / 2")).toBeInTheDocument();
    });
  });
});
