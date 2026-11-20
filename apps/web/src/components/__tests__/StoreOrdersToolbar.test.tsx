import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  const query = () => ({ data: undefined, isLoading: false });
  return {
    trpc: {
      useUtils: () => ({ store: { listOrders: { invalidate: vi.fn() } } }),
      store: {
        listOrders: { useQuery: () => ({ data: { data: [], total: 0 }, isLoading: false }) },
        getOrder: { useQuery: query },
        confirmOrder: { useMutation: mutation },
        cancelOrder: { useMutation: mutation },
        updateOrderStatus: { useMutation: mutation },
      },
    },
  };
});
vi.mock("@/hooks/useCan", () => ({ useCan: () => true }));

import { Route } from "../../routes/store-orders";

describe("Store Orders toolbar", () => {
  it("renders the search box first (left) and status filters last, like Invoices", () => {
    const Page = (Route as unknown as { component: () => React.JSX.Element }).component;
    render(<Page />);
    const search = screen.getByPlaceholderText(/Search customer, order/);
    // Same shared SearchInput styling as invoices.tsx
    expect(search).toHaveClass("input");
    const toolbar = search.closest("div.flex") as HTMLElement;
    const pill = screen.getByRole("button", { name: "Pending" });
    expect(
      search.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toolbar.lastElementChild).toHaveClass("ml-auto");
    expect(toolbar.lastElementChild).toContainElement(pill);
  });
});
