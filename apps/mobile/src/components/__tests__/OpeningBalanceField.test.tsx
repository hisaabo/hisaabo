import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { composeOpeningBalance, splitOpeningBalance, type OpeningBalanceDirection } from "@hisaabo/shared";

import { ThemeProvider } from "../../contexts/ThemeContext";
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

const wrap = (ui: React.ReactElement) => render(<ThemeProvider initialMode="dark">{ui}</ThemeProvider>);

describe("OpeningBalanceField (mobile)", () => {
  it("stores a positive value for To receive and a negative one for To pay", () => {
    const onValue = jest.fn();
    wrap(<Harness stored="0" onValue={onValue} />);
    fireEvent.changeText(screen.getByLabelText("Opening balance amount"), "12000");
    expect(onValue).toHaveBeenLastCalledWith("12000.00");

    fireEvent.press(screen.getByText("To pay"));
    expect(onValue).toHaveBeenLastCalledWith("-12000.00");

    fireEvent.press(screen.getByText("To receive"));
    expect(onValue).toHaveBeenLastCalledWith("12000.00");
  });

  it("edit: an existing negative balance opens as the amount with To pay selected", () => {
    const onValue = jest.fn();
    wrap(<Harness stored="-14000.00" onValue={onValue} />);
    expect(screen.getByLabelText("Opening balance amount").props.value).toBe("14000.00");
    expect(onValue).toHaveBeenLastCalledWith("-14000.00");
    expect(screen.getByText("To pay: you owe them.")).toBeTruthy();
  });
});
