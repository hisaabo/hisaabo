import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { InputField } from "@/components/ui/FormField";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import type { PartyType } from "@hisaabo/shared";

export interface QuickPartyCreateProps {
  open: boolean;
  onClose: () => void;
  /** Called with the newly created party after successful creation */
  onCreated: (party: { id: string; name: string }) => void;
  /** Pre-fill the name field (e.g. from the Combobox search query) */
  initialName?: string;
  /** Auto-set the party type based on invoice context */
  defaultType?: PartyType;
}

export function QuickPartyCreate({
  open,
  onClose,
  onCreated,
  initialName = "",
  defaultType = "customer",
}: QuickPartyCreateProps) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [partyType, setPartyType] = useState<PartyType>(defaultType);

  // Sync state when the dialog opens with new props
  useEffect(() => {
    if (open) {
      setName(initialName);
      setPhone("");
      setPartyType(defaultType);
    }
  }, [open, initialName, defaultType]);

  const utils = trpc.useUtils();

  const createMutation = trpc.party.create.useMutation({
    onSuccess: (data) => {
      utils.party.list.invalidate();
      toast.success(`${partyType === "customer" ? "Customer" : "Supplier"} created`);
      onCreated({ id: data.id, name: data.name });
      resetAndClose();
    },
    onError: (err) => {
      toast.error("Failed to create party", err.message);
    },
  });

  function resetAndClose() {
    setName("");
    setPhone("");
    onClose();
  }

  const canSubmit = !!name.trim() && !!phone.trim();

  function handleSubmit() {
    if (!canSubmit) return;
    createMutation.mutate({
      type: partyType,
      name: name.trim(),
      phone: phone.trim(),
    });
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title={`New ${partyType === "customer" ? "Customer" : "Supplier"}`}
      className="max-w-sm"
    >
      <div className="space-y-4">
        <InputField
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Party name"
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <InputField
          label="Phone"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          type="tel"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <div>
          <label className="label">Type</label>
          <div className="flex gap-2 mt-1">
            {(["customer", "supplier"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPartyType(t)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors border ${
                  partyType === t
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-border-light text-text-secondary hover:bg-surface-1"
                }`}
              >
                {t === "customer" ? "Customer" : "Supplier"}
              </button>
            ))}
          </div>
        </div>

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
