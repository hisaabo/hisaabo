/**
 * Busy marker: `<html data-busy>` is present while the app is waiting on
 * something it started — a react-query fetch, a mutation, or a debounced value
 * that has not been committed yet. End-to-end tests wait for
 * `html:not([data-busy])` instead of sleeping or guessing which network
 * response to wait for (see e2e/helpers/settle.ts).
 *
 * It is derived, never counted: every change re-reads
 * `queryClient.isFetching() + isMutating()` and the set of live holds, so a
 * missed event cannot leave the attribute stuck. Holds also expire on their
 * own (`maxHoldMs`), and clearing is bounded by a timer fallback for pages
 * where requestAnimationFrame never fires (hidden tabs).
 *
 * The attribute is cleared a frame (and a task) AFTER the last thing finishes
 * rather than immediately: finishing one piece of work routinely starts the
 * next one a tick later (invalidate → refetch, debounce commit → new query key
 * → fetch, navigation → route mounts → its queries start). Clearing in that
 * gap would let a test observe a false "idle".
 */
import type { QueryClient } from "@tanstack/react-query";

export const BUSY_ATTRIBUTE = "data-busy";

/** Upper bound for a hold. Debounces are 300ms; this only exists so a leaked hold can never stick. */
const DEFAULT_MAX_HOLD_MS = 10_000;
/** Fallback for clearing when requestAnimationFrame does not fire. */
const CLEAR_FALLBACK_MS = 100;

const holds = new Set<symbol>();
let onHoldChange: (() => void) | null = null;

/**
 * Mark the app busy until the returned function is called (idempotent) or
 * `maxHoldMs` passes. Works without an installed marker (no-op bookkeeping).
 */
export function holdBusy(maxHoldMs: number = DEFAULT_MAX_HOLD_MS): () => void {
  const token = Symbol("busy-hold");
  holds.add(token);
  let expiry: ReturnType<typeof setTimeout> | undefined = setTimeout(release, maxHoldMs);
  function release() {
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
    if (holds.delete(token)) onHoldChange?.();
  }
  onHoldChange?.();
  return release;
}

/**
 * Keep `root`'s `data-busy` attribute in sync with `queryClient` and
 * `holdBusy()`. Returns a function that removes the subscriptions and the
 * attribute. Install once, before the first query can start.
 */
export function installBusyMarker(
  queryClient: QueryClient,
  root: HTMLElement = document.documentElement,
): () => void {
  let disposed = false;
  let cancelClear: (() => void) | null = null;

  const isBusy = () =>
    queryClient.isFetching() > 0 || queryClient.isMutating() > 0 || holds.size > 0;

  function clearAttributeWhenStillIdle() {
    cancelClear = null;
    if (!disposed && !isBusy()) root.removeAttribute(BUSY_ATTRIBUTE);
  }

  function scheduleClear() {
    if (cancelClear) return;
    let raf: number | undefined;
    let afterFrame: ReturnType<typeof setTimeout> | undefined;
    const fallback = setTimeout(run, CLEAR_FALLBACK_MS);
    function run() {
      cancel();
      clearAttributeWhenStillIdle();
    }
    function cancel() {
      if (raf !== undefined) cancelAnimationFrame(raf);
      clearTimeout(afterFrame);
      clearTimeout(fallback);
      cancelClear = null;
    }
    if (typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(() => {
        afterFrame = setTimeout(run, 0);
      });
    }
    cancelClear = cancel;
  }

  function update() {
    if (disposed) return;
    if (isBusy()) {
      cancelClear?.();
      if (!root.hasAttribute(BUSY_ATTRIBUTE)) root.setAttribute(BUSY_ATTRIBUTE, "");
    } else if (root.hasAttribute(BUSY_ATTRIBUTE)) {
      scheduleClear();
    }
  }

  // QueryCache / MutationCache listeners run synchronously inside the state
  // change, so the attribute goes up in the same task a fetch or mutation starts.
  const unsubscribeQueries = queryClient.getQueryCache().subscribe(update);
  const unsubscribeMutations = queryClient.getMutationCache().subscribe(update);
  onHoldChange = update;
  update();

  return () => {
    disposed = true;
    cancelClear?.();
    unsubscribeQueries();
    unsubscribeMutations();
    if (onHoldChange === update) onHoldChange = null;
    root.removeAttribute(BUSY_ATTRIBUTE);
  };
}
