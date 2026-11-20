import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";

const POLL_MS = 5000;

/**
 * Load data and refresh it every 5 s while the tab is visible. Returns the
 * latest data, the last error and a manual reload.
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await reload();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload };
}

// ── Router: pushState over the /ops/ base ───────────────────

const BASE = "/ops/";
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}

function currentRoute(): string {
  const path = window.location.pathname.startsWith(BASE) ? window.location.pathname.slice(BASE.length) : "";
  return `${path}${window.location.search}`;
}

export function useRoute(): { path: string; query: URLSearchParams } {
  const route = useSyncExternalStore(subscribe, currentRoute);
  const [path, search = ""] = route.split("?");
  return { path, query: new URLSearchParams(search) };
}

export function navigate(to: string) {
  window.history.pushState(null, "", `${BASE}${to.replace(/^\//, "")}`);
  for (const fn of listeners) fn();
}
