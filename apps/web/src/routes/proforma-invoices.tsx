import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { DocumentListPage } from "@/components/DocumentListPage";

export const Route = createFileRoute("/proforma-invoices")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: ProformaInvoicesPage,
});

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "cancelled", label: "Cancelled" },
];

function ProformaInvoicesPage() {
  const navigate = useNavigate();
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: () => {
      toast.success("Converted to invoice");
      utils.invoice.list.invalidate();
      setConvertingId(null);
      navigate({ to: "/invoices" });
    },
    onError: (err) => {
      toast.error("Failed to convert", err.message);
      setConvertingId(null);
    },
  });

  function handleConvert(id: string) {
    setConvertingId(id);
    convertMutation.mutate({ sourceDocumentId: id, targetDocumentType: "invoice" });
  }

  return (
    <DocumentListPage
      config={{
        trpcRouter: "proforma",
        documentType: "proforma",
        defaultInvoiceType: "sale",
        title: "Proforma Invoices",
        description: "Manage proforma invoices",
        buttonLabel: "+ New Proforma",
        statusTabs: STATUS_TABS,
        emptyTitle: "No proforma invoices found",
        emptyDescription: (_type, status) =>
          `No proforma invoices${status ? ` with status "${status}"` : ""}.`,
        emptyIconPath:
          "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
        col2Header: "Proforma #",
        col4Variant: "dueDate",
        col4Header: "Due Date",
        markSent: true,
        convert: { convertingId, onConvert: handleConvert },
      }}
    />
  );
}
