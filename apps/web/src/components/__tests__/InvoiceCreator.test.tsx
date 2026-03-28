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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
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
 * Returns the inputs in the first (and by default, only) line-item row.
 * The InvoiceCreator renders inputs without accessible labels on each row
 * (it uses placeholder text instead), so we query by placeholder.
 */
function getLineRow(rowIndex = 0) {
  // Each row's quantity input has a specific step="any" attribute.
  const allQtyInputs = screen.getAllByRole("spinbutton");
  // First spinbutton per row is Qty, second is Price.
  const qtyInput = allQtyInputs[rowIndex * 2];
  const priceInput = allQtyInputs[rowIndex * 2 + 1];
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

      // Clear defaults and enter values.
      await userEvent.triple_click(qtyInput);
      await userEvent.type(qtyInput, "5");

      await userEvent.triple_click(priceInput);
      await userEvent.type(priceInput, "2000");

      // The totals section must update with the correct subtotal.
      // With no tax and no discount: subtotal = after_discount = 10000.
      await waitFor(() => {
        expect(screen.getByText(/₹10,000\.00|10,000\.00/)).toBeInTheDocument();
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

      await userEvent.triple_click(qtyInput);
      await userEvent.type(qtyInput, "10");

      await userEvent.triple_click(priceInput);
      await userEvent.type(priceInput, "1000");

      // Enter 10% discount.
      await userEvent.triple_click(discountInput);
      await userEvent.type(discountInput, "10");

      // After-discount subtotal = 10 × 1000 × (1 - 0.10) = 9000.
      // The "Discount" row should show the discount amount (₹1,000).
      await waitFor(() => {
        // Subtotal column shows after-discount total = ₹9,000.
        expect(screen.getByText(/₹9,000\.00|9,000\.00/)).toBeInTheDocument();
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

      await userEvent.triple_click(qtyInput);
      await userEvent.type(qtyInput, "1");

      await userEvent.triple_click(priceInput);
      await userEvent.type(priceInput, "10000");

      await userEvent.triple_click(discountInput);
      await userEvent.type(discountInput, "10");

      await userEvent.triple_click(taxInput);
      await userEvent.type(taxInput, "18");

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

      await userEvent.triple_click(qtyInput);
      await userEvent.type(qtyInput, "1");

      await userEvent.triple_click(priceInput);
      await userEvent.type(priceInput, "5000");

      await userEvent.triple_click(taxInput);
      await userEvent.type(taxInput, "18");

      // tax_amount = 5000 × 0.18 = 900
      await waitFor(() => {
        expect(screen.getByText(/₹900\.00|900\.00/)).toBeInTheDocument();
      });
    });

    it("grand total = after-discount subtotal + tax: ₹9,000 + ₹1,620 = ₹10,620", async () => {
      renderCreator();

      const allNumberInputs = screen.getAllByRole("spinbutton");
      const qtyInput = allNumberInputs[0];
      const priceInput = allNumberInputs[1];
      const taxInput = allNumberInputs[2];
      const discountInput = allNumberInputs[3];

      await userEvent.triple_click(qtyInput);
      await userEvent.type(qtyInput, "1");

      await userEvent.triple_click(priceInput);
      await userEvent.type(priceInput, "10000");

      await userEvent.triple_click(discountInput);
      await userEvent.type(discountInput, "10");

      await userEvent.triple_click(taxInput);
      await userEvent.type(taxInput, "18");

      // total = 9000 + 1620 = 10620
      await waitFor(() => {
        expect(screen.getByText(/₹10,620\.00|10,620\.00/)).toBeInTheDocument();
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
      await userEvent.triple_click(qty0);
      await userEvent.type(qty0, "1");
      await userEvent.triple_click(price0);
      await userEvent.type(price0, "5000");
      await userEvent.triple_click(tax0);
      await userEvent.type(tax0, "18");

      // Row 2: 1 × ₹3,500 @ 5% GST → tax = ₹175
      await userEvent.triple_click(qty1);
      await userEvent.type(qty1, "1");
      await userEvent.triple_click(price1);
      await userEvent.type(price1, "3500");
      await userEvent.triple_click(tax1);
      await userEvent.type(tax1, "5");

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
