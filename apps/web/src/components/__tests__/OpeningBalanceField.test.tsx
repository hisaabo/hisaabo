import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { composeOpeningBalance, splitOpeningBalance, type OpeningBalanceDirection } from "@hisaabo/shared";
import { OpeningBalanceField } from "../OpeningBalanceField";

function Harness({ stored, onValue }: { stored: string; onValue: (v: string) => void }) {
  const initial = splitOpeningBalance(stored);
  const [amount, setAmount] = useState(initial.amount);
  const [direction, setDirection] = useState<OpeningBalanceDirection>(initial.direction);
  onValue(composeOpeningBalance(amount, direction));
  return (
    <OpeningBalanceField
      amount={amount}
      direction={direction}
      partyType="supplier"
      onAmountChange={setAmount}
      onDirectionChange={setDirection}
    />
  );
}

describe("OpeningBalanceField", () => {
  it("stores a positive value for To receive and a negative one for To pay", () => {
    const onValue = vi.fn();
    render(<Harness stored="0" onValue={onValue} />);
    fireEvent.change(screen.getByLabelText("Opening Balance"), { target: { value: "12000" } });
    expect(onValue).toHaveBeenLastCalledWith("12000.00");

    fireEvent.click(screen.getByRole("button", { name: "To pay" }));
    expect(onValue).toHaveBeenLastCalledWith("-12000.00");

    fireEvent.click(screen.getByRole("button", { name: "To receive" }));
    expect(onValue).toHaveBeenLastCalledWith("12000.00");
  });

  it("edit: an existing negative balance opens as the amount with To pay selected", () => {
    const onValue = vi.fn();
    render(<Harness stored="-14000.00" onValue={onValue} />);
    expect(screen.getByLabelText("Opening Balance")).toHaveValue(14000);
    expect(onValue).toHaveBeenLastCalledWith("-14000.00");
    expect(screen.getByText(/To pay: you owe them\./)).toBeInTheDocument();
  });

  it("an empty amount is '0' whichever way the toggle points", () => {
    const onValue = vi.fn();
    render(<Harness stored="0" onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: "To pay" }));
    expect(onValue).toHaveBeenLastCalledWith("0");
  });
});
