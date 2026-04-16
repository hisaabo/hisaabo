import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { units, type Unit } from "@hisaabo/shared";

export interface QuickItemCreateResult {
  id: string;
  name: string;
  salePrice?: string;
  purchasePrice?: string;
  taxPercent: string;
  unit: string;
}

export interface QuickItemCreateProps {
  open: boolean;
  onClose: () => void;
  /** Called with the newly created item after successful creation */
  onCreated: (item: QuickItemCreateResult) => void;
  /** Pre-fill the name field (e.g. from the Combobox search query) */
  initialName?: string;
  /** Show sale price vs purchase price based on invoice type */
  invoiceType?: "sale" | "purchase";
}

const TAX_PRESETS = ["0", "5", "12", "18", "28"];

export function QuickItemCreate({
  open,
  onClose,
  onCreated,
  initialName = "",
  invoiceType = "sale",
}: QuickItemCreateProps) {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [customTax, setCustomTax] = useState(false);
  const [unit, setUnit] = useState<Unit | "">("");

  // Sync state when the dialog opens with new props
  useEffect(() => {
    if (open) {
      setName(initialName);
      setPrice("");
      setTaxPercent("0");
      setCustomTax(false);
      setUnit("");
    }
  }, [open, initialName]);

  const utils = trpc.useUtils();

  const createMutation = trpc.item.create.useMutation({
    onSuccess: (data) => {
      utils.item.list.invalidate();
      toast.success("Item created");
      onCreated({
        id: data.id,
        name: data.name,
        salePrice: invoiceType === "sale" ? price || undefined : undefined,
        purchasePrice: invoiceType === "purchase" ? price || undefined : undefined,
        taxPercent: taxPercent || "0",
        unit: unit || "pcs",
      });
      resetAndClose();
    },
    onError: (err) => {
      toast.error("Failed to create item", err.message);
    },
  });

  function resetAndClose() {
    setName("");
    setPrice("");
    setTaxPercent("0");
    setCustomTax(false);
    setUnit("");
    onClose();
  }

  const canSubmit = !!name.trim() && !!unit;

  function handleSubmit() {
    if (!canSubmit) return;
    createMutation.mutate({
      name: name.trim(),
      unit: unit as Unit,
      taxPercent: taxPercent || "0",
      ...(invoiceType === "sale"
        ? { salePrice: price || undefined }
        : { purchasePrice: price || undefined }),
    });
  }

  const priceLabel = invoiceType === "sale" ? "Sale Price" : "Purchase Price";

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="New Item"
      className="max-w-sm"
    >
      <div className="space-y-4">
        <InputField
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <InputField
          label={priceLabel}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          type="number"
          min="0"
          step="0.01"
          className="tabular-nums"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <div>
          <label className="label">Tax %</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {TAX_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTaxPercent(t);
                  setCustomTax(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  taxPercent === t && !customTax
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-border-light text-text-secondary hover:bg-surface-1"
                }`}
              >
                {t}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomTax(true)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                customTax
                  ? "bg-brand-600 text-white border-brand-600"
                  : "border-border-light text-text-secondary hover:bg-surface-1"
              }`}
            >
              Custom
            </button>
          </div>
          {customTax && (
            <input
              className="input mt-2 tabular-nums w-24"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="0"
              autoFocus
            />
          )}
        </div>

        <SelectField
          label="Unit"
          required
          value={unit}
          onChange={(e) => setUnit(e.target.value as Unit)}
        >
          <option value="" disabled>
            Select unit...
          </option>
          {units.map((u) => (
            <option key={u} value={u}>
              {u.toUpperCase()}
            </option>
          ))}
        </SelectField>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={resetAndClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={createMutation.isPending || !canSubmit}
          >
            {createMutation.isPending ? "Creating..." : "Create & Select"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
