import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemTypeSwitch, ITEM_TYPE_LOCK_HINT } from "../ItemTypeSwitch";

describe("ItemTypeSwitch", () => {
  it("lets the user switch type when the item has no transactions", () => {
    const onChange = vi.fn();
    render(<ItemTypeSwitch value="product" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Service" }));
    expect(onChange).toHaveBeenCalledWith("service");
    expect(screen.queryByText(ITEM_TYPE_LOCK_HINT)).toBeNull();
  });

  it("disables both options and explains why when locked", () => {
    const onChange = vi.fn();
    render(<ItemTypeSwitch value="product" onChange={onChange} locked />);
    const service = screen.getByRole("button", { name: "Service" });
    const product = screen.getByRole("button", { name: "Product" });
    expect(service).toBeDisabled();
    expect(product).toBeDisabled();
    expect(product).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(service);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(ITEM_TYPE_LOCK_HINT)).toBeInTheDocument();
  });
});
