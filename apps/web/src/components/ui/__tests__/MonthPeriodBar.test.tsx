import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthPeriodBar } from "../MonthPeriodBar";

describe("MonthPeriodBar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("marks This Month active for the current month", () => {
    render(<MonthPeriodBar year={2026} month={10} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "This Month" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Month")).not.toBeInTheDocument();
  });

  it("Last Month pill selects the previous month", async () => {
    const onChange = vi.fn();
    render(<MonthPeriodBar year={2026} month={10} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Last Month" }));
    expect(onChange).toHaveBeenCalledWith(2026, 9);
  });

  it("Last Month across a year boundary", async () => {
    vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));
    const onChange = vi.fn();
    render(<MonthPeriodBar year={2026} month={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Last Month" }));
    expect(onChange).toHaveBeenCalledWith(2025, 12);
  });

  // The business calendar is IST: at 03:00 IST on 1 Nov (2026-10-31T21:30Z, still 31 Oct in UTC and
  // in the US) "This Month" is November, whatever zone the browser is in.
  it("This Month / Last Month follow the IST calendar, not the browser's", async () => {
    vi.setSystemTime(new Date("2026-10-31T21:30:00.000Z"));
    const onChange = vi.fn();
    render(<MonthPeriodBar year={2026} month={11} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "This Month" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Last Month" }));
    expect(onChange).toHaveBeenCalledWith(2026, 10);
  });

  it("flips to the next month at 00:00 IST, not at 00:00 UTC", () => {
    vi.setSystemTime(new Date("2026-11-30T18:29:59.999Z")); // 23:59:59.999 IST on 30 Nov
    const { unmount } = render(<MonthPeriodBar year={2026} month={11} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "This Month" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    vi.setSystemTime(new Date("2026-11-30T18:30:00.000Z")); // 00:00:00.000 IST on 1 Dec
    render(<MonthPeriodBar year={2026} month={12} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "This Month" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Custom reveals month/year selectors and reports changes", async () => {
    const onChange = vi.fn();
    render(<MonthPeriodBar year={2026} month={10} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.selectOptions(screen.getByLabelText("Month"), "3");
    expect(onChange).toHaveBeenCalledWith(2026, 3);
    await userEvent.selectOptions(screen.getByLabelText("Year"), "2024");
    expect(onChange).toHaveBeenLastCalledWith(2024, 10);
  });

  it("opens in custom mode for an older period", () => {
    render(<MonthPeriodBar year={2025} month={4} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Month")).toHaveValue("4");
  });
});
