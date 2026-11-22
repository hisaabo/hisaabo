import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { registerConfirmHost, type ConfirmRequest } from "@/lib/webmcp/confirm";

interface Pending {
  request: ConfirmRequest;
  resolve: (ok: boolean) => void;
  /** Removes this request's abort listener once it has been settled. */
  dispose: () => void;
}

interface WebMcpConfirmHostProps {
  /**
   * Identifies who and what the pending prompts were raised for (user, tenant,
   * business) — null while signed out. When it changes, every prompt that is
   * open or queued is DENIED: an approval given after the user switched business
   * or signed out would otherwise be applied to a context they never saw.
   */
  scopeKey?: string | null;
}

/** Hosts the confirmation dialog for browser-agent writes. Mount once, near the app root. */
export function WebMcpConfirmHost({ scopeKey = null }: WebMcpConfirmHostProps) {
  const [current, setCurrent] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);
  const currentRef = useRef<Pending | null>(null);

  const showNext = useCallback(() => {
    const item = queue.current.shift() ?? null;
    currentRef.current = item;
    setCurrent(item);
  }, []);

  /** Settle one pending request wherever it is (open dialog or queue). */
  const settle = useCallback(
    (item: Pending, ok: boolean) => {
      item.dispose();
      item.resolve(ok);
      if (currentRef.current === item) {
        showNext();
      } else {
        queue.current = queue.current.filter((q) => q !== item);
      }
    },
    [showNext],
  );

  /** Deny everything that is open or queued. */
  const denyAll = useCallback(() => {
    const all = [currentRef.current, ...queue.current].filter((p): p is Pending => p !== null);
    currentRef.current = null;
    queue.current = [];
    setCurrent(null);
    for (const item of all) {
      item.dispose();
      item.resolve(false);
    }
  }, []);

  useEffect(() => {
    const unregister = registerConfirmHost(
      (request) =>
        new Promise<boolean>((resolve) => {
          if (request.signal?.aborted) {
            resolve(false);
            return;
          }
          const item: Pending = { request, resolve, dispose: () => {} };
          if (request.signal) {
            const onAbort = () => settle(item, false);
            request.signal.addEventListener("abort", onAbort, { once: true });
            item.dispose = () => request.signal?.removeEventListener("abort", onAbort);
          }
          if (currentRef.current) queue.current.push(item);
          else {
            currentRef.current = item;
            setCurrent(item);
          }
        }),
    );
    return () => {
      unregister();
      denyAll();
    };
  }, [settle, denyAll]);

  // A change of user, tenant or business denies every prompt raised before it.
  useEffect(() => denyAll, [scopeKey, denyAll]);

  return (
    <ConfirmDialog
      open={current !== null}
      title={current?.request.title ?? ""}
      description={current?.request.description}
      confirmLabel="Allow"
      onConfirm={() => current && settle(current, true)}
      onCancel={() => current && settle(current, false)}
    />
  );
}
