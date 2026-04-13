import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

export const Route = createFileRoute("/delivery-challans")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: DeliveryChallansPage,
});

function DeliveryChallansPage() {
  const { id } = useSearch({ from: "/delivery-challans" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "deliveryChallan",
        documentType: "delivery_challan",
        hasTypeFilter: true,
        title: "Delivery Challans",
        description: "Manage delivery challans and dispatch notes",
        buttonLabel: "+ New Challan",
        statusTabs: [
          { value: "", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No delivery challans found",
        emptyDescription: (type, status) =>
          `No ${type === "sale" ? "sales" : "purchase"} delivery challans${status ? ` with status "${status}"` : ""}.`,
        emptyIconPath:
          "M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V8l-4-4H8zm0 0v4h4M8 12h8M8 16h4",
        col2Header: "Challan #",
        col4Variant: "dueDate",
        col4Header: "Due Date",
        markSent: true,
      }}
    />
  );
}
