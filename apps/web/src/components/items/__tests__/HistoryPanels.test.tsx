import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Capture the input every query is called with, and serve canned data.
const calls: Record<string, Array<Record<string, unknown>>> = {};
const data: Record<string, unknown> = {};

vi.mock("@/lib/trpc", () => {
  const proc = (key: string) => ({
    useQuery: (input: Record<string, unknown>) => {
      (calls[key] ??= []).push(input);
      return { data: data[key], isLoading: false, isFetching: false };
    },
  });
  return {
    trpc: { item: new Proxy({}, { get: (_t, k) => proc(`item.${String(k)}`) }) },
  };
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
// recharts needs layout; the panels' data flow is what we assert here.
vi.mock("recharts", async (orig) => ({
  ...(await orig<object>()),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => <div data-testid="chart" />,
}));

import { StockMovementsPanel } from "../StockMovementsPanel";
import { PriceHistoryPanel } from "../PriceHistoryPanel";

const variants = [{ unit: "box", conversionFactor: 12 }];
const last = (key: string) => calls[key]![calls[key]!.length - 1]!;

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  data["item.stockSummary"] = {
    unit: "kg", period: "all", downsampled: false,
    stats: { count: 2, totalIn: "10.0000", totalOut: "4.0000", net: "6.0000" },
    series: [
      { date: new Date("2026-01-01"), balance: "90.0000", min: "90", max: "90" },
      { date: new Date("2026-02-01"), balance: "96.0000", min: "96", max: "96" },
    ],
  };
  data["item.stockMovementsPage"] = {
    unit: "kg", total: 2, nextCursor: null,
    rows: [
      { id: "l2", invoiceId: "i2", invoiceDate: new Date("2026-02-01"), invoiceNumber: "INV-2", invoiceType: "sale", documentType: "invoice", partyName: "P", direction: "out", qtyChange: "-4.0000", balance: "96.0000" },
      { id: "l1", invoiceId: "i1", invoiceDate: new Date("2026-01-01"), invoiceNumber: "INV-1", invoiceType: "purchase", documentType: "invoice", partyName: "P", direction: "in", qtyChange: "10.0000", balance: "100.0000" },
    ],
  };
  data["item.priceSummary"] = {
    unit: "kg", invoiceType: "sale", period: "all", downsampled: false,
    stats: { count: 3, min: "80.0000", max: "110.0000", avg: "96.6667", latest: "90.0000" },
    series: [
      { date: new Date("2026-01-01"), price: "80.0000", min: "80", max: "80", count: 1 },
      { date: new Date("2026-02-01"), price: "110.0000", min: "110", max: "110", count: 1 },
    ],
  };
  data["item.priceHistoryPage"] = { unit: "kg", total: 0, nextCursor: null, rows: [] };
});

describe("StockMovementsPanel unit selector", () => {
  it("lists the base unit and every unit variant, defaulting to base", () => {
    render(<StockMovementsPanel itemId="it1" baseUnit="kg" unitVariants={variants} />);
    const select = screen.getByLabelText("Display unit") as HTMLSelectElement;
    expect(select.value).toBe("kg");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["kg", "box"]);
    expect(last("item.stockSummary")).toMatchObject({ unit: "kg", period: "all" });
  });

  it("re-queries summary and rows in the chosen unit", () => {
    render(<StockMovementsPanel itemId="it1" baseUnit="kg" unitVariants={variants} />);
    fireEvent.change(screen.getByLabelText("Display unit"), { target: { value: "box" } });
    expect(last("item.stockSummary")).toMatchObject({ unit: "box" });
    expect(last("item.stockMovementsPage")).toMatchObject({ unit: "box", cursor: 0 });
  });

  it("re-queries with the new period when toggled, and shows server balances", () => {
    render(<StockMovementsPanel itemId="it1" baseUnit="kg" unitVariants={variants} />);
    expect(screen.getByText("INV-1")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Last 6M" }));
    expect(last("item.stockMovementsPage")).toMatchObject({ period: "6m" });
  });

  it("hides the selector for items without unit variants", () => {
    render(<StockMovementsPanel itemId="it1" baseUnit="kg" unitVariants={[]} />);
    expect(screen.queryByLabelText("Display unit")).toBeNull();
  });
});

describe("PriceHistoryPanel stats", () => {
  it("shows min / avg / max / latest computed by the server", () => {
    render(<PriceHistoryPanel itemId="it1" baseUnit="kg" unitVariants={variants} />);
    const stats = screen.getByTestId("price-stats");
    expect(stats).toHaveTextContent("₹80.00");
    expect(stats).toHaveTextContent("₹110.00");
    expect(stats).toHaveTextContent("₹96.6667");
    expect(stats).toHaveTextContent("₹90.00");
    expect(last("item.priceSummary")).toMatchObject({ period: "all", invoiceType: "sale", unit: "kg" });
  });

  it("passes the selected unit and the sales/purchases toggle to the API", () => {
    render(<PriceHistoryPanel itemId="it1" baseUnit="kg" unitVariants={variants} />);
    fireEvent.change(screen.getByLabelText("Display unit"), { target: { value: "box" } });
    fireEvent.click(screen.getByRole("button", { name: "Purchases" }));
    expect(last("item.priceSummary")).toMatchObject({ unit: "box", invoiceType: "purchase" });
    expect(last("item.priceHistoryPage")).toMatchObject({ unit: "box", invoiceType: "purchase", cursor: 0 });
  });
});
