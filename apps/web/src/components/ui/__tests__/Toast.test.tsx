/**
 * ToastContainer — portal-based notification component
 *
 * Toast notifications are the primary feedback channel in Hisaabo.  They
 * confirm that an invoice was saved, a payment was recorded, or a file was
 * exported.  Getting them wrong — wrong colour, missing title, non-dismissable
 * — leaves users uncertain whether their action succeeded.
 *
 * Architecture note:
 *   ToastContainer renders via createPortal into document.body and subscribes
 *   to the pub/sub bus in useToastListener().  Tests trigger toasts by calling
 *   the exported toast() function inside act(), then asserting on document.body
 *   since the portal bypasses the render container.
 *
 * These tests verify:
 *   1. Each variant (success / error / info) applies the correct icon wrapper
 *      colour class so users receive an unambiguous visual signal.
 *   2. The toast title is always rendered as readable text.
 *   3. The optional description renders only when supplied.
 *   4. The dismiss button carries aria-label="Dismiss" for voice-control users.
 *   5. Clicking dismiss removes that toast from the DOM immediately.
 *   6. Multiple concurrent toasts all render simultaneously.
 *   7. The auto-dismiss timeout removes a toast after 4 000 ms.
 *   8. No WCAG 2.1 AA violations via axe-core.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ToastContainer } from "../Toast";
import { toast } from "@/hooks/useToast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders the ToastContainer into the document.  Because the container renders
 * via createPortal into document.body, queries must be run against
 * document.body rather than the render container returned by render().
 *
 * Also returns the container for axe audits on the portal output.
 */
function renderContainer() {
  return render(<ToastContainer />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ToastContainer — portal-based notification overlay", () => {

  // ─── Variant styling ───────────────────────────────────────────────────────

  describe("variant icon styling — critical for at-a-glance status reading", () => {
    it("success variant renders with emerald icon wrapper so the user recognises a completed action", async () => {
      renderContainer();

      act(() => {
        toast.success("Invoice saved", "INV-0023 has been saved successfully.");
      });

      // The icon wrapper carries both the background and text colour classes.
      const iconWrapper = document.body.querySelector(".bg-emerald-50") as HTMLElement;
      expect(iconWrapper).not.toBeNull();
      expect(iconWrapper.className).toMatch(/text-emerald-600/);
    });

    it("error variant renders with red icon wrapper so the user immediately recognises a failure", async () => {
      renderContainer();

      act(() => {
        toast.error("Export failed", "Could not export invoice list.");
      });

      const iconWrapper = document.body.querySelector(".bg-red-50") as HTMLElement;
      expect(iconWrapper).not.toBeNull();
      expect(iconWrapper.className).toMatch(/text-red-600/);
    });

    it("info variant renders with blue icon wrapper for neutral informational messages", async () => {
      renderContainer();

      act(() => {
        toast.info("GST filing due", "Your Q4 GST return is due in 3 days.");
      });

      const iconWrapper = document.body.querySelector(".bg-blue-50") as HTMLElement;
      expect(iconWrapper).not.toBeNull();
      expect(iconWrapper.className).toMatch(/text-blue-600/);
    });
  });

  // ─── Content rendering ─────────────────────────────────────────────────────

  describe("content rendering — title and description must be visible to the user", () => {
    it("renders the toast title so the user understands what event occurred", async () => {
      renderContainer();

      act(() => {
        toast.success("Payment recorded");
      });

      expect(screen.getByText("Payment recorded")).toBeInTheDocument();
    });

    it("renders the description when provided so the user gets supporting detail", async () => {
      renderContainer();

      act(() => {
        toast.success("Payment recorded", "Rs. 15,000 received from Ramesh Traders.");
      });

      expect(screen.getByText("Rs. 15,000 received from Ramesh Traders.")).toBeInTheDocument();
    });

    it("does not render a description element when none is provided, keeping the toast compact", async () => {
      renderContainer();

      act(() => {
        toast.info("Syncing data");
      });

      // Only the title text should exist — no extra paragraph for description.
      expect(screen.getByText("Syncing data")).toBeInTheDocument();
      // Description container is only rendered when t.description is truthy;
      // assert no second <p> appears alongside the title.
      const allParagraphs = document.body.querySelectorAll(
        ".animate-toast-in p"
      );
      expect(allParagraphs).toHaveLength(1);
    });
  });

  // ─── Dismiss button ────────────────────────────────────────────────────────

  describe("dismiss button — must be accessible and functional", () => {
    it("dismiss button carries aria-label='Dismiss' so voice-control users can say 'Click Dismiss'", async () => {
      renderContainer();

      act(() => {
        toast.info("Party added", "Suresh Enterprises has been added.");
      });

      expect(
        screen.getByRole("button", { name: "Dismiss" })
      ).toBeInTheDocument();
    });

    it("clicking the dismiss button removes that toast from the DOM", async () => {
      renderContainer();

      act(() => {
        toast.success("Invoice sent", "INV-0031 sent to Priya Textiles.");
      });

      expect(screen.getByText("Invoice sent")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByText("Invoice sent")).not.toBeInTheDocument();
    });
  });

  // ─── Multiple toasts ───────────────────────────────────────────────────────

  describe("multiple simultaneous toasts", () => {
    it("renders all toasts concurrently when several are fired in quick succession", async () => {
      renderContainer();

      act(() => {
        toast.success("Invoice saved");
        toast.error("Payment failed");
        toast.info("Low stock alert");
      });

      expect(screen.getByText("Invoice saved")).toBeInTheDocument();
      expect(screen.getByText("Payment failed")).toBeInTheDocument();
      expect(screen.getByText("Low stock alert")).toBeInTheDocument();
    });

    it("each concurrent toast has its own dismiss button", async () => {
      renderContainer();

      act(() => {
        toast.success("First notification");
        toast.error("Second notification");
      });

      const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
      expect(dismissButtons).toHaveLength(2);
    });
  });

  // ─── Auto-dismiss ──────────────────────────────────────────────────────────

  describe("auto-dismiss — toasts must disappear automatically after 4 000 ms", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("toast is still present before the 4 000 ms timeout elapses", async () => {
      renderContainer();

      act(() => {
        toast.success("Export complete", "invoice-list.csv is ready.");
      });

      expect(screen.getByText("Export complete")).toBeInTheDocument();

      // Advance time to just before auto-dismiss fires.
      act(() => {
        vi.advanceTimersByTime(3999);
      });

      expect(screen.getByText("Export complete")).toBeInTheDocument();
    });

    it("toast is removed from the DOM after 4 000 ms elapses (auto-dismiss)", async () => {
      renderContainer();

      act(() => {
        toast.success("Export complete", "invoice-list.csv is ready.");
      });

      expect(screen.getByText("Export complete")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByText("Export complete")).not.toBeInTheDocument();
    });
  });

  // ─── Accessibility audit ───────────────────────────────────────────────────

  describe("accessibility audit", () => {
    it("has no WCAG 2.1 AA violations when a success toast is visible", async () => {
      renderContainer();

      act(() => {
        toast.success("Payment recorded", "Rs. 8,500 from Kavitha Mills recorded.");
      });

      // The toast renders via createPortal into document.body.  Auditing
      // document.body directly triggers axe's "region" rule because the body
      // has no landmark wrapping — this is a test-harness limitation, not a
      // component defect (in production the toast sits inside a fully-landmarked
      // page).  We audit the portal node itself to avoid the false positive.
      const portalNode = document.body.querySelector(".fixed.top-4.right-4") as HTMLElement;
      const results = await axe(portalNode);
      expect(results).toHaveNoViolations();
    });
  });
});
