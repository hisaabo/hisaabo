import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Every trpc.<router>.<proc>.useQuery(input, opts) call is recorded here.
const calls: Array<{ proc: string; input: unknown; opts: unknown }> = [];
let stockData: unknown;

vi.mock("@/lib/trpc", () => {
  const makeProc = (path: string[]) =>
    new Proxy(() => undefined, {
      get(_t, prop: string) {
        if (prop === "useQuery") {
          return (input: unknown, opts: unknown) => {
            calls.push({ proc: path.join("."), input, opts });
            return {
              data: path.join(".") === "reports.stockSummary" ? stockData : undefined,
              isLoading: false,
              error: null,
            };
          };
        }
        return makeProc([...path, prop]);
      },
    });
  return { trpc: makeProc([]) };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children, to, search, className }: { children: React.ReactNode; to: string; search?: Record<string, string>; className?: string }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} className={className}>{children}</a>
  ),
}));

vi.mock("@/components/ui/PartyCombobox", () => ({ PartyCombobox: () => null }));
vi.mock("@/components/ui/DateRangeBar", () => ({ DateRangeBar: () => null }));

import { Route } from "../../routes/reports";

const ReportsPage = (Route as unknown as { options: { component: () => React.ReactElement } }).options.component;

function openTab(tab: string, preset: string) {
  localStorage.setItem("hisaabo_reports_tab", tab);
  localStorage.setItem("hisaabo-daterange-reports", preset);
}

beforeEach(() => {
  cleanup();
  calls.length = 0;
  localStorage.clear();
  stockData = undefined;
});

describe("Business Reports query inputs", () => {
  const TABS: Array<[string, string]> = [
    ["daybook", "reports.daybook"],
    ["sales-register", "reports.salesRegister"],
    ["purchase-register", "reports.purchaseRegister"],
    ["collection-metrics", "reports.collectionEfficiency"],
    ["item-wise-sales", "reports.itemSales"],
    ["payment-summary", "reports.paymentSummary"],
    ["tax-summary", "reports.taxSummary"],
    ["cash-flow", "reports.cashFlowStatement"],
  ];

  it.each(TABS)("%s: input is stable across re-renders and omits dates for 'All'", async (tab, proc) => {
    openTab(tab, "all");
    const { rerender } = render(<ReportsPage />);
    await new Promise((r) => setTimeout(r, 5));
    rerender(<ReportsPage />);

    const mine = calls.filter((c) => c.proc === proc);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    // Same serialised input every render => same react-query key => no refetch loop.
    const keys = new Set(mine.map((c) => JSON.stringify(c.input)));
    expect(keys.size).toBe(1);
    const input = mine[0]!.input as { fromDate?: string; toDate?: string };
    expect(input.fromDate).toBeUndefined();
    expect(input.toDate).toBeUndefined();
    // Queries are not disabled just because the range is open-ended.
    expect((mine[0]!.opts as { enabled?: boolean } | undefined)?.enabled ?? true).toBe(true);
  });

  it.each(TABS)("%s: sends ISO datetimes for a bounded preset", (tab, proc) => {
    openTab(tab, "this-month");
    render(<ReportsPage />);
    const input = calls.find((c) => c.proc === proc)!.input as { fromDate?: string; toDate?: string };
    expect(input.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(input.toDate).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

describe("Stock Summary", () => {
  it("links item names to the item detail page", () => {
    openTab("stock-summary", "all");
    stockData = {
      simpleItems: [
        { itemId: "item-1", itemName: "Steel Rod", category: null, hsn: null, unit: "kg", currentStock: "5", purchasePrice: "10", salePrice: "12", stockValue: "50", stockValueAtSale: "60", lowStockAlert: null, isLowStock: false },
      ],
      variantItems: [
        { itemId: "item-2", itemName: "T-Shirt", category: null, hsn: null, unit: "pcs", totalStock: "3", totalValue: "30", totalValueAtSale: "40", variantDetails: [] },
      ],
      summary: { totalCostValue: "80", totalSaleValue: "100", totalSkuCount: 2, lowStockCount: 0, zeroStockCount: 0 },
    };
    render(<ReportsPage />);
    expect(screen.getByRole("link", { name: "Steel Rod" })).toHaveAttribute("href", "/items?id=item-1");
    expect(screen.getByRole("link", { name: "T-Shirt" })).toHaveAttribute("href", "/items?id=item-2");
  });
});
