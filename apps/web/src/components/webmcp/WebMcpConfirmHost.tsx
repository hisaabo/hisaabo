import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
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

  const request = current?.request;

  return (
    <Modal open={current !== null} onClose={() => current && settle(current, false)} className="max-w-md">
      <div className="pb-2" data-testid="webmcp-confirm">
        <p className="text-sm font-semibold text-text-primary">{request?.title}</p>
        <p className="text-sm mt-2 text-text-secondary">{request?.description}</p>
        {request?.lines && request.lines.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-text-primary list-disc pl-5">
            {request.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        {request?.changes && request.changes.length > 0 && (
          <dl className="mt-3 space-y-1 text-sm">
            {request.changes.map((change, i) => (
              <div key={i} className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-text-primary">{change.field}:</dt>
                <dd className="text-text-secondary">
                  <span className="line-through">{change.before}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> changes to </span>
                  <span className="font-medium text-text-primary">{change.after}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
        <button type="button" className="btn-ghost" onClick={() => current && settle(current, false)}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => current && settle(current, true)}>
          Allow
        </button>
      </div>
    </Modal>
  );
}
