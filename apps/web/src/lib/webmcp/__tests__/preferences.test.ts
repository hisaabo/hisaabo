import { describe, it, expect, afterEach, vi } from "vitest";
import {
  WEBMCP_PREF_KEY,
  isAgentAccessEnabled,
  setAgentAccessEnabled,
  subscribeAgentAccess,
} from "../preferences";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("agent access preference", () => {
  it("defaults to off when nothing is stored", () => {
    expect(isAgentAccessEnabled()).toBe(false);
  });

  it("migrates legacy values to off (the old default-on state stored nothing, opt-out stored 'off')", () => {
    expect(isAgentAccessEnabled()).toBe(false);
    localStorage.setItem(WEBMCP_PREF_KEY, "off");
    expect(isAgentAccessEnabled()).toBe(false);
    localStorage.setItem(WEBMCP_PREF_KEY, "garbage");
    expect(isAgentAccessEnabled()).toBe(false);
  });

  it("keeps an explicit stored 'true' or 'on'", () => {
    localStorage.setItem(WEBMCP_PREF_KEY, "true");
    expect(isAgentAccessEnabled()).toBe(true);
    localStorage.setItem(WEBMCP_PREF_KEY, "on");
    expect(isAgentAccessEnabled()).toBe(true);
  });

  it("round-trips and notifies subscribers", () => {
    const listener = vi.fn();
    const off = subscribeAgentAccess(listener);
    setAgentAccessEnabled(true);
    expect(isAgentAccessEnabled()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    setAgentAccessEnabled(false);
    expect(isAgentAccessEnabled()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    off();
  });

  it("fails closed when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isAgentAccessEnabled()).toBe(false);
  });
});
