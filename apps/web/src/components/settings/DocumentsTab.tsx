import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { InputField } from "@/components/ui/FormField";
import { toast } from "@/hooks/useToast";

interface DocumentsTabProps {
  biz: any;
}

const DOC_TYPES = [
  { key: "invoice", label: "Invoice", prefixField: "invoicePrefix", counterField: "nextInvoiceNumber" },
  { key: "payment", label: "Payment Receipt", prefixField: "paymentPrefix", counterField: "nextPaymentNumber" },
  { key: "quotation", label: "Quotation", prefixField: "quotationPrefix", counterField: "nextQuotationNumber" },
  { key: "credit_note", label: "Credit Note", prefixField: "creditNotePrefix", counterField: "nextCreditNoteNumber" },
  { key: "delivery_challan", label: "Delivery Challan", prefixField: "deliveryChallanPrefix", counterField: "nextDeliveryChallanNumber" },
  { key: "proforma", label: "Proforma Invoice", prefixField: "proformaPrefix", counterField: "nextProformaNumber" },
] as const;

export function DocumentsTab({ biz }: DocumentsTabProps) {
  const [prefixes, setPrefixes] = useState<Record<string, string>>(
    Object.fromEntries(DOC_TYPES.map((d) => [d.prefixField, biz[d.prefixField] || ""]))
  );
  const [editingSeq, setEditingSeq] = useState<string | null>(null);
  const [prefixesDirty, setPrefixesDirty] = useState(false);

  const utils = trpc.useUtils();

  const updateMutation = trpc.business.update.useMutation({
    onSuccess: () => {
      toast.success("Document prefixes saved");
      utils.business.list.invalidate();
      setPrefixesDirty(false);
    },
    onError: (err) => toast.error("Failed to save prefixes", err.message),
  });

  const updateSeqMutation = trpc.business.updateSequenceNumber.useMutation({
    onSuccess: () => {
      toast.success("Sequence number updated");
      utils.business.list.invalidate();
      setEditingSeq(null);
    },
    onError: (err) => toast.error("Failed to update sequence number", err.message),
  });

  function handlePrefixChange(field: string, value: string) {
    setPrefixes((prev) => ({ ...prev, [field]: value }));
    setPrefixesDirty(true);
  }

  function handleSavePrefixes() {
    const data = Object.fromEntries(
      DOC_TYPES.map((d) => [d.prefixField, prefixes[d.prefixField] || undefined])
    );
    updateMutation.mutate({ id: biz.id, data });
  }

  return (
    <div className="space-y-6">
      {/* Prefixes */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-border-light flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Document Prefixes</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Prefix used when generating document numbers (e.g. INV-0001)
            </p>
          </div>
          {prefixesDirty && (
            <button
              className="btn-primary btn-sm"
              onClick={handleSavePrefixes}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </button>
          )}
        </div>
        <div className="divide-y divide-border-light">
          {DOC_TYPES.map((doc) => (
            <div key={doc.key}>
              <div className="px-6 py-3 flex items-center gap-4">
                <span className="text-sm text-text-primary w-44 shrink-0">{doc.label}</span>
                <div className="w-36">
                  <input
                    className="input font-mono text-sm"
                    value={prefixes[doc.prefixField]}
                    onChange={(e) => handlePrefixChange(doc.prefixField, e.target.value.toUpperCase())}
                    placeholder="e.g. INV"
                    maxLength={10}
                  />
                </div>
                <span className="text-sm text-text-tertiary flex-1">
                  Next #:{" "}
                  <span className="font-mono text-text-primary">
                    {biz[doc.counterField] ?? 1}
                  </span>
                </span>
                <button
                  className="btn-ghost text-xs px-2 py-1"
                  onClick={() =>
                    setEditingSeq(editingSeq === doc.counterField ? null : doc.counterField)
                  }
                >
                  Change
                </button>
              </div>

              {editingSeq === doc.counterField && (
                <SequenceEditor
                  bizId={biz.id}
                  counterField={doc.counterField}
                  currentValue={biz[doc.counterField] ?? 1}
                  label={doc.label}
                  isPending={updateSeqMutation.isPending}
                  onConfirm={(newValue) =>
                    updateSeqMutation.mutate({
                      businessId: biz.id,
                      documentType: doc.key,
                      newNumber: newValue,
                    })
                  }
                  onCancel={() => setEditingSeq(null)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SequenceEditor({
  currentValue,
  label,
  isPending,
  onConfirm,
  onCancel,
}: {
  bizId: string;
  counterField: string;
  currentValue: number;
  label: string;
  isPending: boolean;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentValue);

  return (
    <div className="mx-6 mb-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Changing the sequence number for <strong>{label}</strong> will affect future document numbering.
          The next document will use this number.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-32">
          <InputField
            label="Next number"
            type="number"
            value={String(value)}
            onChange={(e) => setValue(Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
          />
        </div>
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => onConfirm(value)}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Confirm Change"}
          </button>
        </div>
      </div>
    </div>
  );
}
