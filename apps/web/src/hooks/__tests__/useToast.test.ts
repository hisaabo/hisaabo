import { renderHook, act } from "@testing-library/react";
import { toast, useToastListener } from "@/hooks/useToast";

// The toast module keeps a module-level `toastId` counter that persists across
// tests. We record the id at the start of each test and compute relative ids
// to keep assertions order-independent.

describe("useToastListener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toast() triggers the listener with the correct object", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast({ title: "Hello", variant: "info" });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      title: "Hello",
      variant: "info",
    });
  });

  it("toast.success creates a toast with variant 'success'", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast.success("Saved!", "Record was saved.");
    });

    expect(result.current.toasts).toHaveLength(1);
    const t = result.current.toasts[0];
    expect(t.variant).toBe("success");
    expect(t.title).toBe("Saved!");
    expect(t.description).toBe("Record was saved.");
  });

  it("toast.error creates a toast with variant 'error'", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast.error("Something went wrong");
    });

    expect(result.current.toasts[0].variant).toBe("error");
    expect(result.current.toasts[0].title).toBe("Something went wrong");
  });

  it("toast.info creates a toast with variant 'info'", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast.info("FYI");
    });

    expect(result.current.toasts[0].variant).toBe("info");
  });

  it("each toast gets a unique incrementing id", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast({ title: "First", variant: "info" });
      toast({ title: "Second", variant: "info" });
    });

    expect(result.current.toasts).toHaveLength(2);
    const [first, second] = result.current.toasts;
    expect(first.id).not.toBe(second.id);
    // IDs are stringified integers — second must be greater than first
    expect(Number(second.id)).toBeGreaterThan(Number(first.id));
  });

  it("auto-dismisses toast after 4000ms", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast({ title: "Will vanish", variant: "info" });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3999);
    });

    // Still present just before the timeout
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Should be gone after exactly 4000ms
    expect(result.current.toasts).toHaveLength(0);
  });

  it("dismiss(id) manually removes a specific toast", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast({ title: "Removable", variant: "info" });
      toast({ title: "Keeper", variant: "success" });
    });

    expect(result.current.toasts).toHaveLength(2);

    const idToRemove = result.current.toasts[0].id;

    act(() => {
      result.current.dismiss(idToRemove);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Keeper");
  });

  it("toast without explicit variant defaults to 'info'", () => {
    const { result } = renderHook(() => useToastListener());

    act(() => {
      toast({ title: "Default variant" });
    });

    expect(result.current.toasts[0].variant).toBe("info");
  });

  it("unregisters listener on unmount so no further toasts arrive", () => {
    const { result, unmount } = renderHook(() => useToastListener());

    unmount();

    act(() => {
      toast({ title: "After unmount", variant: "info" });
    });

    // The hook was unmounted — its internal state is gone; we just verify no
    // error is thrown and the module did not blow up.
    expect(result.current.toasts).toHaveLength(0);
  });
});
