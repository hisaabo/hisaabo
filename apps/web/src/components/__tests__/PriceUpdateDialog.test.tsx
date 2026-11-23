import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PriceUpdateProposal } from "@hisaabo/shared";
import { PriceUpdateDialog } from "../PriceUpdateDialog";

const rice: PriceUpdateProposal = {
  key: "sale:rice::5 kg", itemId: "rice", unit: "5 kg", side: "sale", itemName: "Basmati Rice", label: "Basmati Rice (5 kg)",
  oldPrice: "450.00", newPrice: "480.00", priceIncludesTax: false,
};
const ghee: PriceUpdateProposal = {
  key: "sale:ghee::", itemId: "ghee", side: "sale", itemName: "Ghee 1L", label: "Ghee 1L",
  oldPrice: "620.00", newPrice: "600.00", priceIncludesTax: true,
};
const fresh: PriceUpdateProposal = {
  key: "sale:new::", itemId: "new", side: "sale", itemName: "New Item", label: "New Item",
  oldPrice: null, newPrice: "99.00", priceIncludesTax: false,
};

function setup(props: Partial<React.ComponentProps<typeof PriceUpdateDialog>> = {}) {
  const handlers = { onUpdate: vi.fn(), onJustThisBill: vi.fn(), onBack: vi.fn() };
  render(<PriceUpdateDialog open proposals={[rice, ghee]} side="sale" {...handlers} {...props} />);
  return handlers;
}

describe("PriceUpdateDialog", () => {
  it("lists every changed item as old -> new with all boxes checked", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Update saved prices?" });
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    boxes.forEach((b) => expect(b).toBeChecked());
    expect(within(dialog).getByText("Basmati Rice (5 kg)")).toBeInTheDocument();
    expect(within(dialog).getByText(/₹450\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText("₹480.00")).toBeInTheDocument();
    expect(within(dialog).getByText("₹600.00")).toBeInTheDocument();
  });

  it("names the tax basis of an inclusive item and a missing saved price", () => {
    setup({ proposals: [ghee, fresh] });
    expect(screen.getByText("incl. GST")).toBeInTheDocument();
    expect(screen.getByText(/No saved price/)).toBeInTheDocument();
  });

  it("[Update item prices] passes only the checked items", async () => {
    const { onUpdate, onJustThisBill } = setup();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("checkbox")[1]!); // uncheck Ghee
    await user.click(screen.getByRole("button", { name: "Update item prices" }));
    expect(onUpdate).toHaveBeenCalledWith([rice]);
    expect(onJustThisBill).not.toHaveBeenCalled();
  });

  it("[Just this bill] updates nothing", async () => {
    const { onUpdate, onJustThisBill } = setup();
    await userEvent.setup().click(screen.getByRole("button", { name: "Just this bill" }));
    expect(onJustThisBill).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("disables [Update item prices] when every box is unchecked", async () => {
    setup();
    const user = userEvent.setup();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    expect(screen.getByRole("button", { name: "Update item prices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Just this bill" })).toBeEnabled();
  });

  it("explains lines it could not offer", () => {
    setup({ skipped: [{ itemName: "Basmati Rice (10 kg)", reason: "\"10 kg\" is no longer one of this item's units" }] });
    expect(screen.getByRole("note")).toHaveTextContent(/Not offered/);
    expect(screen.getByRole("note")).toHaveTextContent(/Basmati Rice \(10 kg\)/);
  });

  it("Esc goes back to the form", async () => {
    const { onBack } = setup();
    await userEvent.setup().keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says selling or purchase price by the bill's side", () => {
    setup({ side: "purchase" });
    expect(screen.getByText(/purchase price on this bill/)).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
