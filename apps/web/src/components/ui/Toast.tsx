import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useToastListener } from "@/hooks/useToast";

function SuccessIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2z" />
    </svg>
  );
}

const variantStyles = {
  success: {
    icon: <SuccessIcon />,
    iconClass: "text-emerald-600",
    iconBg: "bg-emerald-50",
  },
  error: {
    icon: <ErrorIcon />,
    iconClass: "text-red-600",
    iconBg: "bg-red-50",
  },
  info: {
    icon: <InfoIcon />,
    iconClass: "text-blue-600",
    iconBg: "bg-blue-50",
  },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastListener();

  return createPortal(
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[360px] pointer-events-none">
      {toasts.map((t) => {
        const v = variantStyles[t.variant];
        return (
          <div
            key={t.id}
            className="card shadow-toast animate-toast-in pointer-events-auto flex items-start gap-3 px-4 py-3"
          >
            <div className={cn("flex items-center justify-center w-7 h-7 rounded-lg shrink-0 mt-0.5", v.iconBg, v.iconClass)}>
              {v.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {t.title}
              </p>
              {t.description && (
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {t.description}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn-icon shrink-0 -mr-1"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
