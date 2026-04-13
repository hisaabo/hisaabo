import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface DeleteConfirmDialogProps {
  target: { id: string; name: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  entityName: string;
}

export function DeleteConfirmDialog({
  target,
  onConfirm,
  onCancel,
  loading,
  entityName,
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={!!target}
      title={`Delete ${entityName}`}
      description={`Delete ${target?.name}? This action cannot be undone.`}
      confirmLabel="Delete"
      variant="danger"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
