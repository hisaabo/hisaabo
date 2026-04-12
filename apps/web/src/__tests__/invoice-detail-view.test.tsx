/**
 * Invoice detail-view — Bug B line item rendering rules
 *
 * The detail view in `apps/web/src/routes/invoices.tsx` renders a table of
 * line items inside the invoice slide-over. Prior to Bug B this table read
 * `li.description` as the primary display text. The Bug B split flipped
 * that to `li.itemName` (primary bold) with an optional italic
 * `li.description` rendered underneath as free-text notes.
 *
 * Testing the real route component requires wiring up TanStack Router,
 * tRPC, and the surrounding slide-over — overkill for a rendering-rule
 * spec. These tests instead extract the exact JSX used by invoices.tsx
 * into a small local component, rendered in isolation. If the real route
 * JSX is updated the duplicated helper MUST be updated in lockstep, which
 * is why the shape of the JSX is commented inline at the top.
 *
 * Keep these assertions in sync with the "Line items" <tbody> block in
 * apps/web/src/routes/invoices.tsx:573-598 and the template detail table
 * in apps/web/src/routes/automated-invoices.tsx:1129-1168.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Exact copy of the invoice detail-view line-item row ────────────────
// Keep the JSX below byte-for-byte identical to invoices.tsx so the
// assertions meaningfully cover the real rendering rules.

interface LineItemShape {
  id: string;
  itemName: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  totalAmount: string;
  selectedUnit: string | null;
  itemUnit: string | null;
  conversionFactor: string | null;
}

function LineItemsTable({ lineItems }: { lineItems: LineItemShape[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Unit</th>
          <th>Price</th>
          <th>Tax%</th>
          <th>Disc%</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {lineItems.map((li) => (
          <tr key={li.id}>
            <td>
              <p className="font-medium text-text-primary">{li.itemName}</p>
              {li.description && (
                <p className="text-[11px] italic text-text-secondary mt-0.5 whitespace-pre-wrap">
                  {li.description}
                </p>
              )}
            </td>
            <td>{li.quantity}</td>
            <td>
              {(li.selectedUnit || li.itemUnit)?.toUpperCase() || "—"}
            </td>
            <td>{li.unitPrice}</td>
            <td>{li.taxPercent}%</td>
            <td>{li.discountPercent}%</td>
            <td>{li.totalAmount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function row(overrides: Partial<LineItemShape>): LineItemShape {
  return {
    id: "row-1",
    itemName: "Steel Rod",
    description: null,
    quantity: "1",
    unitPrice: "1000",
    taxPercent: "18",
    discountPercent: "0",
    totalAmount: "1180",
    selectedUnit: null,
    itemUnit: "kg",
    conversionFactor: null,
    ...overrides,
  };
}

describe("Invoice detail view — line-item rendering rules (Bug B)", () => {
  it("renders itemName as the primary bold text in the Item column", () => {
    render(
      <LineItemsTable
        lineItems={[row({ itemName: "Basmati Rice (Premium)" })]}
      />
    );

    const primary = screen.getByText("Basmati Rice (Premium)");
    expect(primary).toBeInTheDocument();
    // The primary line uses font-medium to match the "bold" reading spec.
    expect(primary.className).toContain("font-medium");
    expect(primary.className).toContain("text-text-primary");
  });

  it("renders the description as italic muted secondary text beneath the item name when present", () => {
    render(
      <LineItemsTable
        lineItems={[
          row({
            itemName: "Steel Rod",
            description: "Keep separate from order #42",
          }),
        ]}
      />
    );

    const notes = screen.getByText("Keep separate from order #42");
    expect(notes).toBeInTheDocument();
    // The secondary line is italic, muted, and smaller than the primary.
    expect(notes.className).toContain("italic");
    expect(notes.className).toContain("text-text-secondary");
  });

  it("collapses cleanly when description is null — no placeholder paragraph, no italic empty element", () => {
    render(
      <LineItemsTable lineItems={[row({ itemName: "Steel Rod", description: null })]} />
    );

    // Primary still renders.
    expect(screen.getByText("Steel Rod")).toBeInTheDocument();

    // No italic paragraph exists in the DOM at all — this is the
    // "collapses cleanly, no zero-height div" requirement.
    const italicParas = document.querySelectorAll("p.italic");
    expect(italicParas.length).toBe(0);
  });

  it("also collapses when description is an empty string — empty string is falsy so the conditional skips it", () => {
    render(
      <LineItemsTable lineItems={[row({ itemName: "Steel Rod", description: "" })]} />
    );

    expect(screen.getByText("Steel Rod")).toBeInTheDocument();
    const italicParas = document.querySelectorAll("p.italic");
    expect(italicParas.length).toBe(0);
  });

  it("renders multiple rows in the list table — primary text is itemName for every row (list-view spec)", () => {
    render(
      <LineItemsTable
        lineItems={[
          row({ id: "r1", itemName: "Steel Rod" }),
          row({ id: "r2", itemName: "Cement Bag" }),
          row({ id: "r3", itemName: "Iron Sheet" }),
        ]}
      />
    );

    expect(screen.getByText("Steel Rod")).toBeInTheDocument();
    expect(screen.getByText("Cement Bag")).toBeInTheDocument();
    expect(screen.getByText("Iron Sheet")).toBeInTheDocument();
  });

  it("preserves whitespace in multi-line descriptions via whitespace-pre-wrap (so users see their line breaks on the invoice)", () => {
    render(
      <LineItemsTable
        lineItems={[
          row({
            itemName: "Steel Rod",
            description: "Line 1\nLine 2\nLine 3",
          }),
        ]}
      />
    );

    const notes = screen.getByText(/Line 1/);
    expect(notes.className).toContain("whitespace-pre-wrap");
    expect(notes.textContent).toContain("Line 1");
    expect(notes.textContent).toContain("Line 2");
    expect(notes.textContent).toContain("Line 3");
  });
});
