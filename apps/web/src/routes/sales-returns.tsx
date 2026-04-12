import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

export const Route = createFileRoute("/sales-returns")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: SalesReturnsPage,
});

function SalesReturnsPage() {
  const { id } = useSearch({ from: "/sales-returns" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "salesReturn",
        documentType: "sales_return",
        defaultInvoiceType: "sale",
        title: "Sales Returns",
        description: "Manage returned goods from customers",
        buttonLabel: "+ New Sales Return",
        statusTabs: [
          { value: "", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No sales returns found",
        emptyDescription: (_type, status) =>
          `No sales returns${status ? ` with status "${status}"` : ""}.`,
        emptyIconPath: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
        col2Header: "Return #",
        col4Variant: "refInvoice",
        col4Header: "Ref. Invoice",
        markSent: true,
      }}
    />
  );
}
