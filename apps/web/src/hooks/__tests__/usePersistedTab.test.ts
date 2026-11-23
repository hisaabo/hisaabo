import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePersistedTab } from "../usePersistedTab";

const TABS = ["dashboard", "ledger", "aging"] as const;
type Tab = (typeof TABS)[number];
const KEY = "hisaabo_test_tab";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("usePersistedTab", () => {
  it("starts on the fallback when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedTab<Tab>(KEY, TABS, "dashboard"));
    expect(result.current[0]).toBe("dashboard");
  });

  it("restores a stored tab that is in the list", () => {
    localStorage.setItem(KEY, "aging");
    const { result } = renderHook(() => usePersistedTab<Tab>(KEY, TABS, "dashboard"));
    expect(result.current[0]).toBe("aging");
  });

  it("ignores a stored value that is not a known tab", () => {
    localStorage.setItem(KEY, "credit-card-4111");
    const { result } = renderHook(() => usePersistedTab<Tab>(KEY, TABS, "dashboard"));
    expect(result.current[0]).toBe("dashboard");
  });

  it("remembers a chosen tab and refuses unknown ones", () => {
    const { result } = renderHook(() => usePersistedTab<Tab>(KEY, TABS, "dashboard"));
    act(() => result.current[1]("ledger"));
    expect(result.current[0]).toBe("ledger");
    expect(localStorage.getItem(KEY)).toBe("ledger");
    act(() => result.current[1]("nope" as Tab));
    expect(result.current[0]).toBe("ledger");
    expect(localStorage.getItem(KEY)).toBe("ledger");
  });

  it("still works when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => usePersistedTab<Tab>(KEY, TABS, "dashboard"));
    expect(result.current[0]).toBe("dashboard");
    act(() => result.current[1]("aging"));
    expect(result.current[0]).toBe("aging");
  });
});
