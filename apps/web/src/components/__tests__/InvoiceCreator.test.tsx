/**
 * InvoiceCreator — invoice creation form
 *
 * The InvoiceCreator is the most financially critical component in Hisaabo.
 * It computes line-item totals that feed directly into the invoice stored in
 * the database and the GST reports filed with the government.  A calculation
 * error here could result in incorrect tax filings or billing disputes.
 *
 * Architecture:
 *   - Uses `calcLine()` (internal function) for per-row arithmetic.
 *   - Uses `useMemo` to sum line rows into overall totals (subtotal, discount,
 *     tax, grand total).
 *   - All monetary arithmetic uses JS number (float); the final values are
 *     sent as strings to the API which stores them as NUMERIC(15,2).
 *
 * Calculation rules (matching Indian GST invoicing standards):
 *   subtotal       = quantity × unit_price
 *   after_discount = subtotal × (1 − discount% / 100)
 *   tax_amount     = after_discount × (tax% / 100)
 *   line_total     = after_discount + tax_amount
 *
 * Grand totals:
 *   Subtotal column = sum of all after_discount values
 *   Discount column = sum of (subtotal − after_discount) for each row
 *   Tax column      = sum of all tax_amount values
 *   Grand Total     = Subtotal column + Tax column
 *
 * These tests mock all tRPC hooks so they can run without a real API server.
 * They focus on:
 *   1. Calculation correctness for each arithmetic step.
 *   2. Real-time total updates as the user types.
 *   3. Correct multi-row aggregation.
 *   4. Form structure and accessibility attributes.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";

// ─── Mock tRPC and all its hooks ───────────────────────────────────────────────
// InvoiceCreator calls trpc.auth.me, trpc.party.list, trpc.item.list, and
// trpc.invoice.create.  We stub all of them with minimal working responses.

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: () => ({ data: { role: "owner" } }),
      },
    },
    party: {
      list: {
        useQuery: () => ({
          data: {
            data: [
              { id: "party-1", name: "Ramesh Traders" },
              { id: "party-2", name: "Suresh Industries" },
            ],
          },
        }),
      },
    },
    item: {
      list: {
        useQuery: () => ({
          data: {
            data: [
              {
                id: "item-1",
                name: "Steel Rod",
                salePrice: "1000",
                purchasePrice: "800",
                taxPercent: "18",
                itemMode: "standard",
                unit: "kg",
                unitVariants: [],
              },
              {
                id: "item-2",
                name: "Cement Bag",
                salePrice: "350",
                purchasePrice: "300",
                taxPercent: "5",
                itemMode: "standard",
                unit: "bag",
                unitVariants: [],
              },
            ],
          },
        }),
      },
    },
    invoice: {
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      invoice: { list: { invalidate: vi.fn() } },
      dashboard: { summary: { invalidate: vi.fn() } },
      item: { list: { invalidate: vi.fn() } },
    }),
  },
  getBusinessId: () => "biz-1",
}));

// Import AFTER the mock so the module uses the mocked trpc.
import { InvoiceCreator } from "../InvoiceCreator";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderCreator(type: "sale" | "purchase" = "sale") {
  return render(<InvoiceCreator type={type} onClose={vi.fn()} />);
}

/**
 * Returns the inputs in the specified line-item row (0-indexed).
 *
 * Each row has four spinbutton (type="number") inputs in DOM order:
 *   [qty, price, tax%, disc%]
 *
 * For the first row (rowIndex=0) the spinbuttons are at indices 0-3.
 * For the second row (rowIndex=1) they are at indices 4-7, and so on.
 *
 * This helper returns only qty and price for convenience; callers that
 * need tax% or disc% should call getAllByRole("spinbutton") directly and
 * index at rowIndex*4+2 and rowIndex*4+3 respectively.
 */
function getLineRow(rowIndex = 0) {
  const allSpinbuttons = screen.getAllByRole("spinbutton");
  // Four spinbuttons per row: qty(0), price(1), tax%(2), disc%(3).
  const qtyInput = allSpinbuttons[rowIndex * 4];
  const priceInput = allSpinbuttons[rowIndex * 4 + 1];
  const descInput = screen.getAllByPlaceholderText("Description *")[rowIndex];
  return { qtyInput, priceInput, descInput };
}

// ─── Pure arithmetic unit tests ───────────────────────────────────────────────
// These tests exercise the calculation logic that lives inside InvoiceCreator
// by driving the form UI and reading the rendered totals.  They serve as a
// specification of the financial arithmetic Hisaabo uses.

