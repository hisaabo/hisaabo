import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { registerConfirmHost, type ConfirmRequest } from "@/lib/webmcp/confirm";

interface Pending {
  request: ConfirmRequest;
  resolve: (ok: boolean) => void;
}

/** Hosts the confirmation dialog for browser-agent writes. Mount once, near the app root. */
export function WebMcpConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);
  const active = useRef(false);
  const currentRef = useRef<Pending | null>(null);

  const next = useCallback(() => {
    const item = queue.current.shift();
    active.current = !!item;
    currentRef.current = item ?? null;
    setCurrent(item ?? null);
  }, []);

  useEffect(() => {
    const unregister = registerConfirmHost(
      (request) =>
        new Promise<boolean>((resolve) => {
          queue.current.push({ request, resolve });
          if (!active.current) next();
        }),
    );
    return () => {
      unregister();
      currentRef.current?.resolve(false);
      currentRef.current = null;
      for (const item of queue.current) item.resolve(false);
      queue.current = [];
      active.current = false;
    };
  }, [next]);

  function settle(ok: boolean) {
    current?.resolve(ok);
    next();
  }

  return (
    <ConfirmDialog
      open={current !== null}
      title={current?.request.title ?? ""}
      description={current?.request.description}
      confirmLabel="Allow"
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
