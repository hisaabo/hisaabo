import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (party: { id: string; name: string }) => void;
  /** Fallback "Walk-in Customer" — offered as the first choice. */
  walkIn?: { id: string; name: string } | null;
}

/**
 * Compact customer picker for POS.
 *
 * One input field that searches both name and phone (server does ILIKE on
 * name; phone match is client-side). Inline "+ New" creates a party with
 * just name + optional phone — no GSTIN, no address. Retail walk-ins should
 * never hit this; returning customers get looked up by phone.
 */
export function CustomerPicker({ open, onClose, onPick, walkIn }: Props) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const { data } = trpc.party.list.useQuery(
    { search: search || null, type: "customer", page: 1, limit: 20 },
    { enabled: open && !creating, placeholderData: (prev) => prev },
  );

  const createMutation = trpc.party.create.useMutation({
    onSuccess: (party) => {
      toast.success(`Added ${party.name}`);
      onPick({ id: party.id, name: party.name });
      reset();
    },
    onError: (err) => toast.error("Could not add customer", err.message),
  });

  function reset() {
    setSearch("");
    setCreating(false);
    setNewName("");
    setNewPhone("");
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-[10vh]"
      onClick={reset}
    >
      <div
        className="w-full max-w-md bg-surface-1 border border-border rounded-lg shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {creating ? (
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Add customer</h3>
            <input
              autoFocus
              className="w-full px-3 py-2 rounded border border-border bg-surface-2 text-sm"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="w-full px-3 py-2 rounded border border-border bg-surface-2 text-sm"
              placeholder="Phone (optional)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setCreating(false)}>
                Back
              </button>
              <button
                className="btn-primary"
                disabled={!newName.trim() || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    type: "customer",
                    name: newName.trim(),
                    phone: newPhone.trim() || undefined,
                  })
                }
              >
                {createMutation.isPending ? "Adding…" : "Add + Select"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              autoFocus
              className="w-full px-3 py-2 rounded border border-border bg-surface-2 text-sm"
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="max-h-[40vh] overflow-y-auto divide-y divide-border border border-border rounded">
              {walkIn && (
                <li>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-surface-2 text-sm"
                    onClick={() => {
                      onPick(walkIn);
                      reset();
                    }}
                  >
                    <span className="font-medium">{walkIn.name}</span>
                    <span className="text-xs text-text-tertiary ml-2">(default)</span>
                  </button>
                </li>
              )}
              {(data?.data ?? [])
                .filter((p: any) => !walkIn || p.id !== walkIn.id)
                .map((p: any) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-surface-2 text-sm"
                      onClick={() => {
                        onPick({ id: p.id, name: p.name });
                        reset();
                      }}
                    >
                      <span className="font-medium">{p.name}</span>
                      {p.phone && (
                        <span className="text-xs text-text-tertiary ml-2">{p.phone}</span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
            <div className="flex gap-2 justify-between items-center">
              <button className="btn-secondary" onClick={reset}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => {
                  setCreating(true);
                  setNewName(search);
                }}
              >
                + New customer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
