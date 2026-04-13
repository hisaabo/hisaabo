/**
 * StatusBadge — coloured pill badge for invoice/payment/item statuses
 *
 * StatusBadge is rendered in every list row across invoices, payments,
 * expenses, parties, and items.  The colour must convey urgency at a glance:
 *   - "paid" → green (good)
 *   - "overdue" → red (urgent)
 *   - "partial" → amber (attention needed)
 *   - "draft" → neutral grey (not yet sent)
 *
 * Incorrect badge colours would mislead users about the state of their
 * business documents.  These tests lock in the colour semantics, label
 * capitalisation, and size variants.
 *
 * Accessibility notes:
 *   Status is conveyed through colour AND text so it remains meaningful for
 *   colour-blind users and screen-reader users who cannot see the colour.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { StatusBadge } from "../StatusBadge";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("StatusBadge — coloured status pill used on every document list row", () => {

  // ─── Label display ─────────────────────────────────────────────────────────

  describe("label formatting", () => {
    it("capitalises the first letter of the status value so it reads as a proper label rather than a raw enum string", () => {
      render(<StatusBadge status="paid" />);

      // Lowercase "paid" prop should render as "Paid" label.
      expect(screen.getByText("Paid")).toBeInTheDocument();
    });

    it("capitalises multi-word statuses correctly (e.g., 'unfulfilled' → 'Unfulfilled')", () => {
      render(<StatusBadge status="unfulfilled" />);

      expect(screen.getByText("Unfulfilled")).toBeInTheDocument();
    });

    it("capitalises 'adjusted' to 'Adjusted' so it reads as a proper label", () => {
      render(<StatusBadge status="adjusted" />);

      expect(screen.getByText("Adjusted")).toBeInTheDocument();
    });

    it("handles unknown status values by rendering them capitalised without crashing, providing a safe fallback for future status additions", () => {
      render(<StatusBadge status="pending_review" />);

      // Should not throw; renders whatever string is provided, capitalised.
      expect(screen.getByText("Pending_review")).toBeInTheDocument();
    });
  });

  // ─── Colour semantics ──────────────────────────────────────────────────────

  describe("colour semantics — critical for at-a-glance business status understanding", () => {
    it("applies green (emerald) colouring to 'paid' status to signal a completed, successful transaction", () => {
      const { container } = render(<StatusBadge status="paid" />);

      const badge = container.firstChild as HTMLElement;
      // Emerald classes signal "good / complete" in Hisaabo's colour language.
      expect(badge.className).toMatch(/bg-emerald-50/);
      expect(badge.className).toMatch(/text-emerald-700/);
    });

    it("applies blue colouring to 'sent' status to signal an invoice that has been sent and is awaiting payment", () => {
      const { container } = render(<StatusBadge status="sent" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-blue-50/);
      expect(badge.className).toMatch(/text-blue-700/);
    });

    it("applies red colouring to 'overdue' status to signal urgency — the invoice is past its due date", () => {
      const { container } = render(<StatusBadge status="overdue" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-red-50/);
      expect(badge.className).toMatch(/text-red-700/);
    });

    it("applies amber colouring to 'partial' status to signal that some payment has been received but more is outstanding", () => {
      const { container } = render(<StatusBadge status="partial" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-amber-50/);
      expect(badge.className).toMatch(/text-amber-700/);
    });

    it("applies orange colouring to 'unfulfilled' status to signal delivery is pending", () => {
      const { container } = render(<StatusBadge status="unfulfilled" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-orange-50/);
      expect(badge.className).toMatch(/text-orange-700/);
    });

    it("applies neutral grey to 'draft' status to signal the invoice has not been sent and requires no immediate action", () => {
      const { container } = render(<StatusBadge status="draft" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-surface-2/);
    });

    it("applies neutral grey to 'cancelled' status to indicate the document is inactive and requires no action", () => {
      const { container } = render(<StatusBadge status="cancelled" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-surface-2/);
    });

    it("applies purple colouring to 'adjusted' status to signal the document has been adjusted by a credit or debit note", () => {
      const { container } = render(<StatusBadge status="adjusted" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/bg-purple-50/);
      expect(badge.className).toMatch(/text-purple-700/);
    });

    it("falls back to neutral styling for unknown statuses rather than rendering a broken badge", () => {
      const { container } = render(<StatusBadge status="unknown_future_status" />);

      const badge = container.firstChild as HTMLElement;
      // Unknown statuses must not use empty class strings or throw.
      expect(badge.className).toMatch(/bg-surface-2/);
    });
  });

  // ─── Status dot ────────────────────────────────────────────────────────────

  describe("status dot (coloured circle)", () => {
    it("renders a dot element alongside the label to reinforce the status colour for colour-sighted users", () => {
      const { container } = render(<StatusBadge status="paid" />);

      // The dot is a small span with a rounded-full class and a specific bg colour.
      const dot = container.querySelector(".rounded-full.w-1\\.5.h-1\\.5");
      expect(dot).toBeInTheDocument();
    });

    it("dot colour matches the badge text colour so the visual language is consistent", () => {
      const { container } = render(<StatusBadge status="overdue" />);

      const dot = container.querySelector(".rounded-full.w-1\\.5") as HTMLElement;
      // Overdue dot must be red.
      expect(dot.className).toMatch(/bg-red-500/);
    });
  });

  // ─── Size variants ─────────────────────────────────────────────────────────

  describe("size variants", () => {
    it("renders in the default 'md' size with standard padding and font-size appropriate for standalone use", () => {
      const { container } = render(<StatusBadge status="paid" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/text-xs/);
      expect(badge.className).toMatch(/px-2\.5/);
    });

    it("renders in the 'sm' size with reduced padding and font-size for use in dense table rows", () => {
      const { container } = render(<StatusBadge status="paid" size="sm" />);

      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toMatch(/text-\[11px\]/);
      expect(badge.className).toMatch(/px-2/);
    });
  });

  // ─── Accessibility audit ──────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("paid badge has no WCAG 2.1 AA violations — green text must meet contrast requirements", async () => {
      const { container } = render(<StatusBadge status="paid" />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("overdue badge has no WCAG 2.1 AA violations — red text must meet contrast requirements", async () => {
      const { container } = render(<StatusBadge status="overdue" />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("draft badge has no WCAG 2.1 AA violations", async () => {
      const { container } = render(<StatusBadge status="draft" />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("adjusted badge has no WCAG 2.1 AA violations — purple text must meet contrast requirements", async () => {
      const { container } = render(<StatusBadge status="adjusted" />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
