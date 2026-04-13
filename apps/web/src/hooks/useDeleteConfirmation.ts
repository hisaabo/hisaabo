import { useState } from "react";

export function useDeleteConfirmation() {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  return {
    deleteTarget,
    requestDelete: (id: string, name: string) => setDeleteTarget({ id, name }),
    cancelDelete: () => setDeleteTarget(null),
    isOpen: !!deleteTarget,
  };
}
