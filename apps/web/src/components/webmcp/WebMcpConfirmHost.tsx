import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { WRITE_BUDGET } from "@/lib/webmcp/budget";
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
  // How many prompts are open or waiting. A rising number is the sign of an
  // agent flooding the user, and the cue to use "Deny all" instead of clicking through.
  const [pendingCount, setPendingCount] = useState(0);
  const queue = useRef<Pending[]>([]);
  const currentRef = useRef<Pending | null>(null);

  const syncCount = useCallback(() => {
    setPendingCount((currentRef.current ? 1 : 0) + queue.current.length);
  }, []);

  const showNext = useCallback(() => {
    const item = queue.current.shift() ?? null;
    currentRef.current = item;
    setCurrent(item);
    syncCount();
  }, [syncCount]);

  /** Settle one pending request wherever it is (open dialog or queue). */
  const settle = useCallback(
    (item: Pending, ok: boolean) => {
      item.dispose();
      item.resolve(ok);
      if (currentRef.current === item) {
        showNext();
      } else {
        queue.current = queue.current.filter((q) => q !== item);
        syncCount();
      }
    },
    [showNext, syncCount],
  );

  /** Deny everything that is open or queued. */
  const denyAll = useCallback(() => {
    const all = [currentRef.current, ...queue.current].filter((p): p is Pending => p !== null);
    currentRef.current = null;
    queue.current = [];
    setCurrent(null);
    setPendingCount(0);
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
          syncCount();
        }),
    );
    return () => {
      unregister();
      denyAll();
    };
  }, [settle, denyAll, syncCount]);

  // A change of user, tenant or business denies every prompt raised before it.
  useEffect(() => denyAll, [scopeKey, denyAll]);

  const request = current?.request;

  return (
    <Modal open={current !== null} onClose={() => current && settle(current, false)} className="max-w-md">
      <div className="pb-2" data-testid="webmcp-confirm">
        {pendingCount > 1 && (
          <p
            className="mb-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            role="status"
          >
            {pendingCount} pending
          </p>
        )}
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
        {request?.writesLeft !== undefined && (
          <p className="mt-3 text-xs text-text-tertiary">
            {request.writesLeft} of {WRITE_BUDGET} agent writes left this session.
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
        {pendingCount > 1 && (
          <button type="button" className="btn-ghost mr-auto" onClick={denyAll}>
            Deny all
          </button>
        )}
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