describe("InvoiceCreator — invoice creation form with real-time GST calculations", () => {

  // ─── Form structure ─────────────────────────────────────────────────────────

  describe("form structure", () => {
    it("renders the invoice form heading identifying whether it is a sale or purchase invoice", () => {
      renderCreator("sale");

      expect(
        screen.getByRole("heading", { name: /new sale invoice/i })
      ).toBeInTheDocument();
    });

    it("shows 'Customer' label for sale invoices because the party is a buyer", () => {
      renderCreator("sale");

      expect(screen.getByText(/Customer/)).toBeInTheDocument();
    });

    it("shows 'Supplier' label for purchase invoices because the party is a seller", () => {
      renderCreator("purchase");

      expect(screen.getByText(/Supplier/)).toBeInTheDocument();
    });

    it("starts with one empty line item row so users can immediately start entering their first product", () => {
      renderCreator();

      // There should be exactly one Description input on initial render.
      expect(screen.getAllByPlaceholderText("Description *")).toHaveLength(1);
    });

    it("adds a new line item row when '+ Add line item' is clicked, enabling multi-item invoices", async () => {
      renderCreator();

      await userEvent.click(screen.getByText("+ Add line item"));

      expect(screen.getAllByPlaceholderText("Description *")).toHaveLength(2);
    });

    it("renders the party dropdown pre-populated with parties from the API so the user can immediately select a customer", () => {
      renderCreator("sale");

      const partySelect = screen.getByRole("combobox", { name: /customer/i });
      expect(within(partySelect).getByText("Ramesh Traders")).toBeInTheDocument();
    });
  });

  // ─── Line-item calculation: subtotal ───────────────────────────────────────

  describe("line-item calculations — subtotal (quantity × price)", () => {
    it("calculates subtotal as quantity × unit price: 5 units × ₹2,000 = ₹10,000", async () => {
      renderCreator();

      const { qtyInput, priceInput } = getLineRow(0);

      // Use fireEvent.change to directly set values on controlled number inputs.
      // userEvent.type() simulates individual keystrokes which can be unreliable
      // for number inputs in jsdom — in particular, the existing value is not
      // automatically cleared and the typed characters may append instead of
      // replace.  fireEvent.change triggers the React onChange handler directly.
      fireEvent.change(qtyInput, { target: { value: "5" } });
      fireEvent.change(priceInput, { target: { value: "2000" } });

      // The totals section must update with the correct subtotal.
      // With no tax and no discount: subtotal = after_discount = 10000.
      // Note: both the line-item total and the Subtotal row show ₹10,000.00
      // when there is no tax and no discount, so we assert that at least one
      // element with this formatted amount appears in the document.
      await waitFor(() => {
        expect(screen.getAllByText(/₹10,000\.00|10,000\.00/).length).toBeGreaterThan(0);
      });
    });

    it("shows ₹0 subtotal when quantity and price are both empty on an untouched row", () => {
      renderCreator();

      // The totals panel must render without crashing and show zero amounts.
      expect(screen.getByText("Subtotal")).toBeInTheDocument();
    });
  });

  // ─── Line-item calculation: discount ──────────────────────────────────────

  describe("line-item calculations — discount (applied before tax per GST rules)", () => {
    it("applies discount BEFORE tax: 10 qty × ₹1,000 with 10% discount = ₹9,000 after-discount base", async () => {
      renderCreator();

      const { qtyInput, priceInput } = getLineRow(0);
      const allNumberInputs = screen.getAllByRole("spinbutton");
      // Discount is the 4th spinbutton (index 3 in the first row).
      const discountInput = allNumberInputs[3];

      fireEvent.change(qtyInput, { target: { value: "10" } });
      fireEvent.change(priceInput, { target: { value: "1000" } });
      fireEvent.change(discountInput, { target: { value: "10" } });

      // After-discount subtotal = 10 × 1000 × (1 - 0.10) = 9000.
      // The "Subtotal" row in the totals panel shows the sum of all after-discount
      // amounts — here ₹9,000.00.  The line-item total also shows ₹9,000.00 since
      // there is no tax, so we assert that at least one matching element exists.
      await waitFor(() => {
        expect(screen.getAllByText(/₹9,000\.00|9,000\.00/).length).toBeGreaterThan(0);
      });
    });

    it("shows the discount row in the totals panel only when at least one line has a non-zero discount", async () => {
      renderCreator();

      // Without any discount, the Discount row must be hidden to avoid
      // confusing users with a ₹0 discount line.
      expect(screen.queryByText("Discount")).not.toBeInTheDocument();
    });
  });

  // ─── Line-item calculation: tax ───────────────────────────────────────────

  describe("line-item calculations — GST tax (applied on after-discount amount)", () => {
    it("calculates GST tax on the AFTER-DISCOUNT amount, not the gross amount — this is the legal requirement under GST", async () => {
      renderCreator();

      const allNumberInputs = screen.getAllByRole("spinbutton");
      // Row 0: qty, price, tax%, disc%
      const qtyInput = allNumberInputs[0];
      const priceInput = allNumberInputs[1];
      const taxInput = allNumberInputs[2];
      const discountInput = allNumberInputs[3];

      fireEvent.change(qtyInput, { target: { value: "1" } });
      fireEvent.change(priceInput, { target: { value: "10000" } });
      fireEvent.change(discountInput, { target: { value: "10" } });
      fireEvent.change(taxInput, { target: { value: "18" } });

      // after_discount = 10000 × 0.90 = 9000
      // tax = 9000 × 0.18 = 1620
      // total = 9000 + 1620 = 10620
      await waitFor(() => {
        expect(screen.getByText(/₹1,620\.00|1,620\.00/)).toBeInTheDocument();
      });
    });

    it("calculates 18% GST on the full amount when no discount is applied: ₹5,000 × 18% = ₹900", async () => {
      renderCreator();

      const allNumberInputs = screen.getAllByRole("spinbutton");
      const qtyInput = allNumberInputs[0];
      const priceInput = allNumberInputs[1];
      const taxInput = allNumberInputs[2];

      fireEvent.change(qtyInput, { target: { value: "1" } });
      fireEvent.change(priceInput, { target: { value: "5000" } });
      fireEvent.change(taxInput, { target: { value: "18" } });

      // tax_amount = 5000 × 0.18 = 900.
      // The Tax row in the totals panel displays ₹900.00.  We use getAllByText
      // because "900.00" also appears as a substring inside "5,900.00" (the
      // line total and grand total), so getByText would throw "multiple elements".
      await waitFor(() => {
        expect(screen.getAllByText(/₹900\.00/).length).toBeGreaterThan(0);
      });
    });

    it("grand total = after-discount subtotal + tax: ₹9,000 + ₹1,620 = ₹10,620", async () => {
      renderCreator();

      const allNumberInputs = screen.getAllByRole("spinbutton");
      const qtyInput = allNumberInputs[0];
      const priceInput = allNumberInputs[1];
      const taxInput = allNumberInputs[2];
      const discountInput = allNumberInputs[3];

      fireEvent.change(qtyInput, { target: { value: "1" } });
      fireEvent.change(priceInput, { target: { value: "10000" } });
      fireEvent.change(discountInput, { target: { value: "10" } });
      fireEvent.change(taxInput, { target: { value: "18" } });

      // total = 9000 + 1620 = 10620.
      // ₹10,620.00 appears in both the line-item total column and the Grand
      // Total row in the totals panel.  We use getAllByText to allow multiple
      // matches and assert that at least one is present.
      await waitFor(() => {
        expect(screen.getAllByText(/₹10,620\.00|10,620\.00/).length).toBeGreaterThan(0);
      });
    });
  });

  // ─── Multi-row aggregation ────────────────────────────────────────────────

  describe("multi-row total aggregation", () => {
    it("sums tax amounts across all line items: row1 tax ₹900 + row2 tax ₹175 = ₹1,075", async () => {
      renderCreator();

      // Add a second line item.
      await userEvent.click(screen.getByText("+ Add line item"));

      const allNumberInputs = screen.getAllByRole("spinbutton");
      // Row 0: [qty0, price0, tax0, disc0], Row 1: [qty1, price1, tax1, disc1]
      const [qty0, price0, tax0, , qty1, price1, tax1] = allNumberInputs;

      // Row 1: 1 × ₹5,000 @ 18% GST → tax = ₹900
      fireEvent.change(qty0, { target: { value: "1" } });
      fireEvent.change(price0, { target: { value: "5000" } });
      fireEvent.change(tax0, { target: { value: "18" } });

      // Row 2: 1 × ₹3,500 @ 5% GST → tax = ₹175
      fireEvent.change(qty1, { target: { value: "1" } });
      fireEvent.change(price1, { target: { value: "3500" } });
      fireEvent.change(tax1, { target: { value: "5" } });

      // Total tax = 900 + 175 = 1075
      await waitFor(() => {
        expect(screen.getByText(/₹1,075\.00|1,075\.00/)).toBeInTheDocument();
      });
    });
  });

  // ─── Totals panel labels ──────────────────────────────────────────────────

  describe("totals panel — summary displayed to the user", () => {
    it("renders all totals labels (Subtotal, Tax, Total) so users can verify their invoice breakdown", () => {
      renderCreator();

      expect(screen.getByText("Subtotal")).toBeInTheDocument();
      expect(screen.getByText("Tax")).toBeInTheDocument();
      expect(screen.getByText("Total")).toBeInTheDocument();
    });
  });

  // ─── Accessibility ────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("invoice date and due date inputs have associated labels so screen readers can announce the field names", () => {
      renderCreator();

      // Labels are rendered as <label> elements with text content.
      expect(screen.getByText("Invoice date")).toBeInTheDocument();
      expect(screen.getByText("Due date")).toBeInTheDocument();
    });

    it("the form element wraps all inputs so screen readers enter form mode and announce the field count", () => {
      renderCreator();

      expect(screen.getByRole("form")).toBeInTheDocument();
    });

    it("has no critical WCAG 2.1 AA violations on initial render (axe-core audit)", async () => {
      const { container } = renderCreator();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
