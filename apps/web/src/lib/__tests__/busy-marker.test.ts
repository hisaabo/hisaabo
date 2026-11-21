/**
 * busy-marker unit tests.
 *
 * `<html data-busy>` is the ready signal the e2e suite waits on, so the two
 * ways it can lie matter: reporting idle while work is pending (tests proceed
 * too early / absence checks pass vacuously) and staying busy forever (every
 * settle() times out). Both are covered here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { BUSY_ATTRIBUTE, holdBusy, installBusyMarker } from "../busy-marker";
import { useDebounce } from "@/hooks/useDebounce";

const busy = () => document.documentElement.hasAttribute(BUSY_ATTRIBUTE);

/** A promise the test resolves/rejects by hand. */
function deferred<T = string>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("installBusyMarker", () => {
  let queryClient: QueryClient;
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    dispose = installBusyMarker(queryClient);
  });

  afterEach(() => {
    dispose();
    queryClient.clear();
    vi.useRealTimers();
  });

  it("is not busy when nothing is in flight", async () => {
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("is busy for the whole life of a fetch and clears shortly after it resolves", async () => {
    const d = deferred();
    const fetching = queryClient.fetchQuery({ queryKey: ["a"], queryFn: () => d.promise });
    expect(busy()).toBe(true); // same task the fetch started in

    await vi.advanceTimersByTimeAsync(500);
    expect(busy()).toBe(true); // still pending

    d.resolve("done");
    await fetching;
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("clears after a failed fetch too", async () => {
    const d = deferred();
    const fetching = queryClient.fetchQuery({ queryKey: ["a"], queryFn: () => d.promise }).catch(() => "failed");
    expect(busy()).toBe(true);
    d.reject(new Error("boom"));
    await fetching;
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("is busy while a mutation is pending", async () => {
    const d = deferred();
    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: () => d.promise })
      .execute(undefined);
    expect(busy()).toBe(true);
    d.resolve("saved");
    await mutation;
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("stays busy across back-to-back work (a refetch started right after a fetch ends)", async () => {
    const first = deferred();
    const second = deferred();
    const p1 = queryClient.fetchQuery({ queryKey: ["a"], queryFn: () => first.promise });
    first.resolve("one");
    await p1;
    // The follow-up starts a task later, e.g. an invalidation or a route mounting.
    await vi.advanceTimersByTimeAsync(0);
    expect(busy()).toBe(true); // not cleared in between: the grace period is still running
    const p2 = queryClient.fetchQuery({ queryKey: ["b"], queryFn: () => second.promise });
    await vi.advanceTimersByTimeAsync(100);
    expect(busy()).toBe(true);
    second.resolve("two");
    await p2;
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("holdBusy keeps the page busy until released; release is idempotent", async () => {
    const release = holdBusy();
    expect(busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(busy()).toBe(true);
    release();
    release();
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("two holds need two releases", async () => {
    const a = holdBusy();
    const b = holdBusy();
    a();
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(true);
    b();
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("a leaked hold expires on its own and cannot leave the attribute stuck", async () => {
    holdBusy(2_000);
    await vi.advanceTimersByTimeAsync(1_900);
    expect(busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(busy()).toBe(false);
  });

  it("still clears when requestAnimationFrame never fires (hidden tab)", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    try {
      const release = holdBusy();
      release();
      await vi.advanceTimersByTimeAsync(200);
      expect(busy()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("dispose removes the attribute and stops listening", async () => {
    const d = deferred();
    void queryClient.fetchQuery({ queryKey: ["a"], queryFn: () => d.promise });
    expect(busy()).toBe(true);
    dispose();
    expect(busy()).toBe(false);
    void queryClient.fetchQuery({ queryKey: ["b"], queryFn: () => d.promise });
    expect(busy()).toBe(false);
    d.resolve("x");
  });
});

describe("useDebounce busy hold", () => {
  let queryClient: QueryClient;
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    dispose = installBusyMarker(queryClient);
  });

  afterEach(() => {
    dispose();
    queryClient.clear();
    vi.useRealTimers();
  });

  it("is busy from the input change until the debounced value is committed", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "" },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false); // mounting alone is not a pending debounce

    rerender({ value: "abc" });
    expect(busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(299);
    expect(busy()).toBe(true);
    expect(result.current).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current).toBe("abc");
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("is released when the component unmounts mid-debounce", async () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "" },
    });
    rerender({ value: "abc" });
    expect(busy()).toBe(true);
    unmount();
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });

  it("a value that goes back to the committed one is not pending", async () => {
    const { rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: "a" },
    });
    rerender({ value: "ab" });
    expect(busy()).toBe(true);
    rerender({ value: "a" });
    await vi.advanceTimersByTimeAsync(50);
    expect(busy()).toBe(false);
  });
});
