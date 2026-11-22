import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissingHsnWarning } from "./MissingHsnWarning";

describe("MissingHsnWarning", () => {
  it("renders nothing when no line is missing an HSN (or the list is absent)", () => {
    const { container, rerender } = render(<MissingHsnWarning lines={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MissingHsnWarning lines={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each item with the invoices that sold it, and the lines typed in without an item", () => {
    render(
      <MissingHsnWarning
        lines={[
          { invoiceNumber: "INV-1", line: 1, itemName: "Copper Wire", itemId: "item-a" },
          { invoiceNumber: "INV-7", line: 3, itemName: "Copper Wire", itemId: "item-a" },
          { invoiceNumber: "INV-1", line: 2, itemName: "Packing", itemId: null },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("3 lines have no HSN code");
    expect(alert).toHaveTextContent("filed under HSN 0000");
    expect(alert).toHaveTextContent("Add the HSN on item Copper Wire (INV-1 line 1, INV-7 line 3)");
    expect(alert).toHaveTextContent("INV-1 line 2 (Packing): typed in without an item");
  });

  it("uses the singular for one line", () => {
    render(<MissingHsnWarning lines={[{ invoiceNumber: "INV-2", line: 1, itemName: "Bolt", itemId: "b" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 line has no HSN code");
  });
});
