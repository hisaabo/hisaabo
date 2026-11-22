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

describe("MissingHsnWarning: an HSN that cannot be filed", () => {
  it("lists each unusable line with the e-invoice wording, and says what a usable code is", () => {
    render(
      <MissingHsnWarning
        lines={[]}
        invalid={[
          { invoiceNumber: "INV-3", line: 2, itemName: "Steel Rods", itemId: "a", hsn: "730", problem: "line 2 'Steel Rods' has HSN code '730', which is not 4 to 8 digits; correct it on the item" },
          { invoiceNumber: "INV-4", line: 1, itemName: "Cotton", itemId: "b", hsn: "5208", problem: "line 1 'Cotton' has HSN code '5208': Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has 4 digits." },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("2 lines have a missing or unusable HSN code");
    expect(alert).toHaveTextContent("4 to 8 digits");
    expect(alert).toHaveTextContent("INV-3 line 2 'Steel Rods' has HSN code '730', which is not 4 to 8 digits; correct it on the item");
    expect(alert).toHaveTextContent("INV-4 line 1 'Cotton' has HSN code '5208'");
  });

  it("counts missing and invalid lines together; renders nothing when both are empty", () => {
    const { container, rerender } = render(<MissingHsnWarning lines={[]} invalid={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <MissingHsnWarning
        lines={[{ invoiceNumber: "INV-1", line: 1, itemName: "Bolt", itemId: null }]}
        invalid={[{ invoiceNumber: "INV-2", line: 1, itemName: "Nut", itemId: "n", hsn: "73", problem: "line 1 'Nut' has HSN code '73', which is not 4 to 8 digits; correct it on the item" }]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("2 lines have a missing or unusable HSN code");
    expect(screen.getByRole("alert")).toHaveTextContent("INV-1 line 1 (Bolt): typed in without an item");
  });
});
