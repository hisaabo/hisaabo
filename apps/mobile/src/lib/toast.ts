/**
 * A tiny non-blocking notification channel ("toast"). Unlike Alert.alert it
 * never interrupts the user, so it is the right tool for "this side effect
 * did not work, but what you were doing did" (e.g. the bill saved, the saved
 * item prices did not update). <ToastHost /> in the root layout renders it, so a
 * toast survives the screen that raised it being replaced.
 */

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let nextId = 0;

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function show(kind: ToastKind, title: string, description?: string): void {
  const t: Toast = { id: ++nextId, kind, title, description };
  listeners.forEach((fn) => fn(t));
}

export const toast = {
  success: (title: string, description?: string) => show("success", title, description),
  error: (title: string, description?: string) => show("error", title, description),
  info: (title: string, description?: string) => show("info", title, description),
};
