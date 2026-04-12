import { createFileRoute } from "@tanstack/react-router";
import { DocumentListPage } from "@/components/DocumentListPage";

export const Route = createFileRoute("/credit-notes")({
  component: CreditNotesPage,
});

function CreditNotesPage() {
  return (
    <DocumentListPage
      config={{
        trpcRouter: "creditNote",
        documentType: "credit_note",
        hasTypeFilter: true,
        title: "Credit Notes",
        description: "Manage sales and purchase credit notes",
        buttonLabel: "+ New Credit Note",
        statusTabs: [
          { value: "", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "paid", label: "Paid" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No credit notes found",
        emptyDescription: (type, status) =>
          `No ${type === "sale" ? "sales" : "purchase"} credit notes${status ? ` with status "${status}"` : ""}.`,
        emptyIconPath:
          "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
        col2Header: "Credit Note #",
        col4Variant: "refInvoice",
        col4Header: "Ref. Invoice",
        markSent: true,
        markPaid: true,
      }}
    />
  );
}
