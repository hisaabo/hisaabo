import { renderHook, act } from "@testing-library/react";
import { useTheme } from "@/hooks/useTheme";

// Helper: create a minimal matchMedia mock that returns the given preference.
function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const mq = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
    // Trigger a synthetic change event on all registered listeners
    _triggerChange(newMatches: boolean) {
      mq.matches = newMatches;
      listeners.forEach((l) => {
        const fn = typeof l === "function" ? l : l.handleEvent.bind(l);
        fn(new Event("change"));
      });
    },
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mq),
  });

  return mq;
}

const STORAGE_KEY = "hisaabo-theme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    // Start each test with a clean class list
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("defaults to 'system' when localStorage has no value", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("reads saved theme from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("setTheme('dark') adds 'dark' class to documentElement", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("dark");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('light') removes 'dark' class from documentElement", () => {
    // Start with dark already applied
    document.documentElement.classList.add("dark");
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("light");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setTheme persists to localStorage", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("dark");
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");

    act(() => {
      result.current.setTheme("light");
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("'system' + dark matchMedia preference adds 'dark' class", () => {
    mockMatchMedia(true); // system prefers dark
    const { result } = renderHook(() => useTheme());

    // Ensure it starts as system
    expect(result.current.theme).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("'system' + light matchMedia preference does NOT add 'dark' class", () => {
    mockMatchMedia(false); // system prefers light
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("returns theme state that reflects the current value", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("system");

    act(() => {
      result.current.setTheme("dark");
    });
    expect(result.current.theme).toBe("dark");

    act(() => {
      result.current.setTheme("light");
    });
    expect(result.current.theme).toBe("light");

    act(() => {
      result.current.setTheme("system");
    });
    expect(result.current.theme).toBe("system");
  });

  it("system theme: registers matchMedia change listener and deregisters on unmount", () => {
    const mq = mockMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());

    // Should have registered a listener while theme === "system"
    expect(mq.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    unmount();

    // Cleanup should remove it
    expect(mq.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("switching away from system removes the matchMedia listener", () => {
    const mq = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    // Listener was added for "system"
    expect(mq.addEventListener).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setTheme("dark");
    });

    // The effect cleanup for the previous "system" theme should have removed the listener
    expect(mq.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
