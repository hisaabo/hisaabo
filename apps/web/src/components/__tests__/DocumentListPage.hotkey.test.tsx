import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/lib/trpc", () => {
  const query = () => ({ data: undefined, isLoading: false });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  const router = { list: { useQuery: () => ({ data: { data: [], total: 0 }, isLoading: false }) } };
  return {
    trpc: new Proxy(
      { useUtils: () => new Proxy({}, { get: () => ({ list: { invalidate: vi.fn() } }) }) },
      {
        get: (t, k) =>
          k in t
            ? (t as never)[k]
            : k === "invoice"
              ? { getById: { useQuery: query } }
              : { ...router, updateStatus: { useMutation: mutation }, delete: { useMutation: mutation } },
      },
    ),
  };
});
vi.mock("@/hooks/useCan", () => ({ useCan: () => true, useCanCreateDocument: () => true }));
vi.mock("@/components/DocumentCreator", () => ({
  DocumentCreator: () => <div data-testid="document-creator" />,
}));

import { DocumentListPage } from "../DocumentListPage";

describe("DocumentListPage N shortcut (Quotations)", () => {
  const config = {
    trpcRouter: "quotation",
    documentType: "quotation",
    defaultInvoiceType: "sale",
    title: "Quotations",
    description: "Manage sales quotations",
    buttonLabel: "+ New Quotation",
    statusTabs: [{ value: "", label: "All" }],
    emptyTitle: "No quotations found",
    emptyDescription: () => "none",
    emptyIconPath: "M0 0",
    col2Header: "Quotation #",
    col4Variant: "dueDate",
    col4Header: "Due Date",
  } as never;

  it("opens the creator on N and shows the hint on the button", async () => {
    render(<DocumentListPage config={config} />);
    expect(screen.getAllByRole("button", { name: /New Quotation/ })[0]).toHaveTextContent("N");
    expect(screen.queryByTestId("document-creator")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(await screen.findByTestId("document-creator")).toBeInTheDocument();
  });
});
