import { Modal } from "./Modal";
import { Spinner } from "./Spinner";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} className="max-w-sm">
      <div className="pb-2">
        <p className="text-sm font-semibold text-text-primary">
          {title}
        </p>
        {description && (
          <p className="text-sm mt-2 text-text-secondary">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
        <button
          type="button"
          className="btn-ghost"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="button"
          className={variant === "danger" ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading && <Spinner size="sm" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
