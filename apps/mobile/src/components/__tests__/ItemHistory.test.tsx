import { fireEvent, render, screen } from "@testing-library/react-native";

const calls: Record<string, Array<Record<string, unknown>>> = {};
const data: Record<string, unknown> = {};

jest.mock("../../lib/trpc", () => {
  const proc = (key: string) => {
    const hook = (input: Record<string, unknown>) => {
      (calls[key] ??= []).push(input);
      return {
        data: data[key], isLoading: false, isFetching: false,
        hasNextPage: key === "item.stockMovementsPage" && (data[key] as { hasNext?: boolean })?.hasNext,
        isFetchingNextPage: false, fetchNextPage: jest.fn(),
      };
    };
    return { useQuery: hook, useInfiniteQuery: hook };
  };
  return { trpc: { item: new Proxy({}, { get: (_t, k) => proc(`item.${String(k)}`) }) } };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { ThemeProvider } from "../../contexts/ThemeContext";
import { StockMovementsSection } from "../items/StockMovementsSection";
import { PriceHistorySection } from "../items/PriceHistorySection";
import { ItemTypeToggle, ITEM_TYPE_LOCK_HINT } from "../items/ItemTypeToggle";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider initialMode="dark">{ui}</ThemeProvider>);
const last = (k: string) => calls[k]![calls[k]!.length - 1]!;
const variants = [{ unit: "box" }];

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  data["item.stockSummary"] = {
    unit: "kg", stats: { count: 2, totalIn: "10.0000", totalOut: "4.0000", net: "6.0000" },
  };
  data["item.stockMovementsPage"] = {
    pages: [{
      unit: "kg", total: 1, nextCursor: null,
      rows: [{ id: "l1", invoiceId: "i1", invoiceDate: new Date("2026-01-01"), invoiceNumber: "INV-1", invoiceType: "sale", documentType: "invoice", partyName: "P", direction: "out", qtyChange: "-4.0000", balance: "96.0000" }],
    }],
  };
  data["item.priceSummary"] = {
    unit: "kg", stats: { count: 3, min: "80.0000", max: "110.0000", avg: "96.6667", latest: "90.0000" },
  };
  data["item.priceHistoryPage"] = { pages: [{ unit: "kg", total: 0, nextCursor: null, rows: [] }] };
});

describe("StockMovementsSection", () => {
  it("offers base unit + variants and queries in the chosen unit", () => {
    wrap(<StockMovementsSection itemId="it1" baseUnit="kg" unitVariants={variants} />);
    expect(last("item.stockSummary")).toMatchObject({ unit: "kg", period: "all" });
    fireEvent.press(screen.getByLabelText("box"));
    expect(last("item.stockSummary")).toMatchObject({ unit: "box" });
    expect(last("item.stockMovementsPage")).toMatchObject({ unit: "box" });
  });

  it("re-queries when the period changes and shows server totals", () => {
    wrap(<StockMovementsSection itemId="it1" baseUnit="kg" unitVariants={variants} />);
    expect(screen.getByText("Out -4 kg")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Last 6M"));
    expect(last("item.stockMovementsPage")).toMatchObject({ period: "6m" });
  });

  it("has no unit chips for items without unit variants", () => {
    wrap(<StockMovementsSection itemId="it1" baseUnit="kg" unitVariants={[]} />);
    expect(screen.queryByText("Unit")).toBeNull();
  });
});

describe("PriceHistorySection", () => {
  it("shows server-computed min / avg / max", () => {
    wrap(<PriceHistorySection itemId="it1" baseUnit="kg" unitVariants={variants} />);
    expect(screen.getByText("₹80.00")).toBeTruthy();
    expect(screen.getByText("₹110.00")).toBeTruthy();
    expect(screen.getByText("₹96.6667")).toBeTruthy();
  });

  it("passes unit and sales/purchases selection through", () => {
    wrap(<PriceHistorySection itemId="it1" baseUnit="kg" unitVariants={variants} />);
    fireEvent.press(screen.getByLabelText("box"));
    fireEvent.press(screen.getByLabelText("Purchases"));
    expect(last("item.priceSummary")).toMatchObject({ unit: "box", invoiceType: "purchase" });
  });
});

describe("ItemTypeToggle", () => {
  it("switches type when unlocked", () => {
    const onChange = jest.fn();
    wrap(<ItemTypeToggle value="product" onChange={onChange} />);
    fireEvent.press(screen.getByLabelText("Service"));
    expect(onChange).toHaveBeenCalledWith("service");
    expect(screen.queryByText(ITEM_TYPE_LOCK_HINT)).toBeNull();
  });

  it("is disabled with a hint when locked", () => {
    const onChange = jest.fn();
    wrap(<ItemTypeToggle value="product" onChange={onChange} locked />);
    fireEvent.press(screen.getByLabelText("Service"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Service").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(ITEM_TYPE_LOCK_HINT)).toBeTruthy();
  });
});
