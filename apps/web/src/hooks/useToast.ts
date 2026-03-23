import { useState, useEffect, useCallback } from "react";

type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

type Listener = (toast: Toast) => void;
const listeners: Set<Listener> = new Set();
let toastId = 0;

export function toast(options: ToastOptions) {
  const t: Toast = {
    id: String(++toastId),
    title: options.title,
    description: options.description,
    variant: options.variant || "info",
  };
  listeners.forEach((fn) => fn(t));
}

toast.success = (title: string, description?: string) =>
  toast({ title, description, variant: "success" });
toast.error = (title: string, description?: string) =>
  toast({ title, description, variant: "error" });
toast.info = (title: string, description?: string) =>
  toast({ title, description, variant: "info" });

export function useToastListener() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener: Listener = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 4000);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, dismiss };
}
